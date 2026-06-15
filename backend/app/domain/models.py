from datetime import datetime
from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, JSON, Text, Float, Boolean
from sqlalchemy.orm import relationship
from app.db.base import Base

class Run(Base):
    __tablename__ = "runs"
    id = Column(String, primary_key=True, index=True)
    job_id = Column(String, unique=True, nullable=True, index=True)
    benchmark_slug = Column(String, index=True)
    run_label = Column(String, index=True)
    agent_name = Column(String, index=True)
    harness_version = Column(String, index=True)
    status = Column(String, index=True, default="completed")
    global_score = Column(Float, default=0.0)
    metrics = Column(JSON, nullable=True)
    raw_artifact_uri = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    tasks = relationship("RunTask", back_populates="run", cascade="all, delete-orphan")


class RunTask(Base):
    __tablename__ = "run_tasks"
    id = Column(String, primary_key=True, index=True)
    run_id = Column(String, ForeignKey("runs.id", ondelete="CASCADE"), index=True)
    benchmark_task_id = Column(String, index=True)
    task_slug = Column(String, index=True)
    category = Column(String, nullable=True)
    difficulty = Column(String, nullable=True)
    status = Column(String, index=True)       # PASS|FAIL|TIMEOUT|UNKNOWN
    score = Column(Float, default=0.0)
    raw_task = Column("raw_task_json", JSON)
    started_at = Column(DateTime, nullable=True)
    finished_at = Column(DateTime, nullable=True)

    run = relationship("Run", back_populates="tasks")
    trace_steps = relationship("TraceStep", back_populates="run_task", cascade="all, delete-orphan")
    failure_label = relationship("FailureLabel", back_populates="run_task", uselist=False, cascade="all, delete-orphan")


class TraceStep(Base):
    __tablename__ = "trace_steps"
    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    run_task_id = Column(String, ForeignKey("run_tasks.id", ondelete="CASCADE"), index=True)
    step_index = Column(Integer)
    step_type = Column(String)                # system|user|assistant|command|log|tool_call|tool_result
    content = Column(Text)
    metadata_json = Column("metadata", JSON)

    run_task = relationship("RunTask", back_populates="trace_steps")


class FailureLabel(Base):
    __tablename__ = "failure_labels"

    id = Column(String, primary_key=True, index=True)
    run_id = Column(String, ForeignKey("runs.id", ondelete="CASCADE"), index=True)
    run_task_id = Column(String, ForeignKey("run_tasks.id", ondelete="CASCADE"), unique=True, index=True)

    diagnosis_text = Column(Text, nullable=False)
    taxonomy_primary = Column(String, index=True)   # gap|ambiguity|tool_misuse|code_bug|upstream|safety|other
    severity = Column(String, index=True)           # low|medium|high|critical
    confidence = Column(String, index=True)         # low|medium|high

    prompt_version = Column(String, index=True, default="diag_v1")
    model_version = Column(String, index=True)      # e.g. 'llama3-8b-q4_k_m'
    llm_latency_ms = Column(Integer)

    raw_response = Column(JSON)
    created_at = Column(DateTime, default=datetime.utcnow)

    run_task = relationship("RunTask", back_populates="failure_label")
    embedding_relation = relationship("FailureLabelEmbedding", back_populates="failure_label", uselist=False, cascade="all, delete-orphan")


class Job(Base):
    __tablename__ = "jobs"
    id = Column(String, primary_key=True, index=True)
    type = Column(String, index=True)         # harbor_rerun|diagnose|cluster
    status = Column(String, index=True)       # pending|running|completed|failed
    progress = Column(Float, default=0.0)
    payload = Column("payload_json", JSON)
    result = Column("result_json", JSON)
    error = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    finished_at = Column(DateTime, nullable=True)


class FailureMode(Base):
    __tablename__ = "failure_modes"

    id = Column(String, primary_key=True, index=True)
    benchmark_slug = Column(String, index=True)
    name = Column(String, nullable=False)
    description = Column(Text, nullable=False)
    taxonomy_primary = Column(String, index=True)            # dominant label in cluster
    severity = Column(String, index=True)                    # dominant severity
    cluster_algo = Column(String, nullable=False)            # e.g. "hdbscan_v1"
    embedding_model = Column(String, nullable=False)
    prompt_version = Column(String, nullable=False, default="mode_v1")
    model_version = Column(String, nullable=False)           # LLM used to name mode
    created_at = Column(DateTime, default=datetime.utcnow)

    members = relationship("FailureModeMember", back_populates="failure_mode", cascade="all, delete-orphan")


class FailureModeMember(Base):
    __tablename__ = "failure_mode_members"

    failure_mode_id = Column(String, ForeignKey("failure_modes.id", ondelete="CASCADE"), primary_key=True)
    failure_label_id = Column(String, ForeignKey("failure_labels.id", ondelete="CASCADE"), primary_key=True)
    distance = Column(Float, nullable=True)                  # optional distance to cluster centroid

    failure_mode = relationship("FailureMode", back_populates="members")
    failure_label = relationship("FailureLabel")


class FailureLabelEmbedding(Base):
    __tablename__ = "failure_label_embeddings"

    failure_label_id = Column(String, ForeignKey("failure_labels.id", ondelete="CASCADE"), primary_key=True)
    embedding = Column(JSON, nullable=False)                 # list of floats
    model = Column(String, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    failure_label = relationship("FailureLabel", back_populates="embedding_relation")


class Experiment(Base):
    __tablename__ = "experiments"

    id = Column(String, primary_key=True, index=True)
    benchmark_slug = Column(String, index=True)

    name = Column(String, nullable=False)
    description = Column(Text, nullable=False)

    base_harness_version_id = Column(String, nullable=False)  # e.g. hv-baseline-v1
    target_description = Column(Text, nullable=False)         # human-readable description

    # JSON fields
    targets = Column(JSON, nullable=False)          # list of {type: failure_mode|eval_suite, id, desired_delta}
    regression_policy = Column(JSON, nullable=False) # guard_suites, global_min_success_rate

    created_at = Column(DateTime, default=datetime.utcnow)

    variants = relationship("ExperimentVariant", back_populates="experiment", cascade="all, delete-orphan")


class ExperimentVariant(Base):
    __tablename__ = "experiment_variants"

    id = Column(String, primary_key=True, index=True)
    experiment_id = Column(String, ForeignKey("experiments.id", ondelete="CASCADE"), index=True)

    variant_label = Column(String, nullable=False)         # "prompt-v2", "new-cwd-middleware"
    harness_version_id = Column(String, nullable=False)    # version string or config id

    # Status in lifecycle
    status = Column(String, nullable=False, default="pending")  # pending|evaluating|promoted|rejected
    summary_metrics = Column(JSON, nullable=True)          # Scorecard summary

    created_at = Column(DateTime, default=datetime.utcnow)
    promoted_at = Column(DateTime, nullable=True)

    experiment = relationship("Experiment", back_populates="variants")
    eval_runs = relationship("EvalRun", back_populates="variant")


class EvalSuite(Base):
    __tablename__ = "eval_suites"

    id = Column(String, primary_key=True, index=True)
    benchmark_slug = Column(String, index=True)
    name = Column(String, nullable=False)
    description = Column(Text, nullable=False)

    source_type = Column(String, nullable=False)  # failure_mode|manual|imported
    source_metadata = Column(JSON)               # e.g. {"failure_mode_id": "fm1"}

    case_count = Column(Integer, default=0)
    scoring_strategy = Column(String, nullable=False)  # benchmark_native|llm_judge|hybrid

    created_at = Column(DateTime, default=datetime.utcnow)

    cases = relationship("EvalCase", back_populates="eval_suite", cascade="all, delete-orphan")
    runs = relationship("EvalRun", back_populates="eval_suite", cascade="all, delete-orphan")


class EvalCase(Base):
    __tablename__ = "eval_cases"

    id = Column(String, primary_key=True, index=True)
    eval_suite_id = Column(String, ForeignKey("eval_suites.id", ondelete="CASCADE"), index=True)

    # Where the case came from
    failure_label_id = Column(String, ForeignKey("failure_labels.id", ondelete="SET NULL"), nullable=True)
    run_id = Column(String, ForeignKey("runs.id", ondelete="SET NULL"), nullable=True)
    run_task_id = Column(String, ForeignKey("run_tasks.id", ondelete="SET NULL"), nullable=True)

    benchmark_task_id = Column(String, index=True)     # Terminal-Bench task id
    input_spec = Column(JSON, nullable=False)          # how to replay: dataset/task, seed, args
    expected_spec = Column(JSON, nullable=True)        # ground truth if we need it

    # Scoring
    scoring_strategy = Column(String, nullable=False)  # mirrors suite-level, can override
    weight = Column(Float, default=1.0)

    created_at = Column(DateTime, default=datetime.utcnow)

    eval_suite = relationship("EvalSuite", back_populates="cases")


class EvalRun(Base):
    __tablename__ = "eval_runs"

    id = Column(String, primary_key=True, index=True)
    eval_suite_id = Column(String, ForeignKey("eval_suites.id", ondelete="CASCADE"), index=True)
    experiment_variant_id = Column(String, ForeignKey("experiment_variants.id", ondelete="SET NULL"), nullable=True, index=True)
    harness_version_id = Column(String, index=True)   # tie to a harness/config version
    run_mode = Column(String, nullable=False)         # offline_replay|online_rerun

    status = Column(String, nullable=False)           # pending|running|completed|failed
    metrics = Column(JSON)                            # {"pass_rate": ..., "avg_score": ...}

    created_at = Column(DateTime, default=datetime.utcnow)
    finished_at = Column(DateTime, nullable=True)

    eval_suite = relationship("EvalSuite", back_populates="runs")
    variant = relationship("ExperimentVariant", back_populates="eval_runs")
    results = relationship("EvalRunResult", back_populates="eval_run", cascade="all, delete-orphan")


class EvalRunResult(Base):
    __tablename__ = "eval_run_results"

    eval_run_id = Column(String, ForeignKey("eval_runs.id", ondelete="CASCADE"), primary_key=True)
    eval_case_id = Column(String, ForeignKey("eval_cases.id", ondelete="CASCADE"), primary_key=True)

    status = Column(String, index=True)               # pass|fail|error
    score = Column(Float)
    raw_output = Column(JSON)                         # agent output or Harbor summary
    judge_metadata = Column(JSON)                     # llm judge reasoning, logs, etc.

    eval_run = relationship("EvalRun", back_populates="results")
    eval_case = relationship("EvalCase")
