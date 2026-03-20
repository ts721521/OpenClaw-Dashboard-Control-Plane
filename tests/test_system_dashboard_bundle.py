import os
import unittest


class TestSystemDashboardBundle(unittest.TestCase):
    def test_system_bundle_contains_bootstrap_marker(self):
        bundle_path = "static/build/system_dashboard.js"
        if not os.path.exists(bundle_path):
            self.skipTest("bundle not built")
        with open(bundle_path, "r", encoding="utf-8") as handle:
            contents = handle.read()
        self.assertIn("__SYSTEM_DASHBOARD_BOOTSTRAP__", contents)

    def test_system_bundle_contains_current_subviews(self):
        bundle_path = "static/build/system_dashboard.js"
        if not os.path.exists(bundle_path):
            self.skipTest("bundle not built")
        with open(bundle_path, "r", encoding="utf-8") as handle:
            contents = handle.read()
        self.assertIn("inter-team-flow", contents)
        self.assertIn("team-workflow", contents)
        self.assertIn("flow-detail", contents)

    def test_system_bundle_contains_inter_team_load_panel_strings(self):
        bundle_path = "static/build/system_dashboard.js"
        if not os.path.exists(bundle_path):
            self.skipTest("bundle not built")
        with open(bundle_path, "r", encoding="utf-8") as handle:
            contents = handle.read()
        self.assertIn("待确认交接", contents)
        self.assertIn("恢复候选", contents)
        self.assertIn("查看阻塞任务", contents)

    def test_system_bundle_contains_inter_team_task_queue_strings(self):
        bundle_path = "static/build/system_dashboard.js"
        if not os.path.exists(bundle_path):
            self.skipTest("bundle not built")
        with open(bundle_path, "r", encoding="utf-8") as handle:
            contents = handle.read()
        self.assertIn("相关任务队列", contents)
        self.assertIn("阻塞任务队列", contents)
        self.assertIn("待确认交接队列", contents)
        self.assertIn("恢复候选队列", contents)

    def test_system_bundle_contains_direct_handoff_controls(self):
        bundle_path = "static/build/system_dashboard.js"
        if not os.path.exists(bundle_path):
            self.skipTest("bundle not built")
        with open(bundle_path, "r", encoding="utf-8") as handle:
            contents = handle.read()
        self.assertIn("直接确认交接", contents)
        self.assertIn("handoffArtifactSummary", contents)

    def test_system_bundle_routes_architecture_context_to_current_views(self):
        bundle_path = "static/build/system_dashboard.js"
        if not os.path.exists(bundle_path):
            self.skipTest("bundle not built")
        with open(bundle_path, "r", encoding="utf-8") as handle:
            contents = handle.read()
        self.assertIn("查看团队任务", contents)
        self.assertIn("查看团队间流程", contents)
        self.assertIn("查看团队内流程", contents)
        self.assertNotIn("查看治理状态", contents)

    def test_system_bundle_contains_graph_edit_luban_controls(self):
        bundle_path = "static/build/system_dashboard.js"
        if not os.path.exists(bundle_path):
            self.skipTest("bundle not built")
        with open(bundle_path, "r", encoding="utf-8") as handle:
            contents = handle.read()
        self.assertIn("编辑关系模式", contents)
        self.assertIn("图上连线模式", contents)
        self.assertIn("提交给鲁班", contents)
        self.assertIn("查看实施结果", contents)
        self.assertIn("确认应用", contents)

    def test_system_bundle_contains_graph_edit_diff_strings(self):
        bundle_path = "static/build/system_dashboard.js"
        if not os.path.exists(bundle_path):
            self.skipTest("bundle not built")
        with open(bundle_path, "r", encoding="utf-8") as handle:
            contents = handle.read()
        self.assertIn("草稿差异", contents)
        self.assertIn("待确认版本", contents)
        self.assertIn("当前版本", contents)
        self.assertIn("当前版本结构", contents)
        self.assertIn("待确认版本结构", contents)
        self.assertIn("最近一次实施结果", contents)
        self.assertIn("节点数", contents)
        self.assertIn("关系数", contents)
        self.assertIn("关系预览", contents)
        self.assertIn("diff-chip", contents)
        self.assertIn("新增", contents)
        self.assertIn("删除", contents)

    def test_system_bundle_contains_graph_dispatch_status_strings(self):
        bundle_path = "static/build/system_dashboard.js"
        if not os.path.exists(bundle_path):
            self.skipTest("bundle not built")
        with open(bundle_path, "r", encoding="utf-8") as handle:
            contents = handle.read()
        self.assertIn("投递状态", contents)
        self.assertIn("等待鲁班处理", contents)
        self.assertIn("鲁班投递失败", contents)
        self.assertIn("草稿状态", contents)
        self.assertIn("最近投递", contents)
        self.assertIn("提交人", contents)
        self.assertIn("最近变更单", contents)

    def test_system_bundle_contains_connect_mode_instructions(self):
        bundle_path = "static/build/system_dashboard.js"
        if not os.path.exists(bundle_path):
            self.skipTest("bundle not built")
        with open(bundle_path, "r", encoding="utf-8") as handle:
            contents = handle.read()
        self.assertIn("拖动节点右侧连线点到目标团队", contents)
        self.assertIn("拖动节点右侧连线点到目标节点", contents)
        self.assertIn("先点来源角色再点目标角色", contents)

    def test_system_bundle_contains_drag_wire_ui_strings(self):
        bundle_path = "static/build/system_dashboard.js"
        if not os.path.exists(bundle_path):
            self.skipTest("bundle not built")
        with open(bundle_path, "r", encoding="utf-8") as handle:
            contents = handle.read()
        self.assertIn("拖动节点右侧连线点到目标节点", contents)
        self.assertIn("connector-handle", contents)
        self.assertIn("wire-preview", contents)

    def test_system_bundle_contains_canvas_diff_highlight_strings(self):
        bundle_path = "static/build/system_dashboard.js"
        if not os.path.exists(bundle_path):
            self.skipTest("bundle not built")
        with open(bundle_path, "r", encoding="utf-8") as handle:
            contents = handle.read()
        self.assertIn("edge-path", contents)
        self.assertIn("arrow-added", contents)
        self.assertIn("arrow-removed", contents)
