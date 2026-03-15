import unittest

from fastapi.testclient import TestClient

from app.main import app


class TestFastAPIGovernance(unittest.TestCase):
    def test_reviews_endpoint(self):
        client = TestClient(app)
        response = client.get("/api/reviews")
        self.assertEqual(response.status_code, 200)
        self.assertIn("reviews", response.json())

    def test_change_tasks_endpoint(self):
        client = TestClient(app)
        response = client.get("/api/change-tasks")
        self.assertEqual(response.status_code, 200)
        self.assertIn("changes", response.json())

    def test_team_state_machines_endpoint(self):
        client = TestClient(app)
        response = client.get("/api/config/team-state-machines")
        self.assertEqual(response.status_code, 200)
        self.assertIn("doc", response.json())
