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
        cur.execute("SELECT id, name FROM public.experiments;")
        exps = cur.fetchall()
        print("Experiments:")
        for exp in exps:
            print(f"  ID: {exp[0]}, Name: {exp[1]}")
            
        cur.execute("SELECT id, experiment_id, variant_label, harness_version_id FROM public.experiment_variants;")
        vars_ = cur.fetchall()
        print("\nVariants:")
        for v in vars_:
            print(f"  ID: {v[0]}, Experiment ID: {v[1]}, Label: {v[2]}, Harness Version ID: {v[3]}")
    finally:
        conn.close()

if __name__ == "__main__":
    main()
