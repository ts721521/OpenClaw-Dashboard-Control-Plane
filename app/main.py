from datetime import datetime, timezone

from fastapi import FastAPI

from dashboard_runtime import resolve_runtime_config
from server import DashboardDataService

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
