# OpenClaw Dashboard Control Plane

This repository contains the dashboard/control-plane project only.

It does **not** vendor the OpenClaw runtime. Real data stays external and is read through environment-configured paths:
- `OPENCLAW_BASE_DIR=/Users/tianshuai/.openclaw`
- `OPENCLAW_WORKSPACE=/Users/tianshuai/.openclaw/workspace`

## Dependencies

```bash
cd /Users/tianshuai/Documents/GitHub/OpenClaw-Dashboard-Control-Plane
python3 -m pip install -r requirements.txt
```

## Quick Start

```bash
cd /Users/tianshuai/Documents/GitHub/OpenClaw-Dashboard-Control-Plane
OPENCLAW_BASE_DIR=/Users/tianshuai/.openclaw \
OPENCLAW_WORKSPACE=/Users/tianshuai/.openclaw/workspace \
./start.sh 8888
```

Or directly:

```bash
cd /Users/tianshuai/Documents/GitHub/OpenClaw-Dashboard-Control-Plane
OPENCLAW_BASE_DIR=/Users/tianshuai/.openclaw \
OPENCLAW_WORKSPACE=/Users/tianshuai/.openclaw/workspace \
python3 -m uvicorn app.main:app --host 0.0.0.0 --port 8888
```

## Main Pages

- `http://localhost:8888/task_dashboard.html`
- `http://localhost:8888/system_dashboard.html`
- `http://localhost:8888/team_dashboard.html`
- `http://localhost:8888/schedule_dashboard.html`

## Repository Scope

Included here:
- dashboard backend and UI
- tests
- static frontend modules
- architecture / PRD / handover docs
- browser smoke script

Excluded from this repo:
- agents
- gateway runtime
- memory
- logs
- secrets
- credentials
- workspaces

## Development Workflow

- Treat this repository as the only dashboard development entrypoint.
- Keep `.openclaw` as the external runtime and data source.
- Do not hardcode repo-internal assumptions about running from `.openclaw/workspace/dashboard`.
- Update `docs/README.md`, `docs/handovers/`, and relevant `docs/plans/` when behavior changes.

## Verification

Unit tests:

```bash
cd /Users/tianshuai/Documents/GitHub/OpenClaw-Dashboard-Control-Plane
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest tests/test_dashboard_data_service.py tests/test_runtime_paths.py
```

Browser smoke:

```bash
cd /Users/tianshuai/Documents/GitHub/OpenClaw-Dashboard-Control-Plane
API_BASE=http://localhost:8888 ./scripts/control_plane_smoke.sh
```

## launchd Example

An example plist lives at:
- `deploy/ai.openclaw.dashboard.example.plist`

Copy and adapt it instead of editing system launch config blindly.
