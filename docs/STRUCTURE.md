# Documentation Structure

This repository keeps documentation in a small number of stable buckets.

## Top-level docs

- `README.md`
  - repository entry
  - runtime boundary
  - current product surfaces
- `AGENTS.md`
  - operator/runtime rules
  - implementation constraints that must stay true in code

## `docs/`

- `docs/README.md`
  - documentation entrypoint
  - source-of-truth reading order
- `docs/handovers/`
  - current runtime and implementation status
  - handoff notes for the next engineer or AI
- `docs/plans/`
  - design docs
  - implementation plans
  - architecture briefs
  - constrained redesign briefs

## Naming rules

- use `docs/handovers/YYYY-MM-DD-<topic>.md` for runtime status / continuation notes
- use `docs/plans/YYYY-MM-DD-<topic>.md` for plans, designs, specs, and briefs
- keep only one current handover for the same topic unless there is a real version split
- do not place design or handover Markdown in the repo root

## Non-goals

- do not create a second docs tree outside `docs/`
- do not add new top-level Markdown files unless they are true repo entry files
- do not treat frozen pages as product documentation entrypoints

## Current product truth

Only two core work surfaces are part of the main product route:
- `task_dashboard.html`
- `system_dashboard.html`

`team_dashboard.html` remains auxiliary only.
