import unittest

from fastapi.testclient import TestClient

from app.main import app


class TestFastAPIStatic(unittest.TestCase):
    def test_task_dashboard_html(self):
        client = TestClient(app)
        response = client.get("/task_dashboard.html")
        self.assertEqual(response.status_code, 200)
        self.assertIn("任务管理中心", response.text)
        self.assertIn("闭环状态", response.text)
        self.assertIn("下一步建议", response.text)
        self.assertIn("一键应用建议", response.text)
        self.assertIn("最近操作结果", response.text)
        self.assertIn("请输入交接说明", response.text)
        self.assertIn("请概括本次交接产物", response.text)
        self.assertIn("request-business-input", response.text)
        self.assertIn("assign-owner", response.text)
        self.assertIn("confirm-handoff", response.text)
        self.assertIn("return-to-rework-owner", response.text)
        self.assertNotIn("system_dashboard.html?governance=review", response.text)
        self.assertNotIn('href="team_dashboard.html"', response.text)

    def test_team_dashboard_html(self):
        client = TestClient(app)
        response = client.get("/team_dashboard.html")
        self.assertEqual(response.status_code, 200)
        self.assertIn("团队辅助视图", response.text)
        self.assertIn("团队总览", response.text)
        self.assertIn("独立 Agent", response.text)
        self.assertIn("临时召唤", response.text)
        self.assertNotIn("team_standalone.html", response.text)
        self.assertNotIn("team_temporary.html", response.text)

    def test_legacy_team_subpages_are_retired(self):
        client = TestClient(app)
        self.assertEqual(client.get("/team_standalone.html").status_code, 404)
        self.assertEqual(client.get("/team_temporary.html").status_code, 404)

    def test_system_dashboard_uses_four_subviews(self):
        client = TestClient(app)
        response = client.get("/system_dashboard.html")
        self.assertEqual(response.status_code, 200)
        self.assertIn("架构关系图", response.text)
        self.assertIn("团队间流程", response.text)
        self.assertIn("团队内流程", response.text)
        self.assertIn("流程详情", response.text)
        self.assertIn("自动布局", response.text)
        self.assertIn("重置布局", response.text)
        self.assertIn("适配视图", response.text)
        self.assertNotIn("治理中心", response.text)
        self.assertNotIn('href="team_dashboard.html"', response.text)
