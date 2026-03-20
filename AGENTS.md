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
- Task list trust summary is derived from `/api/tasks` list fields (runtime + live_freshness + gate fields); do not add per-task detail calls.
- Workflow designer is the primary team-state-machine editor.
- Architecture graph and inter-team graph layouts are persisted through dedicated layout APIs; do not reintroduce hardcoded static positions as the only rendering path.
- Graph editing for `architecture`, `inter-team-flow`, and `team-workflow` now uses draft-based APIs. Do not write live config directly from the frontend. The intended path is: draft -> submit to Luban -> implementation result -> confirm apply.
- The three graph surfaces also support direct `图上连线模式`, but it still only edits the draft graph. Do not bypass the Luban submit/confirm path when wiring new UI.
- `图上连线模式` now supports drag-wire interaction from a node's right-side connector handle. Keep click-source-then-click-target as a fallback, but do not remove drag-wire support.
- Architecture object detail must route to the current main paths only: team tasks, inter-team flow, and team workflow. Do not send users back to governance center or top-level advanced config from the graph context panel.
- Team management center is a single consolidated page; do not restore `team_standalone.html` or `team_temporary.html` as active routes.
- `team_dashboard.html` remains auxiliary only and should not appear in the top-level nav of `task_dashboard.html` or `system_dashboard.html`.
- Team links rendered inside task detail must stay inside the main task center route (`task_dashboard.html?team=...`). Do not send task-center users to `team_dashboard.html` from inline team-flow links.
- Frontend redesign work may change visual language, spacing, density, node/edge presentation, and component styling, but it must not change route semantics, object semantics, graph-edit lifecycle, or the two-core-surface product structure.
- Task closure fields are service-layer truth. Do not recompute `closure_state`, `closure_reason`, or recommended actions in the frontend.
- `POST /api/tasks/{id}/apply-recommended-action` is reserved for low-risk zero-input actions only. Manual-confirm flows stay in explicit task-detail forms.
- Inter-team flow right panel now supports direct handoff confirmation for `ready_for_handoff` tasks; keep it as a focused single-task action, not a second full task center.
- Inter-team flow right panel now includes explicit queue sections for related, blocked, handoff-ready, and recovery-candidate tasks. Keep those queues lightweight and route into `task_dashboard.html` for full handling.
- Graph-edit right panels now need to expose current version, pending version, and added/removed edge summaries. Do not collapse this back to a single summary string.
- Graph-edit right panels also expose `当前版本结构` / `待确认版本结构` / `最近一次实施结果`. Keep this richer diff context visible before `确认应用`.
- `submit-to-luban` now writes a real Luban bridge request under the Luban workspace, auto-dispatches a real runtime `openclaw agent --agent luban` trigger when running against the real `~/.openclaw` base dir, and graph-edit payload loading auto-ingests Luban result files when they appear. `record-implementation` remains a fallback bridge, not the primary dashboard path.
- Dedicated manual closure endpoints now exist and should remain explicit task-detail operations:
  - `POST /api/tasks/{id}/request-business-input`
  - `POST /api/tasks/{id}/assign-owner`
  - `POST /api/tasks/{id}/confirm-handoff`
  - `POST /api/tasks/{id}/return-to-rework-owner`
- Dedicated graph-edit endpoints now exist and should remain the only graph-implementation path:
  - `GET /api/graph-edit/{kind}/{target_id}`
  - `POST /api/graph-edit/{kind}/{target_id}/validate`
  - `POST /api/graph-edit/{kind}/{target_id}/submit-to-luban`
  - `GET /api/graph-edit/{kind}/{target_id}/implementation`
  - `POST /api/graph-edit/{kind}/{target_id}/record-implementation`
  - `POST /api/graph-edit/{kind}/{target_id}/confirm-apply`
  - `POST /api/graph-edit/{kind}/{target_id}/discard-draft`
- Task-detail manual closure UX now uses inline defaults, validation, and page-level result feedback. Do not regress it back to alert-only interaction.
- `team_dashboard.html` is an auxiliary page only. The core product route is still:
  - `task_dashboard.html`
  - `system_dashboard.html`
- Raw config editing is expert mode only.
- Treat this repo as the source of truth, then sync runtime code to `/Users/tianshuai/.openclaw/workspace/dashboard-live` with `scripts/deploy_local.sh` for launchd.
- Update `docs/handovers/` and relevant `docs/plans/` when behavior changes.

## Primary Entry Points
- `server.py`
- `task_repository.py`
- `task_dashboard.html`
- `system_dashboard.html`
- `team_dashboard.html`
- `static/task_dashboard_utils.js`
- `static/workflow_designer_model.js`
- `scripts/control_plane_smoke.sh`

## Current Workflows

- Local dev server: `./start.sh 8888`
- Deploy to runtime copy: `./scripts/deploy_local.sh`
- Core backend tests: `python3 -m unittest tests/test_dashboard_data_service.py tests/test_runtime_paths.py`
- Graph layout tests: `python3 -m unittest tests/test_fastapi_layouts.py tests/test_fastapi_static.py`
- Closure regression tests: `python3 -m unittest tests/test_dashboard_data_service.py tests/test_fastapi_tasks.py tests/test_task_dashboard_bundle.py`
- System structure tests: `python3 -m unittest tests/test_system_dashboard_bundle.py tests/test_system_advanced_config_module.py`
- Smoke baseline: `API_BASE=http://localhost:8888 ./scripts/control_plane_smoke.sh`
  - Cleanup must only target Playwright/browser processes bound to active daemon sessions. Do not broaden cleanup back to generic work-dir process matching.
- Shared frontend GET timeout is intentionally higher than before because `system_dashboard.html` bootstraps several concurrent requests against a mostly serial local service layer. Do not reduce it back to 12s unless the load path is redesigned.

## Architecture Upgrade Docs

Follow these before changing the service stack:
- `docs/plans/2026-03-16-architecture-upgrade-design.md`
- `docs/plans/2026-03-16-architecture-upgrade-implementation-plan.md`
