import os
import sys

BACKEND_DIR = "/Users/abhisheksharma/Projects/AutoHarness-Studio/backend"
sys.path.insert(0, BACKEND_DIR)

from app.db.session import SessionLocal
from app.domain.models import EvalRun, HarnessVersion, Run

def main():
    db = SessionLocal()
    try:
        print("Harness Versions:")
        for hv in db.query(HarnessVersion).all():
            print(f"  ID: {hv.id}, Name: {hv.name}")
            
        print("\nRuns:")
        for r in db.query(Run).all():
            print(f"  ID: {r.id}, harness_version_id: {r.harness_version_id}, harness_version (hybrid): {r.harness_version}")
            
        print("\nEval Runs:")
        for er in db.query(EvalRun).all():
            print(f"  ID: {er.id}, harness_version_id: {er.harness_version_id}, status: {er.status}")
    finally:
        db.close()

if __name__ == "__main__":
    main()
