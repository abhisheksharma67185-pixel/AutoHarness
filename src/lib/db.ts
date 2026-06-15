import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

let DB_PATH = path.join(process.cwd(), 'autoharness.db');

if (process.env.NODE_ENV === 'production') {
  const tmpDbPath = path.join('/tmp', 'autoharness.db');
  if (!fs.existsSync(tmpDbPath)) {
    try {
      fs.copyFileSync(DB_PATH, tmpDbPath);
      console.log('Successfully copied seed database to /tmp/autoharness.db');
    } catch (err) {
      console.error('Failed to copy seed database to /tmp:', err);
    }
  }
  DB_PATH = tmpDbPath;
}

let db: Database.Database;

if (process.env.NODE_ENV === 'production') {
  db = new Database(DB_PATH);
} else {
  if (!(global as any)._sqliteDb) {
    (global as any)._sqliteDb = new Database(DB_PATH);
  }
  db = (global as any)._sqliteDb;
}

// Enable foreign keys
db.pragma('foreign_keys = ON');

// Re-initialize database schema
db.exec(`
  PRAGMA foreign_keys = ON;

  -- 1. Benchmarks
  CREATE TABLE IF NOT EXISTS benchmarks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    description TEXT,
    source_url TEXT
  );

  -- 2. Benchmark Tasks
  CREATE TABLE IF NOT EXISTS benchmark_tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    benchmark_id INTEGER NOT NULL,
    task_id TEXT NOT NULL,
    title TEXT NOT NULL,
    category TEXT NOT NULL,
    difficulty TEXT NOT NULL,
    metadata TEXT NOT NULL, -- JSON string
    FOREIGN KEY(benchmark_id) REFERENCES benchmarks(id) ON DELETE CASCADE,
    UNIQUE(benchmark_id, task_id)
  );

  -- 3. Harness Versions
  CREATE TABLE IF NOT EXISTS harness_versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    config TEXT NOT NULL, -- JSON string
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    notes TEXT
  );

  -- 4. Runs
  CREATE TABLE IF NOT EXISTS runs (
    id TEXT PRIMARY KEY, -- UUID/String run_id
    benchmark_id INTEGER NOT NULL,
    agent_name TEXT NOT NULL,
    harness_version_id INTEGER,
    run_label TEXT NOT NULL,
    metrics TEXT NOT NULL, -- JSON string
    raw_artifact_uri TEXT,
    global_score REAL DEFAULT 0.0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(benchmark_id) REFERENCES benchmarks(id),
    FOREIGN KEY(harness_version_id) REFERENCES harness_versions(id) ON DELETE SET NULL
  );

  -- 5. Run Tasks
  CREATE TABLE IF NOT EXISTS run_tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT NOT NULL,
    benchmark_task_id INTEGER NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('PASS', 'FAIL', 'TIMEOUT', 'ERROR', 'UNKNOWN')),
    score REAL NOT NULL,
    raw_result TEXT, -- JSON string
    started_at DATETIME,
    finished_at DATETIME,
    FOREIGN KEY(run_id) REFERENCES runs(id) ON DELETE CASCADE,
    FOREIGN KEY(benchmark_task_id) REFERENCES benchmark_tasks(id)
  );

  -- 6. Trace Steps
  CREATE TABLE IF NOT EXISTS trace_steps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_task_id INTEGER NOT NULL,
    step_index INTEGER NOT NULL,
    step_type TEXT NOT NULL CHECK(step_type IN ('SYSTEM', 'USER', 'ASSISTANT', 'TOOL_CALL', 'TOOL_RESULT', 'COMMAND', 'LOG')),
    content TEXT NOT NULL,
    metadata TEXT, -- JSON string
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(run_task_id) REFERENCES run_tasks(id) ON DELETE CASCADE
  );

  -- 7. Failure Labels
  CREATE TABLE IF NOT EXISTS failure_labels (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_task_id INTEGER NOT NULL UNIQUE,
    is_failure INTEGER NOT NULL CHECK(is_failure IN (0, 1)),
    source TEXT NOT NULL CHECK(source IN ('BENCHMARK', 'LLM_JUDGE', 'MANUAL')),
    score REAL,
    diagnosis_text TEXT NOT NULL,
    taxonomy_primary TEXT NOT NULL CHECK(taxonomy_primary IN ('GAP', 'AMBIGUITY', 'TOOL_MISUSE', 'CODE_BUG', 'UPSTREAM', 'SAFETY', 'OTHER')),
    taxonomy_secondary TEXT, -- JSON array of strings
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(run_task_id) REFERENCES run_tasks(id) ON DELETE CASCADE
  );

  -- 8. Failure Modes
  CREATE TABLE IF NOT EXISTS failure_modes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    benchmark_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    taxonomy_primary TEXT NOT NULL,
    embedding_centroid TEXT, -- JSON float array representing embedding vector
    stats TEXT, -- JSON string
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(benchmark_id) REFERENCES benchmarks(id) ON DELETE CASCADE
  );

  -- 9. Failure Mode Members
  CREATE TABLE IF NOT EXISTS failure_mode_members (
    failure_mode_id INTEGER NOT NULL,
    failure_label_id INTEGER NOT NULL,
    distance REAL DEFAULT 0.0,
    PRIMARY KEY (failure_mode_id, failure_label_id),
    FOREIGN KEY(failure_mode_id) REFERENCES failure_modes(id) ON DELETE CASCADE,
    FOREIGN KEY(failure_label_id) REFERENCES failure_labels(id) ON DELETE CASCADE
  );

  -- 10. Eval Cases
  CREATE TABLE IF NOT EXISTS eval_cases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    benchmark_task_id INTEGER,
    failure_label_id INTEGER,
    input_spec TEXT NOT NULL, -- JSON string
    expected_spec TEXT NOT NULL, -- JSON string
    scoring_config TEXT, -- JSON string
    created_by TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(benchmark_task_id) REFERENCES benchmark_tasks(id) ON DELETE SET NULL,
    FOREIGN KEY(failure_label_id) REFERENCES failure_labels(id) ON DELETE SET NULL
  );

  -- 11. Eval Suites
  CREATE TABLE IF NOT EXISTS eval_suites (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    benchmark_id INTEGER NOT NULL,
    description TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(benchmark_id) REFERENCES benchmarks(id) ON DELETE CASCADE
  );

  -- 12. Eval Suite Members
  CREATE TABLE IF NOT EXISTS eval_suite_members (
    eval_suite_id INTEGER NOT NULL,
    eval_case_id INTEGER NOT NULL,
    PRIMARY KEY (eval_suite_id, eval_case_id),
    FOREIGN KEY(eval_suite_id) REFERENCES eval_suites(id) ON DELETE CASCADE,
    FOREIGN KEY(eval_case_id) REFERENCES eval_cases(id) ON DELETE CASCADE
  );

  -- 13. Eval Runs
  CREATE TABLE IF NOT EXISTS eval_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    eval_suite_id INTEGER NOT NULL,
    harness_version_id INTEGER NOT NULL,
    run_id TEXT,
    status TEXT NOT NULL CHECK(status IN ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED')),
    metrics TEXT NOT NULL, -- JSON string
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    finished_at DATETIME,
    FOREIGN KEY(eval_suite_id) REFERENCES eval_suites(id) ON DELETE CASCADE,
    FOREIGN KEY(harness_version_id) REFERENCES harness_versions(id) ON DELETE CASCADE,
    FOREIGN KEY(run_id) REFERENCES runs(id) ON DELETE SET NULL
  );

  -- 14. Eval Results
  CREATE TABLE IF NOT EXISTS eval_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    eval_run_id INTEGER NOT NULL,
    eval_case_id INTEGER NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('PASS', 'FAIL', 'TIMEOUT', 'ERROR')),
    score REAL NOT NULL,
    raw_output TEXT, -- JSON string
    judge_metadata TEXT, -- JSON string
    FOREIGN KEY(eval_run_id) REFERENCES eval_runs(id) ON DELETE CASCADE,
    FOREIGN KEY(eval_case_id) REFERENCES eval_cases(id) ON DELETE CASCADE
  );

  -- 15. Experiments
  CREATE TABLE IF NOT EXISTS experiments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    benchmark_id INTEGER NOT NULL,
    base_harness_version_id INTEGER NOT NULL,
    target_description TEXT,
    config_template TEXT, -- JSON string
    regression_policy TEXT NOT NULL, -- JSON string
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(benchmark_id) REFERENCES benchmarks(id),
    FOREIGN KEY(base_harness_version_id) REFERENCES harness_versions(id)
  );

  -- 16. Experiment Targets
  CREATE TABLE IF NOT EXISTS experiment_targets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    experiment_id INTEGER NOT NULL,
    target_type TEXT NOT NULL CHECK(target_type IN ('FAILURE_MODE', 'EVAL_SUITE')),
    target_id INTEGER NOT NULL,
    desired_delta REAL NOT NULL,
    FOREIGN KEY(experiment_id) REFERENCES experiments(id) ON DELETE CASCADE
  );

  -- 17. Experiment Variants
  CREATE TABLE IF NOT EXISTS experiment_variants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    experiment_id INTEGER NOT NULL,
    harness_version_id INTEGER NOT NULL,
    variant_label TEXT NOT NULL,
    config_diff TEXT, -- JSON string
    exported_config_uri TEXT,
    status TEXT NOT NULL CHECK(status IN ('PLANNED', 'RUNNING', 'EVALUATED', 'PROMOTED', 'REJECTED')),
    FOREIGN KEY(experiment_id) REFERENCES experiments(id) ON DELETE CASCADE,
    FOREIGN KEY(harness_version_id) REFERENCES harness_versions(id) ON DELETE CASCADE
  );

  -- 18. Experiment Variant Eval Summaries
  CREATE TABLE IF NOT EXISTS experiment_variant_eval_summaries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    experiment_variant_id INTEGER NOT NULL,
    eval_suite_id INTEGER NOT NULL,
    baseline_eval_run_id INTEGER NOT NULL,
    variant_eval_run_id INTEGER NOT NULL,
    delta_pass_rate REAL NOT NULL,
    regression_flag INTEGER NOT NULL CHECK(regression_flag IN (0, 1)),
    FOREIGN KEY(experiment_variant_id) REFERENCES experiment_variants(id) ON DELETE CASCADE,
    FOREIGN KEY(eval_suite_id) REFERENCES eval_suites(id) ON DELETE CASCADE,
    FOREIGN KEY(baseline_eval_run_id) REFERENCES eval_runs(id),
    FOREIGN KEY(variant_eval_run_id) REFERENCES eval_runs(id)
  );

  -- Indexes for optimization
  CREATE INDEX IF NOT EXISTS idx_benchmark_tasks_bench_id ON benchmark_tasks(benchmark_id);
  CREATE INDEX IF NOT EXISTS idx_runs_bench_id ON runs(benchmark_id);
  CREATE INDEX IF NOT EXISTS idx_run_tasks_run_id ON run_tasks(run_id);
  CREATE INDEX IF NOT EXISTS idx_run_tasks_bt_id ON run_tasks(benchmark_task_id);
  CREATE INDEX IF NOT EXISTS idx_trace_steps_rt_id ON trace_steps(run_task_id);
  CREATE INDEX IF NOT EXISTS idx_failure_labels_rt_id ON failure_labels(run_task_id);
  CREATE INDEX IF NOT EXISTS idx_failure_mode_members_fl_id ON failure_mode_members(failure_label_id);
  CREATE INDEX IF NOT EXISTS idx_eval_suite_members_case_id ON eval_suite_members(eval_case_id);
  CREATE INDEX IF NOT EXISTS idx_eval_runs_suite_id ON eval_runs(eval_suite_id);
  CREATE INDEX IF NOT EXISTS idx_eval_results_run_id ON eval_results(eval_run_id);
  CREATE INDEX IF NOT EXISTS idx_experiment_variants_exp_id ON experiment_variants(experiment_id);
`);

export default db;
export { db };
