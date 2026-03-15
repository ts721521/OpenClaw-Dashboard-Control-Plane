#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def now_iso() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat()


def to_ms(value: str | int | float | None) -> int:
    if value is None:
        return int(datetime.now(timezone.utc).timestamp() * 1000)
    if isinstance(value, (int, float)):
        return int(value)
    s = str(value).strip()
    if not s:
        return int(datetime.now(timezone.utc).timestamp() * 1000)
    try:
        if s.endswith("Z"):
            s = s[:-1] + "+00:00"
        return int(datetime.fromisoformat(s).timestamp() * 1000)
    except Exception:
        return int(datetime.now(timezone.utc).timestamp() * 1000)


def normalize_status(raw: str | None) -> str:
    v = (raw or "").strip().lower()
    if v in {"in_progress", "running", "assigned", "started", "working", "active", "resumed"}:
        return "in_progress"
    if v in {"completed", "done", "success", "closed"}:
        return "completed"
    if v in {"pending", "planned", "todo", "ready", "queued", "new", "paused", "stopped"}:
        return "pending"
    return v or "pending"


class TaskRepository:
    def __init__(self, db_path: str | Path):
        self.db_path = Path(db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(str(self.db_path), check_same_thread=False)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL;")
        conn.execute("PRAGMA synchronous=NORMAL;")
        conn.execute("PRAGMA foreign_keys=ON;")
        return conn

    def init_schema(self) -> None:
        with self._connect() as conn:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS task_meta (
                    key TEXT PRIMARY KEY,
                    value TEXT,
                    updated_at TEXT
                );

                CREATE TABLE IF NOT EXISTS tasks (
                    task_id TEXT PRIMARY KEY,
                    task_name TEXT,
                    task_type TEXT,
                    status TEXT,
                    progress INTEGER DEFAULT 0,
                    owner TEXT,
                    team TEXT,
                    business_bound INTEGER DEFAULT 0,
                    business_truth_source TEXT,
                    acceptance_result TEXT,
                    gate_result TEXT,
                    task_pool TEXT DEFAULT 'team_dispatch_pool',
                    parent_task_id TEXT,
                    dispatch_state TEXT DEFAULT 'claim_pool',
                    source_type TEXT,
                    source_path TEXT,
                    is_archived INTEGER DEFAULT 0,
                    archive_path TEXT,
                    created_at TEXT,
                    updated_at TEXT,
                    updated_at_ms INTEGER,
                    payload_json TEXT NOT NULL
                );

                CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
                CREATE INDEX IF NOT EXISTS idx_tasks_owner ON tasks(owner);
                CREATE INDEX IF NOT EXISTS idx_tasks_team ON tasks(team);
                CREATE INDEX IF NOT EXISTS idx_tasks_updated_at_ms ON tasks(updated_at_ms);
                CREATE INDEX IF NOT EXISTS idx_tasks_archived ON tasks(is_archived);
                CREATE INDEX IF NOT EXISTS idx_tasks_dispatch_state ON tasks(dispatch_state);

                CREATE TABLE IF NOT EXISTS task_events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    task_id TEXT NOT NULL,
                    event_type TEXT NOT NULL,
                    actor_id TEXT,
                    actor_role TEXT,
                    event_payload TEXT,
                    created_at TEXT,
                    created_at_ms INTEGER
                );
                CREATE INDEX IF NOT EXISTS idx_task_events_task ON task_events(task_id, created_at_ms DESC);

                CREATE TABLE IF NOT EXISTS task_assignments (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    task_id TEXT NOT NULL,
                    assigned_to TEXT NOT NULL,
                    assigned_team TEXT,
                    assigned_by TEXT,
                    assigned_by_role TEXT,
                    reason TEXT,
                    created_at TEXT,
                    created_at_ms INTEGER
                );
                CREATE INDEX IF NOT EXISTS idx_task_assignments_task ON task_assignments(task_id, created_at_ms DESC);

                CREATE TABLE IF NOT EXISTS task_claims (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    task_id TEXT NOT NULL,
                    claimed_by TEXT NOT NULL,
                    claimed_team TEXT,
                    claimed_by_role TEXT,
                    created_at TEXT,
                    created_at_ms INTEGER
                );
                CREATE INDEX IF NOT EXISTS idx_task_claims_task ON task_claims(task_id, created_at_ms DESC);

                CREATE TABLE IF NOT EXISTS dispatch_rules (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    rule_name TEXT UNIQUE,
                    rule_payload TEXT,
                    enabled INTEGER DEFAULT 1,
                    created_at TEXT,
                    updated_at TEXT
                );

                CREATE TABLE IF NOT EXISTS control_audit (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    task_id TEXT,
                    action TEXT,
                    mode TEXT,
                    operator TEXT,
                    reason TEXT,
                    hard_ok INTEGER,
                    hard_error TEXT,
                    payload_json TEXT,
                    created_at TEXT,
                    created_at_ms INTEGER
                );
                CREATE INDEX IF NOT EXISTS idx_control_audit_task ON control_audit(task_id, created_at_ms DESC);

                CREATE TABLE IF NOT EXISTS review_tasks (
                    review_id TEXT PRIMARY KEY,
                    title TEXT,
                    incident_key TEXT,
                    status TEXT,
                    review_pool TEXT DEFAULT 'review_pool',
                    assigned_to TEXT,
                    created_at TEXT,
                    updated_at TEXT,
                    updated_at_ms INTEGER,
                    payload_json TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_review_tasks_incident ON review_tasks(incident_key);
                CREATE INDEX IF NOT EXISTS idx_review_tasks_status ON review_tasks(status);
                CREATE INDEX IF NOT EXISTS idx_review_tasks_pool ON review_tasks(review_pool);

                CREATE TABLE IF NOT EXISTS review_packets (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    review_id TEXT NOT NULL,
                    reviewer_id TEXT NOT NULL,
                    payload_json TEXT NOT NULL,
                    created_at TEXT,
                    created_at_ms INTEGER
                );
                CREATE INDEX IF NOT EXISTS idx_review_packets_review ON review_packets(review_id, created_at_ms DESC);

                CREATE TABLE IF NOT EXISTS change_tasks (
                    change_id TEXT PRIMARY KEY,
                    title TEXT,
                    scope TEXT,
                    priority TEXT,
                    status TEXT,
                    affects_scope TEXT,
                    created_at TEXT,
                    updated_at TEXT,
                    updated_at_ms INTEGER,
                    payload_json TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_change_tasks_status ON change_tasks(status);
                """
            )
            cols = {row["name"] for row in conn.execute("PRAGMA table_info(tasks)").fetchall()}
            if "task_pool" not in cols:
                conn.execute("ALTER TABLE tasks ADD COLUMN task_pool TEXT DEFAULT 'team_dispatch_pool'")
            if "parent_task_id" not in cols:
                conn.execute("ALTER TABLE tasks ADD COLUMN parent_task_id TEXT")
            if "business_bound" not in cols:
                conn.execute("ALTER TABLE tasks ADD COLUMN business_bound INTEGER DEFAULT 0")
            if "business_truth_source" not in cols:
                conn.execute("ALTER TABLE tasks ADD COLUMN business_truth_source TEXT")
            if "acceptance_result" not in cols:
                conn.execute("ALTER TABLE tasks ADD COLUMN acceptance_result TEXT")
            if "gate_result" not in cols:
                conn.execute("ALTER TABLE tasks ADD COLUMN gate_result TEXT")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_tasks_pool ON tasks(task_pool)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks(parent_task_id)")
            review_cols = {row["name"] for row in conn.execute("PRAGMA table_info(review_tasks)").fetchall()}
            if "title" not in review_cols:
                conn.execute("ALTER TABLE review_tasks ADD COLUMN title TEXT")
            if "assigned_to" not in review_cols:
                conn.execute("ALTER TABLE review_tasks ADD COLUMN assigned_to TEXT")
            change_cols = {row["name"] for row in conn.execute("PRAGMA table_info(change_tasks)").fetchall()}
            if "title" not in change_cols:
                conn.execute("ALTER TABLE change_tasks ADD COLUMN title TEXT")
            if "priority" not in change_cols:
                conn.execute("ALTER TABLE change_tasks ADD COLUMN priority TEXT")
            if "affects_scope" not in change_cols:
                conn.execute("ALTER TABLE change_tasks ADD COLUMN affects_scope TEXT")

    def get_meta(self, key: str) -> str | None:
        with self._connect() as conn:
            row = conn.execute("SELECT value FROM task_meta WHERE key=?", (key,)).fetchone()
            return row[0] if row else None

    def set_meta(self, key: str, value: str) -> None:
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO task_meta(key, value, updated_at)
                VALUES (?, ?, ?)
                ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at
                """,
                (key, value, now_iso()),
            )

    def upsert_task_payload(
        self,
        payload: dict[str, Any],
        source_type: str = "json_task",
        source_path: str | None = None,
        dispatch_state: str | None = None,
        force: bool = False,
    ) -> None:
        task_id = str(payload.get("task_id") or "").strip()
        if not task_id:
            return
        execution = payload.get("execution") or {}
        status = normalize_status(str(execution.get("status") or payload.get("status") or "pending"))
        progress = execution.get("progress")
        if not isinstance(progress, (int, float)):
            progress = 100 if status == "completed" else 0
        owner = str(
            execution.get("assigned_to")
            or (payload.get("next_action") or {}).get("assignee")
            or (payload.get("routing") or {}).get("target_agent")
            or "unassigned"
        )
        task_pool = str(payload.get("task_pool") or "team_dispatch_pool")
        parent_task_id = str(payload.get("parent_task_id") or task_id)
        dispatch_state_val = dispatch_state or payload.get("dispatch_state")
        if not dispatch_state_val:
            dispatch_state_val = "claim_pool" if owner in {"", "unassigned", "none", "null"} else "dispatched"
        created_at = str(payload.get("created_at") or now_iso())
        updated_at = str(
            payload.get("updated_at")
            or (execution.get("control") or {}).get("updated_at")
            or payload.get("last_updated")
            or payload.get("created_at")
            or now_iso()
        )
        updated_at_ms = to_ms(updated_at)
        where_clause = "" if force else "WHERE excluded.updated_at_ms > tasks.updated_at_ms"

        with self._connect() as conn:
            conn.execute(
                f"""
                INSERT INTO tasks(
                    task_id, task_name, task_type, status, progress, owner, team,
                    business_bound, business_truth_source, acceptance_result, gate_result,
                    task_pool, parent_task_id,
                    dispatch_state, source_type, source_path, is_archived, archive_path,
                    created_at, updated_at, updated_at_ms, payload_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, ?, ?, ?)
                ON CONFLICT(task_id) DO UPDATE SET
                    task_name=excluded.task_name,
                    task_type=excluded.task_type,
                    status=excluded.status,
                    progress=excluded.progress,
                    owner=excluded.owner,
                    team=excluded.team,
                    business_bound=excluded.business_bound,
                    business_truth_source=excluded.business_truth_source,
                    acceptance_result=excluded.acceptance_result,
                    gate_result=excluded.gate_result,
                    task_pool=excluded.task_pool,
                    parent_task_id=COALESCE(excluded.parent_task_id, tasks.parent_task_id),
                    dispatch_state=COALESCE(excluded.dispatch_state, tasks.dispatch_state),
                    source_type=excluded.source_type,
                    source_path=COALESCE(excluded.source_path, tasks.source_path),
                    created_at=COALESCE(tasks.created_at, excluded.created_at),
                    updated_at=excluded.updated_at,
                    updated_at_ms=excluded.updated_at_ms,
                    payload_json=excluded.payload_json
                {where_clause}
                """,
                (
                    task_id,
                    str(payload.get("task_name") or payload.get("title") or task_id),
                    str(payload.get("task_type") or "general"),
                    status,
                    int(progress),
                    owner,
                    str(payload.get("team") or "unassigned"),
                    1 if bool(payload.get("business_bound")) else 0,
                    str(payload.get("business_truth_source") or ""),
                    str(payload.get("acceptance_result") or ""),
                    str(payload.get("gate_result") or ""),
                    task_pool,
                    parent_task_id,
                    str(dispatch_state_val),
                    source_type,
                    source_path,
                    created_at,
                    updated_at,
                    updated_at_ms,
                    json.dumps(payload, ensure_ascii=False),
                ),
            )

    def list_task_payloads(
        self,
        status_filter: str | None = None,
        team: str | None = None,
        owner: str | None = None,
        dispatch_state: str | None = None,
        task_pool: str | None = None,
        created_after: str | None = None,
        since: str | int | None = None,
        limit: int | None = None,
        offset: int = 0,
        sort: str = "updated_at_ms",
        order: str = "desc",
    ) -> tuple[list[dict[str, Any]], int, str | None]:
        where = ["is_archived=0"]
        params: list[Any] = []
        if status_filter:
            where.append("status=?")
            params.append(status_filter)
        if team:
            where.append("team=?")
            params.append(team)
        if owner:
            where.append("owner=?")
            params.append(owner)
        if dispatch_state:
            where.append("dispatch_state=?")
            params.append(dispatch_state)
        if task_pool:
            where.append("task_pool=?")
            params.append(task_pool)
        if created_after:
            where.append("created_at >= ?")
            params.append(created_after)
        since_ms = to_ms(since) if since is not None else None
        if since_ms is not None:
            where.append("updated_at_ms > ?")
            params.append(int(since_ms))

        allowed_sort = {"created_at": "created_at", "updated_at": "updated_at", "updated_at_ms": "updated_at_ms", "task_id": "task_id"}
        sort_col = allowed_sort.get(sort or "", "updated_at_ms")
        order_sql = "ASC" if str(order).lower() == "asc" else "DESC"

        where_sql = " AND ".join(where)
        base_sql = f"FROM tasks WHERE {where_sql}"

        with self._connect() as conn:
            total = int(conn.execute(f"SELECT COUNT(1) {base_sql}", tuple(params)).fetchone()[0])
            sql = (
                f"SELECT payload_json, updated_at, updated_at_ms, source_path, dispatch_state, task_pool, parent_task_id, "
                f"business_bound, business_truth_source, acceptance_result, gate_result "
                f"{base_sql} ORDER BY {sort_col} {order_sql}"
            )
            p = list(params)
            if limit is not None:
                sql += " LIMIT ? OFFSET ?"
                p.extend([int(limit), int(offset)])
            rows = conn.execute(sql, tuple(p)).fetchall()

        out: list[dict[str, Any]] = []
        max_ms = 0
        for r in rows:
            try:
                payload = json.loads(r["payload_json"])
            except Exception:
                continue
            payload["updated_at"] = payload.get("updated_at") or r["updated_at"] or now_iso()
            payload["_file"] = payload.get("_file") or r["source_path"]
            payload["dispatch_state"] = payload.get("dispatch_state") or r["dispatch_state"] or "claim_pool"
            payload["task_pool"] = payload.get("task_pool") or r["task_pool"] or "team_dispatch_pool"
            payload["business_bound"] = bool(payload.get("business_bound")) if "business_bound" in payload else bool(r["business_bound"])
            payload["business_truth_source"] = payload.get("business_truth_source") or r["business_truth_source"] or ""
            payload["acceptance_result"] = payload.get("acceptance_result") or r["acceptance_result"] or ""
            payload["gate_result"] = payload.get("gate_result") or r["gate_result"] or ""
            if payload.get("parent_task_id") or r["parent_task_id"]:
                payload["parent_task_id"] = payload.get("parent_task_id") or r["parent_task_id"]
            out.append(payload)
            max_ms = max(max_ms, int(r["updated_at_ms"] or 0))

        next_since = datetime.fromtimestamp(max_ms / 1000, tz=timezone.utc).astimezone().isoformat() if max_ms else None
        return out, total, next_since

    def get_task_payload(self, task_id: str, include_archived: bool = True) -> dict[str, Any] | None:
        where = "task_id=?" if include_archived else "task_id=? AND is_archived=0"
        with self._connect() as conn:
            row = conn.execute(
                f"SELECT payload_json, source_path, dispatch_state, task_pool, parent_task_id, "
                f"business_bound, business_truth_source, acceptance_result, gate_result FROM tasks WHERE {where}",
                (task_id,),
            ).fetchone()
        if not row:
            return None
        try:
            payload = json.loads(row["payload_json"])
            payload["_file"] = payload.get("_file") or row["source_path"]
            payload["dispatch_state"] = payload.get("dispatch_state") or row["dispatch_state"] or "claim_pool"
            payload["task_pool"] = payload.get("task_pool") or row["task_pool"] or "team_dispatch_pool"
            payload["business_bound"] = bool(payload.get("business_bound")) if "business_bound" in payload else bool(row["business_bound"])
            payload["business_truth_source"] = payload.get("business_truth_source") or row["business_truth_source"] or ""
            payload["acceptance_result"] = payload.get("acceptance_result") or row["acceptance_result"] or ""
            payload["gate_result"] = payload.get("gate_result") or row["gate_result"] or ""
            if payload.get("parent_task_id") or row["parent_task_id"]:
                payload["parent_task_id"] = payload.get("parent_task_id") or row["parent_task_id"]
            return payload
        except Exception:
            return None

    def archive_task(self, task_id: str, archive_path: str | None = None) -> None:
        with self._connect() as conn:
            conn.execute(
                "UPDATE tasks SET is_archived=1, archive_path=?, updated_at=?, updated_at_ms=? WHERE task_id=?",
                (archive_path, now_iso(), to_ms(now_iso()), task_id),
            )

    def restore_task(self, payload: dict[str, Any], source_path: str | None = None) -> None:
        self.upsert_task_payload(payload, source_type="archive_restore", source_path=source_path, force=True)
        task_id = str(payload.get("task_id") or "")
        if not task_id:
            return
        with self._connect() as conn:
            conn.execute(
                "UPDATE tasks SET is_archived=0, archive_path=NULL, updated_at=?, updated_at_ms=? WHERE task_id=?",
                (now_iso(), to_ms(now_iso()), task_id),
            )

    def add_event(self, task_id: str, event_type: str, actor_id: str | None, actor_role: str | None, payload: dict[str, Any] | None) -> None:
        ts = now_iso()
        with self._connect() as conn:
            conn.execute(
                "INSERT INTO task_events(task_id, event_type, actor_id, actor_role, event_payload, created_at, created_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?)",
                (task_id, event_type, actor_id, actor_role, json.dumps(payload or {}, ensure_ascii=False), ts, to_ms(ts)),
            )

    def add_assignment(
        self,
        task_id: str,
        assigned_to: str,
        assigned_team: str | None,
        assigned_by: str | None,
        assigned_by_role: str | None,
        reason: str | None,
    ) -> None:
        ts = now_iso()
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO task_assignments(task_id, assigned_to, assigned_team, assigned_by, assigned_by_role, reason, created_at, created_at_ms)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (task_id, assigned_to, assigned_team, assigned_by, assigned_by_role, reason, ts, to_ms(ts)),
            )

    def add_claim(self, task_id: str, claimed_by: str, claimed_team: str | None, claimed_by_role: str | None) -> None:
        ts = now_iso()
        with self._connect() as conn:
            conn.execute(
                "INSERT INTO task_claims(task_id, claimed_by, claimed_team, claimed_by_role, created_at, created_at_ms) VALUES (?, ?, ?, ?, ?, ?)",
                (task_id, claimed_by, claimed_team, claimed_by_role, ts, to_ms(ts)),
            )

    def update_dispatch_state(self, task_id: str, dispatch_state: str) -> None:
        with self._connect() as conn:
            conn.execute(
                "UPDATE tasks SET dispatch_state=?, updated_at=?, updated_at_ms=? WHERE task_id=?",
                (dispatch_state, now_iso(), to_ms(now_iso()), task_id),
            )

    def add_control_audit(self, row: dict[str, Any]) -> None:
        ts = str(row.get("ts") or now_iso())
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO control_audit(task_id, action, mode, operator, reason, hard_ok, hard_error, payload_json, created_at, created_at_ms)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    row.get("task_id"),
                    row.get("action"),
                    row.get("mode"),
                    row.get("operator"),
                    row.get("reason"),
                    1 if row.get("hard_ok") else 0,
                    row.get("hard_error"),
                    json.dumps(row, ensure_ascii=False),
                    ts,
                    to_ms(ts),
                ),
            )

    def list_control_audit(self, task_id: str, limit: int = 12) -> list[dict[str, Any]]:
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT payload_json FROM control_audit
                WHERE task_id=?
                ORDER BY created_at_ms DESC
                LIMIT ?
                """,
                (task_id, int(limit)),
            ).fetchall()
        out: list[dict[str, Any]] = []
        for row in rows:
            try:
                out.append(json.loads(row["payload_json"]))
            except Exception:
                continue
        return out

    def get_stats(self, created_after: str | None = None) -> dict[str, Any]:
        where = ["is_archived=0"]
        params: list[Any] = []
        if created_after:
            where.append("created_at >= ?")
            params.append(created_after)
        where_sql = " AND ".join(where)
        with self._connect() as conn:
            row = conn.execute(
                f"""
                SELECT
                  COUNT(1) AS total,
                  SUM(CASE WHEN status='in_progress' THEN 1 ELSE 0 END) AS in_progress,
                  SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) AS completed,
                  SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) AS pending,
                  AVG(CASE WHEN progress IS NULL THEN 0 ELSE progress END) AS avg_progress
                FROM tasks
                WHERE {where_sql}
                """,
                tuple(params),
            ).fetchone()

        return {
            "total_tasks": int(row["total"] or 0),
            "in_progress_tasks": int(row["in_progress"] or 0),
            "completed_tasks": int(row["completed"] or 0),
            "pending_tasks": int(row["pending"] or 0),
            "avg_progress": round(float(row["avg_progress"] or 0.0), 1),
        }

    def upsert_review_task(self, payload: dict[str, Any]) -> None:
        review_id = str(payload.get("review_id") or "").strip()
        if not review_id:
            return
        ts = str(payload.get("updated_at") or now_iso())
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO review_tasks(review_id, title, incident_key, status, review_pool, assigned_to, created_at, updated_at, updated_at_ms, payload_json)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(review_id) DO UPDATE SET
                    title=excluded.title,
                    incident_key=excluded.incident_key,
                    status=excluded.status,
                    review_pool=excluded.review_pool,
                    assigned_to=excluded.assigned_to,
                    updated_at=excluded.updated_at,
                    updated_at_ms=excluded.updated_at_ms,
                    payload_json=excluded.payload_json
                """,
                (
                    review_id,
                    str(payload.get("title") or review_id),
                    str(payload.get("incident_key") or ""),
                    str(payload.get("status") or "pending"),
                    str(payload.get("review_pool") or "review_pool"),
                    str(payload.get("assigned_to") or ""),
                    str(payload.get("created_at") or ts),
                    ts,
                    to_ms(ts),
                    json.dumps(payload, ensure_ascii=False),
                ),
            )

    def get_review_task(self, review_id: str) -> dict[str, Any] | None:
        with self._connect() as conn:
            row = conn.execute("SELECT payload_json FROM review_tasks WHERE review_id=?", (review_id,)).fetchone()
        if not row:
            return None
        try:
            return json.loads(row["payload_json"])
        except Exception:
            return None

    def find_active_review_by_incident(self, incident_key: str) -> dict[str, Any] | None:
        if not incident_key:
            return None
        with self._connect() as conn:
            row = conn.execute(
                """
                SELECT payload_json FROM review_tasks
                WHERE incident_key=? AND status NOT IN ('completed', 'rejected', 'cancelled')
                ORDER BY updated_at_ms DESC
                LIMIT 1
                """,
                (incident_key,),
            ).fetchone()
        if not row:
            return None
        try:
            return json.loads(row["payload_json"])
        except Exception:
            return None

    def list_review_tasks(self, review_pool: str | None = None) -> list[dict[str, Any]]:
        sql = "SELECT payload_json FROM review_tasks"
        params: list[Any] = []
        if review_pool:
            sql += " WHERE review_pool=?"
            params.append(review_pool)
        sql += " ORDER BY updated_at_ms DESC"
        with self._connect() as conn:
            rows = conn.execute(sql, tuple(params)).fetchall()
        out: list[dict[str, Any]] = []
        for row in rows:
            try:
                out.append(json.loads(row["payload_json"]))
            except Exception:
                continue
        return out

    def add_review_packet(self, review_id: str, reviewer_id: str, payload: dict[str, Any]) -> None:
        ts = now_iso()
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO review_packets(review_id, reviewer_id, payload_json, created_at, created_at_ms)
                VALUES (?, ?, ?, ?, ?)
                """,
                (review_id, reviewer_id, json.dumps(payload, ensure_ascii=False), ts, to_ms(ts)),
            )

    def list_review_packets(self, review_id: str) -> list[dict[str, Any]]:
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT payload_json FROM review_packets WHERE review_id=? ORDER BY created_at_ms ASC",
                (review_id,),
            ).fetchall()
        out: list[dict[str, Any]] = []
        for row in rows:
            try:
                out.append(json.loads(row["payload_json"]))
            except Exception:
                continue
        return out

    def upsert_change_task(self, payload: dict[str, Any]) -> None:
        change_id = str(payload.get("change_id") or "").strip()
        if not change_id:
            return
        ts = str(payload.get("updated_at") or now_iso())
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO change_tasks(change_id, title, scope, priority, status, affects_scope, created_at, updated_at, updated_at_ms, payload_json)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(change_id) DO UPDATE SET
                    title=excluded.title,
                    scope=excluded.scope,
                    priority=excluded.priority,
                    status=excluded.status,
                    affects_scope=excluded.affects_scope,
                    updated_at=excluded.updated_at,
                    updated_at_ms=excluded.updated_at_ms,
                    payload_json=excluded.payload_json
                """,
                (
                    change_id,
                    str(payload.get("title") or change_id),
                    str(payload.get("scope") or "shared"),
                    str(payload.get("priority") or "P2"),
                    str(payload.get("status") or "proposed"),
                    str(payload.get("affects_scope") or "new_tasks_only"),
                    str(payload.get("created_at") or ts),
                    ts,
                    to_ms(ts),
                    json.dumps(payload, ensure_ascii=False),
                ),
            )

    def get_change_task(self, change_id: str) -> dict[str, Any] | None:
        with self._connect() as conn:
            row = conn.execute("SELECT payload_json FROM change_tasks WHERE change_id=?", (change_id,)).fetchone()
        if not row:
            return None
        try:
            return json.loads(row["payload_json"])
        except Exception:
            return None

    def list_change_tasks(self) -> list[dict[str, Any]]:
        with self._connect() as conn:
            rows = conn.execute("SELECT payload_json FROM change_tasks ORDER BY updated_at_ms DESC").fetchall()
        out: list[dict[str, Any]] = []
        for row in rows:
            try:
                out.append(json.loads(row["payload_json"]))
            except Exception:
                continue
        return out
