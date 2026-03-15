# Team Workflow Designer Design

## Purpose

This document defines the V1 graphical workflow designer for `team-state-machines`.

The goal is to replace raw JSON-first editing with an object-first, visual team workflow editor inside the system dashboard.

V1 only covers **team workflow state machines**. It does not graph task orchestration, review flow, or change-publish flow.

## User Entry

The only supported primary path is:

1. open `system_dashboard.html?subview=architecture`
2. select a team, member, or standalone agent on the architecture map
3. read the object detail card
4. click `进入配置`
5. land in:

`system_dashboard.html?subview=advanced-config&object_type=<type>&object_id=<id>&target_type=team&target_id=<team_id>&mode=workflow-designer`

Rules:

- team nodes edit their own team workflow
- member nodes fall back to the parent team workflow
- standalone agents only route into workflow editing when they map to a team target
- direct open of `advanced-config` without a selected target shows guidance instead of an editor

## UI Layers

`高级配置` is now split into:

- `流程设计器`
- `专家模式`

`流程设计器` is the default mode for team workflow editing.

`专家模式` retains:

- raw team lead config
- raw team state machine config
- prompt patch generation
- publish queue

## Graph Model

The frontend graph model is a view-model over the existing `team-state-machines` document.

Minimum graph shape:

- `nodes`
- `edges`
- `start_node_id`
- `terminal_nodes`
- `mapping_to_unified`
- `heartbeat_requirements`

### Node fields

- `id`
- `label`
- `unifiedState`
- `role`
- `description`
- `x`
- `y`
- `heartbeatInterval`
- `heartbeatTimeout`
- `isStart`
- `isTerminal`

### Edge fields

- `key`
- `from`
- `to`
- `transitionType`
- `condition`
- `requiresConfirmation`

## Mapping To `team-state-machines`

### Open path

When the designer opens:

1. read the target team's state-machine document
2. collect all `internal_states`
3. also collect any states referenced by `transitions`
4. build nodes from the union of those states
5. restore edge metadata from `transition_meta`
6. restore node metadata from `node_meta`

Important compatibility rule:

- legacy transitions may reference governance states not listed in `internal_states`
- the designer must still build those nodes, otherwise legacy workflows become invalid on load

### Save path

When the designer saves:

1. validate the graph
2. serialize graph back into the current `team-state-machines` structure
3. write through the existing config API
4. keep the same truth source, not a second storage model

The designer does not invent a new persistence format.

## Supported Transition Types

V1 transition types:

- `normal`
- `rework`
- `blocked`
- `escalated`
- `failure`

## Supported Structured Conditions

V1 conditions are fixed blocks:

- `通过`
- `失败`
- `返工`
- `阻塞`
- `超时`
- `人工确认`
- `缺输入`

Free expressions are intentionally out of scope.

## Validation Rules

The designer must block save/publish when any of these are true:

- missing start node
- no terminal path
- isolated node
- edge target missing
- rework edge points to an invalid node
- terminal node still has outgoing edges

Compatibility note:

- inferred terminal nodes must not be created from states that still have outgoing transitions

## Save And Publish Behavior

The designer keeps the existing release semantics:

- `保存草稿`
- `加入发布队列`
- `发布`

It does not bypass review or publish gates.

## Current Implementation Mapping

Primary implementation file:

- [/Users/tianshuai/Documents/GitHub/OpenClaw-Dashboard-Control-Plane/system_dashboard.html](/Users/tianshuai/Documents/GitHub/OpenClaw-Dashboard-Control-Plane/system_dashboard.html)

Main implementation areas:

- route and view state
- graph build/validate/serialize helpers
- workflow designer rendering
- workflow designer interactions
- advanced-config mode switching

Regression script:

- [/Users/tianshuai/Documents/GitHub/OpenClaw-Dashboard-Control-Plane/scripts/control_plane_smoke.sh](/Users/tianshuai/Documents/GitHub/OpenClaw-Dashboard-Control-Plane/scripts/control_plane_smoke.sh)

## Non-Goals

V1 does not:

- create member-specific workflow config
- graph review lifecycle
- graph change-publish lifecycle
- replace the existing publish gate model
- create a desktop client
