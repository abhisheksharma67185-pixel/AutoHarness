# AutoHarness Studio — Evaluation Design Spec

> **Version:** v1  
> **Project:** AutoHarness Studio (Self‑Improving Agent Evaluation IDE)  
> **Scope:** Evaluation strategy, metric system, suites, and promotion rules for agents run via NeoSigma‑style auto‑harnesses

---

## 1. Evaluation vision

AutoHarness Studio’s evaluation system is designed as a **self‑correcting eval fabric**, not just a scoreboard.

The goals:

- Provide a **hard, realistic capability baseline** using external benchmarks like Terminal‑Bench 2.0.
- Continuously **mine real failures** from auto‑harness runs and convert them into “living evals” grouped by failure mode.
- Enforce **strict regression gates** so no harness change ships unless it improves targets and preserves past wins.
- Make every change legible via a **Promotion Scorecard** for each experiment.

This spec defines the layers, metrics, suites, and promotion rules needed to achieve that.

---

## 2. Principles

1. **Multi‑layered evaluation**  
   Separate capability, behavior, safety, and efficiency. Avoid compressing everything into a single score.

2. **Failure‑centric**  
   Eval creation is primarily driven by **real failure traces**, not just synthetic prompts.

3. **Self‑updating**  
   Eval suites evolve as new failures appear and are incorporated into failure‑mode clusters and guard suites.

4. **Gated promotion**  
   Harness changes are accepted or rejected by pre‑agreed thresholds, not by manual inspection.

5. **Ground truth first, LLM judge last**  
   For benchmarks like Terminal‑Bench, rely on tests and assertions; use LLM‑as‑judge only when ground truth is not crisply expressible.

---

## 3. Evaluation layers

### 3.1 Layer 1 — Foundation benchmarks

**Objective:** Measure raw agent capability on curated, realistic tasks.

**Sources:**

- **Terminal‑Bench 2.0** — 89 hard, realistic terminal tasks, each with its own environment, human‑written solution, and comprehensive tests for verification.
- Future additions: other agent benchmarks such as self‑evolving agent evaluations (e.g., SEA‑Eval) where appropriate.

**Behavior:**

- For each task, auto‑harness executes the agent in a containerized environment and uses the benchmark’s provided tests to determine pass/fail and score.
- AutoHarness Studio ingests the resulting run artifacts and normalizes them into `Run`, `RunTask`, and `TraceStep` records.

**Metrics:**

- `backbone_pass_rate` — percentage of tasks passed on the foundation benchmark.
- `backbone_avg_score` — benchmark‑specific mean score when available.
- Per‑task metadata: `status`, `score`, `time_to_completion`, `num_steps`, `num_retries`.

This layer anchors the system to an externally credible, difficult benchmark rather than synthetic test sets.

---

### 3.2 Layer 2 — Application & failure‑mode evals

Layer 2 converts noisy production‑style failures into structured, reusable evaluation suites.

#### 3.2.1 Failure mining pipeline

For every imported run:

1. **Identify failures**  
   Mark a task as failed if benchmark tests indicate failure or if `score < success_threshold`.

2. **Diagnose failures**  
   For each failed `RunTask`, call a configured LLM profile (local or free‑tier OpenAI‑compatible endpoint) with the task context and trajectory. The model returns:
   - `diagnosis_text` — 1–3 sentences explaining *why* the agent failed.
   - `taxonomy_primary` — coarse root cause label: `gap | ambiguity | tool_misuse | code_bug | upstream | safety | other`.
   - Optional `severity` — e.g., `low | medium | high | critical`.

   This mirrors NeoSigma’s emphasis on using LLMs to summarize and categorize failure behavior in their self‑improving systems.

3. **Persist diagnostics**  
   Store one or more `FailureLabel` records per failing `RunTask`, linked back to the trace.

#### 3.2.2 Failure‑mode clustering

On a schedule or by user request:

1. **Embedding**  
   Represent each failure using an embedding over:
   - `diagnosis_text`.
   - Last *N* trace steps.
   - Benchmark task metadata (category, tools used).

2. **Clustering**  
   Cluster embeddings into coherent **FailureModes** (via k‑means / HDBSCAN or a two‑stage LLM grouping process).

3. **Mode summarization**  
   For each cluster, generate:
   - `name` — short, human‑readable (e.g., “Tool misuse: wrong working directory”).
   - `description` — 2–3 sentence narrative of the failure pattern.
   - `example_failures` — canonical member failures.

The result is a set of FailureModes with counts, distributions across harness versions, and representative examples.

#### 3.2.3 Living evals from failure modes

From each FailureMode, AutoHarness Studio creates **living eval suites**:

1. **Case selection**  
   Sample a representative subset of `FailureLabel`s for the mode, ensuring diversity of tasks and contexts.

2. **Case definition**  
   For each selected failure:
   - Define an input specification (benchmark task ID + environment initialization or equivalent replay recipe) so the agent can be re‑evaluated.
   - Reuse the benchmark’s success tests where available to obtain deterministic scores.
   - If strict tests are unavailable, attach an LLM‑judge spec that defines rubric‑based scoring.

3. **Suite creation**  
   Group these eval cases into a dedicated `EvalSuite` per failure mode, e.g.:
   - `fs-cwd-critical`
   - `tool-ordering-sequence`
   - `ambiguous-instructions`
   - `dangerous-commands-safety`

These living suites grow over time as new failures are mined and promoted, matching the “self‑maintaining eval layer” described in NeoSigma’s auto‑harness work.

---

### 3.3 Layer 3 — Guardrails & meta‑evals

Layer 3 protects against regressions and overfitting.

#### 3.3.1 Guard suites

Maintain a small number of **gold guard suites**:

1. **Critical Regression Suite**  
   - Contains tasks that were previously failing but have been fixed.
   - Expected behavior: **never regress** on these tasks.

2. **Safety Suite**  
   - Contains tasks where the agent must not perform dangerous or irreversible actions (e.g., destructive shell commands, data exfiltration).
   - Expected behavior: zero regressions and strict passing criteria.

3. **Baseline Behavior Suite**  
   - Enforces consistent structural behavior, such as output format, presence of key explanations, or other UX guarantees.

These suites are deliberately small but extremely high value, providing strong regression gates.

#### 3.3.2 Meta‑metrics: stability & churn

To guard against brittle improvements:

- **Stability score**  
  - Run a fixed subset of tasks multiple times per harness version.
  - Compute variance in outcomes or scores; lower variance indicates more reliable behavior.

- **Churn score**  
  - Track how many tasks changed status between two versions (pass→fail, fail→pass).
  - High churn, even with improved average pass rate, can indicate fragility or overfitting.

These meta‑metrics augment raw pass rates with reliability signals.

---

## 4. Metric system

The evaluation system exposes a structured **metric schema** that can be rendered in dashboards and used in promotion logic.

### 4.1 Capability metrics

- `backbone_pass_rate`  
  Fraction of tasks passed on foundation benchmark(s), e.g., Terminal‑Bench 2.0.

- `backbone_avg_score`  
  Mean score across tasks when the benchmark exposes partial credit.

### 4.2 Failure‑mode metrics

For each FailureMode and harness version:

- `fail_count` — absolute number of failures in the mode.
- `fail_rate` — failures divided by total tasks in that mode.
- `delta_fail_rate` — difference vs baseline harness.

These metrics give a legible statement such as “cwd misuse failures dropped from 32% to 8% in this mode.”

### 4.3 Guard metrics

For each guard suite:

- `pass_rate` — fraction of cases passed.
- `delta_pass_rate` — change vs baseline harness.
- `regression_flag` — true if `delta_pass_rate` violates configured tolerance.

Guard suites drive strict gating logic.

### 4.4 Efficiency metrics

To prevent improvements driven by excessive cost:

- `avg_steps_per_task` — mean number of agent steps.
- `avg_wall_time_secs` — mean latency per task.
- `avg_tokens_prompt`, `avg_tokens_completion` — per‑task token usage (for remote LLMs).
- `estimated_cost_per_100_tasks` — cost estimation using provider pricing.

### 4.5 Stability metrics

- `rerun_variance` — variance or standard deviation of scores for repeated runs on a fixed subset of tasks.
- `status_churn` — percentage of tasks whose status changed between harness versions.

These metrics quantify reliability and regression risk beyond average scores.

---

## 5. Evaluation suites

AutoHarness Studio defines five canonical suite types.

### 5.1 Backbone Suite

- Composition: Full or curated subset of Terminal‑Bench 2.0 tasks.
- Purpose: External, realistic capability measurement on long‑horizon terminal tasks.
- Scoring: Deterministic via benchmark tests and exit codes.

### 5.2 Critical Regression Suite

- Composition: Previously failing tasks that are now fixed.
- Purpose: Provide “never regress here” guarantees.
- Scoring: Deterministic, drawn from original benchmark or test harness.

### 5.3 Failure‑Mode Suites

- Composition: Eval cases derived from FailureMode clusters (Section 3.2.3).
- Purpose: Surgical measurement of improvements and regressions in specific failure patterns.
- Scoring: Prefer benchmark tests; use LLM judge only where ground truth cannot be encoded.

### 5.4 Adversarial / Edge Suite

- Composition: Tasks with intentionally ambiguous instructions, misleading filenames, incomplete repo state, confusing logs, or other adversarial properties.
- Purpose: Robustness measurement beyond standard benchmark distribution.

### 5.5 Efficiency Suite

- Composition: Representative subset of tasks where cost and latency are critical.
- Purpose: Enforce cost and latency budgets when improving capabilities.
- Scoring: Combines success/failure with efficiency metrics (e.g., success within a step or token budget).

---

## 6. Judge design

### 6.1 Ground truth‑first policy

Wherever possible, use deterministic metrics derived from:

- Benchmark‑provided unit/integration tests.
- Exit codes and file presence checks.
- Schema validation for structured outputs.

This follows best practice in LLM/agent evaluation frameworks like OpenAI’s `evals` and LangChain’s `openevals`, which emphasize programmatic, reference‑based evaluation.

### 6.2 LLM judge usage

Use LLM‑as‑judge only when the task cannot be easily reduced to deterministic assertions, such as:

- Overall quality of explanations or diagnostics.
- Clarity, helpfulness, and correctness of free‑form text in absence of a single reference answer.

LLM judges should:

- Be specified with a clear rubric and output schema (e.g., JSON with `score` and `reason`).
- Be validated on a small, manually annotated set before being used at scale.

This avoids the common anti‑pattern of using an LLM judge for tasks where strict ground truth is available.

---

## 7. Promotion policy

Promotion is controlled by a **Promotion Scorecard** that compares a candidate harness version against a baseline under all relevant metrics and suites.

### 7.1 Eligibility conditions

A candidate harness version is **eligible for promotion** only if all of the following hold:

1. **Capability improvement**  
   At least one of:
   - `backbone_pass_rate(candidate) ≥ backbone_pass_rate(baseline) + 0.03`; or
   - `target_failure_mode_suite_pass_rate(candidate) ≥ target_failure_mode_suite_pass_rate(baseline) + 0.10`.

2. **No unacceptable regressions on guard suites**  
   For each guard suite `G`:
   - `pass_rate_G(candidate) ≥ pass_rate_G(baseline) − max_allowed_drop_G`.
   - For Critical Regression Suite and Safety Suite, `max_allowed_drop_G = 0` (no regressions allowed).

3. **Efficiency within budget**  
   - `estimated_cost_per_100_tasks(candidate) ≤ estimated_cost_per_100_tasks(baseline) × 1.15`.
   - For cost‑focused experiments, tighter caps can be used (e.g., ≤ 1.05×).

4. **Stability not degraded**  
   - `rerun_variance(candidate) ≤ rerun_variance(baseline) + ε`, where `ε` is a small tolerance.

5. **Holdout generalization**  
   - Candidate must match or outperform baseline on a **holdout subset** of tasks that were not used in designing the fix or in constructing the target suite, preventing overfitting to a small eval slice.

### 7.2 Promotion Scorecard format

For each experiment and variant, AutoHarness Studio generates a Promotion Scorecard with rows for:

- Backbone metrics (pass rate, avg score).
- Target failure‑mode suite metrics.
- Guard suite metrics (with regression flags).
- Efficiency metrics.
- Stability metrics.

Columns represent `baseline`, `candidate`, and `delta`, with visual indicators (checkmarks / warnings) for each eligibility condition.

The promotion decision is therefore **binary and traceable**: a variant is promoted only if its scorecard meets all configured criteria.

---

## 8. Integration with experiments

Each `Experiment` object in AutoHarness Studio stores:

- `targets` — which FailureModes and EvalSuites the experiment aims to improve.
- `regression_policy` — set of guard suites and tolerances.
- Pointers to baseline `EvalRun`s and to `EvalRun`s for each candidate variant.

When variants are linked back to new auto‑harness runs and evaluated, the experiment dashboard surfaces:

- Per‑variant Promotion Scorecards.
- Drill‑down into failure‑mode metrics, traces, and before/after examples.

---

*AutoHarness Studio · Evaluation Design v1 · Built to support self‑improving agentic systems*
