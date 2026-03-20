# OpenClaw Dashboard Control Plane

This repository contains the dashboard/control-plane project only.

It does not vendor the OpenClaw runtime. Real data stays external and is read through environment-configured paths:
- `OPENCLAW_BASE_DIR=/Users/tianshuai/.openclaw`
- `OPENCLAW_WORKSPACE=/Users/tianshuai/.openclaw/workspace`

## Main Product Surfaces

Core work surfaces:
- `http://localhost:8888/task_dashboard.html`
- `http://localhost:8888/system_dashboard.html`

Auxiliary direct-link page:
- `http://localhost:8888/team_dashboard.html`

Frozen / non-core pages:
- `schedule.html`
- `schedule_dashboard.html`
- `system_overview.html`
- `index_old.html`

Only `task_dashboard.html` and `system_dashboard.html` are part of the current main product route. `team_dashboard.html` remains an auxiliary page and must not be treated as a third core workspace.

If another AI or frontend engineer is redesigning the UI, treat `docs/plans/2026-03-20-frontend-visual-redesign-brief.md` as the required boundary document before changing visuals.

## What Each Core Surface Does

### Task center
Use it to:
- inspect tasks, reviews, changes, and recovery objects
- inspect closure state and blocking reasons
- execute low-risk recommended actions
- execute manual closure actions
- inspect audit history and artifacts

### System architecture center
Use it to:
- inspect architecture relationships
- inspect inter-team flow
- inspect team workflow
- inspect flow detail
- inspect layout and structure problems

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
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest tests/test_dashboard_data_service.py tests/test_fastapi_tasks.py tests/test_system_dashboard_bundle.py
```

Browser smoke:

```bash
cd /Users/tianshuai/Documents/GitHub/OpenClaw-Dashboard-Control-Plane
API_BASE=http://localhost:8888 ./scripts/control_plane_smoke.sh
```

The expected smoke result is `smoke_ok`.

## Local Deployment Copy

macOS `launchd` should not run directly from `Documents/...` because background agents can hit TCC permission failures there.

Use the repo as the development source, then sync a local deployment copy under `.openclaw`:

```bash
cd /Users/tianshuai/Documents/GitHub/OpenClaw-Dashboard-Control-Plane
./scripts/deploy_local.sh
```

Default deployment target:
- `/Users/tianshuai/.openclaw/workspace/dashboard-live`

## launchd Example

An example plist lives at:
- `deploy/ai.openclaw.dashboard.example.plist`

It is written to run the `.openclaw/workspace/dashboard-live` deployment copy, not the repo path in `Documents/`.
