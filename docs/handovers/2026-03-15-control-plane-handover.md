# OpenClaw Control Plane Handover

## Purpose

This document is for the next AI continuing work on the current OpenClaw control plane.

Read this before changing runtime behavior.

## Repository boundary

This repository is dashboard-only.

External runtime stays outside the repo:
- `OPENCLAW_BASE_DIR=/Users/tianshuai/.openclaw`
- `OPENCLAW_WORKSPACE=/Users/tianshuai/.openclaw/workspace`

Do not copy runtime state, agent workspaces, memory, secrets, or logs into the repo.

## Deployment note

Development source:
- `/Users/tianshuai/Documents/GitHub/OpenClaw-Dashboard-Control-Plane`

Always-on local runtime copy:
- `/Users/tianshuai/.openclaw/workspace/dashboard-live`

Refresh deployment copy with:

```bash
cd /Users/tianshuai/Documents/GitHub/OpenClaw-Dashboard-Control-Plane
./scripts/deploy_local.sh
launchctl kickstart -k gui/$(id -u)/ai.openclaw.dashboard
```

## Current product structure

Only two pages are core product surfaces:
- `任务中心`
- `系统架构中心`

### Task center
Use it for:
- task visibility
- closure state
- review/change/recovery object handling
- recommended actions
- manual closure actions
- artifact and audit visibility

Primary route:
- `task_dashboard.html`

### System architecture center
Use it for:
- architecture map
- inter-team flow
- team workflow
- flow detail

Primary route:
- `system_dashboard.html`

### Non-core pages
These pages are not part of the main product route:
- `team_dashboard.html`: auxiliary team view only
- `schedule.html`: frozen
- `schedule_dashboard.html`: frozen
- `system_overview.html`: frozen
- `index_old.html`: frozen

Do not describe them as current main entrypoints.

## What is already implemented

### 1. Stable orchestration objects
Implemented and in live runtime:
- `task`
- `stage_card`
- `review_task`
- `change_task`
- `artifact_index`
- `control_audit`

Primary files:
- `server.py`
- `task_repository.py`

### 2. Task center
Implemented in runtime page:
- live task/review/change visibility
- closure fields and blocking reasons
- recommended-action visibility
- low-risk `apply-recommended-action`
- manual closure action endpoints and task-detail hooks
- audit/result summary visibility
- team filtering and team-focus filtering

Primary file:
- `task_dashboard.html`
- `static/task_dashboard_utils.js`

### 3. System architecture center
Implemented in runtime page:
- architecture map
- inter-team flow
- team workflow
- flow detail
- interactive layout on architecture map
- interactive layout on inter-team flow map
- graph-edit draft mode on architecture / inter-team flow / team workflow
- submit-to-luban / implementation-view / confirm-apply loop for graph edits
- right-side detail panels
- team/task cross-links into task center

Primary file:
- `system_dashboard.html`
- `frontend/system/index.ts`

### 4. Flow layers
Implemented as two separate layers:
- inter-team flow: team to team
- team workflow: role to role

Current main inter-team flow:
- `inter-team:default`

### 5. Closure engine, first working version
Current fields are already exposed in runtime objects:
- `closure_state`
- `closure_reason`
- `next_recommended_action`
- `next_recommended_owner`
- `requires_manual_confirm`
- `recovery_reason`
- `recovery_priority`

Low-risk action endpoint:
- `POST /api/tasks/{task_id}/apply-recommended-action`

Manual action endpoints now exist:
- `POST /api/tasks/{id}/request-business-input`
- `POST /api/tasks/{id}/assign-owner`
- `POST /api/tasks/{id}/confirm-handoff`
- `POST /api/tasks/{id}/return-to-rework-owner`

## Current route truth

### Task center
- `task_dashboard.html`
- `task_dashboard.html?task_id=<id>`
- `task_dashboard.html?pool=<pool>`
- `task_dashboard.html?team=<team_id>`
- `task_dashboard.html?team=<team_id>&team_focus=<blocked|handoff|recovery>`
- `task_dashboard.html?inter_team_flow=inter-team:default`

### System architecture center
- `system_dashboard.html?subview=architecture`
- `system_dashboard.html?subview=inter-team-flow`
- `system_dashboard.html?subview=team-workflow&target_type=team&target_id=<team_id>`
- `system_dashboard.html?subview=flow-detail&flow_id=<id>&flow_kind=<inter-team|team>`

## Live behavior verified recently

Verified against `http://localhost:8888`:
- task dashboard renders closure panel in task detail
- low-risk recommended action endpoint works
- manual closure endpoints are registered and callable
- manual closure forms now render inline defaults and page-level result feedback instead of relying only on alert popups
- architecture map supports drag and layout persistence
- architecture map supports draft relationship editing and Luban submission
- architecture / inter-team flow / team workflow all support `图上连线模式` for draft edge creation
- architecture / inter-team flow / team workflow now support drag-wire connection from the node-side connector handle; click-source-then-click-target remains as fallback
- architecture object detail now routes only to current main paths: team tasks, inter-team flow, and team workflow
- task dashboard and system dashboard top nav no longer surface `team_dashboard.html`; team page stays auxiliary and direct-link only
- team links rendered inside task detail now stay in the task center route (`task_dashboard.html?team=...`) instead of bouncing users into the auxiliary team page
- inter-team flow defaults to all-team relationship view
- inter-team flow supports graph draft editing, implementation status, and confirm-apply
- inter-team right panel can directly confirm handoff for `ready_for_handoff` tasks
- inter-team right panel now also renders explicit task queues for related tasks, blocked tasks, handoff-ready tasks, and recovery candidates, with direct links back to task detail
- graph-edit right panels now show `当前版本 / 待确认版本 / 草稿差异` and explicit added/removed edge summaries instead of only a single summary sentence
- graph-edit right panels now also show `当前版本结构 / 待确认版本结构 / 最近一次实施结果`, so confirmation is based on a visible structure diff instead of only summary text
- graph-edit structure cards now include `关系预览` with inline `新增 / 删除 / 保留` badges, so users can see edge-level differences without reading only counts and summary text
- graph-edit submission now writes a Luban bridge request file into the Luban workspace, auto-triggers a real `openclaw agent --agent luban` dispatch in runtime, and graph-edit payload refresh auto-ingests Luban result files into the latest `change_task`; manual `record-implementation` is now only a fallback path
- graph-edit right panels now also show `投递状态`, so users can distinguish `未投递 / 等待鲁班处理 / 鲁班投递失败` instead of inferring dispatch state only from implementation status
- team workflow supports graph draft editing, implementation status, confirm-apply, and role-node drag repositioning
- flow detail stays compressed to summary / structure / validation / linked tasks
- task-detail manual closure forms now render `预期变更` guidance, stricter inline validation, and a structured `结果摘要` card instead of relying on a single alert string
- browser smoke finishes with `smoke_ok`
- smoke cleanup now only targets Playwright/browser processes bound to active daemon sessions and no longer kills its own parent shell
- frontend GET timeout was raised to 45s because the system dashboard bootstraps with several concurrent requests against a mostly serial local service layer; 12s produced false `AbortError` page-load failures

## Current residual work

Remaining work is productization, not a new architecture phase:
1. improve task-detail forms for manual closure actions
2. improve inter-team right panel beyond single-task direct handoff into richer batch and queue workflows
3. continue improving Luban execution visibility and diff UX; the runtime bridge is now auto-dispatched, but UI can still surface dispatch status more explicitly
4. keep docs aligned with runtime structure after each change
5. keep smoke fixture-based and self-cleaning

Frontend visual redesign can proceed in parallel, but only inside the current product skeleton.

Use this brief before assigning frontend redesign work:
- `docs/plans/2026-03-20-frontend-visual-redesign-brief.md`

Hard boundary:
- only `task_dashboard.html` and `system_dashboard.html` are core work surfaces
- `team_dashboard.html` stays auxiliary only
- frontend redesign must not change route semantics, graph-edit lifecycle, or move governance actions out of the task center

## Verification baseline

Before claiming runtime changes are complete, run:

```bash
cd /Users/tianshuai/.openclaw/workspace/dashboard-live
python3 -m unittest tests.test_dashboard_data_service tests.test_fastapi_tasks tests.test_system_dashboard_bundle tests.test_fastapi_static
npm run build
API_BASE=http://localhost:8888 ./scripts/control_plane_smoke.sh
```

Expected smoke result:
- `smoke_ok`

## Do preserve

- two-core-surface product structure
- task center as the only runtime/governance operating surface
- system architecture center as the only structure/flow operating surface
- inter-team flow and team workflow as separate layers
- stable core object semantics
- fixture-based smoke and tagged test data

## Do not do

- do not reintroduce governance center as a main page
- do not reintroduce advanced config as a top-level main page
- do not treat frozen/non-core pages as product surfaces
- do not push new orchestration truth into frontend-only logic
- do not silently change object semantics in UI-only code
