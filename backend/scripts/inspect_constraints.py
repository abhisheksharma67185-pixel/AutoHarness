import os
import sys
import psycopg2

BACKEND_DIR = "/Users/abhisheksharma/Projects/AutoHarness-Studio/backend"
sys.path.insert(0, BACKEND_DIR)

from app.core.settings import get_settings

def get_db_url():
    settings = get_settings()
    url = str(settings.database_url)
    if url.startswith("postgresql+asyncpg://"):
        url = url.replace("postgresql+asyncpg://", "postgresql://")
    return url

def main():
    url = get_db_url()
    conn = psycopg2.connect(url, sslmode="require")
    cur = conn.cursor()
    try:
        cur.execute("""
            SELECT conname, pg_get_constraintdef(oid)
            FROM pg_constraint
            WHERE conrelid = 'public.experiment_variants'::regclass;
        """)
        constraints = cur.fetchall()
        print("Constraints on experiment_variants:")
        for con in constraints:
            print(f"  Name: {con[0]}, Def: {con[1]}")
    finally:
        conn.close()

if __name__ == "__main__":
    main()
