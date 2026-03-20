import unittest
from pathlib import Path


SCRIPT_PATH = Path("/Users/tianshuai/.openclaw/workspace/dashboard-live/scripts/control_plane_smoke.sh")


class TestControlPlaneSmokeScript(unittest.TestCase):
    def test_smoke_script_targets_current_system_subviews(self):
        contents = SCRIPT_PATH.read_text(encoding="utf-8")
        self.assertIn("subview=architecture", contents)
        self.assertIn("subview=inter-team-flow", contents)
        self.assertIn("subview=team-workflow", contents)
        self.assertIn("subview=flow-detail", contents)
        self.assertNotIn("subview=governance", contents)
        self.assertNotIn("subview=advanced-config", contents)

