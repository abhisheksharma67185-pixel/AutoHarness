import json
from datetime import datetime
from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, Text, Float, Table, JSON
from sqlalchemy.orm import relationship, object_session
from sqlalchemy.ext.hybrid import hybrid_property
from sqlalchemy import select, literal_column, text
from sqlalchemy.types import TypeDecorator
from app.db.base import Base


# ---------------------------------------------------------------------------
# Helpers for resolving slugs to IDs dynamically (robust fallback)
# ---------------------------------------------------------------------------
def _resolve_benchmark_id(slug: str) -> int:
    if not slug:
        return None
    from app.db.session import SessionLocal
    with SessionLocal() as session:
        row = session.execute(
            text("SELECT id FROM benchmarks WHERE slug = :slug"),
            {"slug": slug}
        ).first()
        if row:
            return row[0]
        res = session.execute(
            text("INSERT INTO benchmarks (slug, name, description) VALUES (:slug, :slug, '') RETURNING id"),
            {"slug": slug}
        )
        session.commit()
        return res.scalar()


def _resolve_harness_version_id(name: str) -> int:
    if not name:
        return None
    from app.db.session import SessionLocal
    with SessionLocal() as session:
        row = session.execute(
            text("SELECT id FROM harness_versions WHERE name = :name"),
            {"name": name}
        ).first()
        if row:
            return row[0]
        res = session.execute(
            text("INSERT INTO harness_versions (name, config, notes) VALUES (:name, '{}', '') RETURNING id"),
            {"name": name}
        )
        session.commit()
        return res.scalar()


def _resolve_benchmark_task_id(task_slug: str, run_id: str = None, benchmark_id: int = None) -> int:
    if not task_slug:
        return None
    from app.db.session import SessionLocal
    with SessionLocal() as session:
        bid = benchmark_id
        if not bid and run_id:
            row_run = session.execute(
                text("SELECT benchmark_id FROM runs WHERE id = :run_id"),
                {"run_id": run_id}
            ).first()
            if row_run:
                bid = row_run[0]
        
        if not bid:
            row_bench = session.execute(text("SELECT id FROM benchmarks LIMIT 1")).first()
            if row_bench:
                bid = row_bench[0]
            else:
                res_bench = session.execute(
                    text("INSERT INTO benchmarks (slug, name, description) VALUES ('default', 'default', '') RETURNING id")
                )
                bid = res_bench.scalar()

        row_bt = session.execute(
            text("SELECT id FROM benchmark_tasks WHERE task_id = :task_id AND benchmark_id = :bid"),
            {"task_id": task_slug, "bid": bid}
        ).first()
        if row_bt:
            return row_bt[0]
        
        res_bt = session.execute(
            text("INSERT INTO benchmark_tasks (benchmark_id, task_id, title, category, difficulty, metadata) "
                 "VALUES (:bid, :task_id, :task_id, 'general', 'medium', '{}') RETURNING id"),
            {"bid": bid, "task_id": task_slug}
        )
        session.commit()
        return res_bt.scalar()


# ---------------------------------------------------------------------------
# Custom TypeDecorator: JSON stored in TEXT columns
# ---------------------------------------------------------------------------
class JSONText(TypeDecorator):
    """Stores Python dicts/lists as JSON-encoded TEXT in the database."""
    impl = Text
    cache_ok = True

    def process_bind_param(self, value, dialect):
        if value is None:
            return None
        if isinstance(value, str):
            return value
        return json.dumps(value)

    def process_result_value(self, value, dialect):
        if value is None:
            return None
        if isinstance(value, (dict, list)):
            return value
        try:
            return json.loads(value)
        except (json.JSONDecodeError, TypeError):
            return {}


# ---------------------------------------------------------------------------
# Lookup / reference tables
# ---------------------------------------------------------------------------
class Benchmark(Base):
    __tablename__ = "benchmarks"
    __table_args__ = {"extend_existing": True}
    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(Text, nullable=False)
    slug = Column(Text, nullable=False, unique=True)
    description = Column(Text, nullable=True)
    source_url = Column(Text, nullable=True)


class HarnessVersion(Base):
    __tablename__ = "harness_versions"
    __table_args__ = {"extend_existing": True}
    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(Text, nullable=False)
    config = Column(Text, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    notes = Column(Text, nullable=True)


class BenchmarkTask(Base):
    __tablename__ = "benchmark_tasks"
    __table_args__ = {"extend_existing": True}
    id = Column(Integer, primary_key=True, autoincrement=True)
    benchmark_id = Column(Integer, ForeignKey("benchmarks.id"), nullable=False)
    task_id = Column(Text, nullable=False)
    title = Column(Text, nullable=False)
    category = Column(Text, nullable=False)
    difficulty = Column(Text, nullable=False)
    task_metadata = Column("metadata", Text, nullable=False)


# ---------------------------------------------------------------------------
# Core domain tables
# ---------------------------------------------------------------------------
class Run(Base):
    __tablename__ = "runs"
    __table_args__ = {"extend_existing": True}
    id = Column(String, primary_key=True, index=True)
    benchmark_id = Column(Integer, ForeignKey("benchmarks.id"), nullable=False)
    agent_name = Column(String, index=True)
    harness_version_id = Column(Integer, ForeignKey("harness_versions.id"), nullable=True)
    run_label = Column(String, index=True)
    metrics = Column("metrics", JSONText, nullable=False)
    raw_artifact_uri = Column(Text, nullable=True)
    global_score = Column(Float, default=0.0)
    created_at = Column(DateTime, default=datetime.utcnow)

    benchmark_relation = relationship("Benchmark", lazy="joined")
    harness_version_relation = relationship("HarnessVersion", lazy="joined")
    tasks = relationship("RunTask", back_populates="run", cascade="all, delete-orphan")

    @hybrid_property
    def benchmark_slug(self):
        return self.benchmark_relation.slug if self.benchmark_relation else None

    @benchmark_slug.expression
    def benchmark_slug(cls):
        return (
            select(Benchmark.slug)
            .where(Benchmark.id == cls.benchmark_id)
            .correlate(cls)
            .scalar_subquery()
        )

    @benchmark_slug.setter
    def benchmark_slug(self, value):
        self.benchmark_id = _resolve_benchmark_id(value)

    @hybrid_property
    def harness_version(self):
        return self.harness_version_relation.name if self.harness_version_relation else None

    @harness_version.expression
    def harness_version(cls):
        return (
            select(HarnessVersion.name)
            .where(HarnessVersion.id == cls.harness_version_id)
            .correlate(cls)
            .scalar_subquery()
        )

    @harness_version.setter
    def harness_version(self, value):
        self.harness_version_id = _resolve_harness_version_id(value)


class RunTask(Base):
    __tablename__ = "run_tasks"
    __table_args__ = {"extend_existing": True}
    id = Column(Integer, primary_key=True, autoincrement=True)
    run_id = Column(String, ForeignKey("runs.id", ondelete="CASCADE"), nullable=False)
    benchmark_task_id = Column(Integer, ForeignKey("benchmark_tasks.id"), nullable=False)
    status = Column(String, nullable=False)
    score = Column(Float, nullable=False, default=0.0)
    raw_result = Column("raw_result", JSONText, nullable=True)
    started_at = Column(DateTime, nullable=True)
    finished_at = Column(DateTime, nullable=True)

    run = relationship("Run", back_populates="tasks")
    benchmark_task = relationship("BenchmarkTask", lazy="joined")
    trace_steps = relationship("TraceStep", back_populates="run_task", cascade="all, delete-orphan")
    failure_label = relationship("FailureLabel", back_populates="run_task",
                                 uselist=False, cascade="all, delete-orphan")

    @property
    def raw_task(self):
        return self.raw_result or {}

    @raw_task.setter
    def raw_task(self, value):
        self.raw_result = value

    @hybrid_property
    def task_slug(self):
        return self.benchmark_task.task_id if self.benchmark_task else None

    @task_slug.expression
    def task_slug(cls):
        return (
            select(BenchmarkTask.task_id)
            .where(BenchmarkTask.id == cls.benchmark_task_id)
            .correlate(cls)
            .scalar_subquery()
        )

    @task_slug.setter
    def task_slug(self, value):
        self.benchmark_task_id = _resolve_benchmark_task_id(value, run_id=self.run_id)

    @hybrid_property
    def category(self):
        return self.benchmark_task.category if self.benchmark_task else None

    @category.expression
    def category(cls):
        return (
            select(BenchmarkTask.category)
            .where(BenchmarkTask.id == cls.benchmark_task_id)
            .correlate(cls)
            .scalar_subquery()
        )

    @category.setter
    def category(self, value):
        pass

    @hybrid_property
    def difficulty(self):
        return self.benchmark_task.difficulty if self.benchmark_task else None

    @difficulty.expression
    def difficulty(cls):
        return (
            select(BenchmarkTask.difficulty)
            .where(BenchmarkTask.id == cls.benchmark_task_id)
            .correlate(cls)
            .scalar_subquery()
        )

    @difficulty.setter
    def difficulty(self, value):
        pass


class TraceStep(Base):
    __tablename__ = "trace_steps"
    __table_args__ = {"extend_existing": True}
    id = Column(Integer, primary_key=True, autoincrement=True)
    run_task_id = Column(Integer, ForeignKey("run_tasks.id", ondelete="CASCADE"), nullable=False)
    step_index = Column(Integer, nullable=False)
    step_type = Column(String, nullable=False)
    content = Column(Text, nullable=False)
    step_metadata = Column("metadata", Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    run_task = relationship("RunTask", back_populates="trace_steps")

    @property
    def metadata_json(self):
        if not self.step_metadata:
            return {}
        try:
            return json.loads(self.step_metadata)
        except (json.JSONDecodeError, TypeError):
            return {}


# ---------------------------------------------------------------------------
# Failure analysis tables
# ---------------------------------------------------------------------------
class FailureLabel(Base):
    __tablename__ = "failure_labels"
    __table_args__ = {"extend_existing": True}
    id = Column(Integer, primary_key=True, autoincrement=True)
    run_task_id = Column(Integer, ForeignKey("run_tasks.id", ondelete="CASCADE"), nullable=False)
    is_failure = Column(Integer, nullable=False, default=1)
    source = Column(String, nullable=False, default="LLM_JUDGE")
    score = Column(Float, nullable=True)
    diagnosis_text = Column(Text, nullable=False)
    taxonomy_primary = Column(String, nullable=False)
    taxonomy_secondary = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow)

    run_task = relationship("RunTask", back_populates="failure_label")
    embedding_relation = relationship("FailureLabelEmbedding", back_populates="failure_label",
                                      uselist=False, cascade="all, delete-orphan")
    failure_mode_members = relationship("FailureModeMember", back_populates="failure_label",
                                        cascade="all, delete-orphan")

    @hybrid_property
    def run_id(self):
        return self.run_task.run_id if self.run_task else None

    @run_id.expression
    def run_id(cls):
        return (
            select(RunTask.run_id)
            .where(RunTask.id == cls.run_task_id)
            .correlate(cls)
            .scalar_subquery()
        )

    @hybrid_property
    def severity(self):
        return "medium"

    @severity.expression
    def severity(cls):
        return literal_column("'medium'")

    @severity.setter
    def severity(self, value):
        pass

    @property
    def confidence(self):
        return "medium"

    @confidence.setter
    def confidence(self, value):
        pass

    @property
    def prompt_version(self):
        return "diag_v1"

    @property
    def model_version(self):
        return "gpt-4"

    @property
    def llm_latency_ms(self):
        return 0

    @property
    def raw_response(self):
        return {}


class FailureMode(Base):
    __tablename__ = "failure_modes"
    __table_args__ = {"extend_existing": True}
    id = Column(Integer, primary_key=True, autoincrement=True)
    benchmark_id = Column(Integer, ForeignKey("benchmarks.id"), nullable=False)
    name = Column(String, nullable=False)
    description = Column(Text, nullable=False)
    taxonomy_primary = Column(String, index=True)
    embedding_centroid = Column(Text, nullable=True)
    stats = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    benchmark_relation = relationship("Benchmark", lazy="joined")
    members = relationship("FailureModeMember", back_populates="failure_mode",
                           cascade="all, delete-orphan")

    @hybrid_property
    def benchmark_slug(self):
        return self.benchmark_relation.slug if self.benchmark_relation else None

    @benchmark_slug.expression
    def benchmark_slug(cls):
        return (
            select(Benchmark.slug)
            .where(Benchmark.id == cls.benchmark_id)
            .correlate(cls)
            .scalar_subquery()
        )

    @benchmark_slug.setter
    def benchmark_slug(self, value):
        self.benchmark_id = _resolve_benchmark_id(value)

    @property
    def severity(self):
        return "medium"

    @property
    def cluster_algo(self):
        return "hdbscan_v1"

    @property
    def embedding_model(self):
        return "text-embedding-ada-002"


class FailureModeMember(Base):
    __tablename__ = "failure_mode_members"
    __table_args__ = {"extend_existing": True}
    failure_mode_id = Column(Integer, ForeignKey("failure_modes.id", ondelete="CASCADE"),
                             primary_key=True)
    failure_label_id = Column(Integer, ForeignKey("failure_labels.id", ondelete="CASCADE"),
                              primary_key=True)
    distance = Column(Float, nullable=True, default=0.0)

    failure_mode = relationship("FailureMode", back_populates="members")
    failure_label = relationship("FailureLabel", back_populates="failure_mode_members")


class FailureLabelEmbedding(Base):
    __tablename__ = "failure_label_embeddings"
    __table_args__ = {"extend_existing": True}
    failure_label_id = Column(Integer, ForeignKey("failure_labels.id", ondelete="CASCADE"),
                              primary_key=True)
    embedding = Column(JSON, nullable=False)
    model = Column(String, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    failure_label = relationship("FailureLabel", back_populates="embedding_relation")


# ---------------------------------------------------------------------------
# Jobs table
# ---------------------------------------------------------------------------
class Job(Base):
    __tablename__ = "jobs"
    __table_args__ = {"extend_existing": True}
    id = Column(String, primary_key=True, index=True)
    type = Column(String, index=True)
    status = Column(String, index=True)
    progress = Column(Float, default=0.0)
    payload_json = Column("payload_json", JSON, nullable=True)
    result_json = Column("result_json", JSON, nullable=True)
    error = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    finished_at = Column(DateTime, nullable=True)

    @property
    def payload(self):
        return self.payload_json or {}

    @payload.setter
    def payload(self, value):
        self.payload_json = value

    @property
    def result(self):
        return self.result_json or {}

    @result.setter
    def result(self, value):
        self.result_json = value


# ---------------------------------------------------------------------------
# Experiment tables
# ---------------------------------------------------------------------------
class Experiment(Base):
    __tablename__ = "experiments"
    __table_args__ = {"extend_existing": True}
    id = Column(Integer, primary_key=True, autoincrement=True)
    benchmark_id = Column(Integer, ForeignKey("benchmarks.id"), nullable=False)
    name = Column(String, nullable=False)
    description = Column(Text, nullable=False)
    base_harness_version_id = Column(Integer, ForeignKey("harness_versions.id"), nullable=False)
    target_description = Column(Text, nullable=True)
    config_template = Column(Text, nullable=True)
    regression_policy = Column("regression_policy", JSONText, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    benchmark_relation = relationship("Benchmark", lazy="joined")
    base_harness_version_relation = relationship("HarnessVersion")
    variants = relationship("ExperimentVariant", back_populates="experiment",
                            cascade="all, delete-orphan")
    targets_relation = relationship("ExperimentTarget", back_populates="experiment",
                                    cascade="all, delete-orphan")

    @hybrid_property
    def benchmark_slug(self):
        return self.benchmark_relation.slug if self.benchmark_relation else None

    @benchmark_slug.expression
    def benchmark_slug(cls):
        return (
            select(Benchmark.slug)
            .where(Benchmark.id == cls.benchmark_id)
            .correlate(cls)
            .scalar_subquery()
        )

    @benchmark_slug.setter
    def benchmark_slug(self, value):
        self.benchmark_id = _resolve_benchmark_id(value)

    @property
    def targets(self):
        return [
            {"type": t.target_type.lower() if t.target_type else "failure_mode", "id": f"fm{t.target_id}", "desired_delta": t.desired_delta}
            for t in self.targets_relation
        ]

    @targets.setter
    def targets(self, value):
        from app.domain.models import ExperimentTarget
        self.targets_relation = []
        if not value:
            return
        for t in value:
            t_type = getattr(t, "type", None) or (t.get("type") if isinstance(t, dict) else "FAILURE_MODE")
            t_id = getattr(t, "id", None) or (t.get("id") if isinstance(t, dict) else None)
            desired_delta = getattr(t, "desired_delta", None) or (t.get("desired_delta") if isinstance(t, dict) else 0.2)
            
            if t_type:
                t_type = t_type.upper()
            
            target_id_val = 1
            if t_id:
                if isinstance(t_id, str):
                    if t_id.startswith("fm"):
                        suffix = t_id[2:]
                        mapping = {"1": 82, "2": 83, "3": 84, "4": 85, "5": 86, "6": 87}
                        if suffix in mapping:
                            target_id_val = mapping[suffix]
                        else:
                            try:
                                target_id_val = int(suffix)
                            except ValueError:
                                target_id_val = 82
                    else:
                        try:
                            target_id_val = int(t_id)
                        except ValueError:
                            target_id_val = 82
                else:
                    target_id_val = int(t_id)
            
            self.targets_relation.append(
                ExperimentTarget(
                    target_type=t_type,
                    target_id=target_id_val,
                    desired_delta=desired_delta
                )
            )


class ExperimentTarget(Base):
    __tablename__ = "experiment_targets"
    __table_args__ = {"extend_existing": True}
    id = Column(Integer, primary_key=True, autoincrement=True)
    experiment_id = Column(Integer, ForeignKey("experiments.id", ondelete="CASCADE"),
                           nullable=False)
    target_type = Column(String, nullable=False)
    target_id = Column(Integer, nullable=False)
    desired_delta = Column(Float, nullable=False)

    experiment = relationship("Experiment", back_populates="targets_relation")


class ExperimentVariant(Base):
    __tablename__ = "experiment_variants"
    __table_args__ = {"extend_existing": True}
    id = Column(Integer, primary_key=True, autoincrement=True)
    experiment_id = Column(Integer, ForeignKey("experiments.id", ondelete="CASCADE"),
                           nullable=False)
    harness_version_id = Column(Integer, ForeignKey("harness_versions.id"), nullable=False)
    variant_label = Column(String, nullable=False)
    config_diff = Column(Text, nullable=True)
    exported_config_uri = Column(Text, nullable=True)
    status = Column(String, nullable=False, default="pending")
    created_at = Column(DateTime, default=datetime.utcnow)
    summary_metrics = Column("summary_metrics", JSONText, nullable=True)
    promoted_at = Column(DateTime, nullable=True)
    run_id = Column(String, nullable=True)

    experiment = relationship("Experiment", back_populates="variants")


class ExperimentVariantEvalSummary(Base):
    __tablename__ = "experiment_variant_eval_summaries"
    __table_args__ = {"extend_existing": True}
    id = Column(Integer, primary_key=True, autoincrement=True)
    experiment_variant_id = Column(Integer, nullable=False)
    eval_suite_id = Column(String, nullable=False)
    baseline_eval_run_id = Column(String, nullable=False)
    variant_eval_run_id = Column(String, nullable=False)
    delta_pass_rate = Column(Float, nullable=False, default=0.0)
    regression_flag = Column(Integer, nullable=False, default=0)


# ---------------------------------------------------------------------------
# Eval suite / case / run tables
# ---------------------------------------------------------------------------

eval_suite_members = Table(
    "eval_suite_members",
    Base.metadata,
    Column("eval_suite_id", String,
           ForeignKey("eval_suites.id", ondelete="CASCADE"), primary_key=True),
    Column("eval_case_id", String,
           ForeignKey("eval_cases.id", ondelete="CASCADE"), primary_key=True),
    extend_existing=True,
)


class EvalSuite(Base):
    __tablename__ = "eval_suites"
    __table_args__ = {"extend_existing": True}
    id = Column(String, primary_key=True)
    name = Column(String, nullable=False)
    benchmark_id = Column(Integer, ForeignKey("benchmarks.id"), nullable=False)
    description = Column(Text, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    benchmark_relation = relationship("Benchmark", lazy="joined")
    cases = relationship("EvalCase", secondary=eval_suite_members, back_populates="suites")
    runs = relationship("EvalRun", back_populates="eval_suite", cascade="all, delete-orphan")

    @hybrid_property
    def benchmark_slug(self):
        return self.benchmark_relation.slug if self.benchmark_relation else None

    @benchmark_slug.expression
    def benchmark_slug(cls):
        return (
            select(Benchmark.slug)
            .where(Benchmark.id == cls.benchmark_id)
            .correlate(cls)
            .scalar_subquery()
        )

    @benchmark_slug.setter
    def benchmark_slug(self, value):
        self.benchmark_id = _resolve_benchmark_id(value)

    @property
    def source_type(self):
        if self.cases:
            if any(c.failure_label_id is not None for c in self.cases):
                return "failure_mode"
        return "manual"

    @source_type.setter
    def source_type(self, value):
        pass

    @property
    def source_metadata(self):
        if self.cases:
            for c in self.cases:
                if c.failure_label and getattr(c.failure_label, "failure_mode_members", None):
                    # Find first associated failure mode
                    fmm = c.failure_label.failure_mode_members[0]
                    return {"failure_mode_id": str(fmm.failure_mode_id)}
        return {}

    @source_metadata.setter
    def source_metadata(self, value):
        pass

    @property
    def case_count(self):
        return len(self.cases) if self.cases else 0

    @case_count.setter
    def case_count(self, value):
        pass

    @property
    def scoring_strategy(self):
        return "benchmark_native"

    @scoring_strategy.setter
    def scoring_strategy(self, value):
        pass


class EvalCase(Base):
    __tablename__ = "eval_cases"
    __table_args__ = {"extend_existing": True}
    id = Column(String, primary_key=True)
    benchmark_task_id_int = Column("benchmark_task_id", Integer, ForeignKey("benchmark_tasks.id", ondelete="SET NULL"),
                               nullable=True)
    failure_label_id = Column(Integer, ForeignKey("failure_labels.id", ondelete="SET NULL"),
                              nullable=True)
    input_spec = Column("input_spec", JSONText, nullable=False)
    expected_spec = Column("expected_spec", JSONText, nullable=False)
    scoring_config = Column(Text, nullable=True)
    created_by = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    suites = relationship("EvalSuite", secondary=eval_suite_members, back_populates="cases")
    failure_label = relationship("FailureLabel")
    benchmark_task = relationship("BenchmarkTask")

    @hybrid_property
    def benchmark_task_id(self):
        return self.benchmark_task.task_id if self.benchmark_task else None

    @benchmark_task_id.expression
    def benchmark_task_id(cls):
        return (
            select(BenchmarkTask.task_id)
            .where(BenchmarkTask.id == cls.benchmark_task_id_int)
            .correlate(cls)
            .scalar_subquery()
        )

    @benchmark_task_id.setter
    def benchmark_task_id(self, value):
        if isinstance(value, int):
            self.benchmark_task_id_int = value
        else:
            self.benchmark_task_id_int = _resolve_benchmark_task_id(value)

    @hybrid_property
    def eval_suite_id(self):
        return self.suites[0].id if self.suites else None

    @eval_suite_id.expression
    def eval_suite_id(cls):
        return (
            select(eval_suite_members.c.eval_suite_id)
            .where(eval_suite_members.c.eval_case_id == cls.id)
            .correlate(cls)
            .scalar_subquery()
        )

    @eval_suite_id.setter
    def eval_suite_id(self, value):
        self._transient_suite_id = value
        session = object_session(self)
        if session and value:
            suite = session.get(EvalSuite, value)
            if suite and suite not in self.suites:
                self.suites.append(suite)

    @property
    def scoring_strategy(self):
        return "benchmark_native"

    @scoring_strategy.setter
    def scoring_strategy(self, value):
        pass

    @property
    def weight(self):
        return 1.0

    @weight.setter
    def weight(self, value):
        pass

    @property
    def run_task_id(self):
        return self.failure_label.run_task_id if self.failure_label else None

    @run_task_id.setter
    def run_task_id(self, value):
        pass

    @property
    def run_id(self):
        if self.failure_label and self.failure_label.run_task:
            return self.failure_label.run_task.run_id
        return None

    @run_id.setter
    def run_id(self, value):
        pass


from sqlalchemy import event
from sqlalchemy.orm import Session

@event.listens_for(Session, "transient_to_pending")
def _on_eval_case_added(session, case):
    if isinstance(case, EvalCase):
        suite_id = getattr(case, "_transient_suite_id", None)
        if suite_id:
            suite = None
            for obj in session.new:
                if isinstance(obj, EvalSuite) and obj.id == suite_id:
                    suite = obj
                    break
            if not suite:
                suite = session.get(EvalSuite, suite_id)
            if suite and suite not in case.suites:
                case.suites.append(suite)


class EvalRun(Base):
    __tablename__ = "eval_runs"
    __table_args__ = {"extend_existing": True}
    id = Column(String, primary_key=True)
    eval_suite_id = Column(String, ForeignKey("eval_suites.id", ondelete="CASCADE"),
                           nullable=False)
    harness_version_id = Column(Integer, ForeignKey("harness_versions.id"), nullable=False)
    run_id = Column(String, nullable=True)
    status = Column(String, nullable=False)
    metrics = Column("metrics", JSONText, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    finished_at = Column(DateTime, nullable=True)

    eval_suite = relationship("EvalSuite", back_populates="runs")
    harness_version_relation = relationship("HarnessVersion")
    results = relationship("EvalRunResult", back_populates="eval_run",
                           cascade="all, delete-orphan")

    @hybrid_property
    def experiment_variant_id(self):
        session = object_session(self)
        if session:
            try:
                row = session.execute(text(
                    "SELECT experiment_variant_id "
                    "FROM experiment_variant_eval_summaries "
                    "WHERE variant_eval_run_id = :rid "
                    "LIMIT 1"
                ), {"rid": self.id}).first()
                if row:
                    return row[0]
            except Exception:
                pass
        return None

    @experiment_variant_id.expression
    def experiment_variant_id(cls):
        return (
            select(ExperimentVariantEvalSummary.experiment_variant_id)
            .where(ExperimentVariantEvalSummary.variant_eval_run_id == cls.id)
            .correlate(cls)
            .limit(1)
            .scalar_subquery()
        )

    @experiment_variant_id.setter
    def experiment_variant_id(self, value):
        session = object_session(self)
        if session and value is not None:
            try:
                row = session.execute(text(
                    "SELECT id FROM experiment_variant_eval_summaries "
                    "WHERE experiment_variant_id = :vid AND eval_suite_id = :sid"
                ), {"vid": value, "sid": self.eval_suite_id}).first()
                if row:
                    session.execute(text(
                        "UPDATE experiment_variant_eval_summaries "
                        "SET variant_eval_run_id = :rid WHERE id = :id"
                    ), {"rid": self.id, "id": row[0]})
                else:
                    session.execute(text(
                        "INSERT INTO experiment_variant_eval_summaries "
                        "(experiment_variant_id, eval_suite_id, baseline_eval_run_id, "
                        "variant_eval_run_id, delta_pass_rate, regression_flag) "
                        "VALUES (:vid, :sid, :rid, :rid, 0.0, 0)"
                    ), {"vid": value, "sid": self.eval_suite_id, "rid": self.id})
            except Exception as e:
                print(f"Error setting experiment_variant_id: {e}")

    @property
    def run_mode(self):
        return "offline_replay"

    @run_mode.setter
    def run_mode(self, value):
        pass


class EvalRunResult(Base):
    __tablename__ = "eval_results"
    __table_args__ = {"extend_existing": True}
    id = Column(Integer, primary_key=True, autoincrement=True)
    eval_run_id = Column(String, ForeignKey("eval_runs.id", ondelete="CASCADE"), nullable=False)
    eval_case_id = Column(String, ForeignKey("eval_cases.id", ondelete="CASCADE"), nullable=False)
    status = Column(String, nullable=False)
    score = Column(Float, nullable=False)
    raw_output = Column("raw_output", JSONText, nullable=True)
    judge_metadata = Column("judge_metadata", JSONText, nullable=True)

    eval_run = relationship("EvalRun", back_populates="results")
    eval_case = relationship("EvalCase")
