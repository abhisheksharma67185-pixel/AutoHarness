import os
import sys
import psycopg2
from sqlalchemy import text

BACKEND_DIR = "/Users/abhisheksharma/Projects/AutoHarness-Studio/backend"
sys.path.insert(0, BACKEND_DIR)

from app.db.session import SessionLocal
from app.domain.models import EvalRun, ExperimentVariant

def main():
    db = SessionLocal()
    try:
        # Find matching eval runs for variant 484729663 (which is harness_version_id 2)
        # First check what eval runs exist
        eval_runs = db.query(EvalRun).filter(EvalRun.harness_version_id == 2).all()
        print(f"Found {len(eval_runs)} eval runs with harness_version_id 2:")
        for er in eval_runs:
            print(f"  EvalRun ID: {er.id}, Suite: {er.eval_suite_id}")
            
        variant_id = 484729663
        for er in eval_runs:
            print(f"Linking EvalRun {er.id} to variant {variant_id}...")
            # Let's run the setter logic manually to see the printed error
            er.experiment_variant_id = variant_id
            db.commit()
    except Exception as e:
        print("Exception occurred:", e)
    finally:
        db.close()

if __name__ == "__main__":
    main()
