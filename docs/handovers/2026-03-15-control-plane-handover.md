# OpenClaw Control Plane Handover

## Purpose
This document is for the next AI that will continue frontend and feature work on the OpenClaw control plane.

Read this before touching the dashboard.

## Repository boundary
This repository is dashboard-only.

External runtime stays outside the repo:
- `OPENCLAW_BASE_DIR=/Users/tianshuai/.openclaw`
- `OPENCLAW_WORKSPACE=/Users/tianshuai/.openclaw/workspace`

Do not copy runtime state, agent workspaces, memory, secrets, or logs into this repository.

## Runtime deployment note
Development happens in this GitHub repo.

The always-on local service should run from a deployment copy outside `Documents/`:
- source repo: `/Users/tianshuai/Documents/GitHub/OpenClaw-Dashboard-Control-Plane`
- deployed runtime copy: `/Users/tianshuai/.openclaw/workspace/dashboard-live`

Reason: macOS `launchd` background jobs can hit TCC `Operation not permitted` errors when executing directly from `Documents/`.

To refresh the local deployment copy after repo changes:

```bash
cd /Users/tianshuai/Documents/GitHub/OpenClaw-Dashboard-Control-Plane
./scripts/deploy_local.sh
launchctl kickstart -k gui/$(id -u)/ai.openclaw.dashboard
```

## Current intent
The system is no longer being treated as a loose dashboard. It is being turned into a control plane:
- strong rules at the task/review/change layer
- AI agents operate inside those rules
- task center is the truth source for orchestration state
- Claw remains the execution environment

## Canonical design docs
These are the documents that define the current intended model.

1. `docs/plans/2026-03-15-openclaw-control-plane-architecture.md`
2. `docs/plans/2026-03-16-architecture-upgrade-design.md`
3. `docs/plans/2026-03-16-architecture-upgrade-implementation-plan.md`
4. `docs/plans/2026-03-14-openclaw-control-plane-prd.md`
5. `docs/plans/2026-03-14-braintrust-review-system-prd.md`
6. `docs/plans/2026-03-14-constitution-runtime-mapping-spec.md`
7. `docs/plans/2026-03-14-minimal-kernel-implementation-plan.md`
8. `docs/plans/2026-03-15-team-workflow-designer-design.md`
9. `docs/plans/2026-03-15-migration-boundaries.md`

If a UI change conflicts with these documents, update the docs or do not ship the change.

## External Review Directory

External multi-AI review records for this project now belong under:

- `/Volumes/TB512/3_ClawDocs/reviews/OpenClaw-Control-Plane`
- `/Volumes/TB512/3_ClawDocs/reviews/OpenClaw-Control-Plane/reviews/20260315_093247_OpenClaw-Control-Plane-Architecture-and-Gap-Clos.md`

Repo docs hold architecture and implementation truth.
External review files hold review opinions and review conclusions.

## What has already been implemented

### 1. Minimal kernel
Implemented in backend and verified:
- SQLite-backed task store
- task pools:
  - `intake_pool`
  - `team_dispatch_pool`
  - `governance_pool`
  - `review_pool`
  - `recovery_pool`
- dispatch leases / locks
- parent task + stage card generation for complex work
- review task lifecycle
- change task lifecycle
- runtime version binding
- stalled review scanning and reclaim path

Primary files:
- `server.py`
- `task_repository.py`

### 2. Task center product layer
Implemented in task dashboard:
- task pool navigation
- review/recovery tasks visible through the task center
- review-task detail rendering
- runtime state, session link, control audit, lock visibility
- task detail is the stable frontend entrypoint; UI should not depend on SQLite shape or payload internals

Primary file:
- `task_dashboard.html`
- `static/task_dashboard_utils.js`

### 3. System/governance product layer
Implemented in system dashboard:
- top-level views now split into:
  - `系统架构关系图`
  - `治理中心`
  - `高级配置`
- architecture map now acts as the only understandable entry into advanced config:
  - click a team/member/standalone agent node
  - read object detail first
  - use `进入配置` from the object detail card
  - members fall back to their parent team config target
  - standalone agents without a linked team do not open an empty editor
- governance center now contains:
  - `变更`
  - `审查`
  - `恢复`
- advanced config now contains:
  - workflow designer as the default team state-machine editor
  - expert mode for raw team lead/team state/prompt patch/publish controls
- governance center keeps the daily operating actions:
  - change task creation / approve / publish
  - review task creation
  - review dispatch to seats
  - review reclaim
  - recovery scanning and recovery takeover
  - review detail panel
  - reviewer packet submission
  - chief decision submission
  - packet preset buttons for architect / critic / innovator

Primary file:
- `system_dashboard.html`
- `static/workflow_designer_model.js`
- governance deep-link entry now includes:
  - `system_dashboard.html?subview=architecture`
  - `system_dashboard.html?subview=architecture&object_type=<team|member|agent>&object_id=<id>`
  - `system_dashboard.html?subview=governance&governance=review&review_id=<REVIEW_ID>`
  - `system_dashboard.html?subview=governance&governance=change&change_id=<CHANGE_ID>`
  - `system_dashboard.html?subview=governance&governance=recovery`
  - `system_dashboard.html?subview=advanced-config`
  - `system_dashboard.html?subview=advanced-config&object_type=<team|member|agent>&object_id=<id>&target_type=team&target_id=<team_id>`

## Live behavior already verified
The following flows were executed against the live service on `http://localhost:8888`:
- create review task from system dashboard
- dispatch review to `braintrust_architect`
- submit reviewer packet from system dashboard
- submit chief decision from system dashboard
- switch governance center between change / review / recovery
- open `system_dashboard.html?subview=governance&governance=review&review_id=REVIEW-20260315-247957` and land directly in review governance
- open `system_dashboard.html?subview=advanced-config` and land directly in advanced config
- open `system_dashboard.html?subview=architecture`, select `team-rd`, inspect object detail, then enter filtered advanced config
- open `system_dashboard.html?subview=architecture`, select member `coordinator`, and verify fallback-to-team explanation
- open `system_dashboard.html?subview=advanced-config&object_type=team&object_id=team-rd&target_type=team&target_id=team-rd&mode=workflow-designer` and render the workflow designer instead of raw JSON
- select edge `ANALYZING -> DESIGNING`, save draft, and reopen the designer with the same graph state
- open `task_dashboard.html?task_id=TASK-20260315-815C8E` and land directly in task detail
- add artifact from task center UI
- submit stage handoff from task center UI
- run full `control_plane_smoke.sh` end-to-end and receive `smoke_ok`

## 2026-03-15 migration-safety update

- `get_tasks` and list-facing runtime views no longer block first paint on slow gateway status refresh; they return immediately and refresh live cache asynchronously.
- task-page route parsing and gate helpers moved into `static/task_dashboard_utils.js`.
- workflow-designer graph/model conversion moved into `static/workflow_designer_model.js`.
- smoke cleanup now performs session close/delete plus targeted process cleanup for session/workdir-owned Playwright/Chrome residues.

## 2026-03-16 architecture-upgrade update

- FastAPI entrypoint now exists in `app/main.py` and preserves core read-only APIs.
- Static compatibility routing is served by FastAPI (`/task_dashboard.html`, `/system_dashboard.html`, `/static/*`).
- `start.sh` now runs Uvicorn against `app.main:app` for local dev.

## 2026-03-16 frontend modularization update

- Vite multi-entry build introduced with outputs under `static/build/`.
- `task_dashboard.html` and `system_dashboard.html` now load `static/build/*.js`.
- Task dashboard logic moved to `frontend/task/` and shared helpers in `frontend/shared/`.
- System dashboard logic moved to `frontend/system/`, including workflow designer model.
- System dashboard further modularized:
  - `frontend/system/architecture.ts` (architecture map + object selection)
  - `frontend/system/governance.ts` (change/review/recovery governance)
  - `frontend/system/advanced_config.ts` (workflow designer + expert config)

## 2026-03-16 task list trust summary update

- `/api/tasks` now returns list-level trust fields:
  - `live_freshness`
  - `business_bound`
  - `business_truth_source`
  - `acceptance_result`
  - `gate_result`
- Task list cards now show a “可信度行”:
  - `运行态: <state/hint>`
  - `实时数据: <fresh|stale|unavailable>`
  - `Gate: 阻断 xN / Gate OK`
- Smoke script asserts the new list labels.

### Verification evidence
- Unit test:
  - `python3 -m unittest tests.test_dashboard_data_service.DashboardDataServiceTests.test_get_tasks_exposes_gate_and_live_freshness`
  - result: `OK`
- Full smoke run (local runtime):
  - `TASK-20260316-9EA7B4`
  - `CHANGE-20260316-8D9480`
  - `REVIEW-20260316-ADC193`

## Live review artifacts currently in the system
These are test/smoke records and may still exist:
- `REVIEW-20260315-247957`
  - title: `共享规则回归审查`
  - under review
  - has architect packet
- `REVIEW-20260315-80DA8D`
  - title: `Chief decision smoke`
  - completed
  - chief decision points to `rd_lead`
- Latest full control-plane smoke on 2026-03-15 also created:
  - `REVIEW-20260315-7AADB9`
  - `CHANGE-20260315-6153A2`
  - `TASK-20260315-ADCFD4`

Do not assume these are business tasks. They are product smoke artifacts.

## Verification baseline
Before claiming any dashboard work is complete, run:

```bash
python3 -m py_compile /Users/tianshuai/Documents/GitHub/OpenClaw-Dashboard-Control-Plane/server.py /Users/tianshuai/Documents/GitHub/OpenClaw-Dashboard-Control-Plane/task_repository.py
cd /Users/tianshuai/Documents/GitHub/OpenClaw-Dashboard-Control-Plane && python3 -m unittest tests/test_dashboard_data_service.py
launchctl kickstart -k gui/$(id -u)/ai.openclaw.dashboard
```

Then verify the actual page on `http://localhost:8888`.

## Constraints for the next AI

### Do preserve
- task/review/change objects as the control-plane core
- review/change APIs already wired into the UI
- dual-layer model: strong rules below, AI workflows above
- the current PRD/spec set in `docs/plans/`

### Do not do
- do not revert back to a generic dashboard model
- do not reintroduce retired teams as active runtime teams without explicit design changes
- do not replace the task center truth model with ad-hoc file scanning
- do not silently mutate review/change semantics in UI-only work

## Highest-value next steps
1. Improve review/change detail density for mobile and narrow widths.
2. Turn current smoke flows into reusable test fixtures instead of one-off created objects.
3. Continue reducing raw JSON exposure in task/review/change/advanced-config detail cards.
4. Add richer jump links between governance objects and task-center objects.
5. Keep browser smoke stable as UI evolves; treat it as a release gate.
6. Continue refining workflow-designer density and add fixture cleanup for smoke-created objects.

## Recommended implementation posture
- Prefer small UI slices over model rewrites.
- Use the existing APIs before adding new ones.
- Keep verification evidence explicit.
- If changing the product structure, update both this handover doc and the PRD/spec files.

## 2026-03-15 PRD Gap Closure Update

### Runtime rules newly implemented
- `review task` now returns:
  - `seat_status`
  - `chief_status`
  - `packet_missing`
  - `reclaim_eligible`
- `change task` now stores and returns:
  - `impact_targets`
  - `at_risk_tasks`
  - `rollback_plan`
  - publish audit now also records impact scope on publish
- `task detail` now returns:
  - `business_truth_source`
  - `acceptance_result`
  - `gate_result`
  - `artifact_index`
- `business_bound=true` tasks cannot move to `completed` without:
  - `business_truth_source`
  - `acceptance_result`
- `missing_inputs` blocks completion and returns `missing required input`
- new stage-handoff rule:
  - `handoff_note`
  - `artifact_summary`
  - `next_owner`
  are required before a stage can be handed off

### New or expanded service/API capabilities
- `POST /api/tasks/{id}/artifact`
- `POST /api/tasks/{id}/stage/{stage_id}/handoff`
- `GET /api/reviews` and `GET /api/reviews/{id}` now expose the new seat/chief fields
- `GET /api/change-tasks/{id}` returns impact targets, at-risk tasks, rollback plan, publish audit

### Dashboard layout (2026-03-15)
- **System dashboard**: Three top-level tabs — 「系统架构关系图」「治理中心」「高级配置」. Default view is architecture map. Architecture view uses the right-side panel as `对象详情`, not as a generic flow panel.
- **All pages**: Top bars are compact — single row of tabs/actions or stats+pool-tabs+actions, padding 8px 12px, no large page title or long subtitle. Task center: stats and pool tabs are inline in the same header.

### Product-layer UI updates
- `system_dashboard.html`
  - governance center now isolates day-to-day operations:
    - `变更`
    - `审查`
    - `恢复`
  - advanced config isolates:
    - workflow designer for `team-state-machines`
    - expert mode for raw team lead config
    - expert mode for raw state-machine config
    - prompt patch generation
    - publish queue
  - workflow designer currently supports:
    - state nodes
    - transition edges
    - structured condition blocks
    - save draft / queue / publish
    - load compatibility for legacy transition targets outside `internal_states`
  - change creation form now includes:
    - `impact_targets`
    - `at_risk_tasks`
    - `rollback_plan`
  - change list now shows impact and at-risk summaries
  - review list/detail now shows:
    - `chief_status`
    - `seat_status`
    - `packet_missing`
    - `reclaim_eligible`
  - governance deep-links now support and keep stable:
    - `subview=governance&governance=review&review_id=<id>`
    - `subview=governance&governance=change&change_id=<id>`
    - `subview=governance&governance=recovery`
    - `subview=advanced-config`
    - `subview=advanced-config&object_type=<...>&object_id=<...>&target_type=team&target_id=<...>&mode=workflow-designer`
    - `subview=advanced-config&object_type=<...>&object_id=<...>&target_type=team&target_id=<...>&mode=expert`
- `task_dashboard.html`
  - task detail now shows:
    - `business_truth_source`
    - `acceptance_result`
    - `gate_result`
    - `artifact_index`
  - task detail now renders:
    - explicit gate warning cards for missing business truth / acceptance / gate pass
    - current stage operation summary
    - `artifact` submit form
    - `stage handoff` submit form
  - task query route now supports:
    - `task_dashboard.html?task_id=<id>`
    - `task_dashboard.html?pool=<pool>`
    - `include_history=1`
    - `diagnostic=1`
  - historical raw metadata is now collapsed behind diagnostic mode instead of always shown

### Verification evidence
- Unit tests:
  - `cd /Users/tianshuai/Documents/GitHub/OpenClaw-Dashboard-Control-Plane && PYTHONDONTWRITEBYTECODE=1 python3 -m unittest tests/test_dashboard_data_service.py`
  - result: `31/31 OK`
- Python parse check:
  - `python3 - <<'PY' ... compile(...) ... PY`
  - result: `python-compile-ok`
- Live smoke objects created on `http://localhost:8888`:
  - `REVIEW-20260315-7E3339`
  - `CHANGE-20260315-2DBF6E`
  - `TASK-20260315-815C8E`
- Fixed smoke script:
  - `/Users/tianshuai/Documents/GitHub/OpenClaw-Dashboard-Control-Plane/scripts/control_plane_smoke.sh`
- Latest smoke objects created by committed script:
  - `REVIEW-20260315-0C6C14`
  - `CHANGE-20260315-9D4678`
  - `TASK-20260315-4ADAEC`
- Browser smoke confirmed:
  - review deep-link lands on `REVIEW-20260315-64AE29`
  - change deep-link lands on `CHANGE-20260315-1E1F52`
  - direct advanced-config deep-link shows the no-selection warning first
  - architecture selection `team-rd -> 对象详情 -> 进入配置` lands on filtered advanced config
  - member selection `coordinator` shows fallback-to-team messaging
  - task deep-link lands on `TASK-20260315-6CFCA4`
  - artifact submit from task UI writes `artifact_index`
  - handoff submit from task UI advances stage 1 -> stage 2
  - only browser console error is `favicon.ico 404`
  - browser smoke now closes and deletes its Playwright sessions on exit
  - targeted cleanup proof: open one Playwright session, then `close + delete-data` with timeout; result `cleanup_ok`

### Known residual issues
- Current task-center artifact/handoff area is functional but still visually dense on narrow widths.
- Review/change detail cards still need a denser structured layout to further reduce raw JSON dependence.
- Smoke currently creates one-off live objects; fixture creation/cleanup should be formalized next.
- Full `control_plane_smoke.sh` still intermittently hangs after the workflow-designer step even though the new session-cleanup path is independently verified. Treat this as an active test-harness bug, not as proof that workflow-designer is broken.

### Migration-safety updates
- Stable semantic objects are now explicitly documented as:
  - `task`
  - `stage_card`
  - `review_task`
  - `change_task`
  - `artifact_index`
  - `control_audit`
- High-value migration fields are now promoted into explicit SQLite columns for:
  - `tasks`
  - `review_tasks`
  - `change_tasks`
- Review/change API responses now flow through service-side view-models before reaching the UI.

## Required sync after each development round

At the end of each meaningful development round, update:

1. `docs/handovers/*`
2. affected `docs/plans/*`
3. `workspace/AGENTS.md`

If architecture behavior changes, also update:

4. `docs/plans/2026-03-15-openclaw-control-plane-architecture.md`
5. `/Volumes/TB512/3_ClawDocs/reviews/OpenClaw-Control-Plane/index.md`
