# Architecture Upgrade Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Introduce a FastAPI service layer and static compatibility path while preserving existing control-plane APIs and UI entrypoints.

**Architecture:** Add a new FastAPI app that wraps the existing data/service layer, serve legacy static assets, and keep `server.py` as rollback. UI modularization happens after API parity is stable.

**Tech Stack:** Python 3.9+, FastAPI, Uvicorn, existing HTML/JS, SQLite via `task_repository.py`.

---

### Task 1: Add FastAPI app skeleton and health endpoint

**Files:**
- Create: `app/__init__.py`
- Create: `app/main.py`
- Create: `tests/test_fastapi_health.py`

**Step 1: Write the failing test**

```python
import unittest
from fastapi.testclient import TestClient

from app.main import app

class TestFastAPIHealth(unittest.TestCase):
    def test_health_endpoint(self):
        client = TestClient(app)
        response = client.get("/api/health")
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["status"], "ok")
        self.assertIn("updated_at", payload)
```

**Step 2: Run test to verify it fails**

Run: `python3 -m unittest tests/test_fastapi_health.py`
Expected: FAIL with import or route missing

**Step 3: Write minimal implementation**

```python
from datetime import datetime, timezone
from fastapi import FastAPI

app = FastAPI()

@app.get("/api/health")
async def health():
    return {
        "status": "ok",
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
```

**Step 4: Run test to verify it passes**

Run: `python3 -m unittest tests/test_fastapi_health.py`
Expected: PASS

**Step 5: Commit**

```bash
git add app/__init__.py app/main.py tests/test_fastapi_health.py
git commit -m "feat: add FastAPI health endpoint"
```

---

### Task 2: Add `/api/tasks` endpoint wrapper

**Files:**
- Modify: `app/main.py`
- Create: `tests/test_fastapi_tasks.py`

**Step 1: Write the failing test**

```python
import unittest
from fastapi.testclient import TestClient

from app.main import app

class TestFastAPITasks(unittest.TestCase):
    def test_tasks_endpoint_returns_payload(self):
        client = TestClient(app)
        response = client.get("/api/tasks")
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertIn("tasks", payload)
```

**Step 2: Run test to verify it fails**

Run: `python3 -m unittest tests/test_fastapi_tasks.py`
Expected: FAIL with 404

**Step 3: Write minimal implementation**

```python
from server import DashboardDataService
from dashboard_runtime import resolve_runtime_config

RUNTIME = resolve_runtime_config()
SERVICE = DashboardDataService(
    base_dir=RUNTIME.base_dir,
    workspace_dir=RUNTIME.workspace_dir,
    cache_ttl_seconds=RUNTIME.cache_ttl_seconds,
)

@app.get("/api/tasks")
async def list_tasks():
    return SERVICE.get_tasks()
```

**Step 4: Run test to verify it passes**

Run: `python3 -m unittest tests/test_fastapi_tasks.py`
Expected: PASS

**Step 5: Commit**

```bash
git add app/main.py tests/test_fastapi_tasks.py
git commit -m "feat: add FastAPI tasks endpoint"
```

---

### Task 3: Add review/change/config endpoints

**Files:**
- Modify: `app/main.py`
- Create: `tests/test_fastapi_governance.py`

**Step 1: Write the failing test**

```python
import unittest
from fastapi.testclient import TestClient

from app.main import app

class TestFastAPIGovernance(unittest.TestCase):
    def test_reviews_endpoint(self):
        client = TestClient(app)
        response = client.get("/api/reviews")
        self.assertEqual(response.status_code, 200)
        self.assertIn("reviews", response.json())

    def test_change_tasks_endpoint(self):
        client = TestClient(app)
        response = client.get("/api/change-tasks")
        self.assertEqual(response.status_code, 200)
        self.assertIn("changes", response.json())

    def test_team_state_machines_endpoint(self):
        client = TestClient(app)
        response = client.get("/api/config/team-state-machines")
        self.assertEqual(response.status_code, 200)
        self.assertIn("doc", response.json())
```

**Step 2: Run test to verify it fails**

Run: `python3 -m unittest tests/test_fastapi_governance.py`
Expected: FAIL with 404

**Step 3: Write minimal implementation**

```python
@app.get("/api/reviews")
async def list_reviews():
    return {"reviews": SERVICE.list_review_tasks(None), "updated_at": now_iso()}

@app.get("/api/change-tasks")
async def list_change_tasks():
    return {"changes": SERVICE.list_change_tasks(), "updated_at": now_iso()}

@app.get("/api/config/team-state-machines")
async def get_team_state_machines():
    return SERVICE.get_config_doc("team-state-machines")
```

**Step 4: Run test to verify it passes**

Run: `python3 -m unittest tests/test_fastapi_governance.py`
Expected: PASS

**Step 5: Commit**

```bash
git add app/main.py tests/test_fastapi_governance.py
git commit -m "feat: add FastAPI review/change/config endpoints"
```

---

### Task 4: Serve static assets and legacy entrypoints

**Files:**
- Modify: `app/main.py`
- Create: `tests/test_fastapi_static.py`

**Step 1: Write the failing test**

```python
import unittest
from fastapi.testclient import TestClient

from app.main import app

class TestFastAPIStatic(unittest.TestCase):
    def test_task_dashboard_html(self):
        client = TestClient(app)
        response = client.get("/task_dashboard.html")
        self.assertEqual(response.status_code, 200)
        self.assertIn("任务管理中心", response.text)
```

**Step 2: Run test to verify it fails**

Run: `python3 -m unittest tests/test_fastapi_static.py`
Expected: FAIL with 404

**Step 3: Write minimal implementation**

```python
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
STATIC_DIR = ROOT / "static"

app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

@app.get("/task_dashboard.html")
async def task_dashboard_html():
    return FileResponse(str(ROOT / "task_dashboard.html"))

@app.get("/system_dashboard.html")
async def system_dashboard_html():
    return FileResponse(str(ROOT / "system_dashboard.html"))

@app.get("/")
async def index_html():
    return FileResponse(str(ROOT / "index.html"))
```

**Step 4: Run test to verify it passes**

Run: `python3 -m unittest tests/test_fastapi_static.py`
Expected: PASS

**Step 5: Commit**

```bash
git add app/main.py tests/test_fastapi_static.py
git commit -m "feat: serve legacy static entrypoints"
```

---

### Task 5: Update start script and README for FastAPI

**Files:**
- Modify: `start.sh`
- Modify: `README.md`

**Step 1: Update start script**

Replace `python3 server.py` with `python3 -m uvicorn app.main:app --host 0.0.0.0 --port "$PORT"`.

**Step 2: Update README**

Add install step for `requirements.txt` and FastAPI run command.

**Step 3: Verify manual run**

Run: `./start.sh 8888`
Expected: console shows FastAPI running and `/api/health` reachable.

**Step 4: Commit**

```bash
git add start.sh README.md
git commit -m "chore: run dashboard via FastAPI"
```

---

### Task 6: Update documentation index and handover

**Files:**
- Modify: `docs/README.md`
- Modify: `docs/handovers/2026-03-15-control-plane-handover.md`

**Step 1: Update docs index**

Add:
- `2026-03-16-architecture-upgrade-design.md`
- `2026-03-16-architecture-upgrade-implementation-plan.md`

**Step 2: Update handover**

Record:
- new FastAPI entrypoint
- static serving behavior
- any known residuals

**Step 3: Commit**

```bash
git add docs/README.md docs/handovers/2026-03-15-control-plane-handover.md
git commit -m "docs: record architecture upgrade plan"
```
