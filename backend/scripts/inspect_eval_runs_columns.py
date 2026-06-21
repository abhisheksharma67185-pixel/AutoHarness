import os
import sqlite3
import psycopg2

ROOT_DIR = "/Users/abhisheksharma/Projects/AutoHarness-Studio"
DEV_DB = os.path.join(ROOT_DIR, "backend", "dev.db")

def main():
    # SQLite
    conn_sl = sqlite3.connect(DEV_DB)
    cur_sl = conn_sl.cursor()
    cur_sl.execute("PRAGMA table_info('eval_runs')")
    sl_cols = {r[1]: r[2] for r in cur_sl.fetchall()}
    print("SQLite eval_runs columns:", sl_cols)
    conn_sl.close()

    # Postgres
    url = 'postgresql://postgres.yngvpwjlurguvdnpiegs:joztus-vobje5-sIxsiw@aws-1-ap-northeast-1.pooler.supabase.com:6543/postgres'
    conn_pg = psycopg2.connect(url, sslmode="require")
    cur_pg = conn_pg.cursor()
    cur_pg.execute("""
        SELECT column_name, data_type 
        FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'eval_runs'
    """)
    pg_cols = {r[0]: r[1] for r in cur_pg.fetchall()}
    print("Postgres eval_runs columns:", pg_cols)
    conn_pg.close()

if __name__ == "__main__":
    main()
