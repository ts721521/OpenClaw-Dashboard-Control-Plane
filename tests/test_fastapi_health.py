import unittest

from fastapi.testclient import TestClient

from app.main import app


class TestFastAPIHealth(unittest.TestCase):
    def test_health_endpoint(self):
        client = TestClient(app)
        response = client.get("/api/health")
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["status"], "ok")
        self.assertIn("updated_at", payload)
