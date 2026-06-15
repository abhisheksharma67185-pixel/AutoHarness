import uuid
from datetime import datetime
from app.db.session import SessionLocal
from app.domain.models import Experiment, ExperimentVariant, EvalSuite, EvalRun
from app.api.v1.experiments import compute_promotion

def create_all_experiments():
    db = SessionLocal()
    try:
        # Get target suites by name
        suite_code_bug = db.query(EvalSuite).filter(EvalSuite.name == "Python & Runtime Code Bugs").first()
        suite_network = db.query(EvalSuite).filter(EvalSuite.name == "Network & Upstream Dependencies").first()
        suite_tool_misuse = db.query(EvalSuite).filter(EvalSuite.name == "Agent Logic & Tool Misuse").first()

        # Find the respective completed EvalRuns for variant version "v1.0.0-var-1"
        run_code_bug = db.query(EvalRun).filter(
            EvalRun.eval_suite_id == (suite_code_bug.id if suite_code_bug else None),
            EvalRun.harness_version_id == "v1.0.0-var-1"
        ).first()

        run_network = db.query(EvalRun).filter(
            EvalRun.eval_suite_id == (suite_network.id if suite_network else None),
            EvalRun.harness_version_id == "v1.0.0-var-1"
        ).first()

        run_tool_misuse = db.query(EvalRun).filter(
            EvalRun.eval_suite_id == (suite_tool_misuse.id if suite_tool_misuse else None),
            EvalRun.harness_version_id == "v1.0.0-var-1"
        ).first()

        # Define the new experiments
        experiments_def = [
            {
                "id": "exp_code_bug",
                "name": "Fix Alembic Migration Scripts",
                "description": "Experiment targeting schema type mismatch exceptions in Alembic python migration scripts.",
                "targets": [{"type": "failure_mode", "id": "fm2", "desired_delta": 0.2}],
                "regression_policy": {
                    "guard_suites": [{"eval_suite_id": "es1", "max_allowed_drop": 0.0}],
                    "global_min_success_rate": 0.5
                },
                "variant": {
                    "id": "ev_code_bug",
                    "label": "alembic-existing-type-check",
                    "run": run_code_bug
                }
            },
            {
                "id": "exp_network",
                "name": "Implement Connection Retries",
                "description": "Add automatic host resolution retry middleware to handle network and connection timeouts.",
                "targets": [{"type": "failure_mode", "id": "fm4", "desired_delta": 0.2}],
                "regression_policy": {
                    "guard_suites": [{"eval_suite_id": "es1", "max_allowed_drop": 0.0}],
                    "global_min_success_rate": 0.5
                },
                "variant": {
                    "id": "ev_network",
                    "label": "connection-timeout-retry",
                    "run": run_network
                }
            },
            {
                "id": "exp_tool_misuse",
                "name": "Resolve Config Path Ambiguities",
                "description": "Teach the agent logic to prioritize production over local YAML/JSON configurations when searching.",
                "targets": [{"type": "failure_mode", "id": "fm6", "desired_delta": 0.2}],
                "regression_policy": {
                    "guard_suites": [{"eval_suite_id": "es1", "max_allowed_drop": 0.0}],
                    "global_min_success_rate": 0.5
                },
                "variant": {
                    "id": "ev_tool_misuse",
                    "label": "config-path-prioritization",
                    "run": run_tool_misuse
                }
            }
        ]

        for exp_info in experiments_def:
            # Check if experiment already exists
            existing = db.query(Experiment).filter(Experiment.name == exp_info["name"]).first()
            if existing:
                print(f"Experiment '{exp_info['name']}' already exists. Skipping.")
                continue

            # Create Experiment
            exp = Experiment(
                id=exp_info["id"],
                benchmark_slug="terminal-bench@2.0",
                name=exp_info["name"],
                description=exp_info["description"],
                base_harness_version_id="v1.0.0",
                target_description=exp_info["description"],
                targets=exp_info["targets"],
                regression_policy=exp_info["regression_policy"],
                created_at=datetime.utcnow()
            )
            db.add(exp)
            db.flush()
            print(f"Created Experiment '{exp_info['name']}' with ID: {exp.id}")

            # Create Variant
            var_info = exp_info["variant"]
            var = ExperimentVariant(
                id=var_info["id"],
                experiment_id=exp.id,
                variant_label=var_info["label"],
                harness_version_id="v1.0.0-var-1",
                status="pending",
                summary_metrics=None,
                created_at=datetime.utcnow()
            )
            db.add(var)
            db.flush()
            print(f"  Created Variant '{var_info['label']}' with ID: {var.id}")

            # Link Eval Run if we found one
            if var_info["run"]:
                eval_run = var_info["run"]
                eval_run.experiment_variant_id = var.id
                print(f"  Linked EvalRun '{eval_run.id}' to Variant '{var.id}'.")

        db.commit()

        # Compute promotion for each variant
        for exp_info in experiments_def:
            var_info = exp_info["variant"]
            try:
                result = compute_promotion(exp_info["id"], var_info["id"], db)
                print(f"Computed promotion for '{exp_info['name']}': decision = {result.get('decision')}")
            except Exception as prom_err:
                print(f"Error computing promotion for '{exp_info['name']}': {prom_err}")

        db.commit()
        print("All experiments successfully seeded and variants promoted!")

    finally:
        db.close()

if __name__ == "__main__":
    create_all_experiments()
