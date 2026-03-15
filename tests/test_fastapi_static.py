import unittest

from fastapi.testclient import TestClient

from app.main import app


class TestFastAPIStatic(unittest.TestCase):
    def test_task_dashboard_html(self):
        client = TestClient(app)
        response = client.get("/task_dashboard.html")
        self.assertEqual(response.status_code, 200)
        self.assertIn("任务管理中心", response.text)
