from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from fastapi import FastAPI

from dashboard_runtime import resolve_runtime_config
from server import DashboardDataService, now_iso

app = FastAPI()

RUNTIME = resolve_runtime_config()
SERVICE = DashboardDataService(
    base_dir=RUNTIME.base_dir,
    workspace_dir=RUNTIME.workspace_dir,
)


@app.get("/api/health")
async def health() -> dict[str, str]:
    return {
        "status": "ok",
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }


@app.get("/api/tasks")
async def list_tasks() -> dict[str, object]:
    return SERVICE.get_tasks()


@app.get("/api/reviews")
async def list_reviews(review_pool: Optional[str] = None) -> dict[str, object]:
    return {"reviews": SERVICE.list_review_tasks(review_pool), "updated_at": now_iso()}


@app.get("/api/change-tasks")
async def list_change_tasks() -> dict[str, object]:
    return {"changes": SERVICE.list_change_tasks(), "updated_at": now_iso()}


@app.get("/api/config/team-state-machines")
async def get_team_state_machines() -> dict[str, object]:
    return SERVICE.get_config_doc("team-state-machines")
