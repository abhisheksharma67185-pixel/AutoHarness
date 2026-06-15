import sys
from app.db.session import SessionLocal
from app.jobs.embed_failure_labels import embed_failure_labels
from app.jobs.cluster_modes import cluster_failure_modes
from app.domain.models import FailureLabel, FailureMode, FailureModeMember

def main():
    db = SessionLocal()
    try:
        labels_count = db.query(FailureLabel).count()
        print(f"Total failure labels: {labels_count}")
        if labels_count == 0:
            print("No failure labels found! Run diagnosis first.")
            return

        print("Embedding failure labels...")
        embedded = embed_failure_labels(db, "terminal-bench@2.0")
        print(f"Newly embedded: {embedded}")

        print("Running clustering in preview mode...")
        preview_res = cluster_failure_modes(
            db=db,
            benchmark_slug="terminal-bench@2.0",
            min_cluster_size=2,
            is_preview=True
        )
        print(f"Preview clustering result keys: {preview_res.keys()}")
        print(f"Preview modes found: {preview_res['modes_found']}")

        print("Running clustering in write mode...")
        real_res = cluster_failure_modes(
            db=db,
            benchmark_slug="terminal-bench@2.0",
            min_cluster_size=2,
            is_preview=False
        )
        print(f"Real clustering result: {real_res}")

        modes = db.query(FailureMode).filter(FailureMode.benchmark_slug == "terminal-bench@2.0").all()
        print(f"Created {len(modes)} FailureModes in database:")
        for fm in modes:
            members = db.query(FailureModeMember).filter(FailureModeMember.failure_mode_id == fm.id).all()
            print(f" - ID: {fm.id}, Name: {fm.name}, Taxonomy: {fm.taxonomy_primary}, Severity: {fm.severity}, Members count: {len(members)}")

    except Exception as e:
        print(f"Error occurred: {e}")
        import traceback
        traceback.print_exc()
    finally:
        db.close()

if __name__ == "__main__":
    main()
