import os
import sqlite3
import psycopg2

ROOT_DIR = "/Users/abhisheksharma/Projects/AutoHarness-Studio"
DEV_DB = os.path.join(ROOT_DIR, "backend", "dev.db")
AUTOHARNESS_DB = os.path.join(ROOT_DIR, "autoharness.db")

def main():
    # SQLite dev.db eval_run_results
    conn_dev = sqlite3.connect(DEV_DB)
    cur_dev = conn_dev.cursor()
    cur_dev.execute("PRAGMA table_info('eval_run_results')")
    print("SQLite dev.db eval_run_results columns:", cur_dev.fetchall())
    conn_dev.close()

    # SQLite autoharness.db eval_results
    conn_ah = sqlite3.connect(AUTOHARNESS_DB)
    cur_ah = conn_ah.cursor()
    cur_ah.execute("PRAGMA table_info('eval_results')")
    print("SQLite autoharness.db eval_results columns:", cur_ah.fetchall())
    conn_ah.close()

    # Postgres
    url = 'postgresql://postgres.yngvpwjlurguvdnpiegs:joztus-vobje5-sIxsiw@aws-1-ap-northeast-1.pooler.supabase.com:6543/postgres'
    conn_pg = psycopg2.connect(url, sslmode="require")
    cur_pg = conn_pg.cursor()
    cur_pg.execute("""
        SELECT column_name, data_type 
        FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'eval_results'
    """)
    print("Postgres eval_results columns:", cur_pg.fetchall())
    conn_pg.close()

if __name__ == "__main__":
    main()
