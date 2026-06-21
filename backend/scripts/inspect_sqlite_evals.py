import os
import sqlite3

ROOT_DIR = "/Users/abhisheksharma/Projects/AutoHarness-Studio"
DEV_DB = os.path.join(ROOT_DIR, "backend", "dev.db")
AUTOHARNESS_DB = os.path.join(ROOT_DIR, "autoharness.db")

def check_db(name, path):
    if not os.path.exists(path):
        print(f"{name}: not found at {path}")
        return
    print(f"\n{name} ({path}):")
    conn = sqlite3.connect(path)
    cur = conn.cursor()
    try:
        cur.execute("SELECT name FROM sqlite_master WHERE type='table';")
        tables = [r[0] for r in cur.fetchall()]
        print("  Tables:", tables)
        for t in ["eval_runs", "eval_results", "experiment_variant_eval_summaries", "runs", "experiment_variants"]:
            if t in tables:
                cur.execute(f"SELECT COUNT(*) FROM {t}")
                count = cur.fetchone()[0]
                print(f"    - {t}: {count} rows")
    except Exception as e:
        print("  Error:", e)
    finally:
        conn.close()

def main():
    check_db("dev.db", DEV_DB)
    check_db("autoharness.db", AUTOHARNESS_DB)

if __name__ == "__main__":
    main()
