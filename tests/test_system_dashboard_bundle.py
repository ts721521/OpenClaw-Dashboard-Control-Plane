import os
import unittest


class TestSystemDashboardBundle(unittest.TestCase):
    def test_system_bundle_contains_bootstrap_marker(self):
        bundle_path = "static/build/system_dashboard.js"
        self.assertTrue(os.path.exists(bundle_path))
        with open(bundle_path, "r", encoding="utf-8") as handle:
            contents = handle.read()
        self.assertIn("__SYSTEM_DASHBOARD_BOOTSTRAP__", contents)
