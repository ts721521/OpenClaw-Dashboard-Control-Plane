# Dashboard Repo Notes

## Scope
This repository contains only the OpenClaw dashboard/control-plane project.

Do not add or vendor the OpenClaw runtime into this repo. The runtime remains external:
- `OPENCLAW_BASE_DIR=/Users/tianshuai/.openclaw`
- `OPENCLAW_WORKSPACE=/Users/tianshuai/.openclaw/workspace`

## Stable Objects
Treat these as long-term stable product objects:
- `task`
- `stage_card`
- `review_task`
- `change_task`
- `artifact_index`
- `control_audit`

Do not invent parallel object models without updating the design docs in `docs/plans/`.

## Development Rules
- Frontend should access data through API/view-models, not SQLite internals.
- Business, handoff, review, and publish gates belong in the service layer.
- Workflow designer is the primary team-state-machine editor.
- Raw config editing is expert mode only.
- Update `docs/handovers/` and relevant `docs/plans/` when behavior changes.

## Primary Entry Points
- `server.py`
- `task_repository.py`
- `task_dashboard.html`
- `system_dashboard.html`
- `static/task_dashboard_utils.js`
- `static/workflow_designer_model.js`
- `scripts/control_plane_smoke.sh`
