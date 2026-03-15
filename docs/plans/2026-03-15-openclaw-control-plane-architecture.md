# OpenClaw Control Plane Architecture

## 1. Document Purpose

This document is the architecture entrypoint for other AI agents and developers.

It has two jobs:

1. explain the intended control-plane architecture
2. map that architecture to the current implementation, docs, and known gaps

This document does not replace the PRD, review PRD, or constitution mapping spec. It sits above them as the top-level map.

Migration constraints for future framework/database replacement are recorded separately in:

- [2026-03-15-migration-boundaries.md](/Users/tianshuai/Documents/GitHub/OpenClaw-Dashboard-Control-Plane/docs/plans/2026-03-15-migration-boundaries.md)

## 2. System Goal

OpenClaw is no longer being treated as a loose multi-agent dashboard. The target system is a control plane with strong rules underneath and AI execution on top.

The control plane must answer, with real state instead of inference:

- what task exists
- who owns it now
- what stage it is in
- whether it is stalled
- which review seats have responded
- which change is safe to publish
- which rules and versions the task is bound to

## 3. System Boundary

### 3.0 Repository Boundary

This GitHub repository contains the dashboard/control-plane project only.

External runtime remains outside the repo:
- `OPENCLAW_BASE_DIR=/Users/tianshuai/.openclaw`
- `OPENCLAW_WORKSPACE=/Users/tianshuai/.openclaw/workspace`

The dashboard reads real state from that external runtime through environment-configured paths. It must not vendor runtime state into the repository.

### 3.1 In Scope

- shared task truth source
- review truth source
- change/publish truth source
- runtime status aggregation from Claw gateway
- task center and governance UI
- audit and recovery paths

### 3.2 Out of Scope

- rebuilding every legacy team
- making Discord/Telegram the truth source
- replacing Claw runtime/session execution itself
- introducing a second orchestration database

## 4. Runtime Topology

### 4.1 Governance Claw

Governance Claw contains:

- `main`
- `luban`
- `braintrust_*`
- `km`

Responsibilities:

- task intake
- governance/recovery scheduling
- review dispatch and chief decision
- change approval/publish
- knowledge and artifact indexing

### 4.2 RD Claw

RD Claw contains the active execution team:

- `team-rd`

Responsibilities:

- claim execution work from the control plane
- execute stage work
- update progress
- hand off stages
- return artifacts and acceptance evidence

### 4.3 Control Plane

The control plane is the only active truth source for orchestration state.

It holds:

- tasks
- stage cards
- review tasks
- review packets
- change tasks
- artifact index
- runtime health
- control audit

These object names are now treated as migration-stable semantic boundaries. Future platform changes may replace frameworks or storage, but they must preserve these object meanings.

Current live surface:

- [task_dashboard.html](/Users/tianshuai/Documents/GitHub/OpenClaw-Dashboard-Control-Plane/task_dashboard.html)
- [system_dashboard.html](/Users/tianshuai/Documents/GitHub/OpenClaw-Dashboard-Control-Plane/system_dashboard.html)
- [task_dashboard_utils.js](/Users/tianshuai/Documents/GitHub/OpenClaw-Dashboard-Control-Plane/static/task_dashboard_utils.js)
- [workflow_designer_model.js](/Users/tianshuai/Documents/GitHub/OpenClaw-Dashboard-Control-Plane/static/workflow_designer_model.js)
- backend service: [server.py](/Users/tianshuai/Documents/GitHub/OpenClaw-Dashboard-Control-Plane/server.py)

Current migration-safe implementation rules:

- frontend reads and writes through API/view-models, not SQLite internals
- payload JSON remains compatibility storage, not the preferred query contract
- browser smoke sessions are operationally isolated from normal runtime state
- list-facing runtime reads are non-blocking and refresh the live gateway cache asynchronously
- high-value query fields are being promoted into explicit SQLite columns before new reporting surfaces are added

Current live routing entrypoints:

- `task_dashboard.html?task_id=<id>`
- `task_dashboard.html?pool=<pool>`
- `system_dashboard.html?subview=architecture`
- `system_dashboard.html?subview=architecture&object_type=<team|member|agent>&object_id=<id>`
- `system_dashboard.html?subview=governance&governance=review&review_id=<id>`
- `system_dashboard.html?subview=governance&governance=change&change_id=<id>`
- `system_dashboard.html?subview=governance&governance=recovery`
- `system_dashboard.html?subview=advanced-config`
- `system_dashboard.html?subview=advanced-config&object_type=<team|member|agent>&object_id=<id>&target_type=team&target_id=<team_id>`
- `system_dashboard.html?subview=advanced-config&object_type=<team|member|agent>&object_id=<id>&target_type=team&target_id=<team_id>&mode=workflow-designer`
- `system_dashboard.html?subview=advanced-config&object_type=<team|member|agent>&object_id=<id>&target_type=team&target_id=<team_id>&mode=expert`

## 5. Core Object Model

### 5.1 Task

Task is the top-level execution object.

Important fields already present in runtime:

- `task_id`
- `task_name`
- `task_type`
- `task_pool`
- `dispatch_state`
- `version_binding`
- `business_bound`
- `business_truth_source`
- `acceptance_result`
- `gate_result`
- `artifact_index`

### 5.2 Stage Card

Stage cards model multi-stage work under a parent task.

Important fields already present or enforced:

- `stage_id`
- `name`
- `owner_agent`
- `owner_role`
- `status`
- `handoff_note`
- `artifact_summary`
- `next_owner`
- `gate_result`

### 5.3 Review Task

Review tasks model Braintrust work under the control plane.

Important fields already present:

- `review_id`
- `status`
- `review_pool`
- `assigned_reviewers`
- `seat_status`
- `chief_status`
- `packet_missing`
- `reclaim_eligible`
- `chief_decision`

### 5.4 Change Task

Change tasks are the only supported publish object for shared/global rule changes.

Important fields already present:

- `change_id`
- `scope`
- `status`
- `impact_targets`
- `at_risk_tasks`
- `rollback_plan`
- `approval`
- `publish_audit`

### 5.5 Artifact Index

Artifact index is the structured record of key deliverables and review outputs.

Current minimum fields:

- `artifact_type`
- `path`
- `version`
- `summary`
- `producer`

Current task-center UI can now create artifact records directly through:

- `POST /api/tasks/{id}/artifact`

### 5.6 Team Workflow Designer

Team workflow state now has a graphical editing surface.

Scope:

- team workflow state machine only
- graph view over existing `team-state-machines`
- structured transition conditions only
- raw config retained in expert mode

Primary design reference:

- [2026-03-15-team-workflow-designer-design.md](/Users/tianshuai/Documents/GitHub/OpenClaw-Dashboard-Control-Plane/docs/plans/2026-03-15-team-workflow-designer-design.md)

## 6. Task Pools And Ownership

The system uses pool-based responsibility instead of freeform routing.

### 6.1 `intake_pool`

Used for complex work entering the system.

Owner:

- control plane intake logic
- downstream decomposition/handoff flow

### 6.2 `team_dispatch_pool`

Used for normal team execution work.

Owner:

- team lead or assigned execution agent

### 6.3 `governance_pool`

Used for system changes, governance repair, and recovery work.

Owner:

- `luban`

### 6.4 `review_pool`

Used for review work.

Owner:

- `braintrust_architect`
- `braintrust_critic`
- `braintrust_innovator`
- `braintrust_chief`

### 6.5 `recovery_pool`

Used for stalled or failed review/governance objects.

Owner:

- `luban`

## 7. Control Rules

### 7.1 Business truth source gate

If `business_bound=true`, a task cannot complete without:

- `business_truth_source`
- `acceptance_result`

Current implementation:

- enforced in [server.py](/Users/tianshuai/Documents/GitHub/OpenClaw-Dashboard-Control-Plane/server.py) task progress update path
- rendered as explicit gate-warning cards in [task_dashboard.html](/Users/tianshuai/Documents/GitHub/OpenClaw-Dashboard-Control-Plane/task_dashboard.html)

### 7.2 Technical done is not business done

Technical progress alone does not imply completion.

Current implementation:

- `acceptance_result` required for business-bound completion
- `gate_result` surfaced in task detail

### 7.3 Stage handoff gate

Stage handoff requires:

- `handoff_note`
- `artifact_summary`
- `next_owner`

Current implementation:

- `POST /api/tasks/{id}/stage/{stage_id}/handoff`

### 7.4 Change publish gate

Shared/global change publish requires:

- approval
- `impact_targets`

`P0 override` is the only bypass.

Current implementation:

- `POST /api/change-tasks/{id}/approve`
- `POST /api/change-tasks/{id}/publish`

### 7.5 Review seat visibility

Review status must be explicit, not inferred by UI.

Current implementation:

- `seat_status`
- `chief_status`
- `packet_missing`
- `reclaim_eligible`
  are returned from review APIs

## 8. Review And Change Lifecycle

### 8.1 Review lifecycle

Current intended flow:

1. create review task
2. validate submission bundle
3. dispatch seats
4. submit reviewer packets
5. chief decision
6. push downstream action

Current implementation status:

- create: implemented
- dispatch: implemented
- packet write-back: implemented
- chief decision: implemented
- seat/chief status fields: implemented
- stable deep-link entry to review subview: implemented

### 8.2 Change lifecycle

Current intended flow:

1. create change task
2. declare impact targets
3. approve
4. publish
5. record publish audit

Current implementation status:

- create: implemented
- impact_targets and at_risk_tasks: implemented
- approve: implemented
- publish gate: implemented
- publish detail UI: implemented with dedicated governance change subview

## 9. Current Implementation Map

### 9.1 Backend

- [server.py](/Users/tianshuai/Documents/GitHub/OpenClaw-Dashboard-Control-Plane/server.py)
  - main service layer
  - task/review/change APIs
  - gate enforcement
  - runtime aggregation
- [task_repository.py](/Users/tianshuai/Documents/GitHub/OpenClaw-Dashboard-Control-Plane/task_repository.py)
  - SQLite persistence
  - task/review/change payload storage

### 9.2 Frontend

- [task_dashboard.html](/Users/tianshuai/Documents/GitHub/OpenClaw-Dashboard-Control-Plane/task_dashboard.html)
  - task center
  - task details
  - runtime and audit view
  - currently shows artifact index and gate fields
- [system_dashboard.html](/Users/tianshuai/Documents/GitHub/OpenClaw-Dashboard-Control-Plane/system_dashboard.html)
  - top-level views:
    - architecture map
    - governance center
    - advanced config
  - architecture map entry model:
    - select object on map
    - read object detail in side panel
    - enter filtered advanced config only from that detail card
  - editable target rules:
    - team node edits itself
    - member node falls back to parent team
    - standalone agent falls back to nearest linked team when one exists
    - otherwise advanced config shows explanation only
  - governance center:
    - change controls
    - review governance area
    - recovery area
  - advanced config:
    - object summary first
    - workflow designer as the default `team-state-machines` editor
    - expert mode for raw config groups
    - config publish area filtered by selected target
    - prompt patch generation
    - queue + publish controls
  - workflow designer:
    - node + edge graph for team workflow
    - structured conditions
    - compatibility load for transition targets outside `internal_states`
    - draft save / queue / publish actions

### 9.3 Tests

- [test_dashboard_data_service.py](/Users/tianshuai/Documents/GitHub/OpenClaw-Dashboard-Control-Plane/tests/test_dashboard_data_service.py)
  - current backend truth checks
  - includes review status, change publish gate, business-bound completion, stage handoff

## 10. Current State

### 10.1 Implemented

- minimal kernel
- task pools and leases
- parent tasks and stage cards
- review task lifecycle
- change task lifecycle
- business-bound completion gate
- artifact indexing API
- stage handoff API
- review seat/chief status fields
- change impact fields
- graphical team workflow designer for `team-state-machines`
- advanced-config mode split:
  - `mode=workflow-designer`
  - `mode=expert`

### 10.2 Partially implemented

- governance review detail product UX
- change detail UX
- architecture-map object selection and filtered advanced-config path: implemented, but still visually dense on narrow widths
- workflow designer interaction density on narrow widths
- task center gate messaging on narrow widths
- deep-link routing between governance and task center
- browser smoke coverage

### 10.3 Not yet completed

- denser mobile/narrow-width layout for review/change/task operation areas
- reusable smoke fixtures and cleanup strategy for created live objects
- richer navigation between governance objects and task-center targets

## 11. Known Residuals

- browser console is otherwise clean except `favicon.ico 404`
- current committed smoke script is:
  - `/Users/tianshuai/Documents/GitHub/OpenClaw-Dashboard-Control-Plane/scripts/control_plane_smoke.sh`
- current stable deep-link set is:
  - `system_dashboard.html?subview=architecture`
  - `system_dashboard.html?subview=architecture&object_type=<team|member|agent>&object_id=<id>`
  - `system_dashboard.html?subview=governance&governance=review&review_id=<id>`
  - `system_dashboard.html?subview=governance&governance=change&change_id=<id>`
  - `system_dashboard.html?subview=governance&governance=recovery`
  - `system_dashboard.html?subview=advanced-config`
  - `system_dashboard.html?subview=advanced-config&object_type=<team|member|agent>&object_id=<id>&target_type=team&target_id=<team_id>`
  - `task_dashboard.html?task_id=<id>`
  - `task_dashboard.html?pool=<pool>`

## 12. Read Order For Other AI

1. [docs/README.md](/Users/tianshuai/Documents/GitHub/OpenClaw-Dashboard-Control-Plane/docs/README.md)
2. this architecture doc
3. [2026-03-15-control-plane-handover.md](/Users/tianshuai/Documents/GitHub/OpenClaw-Dashboard-Control-Plane/docs/handovers/2026-03-15-control-plane-handover.md)
4. [2026-03-14-openclaw-control-plane-prd.md](/Users/tianshuai/Documents/GitHub/OpenClaw-Dashboard-Control-Plane/docs/plans/2026-03-14-openclaw-control-plane-prd.md)
5. [2026-03-14-braintrust-review-system-prd.md](/Users/tianshuai/Documents/GitHub/OpenClaw-Dashboard-Control-Plane/docs/plans/2026-03-14-braintrust-review-system-prd.md)
6. [2026-03-14-constitution-runtime-mapping-spec.md](/Users/tianshuai/Documents/GitHub/OpenClaw-Dashboard-Control-Plane/docs/plans/2026-03-14-constitution-runtime-mapping-spec.md)

## 13. External Review Directory

Project review root:

- [`/Volumes/TB512/3_ClawDocs/reviews/OpenClaw-Control-Plane`](/Volumes/TB512/3_ClawDocs/reviews/OpenClaw-Control-Plane)

This directory is for:

- external AI review opinions
- architecture review rounds
- gap-closure review records

Repo docs remain the source for architecture and implementation truth.
External review files remain the source for multi-AI opinions and review conclusions.
