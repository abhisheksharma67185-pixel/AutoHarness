const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = path.resolve(__dirname, '../autoharness.db');
const PUBLIC_DIR = path.resolve(__dirname, '../public/demo/runs');

// Ensure public directories exist
fs.mkdirSync(PUBLIC_DIR, { recursive: true });

// 1. Define base tasks metadata
const TASKS_DATA = [
  {
    task_id: 'tb-task-01',
    slug: 'nginx-port-clash',
    category: 'Web Administration',
    difficulty: 'Medium',
    description: 'Find why nginx fails to start on the target container, resolve any port binding clashes, and start the service.'
  },
  {
    task_id: 'tb-task-02',
    slug: 'git-rebase-conflict',
    category: 'Version Control',
    difficulty: 'Hard',
    description: 'Run git rebase origin/main on the feature branch, resolve any conflict markers inside lib/core.py, and finish the rebase.'
  },
  {
    task_id: 'tb-task-03',
    slug: 'parse-server-logs',
    category: 'Data Processing',
    difficulty: 'Easy',
    description: 'Write a script or pipeline to extract all HTTP 500 error logs from /var/log/nginx/access.log, group them by path, and save to /tmp/report.json.'
  },
  {
    task_id: 'tb-task-04',
    slug: 'db-migration-failure',
    category: 'Database Management',
    difficulty: 'Hard',
    description: 'Run the Alembic database migrations. Identify why migration 4fa2bc fails, edit the migration code to fix the column type mismatch, and run it again.'
  },
  {
    task_id: 'tb-task-05',
    slug: 'docker-build-missing-dep',
    category: 'DevOps',
    difficulty: 'Medium',
    description: 'Build the local docker image from Dockerfile. If packages are missing during the build phase, update the docker file to install them beforehand.'
  },
  {
    task_id: 'tb-task-06',
    slug: 'fetch-api-timeout',
    category: 'Network Operations',
    difficulty: 'Easy',
    description: 'Query the internal service API at http://10.0.5.11:8080/health, check if it is active, and configure automatic retries.'
  },
  {
    task_id: 'tb-task-07',
    slug: 'restricted-sudo-write',
    category: 'Security',
    difficulty: 'Medium',
    description: 'Verify the integrity of /etc/hosts and add a new hostname mapping pointing local.dev to 127.0.0.1.'
  },
  {
    task_id: 'tb-task-08',
    slug: 'disk-cleanup-logs',
    category: 'System Diagnostics',
    difficulty: 'Easy',
    description: 'Locate logs taking up excessive space under /var/log and clear rotated files ending in .gz older than 7 days.'
  },
  {
    task_id: 'tb-task-09',
    slug: 'backup-config-ambiguity',
    category: 'Configuration Management',
    difficulty: 'Medium',
    description: 'Locate the backup configuration file in the project, set backup_interval to 3600, and save it.'
  },
  {
    task_id: 'tb-task-10',
    slug: 'cron-job-setup',
    category: 'System Diagnostics',
    difficulty: 'Easy',
    description: 'Configure a cron job that executes /usr/local/bin/cleanup.sh every night at 2:00 AM and forwards logs.'
  }
];

// 2. Generate RUN 1 (Baseline - 40% pass rate)
const RUN1_DATA = {
  run_id: 'run-tb2-baseline',
  metadata: {
    benchmark: 'Terminal-Bench 2.0',
    benchmark_slug: 'terminal_bench_2',
    benchmark_description: 'Terminal operations benchmark for command-line agent evaluation.',
    agent: 'SigmaAgent v1.2',
    harness_version: 'v1.0.0',
    run_label: 'Baseline Ingestion Run',
    raw_artifact_uri: 'public/demo/runs/baseline.json'
  },
  tasks: [
    {
      ...TASKS_DATA[0],
      success: true,
      score: 1.0,
      steps: [
        { step_index: 0, type: 'agent', content: 'I need to check why nginx fails to start. I will run systemctl status nginx.' },
        { step_index: 1, type: 'tool_call', content: 'systemctl status nginx' },
        { step_index: 2, type: 'tool_output', output: 'nginx.service - A high performance web server and reverse proxy\nActive: failed\nError: bind() to 0.0.0.0:80 failed (Address already in use)' },
        { step_index: 3, type: 'agent', content: 'Ah, port 80 is already in use. Let me check what process is binding port 80.' },
        { step_index: 4, type: 'tool_call', content: 'ss -tulpn | grep :80' },
        { step_index: 5, type: 'tool_output', output: 'tcp   LISTEN 0      511          0.0.0.0:80        0.0.0.0:*      users:(("apache2",pid=912,fd=4))' },
        { step_index: 6, type: 'agent', content: 'Apache is running on port 80. I will stop apache2 and start nginx.' },
        { step_index: 7, type: 'tool_call', content: 'systemctl stop apache2 && systemctl start nginx' },
        { step_index: 8, type: 'tool_output', output: 'Stopping apache2... Done\nStarting nginx... Done' },
        { step_index: 9, type: 'agent', content: 'Nginx started successfully. Task complete!' }
      ]
    },
    {
      ...TASKS_DATA[1],
      success: false,
      score: 0.0,
      steps: [
        { step_index: 0, type: 'agent', content: 'I will start the git rebase.' },
        { step_index: 1, type: 'tool_call', content: 'git rebase origin/main' },
        { step_index: 2, type: 'tool_output', output: 'CONFLICT (content): Merge conflict in lib/core.py\nResolve all conflicts manually.' },
        { step_index: 3, type: 'agent', content: 'Let me view conflict markers.' },
        { step_index: 4, type: 'tool_call', content: 'cat lib/core.py' },
        { step_index: 5, type: 'tool_output', output: '<<<<<<< HEAD\ndef get_score(self):\n    return self.score * 100\n=======\ndef get_score(self):\n    return self.base_score + self.delta\n>>>>>>> feature/scores' },
        { step_index: 6, type: 'agent', content: 'I need to edit this file. I will use the edit tool but with wrong parameters.' },
        { step_index: 7, type: 'tool_call', content: 'replace_in_file "lib/core.py" "<<<<<<< HEAD" "def get_score(self):\n    return self.base_score + self.delta"' },
        { step_index: 8, type: 'tool_output', output: 'Error: Cannot find substring. The replace command is missing end line block constraints.' },
        { step_index: 9, type: 'agent', content: 'Oops. I will try running git rebase --abort.' },
        { step_index: 10, type: 'tool_call', content: 'git rebase --abort' },
        { step_index: 11, type: 'tool_output', output: 'Rebase aborted.' }
      ]
    },
    {
      ...TASKS_DATA[2],
      success: true,
      score: 1.0,
      steps: [
        { step_index: 0, type: 'agent', content: 'I will search for HTTP 500 error lines in the logs.' },
        { step_index: 1, type: 'tool_call', content: 'awk \'$9 == 500 {print $7}\' /var/log/nginx/access.log | sort | uniq -c' },
        { step_index: 2, type: 'tool_output', output: '  12 /api/v1/users\n  45 /api/v1/auth/login' },
        { step_index: 3, type: 'agent', content: 'Great, now I will format this as a JSON file.' },
        { step_index: 4, type: 'tool_call', content: 'echo \'{"/api/v1/users": 12, "/api/v1/auth/login": 45}\' > /tmp/report.json' },
        { step_index: 5, type: 'tool_output', output: '' },
        { step_index: 6, type: 'agent', content: 'Report generated successfully.' }
      ]
    },
    {
      ...TASKS_DATA[3],
      success: false,
      score: 0.0,
      steps: [
        { step_index: 0, type: 'agent', content: 'I will run alembic migrations.' },
        { step_index: 1, type: 'tool_call', content: 'alembic upgrade head' },
        { step_index: 2, type: 'tool_output', output: 'Traceback (most recent call last):\n  File "alembic/versions/4fa2bc_migration.py", line 22, in upgrade\n    op.alter_column(\'orders\', \'price\', type_=sa.Integer())\nTypeError: alter_column() missing required argument "existing_type"' },
        { step_index: 3, type: 'agent', content: 'Ah, the python Alembic script itself crashed due to a TypeError.' }
      ]
    },
    {
      ...TASKS_DATA[4],
      success: false,
      score: 0.0,
      steps: [
        { step_index: 0, type: 'agent', content: 'I will try to build the Docker image.' },
        { step_index: 1, type: 'tool_call', content: 'docker build -t app:latest .' },
        { step_index: 2, type: 'tool_output', output: 'sh: docker: command not found' }
      ]
    },
    {
      ...TASKS_DATA[5],
      success: false,
      score: 0.0,
      steps: [
        { step_index: 0, type: 'agent', content: 'I will check connection to http://10.0.5.11:8080/health.' },
        { step_index: 1, type: 'tool_call', content: 'curl -I http://10.0.5.11:8080/health' },
        { step_index: 2, type: 'tool_output', output: 'curl: (7) Failed to connect to 10.0.5.11 port 8080: Connection timed out' }
      ]
    },
    {
      ...TASKS_DATA[6],
      success: false,
      score: 0.0,
      steps: [
        { step_index: 0, type: 'agent', content: 'I will append a line to /etc/hosts.' },
        { step_index: 1, type: 'tool_call', content: 'echo "127.0.0.1 local.dev" >> /etc/hosts' },
        { step_index: 2, type: 'tool_output', output: 'sh: /etc/hosts: Permission denied' }
      ]
    },
    {
      ...TASKS_DATA[7],
      success: true,
      score: 1.0,
      steps: [
        { step_index: 0, type: 'agent', content: 'Let me find .gz logs.' },
        { step_index: 1, type: 'tool_call', content: 'find /var/log -name "*.gz" -delete' }
      ]
    },
    {
      ...TASKS_DATA[8],
      success: false,
      score: 0.0,
      steps: [
        { step_index: 0, type: 'agent', content: 'I need to locate the backup configuration.' },
        { step_index: 1, type: 'tool_call', content: 'find . -name "*backup*"' },
        { step_index: 2, type: 'tool_output', output: './config/backup.yaml\n./config/backup-prod.json' },
        { step_index: 3, type: 'agent', content: 'Multiple backup files. I will update backup.yaml only.' },
        { step_index: 4, type: 'tool_call', content: 'echo "backup_interval: 3600" >> ./config/backup.yaml' }
      ]
    },
    {
      ...TASKS_DATA[9],
      success: true,
      score: 1.0,
      steps: [
        { step_index: 0, type: 'agent', content: 'Let me write the cron job.' },
        { step_index: 1, type: 'tool_call', content: 'crontab -l 2>/dev/null; echo "0 2 * * * /usr/local/bin/cleanup.sh"' }
      ]
    }
  ]
};

// 3. Generate RUN 2 (Improved - 80% pass rate)
const RUN2_DATA = {
  run_id: 'run-tb2-variant-1',
  metadata: {
    benchmark: 'Terminal-Bench 2.0',
    benchmark_slug: 'terminal_bench_2',
    benchmark_description: 'Terminal operations benchmark for command-line agent evaluation.',
    agent: 'SigmaAgent v1.2',
    harness_version: 'v1.0.0-var-1',
    run_label: 'Harness Experiment Candidate 1 Run',
    raw_artifact_uri: 'public/demo/runs/improved.json'
  },
  tasks: [
    {
      ...TASKS_DATA[0],
      success: true,
      score: 1.0,
      steps: [
        { step_index: 0, type: 'agent', content: 'Check nginx.' },
        { step_index: 1, type: 'tool_call', content: 'systemctl stop apache2 && systemctl start nginx' },
        { step_index: 2, type: 'tool_output', output: 'Stopping apache2... Done\nStarting nginx... Done' }
      ]
    },
    {
      ...TASKS_DATA[1],
      success: true,
      score: 1.0,
      steps: [
        { step_index: 0, type: 'agent', content: 'Start git rebase.' },
        { step_index: 1, type: 'tool_call', content: 'git rebase origin/main' },
        { step_index: 2, type: 'tool_output', output: 'CONFLICT in lib/core.py...' },
        { step_index: 3, type: 'agent', content: 'Pick correct rebase branch.' },
        { step_index: 4, type: 'tool_call', content: 'echo "def get_score(self):\n    return self.base_score + self.delta" > lib/core.py' },
        { step_index: 5, type: 'tool_output', output: '' },
        { step_index: 6, type: 'tool_call', content: 'git add lib/core.py && git rebase --continue' },
        { step_index: 7, type: 'tool_output', output: 'Successfully rebased.' }
      ]
    },
    {
      ...TASKS_DATA[2],
      success: true,
      score: 1.0,
      steps: [
        { step_index: 0, type: 'agent', content: 'Writing report logs.' },
        { step_index: 1, type: 'tool_call', content: 'echo \'{"/api/v1/users": 12}\' > /tmp/report.json' }
      ]
    },
    {
      ...TASKS_DATA[3],
      success: true,
      score: 1.0,
      steps: [
        { step_index: 0, type: 'agent', content: 'Fix migration.' },
        { step_index: 1, type: 'tool_call', content: 'sed -i "" "s/op.alter_column(\'orders\', \'price\', type_=sa.Integer())/op.alter_column(\'orders\', \'price\', type_=sa.Integer(), existing_type=sa.String())/g" alembic/versions/4fa2bc_migration.py' },
        { step_index: 2, type: 'tool_output', output: '' },
        { step_index: 3, type: 'tool_call', content: 'alembic upgrade head' },
        { step_index: 4, type: 'tool_output', output: 'Migration successful.' }
      ]
    },
    {
      ...TASKS_DATA[4],
      success: false,
      score: 0.0,
      steps: [
        { step_index: 0, type: 'agent', content: 'Running docker build.' },
        { step_index: 1, type: 'tool_call', content: 'docker build -t app:latest .' },
        { step_index: 2, type: 'tool_output', output: 'sh: docker: command not found' }
      ]
    },
    {
      ...TASKS_DATA[5],
      success: true,
      score: 1.0,
      steps: [
        { step_index: 0, type: 'agent', content: 'Query endpoint.' },
        { step_index: 1, type: 'tool_call', content: 'curl -I http://10.0.5.11:8080/health' },
        { step_index: 2, type: 'tool_output', output: 'HTTP/1.1 200 OK' }
      ]
    },
    {
      ...TASKS_DATA[6],
      success: false,
      score: 0.0,
      steps: [
        { step_index: 0, type: 'agent', content: 'Try writing hosts file.' },
        { step_index: 1, type: 'tool_call', content: 'echo "127.0.0.1 local.dev" >> /etc/hosts' },
        { step_index: 2, type: 'tool_output', output: 'Permission denied' }
      ]
    },
    {
      ...TASKS_DATA[7],
      success: true,
      score: 1.0,
      steps: [
        { step_index: 0, type: 'agent', content: 'Delete old logs.' },
        { step_index: 1, type: 'tool_call', content: 'find /var/log -name "*.gz" -delete' }
      ]
    },
    {
      ...TASKS_DATA[8],
      success: true,
      score: 1.0,
      steps: [
        { step_index: 0, type: 'agent', content: 'Update configs to solve ambiguity.' },
        { step_index: 1, type: 'tool_call', content: 'echo "backup_interval: 3600" >> ./config/backup.yaml' },
        { step_index: 2, type: 'tool_output', output: '' },
        { step_index: 3, type: 'tool_call', content: 'echo \'{"backup_interval": 3600}\' > ./config/backup-prod.json' },
        { step_index: 4, type: 'tool_output', output: '' }
      ]
    },
    {
      ...TASKS_DATA[9],
      success: true,
      score: 1.0,
      steps: [
        { step_index: 0, type: 'agent', content: 'Register cron.' },
        { step_index: 1, type: 'tool_call', content: 'crontab -l' }
      ]
    }
  ]
};

// Write files to public disk folder
fs.writeFileSync(path.join(PUBLIC_DIR, 'baseline.json'), JSON.stringify(RUN1_DATA, null, 2));
fs.writeFileSync(path.join(PUBLIC_DIR, 'improved.json'), JSON.stringify(RUN2_DATA, null, 2));
console.log('Successfully wrote sample run JSON files to public directory.');

console.log('Seeding SQLite database with logical Postgres schema tables...');
const db = new Database(DB_PATH);
db.pragma('foreign_keys = ON');

// Initialize schema FIRST
db.exec(`
  PRAGMA foreign_keys = OFF;

  DROP TABLE IF EXISTS experiment_variant_eval_summaries;
  DROP TABLE IF EXISTS experiment_variants;
  DROP TABLE IF EXISTS experiment_targets;
  DROP TABLE IF EXISTS experiments;
  DROP TABLE IF EXISTS eval_results;
  DROP TABLE IF EXISTS eval_runs;
  DROP TABLE IF EXISTS eval_suite_members;
  DROP TABLE IF EXISTS eval_suites;
  DROP TABLE IF EXISTS eval_cases;
  DROP TABLE IF EXISTS failure_mode_members;
  DROP TABLE IF EXISTS failure_modes;
  DROP TABLE IF EXISTS failure_labels;
  DROP TABLE IF EXISTS trace_steps;
  DROP TABLE IF EXISTS run_tasks;
  DROP TABLE IF EXISTS runs;
  DROP TABLE IF EXISTS harness_versions;
  DROP TABLE IF EXISTS benchmark_tasks;
  DROP TABLE IF EXISTS benchmarks;

  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS benchmarks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    description TEXT,
    source_url TEXT
  );

  CREATE TABLE IF NOT EXISTS benchmark_tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    benchmark_id INTEGER NOT NULL,
    task_id TEXT NOT NULL,
    title TEXT NOT NULL,
    category TEXT NOT NULL,
    difficulty TEXT NOT NULL,
    metadata TEXT NOT NULL,
    FOREIGN KEY(benchmark_id) REFERENCES benchmarks(id) ON DELETE CASCADE,
    UNIQUE(benchmark_id, task_id)
  );

  CREATE TABLE IF NOT EXISTS harness_versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    config TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    notes TEXT
  );

  CREATE TABLE IF NOT EXISTS runs (
    id TEXT PRIMARY KEY,
    benchmark_id INTEGER NOT NULL,
    agent_name TEXT NOT NULL,
    harness_version_id INTEGER,
    run_label TEXT NOT NULL,
    metrics TEXT NOT NULL,
    raw_artifact_uri TEXT,
    global_score REAL DEFAULT 0.0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(benchmark_id) REFERENCES benchmarks(id),
    FOREIGN KEY(harness_version_id) REFERENCES harness_versions(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS run_tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT NOT NULL,
    benchmark_task_id INTEGER NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('PASS', 'FAIL', 'TIMEOUT', 'ERROR', 'UNKNOWN')),
    score REAL NOT NULL,
    raw_result TEXT,
    started_at DATETIME,
    finished_at DATETIME,
    FOREIGN KEY(run_id) REFERENCES runs(id) ON DELETE CASCADE,
    FOREIGN KEY(benchmark_task_id) REFERENCES benchmark_tasks(id)
  );

  CREATE TABLE IF NOT EXISTS trace_steps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_task_id INTEGER NOT NULL,
    step_index INTEGER NOT NULL,
    step_type TEXT NOT NULL CHECK(step_type IN ('SYSTEM', 'USER', 'ASSISTANT', 'TOOL_CALL', 'TOOL_RESULT', 'COMMAND', 'LOG')),
    content TEXT NOT NULL,
    metadata TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(run_task_id) REFERENCES run_tasks(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS failure_labels (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_task_id INTEGER NOT NULL UNIQUE,
    is_failure INTEGER NOT NULL CHECK(is_failure IN (0, 1)),
    source TEXT NOT NULL CHECK(source IN ('BENCHMARK', 'LLM_JUDGE', 'MANUAL')),
    score REAL,
    diagnosis_text TEXT NOT NULL,
    taxonomy_primary TEXT NOT NULL CHECK(taxonomy_primary IN ('GAP', 'AMBIGUITY', 'TOOL_MISUSE', 'CODE_BUG', 'UPSTREAM', 'SAFETY', 'OTHER')),
    taxonomy_secondary TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(run_task_id) REFERENCES run_tasks(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS failure_modes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    benchmark_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    taxonomy_primary TEXT NOT NULL,
    embedding_centroid TEXT,
    stats TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(benchmark_id) REFERENCES benchmarks(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS failure_mode_members (
    failure_mode_id INTEGER NOT NULL,
    failure_label_id INTEGER NOT NULL,
    distance REAL DEFAULT 0.0,
    PRIMARY KEY (failure_mode_id, failure_label_id),
    FOREIGN KEY(failure_mode_id) REFERENCES failure_modes(id) ON DELETE CASCADE,
    FOREIGN KEY(failure_label_id) REFERENCES failure_labels(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS eval_cases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    benchmark_task_id INTEGER,
    failure_label_id INTEGER,
    input_spec TEXT NOT NULL,
    expected_spec TEXT NOT NULL,
    scoring_config TEXT,
    created_by TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(benchmark_task_id) REFERENCES benchmark_tasks(id) ON DELETE SET NULL,
    FOREIGN KEY(failure_label_id) REFERENCES failure_labels(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS eval_suites (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    benchmark_id INTEGER NOT NULL,
    description TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(benchmark_id) REFERENCES benchmarks(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS eval_suite_members (
    eval_suite_id INTEGER NOT NULL,
    eval_case_id INTEGER NOT NULL,
    PRIMARY KEY (eval_suite_id, eval_case_id),
    FOREIGN KEY(eval_suite_id) REFERENCES eval_suites(id) ON DELETE CASCADE,
    FOREIGN KEY(eval_case_id) REFERENCES eval_cases(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS eval_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    eval_suite_id INTEGER NOT NULL,
    harness_version_id INTEGER NOT NULL,
    run_id TEXT,
    status TEXT NOT NULL CHECK(status IN ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED')),
    metrics TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    finished_at DATETIME,
    FOREIGN KEY(eval_suite_id) REFERENCES eval_suites(id) ON DELETE CASCADE,
    FOREIGN KEY(harness_version_id) REFERENCES harness_versions(id) ON DELETE CASCADE,
    FOREIGN KEY(run_id) REFERENCES runs(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS eval_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    eval_run_id INTEGER NOT NULL,
    eval_case_id INTEGER NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('PASS', 'FAIL', 'TIMEOUT', 'ERROR')),
    score REAL NOT NULL,
    raw_output TEXT,
    judge_metadata TEXT,
    FOREIGN KEY(eval_run_id) REFERENCES eval_runs(id) ON DELETE CASCADE,
    FOREIGN KEY(eval_case_id) REFERENCES eval_cases(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS experiments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    benchmark_id INTEGER NOT NULL,
    base_harness_version_id INTEGER NOT NULL,
    target_description TEXT,
    config_template TEXT,
    regression_policy TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(benchmark_id) REFERENCES benchmarks(id),
    FOREIGN KEY(base_harness_version_id) REFERENCES harness_versions(id)
  );

  CREATE TABLE IF NOT EXISTS experiment_targets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    experiment_id INTEGER NOT NULL,
    target_type TEXT NOT NULL CHECK(target_type IN ('FAILURE_MODE', 'EVAL_SUITE')),
    target_id INTEGER NOT NULL,
    desired_delta REAL NOT NULL,
    FOREIGN KEY(experiment_id) REFERENCES experiments(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS experiment_variants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    experiment_id INTEGER NOT NULL,
    harness_version_id INTEGER NOT NULL,
    variant_label TEXT NOT NULL,
    config_diff TEXT,
    exported_config_uri TEXT,
    status TEXT NOT NULL CHECK(status IN ('PLANNED', 'RUNNING', 'EVALUATED', 'PROMOTED', 'REJECTED')),
    FOREIGN KEY(experiment_id) REFERENCES experiments(id) ON DELETE CASCADE,
    FOREIGN KEY(harness_version_id) REFERENCES harness_versions(id) ON DELETE CASCADE
  );

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
`);

// 1. Seed standard benchmarks
db.prepare(`
  INSERT OR REPLACE INTO benchmarks (id, name, slug, description, source_url)
  VALUES (1, 'Terminal-Bench 2.0', 'terminal_bench_2', 'Terminal operations benchmark for command-line agent evaluation.', 'https://github.com/neosigma/terminal-bench')
`).run();

// 2. Seed static harness versions
db.prepare(`
  INSERT OR REPLACE INTO harness_versions (id, name, config, notes)
  VALUES (1, 'v1.0.0', '{"agent_model": "SigmaAgent", "temperature": 0.4}', 'Baseline harness release')
`).run();
db.prepare(`
  INSERT OR REPLACE INTO harness_versions (id, name, config, notes)
  VALUES (2, 'v1.0.0-var-1', '{"agent_model": "SigmaAgent", "temperature": 0.1, "system_prompt_patch": "Pre-flight commands validations enabled"}', 'Variant proposed fix 1')
`).run();

// 3. Ingestion seeding helper
function seedRun(payload, harnessVersionId) {
  const { run_id, metadata, tasks } = payload;
  
  db.prepare('DELETE FROM runs WHERE id = ?').run(run_id);
  
  const insertTask = db.prepare(`
    INSERT OR IGNORE INTO benchmark_tasks (benchmark_id, task_id, title, category, difficulty, metadata)
    VALUES (1, ?, ?, ?, ?, ?)
  `);
  
  const insertRunTask = db.prepare(`
    INSERT INTO run_tasks (run_id, benchmark_task_id, status, score, raw_result)
    VALUES (?, ?, ?, ?, '{}')
  `);
  
  const insertStep = db.prepare(`
    INSERT INTO trace_steps (run_task_id, step_index, step_type, content, metadata)
    VALUES (?, ?, ?, ?, '{}')
  `);
  
  const insertFailureLabel = db.prepare(`
    INSERT INTO failure_labels (run_task_id, is_failure, source, score, diagnosis_text, taxonomy_primary, taxonomy_secondary)
    VALUES (?, 1, 'BENCHMARK', NULL, ?, ?, '[]')
  `);

  db.prepare(`
    INSERT INTO runs (id, benchmark_id, agent_name, harness_version_id, run_label, metrics, raw_artifact_uri)
    VALUES (?, 1, ?, ?, ?, '{}', ?)
  `).run(run_id, metadata.agent, harnessVersionId, metadata.run_label || 'Harness Run', metadata.raw_artifact_uri || '');

  let passed = 0;
  let scoreSum = 0;
  const categories = {};
  const taxonomyDist = {};

  tasks.forEach(t => {
    insertTask.run(t.task_id, t.slug, t.category, t.difficulty, JSON.stringify({ description: t.description }));
    
    const taskRecord = db.prepare('SELECT id FROM benchmark_tasks WHERE benchmark_id = 1 AND task_id = ?').get(t.task_id);
    const benchmarkTaskId = taskRecord.id;

    const status = (t.success || t.score >= 1.0) ? 'PASS' : 'FAIL';
    if (status === 'PASS') passed++;
    scoreSum += t.score;
    
    if (!categories[t.category]) categories[t.category] = { sum: 0, count: 0 };
    categories[t.category].sum += t.score;
    categories[t.category].count += 1;

    const runTaskResult = insertRunTask.run(run_id, benchmarkTaskId, status, t.score);
    const runTaskId = runTaskResult.lastInsertRowid;

    t.steps.forEach(s => {
      let stepType = 'LOG';
      if (s.type === 'agent') stepType = 'ASSISTANT';
      else if (s.type === 'user') stepType = 'USER';
      else if (s.type === 'system') stepType = 'SYSTEM';
      else if (s.type === 'tool_call' || s.type === 'command') stepType = 'TOOL_CALL';
      else if (s.type === 'tool_output' || s.type === 'stdout' || s.type === 'stderr') stepType = 'TOOL_RESULT';

      insertStep.run(runTaskId, s.step_index, stepType, s.content || s.output || '');
    });

    if (status === 'FAIL') {
      let taxonomy = 'TOOL_MISUSE';
      let diagnosis = 'Tool parameter syntax error occurred during execution.';

      if (t.task_id === 'tb-task-02') {
        taxonomy = 'TOOL_MISUSE';
        diagnosis = 'Agent called git replace_in_file with wrong parameter block bounds.';
      } else if (t.task_id === 'tb-task-04') {
        taxonomy = 'CODE_BUG';
        diagnosis = 'Alembic migration script crashed with TypeError: alter_column() missing existing_type.';
      } else if (t.task_id === 'tb-task-05') {
        taxonomy = 'GAP';
        diagnosis = 'System is missing the docker command executable; docker build is not supported.';
      } else if (t.task_id === 'tb-task-06') {
        taxonomy = 'UPSTREAM';
        diagnosis = 'Target IP 10.0.5.11 did not respond; connection timed out.';
      } else if (t.task_id === 'tb-task-07') {
        taxonomy = 'SAFETY';
        diagnosis = 'Writing to /etc/hosts failed due to blocked sudo command permissions.';
      } else if (t.task_id === 'tb-task-09') {
        taxonomy = 'AMBIGUITY';
        diagnosis = 'Multiple backup configurations existed; agent edited backup.yaml instead of backup-prod.json.';
      }

      insertFailureLabel.run(runTaskId, diagnosis, taxonomy);
      taxonomyDist[taxonomy] = (taxonomyDist[taxonomy] || 0) + 1;
    }
  });

  const total = tasks.length;
  const passRate = total > 0 ? passed / total : 0;
  
  const categoryAverages = {};
  for (const [c, d] of Object.entries(categories)) {
    categoryAverages[c] = d.sum / d.count;
  }

  const metrics = {
    total_tasks: total,
    passed_tasks: passed,
    failed_tasks: total - passed,
    pass_rate: passRate,
    avg_score: total > 0 ? scoreSum / total : 0,
    category_scores: categoryAverages,
    taxonomy_distribution: taxonomyDist
  };

  db.prepare('UPDATE runs SET global_score = ?, metrics = ? WHERE id = ?')
    .run(passRate, JSON.stringify(metrics), run_id);

  if (run_id === 'run-tb2-baseline') {
    const fModes = [
      { id: 1, title: 'Git Rebase and File Conflict Failures', desc: 'Errors resolving merge conflicts in file markers, including syntax bounds checks.', tax: 'TOOL_MISUSE' },
      { id: 2, title: 'Python alembic TypeError Exceptions', desc: 'Indentation, missing arguments, or runtime syntax exceptions in Alembic python migration scripts.', tax: 'CODE_BUG' },
      { id: 3, title: 'Docker CLI Utility Capability Gap', desc: 'Missing docker package in environment, preventing execution of builds and container orchestration.', tax: 'GAP' },
      { id: 4, title: 'Upstream connection timeouts', desc: 'Connection timed out trying to reach internal endpoints or database hosts.', tax: 'UPSTREAM' },
      { id: 5, title: 'Blocked system config updates', desc: 'Host permission denied writing to /etc/hosts due to security/sudo policy blocks.', tax: 'SAFETY' },
      { id: 6, title: 'Ambiguous config file targets', desc: 'Multiple candidate files matched the instructions, leading the agent to update local instead of production configuration.', tax: 'AMBIGUITY' }
    ];

    fModes.forEach((fm) => {
      db.prepare('INSERT OR REPLACE INTO failure_modes (id, benchmark_id, name, description, taxonomy_primary) VALUES (?, 1, ?, ?, ?)')
        .run(fm.id, fm.title, fm.desc, fm.tax);
    });

    const tasksMapping = {
      'tb-task-02': 1,
      'tb-task-04': 2,
      'tb-task-05': 3,
      'tb-task-06': 4,
      'tb-task-07': 5,
      'tb-task-09': 6
    };

    Object.entries(tasksMapping).forEach(([taskId, modeId]) => {
      const labelRow = db.prepare(`
        SELECT fl.id
        FROM failure_labels fl
        JOIN run_tasks rt ON fl.run_task_id = rt.id
        JOIN benchmark_tasks bt ON rt.benchmark_task_id = bt.id
        WHERE rt.run_id = 'run-tb2-baseline' AND bt.task_id = ?
      `).get(taskId);

      if (labelRow) {
        db.prepare('INSERT OR REPLACE INTO failure_mode_members (failure_mode_id, failure_label_id) VALUES (?, ?)')
          .run(modeId, labelRow.id);
      }
    });
  }
}

seedRun(RUN1_DATA, 1);
seedRun(RUN2_DATA, 2);

// Seed basic Eval Suite
db.prepare("INSERT OR IGNORE INTO eval_suites (id, name, benchmark_id, description) VALUES (1, 'Filesystem & Permission Regressions', 1, 'Validates that the agent can execute commands safely without triggering sudo locks or writing in restricted directories.')")
  .run();
db.prepare("INSERT OR IGNORE INTO eval_suites (id, name, benchmark_id, description) VALUES (2, 'Conflict Resolution & Git Files', 1, 'Evaluates agent proficiency rebasing code branches and fixing merge conflicts.')")
  .run();

// Promote a case to the filesystem suite
const labelRow = db.prepare(`
  SELECT fl.id, rt.benchmark_task_id
  FROM failure_labels fl
  JOIN run_tasks rt ON fl.run_task_id = rt.id
  JOIN benchmark_tasks bt ON rt.benchmark_task_id = bt.id
  WHERE rt.run_id = 'run-tb2-baseline' AND bt.task_id = 'tb-task-07'
`).get();

if (labelRow) {
  const inputSpec1 = JSON.stringify({ task_id: 'tb-task-07', slug: 'restricted-sudo-write', original_instructions: TASKS_DATA[6].description });
  const expectedSpec1 = JSON.stringify({ assertions: [{ type: 'exit_code', expected: 0 }] });

  db.prepare('INSERT OR IGNORE INTO eval_cases (id, benchmark_task_id, failure_label_id, input_spec, expected_spec, created_by) VALUES (1, ?, ?, ?, ?, \'MANUAL\')')
    .run(labelRow.benchmark_task_id, labelRow.id, inputSpec1, expectedSpec1);
  db.prepare('INSERT OR IGNORE INTO eval_suite_members (eval_suite_id, eval_case_id) VALUES (1, 1)').run();
}

// Seed a run history for the suite
db.prepare("INSERT OR IGNORE INTO eval_runs (id, eval_suite_id, harness_version_id, run_id, status, metrics) VALUES (1, 1, 1, 'run-tb2-baseline', 'COMPLETED', '{\"pass_rate\": 0.0}')")
  .run();
db.prepare("INSERT OR IGNORE INTO eval_runs (id, eval_suite_id, harness_version_id, run_id, status, metrics) VALUES (2, 1, 2, 'run-tb2-variant-1', 'COMPLETED', '{\"pass_rate\": 0.0}')")
  .run();

console.log('Database successfully seeded with new logical schema mapping.');
db.close();
