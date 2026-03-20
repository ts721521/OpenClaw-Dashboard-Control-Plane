# OpenClaw Frontend Visual Redesign Brief

## Purpose

This brief is for frontend-focused AI or engineers working on visual redesign only.

The product skeleton is already decided. This brief exists to prevent visual redesign work from breaking runtime behavior.

不得改动产品骨架。

## Current Product Truth

There are only two core work surfaces:
- `任务中心`
- `系统架构中心`

Auxiliary page only:
- `team_dashboard.html`

Frozen / non-core pages:
- `schedule.html`
- `schedule_dashboard.html`
- `system_overview.html`
- `index_old.html`

## Hard Boundaries

Visual redesign work is **视觉层优先**.

You may change:
- typography
- spacing
- color system
- card and panel styling
- toolbar styling
- graph node and edge presentation
- density and visual hierarchy

You must **not** change:
- the two-core-work-surface model
- route semantics
- object model
- task center as the only runtime/governance surface
- system architecture center as the only structure/flow surface
- the graph-edit workflow:
  - draft
  - submit to Luban
  - inspect implementation
  - confirm apply

You must **not** turn `team_dashboard.html` into a third core workspace.

You must **not** move governance logic back into the system architecture center.

You must **not** add more information density just to make the page look "powerful".

## Surface-Specific Guidance

### Task center
- Keep the page focused on live work, blocking reasons, closure actions, and audit visibility.
- Preserve task detail action ordering and closure panels.
- Improve scanability, not feature count.

### System architecture center
- Keep the four subviews:
  - architecture
  - inter-team flow
  - team workflow
  - flow detail
- Keep graph-edit state visible:
  - draft state
  - dispatch state
  - implementation state
  - current vs pending diff
- Improve readability of nodes, connectors, queues, and right-side panels.

### Auxiliary team page
- Treat it as an auxiliary direct-link page only.
- Do not elevate it in top navigation.

## Acceptance Criteria

Visual redesign is acceptable only if all of the following remain true:
- users can still complete existing runtime actions without relearning product structure
- graph-edit draft -> Luban -> confirm-apply still reads as one coherent flow
- no new core work surface is introduced
- task center and system architecture center remain the only primary product surfaces
- smoke and existing runtime behavior tests still pass

## Recommended Collaboration Split

- Runtime/behavior owner:
  - backend truth
  - graph-edit semantics
  - Luban implementation bridge
  - closure engine
  - smoke and regression safety
- Frontend design owner:
  - visual language
  - layout polish
  - component consistency
  - graph readability
  - density and hierarchy cleanup

## Do Not Do

- do not redesign by inventing new product structure
- do not add a third dashboard
- do not move task actions into system pages
- do not delete graph-edit diff/implementation visibility
- do not hide critical status behind multiple modal layers
- do not replace clear operational wording with vague marketing copy
