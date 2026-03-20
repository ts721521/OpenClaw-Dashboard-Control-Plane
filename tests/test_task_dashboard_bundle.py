import os
import unittest


class TestTaskDashboardBundle(unittest.TestCase):
    def test_task_bundle_contains_bootstrap_marker(self):
        bundle_path = "static/build/task_dashboard.js"
        if not os.path.exists(bundle_path):
            self.skipTest("bundle not built")
        with open(bundle_path, "r", encoding="utf-8") as handle:
            contents = handle.read()
        self.assertIn("__TASK_DASHBOARD_BOOTSTRAP__", contents)

    def test_task_bundle_contains_closure_panel_strings(self):
        bundle_path = "static/build/task_dashboard.js"
        if not os.path.exists(bundle_path):
            self.skipTest("bundle not built")
        with open(bundle_path, "r", encoding="utf-8") as handle:
            contents = handle.read()
        self.assertIn("闭环状态", contents)
        self.assertIn("下一步建议", contents)

    def test_task_bundle_team_links_stay_in_task_center(self):
        bundle_path = "static/build/task_dashboard.js"
        if not os.path.exists(bundle_path):
            self.skipTest("bundle not built")
        with open(bundle_path, "r", encoding="utf-8") as handle:
            contents = handle.read()
        self.assertIn('task_dashboard.html?team=', contents)
        self.assertNotIn('team_dashboard.html?team=', contents)
