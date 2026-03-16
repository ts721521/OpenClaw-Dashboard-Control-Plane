#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
OpenClaw Dashboard API Server
真实数据源：~/.openclaw/openclaw.json + workspace/tasks + OpenClaw gateway/status
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import threading
import time
import uuid
from datetime import datetime, timedelta, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Callable
from urllib.parse import parse_qs, quote, unquote, urlparse

from task_repository import TaskRepository


DEFAULT_BASE_DIR = Path.home() / ".openclaw"


def now_iso() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat()


def now_ms() -> int:
    return int(time.time() * 1000)


def parse_dt(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        if value.endswith("Z"):
            value = value[:-1] + "+00:00"
        return datetime.fromisoformat(value)
    except Exception:
        return None


def model_pair(model_cfg: dict[str, Any] | None) -> tuple[str, list[str]]:
    model_cfg = model_cfg or {}
    primary = model_cfg.get("primary") or "unknown"
    fallbacks = model_cfg.get("fallbacks") or []
    if isinstance(fallbacks, str):
        fallbacks = [fallbacks]
    return str(primary), [str(x) for x in fallbacks]


class DashboardDataService:
    HARD_CONTROL_TIMEOUT_SECONDS = 25
    ACTIVE_TEAM_IDS = {"team-rd", "team-km", "team-braintrust"}
    RETIRED_TEAM_IDS = {"team-proposal", "team-smart3d"}

    TEAM_DEFS: dict[str, dict[str, Any]] = {
        "team-rd": {
            "name": "研发团队",
            "description": "研发与交付实施",
            "responsibilities": ["需求实现", "编码开发", "测试验证", "交付输出"],
            "workflow": ["ANALYZING", "DESIGNING", "CODING", "TESTING", "REVIEWING", "DONE"],
        },
        "team-km": {
            "name": "知识管理团队",
            "description": "知识采集与沉淀",
            "responsibilities": ["知识收集", "知识处理", "知识索引", "知识发布"],
            "workflow": ["COLLECTING", "PROCESSING", "INDEXING", "PUBLISHING", "DONE"],
        },
        "team-braintrust": {
            "name": "智囊审查团队",
            "description": "技术审查与裁决",
            "responsibilities": ["方案审查", "代码审查", "风险裁决", "治理建议"],
            "workflow": ["PENDING", "REVIEWING", "DECIDING", "COMPLETED"],
        },
        "team-proposal": {
            "name": "方案交付团队",
            "description": "售前方案与文档交付",
            "responsibilities": ["需求澄清", "方案编写", "视觉设计", "交付审阅"],
            "workflow": ["ANALYSIS", "WRITING", "DESIGN", "REVIEW", "DONE"],
            "retired": True,
        },
        "team-smart3d": {
            "name": "Smart3D 项目团队",
            "description": "Smart3D 专项研发",
            "responsibilities": ["专项需求", "开发实现", "测试验收", "版本发布"],
            "workflow": ["PLAN", "BUILD", "TEST", "RELEASE", "DONE"],
            "retired": True,
        },
    }

    TEAM_STAGE_ROLE_MAP: dict[str, dict[str, tuple[str, tuple[str, ...]]]] = {
        "team-rd": {
            "ANALYZING": ("Orchestrator", ("rd_lead", "coordinator")),
            "DESIGNING": ("Orchestrator", ("rd_lead", "architect")),
            "CODING": ("Executor", ("rd_developer", "developer")),
            "TESTING": ("Tester", ("rd_tester", "tester")),
            "REVIEWING": ("Reviewer", ("braintrust_chief", "braintrust_architect", "documentation")),
            "DONE": ("Orchestrator", ("rd_lead",)),
        },
        "team-km": {
            "COLLECTING": ("Collector", ("km_collector", "scholar")),
            "PROCESSING": ("Learner", ("km_organizer", "knowledge_manager")),
            "INDEXING": ("Indexer", ("km_indexer", "knowledge_manager")),
            "PUBLISHING": ("Reviewer", ("scholar", "braintrust_chief")),
            "DONE": ("Learner", ("scholar",)),
        },
        "team-braintrust": {
            "PENDING": ("Reviewer", ("braintrust_chief",)),
            "REVIEWING": ("Reviewer", ("braintrust_architect", "braintrust_chief")),
            "DECIDING": ("Decision", ("braintrust_chief", "braintrust_compliance")),
            "COMPLETED": ("Decision", ("braintrust_chief",)),
        },
        "team-proposal": {
            "ANALYSIS": ("Orchestrator", ("proposal_lead",)),
            "WRITING": ("Executor", ("proposal_writer",)),
            "DESIGN": ("Designer", ("proposal_designer",)),
            "REVIEW": ("Reviewer", ("braintrust_chief", "proposal_lead")),
            "DONE": ("Orchestrator", ("proposal_lead",)),
        },
        "team-smart3d": {
            "PLAN": ("Orchestrator", ("smart3d_lead",)),
            "BUILD": ("Executor", ("smart3d_developer",)),
            "TEST": ("Tester", ("smart3d_tester",)),
            "RELEASE": ("Orchestrator", ("smart3d_lead",)),
            "DONE": ("Orchestrator", ("smart3d_lead",)),
        },
    }

    def __init__(
        self,
        base_dir: str | None = None,
        workspace_dir: str | None = None,
        status_provider: Callable[[], dict[str, Any]] | None = None,
        gateway_status_provider: Callable[[], dict[str, Any]] | None = None,
    ) -> None:
        self.base_dir = Path(base_dir) if base_dir else DEFAULT_BASE_DIR
        self.workspace_dir = Path(workspace_dir) if workspace_dir else self.base_dir / "workspace"
        self.openclaw_config = self.base_dir / "openclaw.json"
        self.tasks_dir = self.workspace_dir / "tasks"
        self.task_archive_dir = self.tasks_dir / "_archive"
        self.dashboard_dir = Path(__file__).resolve().parent
        self.team_leads_path = self.workspace_dir / "config" / "team_leads.json"
        self.team_state_machines_path = self.workspace_dir / "config" / "team_state_machines.json"
        self.control_audit_path = self.dashboard_dir / "control_audit.jsonl"
        self.config_backup_root = self.workspace_dir / "config" / "_backups"
        self.pangu_queue_path = self.workspace_dir / "memory" / "pangu_queue.json"
        self.tasks_db_path = self.workspace_dir / "memory" / "dashboard_tasks.sqlite3"

        self.status_provider = status_provider or self._default_status_provider
        if gateway_status_provider:
            self.gateway_status_provider = gateway_status_provider
        elif status_provider:
            # tests usually inject status_provider; reuse it to avoid calling external CLI
            self.gateway_status_provider = status_provider
        else:
            self.gateway_status_provider = self._default_gateway_status_provider

        self._status_cache: dict[str, Any] = {"ts": 0.0, "payload": {}}
        self._live_cache: dict[str, Any] = {"ts": 0.0, "payload": {}, "last_success_ms": 0, "error": None}
        self._dashboard_url_cache: dict[str, Any] = {"ts": 0.0, "url": None}
        self._live_refresh_lock = threading.Lock()
        self._live_refresh_running = False
        self._control_lock = threading.Lock()
        self._control_inflight = 0
        self._control_job_lock = threading.Lock()
        self._control_jobs: dict[str, dict[str, Any]] = {}
        self._task_repo = TaskRepository(self.tasks_db_path)
        self._task_repo.init_schema()
        self._task_op_lock = threading.Lock()
        self._task_sync_lock = threading.Lock()
        self._task_sync_cache: dict[str, Any] = {"ts": 0.0}
        self._bootstrap_task_store()

    def _run_json_cmd(self, args: list[str], timeout: int = 12, cwd: Path | None = None) -> dict[str, Any]:
        proc = subprocess.run(
            args,
            cwd=str(cwd or self.base_dir),
            check=True,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
        return json.loads(proc.stdout)

    def _default_status_provider(self) -> dict[str, Any]:
        try:
            return self._run_json_cmd(["openclaw", "status", "--json"], timeout=8)
        except Exception:
            return {}

    def _default_gateway_status_provider(self) -> dict[str, Any]:
        try:
            return self._run_json_cmd(["openclaw", "gateway", "call", "status", "--json"], timeout=3)
        except Exception:
            # fallback to generic status
            return self._default_status_provider()

    def _status_snapshot(self) -> dict[str, Any]:
        now = time.time()
        if now - self._status_cache.get("ts", 0.0) < 10:
            return self._status_cache.get("payload", {})
        payload = self.status_provider() or {}
        self._status_cache = {"ts": now, "payload": payload}
        return payload

    def _live_freshness(self, last_success_ms: int) -> str:
        if not last_success_ms:
            return "unavailable"
        age = now_ms() - int(last_success_ms)
        if age <= 15_000:
            return "fresh"
        if age <= 120_000:
            return "stale"
        return "unavailable"

    def _refresh_live_cache(self, now: float | None = None) -> dict[str, Any]:
        now = now if now is not None else time.time()
        try:
            payload = self.gateway_status_provider() or {}
            last_success_ms = now_ms()
            self._live_cache = {"ts": now, "payload": payload, "last_success_ms": last_success_ms, "error": None}
        except Exception as exc:
            payload = self._live_cache.get("payload", {}) or {}
            last_success_ms = int(self._live_cache.get("last_success_ms") or 0)
            self._live_cache = {
                "ts": now,
                "payload": payload,
                "last_success_ms": last_success_ms,
                "error": str(exc),
            }
        return {
            "payload": payload,
            "last_success_ms": last_success_ms,
            "error": self._live_cache.get("error"),
            "freshness": self._live_freshness(last_success_ms),
        }

    def _schedule_live_refresh(self) -> None:
        with self._live_refresh_lock:
            if self._live_refresh_running:
                return
            self._live_refresh_running = True

        def worker() -> None:
            try:
                self._refresh_live_cache()
            finally:
                with self._live_refresh_lock:
                    self._live_refresh_running = False

        threading.Thread(target=worker, name="dashboard-live-refresh", daemon=True).start()

    def _claw_live_snapshot(self, non_blocking: bool = False) -> dict[str, Any]:
        now = time.time()
        payload = self._live_cache.get("payload", {})
        last_success_ms = int(self._live_cache.get("last_success_ms") or 0)
        cached = {
            "payload": payload,
            "last_success_ms": last_success_ms,
            "error": self._live_cache.get("error"),
            "freshness": self._live_freshness(last_success_ms),
        }
        if now - self._live_cache.get("ts", 0.0) < 5:
            return cached

        # During hard control, avoid blocking all read APIs on gateway/status refresh.
        with self._control_lock:
            if self._control_inflight > 0:
                return cached

        if non_blocking:
            self._schedule_live_refresh()
            return cached

        with self._live_refresh_lock:
            if self._live_refresh_running:
                return cached
            self._live_refresh_running = True
        try:
            return self._refresh_live_cache(now)
        finally:
            with self._live_refresh_lock:
                self._live_refresh_running = False

    def _load_json(self, path: Path, default: Any) -> Any:
        if not path.exists():
            return default
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            return default

    def _write_json(self, path: Path, payload: Any) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    def _bootstrap_task_store(self) -> None:
        # Import legacy files once so they remain available in read-only history.
        self._ingest_json_tasks_to_repo()
        self._ingest_pangu_queue_to_repo()
        if not self._task_repo.get_meta("cutover_at"):
            self._task_repo.set_meta("cutover_at", now_iso())
        if not self._task_repo.get_meta("workflow_version"):
            self._task_repo.set_meta("workflow_version", "wf-v1")
        if not self._task_repo.get_meta("routing_version"):
            self._task_repo.set_meta("routing_version", "route-v1")
        self._task_sync_cache["ts"] = time.time()

    def _cutover_at(self) -> str:
        cutover = self._task_repo.get_meta("cutover_at")
        if cutover:
            return cutover
        cutover = now_iso()
        self._task_repo.set_meta("cutover_at", cutover)
        return cutover

    def _task_filename(self, task_id: str) -> str:
        slug = re.sub(r"[^a-zA-Z0-9_-]+", "_", str(task_id or "").strip())
        slug = slug.strip("_").lower() or f"task_{int(time.time())}"
        return f"{slug}.json"

    def _current_runtime_versions(self) -> dict[str, str]:
        return {
            "workflow_version": str(self._task_repo.get_meta("workflow_version") or "wf-v1"),
            "routing_version": str(self._task_repo.get_meta("routing_version") or "route-v1"),
        }

    def _bind_task_versions(self, task: dict[str, Any]) -> None:
        if isinstance(task.get("version_binding"), dict) and task["version_binding"].get("workflow_version"):
            return
        versions = self._current_runtime_versions()
        task["version_binding"] = {
            **versions,
            "bound_at": now_iso(),
        }

    def _persist_task_payload(self, payload: dict[str, Any], dispatch_state: str | None = None, source_type: str = "api") -> dict[str, Any]:
        task_id = str(payload.get("task_id") or "").strip()
        if not task_id:
            return payload
        clean_payload = {k: v for k, v in payload.items() if k != "_file"}
        clean_payload["updated_at"] = now_iso()
        if dispatch_state:
            clean_payload["dispatch_state"] = dispatch_state
        source_path = None
        if source_type != "api":
            self.tasks_dir.mkdir(parents=True, exist_ok=True)
            path = self.tasks_dir / self._task_filename(task_id)
            self._write_json(path, clean_payload)
            clean_payload["_file"] = str(path)
            source_path = str(path)
        self._task_repo.upsert_task_payload(
            clean_payload,
            source_type=source_type,
            source_path=source_path,
            dispatch_state=dispatch_state or clean_payload.get("dispatch_state"),
            force=True,
        )
        return clean_payload

    def _queue_item_to_task_payload(self, item: dict[str, Any]) -> dict[str, Any] | None:
        if not isinstance(item, dict):
            return None
        task_id = str(item.get("task_id") or "").strip()
        if not task_id:
            return None
        status = self._normalize_status(str(item.get("status") or "pending"))
        if status == "in_progress":
            progress = 50
        elif status == "completed":
            progress = 100
        else:
            progress = 0

        title = str(item.get("title") or item.get("task_name") or item.get("description") or task_id).strip() or task_id
        description = str(item.get("description") or item.get("task") or title)
        owner = str(item.get("assigned_to") or item.get("required_agent") or "unassigned")
        if owner == "auto":
            owner = "unassigned"

        created_at = str(item.get("submitted_at") or item.get("created_at") or now_iso())
        payload: dict[str, Any] = {
            "task_id": task_id,
            "task_name": title,
            "task_type": str(item.get("task_type") or item.get("type") or "execution_heavy"),
            "description": description,
            "created_at": created_at,
            "created_by": str(item.get("submitted_by") or item.get("submitter") or "pangu"),
            "status": status,
            "dispatch_state": "claim_pool" if owner in {"", "unassigned", "none", "null"} else "dispatched",
            "routing": {
                "source_queue": "pangu_queue",
                "priority": str(item.get("priority") or "P2"),
            },
            "requirements": {
                "output": description,
            },
            "execution": {
                "status": status,
                "progress": progress,
                "assigned_to": owner,
            },
            "updated_at": now_iso(),
        }
        return payload

    def _ingest_json_tasks_to_repo(self) -> int:
        if not self.tasks_dir.exists():
            return 0
        best_by_task: dict[str, tuple[int, dict[str, Any], Path]] = {}
        for path in sorted(self.tasks_dir.glob("*.json")):
            if path.name.startswith("."):
                continue
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
            except Exception:
                continue
            if not isinstance(data, dict):
                continue
            data["_file"] = str(path)
            data.setdefault("task_id", path.stem)
            task_id = str(data.get("task_id") or "").strip()
            if not task_id:
                continue
            updated_src = data.get("updated_at") or (data.get("execution") or {}).get("control", {}).get("updated_at") or data.get("created_at")
            score = int((updated_src and isinstance(updated_src, str)) and True)
            ts = int(time.time())
            try:
                ts = int(parse_dt(str(updated_src)).timestamp()) if parse_dt(str(updated_src)) else int(path.stat().st_mtime)
            except Exception:
                ts = int(path.stat().st_mtime)

            # Prefer explicit updated_at/created_at timestamp; tie-break by file mtime.
            rank = ts * 10 + score
            prev = best_by_task.get(task_id)
            if (prev is None) or (rank >= prev[0]):
                best_by_task[task_id] = (rank, data, path)

        count = 0
        for _, row, path in best_by_task.values():
            self._task_repo.upsert_task_payload(
                row,
                source_type="json_task",
                source_path=str(path),
                dispatch_state=row.get("dispatch_state"),
                force=True,
            )
            count += 1
        return count

    def _ingest_pangu_queue_to_repo(self) -> int:
        queue_doc = self._load_json(self.pangu_queue_path, {})
        queue_rows = queue_doc.get("queue") if isinstance(queue_doc, dict) else None
        if not isinstance(queue_rows, list):
            return 0
        count = 0
        for row in queue_rows:
            payload = self._queue_item_to_task_payload(row if isinstance(row, dict) else {})
            if not payload:
                continue
            self._task_repo.upsert_task_payload(
                payload,
                source_type="pangu_queue",
                source_path=str(self.pangu_queue_path),
                dispatch_state=payload.get("dispatch_state"),
            )
            count += 1
        return count

    def _sync_tasks_to_repo(self, force: bool = False) -> None:
        # Post-cutover, JSON sources are read-only history and not part of the active write path.
        if force:
            self._bootstrap_task_store()

    def _load_agents(self) -> list[dict[str, Any]]:
        config = self._load_json(self.openclaw_config, {})
        agents = (config.get("agents") or {}).get("list") or []
        out: list[dict[str, Any]] = []
        for a in agents:
            aid = str(a.get("id") or "").strip()
            if not aid:
                continue
            primary, fallbacks = model_pair(a.get("model"))
            out.append(
                {
                    "agent_id": aid,
                    "name": str(a.get("name") or aid),
                    "workspace": str(a.get("workspace") or ""),
                    "primary_model": primary,
                    "fallback_models": fallbacks,
                }
            )
        return out

    def _team_for_agent(self, agent_id: str) -> str | None:
        if agent_id.startswith("rd_") or agent_id in {"developer", "tester", "documentation", "coordinator"}:
            return "team-rd"
        if agent_id.startswith("km_") or agent_id in {"knowledge_manager", "scholar"}:
            return "team-km"
        if agent_id.startswith("braintrust") or agent_id in {"architect", "critic", "innovator"}:
            return "team-braintrust"
        if agent_id.startswith("proposal_"):
            return "team-proposal"
        if agent_id.startswith("smart3d_"):
            return "team-smart3d"
        return None

    def _is_team_retired(self, team_id: str | None) -> bool:
        return str(team_id or "") in self.RETIRED_TEAM_IDS

    def _is_team_active(self, team_id: str | None) -> bool:
        return str(team_id or "") in self.ACTIVE_TEAM_IDS

    def _is_governance_actor(self, actor_id: str | None) -> bool:
        aid = str(actor_id or "").strip()
        return aid in {"luban", "main"}

    def _is_review_actor(self, actor_id: str | None) -> bool:
        aid = str(actor_id or "").strip()
        return aid.startswith("braintrust") or aid in {"architect", "critic", "innovator"}

    def _normalize_status(self, raw: str | None) -> str:
        v = (raw or "").strip().lower()
        if v in {"in_progress", "running", "assigned", "started", "working", "active", "resumed"}:
            return "in_progress"
        if v in {"completed", "done", "success", "closed"}:
            return "completed"
        if v in {"pending", "planned", "todo", "ready", "queued", "new", "paused", "stopped"}:
            return "pending"
        return v or "pending"

    def _task_stage_items(self, task: dict[str, Any]) -> list[dict[str, str]]:
        req = task.get("requirements") or {}
        deliverables = req.get("deliverables")
        if isinstance(deliverables, list) and deliverables:
            out = []
            for idx, item in enumerate(deliverables, start=1):
                if isinstance(item, dict):
                    out.append(
                        {
                            "name": str(item.get("item") or f"阶段{idx}"),
                            "description": str(item.get("description") or ""),
                            "owner": str(item.get("owner") or item.get("assignee") or item.get("responsible") or ""),
                            "owner_role": str(item.get("owner_role") or item.get("role") or ""),
                            "key": str(item.get("key") or ""),
                        }
                    )
                else:
                    out.append({"name": str(item), "description": "", "owner": "", "owner_role": "", "key": ""})
            return out

        features = req.get("features")
        if isinstance(features, list) and features:
            return [{"name": str(x), "description": "", "owner": "", "owner_role": "", "key": ""} for x in features]

        output = req.get("output")
        if output:
            return [{"name": str(output), "description": "输出产物", "owner": "", "owner_role": "", "key": ""}]

        return [{"name": "执行", "description": "未定义阶段", "owner": "", "owner_role": "", "key": ""}]

    def _is_complex_task(self, task: dict[str, Any]) -> bool:
        req = task.get("requirements") or {}
        deliverables = req.get("deliverables")
        if isinstance(deliverables, list) and len(deliverables) > 1:
            return True
        ttype = str(task.get("task_type") or task.get("type") or "").lower()
        return any(token in ttype for token in ("complex", "multi_stage", "delivery"))

    def _task_pool_for(self, task: dict[str, Any]) -> str:
        explicit = str(task.get("task_pool") or "").strip()
        if explicit:
            return explicit
        ttype = str(task.get("task_type") or task.get("type") or "").lower()
        status = self._normalize_status(str(task.get("status") or (task.get("execution") or {}).get("status") or "pending"))
        if "review" in ttype or "audit" in ttype:
            return "review_pool"
        if "recovery" in ttype or "resume" in ttype or status == "failed":
            return "recovery_pool"
        if any(token in ttype for token in ("governance", "system_change", "config_change", "change")):
            return "governance_pool"
        if self._is_complex_task(task):
            return "intake_pool"
        return "team_dispatch_pool"

    def _build_stage_cards(self, task: dict[str, Any]) -> list[dict[str, Any]]:
        existing = task.get("stage_cards")
        if isinstance(existing, list) and existing:
            return existing
        cards: list[dict[str, Any]] = []
        for idx, stage in enumerate(self._task_stage_items(task), start=1):
            cards.append(
                {
                    "stage_id": idx,
                    "key": str(stage.get("key") or f"stage_{idx}"),
                    "name": str(stage.get("name") or f"阶段{idx}"),
                    "description": str(stage.get("description") or ""),
                    "owner_agent": str(stage.get("owner") or ""),
                    "owner_role": str(stage.get("owner_role") or ""),
                    "status": "queued",
                    "handoff_note": "",
                    "rework_target": "",
                }
            )
        return cards

    def _stage_cards_for_detail(self, task: dict[str, Any]) -> list[dict[str, Any]]:
        cards = self._build_stage_cards(task)
        execution = task.get("execution") or {}
        normalized_status = self._normalize_status(str(execution.get("status") or task.get("status") or "pending"))
        current_step = str(execution.get("current_step") or "").strip()
        current_idx = None
        for idx, card in enumerate(cards):
            if current_step and str(card.get("name") or "") == current_step:
                current_idx = idx
                break
        if current_idx is None and cards and normalized_status in {"in_progress", "pending"}:
            for idx, card in enumerate(cards):
                if str(card.get("status") or "") in {"assigned", "in_progress"}:
                    current_idx = idx
                    break
        if normalized_status == "completed":
            for card in cards:
                card["status"] = "completed"
            return cards
        if current_idx is None:
            return cards
        for idx, card in enumerate(cards):
            if idx < current_idx:
                card["status"] = "completed"
            elif idx == current_idx:
                card["status"] = "in_progress" if normalized_status == "in_progress" else str(card.get("status") or "queued")
            else:
                card["status"] = "queued"
        return cards

    def _stage_owner_from_task_defaults(self, task: dict[str, Any]) -> str:
        execution = task.get("execution") or {}
        routing = task.get("routing") or {}
        raci = task.get("raci") or {}
        return str(
            execution.get("assigned_to")
            or routing.get("target_agent")
            or raci.get("responsible")
            or "unassigned"
        )

    def _norm_stage_key(self, value: str | None) -> str:
        raw = str(value or "").strip().lower()
        if not raw:
            return ""
        return "".join(ch for ch in raw if ch.isalnum())

    def _match_stage_index_from_execution(self, task: dict[str, Any], stages: list[dict[str, str]]) -> int | None:
        execution = task.get("execution") or {}
        current_step = str(execution.get("current_step") or "").strip()
        if not current_step:
            return None
        cur = self._norm_stage_key(current_step)
        if not cur:
            return None

        for idx, st in enumerate(stages):
            cands = [
                self._norm_stage_key(st.get("key")),
                self._norm_stage_key(st.get("name")),
                self._norm_stage_key(st.get("description")),
            ]
            for c in cands:
                if not c:
                    continue
                if c in cur or cur in c:
                    return idx
        return None

    def _task_todo_items(self, task: dict[str, Any]) -> list[str]:
        req = task.get("requirements") or {}
        out: list[str] = []

        deliverables = req.get("deliverables")
        if isinstance(deliverables, list):
            for d in deliverables:
                if isinstance(d, dict):
                    title = str(d.get("item") or "")
                    desc = str(d.get("description") or "")
                    if title and desc:
                        out.append(f"{title}: {desc}")
                    elif title:
                        out.append(title)
                elif d:
                    out.append(str(d))

        features = req.get("features")
        if isinstance(features, list):
            out.extend(str(x) for x in features if x)

        output = req.get("output")
        if output:
            out.append(f"输出: {output}")

        acceptance = task.get("acceptance_criteria")
        if isinstance(acceptance, list):
            out.extend(f"验收: {x}" for x in acceptance if x)

        dedup: list[str] = []
        for item in out:
            if item not in dedup:
                dedup.append(item)
        return dedup

    def _load_tasks_raw(self) -> list[dict[str, Any]]:
        self._sync_tasks_to_repo()
        rows, _, _ = self._task_repo.list_task_payloads(limit=8000, offset=0, sort="updated_at_ms", order="desc")
        if rows:
            return rows
        # fallback for first-run corrupted DB or empty migration state
        if not self.tasks_dir.exists():
            return []
        tasks: list[dict[str, Any]] = []
        for path in sorted(self.tasks_dir.glob("*.json")):
            if path.name.startswith("."):
                continue
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
            except Exception:
                continue
            if not isinstance(data, dict):
                continue
            data["_file"] = str(path)
            data.setdefault("task_id", path.stem)
            tasks.append(data)
        return tasks

    def _sessions_from_live(self, live_payload: dict[str, Any]) -> list[dict[str, Any]]:
        sessions = (live_payload.get("sessions") or {}) if isinstance(live_payload, dict) else {}
        out: list[dict[str, Any]] = []

        recent = sessions.get("recent") or []
        if isinstance(recent, list):
            for row in recent:
                if not isinstance(row, dict):
                    continue
                out.append(
                    {
                        "agent_id": str(row.get("agentId") or ""),
                        "key": str(row.get("key") or ""),
                        "updated_at_ms": row.get("updatedAt"),
                        "session_id": str(row.get("sessionId") or ""),
                        "kind": str(row.get("kind") or "direct"),
                    }
                )

        by_agent = sessions.get("byAgent") or []
        if isinstance(by_agent, list):
            for item in by_agent:
                if not isinstance(item, dict):
                    continue
                aid = str(item.get("agentId") or "")
                recents = item.get("recent") or []
                if not isinstance(recents, list):
                    continue
                for row in recents:
                    if not isinstance(row, dict):
                        continue
                    out.append(
                        {
                            "agent_id": aid or str(row.get("agentId") or ""),
                            "key": str(row.get("key") or ""),
                            "updated_at_ms": row.get("updatedAt"),
                            "session_id": str(row.get("sessionId") or ""),
                            "kind": str(row.get("kind") or "direct"),
                        }
                    )

        uniq: dict[tuple[str, str], dict[str, Any]] = {}
        for row in out:
            key = (row.get("agent_id") or "", row.get("key") or "")
            if key not in uniq:
                uniq[key] = row
                continue
            prev = uniq[key]
            if (row.get("updated_at_ms") or 0) > (prev.get("updated_at_ms") or 0):
                uniq[key] = row

        return list(uniq.values())

    def _build_agent_runtime(self, non_blocking: bool = False) -> dict[str, dict[str, Any]]:
        live = self._claw_live_snapshot(non_blocking=non_blocking)["payload"]
        runtime: dict[str, dict[str, Any]] = {}

        # primary shape from classic status payload
        agent_items = (((live.get("agents") or {}).get("agents")) or [])
        for item in agent_items:
            aid = str(item.get("id") or "")
            if not aid:
                continue
            runtime[aid] = {
                "last_updated_at_ms": item.get("lastUpdatedAt"),
                "last_active_age_ms": item.get("lastActiveAgeMs"),
                "bootstrap_pending": bool(item.get("bootstrapPending")),
                "sessions_count": item.get("sessionsCount") or 0,
                "heartbeat_enabled": None,
            }

        hb_agents = (((live.get("heartbeat") or {}).get("agents")) or [])
        for hb in hb_agents:
            aid = str(hb.get("agentId") or "")
            if not aid:
                continue
            row = runtime.setdefault(
                aid,
                {
                    "last_updated_at_ms": None,
                    "last_active_age_ms": None,
                    "bootstrap_pending": False,
                    "sessions_count": 0,
                    "heartbeat_enabled": None,
                },
            )
            row["heartbeat_enabled"] = bool(hb.get("enabled"))

        now = now_ms()
        by_agent = (((live.get("sessions") or {}).get("byAgent")) or [])
        for item in by_agent:
            aid = str(item.get("agentId") or "")
            if not aid:
                continue
            row = runtime.setdefault(
                aid,
                {
                    "last_updated_at_ms": None,
                    "last_active_age_ms": None,
                    "bootstrap_pending": False,
                    "sessions_count": 0,
                    "heartbeat_enabled": None,
                },
            )
            count = item.get("count")
            if isinstance(count, int):
                row["sessions_count"] = max(int(row.get("sessions_count") or 0), count)
            recents = item.get("recent") or []
            if isinstance(recents, list) and recents:
                top = recents[0]
                updated = top.get("updatedAt") if isinstance(top, dict) else None
                if isinstance(updated, (int, float)):
                    if not row.get("last_updated_at_ms") or updated > row.get("last_updated_at_ms"):
                        row["last_updated_at_ms"] = int(updated)
                        row["last_active_age_ms"] = max(0, now - int(updated))

        return runtime

    def _agent_health(self, agent_id: str, runtime: dict[str, dict[str, Any]], has_active_task: bool) -> dict[str, Any]:
        info = runtime.get(agent_id) or {}
        age_ms = info.get("last_active_age_ms")
        last_ms = info.get("last_updated_at_ms")
        stalled = bool(has_active_task and isinstance(age_ms, (int, float)) and age_ms > 30 * 60 * 1000)

        if age_ms is None:
            status = "unknown"
        elif age_ms <= 15 * 60 * 1000:
            status = "healthy"
        elif age_ms <= 60 * 60 * 1000:
            status = "warning"
        else:
            status = "stale"

        last_heartbeat = None
        if isinstance(last_ms, (int, float)):
            last_heartbeat = datetime.fromtimestamp(last_ms / 1000, tz=timezone.utc).astimezone().isoformat()

        return {
            "status": status,
            "is_stalled": stalled,
            "last_heartbeat": last_heartbeat,
            "last_active_age_ms": age_ms,
            "bootstrap_pending": bool(info.get("bootstrap_pending")),
            "sessions_count": int(info.get("sessions_count") or 0),
            "heartbeat_enabled": info.get("heartbeat_enabled"),
        }

    def _runtime_state(self, status: str, health: dict[str, Any]) -> dict[str, Any]:
        if status == "in_progress":
            if health.get("status") == "healthy":
                return {"state": "running", "hint": "active"}
            if health.get("status") == "warning":
                return {"state": "running", "hint": "slow"}
            if health.get("status") == "stale":
                return {"state": "stalled", "hint": "stalled"}
            return {"state": "running", "hint": "unknown"}

        if status == "completed":
            return {"state": "idle", "hint": "done"}

        if health.get("status") in {"healthy", "warning"}:
            return {"state": "idle", "hint": "standby"}

        return {"state": "unknown", "hint": "unknown"}

    def _summarize_task(self, task: dict[str, Any]) -> dict[str, Any]:
        execution = task.get("execution") or {}
        status = self._normalize_status(execution.get("status") or task.get("status"))
        progress = execution.get("progress")
        if not isinstance(progress, (int, float)):
            progress = 100 if status == "completed" else 0
        progress = max(0, min(100, int(progress)))

        owner = str(
            execution.get("assigned_to")
            or (task.get("next_action") or {}).get("assignee")
            or (task.get("routing") or {}).get("target_agent")
            or "unassigned"
        )
        team = str(task.get("team") or "").strip() or self._team_for_agent(owner) or "unassigned"
        dispatch_state = str(task.get("dispatch_state") or "")
        task_pool = str(task.get("task_pool") or self._task_pool_for(task))
        parent_task_id = str(task.get("parent_task_id") or "")
        stage_cards = self._stage_cards_for_detail(task) if task_pool == "intake_pool" or task.get("stage_cards") else []
        is_parent_task = bool(task.get("is_parent_task")) or task_pool == "intake_pool"

        stages = self._task_stage_items(task)
        total = len(stages)
        completed = total if status == "completed" else int(total * progress / 100)
        completed = max(0, min(total, completed))
        inferred_idx = self._match_stage_index_from_execution(task, stages)
        if inferred_idx is not None and total:
            if status == "in_progress":
                completed = max(0, min(total, inferred_idx))
            current_idx = max(0, min(total - 1, inferred_idx))
        else:
            current_idx = min(total - 1, completed) if total else 0
        current_stage = stages[current_idx]["name"] if total else ""
        next_stage = stages[current_idx + 1]["name"] if total and current_idx + 1 < total else ""

        flow = self._derive_task_flow(task, owner)

        return {
            "task_id": str(task.get("task_id") or ""),
            "task_name": str(task.get("task_name") or ""),
            "task_type": str(task.get("task_type") or ""),
            "status": status,
            "progress": progress,
            "created_at": str(task.get("created_at") or ""),
            "created_by": str(task.get("created_by") or "unknown"),
            "owner": owner,
            "team": team,
            "task_pool": task_pool,
            "parent_task_id": parent_task_id or (str(task.get("task_id") or "") if is_parent_task else ""),
            "is_parent_task": is_parent_task,
            "dispatch_state": dispatch_state or ("claim_pool" if owner in {"", "unassigned", "none", "null"} else "dispatched"),
            "team_flow": flow,
            "total_stages": total,
            "completed_stages": completed,
            "remaining_stages": max(0, total - completed),
            "current_stage_index": current_idx,
            "current_stage": current_stage,
            "next_stage": next_stage,
            "unclaimed": owner in {"", "unassigned", "none", "null"},
            "stage_cards": stage_cards,
            "business_bound": bool(task.get("business_bound")),
            "business_truth_source": str(task.get("business_truth_source") or ""),
            "acceptance_result": str(task.get("acceptance_result") or ""),
            "gate_result": str(task.get("gate_result") or ""),
            "_raw": task,
        }

    def _derive_task_flow(self, task: dict[str, Any], owner: str) -> list[str]:
        flow: list[str] = []
        creator = str(task.get("created_by") or "")
        creator_team = self._team_for_agent(creator)
        if creator_team:
            flow.append(creator_team)

        owner_team = self._team_for_agent(owner)
        if owner_team:
            flow.append(owner_team)

        review = task.get("review") or {}
        reviewer = review.get("reviewer")
        if reviewer:
            review_team = self._team_for_agent(str(reviewer))
            if review_team:
                flow.append(review_team)

        next_action = task.get("next_action") or {}
        assignee = next_action.get("assignee")
        if assignee:
            next_team = self._team_for_agent(str(assignee))
            if next_team:
                flow.append(next_team)

        uniq = []
        for t in flow:
            if t not in uniq:
                uniq.append(t)
        return uniq

    def _team_leads_doc(self) -> dict[str, Any]:
        return self._load_json(self.team_leads_path, {})

    def _team_state_machines_doc(self) -> dict[str, Any]:
        return self._load_json(self.team_state_machines_path, {})

    def _team_leads(self) -> dict[str, Any]:
        return self._team_leads_doc().get("team_leads") or {}

    def _team_workflows(self) -> dict[str, list[str]]:
        data = self._team_state_machines_doc()
        team_sms = data.get("team_state_machines") or {}
        out: dict[str, list[str]] = {}
        for tid, cfg in team_sms.items():
            states = cfg.get("internal_states") or []
            out[tid] = [str(x) for x in states]
        return out

    def _team_transitions(self) -> dict[str, dict[str, list[str]]]:
        data = self._team_state_machines_doc()
        team_sms = data.get("team_state_machines") or {}
        out: dict[str, dict[str, list[str]]] = {}
        for tid, cfg in team_sms.items():
            transitions = cfg.get("transitions") or {}
            out[tid] = {}
            for src, dsts in transitions.items():
                if isinstance(dsts, list):
                    out[tid][str(src)] = [str(x) for x in dsts]
                else:
                    out[tid][str(src)] = []
        return out

    def _select_owner_for_stage(self, team_id: str, stage: str, available_agents: set[str]) -> tuple[str, str]:
        mapping = self.TEAM_STAGE_ROLE_MAP.get(team_id, {})
        role, candidates = mapping.get(stage, ("Executor", tuple()))
        for aid in candidates:
            if aid in available_agents:
                return role, aid
        if candidates:
            return role, candidates[0]
        return "Executor", "unassigned"

    def _get_task_by_id(self, task_id: str | None) -> dict[str, Any] | None:
        if not task_id:
            return None
        self._sync_tasks_to_repo()
        task = self._task_repo.get_task_payload(task_id, include_archived=True)
        if isinstance(task, dict):
            return task
        for t in self._load_tasks_raw():
            if str(t.get("task_id") or "") == task_id:
                return t
        return None

    def _task_file_conflicts(self, task_id: str) -> dict[str, Any]:
        matches: list[dict[str, Any]] = []
        if not self.tasks_dir.exists():
            return {"has_conflict": False, "count": 0, "items": []}
        for path in sorted(self.tasks_dir.glob("*.json")):
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
            except Exception:
                continue
            if not isinstance(data, dict):
                continue
            if str(data.get("task_id") or "") != task_id:
                continue
            execution = data.get("execution") or {}
            matches.append(
                {
                    "path": str(path),
                    "status": self._normalize_status(execution.get("status") or data.get("status")),
                    "updated_at": str(data.get("updated_at") or ""),
                }
            )

        if len(matches) <= 1:
            return {"has_conflict": False, "count": len(matches), "items": matches}
        status_set = {m.get("status") for m in matches}
        has_conflict = len(status_set) > 1
        return {"has_conflict": has_conflict, "count": len(matches), "items": matches}

    def _control_audit_entries(self, task_id: str, limit: int = 12) -> list[dict[str, Any]]:
        self._sync_tasks_to_repo()
        rows = self._task_repo.list_control_audit(task_id, limit=limit)
        if rows:
            return rows
        if not self.control_audit_path.exists():
            return []
        out: list[dict[str, Any]] = []
        try:
            lines = self.control_audit_path.read_text(encoding="utf-8").splitlines()
        except Exception:
            return []

        for line in reversed(lines):
            if not line.strip():
                continue
            try:
                row = json.loads(line)
            except Exception:
                continue
            if str(row.get("task_id") or "") != task_id:
                continue
            out.append(row)
            if len(out) >= limit:
                break
        return out

    def _append_control_audit(self, payload: dict[str, Any]) -> None:
        self.control_audit_path.parent.mkdir(parents=True, exist_ok=True)
        with self.control_audit_path.open("a", encoding="utf-8") as f:
            f.write(json.dumps(payload, ensure_ascii=False) + "\n")
        try:
            self._task_repo.add_control_audit(payload)
        except Exception:
            pass

    def _try_hard_control(self, task: dict[str, Any], action: str, reason: str) -> dict[str, Any]:
        summary = self._summarize_task(task)
        owner = summary.get("owner") or ""
        if owner in {"", "unassigned", "none", "null"}:
            return {"ok": False, "message": "owner unavailable", "stdout": "", "stderr": "owner unavailable"}

        if action == "stop":
            prompt = f"请立即暂停任务 {summary['task_id']}，并回复 PAUSED。原因: {reason or 'dashboard_manual_control'}"
        else:
            prompt = f"请立即继续任务 {summary['task_id']}，并回复 RESUMED。原因: {reason or 'dashboard_manual_control'}"

        try:
            proc = subprocess.run(
                [
                    "openclaw",
                    "agent",
                    "--agent",
                    str(owner),
                    "--message",
                    prompt,
                    "--timeout",
                    str(self.HARD_CONTROL_TIMEOUT_SECONDS),
                    "--json",
                ],
                cwd=str(self.base_dir),
                capture_output=True,
                text=True,
                timeout=self.HARD_CONTROL_TIMEOUT_SECONDS + 10,
                check=True,
            )
            return {"ok": True, "message": "agent command accepted", "stdout": proc.stdout, "stderr": proc.stderr}
        except Exception as exc:
            return {"ok": False, "message": "agent command failed", "stdout": "", "stderr": str(exc)}

    def _apply_soft_control(self, task: dict[str, Any], action: str, reason: str, hard_error: str | None = None) -> None:
        execution = task.setdefault("execution", {})
        if action == "stop":
            execution["status"] = "paused"
            task["status"] = "pending"
        else:
            execution["status"] = "in_progress"
            task["status"] = "in_progress"
            execution.setdefault("started_at", now_iso())
            progress = execution.get("progress")
            if not isinstance(progress, (int, float)):
                execution["progress"] = 5

        control = execution.setdefault("control", {})
        control["last_action"] = action
        control["last_reason"] = reason
        control["last_mode"] = "soft"
        control["last_error"] = hard_error
        control["updated_at"] = now_iso()

    def _control_task_sync(
        self,
        task_id: str | None,
        action: str | None,
        operator: str | None,
        reason: str | None,
        operator_role: str | None = None,
    ) -> dict[str, Any]:
        if not task_id:
            return {"ok": False, "error": "task_id required"}
        action = (action or "").strip().lower()
        if action not in {"stop", "restart"}:
            return {"ok": False, "error": "action must be stop|restart"}

        task = self._get_task_by_id(task_id)
        if not task:
            return {"ok": False, "error": "task not found"}
        team_id = str(task.get("team") or self._team_for_agent(str(((task.get("execution") or {}).get("assigned_to") or ""))) or "unassigned")
        if not self._can_manage_task(operator, operator_role, team_id):
            return {"ok": False, "error": "permission denied"}

        file_path = Path(str(task.get("_file") or "")) if task.get("_file") else None

        operator = operator or "dashboard"
        reason = reason or "manual_control"

        with self._control_lock:
            self._control_inflight += 1
        try:
            hard = self._try_hard_control(task, action, reason)
        finally:
            with self._control_lock:
                self._control_inflight = max(0, self._control_inflight - 1)

        mode = "hard"
        message = hard.get("message") or "ok"
        if not hard.get("ok"):
            mode = "soft"
            message = "hard control failed; fallback to soft"
            self._apply_soft_control(task, action, reason, hard.get("stderr"))
            if file_path and file_path.exists():
                self._write_json(file_path, {k: v for k, v in task.items() if k != "_file"})
                task["_file"] = str(file_path)
            self._task_repo.upsert_task_payload(
                task,
                source_type="api",
                source_path=str(file_path) if file_path else None,
                dispatch_state=str(task.get("dispatch_state") or ""),
            )

        result = {
            "ok": True,
            "mode": mode,
            "action": action,
            "task_id": task_id,
            "operator": operator,
            "message": message,
            "hard": {"ok": bool(hard.get("ok")), "error": hard.get("stderr") if not hard.get("ok") else None},
            "updated_at": now_iso(),
        }

        self._append_control_audit(
            {
                "ts": now_iso(),
                "task_id": task_id,
                "action": action,
                "mode": mode,
                "operator": operator,
                "reason": reason,
                "hard_ok": bool(hard.get("ok")),
                "hard_error": hard.get("stderr") if not hard.get("ok") else None,
            }
        )
        return result

    def _control_job_prune(self, keep: int = 120) -> None:
        with self._control_job_lock:
            if len(self._control_jobs) <= keep:
                return
            rows = sorted(self._control_jobs.values(), key=lambda x: x.get("created_at") or "", reverse=True)
            keep_ids = {r.get("job_id") for r in rows[:keep]}
            self._control_jobs = {k: v for k, v in self._control_jobs.items() if k in keep_ids}

    def _run_control_job(self, job_id: str) -> None:
        with self._control_job_lock:
            job = self._control_jobs.get(job_id)
            if not job:
                return
            job["state"] = "running"
            job["started_at"] = now_iso()

        task_id = str(job.get("task_id") or "")
        action = str(job.get("action") or "")
        operator = str(job.get("operator") or "dashboard")
        reason = str(job.get("reason") or "manual_control")
        operator_role = str(job.get("operator_role") or "admin")

        try:
            result = self._control_task_sync(task_id=task_id, action=action, operator=operator, reason=reason, operator_role=operator_role)
            state = "finished" if bool(result.get("ok")) else "failed"
            error = result.get("error") if state == "failed" else None
        except Exception as exc:
            result = {"ok": False, "error": str(exc), "task_id": task_id, "action": action}
            state = "failed"
            error = str(exc)

        with self._control_job_lock:
            row = self._control_jobs.get(job_id)
            if row:
                row["state"] = state
                row["finished_at"] = now_iso()
                row["result"] = result
                row["error"] = error
        self._control_job_prune()

    def control_task(
        self,
        task_id: str | None,
        action: str | None,
        operator: str | None,
        reason: str | None,
        async_mode: bool = False,
        operator_role: str | None = None,
    ) -> dict[str, Any]:
        if not async_mode:
            return self._control_task_sync(task_id=task_id, action=action, operator=operator, reason=reason, operator_role=operator_role)

        if not task_id:
            return {"ok": False, "error": "task_id required"}
        action = (action or "").strip().lower()
        if action not in {"stop", "restart"}:
            return {"ok": False, "error": "action must be stop|restart"}

        task = self._get_task_by_id(task_id)
        if not task:
            return {"ok": False, "error": "task not found"}

        job_id = f"ctrl-{uuid.uuid4().hex[:12]}"
        job = {
            "job_id": job_id,
            "task_id": task_id,
            "action": action,
            "operator": operator or "dashboard",
            "operator_role": operator_role or "admin",
            "reason": reason or "manual_control",
            "state": "queued",
            "created_at": now_iso(),
            "started_at": None,
            "finished_at": None,
            "result": None,
            "error": None,
        }
        with self._control_job_lock:
            self._control_jobs[job_id] = job

        th = threading.Thread(target=self._run_control_job, args=(job_id,), daemon=True, name=f"control-{job_id}")
        th.start()

        return {
            "ok": True,
            "accepted": True,
            "async": True,
            "job_id": job_id,
            "state": "queued",
            "task_id": task_id,
            "action": action,
            "updated_at": now_iso(),
        }

    def get_task_control_status(self, job_id: str | None) -> dict[str, Any]:
        if not job_id:
            return {"ok": False, "error": "job_id required"}
        with self._control_job_lock:
            job = self._control_jobs.get(job_id)
            if not job:
                return {"ok": False, "error": "job not found"}
            row = dict(job)
        return {"ok": True, **row, "updated_at": now_iso()}

    def delete_task(self, task_id: str | None, operator: str | None, reason: str | None, operator_role: str | None = None) -> dict[str, Any]:
        if not task_id:
            return {"ok": False, "error": "task_id required"}
        self._sync_tasks_to_repo()
        task = self._get_task_by_id(task_id)
        if not task:
            return {"ok": False, "error": "task not found"}
        team_id = str(task.get("team") or self._team_for_agent(str(((task.get("execution") or {}).get("assigned_to") or ""))) or "unassigned")
        if not self._can_manage_task(operator, operator_role, team_id):
            return {"ok": False, "error": "permission denied"}

        stamp = datetime.now().strftime("%Y%m%d")
        target_dir = self.task_archive_dir / stamp
        target_dir.mkdir(parents=True, exist_ok=True)

        src_path = str(task.get("_file") or "").strip()
        src = Path(src_path) if src_path else None
        src_is_file = bool(src and src.exists() and src.is_file())
        base_name = src.name if src_is_file else self._task_filename(task_id)
        target = target_dir / base_name
        if target.exists():
            stem = src.stem if src_is_file else task_id.lower().replace("-", "_")
            target = target_dir / f"{stem}-{int(time.time())}.json"

        archive_payload = {
            "archived_meta": {
                "archived_at": now_iso(),
                "operator": operator or "dashboard",
                "reason": reason or "manual_delete",
                "source_path": str(src) if src_is_file else None,
            },
            "task": {k: v for k, v in task.items() if k != "_file"},
        }
        self._write_json(target, archive_payload)
        if src_is_file:
            src.unlink(missing_ok=True)
        self._task_repo.archive_task(task_id, archive_path=str(target))

        self._append_control_audit(
            {
                "ts": now_iso(),
                "task_id": task_id,
                "action": "delete",
                "mode": "archive",
                "operator": operator or "dashboard",
                "reason": reason or "manual_delete",
                "archive_path": str(target),
            }
        )
        try:
            self._task_repo.add_event(
                task_id=task_id,
                event_type="task_deleted",
                actor_id=operator or "dashboard",
                actor_role="admin",
                payload={"archive_path": str(target), "reason": reason or "manual_delete"},
            )
        except Exception:
            pass

        return {
            "ok": True,
            "task_id": task_id,
            "archive_path": str(target),
            "updated_at": now_iso(),
        }

    def restore_task(
        self,
        task_id: str | None,
        archive_path: str | None = None,
        operator: str | None = None,
        operator_role: str | None = None,
    ) -> dict[str, Any]:
        if not task_id:
            return {"ok": False, "error": "task_id required"}
        self._sync_tasks_to_repo()

        candidate: Path | None = None
        if archive_path:
            p = Path(archive_path)
            if p.exists():
                candidate = p

        if candidate is None:
            candidates = sorted(self.task_archive_dir.glob("**/*.json"), key=lambda p: p.stat().st_mtime, reverse=True)
            for p in candidates:
                data = self._load_json(p, {})
                task = data.get("task") if isinstance(data, dict) else None
                if isinstance(task, dict) and str(task.get("task_id") or "") == task_id:
                    candidate = p
                    break

        if candidate is None:
            return {"ok": False, "error": "archived task not found"}

        data = self._load_json(candidate, {})
        task_payload = data.get("task") if isinstance(data, dict) else None
        if not isinstance(task_payload, dict):
            return {"ok": False, "error": "archive payload invalid"}
        team_id = str(task_payload.get("team") or self._team_for_agent(str(((task_payload.get("execution") or {}).get("assigned_to") or ""))) or "unassigned")
        if not self._can_manage_task(operator, operator_role, team_id):
            return {"ok": False, "error": "permission denied"}
        self._task_repo.restore_task(task_payload, source_path=None)

        restored_dir = candidate.parent / "_restored"
        restored_dir.mkdir(parents=True, exist_ok=True)
        shutil.move(str(candidate), str(restored_dir / candidate.name))

        self._append_control_audit(
            {
                "ts": now_iso(),
                "task_id": task_id,
                "action": "restore",
                "mode": "archive",
                "operator": operator or "dashboard",
                "reason": "manual_restore",
                "restored_path": f"db:{task_id}",
            }
        )
        try:
            self._task_repo.add_event(
                task_id=task_id,
                event_type="task_restored",
                actor_id=operator or "dashboard",
                actor_role=self._normalize_actor_role(operator_role),
                payload={"restored_path": f"db:{task_id}"},
            )
        except Exception:
            pass

        return {"ok": True, "task_id": task_id, "restored_path": f"db:{task_id}", "updated_at": now_iso()}

    def _extract_dashboard_url(self, text: str) -> str | None:
        m = re.search(r"https?://[^\s]+", text)
        if not m:
            return None
        return m.group(0).strip()

    def _dashboard_url(self) -> str | None:
        now = time.time()
        if now - float(self._dashboard_url_cache.get("ts") or 0) < 300:
            return self._dashboard_url_cache.get("url")

        try:
            proc = subprocess.run(
                ["openclaw", "dashboard", "--no-open"],
                cwd=str(self.base_dir),
                capture_output=True,
                text=True,
                timeout=10,
                check=True,
            )
            url = self._extract_dashboard_url(proc.stdout)
        except Exception:
            url = None

        self._dashboard_url_cache = {"ts": now, "url": url}
        return url

    def _token_from_dashboard_url(self, url: str | None) -> str | None:
        if not url:
            return None
        parsed = urlparse(url)
        frag = parsed.fragment or ""
        if frag.startswith("token="):
            return frag.split("=", 1)[1]
        q = parse_qs(parsed.query)
        if (q.get("token") or [None])[0]:
            return (q.get("token") or [None])[0]
        return None

    def _chat_link_for_session(self, session_key: str) -> str:
        dash = self._dashboard_url() or "http://127.0.0.1:18789/#token="
        parsed = urlparse(dash)
        token = self._token_from_dashboard_url(dash) or ""
        base = f"{parsed.scheme or 'http'}://{parsed.netloc or '127.0.0.1:18789'}"
        return f"{base}/chat?session={quote(session_key)}#token={token}"

    def get_task_chat_link(self, task_id: str | None) -> dict[str, Any]:
        if not task_id:
            return {"ok": False, "error": "task_id required"}
        task = self._get_task_by_id(task_id)
        if not task:
            return {"ok": False, "error": "task not found"}

        summary = self._summarize_task(task)
        owner = str(summary.get("owner") or "")
        live = self._claw_live_snapshot()
        session_rows = self._sessions_from_live(live.get("payload") or {})

        identifiers: list[str] = [
            str(task.get("task_id") or ""),
            str(((task.get("routing") or {}).get("pangu_task_id") or "")),
            str(((task.get("review") or {}).get("review_id") or "")),
            str(((task.get("submission") or {}).get("id") or "")),
        ]
        identifiers = [x for x in identifiers if x]

        chosen: dict[str, Any] | None = None
        confidence = 0.0
        reason = "fallback_owner_main"

        for row in session_rows:
            key_l = str(row.get("key") or "").lower()
            for ident in identifiers:
                if ident and ident.lower() in key_l:
                    score = 0.95
                    if chosen is None or score > confidence or (
                        score == confidence and (row.get("updated_at_ms") or 0) > (chosen.get("updated_at_ms") or 0)
                    ):
                        chosen = row
                        confidence = score
                        reason = f"identifier:{ident}"

        if chosen is None and owner:
            owner_sessions = [s for s in session_rows if str(s.get("agent_id") or "") == owner]
            owner_sessions.sort(key=lambda x: x.get("updated_at_ms") or 0, reverse=True)
            if owner_sessions:
                chosen = owner_sessions[0]
                confidence = 0.72
                reason = "owner_recent_session"

        session_key = str(chosen.get("key") or "") if chosen else f"agent:{owner}:main"
        if not session_key:
            session_key = "agent:main:main"
            confidence = 0.3
            reason = "global_fallback"

        return {
            "ok": True,
            "task_id": task_id,
            "session_key": session_key,
            "session_id": str(chosen.get("session_id") or "") if chosen else "",
            "confidence": round(confidence or 0.4, 2),
            "reason": reason,
            "url": self._chat_link_for_session(session_key),
            "live_freshness": live.get("freshness"),
            "updated_at": now_iso(),
        }

    def _normalize_actor_role(self, actor_role: str | None) -> str:
        v = (actor_role or "").strip().lower()
        return v or "agent"

    def _is_team_lead(self, actor_id: str | None, team_id: str | None) -> bool:
        if not actor_id or not team_id:
            return False
        team_leads = self._team_leads()
        lead_cfg = team_leads.get(team_id) or {}
        return str(lead_cfg.get("lead_agent") or "") == str(actor_id)

    def _can_manage_task(self, actor_id: str | None, actor_role: str | None, team_id: str | None) -> bool:
        if actor_role is None:
            return bool(actor_id)
        role = self._normalize_actor_role(actor_role)
        if not actor_id and role == "agent":
            # backward-compatible default for legacy local scripts
            return True
        if role in {"admin", "administrator", "owner", "manager", "ops", "system"}:
            return True
        if role in {"team_lead", "lead"}:
            return self._is_team_lead(actor_id, team_id)
        return self._is_team_lead(actor_id, team_id)

    def _can_create_task(self, actor_id: str | None, actor_role: str | None, team_id: str | None) -> bool:
        return self._can_manage_task(actor_id, actor_role, team_id)

    def _can_update_task_execution(self, task: dict[str, Any], actor_id: str | None, actor_role: str | None) -> bool:
        if not actor_id:
            return False
        team_id = str(task.get("team") or self._team_for_agent(str(((task.get("execution") or {}).get("assigned_to") or ""))) or "unassigned")
        if self._can_manage_task(actor_id, actor_role, team_id):
            return True
        execution = task.get("execution") or {}
        assigned_to = str(execution.get("assigned_to") or "")
        return assigned_to == actor_id

    def _generate_task_id(self) -> str:
        return f"TASK-{datetime.now().strftime('%Y%m%d')}-{uuid.uuid4().hex[:6].upper()}"

    def create_task(self, payload: dict[str, Any] | None, actor_id: str | None, actor_role: str | None) -> dict[str, Any]:
        body = payload or {}
        task_id = str(body.get("task_id") or "").strip() or self._generate_task_id()
        task_name = str(body.get("task_name") or body.get("title") or "").strip()
        if not task_name:
            return {"ok": False, "error": "task_name required"}

        owner = str(body.get("owner") or body.get("assigned_to") or "unassigned")
        if owner in {"auto", "none", "null"}:
            owner = "unassigned"
        status = self._normalize_status(str(body.get("status") or "pending"))
        if status == "in_progress" and owner in {"", "unassigned"}:
            status = "pending"
        progress = body.get("progress")
        if not isinstance(progress, (int, float)):
            progress = 100 if status == "completed" else 0
        team = str(body.get("team") or self._team_for_agent(owner) or "unassigned")
        if self._is_team_retired(team):
            team = "unassigned"
        if not self._can_create_task(actor_id, actor_role, team):
            return {"ok": False, "error": "permission denied"}
        dispatch_state = str(body.get("dispatch_state") or ("claim_pool" if owner in {"", "unassigned"} else "dispatched"))
        task_pool = self._task_pool_for(body)

        created_at = str(body.get("created_at") or now_iso())
        task_payload: dict[str, Any] = {
            "task_id": task_id,
            "task_name": task_name,
            "task_type": str(body.get("task_type") or body.get("type") or "general"),
            "description": str(body.get("description") or ""),
            "created_at": created_at,
            "updated_at": now_iso(),
            "created_by": str(actor_id or body.get("created_by") or "dashboard"),
            "team": team,
            "status": status,
            "task_pool": task_pool,
            "dispatch_state": dispatch_state,
            "priority": str(body.get("priority") or "P2"),
            "requirements": body.get("requirements") if isinstance(body.get("requirements"), dict) else {"output": str(body.get("description") or task_name)},
            "execution": {
                "status": status,
                "progress": max(0, min(100, int(progress))),
                "assigned_to": owner,
                "started_at": created_at if status == "in_progress" else None,
            },
            "routing": body.get("routing") if isinstance(body.get("routing"), dict) else {},
            "next_action": body.get("next_action") if isinstance(body.get("next_action"), dict) else {},
            "business_bound": bool(body.get("business_bound")),
            "business_truth_source": str(body.get("business_truth_source") or ""),
            "acceptance_result": str(body.get("acceptance_result") or ""),
            "gate_result": str(body.get("gate_result") or ""),
            "artifact_index": list(body.get("artifact_index") or []),
            "required_inputs": list(body.get("required_inputs") or []),
            "missing_inputs": list(body.get("missing_inputs") or []),
        }
        task_payload["version_binding"] = self._current_runtime_versions()
        if task_pool == "intake_pool":
            task_payload["parent_task_id"] = task_id
            task_payload["is_parent_task"] = True
            task_payload["stage_cards"] = self._build_stage_cards(task_payload)

        with self._task_op_lock:
            self._persist_task_payload(task_payload, dispatch_state=dispatch_state, source_type="api")
            self._task_repo.add_event(
                task_id=task_id,
                event_type="task_created",
                actor_id=actor_id or "dashboard",
                actor_role=self._normalize_actor_role(actor_role),
                payload={"dispatch_state": dispatch_state, "task_pool": task_pool},
            )
            self._task_sync_cache["ts"] = time.time()

        return {"ok": True, "task_id": task_id, "task": self._summarize_task(task_payload), "updated_at": now_iso()}

    def update_task_progress(
        self,
        task_id: str | None,
        actor_id: str | None,
        actor_role: str | None,
        progress: int | float | None = None,
        status: str | None = None,
        current_step: str | None = None,
        note: str | None = None,
    ) -> dict[str, Any]:
        if not task_id:
            return {"ok": False, "error": "task_id required"}
        if not actor_id:
            return {"ok": False, "error": "actor_id required"}

        with self._task_op_lock:
            task = self._get_task_by_id(task_id)
            if not task:
                return {"ok": False, "error": "task not found"}
            if not self._can_update_task_execution(task, actor_id, actor_role):
                return {"ok": False, "error": "permission denied"}

            execution = task.setdefault("execution", {})
            if isinstance(progress, (int, float)):
                progress = max(0, min(100, int(progress)))
                execution["progress"] = progress

            normalized_status = self._normalize_status(status) if status else None
            if normalized_status == "completed":
                if task.get("business_bound") and not str(task.get("business_truth_source") or "").strip():
                    return {"ok": False, "error": "business_truth_source required"}
                if task.get("business_bound") and not str(task.get("acceptance_result") or "").strip():
                    return {"ok": False, "error": "acceptance_result required"}
                missing_inputs = task.get("missing_inputs") or []
                if isinstance(missing_inputs, list) and missing_inputs:
                    task["status"] = "blocked"
                    execution["status"] = "blocked"
                    return {"ok": False, "error": "missing required input"}
                execution["status"] = "completed"
                execution["completed_at"] = now_iso()
                execution["progress"] = 100
                task["status"] = "completed"
                task["gate_result"] = "PASS"
            elif status and str(status).strip().lower() == "failed":
                execution["status"] = "pending"
                task["status"] = "pending"
                task["dispatch_state"] = "pending_confirm"
                execution["failure_note"] = note or "task_failed"
                task["gate_result"] = "REWORK"
            elif normalized_status:
                execution["status"] = normalized_status
                task["status"] = normalized_status
                if normalized_status == "in_progress" and not execution.get("started_at"):
                    execution["started_at"] = now_iso()

            if current_step:
                execution["current_step"] = str(current_step)
            if note:
                execution["last_note"] = str(note)
            if task["status"] == "in_progress":
                self._bind_task_versions(task)

            cards = self._build_stage_cards(task)
            if cards:
                active_idx = None
                step_name = str(execution.get("current_step") or "").strip()
                if step_name:
                    for idx, card in enumerate(cards):
                        if str(card.get("name") or "") == step_name:
                            active_idx = idx
                            break
                if normalized_status == "completed":
                    for card in cards:
                        card["status"] = "completed"
                    if isinstance(task.get("dispatch_lock"), dict):
                        task["dispatch_lock"]["state"] = "released"
                else:
                    if active_idx is None:
                        active_idx = next((idx for idx, card in enumerate(cards) if str(card.get("status") or "") in {"assigned", "in_progress"}), 0)
                    for idx, card in enumerate(cards):
                        if idx < active_idx:
                            card["status"] = "completed"
                        elif idx == active_idx:
                            card["status"] = "in_progress" if task["status"] == "in_progress" else "assigned"
                        else:
                            card["status"] = "queued"
                task["stage_cards"] = cards

            task["updated_at"] = now_iso()
            persisted = self._persist_task_payload(
                task,
                dispatch_state=str(task.get("dispatch_state") or "dispatched"),
                source_type="api",
            )
            self._task_repo.add_event(
                task_id=task_id,
                event_type="task_progress_updated",
                actor_id=actor_id,
                actor_role=self._normalize_actor_role(actor_role),
                payload={
                    "progress": execution.get("progress"),
                    "status": execution.get("status"),
                    "current_step": execution.get("current_step"),
                    "note": note,
                },
            )
            self._task_sync_cache["ts"] = time.time()

        return {"ok": True, "task_id": task_id, "task": self._summarize_task(persisted), "updated_at": now_iso()}

    def add_task_artifact(
        self,
        task_id: str | None,
        actor_id: str | None,
        actor_role: str | None,
        artifact: dict[str, Any] | None,
    ) -> dict[str, Any]:
        if not task_id:
            return {"ok": False, "error": "task_id required"}
        body = artifact or {}
        artifact_type = str(body.get("artifact_type") or "").strip()
        path = str(body.get("path") or "").strip()
        version = str(body.get("version") or "").strip()
        summary = str(body.get("summary") or "").strip()
        if not all((artifact_type, path, version, summary)):
            return {"ok": False, "error": "artifact_type, path, version, summary required"}

        with self._task_op_lock:
            task = self._get_task_by_id(task_id)
            if not task:
                return {"ok": False, "error": "task not found"}
            if not self._can_manage_task(actor_id, actor_role, str(task.get("team") or "")):
                return {"ok": False, "error": "permission denied"}

            artifact_entry = {
                "artifact_type": artifact_type,
                "path": path,
                "version": version,
                "summary": summary,
                "producer": str(body.get("producer") or actor_id or ""),
                "created_at": now_iso(),
            }
            artifacts = task.setdefault("artifact_index", [])
            if not isinstance(artifacts, list):
                artifacts = []
                task["artifact_index"] = artifacts
            artifacts.append(artifact_entry)
            task["updated_at"] = now_iso()
            persisted = self._persist_task_payload(task, dispatch_state=str(task.get("dispatch_state") or "dispatched"), source_type="api")
            self._task_repo.add_event(
                task_id=task_id,
                event_type="artifact_added",
                actor_id=actor_id,
                actor_role=self._normalize_actor_role(actor_role),
                payload=artifact_entry,
            )
            self._task_sync_cache["ts"] = time.time()

        return {"ok": True, "task_id": task_id, "artifact": artifact_entry, "task": self._summarize_task(persisted), "updated_at": now_iso()}

    def handoff_stage(
        self,
        task_id: str | None,
        stage_id: int | str | None,
        actor_id: str | None,
        actor_role: str | None,
        handoff_note: str | None,
        artifact_summary: str | None,
        next_owner: str | None,
    ) -> dict[str, Any]:
        if not task_id:
            return {"ok": False, "error": "task_id required"}
        note = str(handoff_note or "").strip()
        artifact_text = str(artifact_summary or "").strip()
        next_owner_id = str(next_owner or "").strip()
        if not (note and artifact_text and next_owner_id):
            return {"ok": False, "error": "handoff_note, artifact_summary, next_owner required"}

        try:
            stage_idx = max(0, int(stage_id or 0) - 1)
        except Exception:
            return {"ok": False, "error": "stage_id invalid"}

        with self._task_op_lock:
            task = self._get_task_by_id(task_id)
            if not task:
                return {"ok": False, "error": "task not found"}
            if not self._can_manage_task(actor_id, actor_role, str(task.get("team") or "")):
                return {"ok": False, "error": "permission denied"}

            cards = self._build_stage_cards(task)
            if stage_idx >= len(cards):
                return {"ok": False, "error": "stage not found"}

            current = cards[stage_idx]
            current["handoff_note"] = note
            current["artifact_summary"] = artifact_text
            current["next_owner"] = next_owner_id
            current["status"] = "completed"
            current["gate_result"] = "PASS"

            if stage_idx + 1 < len(cards):
                nxt = cards[stage_idx + 1]
                nxt["status"] = "assigned"
                if not str(nxt.get("owner_agent") or "").strip():
                    nxt["owner_agent"] = next_owner_id

            task["stage_cards"] = cards
            task.setdefault("next_action", {})
            if isinstance(task["next_action"], dict):
                task["next_action"]["assignee"] = next_owner_id
            execution = task.setdefault("execution", {})
            execution["current_step"] = str(cards[stage_idx + 1]["name"]) if stage_idx + 1 < len(cards) else str(current.get("name") or "")
            if stage_idx + 1 < len(cards):
                execution["status"] = "pending"
                task["status"] = "pending"
            else:
                execution["status"] = "completed"
                execution["progress"] = 100
                execution["completed_at"] = now_iso()
                task["status"] = "completed"
            task["updated_at"] = now_iso()
            persisted = self._persist_task_payload(task, dispatch_state=str(task.get("dispatch_state") or "dispatched"), source_type="api")
            self._task_repo.add_event(
                task_id=task_id,
                event_type="stage_handed_off",
                actor_id=actor_id,
                actor_role=self._normalize_actor_role(actor_role),
                payload={"stage_id": stage_id, "handoff_note": note, "artifact_summary": artifact_text, "next_owner": next_owner_id},
            )
            self._task_sync_cache["ts"] = time.time()

        return {"ok": True, "task_id": task_id, "task": self._summarize_task(persisted), "updated_at": now_iso()}

    def claim_task(self, task_id: str | None, actor_id: str | None, actor_role: str | None, actor_team: str | None = None) -> dict[str, Any]:
        if not task_id:
            return {"ok": False, "error": "task_id required"}
        if not actor_id:
            return {"ok": False, "error": "actor_id required"}

        with self._task_op_lock:
            task = self._get_task_by_id(task_id)
            if not task:
                return {"ok": False, "error": "task not found"}
            summary = self._summarize_task(task)
            task_pool = str(summary.get("task_pool") or self._task_pool_for(task))
            if task_pool == "governance_pool" and not self._is_governance_actor(actor_id):
                return {"ok": False, "error": "pool claim denied"}
            if task_pool == "review_pool" and not self._is_review_actor(actor_id):
                return {"ok": False, "error": "pool claim denied"}
            if task_pool == "intake_pool":
                return {"ok": False, "error": "pool claim denied"}
            owner = str(summary.get("owner") or "unassigned")
            if owner not in {"", "unassigned", "none", "null"} and owner != actor_id:
                return {"ok": False, "error": f"task already claimed by {owner}"}
            team_id = str(actor_team or task.get("team") or self._team_for_agent(actor_id) or "unassigned")
            if task_pool == "team_dispatch_pool" and self._is_team_retired(team_id):
                return {"ok": False, "error": "team retired"}

            execution = task.setdefault("execution", {})
            execution["assigned_to"] = actor_id
            execution["status"] = "pending"
            execution.setdefault("progress", 0)
            self._bind_task_versions(task)
            task["status"] = "pending"
            task["team"] = team_id
            task["dispatch_state"] = "dispatched"
            task["dispatch_lock"] = {
                "owner": actor_id,
                "team": team_id,
                "state": "active",
                "claimed_at": now_iso(),
                "lease_expires_at": (datetime.now(timezone.utc) + timedelta(minutes=30)).astimezone().isoformat(),
            }
            cards = self._build_stage_cards(task)
            if cards:
                cards[0]["status"] = "assigned"
                task["stage_cards"] = cards
            task["updated_at"] = now_iso()

            persisted = self._persist_task_payload(task, dispatch_state="dispatched", source_type="api")
            self._task_repo.add_claim(task_id, claimed_by=actor_id, claimed_team=actor_team, claimed_by_role=self._normalize_actor_role(actor_role))
            self._task_repo.add_event(
                task_id=task_id,
                event_type="task_claimed",
                actor_id=actor_id,
                actor_role=self._normalize_actor_role(actor_role),
                payload={"claimed_team": actor_team},
            )
            self._task_sync_cache["ts"] = time.time()

        return {"ok": True, "task_id": task_id, "claimed_by": actor_id, "task": self._summarize_task(persisted), "updated_at": now_iso()}

    def assign_task(
        self,
        task_id: str | None,
        assigned_to: str | None,
        actor_id: str | None,
        actor_role: str | None,
        assigned_team: str | None = None,
        reason: str | None = None,
        force: bool = False,
    ) -> dict[str, Any]:
        if not task_id:
            return {"ok": False, "error": "task_id required"}
        if not assigned_to:
            return {"ok": False, "error": "assigned_to required"}

        with self._task_op_lock:
            task = self._get_task_by_id(task_id)
            if not task:
                return {"ok": False, "error": "task not found"}
            team = str(task.get("team") or self._team_for_agent(assigned_to) or assigned_team or "unassigned")
            if self._is_team_retired(assigned_team or team):
                return {"ok": False, "error": "team retired"}
            if not self._can_manage_task(actor_id, actor_role, team):
                return {"ok": False, "error": "permission denied"}
            if self._normalize_status(str(task.get("status") or "")) == "completed" and not force:
                return {"ok": False, "error": "completed task requires force=true"}

            execution = task.setdefault("execution", {})
            execution["assigned_to"] = assigned_to
            if self._normalize_status(str(task.get("status") or "")) != "completed":
                execution["status"] = "pending"
                task["status"] = "pending"
            self._bind_task_versions(task)
            task["team"] = team
            task["dispatch_state"] = "dispatched"
            task["dispatch_lock"] = {
                "owner": assigned_to,
                "team": assigned_team or team,
                "state": "active",
                "claimed_at": now_iso(),
                "lease_expires_at": (datetime.now(timezone.utc) + timedelta(minutes=30)).astimezone().isoformat(),
            }
            task.setdefault("next_action", {})
            if isinstance(task["next_action"], dict):
                task["next_action"]["assignee"] = assigned_to
            cards = self._build_stage_cards(task)
            if cards:
                first_open = next((idx for idx, card in enumerate(cards) if str(card.get("status") or "") != "completed"), 0)
                cards[first_open]["status"] = "assigned"
                task["stage_cards"] = cards
            task["updated_at"] = now_iso()

            persisted = self._persist_task_payload(task, dispatch_state="dispatched", source_type="api")
            self._task_repo.add_assignment(
                task_id=task_id,
                assigned_to=assigned_to,
                assigned_team=assigned_team or team,
                assigned_by=actor_id,
                assigned_by_role=self._normalize_actor_role(actor_role),
                reason=reason,
            )
            self._task_repo.add_event(
                task_id=task_id,
                event_type="task_assigned",
                actor_id=actor_id,
                actor_role=self._normalize_actor_role(actor_role),
                payload={"assigned_to": assigned_to, "assigned_team": assigned_team or team, "reason": reason},
            )
            self._task_sync_cache["ts"] = time.time()

        return {"ok": True, "task_id": task_id, "assigned_to": assigned_to, "task": self._summarize_task(persisted), "updated_at": now_iso()}

    def dispatch_suggest(self, task_id: str | None, actor_id: str | None, actor_role: str | None) -> dict[str, Any]:
        if not task_id:
            return {"ok": False, "error": "task_id required"}
        task = self._get_task_by_id(task_id)
        if not task:
            return {"ok": False, "error": "task not found"}

        summary = self._summarize_task(task)
        team_id = str(summary.get("team") or "unassigned")
        if team_id == "unassigned":
            ttype = str(summary.get("task_type") or "").lower()
            if "review" in ttype or "audit" in ttype:
                team_id = "team-braintrust"
            elif "knowledge" in ttype:
                team_id = "team-km"
            elif "governance" in ttype or "change" in ttype:
                team_id = "team-rd"
            else:
                team_id = "team-rd"
        if self._is_team_retired(team_id):
            team_id = "team-rd"

        stage = str(summary.get("current_stage") or "")
        available_agents = {a["agent_id"] for a in self._load_agents()}
        role_name, recommended = self._select_owner_for_stage(team_id, stage, available_agents)
        if recommended == "unassigned":
            lead_cfg = self._team_leads().get(team_id) or {}
            recommended = str(lead_cfg.get("lead_agent") or "unassigned")

        suggestion = {
            "task_id": task_id,
            "team_id": team_id,
            "recommended_agent": recommended,
            "recommended_role": role_name,
            "confidence": 0.79 if recommended not in {"", "unassigned"} else 0.42,
            "reason": "stage_role_mapping",
            "created_by": actor_id or "dashboard",
            "created_role": self._normalize_actor_role(actor_role),
            "created_at": now_iso(),
        }

        with self._task_op_lock:
            task["dispatch_state"] = "pending_confirm"
            task["dispatch_suggestion"] = suggestion
            task["updated_at"] = now_iso()
            self._persist_task_payload(task, dispatch_state="pending_confirm", source_type="api")
            self._task_repo.add_event(
                task_id=task_id,
                event_type="dispatch_suggested",
                actor_id=actor_id,
                actor_role=self._normalize_actor_role(actor_role),
                payload=suggestion,
            )
            self._task_sync_cache["ts"] = time.time()

        return {"ok": True, "suggestion": suggestion, "updated_at": now_iso()}

    def dispatch_confirm(
        self,
        task_id: str | None,
        actor_id: str | None,
        actor_role: str | None,
        confirm: bool = True,
        assigned_to: str | None = None,
        assigned_team: str | None = None,
        reason: str | None = None,
    ) -> dict[str, Any]:
        if not task_id:
            return {"ok": False, "error": "task_id required"}
        task = self._get_task_by_id(task_id)
        if not task:
            return {"ok": False, "error": "task not found"}

        team = str(task.get("team") or assigned_team or "unassigned")
        if not self._can_manage_task(actor_id, actor_role, team):
            return {"ok": False, "error": "permission denied"}

        if not confirm:
            with self._task_op_lock:
                task["dispatch_state"] = "claim_pool"
                task["updated_at"] = now_iso()
                persisted = self._persist_task_payload(task, dispatch_state="claim_pool", source_type="api")
                self._task_repo.add_event(
                    task_id=task_id,
                    event_type="dispatch_rejected",
                    actor_id=actor_id,
                    actor_role=self._normalize_actor_role(actor_role),
                    payload={"reason": reason},
                )
                self._task_sync_cache["ts"] = time.time()
            return {"ok": True, "task_id": task_id, "dispatch_state": "claim_pool", "task": self._summarize_task(persisted), "updated_at": now_iso()}

        suggestion = task.get("dispatch_suggestion") if isinstance(task.get("dispatch_suggestion"), dict) else {}
        target_agent = assigned_to or str(suggestion.get("recommended_agent") or "")
        if not target_agent or target_agent in {"unassigned", "none", "null"}:
            return {"ok": False, "error": "no dispatch target"}

        result = self.assign_task(
            task_id=task_id,
            assigned_to=target_agent,
            actor_id=actor_id,
            actor_role=actor_role,
            assigned_team=assigned_team or str(suggestion.get("team_id") or team),
            reason=reason or "dispatch_confirm",
            force=False,
        )
        if not result.get("ok"):
            return result

        with self._task_op_lock:
            task = self._get_task_by_id(task_id) or {}
            if isinstance(task, dict):
                task["dispatch_state"] = "dispatched"
                task["updated_at"] = now_iso()
                self._persist_task_payload(task, dispatch_state="dispatched", source_type="api")
            self._task_repo.add_event(
                task_id=task_id,
                event_type="dispatch_confirmed",
                actor_id=actor_id,
                actor_role=self._normalize_actor_role(actor_role),
                payload={"assigned_to": target_agent, "reason": reason},
            )
            self._task_sync_cache["ts"] = time.time()

        return result

    def _generate_review_id(self) -> str:
        return f"REVIEW-{datetime.now().strftime('%Y%m%d')}-{uuid.uuid4().hex[:6].upper()}"

    def _generate_change_id(self) -> str:
        return f"CHANGE-{datetime.now().strftime('%Y%m%d')}-{uuid.uuid4().hex[:6].upper()}"

    def _normalize_review_seat_id(self, reviewer_id: Any) -> str:
        raw = str(reviewer_id or "").strip().lower()
        mapping = {
            "architect": "braintrust_architect",
            "critic": "braintrust_critic",
            "innovator": "braintrust_innovator",
            "chief": "braintrust_chief",
        }
        return mapping.get(raw, str(reviewer_id or "").strip())

    def _refresh_review_status_fields(self, review: dict[str, Any] | None) -> dict[str, Any]:
        data = dict(review or {})
        review_id = str(data.get("review_id") or "")
        packets = self._task_repo.list_review_packets(review_id) if review_id else []
        if packets:
            data["review_packets"] = packets

        assigned_reviewers = [self._normalize_review_seat_id(v) for v in list(data.get("assigned_reviewers") or [])]
        packet_by_reviewer = {self._normalize_review_seat_id(p.get("reviewer_id")): p for p in packets if isinstance(p, dict)}

        seat_status: dict[str, str] = {}
        for reviewer in assigned_reviewers:
            if reviewer in packet_by_reviewer:
                seat_status[reviewer] = "submitted"
            elif str(data.get("status") or "") in {"under_review", "stalled"}:
                seat_status[reviewer] = "under_review"
            else:
                seat_status[reviewer] = "pending"

        packet_missing = [reviewer for reviewer in assigned_reviewers if reviewer not in packet_by_reviewer]
        if str(data.get("status") or "") == "completed":
            chief_status = "completed"
        elif packet_missing:
            chief_status = "waiting_packets"
        else:
            chief_status = "ready"

        data["assigned_reviewers"] = assigned_reviewers
        data["seat_status"] = seat_status
        data["chief_status"] = chief_status
        data["packet_missing"] = packet_missing
        data["reclaim_eligible"] = bool(packet_missing or str(data.get("status") or "") == "stalled")
        return data

    def _review_view_model(self, review: dict[str, Any] | None, detail: bool = False) -> dict[str, Any]:
        data = self._refresh_review_status_fields(review)
        bundle = dict(data.get("submission_bundle") or {})
        vm = {
            "review_id": str(data.get("review_id") or ""),
            "title": str(data.get("title") or ""),
            "incident_key": str(data.get("incident_key") or bundle.get("incident_key") or ""),
            "status": str(data.get("status") or "pending"),
            "review_pool": str(data.get("review_pool") or "review_pool"),
            "assigned_to": str(data.get("assigned_to") or ""),
            "assigned_reviewers": list(data.get("assigned_reviewers") or []),
            "seat_status": dict(data.get("seat_status") or {}),
            "chief_status": str(data.get("chief_status") or "waiting_packets"),
            "packet_missing": list(data.get("packet_missing") or []),
            "reclaim_eligible": bool(data.get("reclaim_eligible")),
            "coalesced_events": int(data.get("coalesced_events") or 0),
            "target_task_id": str(data.get("target_task_id") or bundle.get("target_task_id") or ""),
            "created_by": str(data.get("created_by") or ""),
            "created_at": str(data.get("created_at") or ""),
            "updated_at": str(data.get("updated_at") or ""),
            "submission_bundle": {
                "incident_key": str(bundle.get("incident_key") or ""),
                "summary": str(bundle.get("summary") or ""),
                "artifacts": list(bundle.get("artifacts") or []),
            },
            "chief_decision": dict(data.get("chief_decision") or {}) if isinstance(data.get("chief_decision"), dict) else None,
        }
        if detail:
            vm["review_packets"] = list(data.get("review_packets") or [])
            vm["recovery_audit"] = list(data.get("recovery_audit") or [])
        return vm

    def _change_view_model(self, change: dict[str, Any] | None, detail: bool = False) -> dict[str, Any]:
        data = dict(change or {})
        vm = {
            "change_id": str(data.get("change_id") or ""),
            "title": str(data.get("title") or ""),
            "description": str(data.get("description") or ""),
            "scope": str(data.get("scope") or "shared"),
            "priority": str(data.get("priority") or "P2"),
            "status": str(data.get("status") or "proposed"),
            "affects_scope": str(data.get("affects_scope") or "new_tasks_only"),
            "impact_report": dict(data.get("impact_report") or {}),
            "impact_targets": list(data.get("impact_targets") or []),
            "at_risk_tasks": list(data.get("at_risk_tasks") or []),
            "rollback_plan": str(data.get("rollback_plan") or ""),
            "approval": dict(data.get("approval") or {}) if isinstance(data.get("approval"), dict) else None,
            "created_by": str(data.get("created_by") or ""),
            "created_at": str(data.get("created_at") or ""),
            "updated_at": str(data.get("updated_at") or ""),
        }
        if detail:
            vm["publish_audit"] = list(data.get("publish_audit") or [])
        return vm

    def create_review_task(self, payload: dict[str, Any] | None, actor_id: str | None, actor_role: str | None) -> dict[str, Any]:
        body = payload or {}
        bundle = body.get("submission_bundle")
        if not isinstance(bundle, dict) or not bundle:
            return {"ok": False, "error": "submission_bundle required"}
        artifacts = bundle.get("artifacts")
        if not isinstance(artifacts, list) or not artifacts:
            return {"ok": False, "error": "submission_bundle required"}

        incident_key = str(bundle.get("incident_key") or bundle.get("source_key") or "").strip()
        existing = self._task_repo.find_active_review_by_incident(incident_key) if incident_key else None
        if existing:
            existing["coalesced_events"] = int(existing.get("coalesced_events") or 1) + 1
            existing["updated_at"] = now_iso()
            self._task_repo.upsert_review_task(existing)
            return {"ok": True, "review_id": existing.get("review_id"), "coalesced": True, "updated_at": now_iso()}

        review_id = str(body.get("review_id") or "").strip() or self._generate_review_id()
        assigned_reviewers = [self._normalize_review_seat_id(v) for v in list(body.get("assigned_reviewers") or ["braintrust_architect", "critic", "innovator"])]
        review = {
            "review_id": review_id,
            "title": str(body.get("title") or review_id),
            "incident_key": incident_key,
            "submission_bundle": bundle,
            "status": "pending",
            "review_pool": "review_pool",
            "assigned_reviewers": assigned_reviewers,
            "review_packets": [],
            "chief_decision": None,
            "coalesced_events": 1,
            "recovery_audit": [],
            "created_by": str(actor_id or "dashboard"),
            "created_at": now_iso(),
            "updated_at": now_iso(),
        }
        review = self._refresh_review_status_fields(review)
        self._task_repo.upsert_review_task(review)
        return {"ok": True, "review_id": review_id, "review": self._review_view_model(review, detail=True), "updated_at": now_iso()}

    def get_review_task(self, review_id: str | None) -> dict[str, Any]:
        if not review_id:
            return {"ok": False, "error": "review_id required"}
        review = self._task_repo.get_review_task(review_id)
        if not review:
            return {"ok": False, "error": "review not found"}
        return self._review_view_model(review, detail=True)

    def dispatch_review_task(self, review_id: str | None, actor_id: str | None, actor_role: str | None) -> dict[str, Any]:
        review = self._task_repo.get_review_task(str(review_id or ""))
        if not review:
            return {"ok": False, "error": "review not found"}
        review["status"] = "under_review"
        review["updated_at"] = now_iso()
        review["assigned_at"] = now_iso()
        review["assigned_to"] = str(actor_id or "")
        review["review_pool"] = "review_pool"
        review = self._refresh_review_status_fields(review)
        self._task_repo.upsert_review_task(review)
        return {"ok": True, "review_id": review.get("review_id"), "review": self._review_view_model(review, detail=True), "updated_at": now_iso()}

    def submit_review_packet(
        self,
        review_id: str | None,
        payload: dict[str, Any] | None,
        actor_id: str | None,
        actor_role: str | None,
    ) -> dict[str, Any]:
        review = self._task_repo.get_review_task(str(review_id or ""))
        if not review:
            return {"ok": False, "error": "review not found"}
        body = payload or {}
        reviewer_id = str(body.get("reviewer_id") or actor_id or "").strip()
        if not reviewer_id:
            return {"ok": False, "error": "reviewer_id required"}
        packet = {
            "review_id": str(review_id),
            "reviewer_id": reviewer_id,
            "provider": str(body.get("provider") or "unknown"),
            "verdict": str(body.get("verdict") or ""),
            "findings": list(body.get("findings") or []),
            "conditions": list(body.get("conditions") or []),
            "risks": list(body.get("risks") or []),
            "created_at": now_iso(),
        }
        self._task_repo.add_review_packet(str(review_id), reviewer_id, packet)
        review["status"] = "under_review"
        review["updated_at"] = now_iso()
        review = self._refresh_review_status_fields(review)
        self._task_repo.upsert_review_task(review)
        return {"ok": True, "review_id": review_id, "packet": packet, "review": self._review_view_model(review, detail=True), "updated_at": now_iso()}

    def decide_review_task(
        self,
        review_id: str | None,
        actor_id: str | None,
        actor_role: str | None,
        decision: str | None,
        next_action: str | None,
        next_owner: str | None,
    ) -> dict[str, Any]:
        review = self._task_repo.get_review_task(str(review_id or ""))
        if not review:
            return {"ok": False, "error": "review not found"}
        if not next_action or not next_owner:
            return {"ok": False, "error": "next_action and next_owner required"}
        review["status"] = "completed"
        review["review_pool"] = "completed"
        review["updated_at"] = now_iso()
        review["chief_decision"] = {
            "decision": str(decision or "approved"),
            "next_action": str(next_action),
            "next_owner": str(next_owner),
            "decided_by": str(actor_id or "braintrust_chief"),
            "decided_at": now_iso(),
        }
        review = self._refresh_review_status_fields(review)
        self._task_repo.upsert_review_task(review)
        return {"ok": True, "review_id": review_id, "chief_decision": review["chief_decision"], "review": self._review_view_model(review, detail=True), "updated_at": now_iso()}

    def create_change_task(self, payload: dict[str, Any] | None, actor_id: str | None, actor_role: str | None) -> dict[str, Any]:
        body = payload or {}
        change_id = str(body.get("change_id") or "").strip() or self._generate_change_id()
        impact = {
            "scope": str(body.get("scope") or "shared"),
            "risk": "high" if str(body.get("scope") or "shared") in {"shared", "global"} else "low",
            "affects_scope": "new_tasks_only",
        }
        change = {
            "change_id": change_id,
            "title": str(body.get("title") or change_id),
            "description": str(body.get("description") or ""),
            "scope": str(body.get("scope") or "shared"),
            "priority": str(body.get("priority") or "P2"),
            "status": "proposed",
            "impact_report": impact,
            "impact_targets": list(body.get("impact_targets") or []),
            "at_risk_tasks": list(body.get("at_risk_tasks") or []),
            "rollback_plan": str(body.get("rollback_plan") or ""),
            "affects_scope": "new_tasks_only",
            "approval": None,
            "publish_audit": [],
            "created_by": str(actor_id or "luban"),
            "created_at": now_iso(),
            "updated_at": now_iso(),
        }
        self._task_repo.upsert_change_task(change)
        return {"ok": True, "change_id": change_id, "affects_scope": "new_tasks_only", "change": self._change_view_model(change, detail=True), "updated_at": now_iso()}

    def approve_change_task(self, change_id: str | None, actor_id: str | None, actor_role: str | None) -> dict[str, Any]:
        change = self._task_repo.get_change_task(str(change_id or ""))
        if not change:
            return {"ok": False, "error": "change not found"}
        change["approval"] = {
            "approved_by": str(actor_id or "braintrust_chief"),
            "approved_at": now_iso(),
        }
        change["status"] = "approved"
        change["updated_at"] = now_iso()
        self._task_repo.upsert_change_task(change)
        return {"ok": True, "change_id": change_id, "change": self._change_view_model(change, detail=True), "updated_at": now_iso()}

    def publish_change_task(self, change_id: str | None, actor_id: str | None, actor_role: str | None, p0_override: bool = False) -> dict[str, Any]:
        change = self._task_repo.get_change_task(str(change_id or ""))
        if not change:
            return {"ok": False, "error": "change not found"}
        if not change.get("approval") and not p0_override:
            return {"ok": False, "error": "approval required"}
        if str(change.get("scope") or "") in {"shared", "global"} and not p0_override and not list(change.get("impact_targets") or []):
            return {"ok": False, "error": "impact_targets required"}

        cur = self._current_runtime_versions()
        next_versions = {
            "workflow_version": f"wf-v{int(cur['workflow_version'].split('v')[-1]) + 1}",
            "routing_version": f"route-v{int(cur['routing_version'].split('v')[-1]) + 1}",
        }
        self._task_repo.set_meta("workflow_version", next_versions["workflow_version"])
        self._task_repo.set_meta("routing_version", next_versions["routing_version"])

        audit = {
            "published_by": str(actor_id or "luban"),
            "published_at": now_iso(),
            "p0_override": bool(p0_override),
            "versions": next_versions,
            "impact_targets": list(change.get("impact_targets") or []),
            "at_risk_tasks": list(change.get("at_risk_tasks") or []),
        }
        change.setdefault("publish_audit", [])
        change["publish_audit"].append(audit)
        change["status"] = "published"
        change["updated_at"] = now_iso()
        self._task_repo.upsert_change_task(change)
        return {"ok": True, "change_id": change_id, "audit": audit, "versions": next_versions, "change": self._change_view_model(change, detail=True), "updated_at": now_iso()}

    def scan_stalled_work(self) -> dict[str, Any]:
        runtime = self._build_agent_runtime()
        stalled_reviews: list[dict[str, Any]] = []
        for review in self._task_repo.list_review_tasks():
            if str(review.get("status") or "") not in {"under_review", "pending"}:
                continue
            assignee = str(review.get("assigned_to") or "")
            health = self._agent_health(assignee, runtime, True) if assignee else {"status": "unknown", "is_stalled": False}
            if health.get("is_stalled") or health.get("status") == "stale":
                review["status"] = "stalled"
                review["review_pool"] = "recovery_pool"
                review["updated_at"] = now_iso()
                review = self._refresh_review_status_fields(review)
                self._task_repo.upsert_review_task(review)
                stalled_reviews.append(review)
        return {"ok": True, "stalled_reviews": stalled_reviews, "updated_at": now_iso()}

    def recover_review_task(self, review_id: str | None, actor_id: str | None, actor_role: str | None, action: str = "reclaim") -> dict[str, Any]:
        review = self._task_repo.get_review_task(str(review_id or ""))
        if not review:
            return {"ok": False, "error": "review not found"}
        audit = {
            "action": str(action or "reclaim"),
            "operator": str(actor_id or "luban"),
            "ts": now_iso(),
        }
        review.setdefault("recovery_audit", [])
        review["recovery_audit"].insert(0, audit)
        review["status"] = "pending"
        review["review_pool"] = "recovery_pool"
        review["updated_at"] = now_iso()
        review = self._refresh_review_status_fields(review)
        self._task_repo.upsert_review_task(review)
        return {"ok": True, "review_id": review_id, "audit": audit, "review": self._review_view_model(review, detail=True), "updated_at": now_iso()}

    def get_tasks(
        self,
        status_filter: str | None = None,
        team: str | None = None,
        owner: str | None = None,
        dispatch_state: str | None = None,
        task_pool: str | None = None,
        include_history: bool = False,
        since: str | None = None,
        limit: int | None = None,
        offset: int = 0,
        sort: str = "updated_at_ms",
        order: str = "desc",
    ) -> dict[str, Any]:
        self._sync_tasks_to_repo()
        if status_filter:
            status_filter = self._normalize_status(status_filter)

        safe_limit = None
        if isinstance(limit, int) and limit > 0:
            safe_limit = max(1, min(500, limit))
        safe_offset = max(0, int(offset or 0))
        created_after = None if include_history else self._cutover_at()

        raw_rows, total, next_since = self._task_repo.list_task_payloads(
            status_filter=status_filter,
            team=team,
            owner=owner,
            dispatch_state=dispatch_state,
            task_pool=task_pool,
            created_after=created_after,
            since=since,
            limit=safe_limit,
            offset=safe_offset,
            sort=sort,
            order=order,
        )

        runtime = self._build_agent_runtime(non_blocking=True)
        live = self._claw_live_snapshot(non_blocking=True)
        live_freshness = str(live.get("freshness") or "unavailable")
        tasks = [self._summarize_task(t) for t in raw_rows]
        for t in tasks:
            health = self._agent_health(t["owner"], runtime, t["status"] == "in_progress")
            rt = self._runtime_state(t["status"], health)
            t["runtime_state"] = rt["state"]
            t["runtime_hint"] = rt["hint"]
            t["live_freshness"] = live_freshness
            t.pop("_raw", None)

        return {
            "tasks": tasks,
            "total": total,
            "limit": safe_limit,
            "offset": safe_offset,
            "next_since": next_since,
            "cutover_at": self._cutover_at(),
            "include_history": include_history,
            "updated_at": now_iso(),
        }

    def get_task_detail(self, task_id: str | None) -> dict[str, Any]:
        if not task_id:
            return {"error": "Task ID required"}

        match = self._get_task_by_id(task_id)
        if not match:
            review = self._task_repo.get_review_task(task_id)
            if not review:
                return {"error": "Task not found"}
            packets = self._task_repo.list_review_packets(task_id)
            return {
                "task_id": str(review.get("review_id") or task_id),
                "task_name": str(review.get("title") or task_id),
                "task_type": "review_task",
                "status": str(review.get("status") or "pending"),
                "progress": 0,
                "created_at": str(review.get("created_at") or ""),
                "created_by": str(review.get("created_by") or ""),
                "description": str(((review.get("submission_bundle") or {}).get("summary")) or ""),
                "owner": str(review.get("assigned_to") or "braintrust"),
                "team": "team-braintrust",
                "task_pool": str(review.get("review_pool") or "review_pool"),
                "parent_task_id": str(review.get("review_id") or task_id),
                "is_parent_task": False,
                "dispatch_state": "review",
                "dispatch_lock": None,
                "version_binding": self._current_runtime_versions(),
                "team_flow": ["team-braintrust"],
                "stages": [],
                "stage_cards": [],
                "stage_owners": [],
                "total_stages": 1,
                "completed_stages": 1 if str(review.get("status") or "") == "completed" else 0,
                "remaining_stages": 0 if str(review.get("status") or "") == "completed" else 1,
                "current_stage_index": 0,
                "current_stage": "审查",
                "next_stage": "",
                "next_agent": str(((review.get("chief_decision") or {}).get("next_owner")) or ""),
                "agent_health": {"status": "unknown", "is_stalled": False, "last_heartbeat": None, "sessions_count": 0},
                "runtime_state": "stalled" if str(review.get("status") or "") == "stalled" else "idle",
                "runtime_hint": str(review.get("status") or "pending"),
                "todo_items": [str(((review.get("submission_bundle") or {}).get("summary")) or "等待审查推进")],
                "session_link": {"url": "", "confidence": 0, "reason": "review_task"},
                "control_audit": review.get("recovery_audit") or [],
                "business_truth_source": "",
                "acceptance_result": "",
                "gate_result": str(((review.get("chief_decision") or {}).get("decision")) or ""),
                "artifact_index": list(((review.get("submission_bundle") or {}).get("artifacts")) or []),
                "data_quality": {"file_conflict": {"has_conflict": False, "count": 0, "items": []}, "is_legacy": False},
                "raw": {
                    "routing": None,
                    "review": self._refresh_review_status_fields({"review_id": task_id, **review, "review_packets": packets}),
                    "learning": None,
                    "acceptance": None,
                    "dispatch_suggestion": None,
                },
            }

        summary = self._summarize_task(match)
        runtime = self._build_agent_runtime(non_blocking=True)

        owner = summary["owner"]
        stages = []
        stage_defs = self._task_stage_items(match)
        stage_cards = summary.get("stage_cards") or []
        current_idx = summary["current_stage_index"]

        available_agents = {a["agent_id"] for a in self._load_agents()}
        default_owner = self._stage_owner_from_task_defaults(match)
        for idx, stage in enumerate(stage_defs):
            if idx < len(stage_cards):
                st = str((stage_cards[idx] or {}).get("status") or "queued")
            elif summary["status"] == "completed" or idx < current_idx:
                st = "completed"
            elif idx == current_idx and summary["status"] == "in_progress":
                st = "in_progress"
            else:
                st = "pending"

            explicit_owner = str(stage.get("owner") or "").strip()
            explicit_role = str(stage.get("owner_role") or "").strip()
            stage_card = stage_cards[idx] if idx < len(stage_cards) else {}
            card_owner = str((stage_card or {}).get("owner_agent") or "").strip()
            card_role = str((stage_card or {}).get("owner_role") or "").strip()
            if explicit_owner:
                owner_agent = explicit_owner
                role = explicit_role or "DeliverableOwner"
            elif card_owner:
                owner_agent = card_owner
                role = card_role or explicit_role or "Responsible"
            elif default_owner and default_owner not in {"", "unassigned", "none", "null"}:
                owner_agent = default_owner
                role = "Responsible"
            else:
                role, owner_agent = self._select_owner_for_stage(summary["team"], str(stage["name"]), available_agents)
            stages.append(
                {
                    "stage_id": idx + 1,
                    "name": stage["name"],
                    "description": stage["description"],
                    "status": st,
                    "owner_role": role,
                    "owner_agent": owner_agent,
                }
            )

        next_agent = (
            (match.get("next_action") or {}).get("assignee")
            or (match.get("routing") or {}).get("target_agent")
            or owner
        )

        has_active_task = summary["status"] == "in_progress"
        agent_health = self._agent_health(owner, runtime, has_active_task)
        runtime_state = self._runtime_state(summary["status"], agent_health)
        chat_link = self.get_task_chat_link(task_id)

        detail = {
            "task_id": summary["task_id"],
            "task_name": summary["task_name"],
            "task_type": summary["task_type"],
            "status": summary["status"],
            "progress": summary["progress"],
            "created_at": summary["created_at"],
            "created_by": summary["created_by"],
            "description": str(match.get("description") or ""),
            "owner": owner,
            "team": summary["team"],
            "task_pool": summary.get("task_pool"),
            "parent_task_id": summary.get("parent_task_id"),
            "is_parent_task": summary.get("is_parent_task"),
            "dispatch_state": summary.get("dispatch_state"),
            "dispatch_lock": match.get("dispatch_lock") if isinstance(match.get("dispatch_lock"), dict) else None,
            "version_binding": match.get("version_binding") if isinstance(match.get("version_binding"), dict) else self._current_runtime_versions(),
            "team_flow": summary["team_flow"],
            "stages": stages,
            "stage_cards": stage_cards,
            "stage_owners": [{"stage_id": s["stage_id"], "owner_role": s["owner_role"], "owner_agent": s["owner_agent"]} for s in stages],
            "total_stages": summary["total_stages"],
            "completed_stages": summary["completed_stages"],
            "remaining_stages": summary["remaining_stages"],
            "current_stage_index": current_idx,
            "current_stage": summary["current_stage"],
            "next_stage": summary["next_stage"],
            "next_agent": str(next_agent),
            "agent_health": agent_health,
            "runtime_state": runtime_state["state"],
            "runtime_hint": runtime_state["hint"],
            "todo_items": self._task_todo_items(match),
            "session_link": chat_link,
            "control_audit": self._control_audit_entries(summary["task_id"], limit=10),
            "business_bound": bool(match.get("business_bound")),
            "business_truth_source": str(match.get("business_truth_source") or ""),
            "acceptance_result": str(match.get("acceptance_result") or ""),
            "gate_result": str(match.get("gate_result") or ""),
            "artifact_index": list(match.get("artifact_index") or []),
            "data_quality": {
                "file_conflict": self._task_file_conflicts(summary["task_id"]),
                "is_legacy": bool((parse_dt(summary["created_at"]) or datetime.min.replace(tzinfo=timezone.utc)) < (parse_dt(self._cutover_at()) or datetime.min.replace(tzinfo=timezone.utc))),
            },
            "raw": {
                "routing": match.get("routing"),
                "review": match.get("review"),
                "learning": match.get("learning"),
                "acceptance": match.get("acceptance"),
                "dispatch_suggestion": match.get("dispatch_suggestion"),
            },
        }
        return detail

    def get_stats(self, include_history: bool = False) -> dict[str, Any]:
        self._sync_tasks_to_repo()
        stats = self._task_repo.get_stats(created_after=None if include_history else self._cutover_at())
        return {**stats, "cutover_at": self._cutover_at(), "include_history": include_history, "updated_at": now_iso()}

    def get_teams(self) -> dict[str, Any]:
        agents = self._load_agents()
        tasks = self.get_tasks()["tasks"]
        runtime = self._build_agent_runtime(non_blocking=True)
        team_leads = self._team_leads()
        wf = self._team_workflows()

        task_by_owner = {t["owner"]: t for t in tasks if t["status"] == "in_progress"}

        grouped: dict[str, list[dict[str, Any]]] = {k: [] for k in self.ACTIVE_TEAM_IDS}
        for a in agents:
            tid = self._team_for_agent(a["agent_id"])
            if tid and self._is_team_active(tid):
                grouped.setdefault(tid, []).append(a)

        teams = []
        for tid, members in grouped.items():
            if not members:
                continue
            meta = self.TEAM_DEFS.get(tid, {})
            lead_cfg = team_leads.get(tid) or {}
            lead_id = str(lead_cfg.get("lead_agent") or "")
            lead_member = next((m for m in members if m["agent_id"] == lead_id), members[0])

            member_rows = []
            for m in sorted(members, key=lambda x: x["agent_id"]):
                active_task = task_by_owner.get(m["agent_id"])
                health = self._agent_health(m["agent_id"], runtime, bool(active_task))
                status = "working" if active_task else "idle"
                member_rows.append(
                    {
                        "agent_id": m["agent_id"],
                        "name": m["name"],
                        "model": m["primary_model"],
                        "backup_models": m["fallback_models"],
                        "status": status,
                        "current_task": active_task["task_id"] if active_task else None,
                        "current_task_name": active_task["task_name"] if active_task else None,
                        "health": health,
                    }
                )

            active_team_tasks = [t for t in tasks if t["team"] == tid and t["status"] == "in_progress"]
            current_stage = active_team_tasks[0]["current_stage"] if active_team_tasks else (wf.get(tid, meta.get("workflow", ["RUNNING"]))[0])

            teams.append(
                {
                    "team_id": tid,
                    "team_name": meta.get("name", tid),
                    "description": meta.get("description", ""),
                    "responsibilities": meta.get("responsibilities", []),
                    "workflow": {
                        "stages": wf.get(tid, meta.get("workflow", [])),
                        "current_stage": current_stage,
                    },
                    "lead": {
                        "agent_id": lead_member["agent_id"],
                        "name": lead_member["name"],
                        "model": lead_member["primary_model"],
                        "backup_models": lead_member["fallback_models"],
                    },
                    "members": member_rows,
                }
            )

        live = self._claw_live_snapshot()
        return {"teams": teams, "updated_at": now_iso(), "live_freshness": live.get("freshness")}

    def get_standalone_agents(self) -> dict[str, Any]:
        agents = self._load_agents()
        tasks = self.get_tasks()["tasks"]
        runtime = self._build_agent_runtime(non_blocking=True)
        task_by_owner = {t["owner"]: t for t in tasks if t["status"] == "in_progress"}

        standalone = []
        for a in agents:
            team_id = self._team_for_agent(a["agent_id"])
            if team_id and self._is_team_active(team_id):
                continue
            active_task = task_by_owner.get(a["agent_id"])
            standalone.append(
                {
                    "agent_id": a["agent_id"],
                    "name": a["name"],
                    "model": a["primary_model"],
                    "backup_models": a["fallback_models"],
                    "status": "working" if active_task else "idle",
                    "current_task": active_task["task_id"] if active_task else None,
                    "current_task_name": active_task["task_name"] if active_task else None,
                    "health": self._agent_health(a["agent_id"], runtime, bool(active_task)),
                }
            )

        standalone.sort(key=lambda x: x["agent_id"])
        return {"agents": standalone, "updated_at": now_iso()}

    def get_temporary_agents(self) -> dict[str, Any]:
        known_agents = {a["agent_id"] for a in self._load_agents()}
        tasks = self._load_tasks_raw()
        discovered: dict[str, dict[str, Any]] = {}

        for t in tasks:
            created_by = str(t.get("created_by") or "unknown")
            refs: list[tuple[str, str]] = []
            execution = t.get("execution") or {}
            routing = t.get("routing") or {}
            next_action = t.get("next_action") or {}
            submission = t.get("submission") or {}

            refs.append((str(execution.get("assigned_to") or ""), "execution.assigned_to"))
            refs.append((str(routing.get("target_agent") or ""), "routing.target_agent"))
            refs.append((str(next_action.get("assignee") or ""), "next_action.assignee"))

            for rv in submission.get("reviewers") or []:
                refs.append((str(rv), "submission.reviewers"))

            for agent_ref, source in refs:
                if not agent_ref or agent_ref in {"unassigned", "unknown", "none", "null"}:
                    continue
                if agent_ref in known_agents:
                    continue
                if agent_ref not in discovered:
                    discovered[agent_ref] = {
                        "agent_id": agent_ref,
                        "name": agent_ref,
                        "summoned_by": created_by,
                        "source_task": str(t.get("task_id") or ""),
                        "source": source,
                        "first_seen": str(t.get("created_at") or ""),
                    }

        return {"agents": sorted(discovered.values(), key=lambda x: x["agent_id"]), "updated_at": now_iso()}

    def get_team_detail(self, team_id: str | None) -> dict[str, Any]:
        if not team_id:
            return {"error": "Team ID required"}
        for team in self.get_teams()["teams"]:
            if team["team_id"] == team_id:
                return team
        return {"error": "Team not found"}

    def get_unclaimed_tasks(self) -> dict[str, Any]:
        tasks = self.get_tasks()["tasks"]
        return {"tasks": [t for t in tasks if t["unclaimed"]], "updated_at": now_iso()}

    def get_task_pools(self) -> dict[str, Any]:
        tasks = self.get_tasks(limit=5000)["tasks"]
        pools = {
            "intake_pool": [],
            "team_dispatch_pool": [],
            "governance_pool": [],
            "review_pool": [],
            "recovery_pool": [],
            "running": [],
            "completed": [],
        }
        for t in tasks:
            if t.get("status") == "completed":
                pools["completed"].append(t)
                continue
            if t.get("status") == "in_progress":
                pools["running"].append(t)
                continue
            pool_name = str(t.get("task_pool") or "team_dispatch_pool")
            pools.setdefault(pool_name, []).append(t)
        for review in self._task_repo.list_review_tasks():
            pool_name = str(review.get("review_pool") or "review_pool")
            pools.setdefault(pool_name, []).append(
                {
                    "review_id": review.get("review_id"),
                    "task_id": review.get("review_id"),
                    "task_name": review.get("title"),
                    "task_type": "review_task",
                    "status": review.get("status"),
                    "task_pool": pool_name,
                    "owner": review.get("assigned_to") or "braintrust",
                    "progress": 0,
                    "completed_stages": 0,
                    "total_stages": 1,
                }
            )
        return {"pools": pools, "updated_at": now_iso()}

    def get_agent_workload(self) -> dict[str, Any]:
        tasks = self.get_tasks()["tasks"]
        agents = self._load_agents()
        runtime = self._build_agent_runtime(non_blocking=True)

        workload = {
            a["agent_id"]: {
                "name": a["name"],
                "model": a["primary_model"],
                "current_task": None,
                "queued_tasks": [],
                "completed_tasks": 0,
                "health": self._agent_health(a["agent_id"], runtime, False),
            }
            for a in agents
        }

        for t in tasks:
            owner = t["owner"]
            if owner not in workload:
                continue
            if t["status"] == "in_progress":
                workload[owner]["current_task"] = {
                    "task_id": t["task_id"],
                    "task_name": t["task_name"],
                    "progress": t["progress"],
                }
            elif t["status"] == "pending":
                workload[owner]["queued_tasks"].append({"task_id": t["task_id"], "task_name": t["task_name"]})
            elif t["status"] == "completed":
                workload[owner]["completed_tasks"] += 1

        for aid, w in workload.items():
            w["health"] = self._agent_health(aid, runtime, bool(w["current_task"]))

        return {"agents": workload, "updated_at": now_iso()}

    def get_schedule(self) -> dict[str, Any]:
        tasks = self.get_tasks()["tasks"]
        workload = self.get_agent_workload()["agents"]
        return {
            "schedule": {
                "active_tasks": [t for t in tasks if t["status"] == "in_progress"],
                "unclaimed": [t for t in tasks if t["unclaimed"]],
                "queue_by_agent": {aid: w["queued_tasks"] for aid, w in workload.items() if w["queued_tasks"]},
            },
            "updated_at": now_iso(),
        }

    def get_architecture(self) -> dict[str, Any]:
        teams = self.get_teams()["teams"]
        tasks = self.get_tasks()["tasks"]
        standalone = self.get_standalone_agents()["agents"]

        nodes = []
        edges = []

        for team in teams:
            nodes.append({"id": team["team_id"], "type": "team", "name": team["team_name"]})
            for m in team["members"]:
                nodes.append({"id": m["agent_id"], "type": "agent", "name": m["name"]})
                edges.append({"from": team["team_id"], "to": m["agent_id"], "type": "contains"})

        standalone_ids = {a["agent_id"] for a in standalone}
        for a in standalone:
            nodes.append({"id": a["agent_id"], "type": "agent", "name": a["name"]})

        transition_counter: dict[tuple[str, str], int] = {}
        for t in tasks:
            flow = t.get("team_flow") or []
            for i in range(len(flow) - 1):
                key = (flow[i], flow[i + 1])
                transition_counter[key] = transition_counter.get(key, 0) + 1

        for (src, dst), cnt in transition_counter.items():
            edges.append({"from": src, "to": dst, "type": "business_flow", "count": cnt})

        standalone_collab: dict[tuple[str, str], int] = {}
        for raw in self._load_tasks_raw():
            summary = self._summarize_task(raw)
            owner = summary["owner"]
            flow = summary.get("team_flow") or []
            if owner in standalone_ids:
                for tid in flow:
                    key = (owner, tid)
                    standalone_collab[key] = standalone_collab.get(key, 0) + 1
            creator = str(raw.get("created_by") or "")
            if creator in standalone_ids:
                for tid in flow:
                    key = (creator, tid)
                    standalone_collab[key] = standalone_collab.get(key, 0) + 1

        for (agent_id, team_id), cnt in standalone_collab.items():
            edges.append({"from": agent_id, "to": team_id, "type": "standalone_collab", "count": cnt})

        return {
            "system_name": "OpenClaw Runtime Architecture",
            "version": "5.0-live",
            "teams": teams,
            "standalone_agents": standalone,
            "nodes": nodes,
            "edges": edges,
            "updated_at": now_iso(),
        }

    def get_flows(self) -> dict[str, Any]:
        teams = self.get_teams()["teams"]
        tasks = self.get_tasks()["tasks"]

        flows = []
        for team in teams:
            flows.append(
                {
                    "flow_id": f"team:{team['team_id']}",
                    "flow_name": f"{team['team_name']} 工作流程",
                    "flow_type": "team",
                    "description": team.get("description", ""),
                    "stages": len(team["workflow"].get("stages") or []),
                    "teams_involved": [team["team_id"]],
                    "updated_at": now_iso(),
                }
            )

        for t in tasks:
            flows.append(
                {
                    "flow_id": f"task:{t['task_id']}",
                    "flow_name": f"任务流程: {t['task_name']}",
                    "flow_type": "task",
                    "description": f"当前 {t['progress']}% · {t['status']}",
                    "stages": t["total_stages"],
                    "teams_involved": t.get("team_flow") or ([t["team"]] if t["team"] != "unassigned" else []),
                    "updated_at": now_iso(),
                }
            )

        return {"flows": flows, "updated_at": now_iso()}

    def _build_team_rework_edges(self, team_id: str) -> list[dict[str, Any]]:
        transitions = self._team_transitions().get(team_id, {})
        edges: list[dict[str, Any]] = []
        for src, dsts in transitions.items():
            for dst in dsts:
                if dst in {"REWORK", "FAILED", "BLOCKED", "ESCALATED"}:
                    edge_type = "rework" if dst == "REWORK" else "quality_gate"
                    edges.append({"from": src, "to": dst, "type": edge_type})
                if src in {"REWORK", "FAILED", "BLOCKED", "ESCALATED"} and dst not in {"DONE", "COMPLETED"}:
                    edges.append({"from": src, "to": dst, "type": "recovery"})
        uniq = []
        seen: set[tuple[str, str, str]] = set()
        for e in edges:
            key = (e["from"], e["to"], e["type"])
            if key in seen:
                continue
            seen.add(key)
            uniq.append(e)
        return uniq

    def get_flow_detail(self, flow_id: str | None) -> dict[str, Any]:
        if not flow_id:
            return {"error": "Flow ID required"}

        if flow_id.startswith("team:"):
            team_id = flow_id.split(":", 1)[1]
            team = self.get_team_detail(team_id)
            if "error" in team:
                return team
            steps = []
            member_ids = {m.get("agent_id") for m in (team.get("members") or []) if isinstance(m, dict)}
            for i, stage in enumerate(team["workflow"].get("stages") or [], start=1):
                role, owner_agent = self._select_owner_for_stage(team_id, str(stage), member_ids)
                steps.append(
                    {
                        "step": i,
                        "name": stage,
                        "team": team_id,
                        "description": f"{team['team_name']} - {stage}",
                        "owner_role": role,
                        "owner_agent": owner_agent,
                        "status": "pending",
                    }
                )
            return {
                "flow_id": flow_id,
                "flow_name": f"{team['team_name']} 工作流程",
                "flow_type": "team",
                "steps": steps,
                "rework_edges": self._build_team_rework_edges(team_id),
                "metadata": {
                    "responsibilities": team.get("responsibilities", []),
                    "transitions": self._team_transitions().get(team_id, {}),
                },
            }

        if flow_id.startswith("task:"):
            task_id = flow_id.split(":", 1)[1]
            task = self.get_task_detail(task_id)
            if "error" in task:
                return task
            steps = []
            for st in task.get("stages") or []:
                steps.append(
                    {
                        "step": st["stage_id"],
                        "name": st["name"],
                        "team": task.get("team") or "unassigned",
                        "description": st.get("description") or "",
                        "status": st.get("status"),
                        "owner_role": st.get("owner_role"),
                        "owner_agent": st.get("owner_agent"),
                    }
                )
            return {
                "flow_id": flow_id,
                "flow_name": f"任务流程: {task['task_name']}",
                "flow_type": "task",
                "steps": steps,
                "rework_edges": [],
                "metadata": {
                    "task_id": task["task_id"],
                    "owner": task["owner"],
                    "team_flow": task.get("team_flow", []),
                    "progress": task.get("progress", 0),
                    "runtime_state": task.get("runtime_state"),
                },
            }

        return {"error": "Flow not found"}

    def get_claw_live(self) -> dict[str, Any]:
        snap = self._claw_live_snapshot()
        payload = snap.get("payload") or {}
        sessions = (payload.get("sessions") or {}) if isinstance(payload, dict) else {}
        return {
            "freshness": snap.get("freshness"),
            "last_success_at": datetime.fromtimestamp((snap.get("last_success_ms") or 0) / 1000, tz=timezone.utc).astimezone().isoformat()
            if snap.get("last_success_ms")
            else None,
            "error": snap.get("error"),
            "runtime_version": payload.get("runtimeVersion"),
            "heartbeat": payload.get("heartbeat"),
            "channel_summary": payload.get("channelSummary") or [],
            "session_count": (sessions.get("count") if isinstance(sessions.get("count"), int) else 0),
            "recent_sessions": self._sessions_from_live(payload)[:20],
            "updated_at": now_iso(),
        }

    def get_runtime_versions(self) -> dict[str, Any]:
        return {
            "ok": True,
            **self._current_runtime_versions(),
            "updated_at": now_iso(),
        }

    def list_change_tasks(self) -> list[dict[str, Any]]:
        return [self._change_view_model(item, detail=False) for item in self._task_repo.list_change_tasks()]

    def get_change_task(self, change_id: str | None) -> dict[str, Any] | None:
        if not change_id:
            return None
        change = self._task_repo.get_change_task(str(change_id))
        if not change:
            return None
        return self._change_view_model(change, detail=True)

    def list_review_tasks(self, review_pool: str | None = None) -> list[dict[str, Any]]:
        return [self._review_view_model(item, detail=False) for item in self._task_repo.list_review_tasks(review_pool)]

    def get_config_doc(self, kind: str) -> dict[str, Any]:
        if kind == "team-leads":
            return {"ok": True, "kind": kind, "doc": self._team_leads_doc(), "updated_at": now_iso()}
        if kind == "team-state-machines":
            return {"ok": True, "kind": kind, "doc": self._team_state_machines_doc(), "updated_at": now_iso()}
        return {"ok": False, "error": "unsupported config kind"}

    def _backup_configs(self, paths: list[Path], tag: str) -> Path:
        stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        backup_dir = self.config_backup_root / f"{stamp}_{tag}"
        backup_dir.mkdir(parents=True, exist_ok=True)
        for p in paths:
            if not p.exists():
                continue
            rel = p.name
            shutil.copy2(str(p), str(backup_dir / rel))
        return backup_dir

    def _validate_team_state_machine_doc(self, doc: dict[str, Any]) -> tuple[bool, str]:
        if not isinstance(doc, dict):
            return False, "doc must be object"
        sms = doc.get("team_state_machines")
        if not isinstance(sms, dict):
            return False, "team_state_machines missing"
        for tid, cfg in sms.items():
            if not isinstance(cfg, dict):
                return False, f"{tid} config must be object"
            states = cfg.get("internal_states") or []
            transitions = cfg.get("transitions") or {}
            if not isinstance(states, list) or not all(isinstance(x, str) for x in states):
                return False, f"{tid}.internal_states invalid"
            if not isinstance(transitions, dict):
                return False, f"{tid}.transitions invalid"
            state_set = set(states) | {"REWORK", "FAILED", "BLOCKED", "ESCALATED", "DONE", "CANCELLED", "COMPLETED"}
            for src, dsts in transitions.items():
                if not isinstance(dsts, list):
                    return False, f"{tid}.transitions[{src}] must be list"
                for d in dsts:
                    if not isinstance(d, str):
                        return False, f"{tid}.transitions[{src}] contains non-string"
                    if d not in state_set:
                        return False, f"{tid}.transitions[{src}] -> {d} unknown state"
        return True, "ok"

    def _validate_team_leads_doc(self, doc: dict[str, Any]) -> tuple[bool, str]:
        if not isinstance(doc, dict):
            return False, "doc must be object"
        team_leads = doc.get("team_leads")
        if not isinstance(team_leads, dict):
            return False, "team_leads missing"
        for tid, cfg in team_leads.items():
            if not isinstance(cfg, dict):
                return False, f"{tid} lead config invalid"
            lead = cfg.get("lead_agent")
            if not isinstance(lead, str) or not lead.strip():
                return False, f"{tid}.lead_agent required"
        return True, "ok"

    def update_config_doc(self, kind: str, doc: dict[str, Any], operator: str | None = None) -> dict[str, Any]:
        if kind == "team-leads":
            ok, msg = self._validate_team_leads_doc(doc)
            if not ok:
                return {"ok": False, "error": msg}
            backup_dir = self._backup_configs([self.team_leads_path], "team-leads")
            self._write_json(self.team_leads_path, doc)
            return {"ok": True, "kind": kind, "backup": str(backup_dir), "operator": operator or "dashboard", "updated_at": now_iso()}

        if kind == "team-state-machines":
            ok, msg = self._validate_team_state_machine_doc(doc)
            if not ok:
                return {"ok": False, "error": msg}
            backup_dir = self._backup_configs([self.team_state_machines_path], "team-state-machines")
            self._write_json(self.team_state_machines_path, doc)
            return {"ok": True, "kind": kind, "backup": str(backup_dir), "operator": operator or "dashboard", "updated_at": now_iso()}

        return {"ok": False, "error": "unsupported config kind"}

    def patch_from_prompt(self, prompt: str | None, target: str | None = None) -> dict[str, Any]:
        prompt = (prompt or "").strip()
        if not prompt:
            return {"ok": False, "error": "prompt required"}

        suggestions: list[dict[str, Any]] = []

        m_resp = re.search(r"team[-_a-z0-9]+", prompt, re.IGNORECASE)
        team_id = m_resp.group(0) if m_resp else None

        add_resp = re.search(r"添加职责[:：]\s*([^\n]+)", prompt)
        if add_resp and team_id:
            suggestions.append(
                {
                    "target": "team-leads",
                    "op": "append_responsibility",
                    "team_id": team_id,
                    "value": add_resp.group(1).strip(),
                }
            )

        tran = re.search(r"([A-Z_]+)\s*[-=]>\s*([A-Z_]+)", prompt)
        if tran and team_id:
            suggestions.append(
                {
                    "target": "team-state-machines",
                    "op": "add_transition",
                    "team_id": team_id,
                    "from": tran.group(1).strip(),
                    "to": tran.group(2).strip(),
                }
            )

        if not suggestions:
            suggestions.append(
                {
                    "target": target or "team-state-machines",
                    "op": "manual_review",
                    "summary": "无法自动结构化解析，请手动编辑后发布。",
                    "prompt": prompt,
                }
            )

        return {
            "ok": True,
            "proposal": {
                "title": "Prompt Patch Proposal",
                "target": target or "auto",
                "prompt": prompt,
                "suggestions": suggestions,
            },
            "updated_at": now_iso(),
        }

    def _simulate_change_impact(self, changes: list[dict[str, Any]]) -> dict[str, Any]:
        return {
            "change_count": len(changes),
            "targets": sorted({str(c.get("target") or "") for c in changes}),
            "risk": "medium" if len(changes) > 1 else "low",
        }

    def publish_config(self, changes: list[dict[str, Any]] | None, restart_gateway: bool = False, operator: str | None = None) -> dict[str, Any]:
        changes = changes or []
        if not isinstance(changes, list) or not changes:
            return {"ok": False, "error": "changes required"}

        apply_items: list[tuple[str, dict[str, Any], Path]] = []
        for ch in changes:
            if not isinstance(ch, dict):
                return {"ok": False, "error": "invalid change item"}
            target = str(ch.get("target") or "")
            doc = ch.get("doc")
            if target == "team-leads":
                if not isinstance(doc, dict):
                    return {"ok": False, "error": "team-leads doc missing"}
                ok, msg = self._validate_team_leads_doc(doc)
                if not ok:
                    return {"ok": False, "error": msg}
                apply_items.append((target, doc, self.team_leads_path))
            elif target == "team-state-machines":
                if not isinstance(doc, dict):
                    return {"ok": False, "error": "team-state-machines doc missing"}
                ok, msg = self._validate_team_state_machine_doc(doc)
                if not ok:
                    return {"ok": False, "error": msg}
                apply_items.append((target, doc, self.team_state_machines_path))
            else:
                return {"ok": False, "error": f"unsupported target: {target}"}

        backup_dir = self._backup_configs([x[2] for x in apply_items], "publish")
        for _, doc, path in apply_items:
            self._write_json(path, doc)

        restarted = False
        restart_error = None
        if restart_gateway:
            try:
                subprocess.run(["openclaw", "gateway", "restart"], cwd=str(self.base_dir), timeout=40, check=True, capture_output=True, text=True)
                restarted = True
            except Exception as exc:
                restart_error = str(exc)

        return {
            "ok": True,
            "operator": operator or "dashboard",
            "backup": str(backup_dir),
            "impact": self._simulate_change_impact(changes),
            "restart_gateway": restart_gateway,
            "restart_done": restarted,
            "restart_error": restart_error,
            "updated_at": now_iso(),
        }


SERVICE = DashboardDataService()


class DashboardAPIHandler(SimpleHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def _read_json_body(self) -> dict[str, Any]:
        try:
            length = int(self.headers.get("Content-Length") or "0")
        except Exception:
            length = 0
        if length <= 0:
            return {}
        raw = self.rfile.read(length)
        if not raw:
            return {}
        try:
            return json.loads(raw.decode("utf-8"))
        except Exception:
            return {}

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        query = parse_qs(parsed.query)

        if path == "/api/teams":
            return self.send_json(SERVICE.get_teams())
        if path == "/api/team/detail":
            return self.send_json(SERVICE.get_team_detail((query.get("team_id") or [None])[0]))
        if path == "/api/standalone-agents":
            return self.send_json(SERVICE.get_standalone_agents())
        if path == "/api/temporary-agents":
            return self.send_json(SERVICE.get_temporary_agents())
        if path == "/api/tasks":
            status_filter = (query.get("status") or [None])[0]
            team = (query.get("team") or [None])[0]
            owner = (query.get("owner") or [None])[0]
            dispatch_state = (query.get("dispatch_state") or [None])[0]
            task_pool = (query.get("task_pool") or [None])[0]
            include_history_raw = (query.get("include_history") or ["0"])[0]
            include_history = str(include_history_raw).strip().lower() in {"1", "true", "yes", "on"}
            since = (query.get("since") or [None])[0]
            sort = (query.get("sort") or ["updated_at_ms"])[0] or "updated_at_ms"
            order = (query.get("order") or ["desc"])[0] or "desc"
            try:
                limit = int((query.get("limit") or [0])[0] or 0)
            except Exception:
                limit = 0
            try:
                offset = int((query.get("offset") or [0])[0] or 0)
            except Exception:
                offset = 0
            return self.send_json(
                SERVICE.get_tasks(
                    status_filter=status_filter,
                    team=team,
                    owner=owner,
                    dispatch_state=dispatch_state,
                    task_pool=task_pool,
                    include_history=include_history,
                    since=since,
                    limit=limit if limit > 0 else None,
                    offset=offset,
                    sort=sort,
                    order=order,
                )
            )
        if path == "/api/task/detail":
            return self.send_json(SERVICE.get_task_detail((query.get("task_id") or [None])[0]))
        if path == "/api/task/chat-link":
            return self.send_json(SERVICE.get_task_chat_link((query.get("task_id") or [None])[0]))
        if path == "/api/task/control-status":
            return self.send_json(SERVICE.get_task_control_status((query.get("job_id") or [None])[0]))
        if path == "/api/stats":
            include_history_raw = (query.get("include_history") or ["0"])[0]
            include_history = str(include_history_raw).strip().lower() in {"1", "true", "yes", "on"}
            return self.send_json(SERVICE.get_stats(include_history=include_history))
        if path == "/api/unclaimed-tasks":
            return self.send_json(SERVICE.get_unclaimed_tasks())
        if path == "/api/task-pools":
            return self.send_json(SERVICE.get_task_pools())
        if path == "/api/recovery/scan":
            return self.send_json(SERVICE.scan_stalled_work())
        if path == "/api/reviews":
            review_pool = (query.get("review_pool") or [None])[0]
            return self.send_json({"reviews": SERVICE.list_review_tasks(review_pool), "updated_at": now_iso()})
        m = re.fullmatch(r"/api/reviews/([^/]+)", path)
        if m:
            return self.send_json(SERVICE.get_review_task(unquote(m.group(1))))
        if path == "/api/agent-workload":
            return self.send_json(SERVICE.get_agent_workload())
        if path == "/api/schedule":
            return self.send_json(SERVICE.get_schedule())
        if path == "/api/architecture":
            return self.send_json(SERVICE.get_architecture())
        if path == "/api/flows":
            return self.send_json(SERVICE.get_flows())
        if path == "/api/flow/detail":
            return self.send_json(SERVICE.get_flow_detail((query.get("flow_id") or [None])[0]))
        if path == "/api/claw/live":
            return self.send_json(SERVICE.get_claw_live())
        if path == "/api/runtime-versions":
            return self.send_json(SERVICE.get_runtime_versions())
        if path == "/api/change-tasks":
            return self.send_json({"changes": SERVICE.list_change_tasks(), "updated_at": now_iso()})
        m_change = re.fullmatch(r"/api/change-tasks/([^/]+)", path)
        if m_change:
            detail = SERVICE.get_change_task(unquote(m_change.group(1)))
            if detail is None:
                return self.send_json({"error": "change not found"}, status=404)
            return self.send_json(detail)
        if path == "/api/config/team-leads":
            return self.send_json(SERVICE.get_config_doc("team-leads"))
        if path == "/api/config/team-state-machines":
            return self.send_json(SERVICE.get_config_doc("team-state-machines"))
        if path == "/api/health":
            return self.send_json({"status": "ok", "updated_at": now_iso()})

        if path == "/":
            self.path = "/task_dashboard.html"
        return super().do_GET()

    def do_PUT(self):
        parsed = urlparse(self.path)
        path = parsed.path
        payload = self._read_json_body()

        if path == "/api/config/team-leads":
            return self.send_json(SERVICE.update_config_doc("team-leads", payload.get("doc") or payload, operator=payload.get("operator")))
        if path == "/api/config/team-state-machines":
            return self.send_json(
                SERVICE.update_config_doc("team-state-machines", payload.get("doc") or payload, operator=payload.get("operator"))
            )

        return self.send_json({"ok": False, "error": "unsupported PUT endpoint"}, status=404)

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path
        payload = self._read_json_body()

        if path == "/api/tasks":
            return self.send_json(
                SERVICE.create_task(
                    payload=payload,
                    actor_id=payload.get("actor_id") or payload.get("operator"),
                    actor_role=payload.get("actor_role") or payload.get("operator_role"),
                )
            )
        if path == "/api/reviews":
            return self.send_json(
                SERVICE.create_review_task(
                    payload=payload,
                    actor_id=payload.get("actor_id") or payload.get("operator"),
                    actor_role=payload.get("actor_role") or payload.get("operator_role"),
                )
            )
        m = re.fullmatch(r"/api/reviews/([^/]+)/dispatch", path)
        if m:
            return self.send_json(
                SERVICE.dispatch_review_task(
                    review_id=unquote(m.group(1)),
                    actor_id=payload.get("actor_id") or payload.get("operator"),
                    actor_role=payload.get("actor_role") or payload.get("operator_role"),
                )
            )
        m = re.fullmatch(r"/api/reviews/([^/]+)/packet", path)
        if m:
            return self.send_json(
                SERVICE.submit_review_packet(
                    review_id=unquote(m.group(1)),
                    payload=payload,
                    actor_id=payload.get("actor_id") or payload.get("operator"),
                    actor_role=payload.get("actor_role") or payload.get("operator_role"),
                )
            )
        m = re.fullmatch(r"/api/reviews/([^/]+)/chief-decision", path)
        if m:
            return self.send_json(
                SERVICE.decide_review_task(
                    review_id=unquote(m.group(1)),
                    actor_id=payload.get("actor_id") or payload.get("operator"),
                    actor_role=payload.get("actor_role") or payload.get("operator_role"),
                    decision=payload.get("decision"),
                    next_action=payload.get("next_action"),
                    next_owner=payload.get("next_owner"),
                )
            )
        m = re.fullmatch(r"/api/reviews/([^/]+)/reclaim", path)
        if m:
            return self.send_json(
                SERVICE.recover_review_task(
                    review_id=unquote(m.group(1)),
                    actor_id=payload.get("actor_id") or payload.get("operator"),
                    actor_role=payload.get("actor_role") or payload.get("operator_role"),
                    action=payload.get("action") or "reclaim",
                )
            )
        if path == "/api/change-tasks":
            return self.send_json(SERVICE.create_change_task(payload, payload.get("actor_id") or payload.get("operator"), payload.get("actor_role") or payload.get("operator_role")))
        m = re.fullmatch(r"/api/change-tasks/([^/]+)/approve", path)
        if m:
            return self.send_json(SERVICE.approve_change_task(unquote(m.group(1)), payload.get("actor_id") or payload.get("operator"), payload.get("actor_role") or payload.get("operator_role")))
        m = re.fullmatch(r"/api/change-tasks/([^/]+)/publish", path)
        if m:
            return self.send_json(
                SERVICE.publish_change_task(
                    unquote(m.group(1)),
                    payload.get("actor_id") or payload.get("operator"),
                    payload.get("actor_role") or payload.get("operator_role"),
                    p0_override=bool(payload.get("p0_override")),
                )
            )
        if path == "/api/recovery/scan":
            return self.send_json(SERVICE.scan_stalled_work())

        m = re.fullmatch(r"/api/tasks/([^/]+)/artifact", path)
        if m:
            return self.send_json(
                SERVICE.add_task_artifact(
                    task_id=unquote(m.group(1)),
                    actor_id=payload.get("actor_id") or payload.get("operator"),
                    actor_role=payload.get("actor_role") or payload.get("operator_role"),
                    artifact=payload.get("artifact") if isinstance(payload.get("artifact"), dict) else payload,
                )
            )

        m = re.fullmatch(r"/api/tasks/([^/]+)/stage/([^/]+)/handoff", path)
        if m:
            return self.send_json(
                SERVICE.handoff_stage(
                    task_id=unquote(m.group(1)),
                    stage_id=unquote(m.group(2)),
                    actor_id=payload.get("actor_id") or payload.get("operator"),
                    actor_role=payload.get("actor_role") or payload.get("operator_role"),
                    handoff_note=payload.get("handoff_note"),
                    artifact_summary=payload.get("artifact_summary"),
                    next_owner=payload.get("next_owner"),
                )
            )

        m = re.fullmatch(r"/api/tasks/([^/]+)/claim", path)
        if m:
            task_id = m.group(1)
            return self.send_json(
                SERVICE.claim_task(
                    task_id=task_id,
                    actor_id=payload.get("actor_id") or payload.get("operator"),
                    actor_role=payload.get("actor_role") or payload.get("operator_role"),
                    actor_team=payload.get("actor_team"),
                )
            )

        m = re.fullmatch(r"/api/tasks/([^/]+)/assign", path)
        if m:
            task_id = m.group(1)
            return self.send_json(
                SERVICE.assign_task(
                    task_id=task_id,
                    assigned_to=payload.get("assigned_to") or payload.get("target_agent"),
                    actor_id=payload.get("actor_id") or payload.get("operator"),
                    actor_role=payload.get("actor_role") or payload.get("operator_role"),
                    assigned_team=payload.get("assigned_team") or payload.get("team"),
                    reason=payload.get("reason"),
                    force=bool(payload.get("force")),
                )
            )

        m = re.fullmatch(r"/api/tasks/([^/]+)/dispatch-suggest", path)
        if m:
            return self.send_json(
                SERVICE.dispatch_suggest(
                    task_id=m.group(1),
                    actor_id=payload.get("actor_id") or payload.get("operator"),
                    actor_role=payload.get("actor_role") or payload.get("operator_role"),
                )
            )

        m = re.fullmatch(r"/api/tasks/([^/]+)/dispatch-confirm", path)
        if m:
            confirm_raw = payload.get("confirm", True)
            if isinstance(confirm_raw, str):
                confirm = confirm_raw.strip().lower() not in {"0", "false", "no", "off"}
            else:
                confirm = bool(confirm_raw)
            return self.send_json(
                SERVICE.dispatch_confirm(
                    task_id=m.group(1),
                    actor_id=payload.get("actor_id") or payload.get("operator"),
                    actor_role=payload.get("actor_role") or payload.get("operator_role"),
                    confirm=confirm,
                    assigned_to=payload.get("assigned_to") or payload.get("target_agent"),
                    assigned_team=payload.get("assigned_team") or payload.get("team"),
                    reason=payload.get("reason"),
                )
            )

        m = re.fullmatch(r"/api/tasks/([^/]+)/progress", path)
        if m:
            progress_value = payload.get("progress")
            return self.send_json(
                SERVICE.update_task_progress(
                    task_id=m.group(1),
                    actor_id=payload.get("actor_id") or payload.get("operator"),
                    actor_role=payload.get("actor_role") or payload.get("operator_role"),
                    progress=progress_value if isinstance(progress_value, (int, float)) else progress_value,
                    status=payload.get("status"),
                    current_step=payload.get("current_step"),
                    note=payload.get("note"),
                )
            )

        if path == "/api/task/control":
            async_mode_raw = payload.get("async", True)
            if isinstance(async_mode_raw, str):
                async_mode = async_mode_raw.strip().lower() not in {"0", "false", "no", "off"}
            else:
                async_mode = bool(async_mode_raw)
            return self.send_json(
                SERVICE.control_task(
                    task_id=payload.get("task_id"),
                    action=payload.get("action"),
                    operator=payload.get("operator"),
                    reason=payload.get("reason"),
                    async_mode=async_mode,
                    operator_role=payload.get("operator_role"),
                )
            )

        if path == "/api/task/delete":
            return self.send_json(
                SERVICE.delete_task(
                    task_id=payload.get("task_id"),
                    operator=payload.get("operator"),
                    reason=payload.get("reason"),
                    operator_role=payload.get("operator_role"),
                )
            )

        if path == "/api/task/restore":
            return self.send_json(
                SERVICE.restore_task(
                    task_id=payload.get("task_id"),
                    archive_path=payload.get("archive_path"),
                    operator=payload.get("operator"),
                    operator_role=payload.get("operator_role"),
                )
            )

        if path == "/api/config/patch-from-prompt":
            return self.send_json(SERVICE.patch_from_prompt(prompt=payload.get("prompt"), target=payload.get("target")))

        if path == "/api/config/publish":
            return self.send_json(
                SERVICE.publish_config(
                    changes=payload.get("changes"),
                    restart_gateway=bool(payload.get("restart_gateway")),
                    operator=payload.get("operator"),
                )
            )

        return self.send_json({"ok": False, "error": "unsupported POST endpoint"}, status=404)

    def send_json(self, payload: Any, status: int = 200):
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()
        self.wfile.write(json.dumps(payload, ensure_ascii=False).encode("utf-8"))

    def log_message(self, format: str, *args):
        return


def run_server(port: int = 8080):
    os.chdir(Path(__file__).resolve().parent)
    server = ThreadingHTTPServer(("", port), DashboardAPIHandler)
    print("OpenClaw Dashboard API Server (real-data) started")
    print(f"http://localhost:{port}")
    server.serve_forever()


if __name__ == "__main__":
    import sys

    p = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
    run_server(p)
