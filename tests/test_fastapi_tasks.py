import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

from app.main import app


class TestFastAPITasks(unittest.TestCase):
    def test_tasks_endpoint_returns_payload(self):
        client = TestClient(app)
        response = client.get("/api/tasks")
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertIn("tasks", payload)

    def test_task_delete_route_registered(self):
        routes = {(route.path, method) for route in app.routes for method in getattr(route, "methods", [])}
        self.assertIn(("/api/task/delete", "POST"), routes)

    def test_apply_recommended_action_route_registered(self):
        routes = {(route.path, method) for route in app.routes for method in getattr(route, "methods", [])}
        self.assertIn(("/api/tasks/{task_id}/apply-recommended-action", "POST"), routes)

    def test_apply_recommended_action_endpoint_calls_service(self):
        client = TestClient(app)
        with patch("app.main.SERVICE.apply_recommended_action") as mocked:
            mocked.return_value = {"ok": True, "task_id": "TASK-1", "applied_action": "restart_task"}
            response = client.post(
                "/api/tasks/TASK-1/apply-recommended-action",
                json={"actor_id": "dashboard-ui", "actor_role": "admin"},
            )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["applied_action"], "restart_task")
        mocked.assert_called_once()
