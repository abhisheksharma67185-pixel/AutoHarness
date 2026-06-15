import unittest
from fastapi.testclient import TestClient
from app.main import app
from app.db.session import SessionLocal
from app.domain.models import Run, FailureMode, EvalSuite, EvalCase, EvalRun, EvalRunResult
from app.jobs.evals_runner import execute_eval_run

class TestEvals(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        self.db = SessionLocal()

    def tearDown(self):
        self.db.close()

    def test_eval_suite_lifecycle(self):
        # 1. Fetch a failure mode from the database
        fm = self.db.query(FailureMode).first()
        if not fm:
            self.skipTest("No failure modes found in database. Skip eval suite tests.")

        # Ensure it has members to run tests with
        from app.domain.models import FailureModeMember
        member_count = self.db.query(FailureModeMember).filter(FailureModeMember.failure_mode_id == fm.id).count()
        if member_count == 0:
            # Let's link a member manually to ensure we can create a suite
            from app.domain.models import FailureLabel
            fl = self.db.query(FailureLabel).first()
            if fl:
                m = FailureModeMember(
                    failure_mode_id=fm.id,
                    failure_label_id=fl.id,
                    distance=0.0
                )
                self.db.add(m)
                self.db.commit()

        # 2. POST /api/v1/eval-suites/from-failure-mode
        payload = {
            "failure_mode_id": fm.id,
            "name": "Test Eval Suite From Failure Mode",
            "description": "A test eval suite generated from failures of type: " + fm.name,
            "max_cases": 5,
            "scoring_strategy": "benchmark_native"
        }
        response = self.client.post("/api/v1/eval-suites/from-failure-mode", json=payload)
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIn("data", data)
        suite_id = data["data"]["id"]
        self.assertEqual(data["data"]["name"], payload["name"])
        self.assertEqual(data["data"]["source_type"], "failure_mode")
        self.assertTrue(data["data"]["case_count"] > 0)

        # 3. GET /api/v1/eval-suites (List)
        list_response = self.client.get("/api/v1/eval-suites")
        self.assertEqual(list_response.status_code, 200)
        suites_data = list_response.json()["data"]
        self.assertTrue(len(suites_data) > 0)
        self.assertTrue(any(s["id"] == suite_id for s in suites_data))

        # 4. GET /api/v1/eval-suites/{id} (Details)
        detail_response = self.client.get(f"/api/v1/eval-suites/{suite_id}")
        self.assertEqual(detail_response.status_code, 200)
        self.assertEqual(detail_response.json()["data"]["id"], suite_id)

        # 5. GET /api/v1/eval-suites/{id}/cases (Paginated Cases)
        cases_response = self.client.get(f"/api/v1/eval-suites/{suite_id}/cases?page=1&page_size=2")
        self.assertEqual(cases_response.status_code, 200)
        cases_data = cases_response.json()
        self.assertIn("data", cases_data)
        self.assertIn("pagination", cases_data)
        self.assertTrue(len(cases_data["data"]) > 0)
        self.assertEqual(cases_data["pagination"]["page"], 1)

        # 6. POST /api/v1/eval-runs (Offline Replay)
        run_payload = {
            "eval_suite_id": suite_id,
            "harness_version_id": "harbor-0.13.2",
            "mode": "offline_replay"
        }
        run_response = self.client.post("/api/v1/eval-runs", json=run_payload)
        self.assertEqual(run_response.status_code, 202)
        eval_run_id = run_response.json()["data"]["id"]

        # Query metrics and results
        self.db.expire_all()
        eval_run = self.db.query(EvalRun).filter(EvalRun.id == eval_run_id).first()
        self.assertEqual(eval_run.status, "completed")
        self.assertIsNotNone(eval_run.metrics)
        self.assertIn("pass_rate", eval_run.metrics)
        self.assertIn("avg_score", eval_run.metrics)

        # Call GET /api/v1/eval-runs/{id}
        run_detail_resp = self.client.get(f"/api/v1/eval-runs/{eval_run_id}")
        self.assertEqual(run_detail_resp.status_code, 200)
        self.assertEqual(run_detail_resp.json()["data"]["status"], "completed")

        # Call GET /api/v1/eval-runs/{id}/results
        results_resp = self.client.get(f"/api/v1/eval-runs/{eval_run_id}/results")
        self.assertEqual(results_resp.status_code, 200)
        results_data = results_resp.json()["data"]
        self.assertEqual(len(results_data), eval_run.metrics["total_cases"])
        for res in results_data:
            self.assertEqual(res["eval_run_id"], eval_run_id)
            self.assertIn(res["status"], ["pass", "fail", "error"])

        # 7. POST /api/v1/eval-runs (Online Rerun)
        rerun_payload = {
            "eval_suite_id": suite_id,
            "harness_version_id": "harbor-rerun-test",
            "mode": "online_rerun"
        }
        import subprocess
        from unittest.mock import patch
        with patch("app.jobs.evals_runner.subprocess.run") as mock_run:
            mock_run.side_effect = subprocess.CalledProcessError(1, "harbor run")
            rerun_response = self.client.post("/api/v1/eval-runs", json=rerun_payload)
        self.assertEqual(rerun_response.status_code, 202)
        rerun_id = rerun_response.json()["data"]["id"]

        self.db.expire_all()
        rerun = self.db.query(EvalRun).filter(EvalRun.id == rerun_id).first()
        self.assertEqual(rerun.status, "completed")
        self.assertIsNotNone(rerun.metrics)
        self.assertTrue(rerun.metrics["total_cases"] > 0)

        # Cleanup created suite and runs to keep test clean
        self.db.delete(rerun)
        self.db.delete(eval_run)
        suite = self.db.query(EvalSuite).filter(EvalSuite.id == suite_id).first()
        if suite:
            self.db.delete(suite)
        self.db.commit()

    def test_manual_suite_lifecycle(self):
        # Test POST /api/v1/eval-suites
        suite_payload = {
            "name": "Test Manual Eval Suite",
            "description": "A manually created test evaluation suite",
            "benchmark_slug": "terminal-bench@2.0",
            "source_type": "manual",
            "scoring_strategy": "benchmark_native",
            "case_count": 0
        }
        response = self.client.post("/api/v1/eval-suites", json=suite_payload)
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIn("data", data)
        suite_id = data["data"]["id"]
        self.assertEqual(data["data"]["name"], suite_payload["name"])

        # Test POST /api/v1/eval-suites/{id}/cases
        case_payload = {
            "eval_suite_id": suite_id,
            "benchmark_task_id": "test-task-1",
            "input_spec": {"cmd": "echo hello"},
            "expected_spec": {"stdout": "hello"},
            "scoring_strategy": "benchmark_native",
            "weight": 1.0
        }
        case_response = self.client.post(f"/api/v1/eval-suites/{suite_id}/cases", json=case_payload)
        self.assertEqual(case_response.status_code, 200)
        case_data = case_response.json()
        self.assertIn("data", case_data)
        self.assertEqual(case_data["data"]["benchmark_task_id"], case_payload["benchmark_task_id"])

        # Clean up
        suite = self.db.query(EvalSuite).filter(EvalSuite.id == suite_id).first()
        if suite:
            self.db.delete(suite)
        self.db.commit()

if __name__ == "__main__":
    unittest.main()

