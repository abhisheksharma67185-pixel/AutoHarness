"""
Migrate all data from local SQLite databases to Supabase PostgreSQL.

Usage:
    cd backend
    python scripts/migrate_to_supabase.py
"""

from __future__ import annotations

import os
import sys

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


def table_order() -> list[str]:
    """Tables in dependency order (parents first)."""
    return [
        "runs",
        "jobs",
        "failure_modes",
        "experiments",
        "benchmarks",
        "harness_versions",
        "eval_suites",
        "run_tasks",
        "trace_steps",
        "failure_labels",
        "failure_label_embeddings",
        "failure_mode_members",
        "experiment_variants",
        "eval_runs",
        "eval_cases",
        "eval_run_results",
        "eval_results",
        "eval_suite_members",
        "experiment_targets",
        "experiment_variant_eval_summaries",
        "benchmark_tasks",
    ]


def copy_table(
    pg_conn: psycopg2.extensions.connection,
    sqlite_path: str,
    table: str,
    pg_schema: str = "public",
) -> int:
    """Copy all rows from a SQLite table to the matching PostgreSQL table."""
    sl_conn = sqlite3.connect(sqlite_path)
    sl_conn.row_factory = sqlite3.Row
    sl_cur = sl_conn.cursor()
    pg_cur = pg_conn.cursor()

    # Get columns from SQLite
    sl_cur.execute(f'PRAGMA table_info("{table}")')
    cols = [row["name"] for row in sl_cur.fetchall()]
    if not cols:
        print(f"  SKIP: table '{table}' not found in {sqlite_path}")
        sl_conn.close()
        return 0

    # Get rows
    sl_cur.execute(f'SELECT * FROM "{table}"')
    rows = sl_cur.fetchall()
    if not rows:
        sl_conn.close()
        return 0

    placeholders = ", ".join(f"%s" for _ in cols)
    columns = ", ".join(f'"{c}"' for c in cols)
    conflict = ", ".join(f'"{c}"' for c in cols)

    insert_sql = (
        f'INSERT INTO "{pg_schema}"."{table}" ({columns}) '
        f"VALUES ({placeholders}) "
        f"ON CONFLICT DO NOTHING"
    )

    count = 0
    for row in rows:
        values = []
        for c in cols:
            v = row[c]
            # Convert SQLite types to Python types
            if isinstance(v, str):
                # Handle JSON strings — PostgreSQL will store as JSONB
                pass
            elif isinstance(v, int):
                # Check if it's a boolean column
                # We'll let PostgreSQL handle type coercion
                pass
            elif v is None:
                pass
            values.append(v)
        try:
            pg_cur.execute(insert_sql, tuple(values))
            count += 1
        except Exception as e:
            print(f"  ERROR on {table} row {count}: {e}")
            pg_conn.rollback()
            sl_conn.close()
            return count

    pg_conn.commit()
    sl_conn.close()
    print(f"  {table}: {count} rows copied")
    return count


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
                experiment_id TEXT NOT NULL REFERENCES public.experiments(id) ON DELETE CASCADE,
                target_type TEXT NOT NULL CHECK(target_type IN ('FAILURE_MODE', 'EVAL_SUITE')),
                target_id TEXT NOT NULL,
                desired_delta REAL NOT NULL
            )
        """,
        "experiment_variant_eval_summaries": """
            CREATE TABLE IF NOT EXISTS public.experiment_variant_eval_summaries (
                id SERIAL PRIMARY KEY,
                experiment_variant_id TEXT NOT NULL REFERENCES public.experiment_variants(id) ON DELETE CASCADE,
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


def check_db_files() -> dict[str, str | None]:
    """Verify which SQLite databases exist."""
    dbs = {}
    for name, path in [("dev.db", DEV_DB), ("autoharness.db", AUTOHARNESS_DB)]:
        if os.path.exists(path):
            size = os.path.getsize(path)
            dbs[name] = path
            print(f"  Found {name} ({size / 1024:.1f} KB)")
        else:
            dbs[name] = None
            print(f"  {name}: not found (skipped)")
    return dbs


def main() -> None:
    print("=" * 60)
    print("  AutoHarness Studio — SQLite to Supabase Migration")
    print("=" * 60)

    # 1. Check local databases
    print("\n[1] Local databases:")
    dbs = check_db_files()
    if not any(dbs.values()):
        print("  No databases to migrate. Exiting.")
        return

    # 2. Connect to Supabase
    print("\n[2] Connecting to Supabase...")
    try:
        pg_conn = connect_supabase()
        pg_conn.autocommit = False
        print("  Connected.")
    except Exception as e:
        print(f"  ERROR: Could not connect to Supabase: {e}")
        print("\n  Make sure your Supabase project is running (not paused).")
        print("  You can unpause it from the Supabase dashboard.")
        sys.exit(1)

    # 3. Create tables from SQLAlchemy models
    print("\n[3] Creating SQLAlchemy model tables in Supabase...")
    try:
        from app.db.base import Base
        from sqlalchemy import create_engine

        engine = create_engine(url, pool_pre_ping=True)
        Base.metadata.create_all(bind=engine)
        engine.dispose()
        print("  Tables created (if not already present).")
    except Exception as e:
        print(f"  ERROR: Could not create tables: {e}")
        print("  Falling back to direct table creation.")
        pg_conn.rollback()

    # 4. Create extra tables (autoharness.db)
    print("\n[4] Creating extra tables from autoharness.db...")
    create_extra_tables(pg_conn)

    # 5. Copy data from dev.db
    if dbs.get("dev.db"):
        print(f"\n[5] Copying data from dev.db...")
        tables = [
            "runs",
            "jobs",
            "failure_modes",
            "experiments",
            "eval_suites",
            "run_tasks",
            "trace_steps",
            "failure_labels",
            "failure_label_embeddings",
            "failure_mode_members",
            "experiment_variants",
            "eval_runs",
            "eval_cases",
            "eval_run_results",
        ]
        total = 0
        for table in tables:
            try:
                total += copy_table(pg_conn, DEV_DB, table)
            except Exception as e:
                print(f"  ERROR migrating '{table}': {e}")
                pg_conn.rollback()
        print(f"  Total: {total} rows from dev.db")

    # 6. Copy data from autoharness.db
    if dbs.get("autoharness.db"):
        print(f"\n[6] Copying data from autoharness.db...")
        tables = [
            "benchmarks",
            "harness_versions",
            "benchmark_tasks",
            "experiments",
            "experiment_variants",
            "experiment_targets",
            "experiment_variant_eval_summaries",
            "eval_suites",
            "eval_cases",
            "eval_suite_members",
            "eval_runs",
            "eval_results",
            "eval_run_results",
            "runs",
            "run_tasks",
            "trace_steps",
            "failure_labels",
            "failure_label_embeddings",
            "failure_mode_members",
            "failure_modes",
            "jobs",
        ]
        total = 0
        for table in tables:
            try:
                total += copy_table(pg_conn, AUTOHARNESS_DB, table)
            except Exception as e:
                print(f"  ERROR migrating '{table}': {e}")
                pg_conn.rollback()
        print(f"  Total: {total} rows from autoharness.db")

    pg_conn.close()
    print("\n" + "=" * 60)
    print("  Migration complete.")
    print("=" * 60)
    print("\nNext steps:")
    print("  1. The .env already has DATABASE_URL set to Supabase.")
    print("  2. Restart the backend:")
    print("     cd backend && DATABASE_URL=$(grep DATABASE_URL ../.env | cut -d= -f2-) uvicorn app.main:app --port 8001")
    print("  3. Verify with: curl http://localhost:8001/health")


if __name__ == "__main__":
    main()
