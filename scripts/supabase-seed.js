const Database = require('better-sqlite3');
const { Client } = require('pg');
const path = require('path');

const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) {
  console.error("Error: DATABASE_URL environment variable is missing.");
  console.error("Please run as:");
  console.error("  DATABASE_URL=\"postgresql://your-supabase-url\" node scripts/supabase-seed.js");
  process.exit(1);
}

const sqlitePath = path.join(process.cwd(), 'autoharness.db');
const sqliteDb = new Database(sqlitePath);
console.log("Opened local SQLite database:", sqlitePath);

const schemaSql = `
-- Drop existing tables if they exist
DROP TABLE IF EXISTS experiment_variant_eval_summaries CASCADE;
DROP TABLE IF EXISTS experiment_variants CASCADE;
DROP TABLE IF EXISTS experiment_targets CASCADE;
DROP TABLE IF EXISTS experiments CASCADE;
DROP TABLE IF EXISTS eval_results CASCADE;
DROP TABLE IF EXISTS eval_runs CASCADE;
DROP TABLE IF EXISTS eval_suite_members CASCADE;
DROP TABLE IF EXISTS eval_suites CASCADE;
DROP TABLE IF EXISTS eval_cases CASCADE;
DROP TABLE IF EXISTS failure_mode_members CASCADE;
DROP TABLE IF EXISTS failure_modes CASCADE;
DROP TABLE IF EXISTS failure_labels CASCADE;
DROP TABLE IF EXISTS trace_steps CASCADE;
DROP TABLE IF EXISTS run_tasks CASCADE;
DROP TABLE IF EXISTS runs CASCADE;
DROP TABLE IF EXISTS harness_versions CASCADE;
DROP TABLE IF EXISTS benchmark_tasks CASCADE;
DROP TABLE IF EXISTS benchmarks CASCADE;

-- 1. Benchmarks
CREATE TABLE benchmarks (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT,
  source_url TEXT
);

-- 2. Benchmark Tasks
CREATE TABLE benchmark_tasks (
  id SERIAL PRIMARY KEY,
  benchmark_id INTEGER NOT NULL REFERENCES benchmarks(id) ON DELETE CASCADE,
  task_id TEXT NOT NULL,
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  difficulty TEXT NOT NULL,
  metadata TEXT NOT NULL,
  UNIQUE(benchmark_id, task_id)
);

-- 3. Harness Versions
CREATE TABLE harness_versions (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  config TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  notes TEXT
);

-- 4. Runs
CREATE TABLE runs (
  id TEXT PRIMARY KEY,
  benchmark_id INTEGER NOT NULL REFERENCES benchmarks(id),
  agent_name TEXT NOT NULL,
  harness_version_id INTEGER REFERENCES harness_versions(id) ON DELETE SET NULL,
  run_label TEXT NOT NULL,
  metrics TEXT NOT NULL,
  raw_artifact_uri TEXT,
  global_score REAL DEFAULT 0.0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 5. Run Tasks
CREATE TABLE run_tasks (
  id SERIAL PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  benchmark_task_id INTEGER NOT NULL REFERENCES benchmark_tasks(id),
  status TEXT NOT NULL CHECK(status IN ('PASS', 'FAIL', 'TIMEOUT', 'ERROR', 'UNKNOWN')),
  score REAL NOT NULL,
  raw_result TEXT,
  started_at TIMESTAMP WITH TIME ZONE,
  finished_at TIMESTAMP WITH TIME ZONE
);

-- 6. Trace Steps
CREATE TABLE trace_steps (
  id SERIAL PRIMARY KEY,
  run_task_id INTEGER NOT NULL REFERENCES run_tasks(id) ON DELETE CASCADE,
  step_index INTEGER NOT NULL,
  step_type TEXT NOT NULL CHECK(step_type IN ('SYSTEM', 'USER', 'ASSISTANT', 'TOOL_CALL', 'TOOL_RESULT', 'COMMAND', 'LOG')),
  content TEXT NOT NULL,
  metadata TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 7. Failure Labels
CREATE TABLE failure_labels (
  id SERIAL PRIMARY KEY,
  run_task_id INTEGER NOT NULL UNIQUE REFERENCES run_tasks(id) ON DELETE CASCADE,
  is_failure INTEGER NOT NULL CHECK(is_failure IN (0, 1)),
  source TEXT NOT NULL CHECK(source IN ('BENCHMARK', 'LLM_JUDGE', 'MANUAL')),
  score REAL,
  diagnosis_text TEXT NOT NULL,
  taxonomy_primary TEXT NOT NULL CHECK(taxonomy_primary IN ('GAP', 'AMBIGUITY', 'TOOL_MISUSE', 'CODE_BUG', 'UPSTREAM', 'SAFETY', 'OTHER')),
  taxonomy_secondary TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 8. Failure Modes
CREATE TABLE failure_modes (
  id SERIAL PRIMARY KEY,
  benchmark_id INTEGER NOT NULL REFERENCES benchmarks(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  taxonomy_primary TEXT NOT NULL,
  embedding_centroid TEXT,
  stats TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 9. Failure Mode Members
CREATE TABLE failure_mode_members (
  failure_mode_id INTEGER NOT NULL REFERENCES failure_modes(id) ON DELETE CASCADE,
  failure_label_id INTEGER NOT NULL REFERENCES failure_labels(id) ON DELETE CASCADE,
  distance REAL DEFAULT 0.0,
  PRIMARY KEY (failure_mode_id, failure_label_id)
);

-- 10. Eval Cases
CREATE TABLE eval_cases (
  id SERIAL PRIMARY KEY,
  benchmark_task_id INTEGER REFERENCES benchmark_tasks(id) ON DELETE SET NULL,
  failure_label_id INTEGER REFERENCES failure_labels(id) ON DELETE SET NULL,
  input_spec TEXT NOT NULL,
  expected_spec TEXT NOT NULL,
  scoring_config TEXT,
  created_by TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 11. Eval Suites
CREATE TABLE eval_suites (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  benchmark_id INTEGER NOT NULL REFERENCES benchmarks(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 12. Eval Suite Members
CREATE TABLE eval_suite_members (
  eval_suite_id INTEGER NOT NULL REFERENCES eval_suites(id) ON DELETE CASCADE,
  eval_case_id INTEGER NOT NULL REFERENCES eval_cases(id) ON DELETE CASCADE,
  PRIMARY KEY (eval_suite_id, eval_case_id)
);

-- 13. Eval Runs
CREATE TABLE eval_runs (
  id SERIAL PRIMARY KEY,
  eval_suite_id INTEGER NOT NULL REFERENCES eval_suites(id) ON DELETE CASCADE,
  harness_version_id INTEGER NOT NULL REFERENCES harness_versions(id) ON DELETE CASCADE,
  run_id TEXT REFERENCES runs(id) ON DELETE SET NULL,
  status TEXT NOT NULL CHECK(status IN ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED')),
  metrics TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  finished_at TIMESTAMP WITH TIME ZONE
);

-- 14. Eval Results
CREATE TABLE eval_results (
  id SERIAL PRIMARY KEY,
  eval_run_id INTEGER NOT NULL REFERENCES eval_runs(id) ON DELETE CASCADE,
  eval_case_id INTEGER NOT NULL REFERENCES eval_cases(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK(status IN ('PASS', 'FAIL', 'TIMEOUT', 'ERROR')),
  score REAL NOT NULL,
  raw_output TEXT,
  judge_metadata TEXT
);

-- 15. Experiments
CREATE TABLE experiments (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  benchmark_id INTEGER NOT NULL REFERENCES benchmarks(id),
  base_harness_version_id INTEGER NOT NULL REFERENCES harness_versions(id),
  target_description TEXT,
  config_template TEXT,
  regression_policy TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 16. Experiment Targets
CREATE TABLE experiment_targets (
  id SERIAL PRIMARY KEY,
  experiment_id INTEGER NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK(target_type IN ('FAILURE_MODE', 'EVAL_SUITE')),
  target_id INTEGER NOT NULL,
  desired_delta REAL NOT NULL
);

-- 17. Experiment Variants
CREATE TABLE experiment_variants (
  id SERIAL PRIMARY KEY,
  experiment_id INTEGER NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
  harness_version_id INTEGER NOT NULL REFERENCES harness_versions(id) ON DELETE CASCADE,
  variant_label TEXT NOT NULL,
  config_diff TEXT,
  exported_config_uri TEXT,
  status TEXT NOT NULL CHECK(status IN ('PLANNED', 'RUNNING', 'EVALUATED', 'PROMOTED', 'REJECTED'))
);

-- 18. Experiment Variant Eval Summaries
CREATE TABLE experiment_variant_eval_summaries (
  id SERIAL PRIMARY KEY,
  experiment_variant_id INTEGER NOT NULL REFERENCES experiment_variants(id) ON DELETE CASCADE,
  eval_suite_id INTEGER NOT NULL REFERENCES eval_suites(id) ON DELETE CASCADE,
  baseline_eval_run_id INTEGER NOT NULL REFERENCES eval_runs(id),
  variant_eval_run_id INTEGER NOT NULL REFERENCES eval_runs(id),
  delta_pass_rate REAL NOT NULL,
  regression_flag INTEGER NOT NULL CHECK(regression_flag IN (0, 1))
);

-- Optimization Indexes
CREATE INDEX idx_benchmark_tasks_bench_id ON benchmark_tasks(benchmark_id);
CREATE INDEX idx_runs_bench_id ON runs(benchmark_id);
CREATE INDEX idx_run_tasks_run_id ON run_tasks(run_id);
CREATE INDEX idx_run_tasks_bt_id ON run_tasks(benchmark_task_id);
CREATE INDEX idx_trace_steps_rt_id ON trace_steps(run_task_id);
CREATE INDEX idx_failure_labels_rt_id ON failure_labels(run_task_id);
CREATE INDEX idx_failure_mode_members_fl_id ON failure_mode_members(failure_label_id);
CREATE INDEX idx_eval_suite_members_case_id ON eval_suite_members(eval_case_id);
CREATE INDEX idx_eval_runs_suite_id ON eval_runs(eval_suite_id);
CREATE INDEX idx_eval_results_run_id ON eval_results(eval_run_id);
CREATE INDEX idx_experiment_variants_exp_id ON experiment_variants(experiment_id);
`;

const tablesToSync = [
  'benchmarks',
  'harness_versions',
  'benchmark_tasks',
  'runs',
  'run_tasks',
  'trace_steps',
  'failure_labels',
  'failure_modes',
  'failure_mode_members',
  'eval_cases',
  'eval_suites',
  'eval_suite_members',
  'eval_runs',
  'eval_results',
  'experiments',
  'experiment_targets',
  'experiment_variants',
  'experiment_variant_eval_summaries'
];

async function migrate() {
  const pgClient = new Client({
    connectionString: dbUrl,
    ssl: { rejectUnauthorized: false }
  });

  try {
    await pgClient.connect();
    console.log("Connected to Supabase/Postgres.");

    console.log("Creating database schema and dropping old tables...");
    await pgClient.query(schemaSql);
    console.log("Schema successfully created.");

    for (const table of tablesToSync) {
      console.log(`Reading table '${table}' from SQLite...`);
      const rows = sqliteDb.prepare(`SELECT * FROM ${table}`).all();

      if (rows.length === 0) {
        console.log(`Table '${table}' is empty. Skipping.`);
        continue;
      }

      console.log(`Syncing ${rows.length} rows to Postgres...`);
      const columns = Object.keys(rows[0]);
      const colNames = columns.join(', ');
      const placeholders = columns.map((_, i) => '$' + (i + 1)).join(', ');
      const insertQuery = `INSERT INTO ${table} (${colNames}) VALUES (${placeholders})`;

      for (const row of rows) {
        const params = columns.map(col => row[col]);
        await pgClient.query(insertQuery, params);
      }
      console.log(`Synced '${table}' successfully.`);
    }

    // Sync serial values
    const serialTables = [
      'benchmarks',
      'benchmark_tasks',
      'harness_versions',
      'run_tasks',
      'trace_steps',
      'failure_labels',
      'failure_modes',
      'eval_cases',
      'eval_suites',
      'eval_runs',
      'eval_results',
      'experiments',
      'experiment_targets',
      'experiment_variants',
      'experiment_variant_eval_summaries'
    ];

    console.log("Synchronizing Postgres identity sequences...");
    for (const table of serialTables) {
      try {
        await pgClient.query(`SELECT setval(pg_get_serial_sequence('${table}', 'id'), coalesce(max(id), 1)) FROM ${table}`);
      } catch (seqErr) {
        // Some tables might not have id sequences, warn but proceed
        console.warn(`Sequence note for '${table}':`, seqErr.message);
      }
    }

    console.log("Migration completed successfully!");

  } catch (err) {
    console.error("Migration failed:", err);
  } finally {
    await pgClient.end();
    sqliteDb.close();
  }
}

migrate();
