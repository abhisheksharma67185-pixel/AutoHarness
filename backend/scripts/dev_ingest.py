#!/usr/bin/env python3
"""
dev_ingest.py — CLI tool to ingest a Harbor job artifact into the dev DB.

Usage:
    cd backend/
    python3 scripts/dev_ingest.py                            # ingest sample fixture
    python3 scripts/dev_ingest.py ./harbor_jobs/my-job-dir  # ingest specific dir
    python3 scripts/dev_ingest.py --list                     # list all job dirs
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

# Add backend/ to sys.path so app imports work
sys.path.insert(0, str(Path(__file__).parent.parent))

from app.core.settings import get_settings
from app.db.base import Base
from app.db.session import engine, SessionLocal
from app.jobs.harbor_rerun import ingest_harbor_job

settings = get_settings()

def _list_jobs() -> None:
    jobs_root = Path(settings.harbor_jobs_dir).expanduser().resolve()
    if not jobs_root.exists():
        print(f"No harbor_jobs directory found at: {jobs_root}")
        return
    dirs = sorted(jobs_root.iterdir())
    if not dirs:
        print("No job directories found.")
        return
    print(f"\nHarbor job directories in {jobs_root}:\n")
    for d in dirs:
        if d.is_dir():
            has_result = (d / "result.json").exists()
            trial_count = sum(1 for p in d.iterdir() if p.is_dir())
            print(f"  {'✅' if has_result else '⚠️ '} {d.name}  ({trial_count} trials)")
    print()


def _ingest(job_dir: Path) -> None:
    print(f"\n🔄 Ingesting: {job_dir}\n")

    # Ensure tables exist
    Base.metadata.create_all(bind=engine)

    db = SessionLocal()
    try:
        run = ingest_harbor_job(job_dir, db)
        db.commit()

        metrics = run.metrics or {}
        print("✅ Ingestion successful!\n")
        print(f"   Run ID:      {run.id}")
        print(f"   Job ID:      {run.job_id}")
        print(f"   Benchmark:   {run.benchmark_slug}")
        print(f"   Agent:       {run.agent_name}")
        print(f"   Label:       {run.run_label}")
        print(f"   Score:       {run.global_score:.1%}")
        print(f"   Pass/Fail:   {metrics.get('passed_tasks', '?')} / {metrics.get('failed_tasks', '?')}")
        print(f"\n   Metrics:\n{json.dumps(metrics, indent=6)}\n")
        print(f"   ➜  curl http://localhost:8001/api/v1/runs/{run.id}")
        print(f"   ➜  curl http://localhost:8001/api/v1/runs/{run.id}/tasks\n")

    except Exception as exc:
        db.rollback()
        print(f"❌ Ingestion failed: {exc}")
        raise
    finally:
        db.close()


def main() -> None:
    args = sys.argv[1:]

    if "--list" in args:
        _list_jobs()
        return

    if args:
        job_dir = Path(args[0]).resolve()
    else:
        # Default: use the sample fixture
        job_dir = (Path(__file__).parent.parent / "harbor_jobs" / "sample-job-20240614").resolve()
        print(f"No path specified — using sample fixture: {job_dir}")

    if not job_dir.exists():
        print(f"❌ Directory not found: {job_dir}")
        sys.exit(1)

    _ingest(job_dir)


if __name__ == "__main__":
    main()
