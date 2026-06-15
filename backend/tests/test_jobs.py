import subprocess
import unittest
from unittest.mock import patch, MagicMock
from fastapi.testclient import TestClient
from app.main import app
from app.db.session import SessionLocal
from app.domain.models import Run

class TestJobs(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def test_harbor_rerun_endpoint(self):
        # Trigger harbor rerun with oracle agent, mocking subprocess to trigger quick fallback
        with patch("app.jobs.harbor_rerun.subprocess.run") as mock_run:
            mock_run.side_effect = subprocess.CalledProcessError(1, "harbor run")
            response = self.client.post("/api/v1/jobs/harbor-rerun", json={
                "agent_name": "oracle"
            })
        self.assertEqual(response.status_code, 202)
        data = response.json()
        self.assertIn("data", data)
        self.assertIn("job_id", data["data"])
        self.assertIn("run_id", data["data"])

    def test_diagnose_endpoint(self):
        # Fetch the run ID from the DB
        db = SessionLocal()
        run = db.query(Run).first()
        db.close()

        if not run:
            self.skipTest("No runs found in database to diagnose.")

        # Mock the LLM client to avoid real network calls during testing
        mock_llm_response = {
            "diagnosis_text": "Test diagnosis: agent failed due to a mocked LLM response.",
            "taxonomy_primary": "tool_misuse",
            "severity": "medium",
            "confidence": "high"
        }
        with patch("app.jobs.diagnose_run.llm_client") as mock_llm:
            mock_llm.chat_json.return_value = (mock_llm_response, 42.0)
            mock_llm.model = "mock-model-v1"
            response = self.client.post("/api/v1/jobs/diagnose-failures", json={
                "run_id": run.id
            })
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIn("data", data)
        self.assertIn("job_id", data["data"])
        self.assertIn("diagnosed", data["data"])

if __name__ == "__main__":
    unittest.main()
