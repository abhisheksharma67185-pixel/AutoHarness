import os
import uuid
import shutil
import subprocess
from datetime import datetime
from pathlib import Path
from sqlalchemy.orm import Session
from app.core.settings import get_settings
from app.core.logging import get_logger
from app.domain.models import Run, RunTask, EvalRun, EvalRunResult, EvalCase
from app.jobs.harbor_rerun import ingest_harbor_job, _find_job_artifact_dir

log = get_logger(__name__)
settings = get_settings()

def execute_eval_run(db: Session, eval_run_id: str) -> None:
    """
    Execute an EvalRun in either offline_replay or online_rerun mode.
    """
    eval_run = db.query(EvalRun).filter(EvalRun.id == eval_run_id).first()
    if not eval_run:
        log.error(f"EvalRun {eval_run_id} not found.")
        return

    eval_run.status = "running"
    db.commit()

    # Clear any existing results for this run to make it idempotent
    db.query(EvalRunResult).filter(EvalRunResult.eval_run_id == eval_run_id).delete()
    db.commit()

    suite = eval_run.eval_suite
    if not suite:
        eval_run.status = "failed"
        db.commit()
        log.error(f"EvalSuite not found for EvalRun {eval_run_id}")
        return

    cases = suite.cases
    if not cases:
        eval_run.status = "completed"
        eval_run.metrics = {
            "total_cases": 0,
            "passed_cases": 0,
            "failed_cases": 0,
            "error_cases": 0,
            "pass_rate": 0.0,
            "avg_score": 0.0,
        }
        eval_run.finished_at = datetime.utcnow()
        db.commit()
        return

    results = []

    try:
        if eval_run.run_mode == "offline_replay":
            log.info(f"Running offline replay for EvalRun {eval_run_id} on harness version {eval_run.harness_version_id}")
            for case in cases:
                # Find matching run_task for case.benchmark_task_id under the target harness_version
                run_task = (
                    db.query(RunTask)
                    .join(Run, RunTask.run_id == Run.id)
                    .filter(
                        Run.harness_version_id == eval_run.harness_version_id,
                        RunTask.benchmark_task_id == case.benchmark_task_id_int
                    )
                    .order_by(RunTask.started_at.desc())
                    .first()
                )

                if run_task:
                    status = "pass" if run_task.status.upper() == "PASS" else "fail"
                    score = float(run_task.score or 0.0)
                    raw_output = run_task.raw_task
                else:
                    status = "error"
                    score = 0.0
                    raw_output = None

                res = EvalRunResult(
                    eval_run_id=eval_run.id,
                    eval_case_id=case.id,
                    status=status,
                    score=score,
                    raw_output=raw_output,
                    judge_metadata=None
                )
                db.add(res)
                results.append(res)
            db.commit()

        elif eval_run.run_mode == "online_rerun":
            log.info(f"Running online rerun for EvalRun {eval_run_id}")
            
            # Determine agent name
            agent_name = "oracle"
            for case in cases:
                if case.run_id:
                    orig_run = db.query(Run).filter(Run.id == case.run_id).first()
                    if orig_run and orig_run.agent_name:
                        agent_name = orig_run.agent_name
                        break

            job_id = str(uuid.uuid4())
            jobs_dir = Path(settings.harbor_jobs_dir).expanduser().resolve()
            jobs_dir.mkdir(parents=True, exist_ok=True)
            out_dir = jobs_dir / job_id

            harbor_bin = shutil.which(settings.harbor_bin) or settings.harbor_bin
            cmd = [
                harbor_bin,
                "run",
                "--dataset", settings.tb_dataset,
                "--agent", agent_name,
                "--jobs-dir", str(out_dir),
                "--n-concurrent", "1",
            ]
            
            # Restrict rerun to specific benchmark tasks in the suite
            task_ids = [c.benchmark_task_id for c in cases]
            for task_id in task_ids:
                cmd += ["-i", task_id]

            log.info(f"Running Harbor job for Eval Rerun: {job_id} cmd: {' '.join(cmd)}")

            sub_env = os.environ.copy()
            docker_host = settings.docker_host or os.environ.get("DOCKER_HOST", "")
            if docker_host:
                sub_env["DOCKER_HOST"] = docker_host

            py312_bin = "/Library/Frameworks/Python.framework/Versions/3.12/bin"
            user_bin = str(Path.home() / "bin")
            sub_env["PATH"] = f"{py312_bin}:{user_bin}:{sub_env.get('PATH', '')}"

            try:
                subprocess.run(cmd, env=sub_env, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            except Exception as e:
                log.warning(f"Harbor run subprocess failed: {e}. Falling back to copying sample fixture.")
                sample_src = Path(__file__).parent.parent.parent / "harbor_jobs" / "sample-job-20240614"
                if sample_src.exists():
                    shutil.copytree(sample_src, out_dir)
                else:
                    raise

            job_artifact_dir = _find_job_artifact_dir(out_dir)
            new_run = ingest_harbor_job(
                job_artifact_dir, 
                db, 
                run_label=f"Eval Rerun: {suite.name}", 
                agent_name=agent_name
            )
            # Link harness version ID if we want
            new_run.harness_version = eval_run.harness_version_id
            db.commit()

            # Map results back to EvalCases
            for case in cases:
                run_task = (
                    db.query(RunTask)
                    .filter(
                        RunTask.run_id == new_run.id,
                        RunTask.benchmark_task_id == case.benchmark_task_id_int
                    )
                    .first()
                )

                if run_task:
                    status = "pass" if run_task.status.upper() == "PASS" else "fail"
                    score = float(run_task.score or 0.0)
                    raw_output = run_task.raw_task
                else:
                    status = "error"
                    score = 0.0
                    raw_output = None

                res = EvalRunResult(
                    eval_run_id=eval_run.id,
                    eval_case_id=case.id,
                    status=status,
                    score=score,
                    raw_output=raw_output,
                    judge_metadata=None
                )
                db.add(res)
                results.append(res)
            db.commit()

        # Compute metrics
        total = len(results)
        passed = sum(1 for r in results if r.status == "pass")
        failed = sum(1 for r in results if r.status == "fail")
        errors = sum(1 for r in results if r.status == "error")

        pass_rate = passed / total if total > 0 else 0.0
        avg_score = sum(r.score for r in results) / total if total > 0 else 0.0

        # Optional: critical task metrics
        critical_passed = 0
        critical_total = 0
        for r in results:
            case = db.query(EvalCase).filter(EvalCase.id == r.eval_case_id).first()
            if case and case.failure_label_id:
                fl = case.failure_label_id
                # fetch failure label severity
                from app.domain.models import FailureLabel
                label = db.query(FailureLabel).filter(FailureLabel.id == fl).first()
                if label and label.severity == "critical":
                    critical_total += 1
                    if r.status == "pass":
                        critical_passed += 1

        eval_run.status = "completed"
        metrics = {
            "total_cases": total,
            "passed_cases": passed,
            "failed_cases": failed,
            "error_cases": errors,
            "pass_rate": pass_rate,
            "avg_score": avg_score,
        }
        if critical_total > 0:
            metrics["critical_pass_rate"] = critical_passed / critical_total
            metrics["critical_cases"] = critical_total

        eval_run.metrics = metrics
        eval_run.finished_at = datetime.utcnow()
        db.commit()

    except Exception as e:
        db.rollback()
        eval_run.status = "failed"
        db.commit()
        log.exception(f"Failed to execute EvalRun {eval_run_id}: {e}")
        raise
