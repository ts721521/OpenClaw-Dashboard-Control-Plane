# OpenClaw Dashboard AI Entry

`docs/README.md` is the entry file for anyone continuing this project.

Read this file first. It defines:
- the current product structure
- the source-of-truth docs
- the current runtime boundaries
- which pages are core and which are frozen
- how docs are classified inside `docs/`

## Current Product Structure

There are only two core work surfaces:
- `任务中心`
- `系统架构中心`

### 任务中心
Use it for:
- task visibility
- alert visibility
- closure state
- recommended actions
- manual closure actions
- review/change/recovery operations on live objects

Primary page:
- [task_dashboard.html](/Users/tianshuai/.openclaw/workspace/dashboard-live/task_dashboard.html)

### 系统架构中心
Use it for:
- architecture map
- inter-team flow
- team workflow
- flow detail

Primary page:
- [system_dashboard.html](/Users/tianshuai/.openclaw/workspace/dashboard-live/system_dashboard.html)

## Non-Core Pages

These pages are not part of the main product route. Do not treat them as core entrypoints.
- [team_dashboard.html](/Users/tianshuai/.openclaw/workspace/dashboard-live/team_dashboard.html): auxiliary team view only
- `schedule.html`: frozen
- `schedule_dashboard.html`: frozen
- `system_overview.html`: frozen
- `index_old.html`: frozen

Do not expand frozen pages unless there is an explicit design decision to bring them back.

## Read This First

1. [2026-03-15-openclaw-control-plane-architecture.md](/Users/tianshuai/.openclaw/workspace/dashboard-live/docs/plans/2026-03-15-openclaw-control-plane-architecture.md)
2. [2026-03-15-control-plane-handover.md](/Users/tianshuai/.openclaw/workspace/dashboard-live/docs/handovers/2026-03-15-control-plane-handover.md)
3. [AGENTS.md](/Users/tianshuai/.openclaw/workspace/dashboard-live/AGENTS.md)
4. [STRUCTURE.md](/Users/tianshuai/.openclaw/workspace/dashboard-live/docs/STRUCTURE.md)
5. For frontend visual redesign constraints:
   - [2026-03-20-frontend-visual-redesign-brief.md](/Users/tianshuai/.openclaw/workspace/dashboard-live/docs/plans/2026-03-20-frontend-visual-redesign-brief.md)
6. If needed for original product intent:
   - [2026-03-14-openclaw-control-plane-prd.md](/Users/tianshuai/.openclaw/workspace/dashboard-live/docs/plans/2026-03-14-openclaw-control-plane-prd.md)
   - [2026-03-14-braintrust-review-system-prd.md](/Users/tianshuai/.openclaw/workspace/dashboard-live/docs/plans/2026-03-14-braintrust-review-system-prd.md)
   - [2026-03-14-constitution-runtime-mapping-spec.md](/Users/tianshuai/.openclaw/workspace/dashboard-live/docs/plans/2026-03-14-constitution-runtime-mapping-spec.md)
   - [2026-03-14-minimal-kernel-implementation-plan.md](/Users/tianshuai/.openclaw/workspace/dashboard-live/docs/plans/2026-03-14-minimal-kernel-implementation-plan.md)

## Current Source Of Truth Map

- Current architecture and code mapping:
  - [2026-03-15-openclaw-control-plane-architecture.md](/Users/tianshuai/.openclaw/workspace/dashboard-live/docs/plans/2026-03-15-openclaw-control-plane-architecture.md)
- Current implementation status and residual gaps:
  - [2026-03-15-control-plane-handover.md](/Users/tianshuai/.openclaw/workspace/dashboard-live/docs/handovers/2026-03-15-control-plane-handover.md)
- Runtime/operator facts:
  - [AGENTS.md](/Users/tianshuai/.openclaw/workspace/dashboard-live/AGENTS.md)

Older design docs remain useful for intent, but they are not the first source of truth for current behavior.

## Runtime Boundary

This repo is dashboard-only.

External runtime remains outside the repo:
- `OPENCLAW_BASE_DIR=/Users/tianshuai/.openclaw`
- `OPENCLAW_WORKSPACE=/Users/tianshuai/.openclaw/workspace`

The always-on local service runs from the deployment copy here:
- `/Users/tianshuai/.openclaw/workspace/dashboard-live`

The GitHub repo remains the source repo for development. Refresh the local deployment copy with:

```bash
cd /Users/tianshuai/Documents/GitHub/OpenClaw-Dashboard-Control-Plane
./scripts/deploy_local.sh
launchctl kickstart -k gui/$(id -u)/ai.openclaw.dashboard
```

## Main Implementation Files

- Backend service: [server.py](/Users/tianshuai/.openclaw/workspace/dashboard-live/server.py)
- FastAPI entry: [app/main.py](/Users/tianshuai/.openclaw/workspace/dashboard-live/app/main.py)
- Task repository: [task_repository.py](/Users/tianshuai/.openclaw/workspace/dashboard-live/task_repository.py)
- Task center runtime page: [task_dashboard.html](/Users/tianshuai/.openclaw/workspace/dashboard-live/task_dashboard.html)
- System center runtime page: [system_dashboard.html](/Users/tianshuai/.openclaw/workspace/dashboard-live/system_dashboard.html)
- Shared task route helpers: [static/task_dashboard_utils.js](/Users/tianshuai/.openclaw/workspace/dashboard-live/static/task_dashboard_utils.js)
- System bundle entry: [frontend/system/index.ts](/Users/tianshuai/.openclaw/workspace/dashboard-live/frontend/system/index.ts)

## Verification Baseline

Before claiming behavior changes are complete, run:

```bash
cd /Users/tianshuai/.openclaw/workspace/dashboard-live
python3 -m unittest tests.test_dashboard_data_service tests.test_fastapi_tasks tests.test_system_dashboard_bundle
npm run build
API_BASE=http://localhost:8888 ./scripts/control_plane_smoke.sh
```

The expected smoke result is `smoke_ok`.

## Required Doc Updates After Behavior Changes

Update these files when behavior changes:
- `docs/README.md`
- affected `docs/plans/*.md`
- `docs/handovers/*.md`
- `AGENTS.md`
- `/Users/tianshuai/Volumes/GitDBS/3_第三世界/00-当前实现状态总览.md` when external-facing status changes materially
