import os
import sys
import uuid
from datetime import datetime

# Set up paths
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from app.db.session import SessionLocal
from app.domain.models import EvalSuite, EvalCase, EvalRun, FailureModeMember, FailureLabel, RunTask, Run, Benchmark, HarnessVersion
from app.jobs.evals_runner import execute_eval_run

def main():
    db = SessionLocal()
    try:
        # 1. Clean up existing suite with name 'hema'
        print("Cleaning up any existing 'hema' eval suites...")
        existing_suites = db.query(EvalSuite).filter(EvalSuite.name == "hema").all()
        for es in existing_suites:
            print(f"Deleting EvalSuite {es.id}")
            db.delete(es)
        db.commit()

        # 2. Get the benchmark
        benchmark = db.query(Benchmark).filter(Benchmark.slug == "terminal-bench@2.0").first()
        if not benchmark:
            benchmark = db.query(Benchmark).first()
        benchmark_id = benchmark.id if benchmark else 1
        print(f"Using Benchmark: {benchmark.name if benchmark else 'Default'} (ID: {benchmark_id})")

        # 3. Create hema suite
        hema_suite_id = str(uuid.uuid4())
        hema_suite = EvalSuite(
            id=hema_suite_id,
            name="hema",
            benchmark_id=benchmark_id,
            description="Evaluation suite for hema experiment targeting 13 failure modes.",
            created_at=datetime.utcnow()
        )
        db.add(hema_suite)
        db.flush()
        print(f"Created EvalSuite '{hema_suite.name}' with ID: {hema_suite.id}")

        # 4. Fetch target failure modes of the 'hema' experiment
        # Hema Experiment ID: 984002903
        target_fm_ids = [96, 106, 101, 111, 82, 94, 97, 99, 102, 104, 107, 109, 112]
        
        # Get members of these failure modes
        members = db.query(FailureModeMember).filter(FailureModeMember.failure_mode_id.in_(target_fm_ids)).all()
        print(f"Found {len(members)} failure mode members.")

        fl_ids = {m.failure_label_id for m in members}
        print(f"Found {len(fl_ids)} unique failure label IDs.")

        cases_added = 0
        for fl_id in fl_ids:
            fl = db.query(FailureLabel).filter(FailureLabel.id == fl_id).first()
            if not fl:
                continue
            rt = fl.run_task
            if not rt:
                continue
            
            case_id = str(uuid.uuid4())
            case = EvalCase(
                id=case_id,
                failure_label_id=fl.id,
                input_spec={
                    "benchmark_slug": benchmark.slug if benchmark else "terminal-bench@2.0",
                    "benchmark_task_id": rt.benchmark_task.task_id if rt.benchmark_task else "unknown",
                    "run_seed": fl.run_id
                },
                expected_spec={
                    "failed_command": "N/A",
                    "assertions": [{"type": "exit_code", "expected": 0}]
                },
                created_at=datetime.utcnow()
            )
            if rt.benchmark_task:
                case.benchmark_task_id = rt.benchmark_task.task_id
            
            db.add(case)
            hema_suite.cases.append(case)
            cases_added += 1

        db.commit()
        db.refresh(hema_suite)
        print(f"Successfully added {cases_added} cases to the 'hema' evaluation suite.")

        # 5. Run evaluation on Baseline Version (v1.0.0)
        hv_base = db.query(HarnessVersion).filter(HarnessVersion.name == "v1.0.0").first()
        if hv_base:
            run_id_base = str(uuid.uuid4())
            print(f"Creating baseline EvalRun {run_id_base} for harness version '{hv_base.name}'...")
            eval_run_base = EvalRun(
                id=run_id_base,
                eval_suite_id=hema_suite_id,
                harness_version_id=hv_base.id,
                run_mode="offline_replay",
                status="pending",
                metrics={},
                created_at=datetime.utcnow()
            )
            db.add(eval_run_base)
            db.commit()

            execute_eval_run(db, run_id_base)
            db.refresh(eval_run_base)
            metrics_base = eval_run_base.metrics or {}
            print(f"Baseline EvalRun completed! Status: {eval_run_base.status}")
            print(f"Metrics: {metrics_base}")
            print(f"Pass Rate: {metrics_base.get('pass_rate', 0.0) * 100:.2f}%")
        else:
            print("Baseline harness version 'v1.0.0' not found in database.")

        # 6. Run evaluation on Variant Version (v1.0.0-var-1)
        hv_var = db.query(HarnessVersion).filter(HarnessVersion.name == "v1.0.0-var-1").first()
        if hv_var:
            run_id_var = str(uuid.uuid4())
            print(f"Creating variant EvalRun {run_id_var} for harness version '{hv_var.name}'...")
            eval_run_var = EvalRun(
                id=run_id_var,
                eval_suite_id=hema_suite_id,
                harness_version_id=hv_var.id,
                run_mode="offline_replay",
                status="pending",
                metrics={},
                created_at=datetime.utcnow()
            )
            db.add(eval_run_var)
            db.commit()

            execute_eval_run(db, run_id_var)
            db.refresh(eval_run_var)
            metrics_var = eval_run_var.metrics or {}
            print(f"Variant EvalRun completed! Status: {eval_run_var.status}")
            print(f"Metrics: {metrics_var}")
            print(f"Pass Rate: {metrics_var.get('pass_rate', 0.0) * 100:.2f}%")
        else:
            print("Variant harness version 'v1.0.0-var-1' not found in database.")

        # 7. Link hema variant's actual harness version too so iteration runs show up under it
        # If 'v1.0.0-var-1-4823' exists in DB, run it (but since it has no runs, it'll copy/be 0% unless we run it)
        # Actually, let's create a run for 'v1.0.0-var-1-4823' that copies run tasks of 'run-tb2-variant-1' 
        # so that it gets evaluated with actual variant results!
        hv_hema = db.query(HarnessVersion).filter(HarnessVersion.name == "v1.0.0-var-1-4823").first()
        if hv_hema:
            # Let's clone 'run-tb2-variant-1' to 'run-hema-variant' for 'v1.0.0-var-1-4823'
            # to make sure there is a run for offline replay to find!
            print(f"Ensuring a Run exists for '{hv_hema.name}' to enable offline replay...")
            existing_run = db.query(Run).filter(Run.harness_version_id == hv_hema.id).first()
            if not existing_run:
                orig_run = db.query(Run).filter(Run.id == "run-tb2-variant-1").first()
                if orig_run:
                    hema_run_id = f"run-hema-variant-{uuid.uuid4().hex[:6]}"
                    new_run = Run(
                        id=hema_run_id,
                        benchmark_id=orig_run.benchmark_id,
                        harness_version_id=hv_hema.id,
                        run_label=f"Hema Variant run - Replay Source",
                        global_score=orig_run.global_score,
                        metrics=orig_run.metrics,
                        agent_name=orig_run.agent_name,
                        created_at=datetime.utcnow()
                    )
                    db.add(new_run)
                    db.flush()
                    # Copy run tasks
                    for ot in orig_run.tasks:
                        nt = RunTask(
                            run_id=new_run.id,
                            benchmark_task_id=ot.benchmark_task_id,
                            status=ot.status,
                            score=ot.score,
                            raw_result=ot.raw_result,
                            started_at=datetime.utcnow(),
                            finished_at=datetime.utcnow()
                        )
                        db.add(nt)
                    db.commit()
                    print(f"Cloned run tasks from run-tb2-variant-1 to new run {new_run.id} for harness version '{hv_hema.name}'")
            
            # Now run eval run on 'v1.0.0-var-1-4823'
            run_id_hema = str(uuid.uuid4())
            print(f"Creating hema variant EvalRun {run_id_hema} for harness version '{hv_hema.name}'...")
            eval_run_hema = EvalRun(
                id=run_id_hema,
                eval_suite_id=hema_suite_id,
                harness_version_id=hv_hema.id,
                run_mode="offline_replay",
                status="pending",
                metrics={},
                created_at=datetime.utcnow()
            )
            db.add(eval_run_hema)
            db.commit()

            execute_eval_run(db, run_id_hema)
            db.refresh(eval_run_hema)
            metrics_hema = eval_run_hema.metrics or {}
            print(f"Hema Variant EvalRun completed! Status: {eval_run_hema.status}")
            print(f"Metrics: {metrics_hema}")
            print(f"Pass Rate: {metrics_hema.get('pass_rate', 0.0) * 100:.2f}%")

    finally:
        db.close()

if __name__ == "__main__":
    main()
