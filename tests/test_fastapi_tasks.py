import unittest

from fastapi.testclient import TestClient

from app.main import app


class TestFastAPITasks(unittest.TestCase):
    def test_tasks_endpoint_returns_payload(self):
        client = TestClient(app)
        response = client.get("/api/tasks")
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertIn("tasks", payload)
