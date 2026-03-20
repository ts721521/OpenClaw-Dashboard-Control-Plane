import unittest
from pathlib import Path


ROOT = Path("/Users/tianshuai/.openclaw/workspace/dashboard-live")


class TestDocsTruth(unittest.TestCase):
    def test_readme_describes_two_core_surfaces_and_aux_team_page(self):
        contents = (ROOT / "README.md").read_text(encoding="utf-8")
        self.assertIn("Only `task_dashboard.html` and `system_dashboard.html` are part of the current main product route.", contents)
        self.assertIn("Auxiliary direct-link page:", contents)
        self.assertIn("Frozen / non-core pages:", contents)
        self.assertIn("`http://localhost:8888/team_dashboard.html`", contents)

    def test_docs_readme_marks_team_page_auxiliary(self):
        contents = (ROOT / "docs/README.md").read_text(encoding="utf-8")
        self.assertIn("There are only two core work surfaces:", contents)
        self.assertIn("`任务中心`", contents)
        self.assertIn("`系统架构中心`", contents)
        self.assertIn("auxiliary team view only", contents)

    def test_frontend_redesign_brief_exists_and_locks_boundaries(self):
        brief = ROOT / "docs/plans/2026-03-20-frontend-visual-redesign-brief.md"
        self.assertTrue(brief.exists())
        contents = brief.read_text(encoding="utf-8")
        self.assertIn("视觉层优先", contents)
        self.assertIn("任务中心", contents)
        self.assertIn("系统架构中心", contents)
        self.assertIn("team_dashboard.html", contents)
        self.assertIn("不得改动产品骨架", contents)

    def test_docs_structure_exists_and_requires_docs_under_docs_tree(self):
        structure = ROOT / "docs/STRUCTURE.md"
        self.assertTrue(structure.exists())
        contents = structure.read_text(encoding="utf-8")
        self.assertIn("do not place design or handover Markdown in the repo root", contents)
        self.assertIn("`task_dashboard.html`", contents)
        self.assertIn("`system_dashboard.html`", contents)
