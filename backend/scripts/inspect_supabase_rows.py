import os
import sqlite3
import psycopg2

ROOT_DIR = "/Users/abhisheksharma/Projects/AutoHarness-Studio"
DEV_DB = os.path.join(ROOT_DIR, "backend", "dev.db")
AUTOHARNESS_DB = os.path.join(ROOT_DIR, "autoharness.db")

def main():
    # SQLite dev.db
    conn_dev = sqlite3.connect(DEV_DB)
    cur_dev = conn_dev.cursor()
    dev_counts = {}
    cur_dev.execute("SELECT name FROM sqlite_master WHERE type='table';")
    for t in [r[0] for r in cur_dev.fetchall()]:
        cur_dev.execute(f"SELECT COUNT(*) FROM {t}")
        dev_counts[t] = cur_dev.fetchone()[0]
    conn_dev.close()

    # SQLite autoharness.db
    conn_ah = sqlite3.connect(AUTOHARNESS_DB)
    cur_ah = conn_ah.cursor()
    ah_counts = {}
    cur_ah.execute("SELECT name FROM sqlite_master WHERE type='table';")
    for t in [r[0] for r in cur_ah.fetchall()]:
        cur_ah.execute(f"SELECT COUNT(*) FROM {t}")
        ah_counts[t] = cur_ah.fetchone()[0]
    conn_ah.close()

    # Postgres
    import sys
    sys.path.insert(0, "/Users/abhisheksharma/Projects/AutoHarness-Studio/backend")
    from app.core.settings import get_settings
    settings = get_settings()
    url = str(settings.database_url)
    if url.startswith("postgresql+asyncpg://"):
        url = url.replace("postgresql+asyncpg://", "postgresql://")
    conn_pg = psycopg2.connect(url, sslmode="require")
    cur_pg = conn_pg.cursor()
    cur_pg.execute("""
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public'
    """)
    pg_counts = {}
    for t in [r[0] for r in cur_pg.fetchall()]:
        cur_pg.execute(f"SELECT COUNT(*) FROM public.{t}")
        pg_counts[t] = cur_pg.fetchone()[0]
    conn_pg.close()

    print(f"{'Table':<35} | {'dev.db':<10} | {'autoharness.db':<15} | {'Supabase PG':<12}")
    print("-" * 80)
    all_tables = set(dev_counts.keys()).union(ah_counts.keys()).union(pg_counts.keys())
    for t in sorted(all_tables):
        print(f"{t:<35} | {dev_counts.get(t, 'N/A'):<10} | {ah_counts.get(t, 'N/A'):<15} | {pg_counts.get(t, 'N/A'):<12}")

if __name__ == "__main__":
    main()
