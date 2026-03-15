# OpenClaw Migration Boundaries

## Purpose

This document defines the boundaries that must remain stable while the control plane keeps evolving.

It exists to keep future migration possible.

The goal is not to freeze implementation details. The goal is to freeze the semantic contract.

## Repository Boundary

This repository is dashboard-only.

External runtime remains outside the repo:
- `OPENCLAW_BASE_DIR=/Users/tianshuai/.openclaw`
- `OPENCLAW_WORKSPACE=/Users/tianshuai/.openclaw/workspace`

New work must not pull runtime data directories into Git. The dashboard reads them through the configured runtime boundary.

## Stable Core Objects

The following object names and meanings are now treated as long-term stable boundaries:

- `task`
  - the top-level execution object
- `stage_card`
  - the ordered sub-stage object under a parent task
- `review_task`
  - the Braintrust review object
- `change_task`
  - the publish/change-management object
- `artifact_index`
  - the structured artifact record attached to tasks/reviews
- `control_audit`
  - the operator and control-action audit trail

New features must extend these objects instead of inventing parallel orchestration entities.

## Service Boundary Rules

The frontend must only read and write through control-plane APIs and service-shaped view-models.

It must not depend on:

- SQLite table names
- SQLite column names beyond documented API behavior
- `payload_json` internals
- raw `team-state-machines` storage layout outside the workflow-designer mapping layer

The service layer is the only allowed home for:

- `business gate`
- `handoff gate`
- `review gate`
- `publish gate`

These rules must not be duplicated in:

- dashboard HTML view logic
- shell scripts
- ad-hoc browser automation snippets

## Storage Boundary Rules

SQLite remains the current truth store.

That is an implementation choice, not a product contract.

To keep migration possible:

- explicit query fields should be promoted into first-class columns
- `payload_json` stays as compatibility and extension storage
- new core queries must not rely primarily on `payload_json`

Current promoted fields:

- `tasks`
  - `task_id`
  - `task_name`
  - `task_type`
  - `status`
  - `progress`
  - `owner`
  - `team`
  - `business_bound`
  - `business_truth_source`
  - `acceptance_result`
  - `gate_result`
  - `task_pool`
  - `parent_task_id`
  - `dispatch_state`
- `review_tasks`
  - `review_id`
  - `title`
  - `incident_key`
  - `status`
  - `review_pool`
  - `assigned_to`
- `change_tasks`
  - `change_id`
  - `title`
  - `scope`
  - `priority`
  - `status`
  - `affects_scope`

When adding new query-heavy fields, prefer promoting them first instead of increasing `payload_json` dependence.

## Replaceable Layers

The following layers are allowed to change later:

- backend HTTP framework
- frontend framework or bundling model
- database engine
- background worker mechanism
- browser automation harness

These layers are not allowed to change the meaning of the stable core objects.

## Frontend Modularity Rules

The current static-page route remains valid for now.

However, future frontend work must behave as if the UI were already modularized into:

- architecture map
- governance center
- workflow designer
- task detail

New code should stay inside those product boundaries instead of continuing to grow one monolithic page-level state model.

## Automation Isolation Rules

Browser smoke and Playwright automation are now treated as an isolated operational concern.

Required rules:

- smoke sessions must close on success
- smoke sessions must close on failure
- session data must be deleted after smoke runs
- browser automation residue must not be treated as normal runtime activity

This is required because browser automation residue can create false operational signals and can destabilize the host machine.

## Migration Checklist For New Work

Before landing new behavior, confirm:

1. Which stable core object does this belong to?
2. Which API exposes it?
3. Does it require a new explicit query field?
4. Did any rule leak into the frontend or shell layer?
5. Does the change make future framework/database migration harder?

If the answer to 4 or 5 is yes, redesign before shipping.

## Current Non-Goals

This document does not require:

- immediate migration off SQLite
- immediate rewrite off static HTML/JS
- immediate rewrite into a heavier web stack

The current phase is boundary tightening, not platform replacement.
