import unittest
import uuid
from datetime import datetime
from fastapi.testclient import TestClient
from app.main import app
from app.db.session import SessionLocal
from app.domain.models import (
    Experiment, ExperimentVariant, EvalSuite, EvalRun, Run, FailureMode
)

class TestExperiments(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        self.db = SessionLocal()

    def tearDown(self):
        self.db.close()

    def test_experiment_lifecycle_and_scorecard_gating(self):
        # 1. Setup mock failure mode / target suite
        suite_target_id = "test-suite-target-" + str(uuid.uuid4())[:8]
        suite_target = EvalSuite(
            id=suite_target_id,
            benchmark_slug="terminal-bench-exp-test",
            name="Target CWD Suite",
            description="Testing CWD failure regressions",
            source_type="manual",
            scoring_strategy="benchmark_native"
        )
        
        suite_guard_id = "test-suite-guard-" + str(uuid.uuid4())[:8]
        suite_guard = EvalSuite(
            id=suite_guard_id,
            benchmark_slug="terminal-bench-exp-test",
            name="Critical Guard Suite",
            description="Testing safety/critical regressions",
            source_type="manual",
            scoring_strategy="benchmark_native"
        )
        
        self.db.add(suite_target)
        self.db.add(suite_guard)
        self.db.commit()

        # 2. Create Experiment
        exp_payload = {
            "benchmark_slug": "terminal-bench-exp-test",
            "name": "Improve CWD Working Directory",
            "description": "Fix agent CWD command execution errors",
            "base_harness_version_id": "hv-baseline-test-v1",
            "target_description": "Boost CWD pass rate by 30% and ensure guard suites do not regress.",
            "targets": [
                {
                    "type": "eval_suite",
                    "id": suite_target_id,
                    "desired_delta": 0.30
                }
            ],
            "regression_policy": {
                "guard_suites": [
                    {
                        "eval_suite_id": suite_guard_id,
                        "max_allowed_drop": 0.0
                    }
                ],
                "global_min_success_rate": 0.50
            }
        }
        
        create_resp = self.client.post("/api/v1/experiments", json=exp_payload)
        self.assertEqual(create_resp.status_code, 200)
        exp_id = create_resp.json()["data"]["experiment_id"]

        # 3. Register Variant
        variant_payload = {
            "variant_label": "agent-with-cwd-middleware",
            "harness_version_id": "hv-cwd-variant-v1"
        }
        variant_resp = self.client.post(f"/api/v1/experiments/{exp_id}/variants", json=variant_payload)
        self.assertEqual(variant_resp.status_code, 200)
        variant_id = variant_resp.json()["data"]["experiment_variant_id"]

        # 4. Link Eval Runs to Variant
        # Create baseline completed EvalRuns
        run_base_target = EvalRun(
            id=str(uuid.uuid4()),
            eval_suite_id=suite_target_id,
            harness_version_id="hv-baseline-test-v1",
            run_mode="offline_replay",
            status="completed",
            metrics={"pass_rate": 0.40, "avg_score": 0.40},
            created_at=datetime.utcnow()
        )
        run_base_guard = EvalRun(
            id=str(uuid.uuid4()),
            eval_suite_id=suite_guard_id,
            harness_version_id="hv-baseline-test-v1",
            run_mode="offline_replay",
            status="completed",
            metrics={"pass_rate": 0.90, "avg_score": 0.90},
            created_at=datetime.utcnow()
        )
        
        # Create variant completed EvalRuns
        run_var_target = EvalRun(
            id=str(uuid.uuid4()),
            eval_suite_id=suite_target_id,
            harness_version_id="hv-cwd-variant-v1",
            run_mode="offline_replay",
            status="completed",
            metrics={"pass_rate": 0.80, "avg_score": 0.80},
            created_at=datetime.utcnow(),
            experiment_variant_id=variant_id  # linked directly
        )
        run_var_guard = EvalRun(
            id=str(uuid.uuid4()),
            eval_suite_id=suite_guard_id,
            harness_version_id="hv-cwd-variant-v1",
            run_mode="offline_replay",
            status="completed",
            metrics={"pass_rate": 0.95, "avg_score": 0.95},
            created_at=datetime.utcnow()
        )
        
        self.db.add(run_base_target)
        self.db.add(run_base_guard)
        self.db.add(run_var_target)
        self.db.add(run_var_guard)
        self.db.commit()

        # Link the run_var_guard via API endpoint
        link_resp = self.client.post(
            f"/api/v1/experiments/{exp_id}/variants/{variant_id}/link-eval-run",
            json={"eval_run_id": run_var_guard.id}
        )
        self.assertEqual(link_resp.status_code, 200)

        # 5. Compute promotion (Expected: PROMOTED since target +40% >= +30%, guard +5% >= 0%, overall average pass rate: 87.5% >= 50%)
        promo_resp = self.client.post(f"/api/v1/experiments/{exp_id}/variants/{variant_id}/compute-promotion")
        self.assertEqual(promo_resp.status_code, 200)
        promo_data = promo_resp.json()["data"]
        self.assertEqual(promo_data["decision"], "promoted")
        self.assertEqual(promo_data["summary_metrics"]["targets"][0]["delta"], 0.40)
        self.assertEqual(promo_data["summary_metrics"]["guards"][0]["delta"], 0.05)

        # Verify DB persisted fields
        self.db.expire_all()
        v = self.db.query(ExperimentVariant).filter(ExperimentVariant.id == variant_id).first()
        self.assertEqual(v.status, "promoted")
        self.assertIsNotNone(v.promoted_at)

        # 6. Test Gating Gaps (rejection scenarios)
        # Create a second variant where target fails to improve enough
        variant_payload_fail = {
            "variant_label": "bad-cwd-variant",
            "harness_version_id": "hv-bad-cwd-v1"
        }
        var_fail_resp = self.client.post(f"/api/v1/experiments/{exp_id}/variants", json=variant_payload_fail)
        var_fail_id = var_fail_resp.json()["data"]["experiment_variant_id"]

        run_fail_target = EvalRun(
            id=str(uuid.uuid4()),
            eval_suite_id=suite_target_id,
            harness_version_id="hv-bad-cwd-v1",
            run_mode="offline_replay",
            status="completed",
            metrics={"pass_rate": 0.45, "avg_score": 0.45}, # improvement is only +5% (needs 30%)
            created_at=datetime.utcnow(),
            experiment_variant_id=var_fail_id
        )
        run_fail_guard = EvalRun(
            id=str(uuid.uuid4()),
            eval_suite_id=suite_guard_id,
            harness_version_id="hv-bad-cwd-v1",
            run_mode="offline_replay",
            status="completed",
            metrics={"pass_rate": 0.85, "avg_score": 0.85}, # guard regressed by -5% (needs >= 0%)
            created_at=datetime.utcnow(),
            experiment_variant_id=var_fail_id
        )
        self.db.add(run_fail_target)
        self.db.add(run_fail_guard)
        self.db.commit()

        promo_fail_resp = self.client.post(f"/api/v1/experiments/{exp_id}/variants/{var_fail_id}/compute-promotion")
        self.assertEqual(promo_fail_resp.status_code, 200)
        promo_fail_data = promo_fail_resp.json()["data"]
        self.assertEqual(promo_fail_data["decision"], "rejected")
        
        # Verify DB persisted fields for the failed variant
        self.db.expire_all()
        vf = self.db.query(ExperimentVariant).filter(ExperimentVariant.id == var_fail_id).first()
        self.assertEqual(vf.status, "rejected")
        self.assertIsNone(vf.promoted_at)

        # 7. List and details validation
        list_exp_resp = self.client.get("/api/v1/experiments")
        self.assertEqual(list_exp_resp.status_code, 200)
        self.assertTrue(len(list_exp_resp.json()["data"]) > 0)

        detail_exp_resp = self.client.get(f"/api/v1/experiments/{exp_id}")
        self.assertEqual(detail_exp_resp.status_code, 200)
        self.assertEqual(detail_exp_resp.json()["data"]["name"], "Improve CWD Working Directory")

        list_vars_resp = self.client.get(f"/api/v1/experiments/{exp_id}/variants")
        self.assertEqual(list_vars_resp.status_code, 200)
        self.assertEqual(len(list_vars_resp.json()["data"]), 2)

        # Cleanup
        self.db.delete(vf)
        self.db.delete(v)
        self.db.delete(run_fail_target)
        self.db.delete(run_fail_guard)
        self.db.delete(run_base_target)
        self.db.delete(run_base_guard)
        self.db.delete(run_var_target)
        self.db.delete(run_var_guard)
        self.db.delete(suite_target)
        self.db.delete(suite_guard)
        exp = self.db.query(Experiment).filter(Experiment.id == exp_id).first()
        if exp:
            self.db.delete(exp)
        self.db.commit()

if __name__ == "__main__":
    unittest.main()
