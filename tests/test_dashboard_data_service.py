import json
import sqlite3
import tempfile
import time
import unittest
from pathlib import Path


class DashboardDataServiceTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.base = Path(self.tmp.name)
        self.workspace = self.base / "workspace"
        self.tasks_dir = self.workspace / "tasks"
        self.tasks_dir.mkdir(parents=True, exist_ok=True)

        agents = {
            "agents": {
                "list": [
                    {
                        "id": "main",
                        "workspace": str(self.workspace),
                        "model": {"primary": "openai-codex/gpt-5.3-codex", "fallbacks": ["bailian/qwen3.5-plus"]},
                    },
                    {
                        "id": "rd_lead",
                        "workspace": str(self.base / "workspaces" / "rd_lead"),
                        "model": {"primary": "openai-codex/gpt-5.3-codex", "fallbacks": ["bailian/glm-5"]},
                    },
                    {
                        "id": "luban",
                        "workspace": str(self.base / "workspaces" / "luban"),
                        "model": {"primary": "openai-codex/gpt-5.3-codex", "fallbacks": []},
                    },
                    {
                        "id": "braintrust_chief",
                        "workspace": str(self.base / "workspaces" / "braintrust_chief"),
                        "model": {"primary": "openai-codex/gpt-5.3-codex", "fallbacks": []},
                    },
                    {
                        "id": "braintrust_architect",
                        "workspace": str(self.base / "workspaces" / "braintrust_architect"),
                        "model": {"primary": "openai-codex/gpt-5.3-codex", "fallbacks": []},
                    },
                    {
                        "id": "proposal_lead",
                        "workspace": str(self.base / "workspaces" / "proposal_lead"),
                        "model": {"primary": "bailian/qwen3.5-plus", "fallbacks": []},
                    },
                ]
            }
        }
        (self.base / "openclaw.json").write_text(json.dumps(agents), encoding="utf-8")

        task = {
            "task_id": "TASK-20260301-001",
            "task_name": "跨日期任务",
            "created_at": "2026-03-01T10:00:00+08:00",
            "created_by": "main",
            "status": "assigned",
            "requirements": {
                "deliverables": [
                    {"item": "阶段1", "description": "desc1"},
                    {"item": "阶段2", "description": "desc2"},
                ]
            },
            "execution": {
                "status": "assigned",
                "progress": 50,
                "assigned_to": "rd_lead",
            },
        }
        (self.tasks_dir / "phaseX_20260301_001.json").write_text(json.dumps(task), encoding="utf-8")

    def tearDown(self):
        self.tmp.cleanup()

    def test_get_tasks_reads_all_dates_and_normalizes_assigned(self):
        from server import DashboardDataService

        svc = DashboardDataService(base_dir=str(self.base), workspace_dir=str(self.workspace), status_provider=lambda: {"agents": {"agents": []}})
        data = svc.get_tasks(include_history=True)
        self.assertEqual(len(data["tasks"]), 1)
        self.assertEqual(data["tasks"][0]["status"], "in_progress")

    def test_task_detail_lookup_by_task_id_not_filename(self):
        from server import DashboardDataService

        svc = DashboardDataService(base_dir=str(self.base), workspace_dir=str(self.workspace), status_provider=lambda: {"agents": {"agents": []}})
        detail = svc.get_task_detail("TASK-20260301-001")
        self.assertNotIn("error", detail)
        self.assertEqual(detail["task_id"], "TASK-20260301-001")

    def test_team_members_use_real_model_and_fallback(self):
        from server import DashboardDataService

        svc = DashboardDataService(base_dir=str(self.base), workspace_dir=str(self.workspace), status_provider=lambda: {"agents": {"agents": []}})
        teams = svc.get_teams()["teams"]
        rd_team = next(t for t in teams if t["team_id"] == "team-rd")
        rd_lead = next(m for m in rd_team["members"] if m["agent_id"] == "rd_lead")
        self.assertEqual(rd_lead["model"], "openai-codex/gpt-5.3-codex")
        self.assertIn("bailian/glm-5", rd_lead["backup_models"])

    def test_main_agent_shows_in_standalone_when_not_in_team(self):
        from server import DashboardDataService

        svc = DashboardDataService(base_dir=str(self.base), workspace_dir=str(self.workspace), status_provider=lambda: {"agents": {"agents": []}})
        standalone = svc.get_standalone_agents()["agents"]
        ids = {a["agent_id"] for a in standalone}
        self.assertIn("main", ids)

    def test_legacy_execution_teams_are_frozen(self):
        from server import DashboardDataService

        svc = DashboardDataService(base_dir=str(self.base), workspace_dir=str(self.workspace), status_provider=lambda: {"agents": {"agents": []}})
        teams = svc.get_teams()["teams"]
        team_ids = {team["team_id"] for team in teams}
        self.assertIn("team-rd", team_ids)
        self.assertNotIn("team-proposal", team_ids)

    def test_task_detail_includes_runtime_and_session_fields(self):
        from server import DashboardDataService

        svc = DashboardDataService(base_dir=str(self.base), workspace_dir=str(self.workspace), status_provider=lambda: {"agents": {"agents": []}})
        detail = svc.get_task_detail("TASK-20260301-001")
        self.assertIn("runtime_state", detail)
        self.assertIn("runtime_hint", detail)
        self.assertIn("session_link", detail)
        self.assertIn("todo_items", detail)
        self.assertIn("control_audit", detail)
        self.assertIsInstance(detail["session_link"], dict)
        self.assertTrue(detail["session_link"].get("url"))

    def test_task_detail_includes_closure_fields_for_blocked_task(self):
        from server import DashboardDataService

        task = json.loads((self.tasks_dir / "phaseX_20260301_001.json").read_text(encoding="utf-8"))
        task["business_bound"] = True
        task["business_truth_source"] = ""
        task["acceptance_result"] = ""
        (self.tasks_dir / "phaseX_20260301_001.json").write_text(json.dumps(task), encoding="utf-8")

        svc = DashboardDataService(base_dir=str(self.base), workspace_dir=str(self.workspace), status_provider=lambda: {"agents": {"agents": []}})
        detail = svc.get_task_detail("TASK-20260301-001")
        self.assertEqual(detail.get("closure_state"), "blocked")
        self.assertEqual(detail.get("next_recommended_action"), "request_business_input")
        self.assertTrue(detail.get("requires_manual_confirm"))
        self.assertTrue(detail.get("closure_reason"))

    def test_request_business_input_records_pending_request_and_audit(self):
        from server import DashboardDataService

        task = json.loads((self.tasks_dir / "phaseX_20260301_001.json").read_text(encoding="utf-8"))
        task["business_bound"] = True
        task["business_truth_source"] = ""
        task["acceptance_result"] = ""
        (self.tasks_dir / "phaseX_20260301_001.json").write_text(json.dumps(task), encoding="utf-8")

        svc = DashboardDataService(base_dir=str(self.base), workspace_dir=str(self.workspace), status_provider=lambda: {"agents": {"agents": []}})
        result = svc.request_business_input(
            task_id="TASK-20260301-001",
            actor_id="dashboard-ui",
            actor_role="admin",
            requested_from="main",
            missing_inputs="业务背景, 验收口径",
            note="请补齐业务信息",
        )
        self.assertTrue(result.get("ok"))
        detail = svc.get_task_detail("TASK-20260301-001")
        self.assertEqual(detail.get("closure_state"), "waiting_input")
        self.assertIn("等待", detail.get("closure_reason", ""))
        self.assertTrue(any((row.get("mode") == "manual_closure" and row.get("action") == "request_business_input") for row in detail.get("control_audit", [])))

    def test_assign_owner_and_return_to_rework_are_executable(self):
        from server import DashboardDataService

        svc = DashboardDataService(base_dir=str(self.base), workspace_dir=str(self.workspace), status_provider=lambda: {"agents": {"agents": []}})
        assign_result = svc.assign_owner(
            task_id="TASK-20260301-001",
            actor_id="dashboard-ui",
            actor_role="admin",
            assigned_to="rd_lead",
            assigned_team="team-rd",
            reason="明确责任人",
        )
        self.assertTrue(assign_result.get("ok"))

        rework_result = svc.return_to_rework_owner(
            task_id="TASK-20260301-001",
            actor_id="dashboard-ui",
            actor_role="admin",
            rework_owner="rd_lead",
            reason="需要返工",
        )
        self.assertTrue(rework_result.get("ok"))
        detail = svc.get_task_detail("TASK-20260301-001")
        self.assertEqual(detail.get("closure_state"), "rework")
        self.assertEqual(detail.get("next_recommended_action"), "")
        self.assertIn("返工", detail.get("closure_reason", ""))

    def test_review_task_detail_includes_closure_fields(self):
        from server import DashboardDataService

        svc = DashboardDataService(base_dir=str(self.base), workspace_dir=str(self.workspace), status_provider=lambda: {"agents": {"agents": []}})
        created = svc.create_review_task(
            payload={
                "title": "审查补齐",
                "submission_bundle": {
                    "incident_key": "inc-test-review-001",
                    "summary": "等待 reviewer packet",
                    "artifacts": [{"artifact_type": "review_packet", "path": "/tmp/review.md"}],
                    "target_task_id": "TASK-20260301-001",
                },
            },
            actor_id="main",
            actor_role="admin",
        )
        self.assertTrue(created.get("ok"))
        review_id = created.get("review_id")
        detail = svc.get_task_detail(review_id)
        self.assertEqual(detail.get("closure_state"), "waiting_review")
        self.assertEqual(detail.get("next_recommended_action"), "redispatch_reviewer")
        self.assertEqual(detail.get("next_recommended_owner"), "braintrust_chief")

    def test_control_task_fallback_soft_mode_updates_task(self):
        from server import DashboardDataService

        svc = DashboardDataService(base_dir=str(self.base), workspace_dir=str(self.workspace), status_provider=lambda: {"agents": {"agents": []}})
        svc._try_hard_control = lambda task, action, reason: {"ok": False, "message": "fail", "stderr": "timeout"}  # type: ignore[attr-defined]

        result = svc.control_task("TASK-20260301-001", "stop", "tester", "unit_test")
        self.assertTrue(result["ok"])
        self.assertEqual(result["mode"], "soft")

        updated = json.loads((self.tasks_dir / "phaseX_20260301_001.json").read_text(encoding="utf-8"))
        self.assertEqual((updated.get("execution") or {}).get("status"), "paused")
        self.assertEqual(updated.get("status"), "pending")

    def test_control_task_async_job_lifecycle(self):
        from server import DashboardDataService

        svc = DashboardDataService(base_dir=str(self.base), workspace_dir=str(self.workspace), status_provider=lambda: {"agents": {"agents": []}})
        svc._try_hard_control = lambda task, action, reason: {"ok": False, "message": "fail", "stderr": "timeout"}  # type: ignore[attr-defined]

        submit = svc.control_task("TASK-20260301-001", "restart", "tester", "unit_test_async", async_mode=True)
        self.assertTrue(submit["ok"])
        self.assertTrue(submit["accepted"])
        job_id = submit.get("job_id")
        self.assertTrue(job_id)

        status = None
        for _ in range(40):
            status = svc.get_task_control_status(job_id)
            if status.get("state") in {"finished", "failed"}:
                break
            time.sleep(0.05)

        self.assertIsNotNone(status)
        self.assertEqual(status.get("state"), "finished")
        self.assertTrue((status.get("result") or {}).get("ok"))

    def test_create_claim_and_assign_flow(self):
        from server import DashboardDataService

        svc = DashboardDataService(base_dir=str(self.base), workspace_dir=str(self.workspace), status_provider=lambda: {"agents": {"agents": []}})
        created = svc.create_task(
            payload={
                "task_name": "新增任务",
                "task_type": "general",
                "description": "通过 API 创建",
                "status": "pending",
                "owner": "unassigned",
            },
            actor_id="main",
            actor_role="admin",
        )
        self.assertTrue(created.get("ok"))
        task_id = created.get("task_id")
        self.assertTrue(task_id)
        self.assertEqual(created.get("task", {}).get("task_pool"), "team_dispatch_pool")

        claim_ok = svc.claim_task(task_id, actor_id="rd_lead", actor_role="agent", actor_team="team-rd")
        self.assertTrue(claim_ok.get("ok"))
        self.assertEqual(claim_ok.get("claimed_by"), "rd_lead")
        detail = svc.get_task_detail(task_id)
        dispatch_lock = detail.get("dispatch_lock") or {}
        self.assertEqual(dispatch_lock.get("owner"), "rd_lead")
        self.assertEqual(dispatch_lock.get("state"), "active")

        claim_fail = svc.claim_task(task_id, actor_id="proposal_lead", actor_role="agent", actor_team="team-proposal")
        self.assertFalse(claim_fail.get("ok"))

        assign = svc.assign_task(
            task_id=task_id,
            assigned_to="proposal_lead",
            actor_id="main",
            actor_role="admin",
            assigned_team="team-proposal",
            reason="handoff",
        )
        self.assertFalse(assign.get("ok"))
        self.assertEqual(assign.get("error"), "team retired")

    def test_governance_task_uses_governance_pool(self):
        from server import DashboardDataService

        svc = DashboardDataService(base_dir=str(self.base), workspace_dir=str(self.workspace), status_provider=lambda: {"agents": {"agents": []}})
        created = svc.create_task(
            payload={
                "task_name": "治理变更",
                "task_type": "governance_change",
                "description": "更新控制平面规则",
            },
            actor_id="main",
            actor_role="admin",
        )
        self.assertTrue(created.get("ok"))
        task = created.get("task") or {}
        self.assertEqual(task.get("task_pool"), "governance_pool")

        denied = svc.claim_task(created.get("task_id"), actor_id="rd_lead", actor_role="agent", actor_team="team-rd")
        self.assertFalse(denied.get("ok"))
        self.assertEqual(denied.get("error"), "pool claim denied")

    def test_get_tasks_since_and_pagination(self):
        from server import DashboardDataService

        svc = DashboardDataService(base_dir=str(self.base), workspace_dir=str(self.workspace), status_provider=lambda: {"agents": {"agents": []}})
        svc.create_task(
            payload={"task_name": "基线任务", "description": "baseline", "status": "pending"},
            actor_id="main",
            actor_role="admin",
        )
        base_page = svc.get_tasks(limit=1, sort="updated_at_ms", order="desc")
        self.assertEqual(len(base_page.get("tasks") or []), 1)
        since = base_page.get("next_since")
        self.assertTrue(since)

        time.sleep(0.02)
        created = svc.create_task(
            payload={"task_name": "增量任务", "description": "since query", "status": "pending"},
            actor_id="main",
            actor_role="admin",
        )
        self.assertTrue(created.get("ok"))

        inc = svc.get_tasks(since=since, sort="updated_at_ms", order="desc")
        ids = {t.get("task_id") for t in inc.get("tasks") or []}
        self.assertIn(created.get("task_id"), ids)

    def test_get_tasks_does_not_block_on_slow_initial_gateway_refresh(self):
        from server import DashboardDataService

        def slow_gateway_status():
            time.sleep(0.35)
            return {
                "agents": {"agents": [{"id": "rd_lead", "lastUpdatedAt": int(time.time() * 1000), "lastActiveAgeMs": 0}]},
                "sessions": {"byAgent": [{"agentId": "rd_lead", "count": 1, "recent": [{"updatedAt": int(time.time() * 1000)}]}]},
                "heartbeat": {"agents": [{"agentId": "rd_lead", "enabled": True}]},
            }

        svc = DashboardDataService(
            base_dir=str(self.base),
            workspace_dir=str(self.workspace),
            status_provider=lambda: {"agents": {"agents": []}},
            gateway_status_provider=slow_gateway_status,
        )

        start = time.perf_counter()
        data = svc.get_tasks(include_history=True, limit=10)
        elapsed = time.perf_counter() - start

        self.assertLess(elapsed, 0.2, f"get_tasks should not block on gateway refresh, took {elapsed:.3f}s")
        self.assertEqual(len(data.get("tasks") or []), 1)

    def test_get_tasks_exposes_gate_and_live_freshness(self):
        from server import DashboardDataService

        svc = DashboardDataService(
            base_dir=str(self.base),
            workspace_dir=str(self.workspace),
            status_provider=lambda: {"agents": {"agents": []}},
            gateway_status_provider=lambda: {},
        )
        created = svc.create_task(
            payload={
                "task_name": "Gate 字段任务",
                "business_bound": True,
                "business_truth_source": "prd://gate",
                "acceptance_result": "pending_acceptance",
                "gate_result": "REWORK",
            },
            actor_id="main",
            actor_role="admin",
        )
        task_id = created.get("task_id")
        data = svc.get_tasks(include_history=True)
        items = {t.get("task_id"): t for t in data.get("tasks") or []}
        self.assertIn(task_id, items)
        item = items[task_id]
        self.assertIn(item.get("live_freshness"), {"fresh", "stale", "unavailable"})
        self.assertTrue(item.get("business_bound"))
        self.assertEqual(item.get("business_truth_source"), "prd://gate")
        self.assertEqual(item.get("acceptance_result"), "pending_acceptance")
        self.assertEqual(item.get("gate_result"), "REWORK")

    def test_task_detail_stage_owner_prefers_deliverable_owner_and_current_step(self):
        from server import DashboardDataService

        rich_task = {
            "task_id": "GOV-PHASE2-TEST-001",
            "task_name": "递归治理 Phase2 测试",
            "created_at": "2026-03-14T10:00:00+08:00",
            "created_by": "main",
            "status": "in_progress",
            "requirements": {
                "deliverables": [
                    {"item": "系统层心跳实现", "description": "系统层", "owner": "rd_developer"},
                    {"item": "团队层心跳实现", "description": "团队层", "owner": "rd_tester"},
                ]
            },
            "execution": {
                "status": "in_progress",
                "progress": 10,
                "assigned_to": "rd_developer",
                "current_step": "团队层心跳实现",
            },
        }
        (self.tasks_dir / "gov_phase2_test_001.json").write_text(json.dumps(rich_task), encoding="utf-8")

        svc = DashboardDataService(base_dir=str(self.base), workspace_dir=str(self.workspace), status_provider=lambda: {"agents": {"agents": []}})
        detail = svc.get_task_detail("GOV-PHASE2-TEST-001")
        self.assertNotIn("error", detail)
        self.assertEqual(detail.get("current_stage"), "团队层心跳实现")
        stages = detail.get("stages") or []
        self.assertEqual(stages[0].get("owner_agent"), "rd_developer")
        self.assertEqual(stages[1].get("owner_agent"), "rd_tester")

    def test_task_detail_reports_file_conflict(self):
        from server import DashboardDataService

        a = {
            "task_id": "CONFLICT-001",
            "task_name": "冲突任务",
            "created_at": "2026-03-14T10:00:00+08:00",
            "status": "pending",
            "execution": {"status": "pending", "progress": 0, "assigned_to": "rd_lead"},
            "updated_at": "2026-03-14T10:00:00+08:00",
        }
        b = {
            "task_id": "CONFLICT-001",
            "task_name": "冲突任务",
            "created_at": "2026-03-14T10:00:00+08:00",
            "status": "completed",
            "execution": {"status": "completed", "progress": 100, "assigned_to": "rd_lead"},
            "updated_at": "2026-03-14T10:01:00+08:00",
        }
        (self.tasks_dir / "conflict_a.json").write_text(json.dumps(a), encoding="utf-8")
        (self.tasks_dir / "conflict_b.json").write_text(json.dumps(b), encoding="utf-8")

        svc = DashboardDataService(base_dir=str(self.base), workspace_dir=str(self.workspace), status_provider=lambda: {"agents": {"agents": []}})
        detail = svc.get_task_detail("CONFLICT-001")
        conflict = ((detail.get("data_quality") or {}).get("file_conflict") or {})
        self.assertTrue(conflict.get("has_conflict"))
        self.assertEqual(conflict.get("count"), 2)

    def test_cutover_hides_history_by_default(self):
        from server import DashboardDataService

        svc = DashboardDataService(base_dir=str(self.base), workspace_dir=str(self.workspace), status_provider=lambda: {"agents": {"agents": []}})
        created = svc.create_task(
            payload={"task_name": "新任务", "description": "post cutover"},
            actor_id="main",
            actor_role="admin",
        )
        self.assertTrue(created.get("ok"))

        visible = svc.get_tasks()
        visible_ids = {t.get("task_id") for t in visible.get("tasks") or []}
        self.assertIn(created.get("task_id"), visible_ids)
        self.assertNotIn("TASK-20260301-001", visible_ids)

        all_tasks = svc.get_tasks(include_history=True)
        all_ids = {t.get("task_id") for t in all_tasks.get("tasks") or []}
        self.assertIn("TASK-20260301-001", all_ids)
        self.assertIn(created.get("task_id"), all_ids)

    def test_cutover_is_recorded_in_task_meta(self):
        from server import DashboardDataService

        svc = DashboardDataService(base_dir=str(self.base), workspace_dir=str(self.workspace), status_provider=lambda: {"agents": {"agents": []}})
        cutover = svc._task_repo.get_meta("cutover_at")  # type: ignore[attr-defined]
        self.assertTrue(cutover)

    def test_complex_task_generates_parent_and_stage_cards(self):
        from server import DashboardDataService

        svc = DashboardDataService(base_dir=str(self.base), workspace_dir=str(self.workspace), status_provider=lambda: {"agents": {"agents": []}})
        created = svc.create_task(
            payload={
                "task_name": "复杂交付任务",
                "task_type": "delivery_complex",
                "description": "多阶段复杂任务",
                "requirements": {
                    "deliverables": [
                        {"item": "PRD", "description": "产出 PRD", "owner_role": "PM"},
                        {"item": "架构设计", "description": "产出架构", "owner_role": "Architect"},
                        {"item": "开发实现", "description": "产出代码", "owner_role": "Developer"},
                    ]
                },
            },
            actor_id="main",
            actor_role="admin",
        )
        self.assertTrue(created.get("ok"))
        task = created.get("task") or {}
        self.assertEqual(task.get("task_pool"), "intake_pool")

        detail = svc.get_task_detail(created.get("task_id"))
        self.assertEqual(detail.get("parent_task_id"), created.get("task_id"))
        self.assertTrue(detail.get("is_parent_task"))
        stage_cards = detail.get("stage_cards") or []
        self.assertEqual(len(stage_cards), 3)
        self.assertEqual(stage_cards[0].get("status"), "queued")
        self.assertEqual(stage_cards[1].get("status"), "queued")
        self.assertEqual(stage_cards[0].get("owner_role"), "PM")

    def test_review_task_requires_submission_bundle(self):
        from server import DashboardDataService

        svc = DashboardDataService(base_dir=str(self.base), workspace_dir=str(self.workspace), status_provider=lambda: {"agents": {"agents": []}})
        denied = svc.create_review_task(
            payload={"title": "缺少材料包"},
            actor_id="main",
            actor_role="admin",
        )
        self.assertFalse(denied.get("ok"))
        self.assertEqual(denied.get("error"), "submission_bundle required")

    def test_duplicate_incident_coalesces_into_one_active_review(self):
        from server import DashboardDataService

        svc = DashboardDataService(base_dir=str(self.base), workspace_dir=str(self.workspace), status_provider=lambda: {"agents": {"agents": []}})
        bundle = {
            "incident_key": "INC-001",
            "summary": "incident",
            "artifacts": [{"path": "/tmp/a.md"}],
        }
        first = svc.create_review_task(
            payload={"title": "第一次审查", "submission_bundle": bundle},
            actor_id="main",
            actor_role="admin",
        )
        second = svc.create_review_task(
            payload={"title": "重复 incident", "submission_bundle": bundle},
            actor_id="main",
            actor_role="admin",
        )
        self.assertTrue(first.get("ok"))
        self.assertTrue(second.get("ok"))
        self.assertEqual(second.get("review_id"), first.get("review_id"))
        detail = svc.get_review_task(first.get("review_id"))
        self.assertEqual(detail.get("coalesced_events"), 2)

    def test_review_packet_and_chief_decision_flow(self):
        from server import DashboardDataService

        svc = DashboardDataService(base_dir=str(self.base), workspace_dir=str(self.workspace), status_provider=lambda: {"agents": {"agents": []}})
        created = svc.create_review_task(
            payload={
                "title": "架构审查",
                "submission_bundle": {
                    "incident_key": "INC-002",
                    "summary": "bundle",
                    "artifacts": [{"path": "/tmp/arch.md"}],
                },
            },
            actor_id="main",
            actor_role="admin",
        )
        review_id = created.get("review_id")
        packet = svc.submit_review_packet(
            review_id=review_id,
            payload={
                "reviewer_id": "braintrust_architect",
                "provider": "openai",
                "verdict": "approved",
                "findings": ["ok"],
            },
            actor_id="braintrust_architect",
            actor_role="agent",
        )
        self.assertTrue(packet.get("ok"))

        denied = svc.decide_review_task(
            review_id=review_id,
            actor_id="braintrust_chief",
            actor_role="admin",
            decision="approved",
            next_action=None,
            next_owner=None,
        )
        self.assertFalse(denied.get("ok"))
        self.assertEqual(denied.get("error"), "next_action and next_owner required")

        decided = svc.decide_review_task(
            review_id=review_id,
            actor_id="braintrust_chief",
            actor_role="admin",
            decision="approved",
            next_action="return_to_rd",
            next_owner="rd_lead",
        )
        self.assertTrue(decided.get("ok"))
        detail = svc.get_review_task(review_id)
        self.assertEqual(detail.get("chief_decision", {}).get("next_owner"), "rd_lead")

    def test_change_publish_gate_and_version_lock(self):
        from server import DashboardDataService

        svc = DashboardDataService(base_dir=str(self.base), workspace_dir=str(self.workspace), status_provider=lambda: {"agents": {"agents": []}})
        task = svc.create_task(
            payload={"task_name": "执行中的任务", "description": "version bind"},
            actor_id="main",
            actor_role="admin",
        )
        task_id = task.get("task_id")
        svc.claim_task(task_id, actor_id="rd_lead", actor_role="agent", actor_team="team-rd")
        svc.update_task_progress(task_id, actor_id="rd_lead", actor_role="agent", status="in_progress", current_step="执行")
        before = svc.get_task_detail(task_id)
        self.assertTrue(before.get("version_binding"))

        change = svc.create_change_task(
            payload={
                "title": "共享规则变更",
                "scope": "shared",
                "description": "shared config",
                "impact_targets": ["task_dashboard", "system_dashboard"],
                "at_risk_tasks": [task_id],
            },
            actor_id="luban",
            actor_role="admin",
        )
        change_id = change.get("change_id")
        self.assertEqual(change.get("affects_scope"), "new_tasks_only")

        denied = svc.publish_change_task(change_id, actor_id="luban", actor_role="admin")
        self.assertFalse(denied.get("ok"))
        self.assertEqual(denied.get("error"), "approval required")

        svc.approve_change_task(change_id, actor_id="braintrust_chief", actor_role="admin")
        published = svc.publish_change_task(change_id, actor_id="luban", actor_role="admin")
        self.assertTrue(published.get("ok"))

        after = svc.get_task_detail(task_id)
        self.assertEqual(
            after.get("version_binding", {}).get("workflow_version"),
            before.get("version_binding", {}).get("workflow_version"),
        )

        p0 = svc.create_change_task(
            payload={"title": "P0 修复", "scope": "global", "priority": "P0"},
            actor_id="luban",
            actor_role="admin",
        )
        forced = svc.publish_change_task(p0.get("change_id"), actor_id="luban", actor_role="admin", p0_override=True)
        self.assertTrue(forced.get("ok"))
        self.assertTrue(forced.get("audit", {}).get("p0_override"))

    def test_stalled_review_enters_recovery_pool_and_reclaim_is_audited(self):
        from server import DashboardDataService

        stale_ms = int(time.time() * 1000) - (2 * 60 * 60 * 1000)
        svc = DashboardDataService(
            base_dir=str(self.base),
            workspace_dir=str(self.workspace),
            status_provider=lambda: {
                "agents": {
                    "agents": [
                        {
                            "agentId": "braintrust_architect",
                            "heartbeat": {"enabled": True, "updatedAt": stale_ms},
                        }
                    ]
                },
                "sessions": {
                    "byAgent": [
                        {"agentId": "braintrust_architect", "count": 1, "recent": [{"updatedAt": stale_ms}]}
                    ]
                },
            },
        )
        created = svc.create_review_task(
            payload={
                "title": "停滞审查",
                "submission_bundle": {
                    "incident_key": "INC-RECOVERY",
                    "summary": "bundle",
                    "artifacts": [{"path": "/tmp/review.md"}],
                },
            },
            actor_id="main",
            actor_role="admin",
        )
        review_id = created.get("review_id")
        svc.dispatch_review_task(review_id, actor_id="braintrust_architect", actor_role="agent")

        scan = svc.scan_stalled_work()
        stalled_reviews = {item.get("review_id") for item in scan.get("stalled_reviews") or []}
        self.assertIn(review_id, stalled_reviews)

        pools = svc.get_task_pools().get("pools") or {}
        recovery_ids = {item.get("review_id") for item in pools.get("recovery_pool") or [] if item.get("review_id")}
        self.assertIn(review_id, recovery_ids)

        reclaimed = svc.recover_review_task(review_id, actor_id="luban", actor_role="admin", action="reclaim")
        self.assertTrue(reclaimed.get("ok"))
        detail = svc.get_review_task(review_id)
        audit = detail.get("recovery_audit") or []
        self.assertTrue(audit)
        self.assertEqual(audit[0].get("action"), "reclaim")

    def test_change_tasks_can_be_listed_for_governance_ui(self):
        from server import DashboardDataService

        svc = DashboardDataService(base_dir=str(self.base), workspace_dir=str(self.workspace), status_provider=lambda: {"agents": {"agents": []}})
        created = svc.create_change_task(
            payload={"title": "治理页变更", "scope": "shared"},
            actor_id="luban",
            actor_role="admin",
        )
        self.assertTrue(created.get("ok"))
        items = svc.list_change_tasks()
        ids = {item.get("change_id") for item in items}
        self.assertIn(created.get("change_id"), ids)

    def test_review_tasks_can_be_listed_for_governance_ui(self):
        from server import DashboardDataService

        svc = DashboardDataService(base_dir=str(self.base), workspace_dir=str(self.workspace), status_provider=lambda: {"agents": {"agents": []}})
        created = svc.create_review_task(
            payload={
                "title": "治理面审查单",
                "submission_bundle": {
                    "incident_key": "INC-GOV-001",
                    "summary": "review for governance board",
                    "artifacts": [{"path": "/tmp/gov-review.md"}],
                },
            },
            actor_id="main",
            actor_role="admin",
        )
        self.assertTrue(created.get("ok"))
        items = svc.list_review_tasks()
        ids = {item.get("review_id") for item in items}
        self.assertIn(created.get("review_id"), ids)

    def test_review_task_exposes_seat_status_and_packet_missing(self):
        from server import DashboardDataService

        svc = DashboardDataService(base_dir=str(self.base), workspace_dir=str(self.workspace), status_provider=lambda: {"agents": {"agents": []}})
        created = svc.create_review_task(
            payload={
                "title": "席位状态审查",
                "submission_bundle": {
                    "incident_key": "INC-SEAT-001",
                    "summary": "seat governance",
                    "artifacts": [{"path": "/tmp/seat-review.md"}],
                },
            },
            actor_id="main",
            actor_role="admin",
        )
        review_id = created.get("review_id")
        svc.dispatch_review_task(review_id, actor_id="braintrust_architect", actor_role="agent")
        detail = svc.get_review_task(review_id)
        self.assertEqual((detail.get("seat_status") or {}).get("braintrust_architect"), "under_review")
        self.assertEqual(detail.get("chief_status"), "waiting_packets")
        self.assertIn("braintrust_critic", detail.get("packet_missing") or [])

        svc.submit_review_packet(
            review_id=review_id,
            payload={"reviewer_id": "braintrust_architect", "provider": "openai", "verdict": "approved", "findings": ["ok"]},
            actor_id="braintrust_architect",
            actor_role="agent",
        )
        detail = svc.get_review_task(review_id)
        self.assertEqual((detail.get("seat_status") or {}).get("braintrust_architect"), "submitted")
        self.assertIn("braintrust_critic", detail.get("packet_missing") or [])

    def test_shared_change_requires_impact_targets_before_publish(self):
        from server import DashboardDataService

        svc = DashboardDataService(base_dir=str(self.base), workspace_dir=str(self.workspace), status_provider=lambda: {"agents": {"agents": []}})
        created = svc.create_change_task(
            payload={"title": "共享变更", "scope": "shared"},
            actor_id="luban",
            actor_role="admin",
        )
        change_id = created.get("change_id")
        svc.approve_change_task(change_id, actor_id="braintrust_chief", actor_role="admin")
        denied = svc.publish_change_task(change_id, actor_id="luban", actor_role="admin")
        self.assertFalse(denied.get("ok"))
        self.assertEqual(denied.get("error"), "impact_targets required")

        created2 = svc.create_change_task(
            payload={
                "title": "共享变更2",
                "scope": "shared",
                "impact_targets": ["system_dashboard", "task_dashboard"],
                "at_risk_tasks": ["TASK-X"],
                "rollback_plan": "revert versions",
            },
            actor_id="luban",
            actor_role="admin",
        )
        change2 = svc.get_change_task(created2.get("change_id"))
        self.assertEqual(change2.get("impact_targets"), ["system_dashboard", "task_dashboard"])
        svc.approve_change_task(created2.get("change_id"), actor_id="braintrust_chief", actor_role="admin")
        published = svc.publish_change_task(created2.get("change_id"), actor_id="luban", actor_role="admin")
        self.assertTrue(published.get("ok"))

    def test_repository_promotes_explicit_boundary_fields(self):
        from server import DashboardDataService

        svc = DashboardDataService(base_dir=str(self.base), workspace_dir=str(self.workspace), status_provider=lambda: {"agents": {"agents": []}})
        created_task = svc.create_task(
            payload={
                "task_name": "显式字段任务",
                "business_bound": True,
                "business_truth_source": "prd://boundary",
                "acceptance_result": "pending_business_acceptance",
                "gate_result": "REWORK",
            },
            actor_id="main",
            actor_role="admin",
        )
        created_review = svc.create_review_task(
            payload={
                "title": "显式字段审查",
                "submission_bundle": {
                    "incident_key": "INC-BOUNDARY-001",
                    "summary": "boundary review",
                    "artifacts": [{"path": "/tmp/review-boundary.md"}],
                },
            },
            actor_id="main",
            actor_role="admin",
        )
        svc.dispatch_review_task(created_review.get("review_id"), actor_id="braintrust_architect", actor_role="agent")
        created_change = svc.create_change_task(
            payload={"title": "显式字段变更", "scope": "shared", "priority": "P1"},
            actor_id="luban",
            actor_role="admin",
        )

        conn = sqlite3.connect(str(svc._task_repo.db_path))  # type: ignore[attr-defined]
        conn.row_factory = sqlite3.Row
        task_row = conn.execute(
            "SELECT business_bound, business_truth_source, acceptance_result, gate_result FROM tasks WHERE task_id=?",
            (created_task.get("task_id"),),
        ).fetchone()
        review_row = conn.execute(
            "SELECT title, assigned_to FROM review_tasks WHERE review_id=?",
            (created_review.get("review_id"),),
        ).fetchone()
        change_row = conn.execute(
            "SELECT title, priority, affects_scope FROM change_tasks WHERE change_id=?",
            (created_change.get("change_id"),),
        ).fetchone()
        conn.close()

        self.assertEqual(int(task_row["business_bound"] or 0), 1)
        self.assertEqual(task_row["business_truth_source"], "prd://boundary")
        self.assertEqual(task_row["acceptance_result"], "pending_business_acceptance")
        self.assertEqual(task_row["gate_result"], "REWORK")
        self.assertEqual(review_row["title"], "显式字段审查")
        self.assertEqual(review_row["assigned_to"], "braintrust_architect")
        self.assertEqual(change_row["title"], "显式字段变更")
        self.assertEqual(change_row["priority"], "P1")
        self.assertEqual(change_row["affects_scope"], "new_tasks_only")

    def test_business_bound_task_requires_truth_source_and_acceptance_to_complete(self):
        from server import DashboardDataService

        svc = DashboardDataService(base_dir=str(self.base), workspace_dir=str(self.workspace), status_provider=lambda: {"agents": {"agents": []}})
        created = svc.create_task(
            payload={"task_name": "业务约束任务", "business_bound": True},
            actor_id="main",
            actor_role="admin",
        )
        task_id = created.get("task_id")
        svc.assign_task(task_id=task_id, assigned_to="rd_lead", actor_id="main", actor_role="admin", assigned_team="team-rd", reason="assign")
        denied = svc.update_task_progress(task_id=task_id, actor_id="rd_lead", actor_role="agent", status="completed")
        self.assertFalse(denied.get("ok"))
        self.assertEqual(denied.get("error"), "business_truth_source required")

        created2 = svc.create_task(
            payload={
                "task_name": "业务约束任务2",
                "business_bound": True,
                "business_truth_source": "prd://main",
            },
            actor_id="main",
            actor_role="admin",
        )
        task2 = created2.get("task_id")
        svc.assign_task(task_id=task2, assigned_to="rd_lead", actor_id="main", actor_role="admin", assigned_team="team-rd", reason="assign")
        denied2 = svc.update_task_progress(task_id=task2, actor_id="rd_lead", actor_role="agent", status="completed")
        self.assertFalse(denied2.get("ok"))
        self.assertEqual(denied2.get("error"), "acceptance_result required")

    def test_stage_handoff_requires_artifact_summary_and_next_owner(self):
        from server import DashboardDataService

        svc = DashboardDataService(base_dir=str(self.base), workspace_dir=str(self.workspace), status_provider=lambda: {"agents": {"agents": []}})
        created = svc.create_task(
            payload={
                "task_name": "阶段交接任务",
                "task_type": "delivery_complex",
                "business_truth_source": "prd://stage",
                "requirements": {
                    "deliverables": [
                        {"item": "PRD", "description": "产出PRD", "owner_role": "PM"},
                        {"item": "架构设计", "description": "产出架构", "owner_role": "Architect"},
                    ]
                },
            },
            actor_id="main",
            actor_role="admin",
        )
        task_id = created.get("task_id")
        denied = svc.handoff_stage(
            task_id=task_id,
            stage_id=1,
            actor_id="main",
            actor_role="admin",
            handoff_note="",
            artifact_summary="",
            next_owner="",
        )
        self.assertFalse(denied.get("ok"))
        self.assertEqual(denied.get("error"), "handoff_note, artifact_summary, next_owner required")

        artifact = svc.add_task_artifact(
            task_id=task_id,
            actor_id="main",
            actor_role="admin",
            artifact={
                "artifact_type": "PRD",
                "path": "/tmp/prd.md",
                "version": "v1",
                "summary": "阶段一产出",
            },
        )
        self.assertTrue(artifact.get("ok"))
        handed = svc.handoff_stage(
            task_id=task_id,
            stage_id=1,
            actor_id="main",
            actor_role="admin",
            handoff_note="阶段一完成",
            artifact_summary="PRD 已整理",
            next_owner="rd_lead",
        )
        self.assertTrue(handed.get("ok"))
        detail = svc.get_task_detail(task_id)
        self.assertEqual((detail.get("stage_cards") or [])[0].get("status"), "completed")
        self.assertEqual((detail.get("stage_cards") or [])[1].get("status"), "assigned")

    def test_agent_cannot_delete_task(self):
        from server import DashboardDataService

        svc = DashboardDataService(base_dir=str(self.base), workspace_dir=str(self.workspace), status_provider=lambda: {"agents": {"agents": []}})
        created = svc.create_task(
            payload={"task_name": "待删除", "description": "rbac"},
            actor_id="main",
            actor_role="admin",
        )
        self.assertTrue(created.get("ok"))
        task_id = created.get("task_id")

        denied = svc.delete_task(task_id, operator="rd_lead", reason="agent_delete", operator_role="agent")
        self.assertFalse(denied.get("ok"))
        self.assertEqual(denied.get("error"), "permission denied")

    def test_delete_task_archives_api_task_without_file(self):
        from server import DashboardDataService

        svc = DashboardDataService(base_dir=str(self.base), workspace_dir=str(self.workspace), status_provider=lambda: {"agents": {"agents": []}})
        created = svc.create_task(
            payload={"task_name": "API 创建任务", "description": "delete archive"},
            actor_id="main",
            actor_role="admin",
        )
        self.assertTrue(created.get("ok"))
        task_id = created.get("task_id")

        deleted = svc.delete_task(task_id, operator="main", reason="unit_test_delete", operator_role="admin")
        self.assertTrue(deleted.get("ok"))
        archive_path = deleted.get("archive_path")
        self.assertTrue(archive_path)
        self.assertTrue(Path(archive_path).exists())

    def test_assigned_agent_can_update_progress(self):
        from server import DashboardDataService

        svc = DashboardDataService(base_dir=str(self.base), workspace_dir=str(self.workspace), status_provider=lambda: {"agents": {"agents": []}})
        created = svc.create_task(
            payload={"task_name": "执行中任务", "description": "progress"},
            actor_id="main",
            actor_role="admin",
        )
        task_id = created.get("task_id")
        svc.assign_task(
            task_id=task_id,
            assigned_to="rd_lead",
            actor_id="main",
            actor_role="admin",
            assigned_team="team-rd",
            reason="assign",
        )

        updated = svc.update_task_progress(
            task_id=task_id,
            actor_id="rd_lead",
            actor_role="agent",
            progress=45,
            status="in_progress",
            current_step="开发中",
            note="working",
        )
        self.assertTrue(updated.get("ok"))
        detail = svc.get_task_detail(task_id)
        self.assertEqual(detail.get("progress"), 45)
        self.assertEqual(detail.get("status"), "in_progress")

    def test_unassigned_agent_cannot_update_progress(self):
        from server import DashboardDataService

        svc = DashboardDataService(base_dir=str(self.base), workspace_dir=str(self.workspace), status_provider=lambda: {"agents": {"agents": []}})
        created = svc.create_task(
            payload={"task_name": "执行中任务", "description": "progress"},
            actor_id="main",
            actor_role="admin",
        )
        task_id = created.get("task_id")
        svc.assign_task(
            task_id=task_id,
            assigned_to="rd_lead",
            actor_id="main",
            actor_role="admin",
            assigned_team="team-rd",
            reason="assign",
        )

        denied = svc.update_task_progress(
            task_id=task_id,
            actor_id="proposal_lead",
            actor_role="agent",
            progress=60,
            status="in_progress",
        )
        self.assertFalse(denied.get("ok"))
        self.assertEqual(denied.get("error"), "permission denied")

    def test_graph_edit_submit_and_confirm_apply_for_architecture(self):
        from server import DashboardDataService

        svc = DashboardDataService(base_dir=str(self.base), workspace_dir=str(self.workspace), status_provider=lambda: {"agents": {"agents": []}})
        initial = svc.get_graph_edit_payload("architecture", "default")
        current_edges = initial.get("current_graph", {}).get("edges") or []
        self.assertTrue(any(edge.get("type") == "business_flow" for edge in current_edges))

        draft_graph = {
            "nodes": initial.get("current_graph", {}).get("nodes") or [],
            "edges": [
                {"from": "team-km", "to": "team-rd", "type": "business_flow"},
                {"from": "main", "to": "team-km", "type": "standalone_collab"},
            ],
        }
        submitted = svc.submit_graph_edit_to_luban(
            kind="architecture",
            target_id="default",
            draft_graph=draft_graph,
            operator="dashboard-ui",
        )
        self.assertTrue(submitted.get("ok"))
        change_id = submitted.get("change_id")
        change = svc._task_repo.get_change_task(change_id)  # type: ignore[attr-defined]
        self.assertEqual(change.get("target_kind"), "architecture")
        self.assertEqual(change.get("implementation_status"), "pending_implementation")

        change["implementation_status"] = "ready_for_confirm"
        change["implementation_result_graph"] = draft_graph
        change["implementation_summary"] = "Luban applied architecture edges"
        svc._task_repo.upsert_change_task(change)  # type: ignore[attr-defined]

        confirmed = svc.confirm_graph_edit_apply(
            kind="architecture",
            target_id="default",
            change_id=change_id,
            operator="dashboard-ui",
        )
        self.assertTrue(confirmed.get("ok"))
        refreshed = svc.get_graph_edit_payload("architecture", "default")
        refreshed_edges = refreshed.get("current_graph", {}).get("edges") or []
        self.assertTrue(any(edge.get("from") == "main" and edge.get("to") == "team-km" and edge.get("type") == "standalone_collab" for edge in refreshed_edges))

    def test_graph_edit_submit_writes_luban_request_file(self):
        from server import DashboardDataService

        svc = DashboardDataService(base_dir=str(self.base), workspace_dir=str(self.workspace), status_provider=lambda: {"agents": {"agents": []}})
        draft_graph = {
            "nodes": [{"id": "team-rd", "type": "team"}, {"id": "team-km", "type": "team"}],
            "edges": [{"from": "team-km", "to": "team-rd", "type": "business_flow"}],
        }
        submitted = svc.submit_graph_edit_to_luban(
            kind="architecture",
            target_id="default",
            draft_graph=draft_graph,
            operator="dashboard-ui",
        )
        self.assertTrue(submitted.get("ok"))
        change_id = submitted.get("change_id")
        request_path = self.base / "workspaces" / "luban" / "inbox" / "graph_edits" / f"{change_id}.request.json"
        self.assertTrue(request_path.exists())
        payload = json.loads(request_path.read_text(encoding="utf-8"))
        self.assertEqual(payload.get("change_id"), change_id)
        self.assertEqual(payload.get("target_kind"), "architecture")
        self.assertEqual(payload.get("target_id"), "default")
        self.assertEqual(payload.get("operator"), "dashboard-ui")
        self.assertEqual(payload.get("draft_graph", {}).get("edges", [{}])[0].get("type"), "business_flow")

    def test_graph_edit_implementation_auto_ingests_luban_result_file(self):
        from server import DashboardDataService

        svc = DashboardDataService(base_dir=str(self.base), workspace_dir=str(self.workspace), status_provider=lambda: {"agents": {"agents": []}})
        initial = svc.get_graph_edit_payload("architecture", "default")
        draft_graph = {
            "nodes": initial.get("current_graph", {}).get("nodes") or [],
            "edges": [
                {"from": "team-km", "to": "team-rd", "type": "business_flow"},
                {"from": "main", "to": "team-km", "type": "standalone_collab"},
            ],
        }
        submitted = svc.submit_graph_edit_to_luban(
            kind="architecture",
            target_id="default",
            draft_graph=draft_graph,
            operator="dashboard-ui",
        )
        change_id = submitted.get("change_id")
        result_path = self.base / "workspaces" / "luban" / "outbox" / "graph_edits" / f"{change_id}.result.json"
        result_path.parent.mkdir(parents=True, exist_ok=True)
        result_path.write_text(
            json.dumps(
                {
                    "change_id": change_id,
                    "implementation_status": "ready_for_confirm",
                    "implementation_summary": "Luban auto-applied architecture edges",
                    "implementation_result_graph": draft_graph,
                },
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )

        payload = svc.get_graph_edit_payload("architecture", "default")
        self.assertTrue(payload.get("ok"))
        detail = payload.get("implementation") or {}
        self.assertEqual(detail.get("implementation_status"), "ready_for_confirm")
        self.assertEqual(detail.get("implementation_summary"), "Luban auto-applied architecture edges")
        self.assertEqual(detail.get("implementation_result_graph", {}).get("edges", [{}])[-1].get("type"), "standalone_collab")
        self.assertFalse(result_path.exists())

    def test_graph_edit_submit_and_confirm_apply_for_team_workflow(self):
        from server import DashboardDataService

        svc = DashboardDataService(base_dir=str(self.base), workspace_dir=str(self.workspace), status_provider=lambda: {"agents": {"agents": []}})
        initial = svc.get_graph_edit_payload("team-workflow", "team-rd")
        graph = initial.get("current_graph", {})
        self.assertTrue(graph.get("nodes"))
        self.assertTrue(graph.get("edges"))

        nodes = graph.get("nodes") or []
        first = nodes[0]["id"]
        last = nodes[-1]["id"]
        draft_graph = {
            **graph,
            "edges": list(graph.get("edges") or []) + [
                {
                    "key": f"{last}->{first}",
                    "from": last,
                    "to": first,
                    "transitionType": "rework",
                    "condition": "返工",
                    "requiresConfirmation": True,
                }
            ],
        }
        submitted = svc.submit_graph_edit_to_luban(
            kind="team-workflow",
            target_id="team-rd",
            draft_graph=draft_graph,
            operator="dashboard-ui",
        )
        self.assertTrue(submitted.get("ok"))
        change_id = submitted.get("change_id")
        change = svc._task_repo.get_change_task(change_id)  # type: ignore[attr-defined]
        change["implementation_status"] = "ready_for_confirm"
        change["implementation_result_graph"] = draft_graph
        change["implementation_summary"] = "Luban applied team workflow"
        svc._task_repo.upsert_change_task(change)  # type: ignore[attr-defined]

        confirmed = svc.confirm_graph_edit_apply(
            kind="team-workflow",
            target_id="team-rd",
            change_id=change_id,
            operator="dashboard-ui",
        )
        self.assertTrue(confirmed.get("ok"))
        refreshed = svc.get_graph_edit_payload("team-workflow", "team-rd")
        edge_keys = {edge.get("key") for edge in (refreshed.get("current_graph", {}).get("edges") or [])}
        self.assertIn(f"{last}->{first}", edge_keys)


if __name__ == "__main__":
    unittest.main()
