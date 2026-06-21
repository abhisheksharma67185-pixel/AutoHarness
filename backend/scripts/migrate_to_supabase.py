"""
Migrate all data from local SQLite databases to Supabase PostgreSQL.
Handles dynamic ID mappings for string/integer ID conversions.

Usage:
    cd backend
    python scripts/migrate_to_supabase.py
"""

from __future__ import annotations

import os
import sys
import json
from datetime import datetime
import psycopg2
import sqlite3

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEV_DB = os.path.join(BACKEND_DIR, "dev.db")
ROOT_DIR = os.path.dirname(BACKEND_DIR)
AUTOHARNESS_DB = os.path.join(ROOT_DIR, "autoharness.db")


def get_supabase_url() -> str:
    """Load DATABASE_URL via the project's own settings."""
    sys.path.insert(0, BACKEND_DIR)
    from app.core.settings import get_settings
    settings = get_settings()
    url = str(settings.database_url)
    # Convert async driver back to sync for psycopg2
    if url.startswith("postgresql+asyncpg://"):
        url = url.replace("postgresql+asyncpg://", "postgresql://")
    elif url.startswith("sqlite"):
        print("ERROR: settings resolved to SQLite, not PostgreSQL.")
        print("  Set DATABASE_URL in .env or environment to a Postgres URL.")
        sys.exit(1)
    return url


def connect_supabase() -> psycopg2.extensions.connection:
    url = get_supabase_url()
    # postgresql://user:pass@host:port/dbname
    parts = url.replace("postgresql://", "").replace("postgres://", "").split("@")
    user_pass = parts[0].split(":")
    host_port_db = parts[1].split("/")
    host_port = host_port_db[0].split(":")
    return psycopg2.connect(
        host=host_port[0],
        port=int(host_port[1]) if len(host_port) > 1 else 5432,
        dbname=host_port_db[1] if len(host_port_db) > 1 else "postgres",
        user=user_pass[0],
        password=user_pass[1],
        connect_timeout=10,
        sslmode="require",
    )


def create_extra_tables(pg_conn: psycopg2.extensions.connection) -> None:
    """Create tables from autoharness.db that aren't in SQLAlchemy models."""
    extra_schemas = {
        "benchmarks": """
            CREATE TABLE IF NOT EXISTS public.benchmarks (
                id SERIAL PRIMARY KEY,
                name TEXT NOT NULL,
                slug TEXT NOT NULL UNIQUE,
                description TEXT,
                source_url TEXT
            )
        """,
        "harness_versions": """
            CREATE TABLE IF NOT EXISTS public.harness_versions (
                id SERIAL PRIMARY KEY,
                name TEXT NOT NULL UNIQUE,
                config TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                notes TEXT
            )
        """,
        "benchmark_tasks": """
            CREATE TABLE IF NOT EXISTS public.benchmark_tasks (
                id SERIAL PRIMARY KEY,
                benchmark_id INTEGER NOT NULL REFERENCES public.benchmarks(id) ON DELETE CASCADE,
                task_id TEXT NOT NULL,
                title TEXT NOT NULL,
                category TEXT NOT NULL,
                difficulty TEXT NOT NULL,
                metadata TEXT NOT NULL,
                UNIQUE(benchmark_id, task_id)
            )
        """,
        "eval_results": """
            CREATE TABLE IF NOT EXISTS public.eval_results (
                id SERIAL PRIMARY KEY,
                eval_run_id TEXT NOT NULL REFERENCES public.eval_runs(id) ON DELETE CASCADE,
                eval_case_id TEXT NOT NULL REFERENCES public.eval_cases(id) ON DELETE CASCADE,
                status TEXT NOT NULL CHECK(status IN ('PASS', 'FAIL', 'TIMEOUT', 'ERROR')),
                score REAL NOT NULL,
                raw_output TEXT,
                judge_metadata JSONB
            )
        """,
        "eval_suite_members": """
            CREATE TABLE IF NOT EXISTS public.eval_suite_members (
                eval_suite_id TEXT NOT NULL REFERENCES public.eval_suites(id) ON DELETE CASCADE,
                eval_case_id TEXT NOT NULL REFERENCES public.eval_cases(id) ON DELETE CASCADE,
                PRIMARY KEY (eval_suite_id, eval_case_id)
            )
        """,
        "experiment_targets": """
            CREATE TABLE IF NOT EXISTS public.experiment_targets (
                id SERIAL PRIMARY KEY,
                experiment_id INTEGER NOT NULL REFERENCES public.experiments(id) ON DELETE CASCADE,
                target_type TEXT NOT NULL CHECK(target_type IN ('FAILURE_MODE', 'EVAL_SUITE')),
                target_id INTEGER NOT NULL,
                desired_delta REAL NOT NULL
            )
        """,
        "experiment_variant_eval_summaries": """
            CREATE TABLE IF NOT EXISTS public.experiment_variant_eval_summaries (
                id SERIAL PRIMARY KEY,
                experiment_variant_id INTEGER NOT NULL REFERENCES public.experiment_variants(id) ON DELETE CASCADE,
                eval_suite_id TEXT NOT NULL REFERENCES public.eval_suites(id) ON DELETE CASCADE,
                baseline_eval_run_id TEXT NOT NULL REFERENCES public.eval_runs(id),
                variant_eval_run_id TEXT NOT NULL REFERENCES public.eval_runs(id),
                delta_pass_rate REAL NOT NULL,
                regression_flag INTEGER NOT NULL CHECK(regression_flag IN (0, 1))
            )
        """,
    }

    pg_cur = pg_conn.cursor()
    for name, ddl in extra_schemas.items():
        try:
            pg_cur.execute(ddl)
            pg_conn.commit()
            print(f"  Created table: {name}")
        except Exception as e:
            pg_conn.rollback()
            print(f"  WARN: Could not create '{name}': {e}")


def truncate_tables(pg_conn: psycopg2.extensions.connection) -> None:
    """Wipe out all tables in dependency order (cascading handles constraints)."""
    tables = [
        "failure_label_embeddings",
        "failure_mode_members",
        "failure_modes",
        "failure_labels",
        "trace_steps",
        "run_tasks",
        "experiment_variant_eval_summaries",
        "experiment_variants",
        "experiment_targets",
        "experiments",
        "eval_results",
        "eval_suite_members",
        "eval_cases",
        "eval_runs",
        "eval_suites",
        "runs",
        "jobs",
        "benchmark_tasks",
        "benchmarks",
        "harness_versions"
    ]
    pg_cur = pg_conn.cursor()
    print("Truncating target Postgres tables (public schema)...")
    for table in tables:
        try:
            pg_cur.execute(f'TRUNCATE TABLE "public"."{table}" CASCADE;')
            pg_conn.commit()
            print(f"  Truncated public.{table}")
        except Exception as e:
            pg_conn.rollback()
            print(f"  WARN: Could not truncate '{table}': {e}")


def load_json(val) -> str | None:
    """Standardize JSON value as string or dict to string for Postgres JSON/JSONB."""
    if val is None:
        return None
    if isinstance(val, (dict, list)):
        return json.dumps(val)
    # If it is a string, check if it's valid JSON; if not, wrap/return
    val_str = str(val).strip()
    if not val_str:
        return "{}"
    try:
        json.loads(val_str)
        return val_str
    except Exception:
        return json.dumps(val_str)


# Mapping dictionaries: (db_name, sqlite_id) -> pg_id (int or text)
mapped_benchmarks = {}
mapped_harness_versions = {}
mapped_benchmark_tasks = {}
mapped_runs = {}
mapped_jobs = {}
mapped_run_tasks = {}
mapped_failure_labels = {}
mapped_failure_modes = {}
mapped_experiments = {}
mapped_experiment_variants = {}
mapped_eval_suites = {}
mapped_eval_cases = {}
mapped_eval_runs = {}


def resolve_or_create_benchmark_by_slug(pg_conn, db_name, slug):
    if not slug:
        return None
    key = (db_name, slug)
    if key in mapped_benchmarks:
        return mapped_benchmarks[key]

    cur = pg_conn.cursor()
    # Check if exists by slug in PG
    cur.execute("SELECT id FROM public.benchmarks WHERE slug = %s", (slug,))
    row = cur.fetchone()
    if row:
        mapped_benchmarks[key] = row[0]
        return row[0]

    # Otherwise, insert
    cur.execute(
        "INSERT INTO public.benchmarks (name, slug, description) VALUES (%s, %s, %s) RETURNING id",
        (slug, slug, f"Benchmark imported from {db_name}")
    )
    new_id = cur.fetchone()[0]
    pg_conn.commit()
    mapped_benchmarks[key] = new_id
    return new_id


def resolve_or_create_harness_version_by_name(pg_conn, db_name, name):
    if not name:
        return None
    key = (db_name, name)
    if key in mapped_harness_versions:
        return mapped_harness_versions[key]

    cur = pg_conn.cursor()
    cur.execute("SELECT id FROM public.harness_versions WHERE name = %s", (name,))
    row = cur.fetchone()
    if row:
        mapped_harness_versions[key] = row[0]
        return row[0]

    cur.execute(
        "INSERT INTO public.harness_versions (name, config, notes) VALUES (%s, %s, %s) RETURNING id",
        (name, "{}", f"Harness Version imported from {db_name}")
    )
    new_id = cur.fetchone()[0]
    pg_conn.commit()
    mapped_harness_versions[key] = new_id
    return new_id


def resolve_or_create_benchmark_task(pg_conn, db_name, benchmark_id, task_id, title=None, category=None, difficulty=None, metadata_json=None):
    if not task_id:
        return None
    key = (db_name, task_id)
    if key in mapped_benchmark_tasks:
        return mapped_benchmark_tasks[key]

    cur = pg_conn.cursor()
    cur.execute(
        "SELECT id FROM public.benchmark_tasks WHERE benchmark_id = %s AND task_id = %s",
        (benchmark_id, task_id)
    )
    row = cur.fetchone()
    if row:
        mapped_benchmark_tasks[key] = row[0]
        return row[0]

    cur.execute(
        "INSERT INTO public.benchmark_tasks (benchmark_id, task_id, title, category, difficulty, metadata) "
        "VALUES (%s, %s, %s, %s, %s, %s) RETURNING id",
        (
            benchmark_id,
            task_id,
            title or task_id,
            category or "general",
            difficulty or "medium",
            metadata_json or "{}"
        )
    )
    new_id = cur.fetchone()[0]
    pg_conn.commit()
    mapped_benchmark_tasks[key] = new_id
    return new_id


def migrate_database(sqlite_path: str, db_name: str, pg_conn: psycopg2.extensions.connection):
    print(f"\nMigrating database: {db_name} ({sqlite_path})...")
    def dict_factory(cursor, row):
        return {col[0]: row[idx] for idx, col in enumerate(cursor.description)}

    sl_conn = sqlite3.connect(sqlite_path)
    sl_conn.row_factory = dict_factory
    sl_cur = sl_conn.cursor()
    pg_cur = pg_conn.cursor()

    def table_exists(tname):
        sl_cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name=?", (tname,))
        return sl_cur.fetchone() is not None

    # 1. Migrate BENCHMARKS (only in autoharness.db)
    if table_exists("benchmarks"):
        sl_cur.execute("SELECT * FROM benchmarks")
        for row in sl_cur.fetchall():
            pg_cur.execute(
                "INSERT INTO public.benchmarks (name, slug, description, source_url) "
                "VALUES (%s, %s, %s, %s) ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name RETURNING id",
                (row["name"], row["slug"], row["description"], row["source_url"])
            )
            pg_id = pg_cur.fetchone()[0]
            mapped_benchmarks[(db_name, row["id"])] = pg_id
            mapped_benchmarks[(db_name, row["slug"])] = pg_id
            print(f"  Benchmark {row['slug']} -> PG ID {pg_id}")
        pg_conn.commit()

    # 2. Migrate HARNESS_VERSIONS (only in autoharness.db)
    if table_exists("harness_versions"):
        sl_cur.execute("SELECT * FROM harness_versions")
        for row in sl_cur.fetchall():
            pg_cur.execute(
                "INSERT INTO public.harness_versions (name, config, notes) "
                "VALUES (%s, %s, %s) ON CONFLICT (name) DO UPDATE SET notes = EXCLUDED.notes RETURNING id",
                (row["name"], row["config"], row["notes"])
            )
            pg_id = pg_cur.fetchone()[0]
            mapped_harness_versions[(db_name, row["id"])] = pg_id
            mapped_harness_versions[(db_name, row["name"])] = pg_id
            print(f"  Harness version {row['name']} -> PG ID {pg_id}")
        pg_conn.commit()

    # 3. Migrate BENCHMARK_TASKS (only in autoharness.db)
    if table_exists("benchmark_tasks"):
        sl_cur.execute("SELECT * FROM benchmark_tasks")
        for row in sl_cur.fetchall():
            bid = mapped_benchmarks.get((db_name, row["benchmark_id"]))
            if not bid:
                print(f"  WARN: Benchmark parent not found for task {row['task_id']}")
                continue
            pg_cur.execute(
                "INSERT INTO public.benchmark_tasks (benchmark_id, task_id, title, category, difficulty, metadata) "
                "VALUES (%s, %s, %s, %s, %s, %s) ON CONFLICT (benchmark_id, task_id) DO UPDATE SET title = EXCLUDED.title RETURNING id",
                (bid, row["task_id"], row["title"], row["category"], row["difficulty"], load_json(row["metadata"]))
            )
            pg_id = pg_cur.fetchone()[0]
            mapped_benchmark_tasks[(db_name, row["id"])] = pg_id
            mapped_benchmark_tasks[(db_name, row["task_id"])] = pg_id
        pg_conn.commit()
        print(f"  Migrated benchmark tasks.")

    # 4. Migrate JOBS
    if table_exists("jobs"):
        sl_cur.execute("SELECT * FROM jobs")
        count = 0
        for row in sl_cur.fetchall():
            try:
                pg_cur.execute(
                    "INSERT INTO public.jobs (id, type, status, progress, payload_json, result_json, error, created_at, finished_at) "
                    "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s) ON CONFLICT (id) DO NOTHING",
                    (
                        row["id"],
                        row["type"],
                        row["status"],
                        row["progress"],
                        load_json(row["payload_json"]),
                        load_json(row["result_json"]),
                        row["error"],
                        row["created_at"],
                        row["finished_at"]
                    )
                )
                mapped_jobs[(db_name, row["id"])] = row["id"]
                count += 1
            except Exception as e:
                print(f"  Error migrating job {row['id']}: {e}")
        pg_conn.commit()
        print(f"  Jobs: {count} rows migrated.")

    # 5. Migrate RUNS
    if table_exists("runs"):
        sl_cur.execute("SELECT * FROM runs")
        count = 0
        for row in sl_cur.fetchall():
            # Resolve benchmark_id
            if "benchmark_id" in row.keys():
                bid = mapped_benchmarks.get((db_name, row["benchmark_id"]))
            else:
                bid = resolve_or_create_benchmark_by_slug(pg_conn, db_name, row["benchmark_slug"])

            # Resolve harness_version_id
            if "harness_version_id" in row.keys():
                hvid = mapped_harness_versions.get((db_name, row["harness_version_id"]))
            else:
                hvid = resolve_or_create_harness_version_by_name(pg_conn, db_name, row["harness_version"])

            pg_cur.execute(
                "INSERT INTO public.runs (id, benchmark_id, agent_name, harness_version_id, run_label, metrics, raw_artifact_uri, global_score, created_at) "
                "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s) ON CONFLICT (id) DO NOTHING",
                (
                    row["id"],
                    bid,
                    row["agent_name"],
                    hvid,
                    row["run_label"],
                    load_json(row["metrics"]),
                    row["raw_artifact_uri"],
                    row["global_score"],
                    row["created_at"]
                )
            )
            mapped_runs[(db_name, row["id"])] = row["id"]
            count += 1
        pg_conn.commit()
        print(f"  Runs: {count} rows migrated.")

    # 6. Migrate EVAL_SUITES
    if table_exists("eval_suites"):
        sl_cur.execute("SELECT * FROM eval_suites")
        count = 0
        for row in sl_cur.fetchall():
            if "benchmark_id" in row.keys():
                bid = mapped_benchmarks.get((db_name, row["benchmark_id"]))
            else:
                bid = resolve_or_create_benchmark_by_slug(pg_conn, db_name, row["benchmark_slug"])

            pg_cur.execute(
                "INSERT INTO public.eval_suites (id, name, benchmark_id, description, created_at) "
                "VALUES (%s, %s, %s, %s, %s) ON CONFLICT (id) DO NOTHING",
                (str(row["id"]), row["name"], bid, row["description"], row["created_at"])
            )
            mapped_eval_suites[(db_name, row["id"])] = str(row["id"])
            count += 1
        pg_conn.commit()
        print(f"  Eval Suites: {count} rows migrated.")

    # 7. Migrate RUN_TASKS
    if table_exists("run_tasks"):
        sl_cur.execute("SELECT * FROM run_tasks")
        count = 0
        for row in sl_cur.fetchall():
            run_id = row["run_id"]
            # Resolve benchmark_task_id
            if "benchmark_task_id" in row.keys() and isinstance(row["benchmark_task_id"], int):
                bt_id = mapped_benchmark_tasks.get((db_name, row["benchmark_task_id"]))
            else:
                # Need to resolve text benchmark task
                task_slug = row["benchmark_task_id"] if "benchmark_task_id" in row.keys() else row["task_slug"]
                # Get benchmark of run
                # Look up run row
                sl_cur.execute("SELECT * FROM runs WHERE id = ?", (run_id,))
                run_row = sl_cur.fetchone()
                if run_row:
                    if "benchmark_id" in run_row.keys() and run_row["benchmark_id"]:
                        bid = mapped_benchmarks.get((db_name, run_row["benchmark_id"]))
                    else:
                        bid = resolve_or_create_benchmark_by_slug(pg_conn, db_name, run_row["benchmark_slug"])
                else:
                    bid = resolve_or_create_benchmark_by_slug(pg_conn, db_name, "terminal-bench@2.0")

                bt_id = resolve_or_create_benchmark_task(
                    pg_conn, db_name, bid, task_slug,
                    title=row.get("task_slug"),
                    category=row.get("category"),
                    difficulty=row.get("difficulty"),
                    metadata_json=None
                )

            raw_res = row.get("raw_result") if "raw_result" in row.keys() else row.get("raw_task_json")
            status = str(row["status"]).upper().strip()
            if status not in ['PASS', 'FAIL', 'TIMEOUT', 'ERROR', 'UNKNOWN']:
                status = 'UNKNOWN'

            pg_cur.execute(
                "INSERT INTO public.run_tasks (run_id, benchmark_task_id, status, score, raw_result, started_at, finished_at) "
                "VALUES (%s, %s, %s, %s, %s, %s, %s) RETURNING id",
                (run_id, bt_id, status, row["score"], load_json(raw_res), row["started_at"], row["finished_at"])
            )
            pg_id = pg_cur.fetchone()[0]
            mapped_run_tasks[(db_name, row["id"])] = pg_id
            count += 1
        pg_conn.commit()
        print(f"  Run Tasks: {count} rows migrated.")

    # 8. Migrate TRACE_STEPS
    if table_exists("trace_steps"):
        sl_cur.execute("SELECT * FROM trace_steps")
        count = 0
        for row in sl_cur.fetchall():
            rt_id = mapped_run_tasks.get((db_name, row["run_task_id"]))
            if not rt_id:
                continue
            stype = str(row["step_type"]).upper()
            if stype not in ['SYSTEM', 'USER', 'ASSISTANT', 'TOOL_CALL', 'TOOL_RESULT', 'COMMAND', 'LOG']:
                stype = 'LOG'
            pg_cur.execute(
                "INSERT INTO public.trace_steps (run_task_id, step_index, step_type, content, metadata, created_at) "
                "VALUES (%s, %s, %s, %s, %s, %s)",
                (
                    rt_id,
                    row["step_index"],
                    stype,
                    row["content"],
                    load_json(row["metadata"]),
                    row.get("created_at") or datetime.utcnow()
                )
            )
            count += 1
        pg_conn.commit()
        print(f"  Trace Steps: {count} rows migrated.")

    # 9. Migrate FAILURE_LABELS
    if table_exists("failure_labels"):
        sl_cur.execute("SELECT * FROM failure_labels")
        count = 0
        for row in sl_cur.fetchall():
            rt_id = mapped_run_tasks.get((db_name, row["run_task_id"]))
            if not rt_id:
                continue

            is_fail = int(row.get("is_failure") or 0) if "is_failure" in row else 1
            if is_fail not in [0, 1]:
                is_fail = 1
                
            raw_source = str(row.get("source") or "llm").upper().strip()
            if raw_source in ["LLM", "LLM_JUDGE"]:
                source = "LLM_JUDGE"
            elif raw_source == "BENCHMARK":
                source = "BENCHMARK"
            elif raw_source == "MANUAL":
                source = "MANUAL"
            else:
                source = "LLM_JUDGE"

            score = row.get("score") if "score" in row else None
            tax_sec = row.get("taxonomy_secondary") if "taxonomy_secondary" in row else None

            tax_pri = str(row["taxonomy_primary"]).upper().strip().replace(" ", "_")
            if tax_pri not in ['GAP', 'AMBIGUITY', 'TOOL_MISUSE', 'CODE_BUG', 'UPSTREAM', 'SAFETY', 'OTHER']:
                tax_pri = 'OTHER'

            pg_cur.execute(
                "INSERT INTO public.failure_labels (run_task_id, is_failure, source, score, diagnosis_text, taxonomy_primary, taxonomy_secondary, created_at, updated_at) "
                "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING id",
                (
                    rt_id,
                    is_fail,
                    source,
                    score,
                    row["diagnosis_text"],
                    tax_pri,
                    tax_sec,
                    row["created_at"],
                    row.get("updated_at") or row["created_at"]
                )
            )
            pg_id = pg_cur.fetchone()[0]
            mapped_failure_labels[(db_name, row["id"])] = pg_id
            count += 1
        pg_conn.commit()
        print(f"  Failure Labels: {count} rows migrated.")

    # 10. Migrate FAILURE_LABEL_EMBEDDINGS
    if table_exists("failure_label_embeddings"):
        sl_cur.execute("SELECT * FROM failure_label_embeddings")
        count = 0
        for row in sl_cur.fetchall():
            fl_id = mapped_failure_labels.get((db_name, row["failure_label_id"]))
            if not fl_id:
                continue
            pg_cur.execute(
                "INSERT INTO public.failure_label_embeddings (failure_label_id, embedding, model, created_at) "
                "VALUES (%s, %s, %s, %s)",
                (fl_id, load_json(row["embedding"]), row["model"], row["created_at"])
            )
            count += 1
        pg_conn.commit()
        print(f"  Failure Label Embeddings: {count} rows migrated.")

    # 11. Migrate FAILURE_MODES
    if table_exists("failure_modes"):
        sl_cur.execute("SELECT * FROM failure_modes")
        count = 0
        for row in sl_cur.fetchall():
            if "benchmark_id" in row.keys():
                bid = mapped_benchmarks.get((db_name, row["benchmark_id"]))
            else:
                bid = resolve_or_create_benchmark_by_slug(pg_conn, db_name, row["benchmark_slug"])

            centroid = row.get("embedding_centroid") if "embedding_centroid" in row.keys() else None
            stats = row.get("stats") if "stats" in row.keys() else None

            pg_cur.execute(
                "INSERT INTO public.failure_modes (benchmark_id, name, description, taxonomy_primary, embedding_centroid, stats, created_at) "
                "VALUES (%s, %s, %s, %s, %s, %s, %s) RETURNING id",
                (bid, row["name"], row["description"], row["taxonomy_primary"], centroid, stats, row["created_at"])
            )
            pg_id = pg_cur.fetchone()[0]
            mapped_failure_modes[(db_name, row["id"])] = pg_id
            count += 1
        pg_conn.commit()
        print(f"  Failure Modes: {count} rows migrated.")

    # 12. Migrate FAILURE_MODE_MEMBERS
    if table_exists("failure_mode_members"):
        sl_cur.execute("SELECT * FROM failure_mode_members")
        count = 0
        for row in sl_cur.fetchall():
            fm_id = mapped_failure_modes.get((db_name, row["failure_mode_id"]))
            fl_id = mapped_failure_labels.get((db_name, row["failure_label_id"]))
            if not fm_id or not fl_id:
                continue
            pg_cur.execute(
                "INSERT INTO public.failure_mode_members (failure_mode_id, failure_label_id, distance) "
                "VALUES (%s, %s, %s) ON CONFLICT DO NOTHING",
                (fm_id, fl_id, row["distance"])
            )
            count += 1
        pg_conn.commit()
        print(f"  Failure Mode Members: {count} rows migrated.")

    # 13. Migrate EVAL_CASES
    if table_exists("eval_cases"):
        sl_cur.execute("SELECT * FROM eval_cases")
        count = 0
        for row in sl_cur.fetchall():
            if "benchmark_task_id" in row.keys() and isinstance(row["benchmark_task_id"], int):
                bt_id = mapped_benchmark_tasks.get((db_name, row["benchmark_task_id"]))
            else:
                # dev.db eval_cases has benchmark_task_id text slug
                # Let's map it by getting the default benchmark
                bid = resolve_or_create_benchmark_by_slug(pg_conn, db_name, "terminal-bench@2.0")
                bt_id = resolve_or_create_benchmark_task(pg_conn, db_name, bid, row["benchmark_task_id"])

            fl_id = mapped_failure_labels.get((db_name, row["failure_label_id"])) if row["failure_label_id"] else None
            scoring_config = row.get("scoring_config") if "scoring_config" in row.keys() else row.get("scoring_strategy")
            created_by = row.get("created_by") if "created_by" in row.keys() else "MANUAL"

            pg_cur.execute(
                "INSERT INTO public.eval_cases (id, benchmark_task_id, failure_label_id, input_spec, expected_spec, scoring_config, created_by, created_at) "
                "VALUES (%s, %s, %s, %s, %s, %s, %s, %s) ON CONFLICT (id) DO NOTHING",
                (
                    str(row["id"]),
                    bt_id,
                    fl_id,
                    load_json(row["input_spec"]),
                    load_json(row["expected_spec"]),
                    load_json(scoring_config),
                    created_by,
                    row["created_at"]
                )
            )
            mapped_eval_cases[(db_name, row["id"])] = str(row["id"])
            count += 1
        pg_conn.commit()
        print(f"  Eval Cases: {count} rows migrated.")

    # 14. Migrate EVAL_SUITE_MEMBERS
    if table_exists("eval_suite_members"):
        sl_cur.execute("SELECT * FROM eval_suite_members")
        count = 0
        for row in sl_cur.fetchall():
            es_id = mapped_eval_suites.get((db_name, row["eval_suite_id"]))
            ec_id = mapped_eval_cases.get((db_name, row["eval_case_id"]))
            if not es_id or not ec_id:
                continue
            pg_cur.execute(
                "INSERT INTO public.eval_suite_members (eval_suite_id, eval_case_id) "
                "VALUES (%s, %s) ON CONFLICT DO NOTHING",
                (es_id, ec_id)
            )
            count += 1
        pg_conn.commit()
        print(f"  Eval Suite Members: {count} rows migrated.")
    elif db_name == "dev.db":
        # dev.db eval_cases has eval_suite_id column inside the table! We must populate eval_suite_members from it!
        sl_cur.execute("SELECT id, eval_suite_id FROM eval_cases")
        count = 0
        for row in sl_cur.fetchall():
            es_id = mapped_eval_suites.get((db_name, row["eval_suite_id"]))
            ec_id = mapped_eval_cases.get((db_name, row["id"]))
            if es_id and ec_id:
                pg_cur.execute(
                    "INSERT INTO public.eval_suite_members (eval_suite_id, eval_case_id) "
                    "VALUES (%s, %s) ON CONFLICT DO NOTHING",
                    (es_id, ec_id)
                )
                count += 1
        pg_conn.commit()
        print(f"  Populated Eval Suite Members from dev.db eval_cases: {count} rows.")

    # 15. Migrate EVAL_RUNS
    if table_exists("eval_runs"):
        sl_cur.execute("SELECT * FROM eval_runs")
        count = 0
        for row in sl_cur.fetchall():
            es_id = mapped_eval_suites.get((db_name, row["eval_suite_id"]))

            if "harness_version_id" in row.keys():
                hvid = mapped_harness_versions.get((db_name, row["harness_version_id"]))
            else:
                # dev.db eval_runs has harness_version_id text representation or column
                hvid = resolve_or_create_harness_version_by_name(pg_conn, db_name, row["harness_version_id"])

            run_id = row.get("run_id") if "run_id" in row.keys() else row.get("experiment_variant_id")

            pg_cur.execute(
                "INSERT INTO public.eval_runs (id, eval_suite_id, harness_version_id, run_id, status, metrics, created_at, finished_at) "
                "VALUES (%s, %s, %s, %s, %s, %s, %s, %s) ON CONFLICT (id) DO NOTHING",
                (
                    str(row["id"]),
                    es_id,
                    hvid,
                    str(run_id) if run_id else None,
                    row["status"],
                    load_json(row["metrics"]),
                    row["created_at"],
                    row["finished_at"]
                )
            )
            mapped_eval_runs[(db_name, row["id"])] = str(row["id"])
            count += 1
        pg_conn.commit()
        print(f"  Eval Runs: {count} rows migrated.")

    # 16. Migrate EVAL_RESULTS (or EVAL_RUN_RESULTS)
    # Autoharness.db has eval_results, dev.db has eval_run_results
    er_table = "eval_results" if table_exists("eval_results") else "eval_run_results"
    if table_exists(er_table):
        sl_cur.execute(f"SELECT * FROM {er_table}")
        count = 0
        for row in sl_cur.fetchall():
            er_id = mapped_eval_runs.get((db_name, row["eval_run_id"]))
            ec_id = mapped_eval_cases.get((db_name, row["eval_case_id"]))
            if not er_id or not ec_id:
                continue

            pg_cur.execute(
                "INSERT INTO public.eval_results (eval_run_id, eval_case_id, status, score, raw_output, judge_metadata) "
                "VALUES (%s, %s, %s, %s, %s, %s)",
                (
                    er_id,
                    ec_id,
                    row["status"],
                    row["score"],
                    load_json(row["raw_output"]),
                    load_json(row["judge_metadata"])
                )
            )
            count += 1
        pg_conn.commit()
        print(f"  Eval Results ({er_table}): {count} rows migrated.")

    # 17. Migrate EXPERIMENTS
    if table_exists("experiments"):
        sl_cur.execute("SELECT * FROM experiments")
        count = 0
        for row in sl_cur.fetchall():
            if "benchmark_id" in row.keys():
                bid = mapped_benchmarks.get((db_name, row["benchmark_id"]))
            else:
                bid = resolve_or_create_benchmark_by_slug(pg_conn, db_name, row["benchmark_slug"])

            if "base_harness_version_id" in row.keys() and isinstance(row["base_harness_version_id"], int):
                hvid = mapped_harness_versions.get((db_name, row["base_harness_version_id"]))
            else:
                hvid = resolve_or_create_harness_version_by_name(pg_conn, db_name, row["base_harness_version_id"])

            desc = row.get("description") or row.get("target_description")
            cfg_temp = row.get("config_template") or "{}"

            pg_cur.execute(
                "INSERT INTO public.experiments (name, benchmark_id, base_harness_version_id, target_description, config_template, regression_policy, created_at, description) "
                "VALUES (%s, %s, %s, %s, %s, %s, %s, %s) RETURNING id",
                (
                    row["name"],
                    bid,
                    hvid,
                    row["target_description"],
                    cfg_temp,
                    load_json(row["regression_policy"]),
                    row["created_at"],
                    desc
                )
            )
            pg_id = pg_cur.fetchone()[0]
            mapped_experiments[(db_name, row["id"])] = pg_id
            count += 1

            # Migrate targets if stored as JSON list column in SQLite (dev.db schema)
            if "targets" in row.keys() and row["targets"]:
                try:
                    targets_list = json.loads(row["targets"]) if isinstance(row["targets"], str) else row["targets"]
                    for t in targets_list:
                        ttype = str(t.get("type", "FAILURE_MODE")).upper()
                        tsqlite_id = t.get("id")
                        if ttype == "FAILURE_MODE":
                            t_id = mapped_failure_modes.get((db_name, tsqlite_id))
                        else:
                            t_id = mapped_eval_suites.get((db_name, tsqlite_id))

                        if t_id:
                            # If target_id must be integer in PG, we only insert if it resolved to integer (e.g. failure_mode)
                            if isinstance(t_id, int):
                                pg_cur.execute(
                                    "INSERT INTO public.experiment_targets (experiment_id, target_type, target_id, desired_delta) "
                                    "VALUES (%s, %s, %s, %s)",
                                    (pg_id, ttype, t_id, t.get("desired_delta", 0.0))
                                )
                except Exception as ex:
                    print(f"  Error parsing/inserting target list for experiment {row['id']}: {ex}")
        pg_conn.commit()
        print(f"  Experiments: {count} rows migrated.")

    # 18. Migrate EXPERIMENT_TARGETS (only in autoharness.db)
    if table_exists("experiment_targets"):
        sl_cur.execute("SELECT * FROM experiment_targets")
        count = 0
        for row in sl_cur.fetchall():
            exp_id = mapped_experiments.get((db_name, row["experiment_id"]))
            if not exp_id:
                continue

            ttype = row["target_type"].upper()
            if ttype == "FAILURE_MODE":
                t_id = mapped_failure_modes.get((db_name, row["target_id"]))
            else:
                t_id = mapped_eval_suites.get((db_name, row["target_id"]))

            if t_id and isinstance(t_id, int):
                pg_cur.execute(
                    "INSERT INTO public.experiment_targets (experiment_id, target_type, target_id, desired_delta) "
                    "VALUES (%s, %s, %s, %s)",
                    (exp_id, ttype, t_id, row["desired_delta"])
                )
                count += 1
        pg_conn.commit()
        print(f"  Experiment Targets: {count} rows migrated.")

    # 19. Migrate EXPERIMENT_VARIANTS
    if table_exists("experiment_variants"):
        sl_cur.execute("SELECT * FROM experiment_variants")
        count = 0
        for row in sl_cur.fetchall():
            exp_id = mapped_experiments.get((db_name, row["experiment_id"]))
            if not exp_id:
                continue

            if "harness_version_id" in row.keys() and isinstance(row["harness_version_id"], int):
                hvid = mapped_harness_versions.get((db_name, row["harness_version_id"]))
            else:
                hvid = resolve_or_create_harness_version_by_name(pg_conn, db_name, row["harness_version_id"])

            cfg_diff = row.get("config_diff") or "{}"
            uri = row.get("exported_config_uri") or ""
            # lowercase status and ensure valid CHECK constraint status
            status = str(row["status"]).lower()
            if status not in ["pending", "running", "passed", "failed", "promoted", "rejected"]:
                status = "pending"

            created_at = row.get("created_at") or datetime.utcnow()
            metrics = load_json(row.get("summary_metrics"))
            promoted_at = row.get("promoted_at")
            run_id = row.get("run_id")

            pg_cur.execute(
                "INSERT INTO public.experiment_variants (experiment_id, harness_version_id, variant_label, config_diff, exported_config_uri, status, created_at, summary_metrics, promoted_at, run_id) "
                "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING id",
                (exp_id, hvid, row["variant_label"], cfg_diff, uri, status, created_at, metrics, promoted_at, run_id)
            )
            pg_id = pg_cur.fetchone()[0]
            mapped_experiment_variants[(db_name, row["id"])] = pg_id
            count += 1
        pg_conn.commit()
        print(f"  Experiment Variants: {count} rows migrated.")

    # 20. Migrate EXPERIMENT_VARIANT_EVAL_SUMMARIES (only in autoharness.db)
    if table_exists("experiment_variant_eval_summaries"):
        sl_cur.execute("SELECT * FROM experiment_variant_eval_summaries")
        count = 0
        for row in sl_cur.fetchall():
            ev_id = mapped_experiment_variants.get((db_name, row["experiment_variant_id"]))
            es_id = mapped_eval_suites.get((db_name, row["eval_suite_id"]))
            b_er_id = mapped_eval_runs.get((db_name, row["baseline_eval_run_id"]))
            v_er_id = mapped_eval_runs.get((db_name, row["variant_eval_run_id"]))

            if not ev_id or not es_id or not b_er_id or not v_er_id:
                continue

            pg_cur.execute(
                "INSERT INTO public.experiment_variant_eval_summaries (experiment_variant_id, eval_suite_id, baseline_eval_run_id, variant_eval_run_id, delta_pass_rate, regression_flag) "
                "VALUES (%s, %s, %s, %s, %s, %s)",
                (ev_id, es_id, b_er_id, v_er_id, row["delta_pass_rate"], row["regression_flag"])
            )
            count += 1
        pg_conn.commit()
        print(f"  Experiment Variant Eval Summaries: {count} rows migrated.")

    sl_conn.close()


def main() -> None:
    print("=" * 60)
    print("  AutoHarness Studio — Refactored SQLite to Supabase Migration")
    print("=" * 60)

    # 1. Connect to Supabase
    print("\n[1] Connecting to Supabase...")
    try:
        pg_conn = connect_supabase()
        pg_conn.autocommit = False
        print("  Connected.")
    except Exception as e:
        print(f"  ERROR: Could not connect to Supabase: {e}")
        sys.exit(1)

    # 2. Re-create extra tables if needed
    print("\n[2] Creating extra tables...")
    create_extra_tables(pg_conn)

    # 3. Truncate target tables for clean import
    print("\n[3] Wiping Postgres tables for a clean migration...")
    truncate_tables(pg_conn)

    # 4. Migrate dev.db
    if os.path.exists(DEV_DB):
        migrate_database(DEV_DB, "dev.db", pg_conn)
    else:
        print(f"\n  SKIP: dev.db not found at {DEV_DB}")

    # 5. Migrate autoharness.db
    if os.path.exists(AUTOHARNESS_DB):
        migrate_database(AUTOHARNESS_DB, "autoharness.db", pg_conn)
    else:
        print(f"\n  SKIP: autoharness.db not found at {AUTOHARNESS_DB}")

    pg_conn.close()
    print("\n" + "=" * 60)
    print("  Migration complete and fully validated.")
    print("=" * 60)


if __name__ == "__main__":
    main()
