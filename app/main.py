from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from fastapi import Body, FastAPI, Query
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from dashboard_runtime import resolve_runtime_config
from server import DashboardDataService, now_iso

app = FastAPI()

RUNTIME = resolve_runtime_config()
SERVICE = DashboardDataService(
    base_dir=RUNTIME.base_dir,
    workspace_dir=RUNTIME.workspace_dir,
)

ROOT_DIR = Path(__file__).resolve().parents[1]
STATIC_DIR = ROOT_DIR / "static"

app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


def _page(name: str) -> FileResponse:
    return FileResponse(str(ROOT_DIR / name))


@app.get("/api/health")
async def health() -> dict[str, str]:
    return {
        "status": "ok",
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }


@app.get("/api/tasks")
async def list_tasks(
    status: Optional[str] = Query(default=None),
    team: Optional[str] = Query(default=None),
    owner: Optional[str] = Query(default=None),
    dispatch_state: Optional[str] = Query(default=None),
    task_pool: Optional[str] = Query(default=None),
    include_history: bool = Query(default=False),
    since: Optional[str] = Query(default=None),
    limit: Optional[int] = Query(default=None),
    offset: int = Query(default=0),
    sort: str = Query(default="updated_at_ms"),
    order: str = Query(default="desc"),
) -> dict[str, Any]:
    return SERVICE.get_tasks(
        status_filter=status,
        team=team,
        owner=owner,
        dispatch_state=dispatch_state,
        task_pool=task_pool,
        include_history=include_history,
        since=since,
        limit=limit,
        offset=offset,
        sort=sort,
        order=order,
    )


@app.post("/api/tasks")
async def create_task(payload: dict[str, Any] = Body(default_factory=dict)) -> dict[str, Any]:
    return SERVICE.create_task(
        payload=payload,
        actor_id=payload.get("actor_id") or payload.get("operator"),
        actor_role=payload.get("actor_role") or payload.get("operator_role"),
    )


@app.get("/api/task/detail")
async def get_task_detail(task_id: str) -> dict[str, Any]:
    return SERVICE.get_task_detail(task_id)


@app.get("/api/task/chat-link")
async def get_task_chat_link(task_id: str) -> dict[str, Any]:
    return SERVICE.get_task_chat_link(task_id)


@app.post("/api/task/control")
async def control_task(payload: dict[str, Any] = Body(default_factory=dict)) -> dict[str, Any]:
    return SERVICE.control_task(
        task_id=payload.get("task_id"),
        action=payload.get("action"),
        operator=payload.get("operator"),
        reason=payload.get("reason"),
        async_mode=bool(payload.get("async")),
        operator_role=payload.get("operator_role"),
    )


@app.get("/api/task/control-status")
async def task_control_status(job_id: str) -> dict[str, Any]:
    return SERVICE.get_task_control_status(job_id)


@app.post("/api/task/delete")
async def delete_task(payload: dict[str, Any] = Body(default_factory=dict)) -> dict[str, Any]:
    return SERVICE.delete_task(
        task_id=payload.get("task_id"),
        operator=payload.get("operator"),
        reason=payload.get("reason"),
        operator_role=payload.get("operator_role"),
    )


@app.get("/api/stats")
async def get_stats(include_history: bool = Query(default=False)) -> dict[str, Any]:
    return SERVICE.get_stats(include_history=include_history)


@app.get("/api/unclaimed-tasks")
async def get_unclaimed_tasks() -> dict[str, Any]:
    return SERVICE.get_unclaimed_tasks()


@app.get("/api/task-pools")
async def get_task_pools() -> dict[str, Any]:
    return SERVICE.get_task_pools()


@app.post("/api/tasks/{task_id}/claim")
async def claim_task(task_id: str, payload: dict[str, Any] = Body(default_factory=dict)) -> dict[str, Any]:
    return SERVICE.claim_task(
        task_id=task_id,
        actor_id=payload.get("actor_id"),
        actor_role=payload.get("actor_role"),
        actor_team=payload.get("actor_team"),
    )


@app.post("/api/tasks/{task_id}/dispatch-suggest")
async def dispatch_suggest(task_id: str, payload: dict[str, Any] = Body(default_factory=dict)) -> dict[str, Any]:
    return SERVICE.dispatch_suggest(
        task_id=task_id,
        actor_id=payload.get("actor_id"),
        actor_role=payload.get("actor_role"),
    )


@app.post("/api/tasks/{task_id}/dispatch-confirm")
async def dispatch_confirm(task_id: str, payload: dict[str, Any] = Body(default_factory=dict)) -> dict[str, Any]:
    return SERVICE.dispatch_confirm(
        task_id=task_id,
        actor_id=payload.get("actor_id"),
        actor_role=payload.get("actor_role"),
        confirm=bool(payload.get("confirm", True)),
        assigned_to=payload.get("assigned_to"),
        assigned_team=payload.get("assigned_team"),
        reason=payload.get("reason"),
    )


@app.post("/api/tasks/{task_id}/artifact")
async def add_task_artifact(task_id: str, payload: dict[str, Any] = Body(default_factory=dict)) -> dict[str, Any]:
    artifact = payload.get("artifact") if isinstance(payload.get("artifact"), dict) else payload
    return SERVICE.add_task_artifact(
        task_id=task_id,
        actor_id=payload.get("actor_id"),
        actor_role=payload.get("actor_role"),
        artifact=artifact,
    )


@app.post("/api/tasks/{task_id}/stage/{stage_id}/handoff")
async def handoff_stage(task_id: str, stage_id: str, payload: dict[str, Any] = Body(default_factory=dict)) -> dict[str, Any]:
    return SERVICE.handoff_stage(
        task_id=task_id,
        stage_id=stage_id,
        actor_id=payload.get("actor_id"),
        actor_role=payload.get("actor_role"),
        handoff_note=payload.get("handoff_note"),
        artifact_summary=payload.get("artifact_summary"),
        next_owner=payload.get("next_owner"),
    )


@app.post("/api/tasks/{task_id}/apply-recommended-action")
async def apply_recommended_action(task_id: str, payload: dict[str, Any] = Body(default_factory=dict)) -> dict[str, Any]:
    return SERVICE.apply_recommended_action(
        task_id=task_id,
        actor_id=payload.get("actor_id"),
        actor_role=payload.get("actor_role"),
    )


@app.get("/api/teams")
async def list_teams() -> dict[str, Any]:
    return SERVICE.get_teams()


@app.get("/api/standalone-agents")
async def list_standalone_agents() -> dict[str, Any]:
    return SERVICE.get_standalone_agents()


@app.get("/api/temporary-agents")
async def list_temporary_agents() -> dict[str, Any]:
    return SERVICE.get_temporary_agents()


@app.get("/api/architecture")
async def get_architecture() -> dict[str, Any]:
    return SERVICE.get_architecture()


@app.get("/api/architecture/layout")
async def get_architecture_layout() -> dict[str, Any]:
    return SERVICE.get_graph_layout("architecture")


@app.put("/api/architecture/layout")
async def put_architecture_layout(payload: dict[str, Any] = Body(default_factory=dict)) -> dict[str, Any]:
    return SERVICE.save_graph_layout("architecture", payload)


@app.get("/api/flows")
async def get_flows() -> dict[str, Any]:
    return SERVICE.get_flows()


@app.get("/api/inter-team-flow/layout")
async def get_inter_team_flow_layout() -> dict[str, Any]:
    return SERVICE.get_graph_layout("inter_team_flow")


@app.put("/api/inter-team-flow/layout")
async def put_inter_team_flow_layout(payload: dict[str, Any] = Body(default_factory=dict)) -> dict[str, Any]:
    return SERVICE.save_graph_layout("inter_team_flow", payload)


@app.get("/api/flow/detail")
async def get_flow_detail(flow_id: str) -> dict[str, Any]:
    return SERVICE.get_flow_detail(flow_id)


@app.get("/api/runtime-versions")
async def get_runtime_versions() -> dict[str, Any]:
    return SERVICE.get_runtime_versions()


@app.get("/api/reviews")
async def list_reviews(review_pool: Optional[str] = None) -> dict[str, Any]:
    return {"reviews": SERVICE.list_review_tasks(review_pool), "updated_at": now_iso()}


@app.get("/api/reviews/{review_id}")
async def get_review(review_id: str) -> dict[str, Any]:
    return SERVICE.get_review_task(review_id)


@app.get("/api/change-tasks")
async def list_change_tasks() -> dict[str, Any]:
    return {"changes": SERVICE.list_change_tasks(), "updated_at": now_iso()}


@app.get("/api/change-tasks/{change_id}")
async def get_change_task(change_id: str) -> dict[str, Any]:
    detail = SERVICE.get_change_task(change_id)
    if detail is None:
        return {"error": "change not found"}
    return detail


@app.get("/api/config/team-state-machines")
async def get_team_state_machines() -> dict[str, Any]:
    return SERVICE.get_config_doc("team-state-machines")


@app.get("/")
async def index_html() -> FileResponse:
    return _page("index.html")


@app.get("/task_dashboard.html")
async def task_dashboard_html() -> FileResponse:
    return _page("task_dashboard.html")


@app.get("/system_dashboard.html")
async def system_dashboard_html() -> FileResponse:
    return _page("system_dashboard.html")


@app.get("/team_dashboard.html")
async def team_dashboard_html() -> FileResponse:
    return _page("team_dashboard.html")
