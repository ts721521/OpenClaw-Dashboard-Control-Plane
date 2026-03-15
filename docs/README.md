# OpenClaw Dashboard AI Entry

`docs/README.md` is the AI entry file for this repository.

Its job is to tell the next AI:
- what to read first
- which docs are source-of-truth for which question
- where the current implementation lives
- which boundaries are fixed for migration safety
- which docs must be updated after development

## Read This First

### New AI joining the repo
1. [2026-03-15-openclaw-control-plane-architecture.md](/Users/tianshuai/Documents/GitHub/OpenClaw-Dashboard-Control-Plane/docs/plans/2026-03-15-openclaw-control-plane-architecture.md)
2. [2026-03-15-control-plane-handover.md](/Users/tianshuai/Documents/GitHub/OpenClaw-Dashboard-Control-Plane/docs/handovers/2026-03-15-control-plane-handover.md)
3. [2026-03-15-migration-boundaries.md](/Users/tianshuai/Documents/GitHub/OpenClaw-Dashboard-Control-Plane/docs/plans/2026-03-15-migration-boundaries.md)
4. [2026-03-15-team-workflow-designer-design.md](/Users/tianshuai/Documents/GitHub/OpenClaw-Dashboard-Control-Plane/docs/plans/2026-03-15-team-workflow-designer-design.md)
5. [2026-03-14-openclaw-control-plane-prd.md](/Users/tianshuai/Documents/GitHub/OpenClaw-Dashboard-Control-Plane/docs/plans/2026-03-14-openclaw-control-plane-prd.md)
6. [2026-03-14-braintrust-review-system-prd.md](/Users/tianshuai/Documents/GitHub/OpenClaw-Dashboard-Control-Plane/docs/plans/2026-03-14-braintrust-review-system-prd.md)
7. [2026-03-14-constitution-runtime-mapping-spec.md](/Users/tianshuai/Documents/GitHub/OpenClaw-Dashboard-Control-Plane/docs/plans/2026-03-14-constitution-runtime-mapping-spec.md)
8. [2026-03-14-minimal-kernel-implementation-plan.md](/Users/tianshuai/Documents/GitHub/OpenClaw-Dashboard-Control-Plane/docs/plans/2026-03-14-minimal-kernel-implementation-plan.md)

### If you are doing frontend work
1. [2026-03-15-openclaw-control-plane-architecture.md](/Users/tianshuai/Documents/GitHub/OpenClaw-Dashboard-Control-Plane/docs/plans/2026-03-15-openclaw-control-plane-architecture.md)
2. [2026-03-15-control-plane-handover.md](/Users/tianshuai/Documents/GitHub/OpenClaw-Dashboard-Control-Plane/docs/handovers/2026-03-15-control-plane-handover.md)
3. [2026-03-15-team-workflow-designer-design.md](/Users/tianshuai/Documents/GitHub/OpenClaw-Dashboard-Control-Plane/docs/plans/2026-03-15-team-workflow-designer-design.md)
4. [system_dashboard.html](/Users/tianshuai/Documents/GitHub/OpenClaw-Dashboard-Control-Plane/system_dashboard.html)
5. [task_dashboard.html](/Users/tianshuai/Documents/GitHub/OpenClaw-Dashboard-Control-Plane/task_dashboard.html)
6. [static/workflow_designer_model.js](/Users/tianshuai/Documents/GitHub/OpenClaw-Dashboard-Control-Plane/static/workflow_designer_model.js)
7. [static/task_dashboard_utils.js](/Users/tianshuai/Documents/GitHub/OpenClaw-Dashboard-Control-Plane/static/task_dashboard_utils.js)

### If you are doing backend work
1. [2026-03-15-openclaw-control-plane-architecture.md](/Users/tianshuai/Documents/GitHub/OpenClaw-Dashboard-Control-Plane/docs/plans/2026-03-15-openclaw-control-plane-architecture.md)
2. [2026-03-14-constitution-runtime-mapping-spec.md](/Users/tianshuai/Documents/GitHub/OpenClaw-Dashboard-Control-Plane/docs/plans/2026-03-14-constitution-runtime-mapping-spec.md)
3. [2026-03-15-migration-boundaries.md](/Users/tianshuai/Documents/GitHub/OpenClaw-Dashboard-Control-Plane/docs/plans/2026-03-15-migration-boundaries.md)
4. [server.py](/Users/tianshuai/Documents/GitHub/OpenClaw-Dashboard-Control-Plane/server.py)
5. [task_repository.py](/Users/tianshuai/Documents/GitHub/OpenClaw-Dashboard-Control-Plane/task_repository.py)
6. [dashboard_runtime.py](/Users/tianshuai/Documents/GitHub/OpenClaw-Dashboard-Control-Plane/dashboard_runtime.py)
7. [tests/test_dashboard_data_service.py](/Users/tianshuai/Documents/GitHub/OpenClaw-Dashboard-Control-Plane/tests/test_dashboard_data_service.py)
8. [tests/test_runtime_paths.py](/Users/tianshuai/Documents/GitHub/OpenClaw-Dashboard-Control-Plane/tests/test_runtime_paths.py)

## Source Of Truth Map

- System architecture and code mapping:
  - [2026-03-15-openclaw-control-plane-architecture.md](/Users/tianshuai/Documents/GitHub/OpenClaw-Dashboard-Control-Plane/docs/plans/2026-03-15-openclaw-control-plane-architecture.md)
- Current implementation truth and residual issues:
  - [2026-03-15-control-plane-handover.md](/Users/tianshuai/Documents/GitHub/OpenClaw-Dashboard-Control-Plane/docs/handovers/2026-03-15-control-plane-handover.md)
- Workflow designer graph/config mapping:
  - [2026-03-15-team-workflow-designer-design.md](/Users/tianshuai/Documents/GitHub/OpenClaw-Dashboard-Control-Plane/docs/plans/2026-03-15-team-workflow-designer-design.md)
- Migration-safe boundaries:
  - [2026-03-15-migration-boundaries.md](/Users/tianshuai/Documents/GitHub/OpenClaw-Dashboard-Control-Plane/docs/plans/2026-03-15-migration-boundaries.md)
- Runtime/operator facts for this repo:
  - [AGENTS.md](/Users/tianshuai/Documents/GitHub/OpenClaw-Dashboard-Control-Plane/AGENTS.md)

## Runtime Boundary

This repo is dashboard-only.

External runtime stays here:
- `OPENCLAW_BASE_DIR=/Users/tianshuai/.openclaw`
- `OPENCLAW_WORKSPACE=/Users/tianshuai/.openclaw/workspace`

The dashboard must not vendor or commit runtime state from that external tree.

## Main Implementation Files

- Backend service: [server.py](/Users/tianshuai/Documents/GitHub/OpenClaw-Dashboard-Control-Plane/server.py)
- Task repository: [task_repository.py](/Users/tianshuai/Documents/GitHub/OpenClaw-Dashboard-Control-Plane/task_repository.py)
- Runtime config boundary: [dashboard_runtime.py](/Users/tianshuai/Documents/GitHub/OpenClaw-Dashboard-Control-Plane/dashboard_runtime.py)
- Task center UI: [task_dashboard.html](/Users/tianshuai/Documents/GitHub/OpenClaw-Dashboard-Control-Plane/task_dashboard.html)
- Governance and workflow designer UI: [system_dashboard.html](/Users/tianshuai/Documents/GitHub/OpenClaw-Dashboard-Control-Plane/system_dashboard.html)
- Browser smoke: [control_plane_smoke.sh](/Users/tianshuai/Documents/GitHub/OpenClaw-Dashboard-Control-Plane/scripts/control_plane_smoke.sh)

## External Review Opinions

External multi-AI review records remain outside the repo:
- `/Volumes/TB512/3_ClawDocs/reviews/OpenClaw-Control-Plane`

Repo docs hold design and implementation truth.
External review files hold review opinions and review conclusions.

## Required Doc Updates After Behavior Changes

Update all relevant files before claiming completion:
- `docs/handovers/*.md`
- affected `docs/plans/*.md`
- `AGENTS.md`
- this `docs/README.md` if entrypoints or reading order changed
