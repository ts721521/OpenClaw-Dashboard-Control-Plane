# OpenClaw Dashboard Architecture Upgrade Design

## 1. Goal

Upgrade the dashboard/control-plane stack to support long-term evolution without breaking the stable object model. The upgrade must preserve:

- stable objects: `task`, `stage_card`, `review_task`, `change_task`, `artifact_index`, `control_audit`
- existing deep-link entrypoints
- external runtime boundary (`OPENCLAW_BASE_DIR`, `OPENCLAW_WORKSPACE`)

The immediate outcome is a service layer and UI structure that can evolve without rewriting the core data model.

## 2. Non-Goals

- do not migrate or vendor the OpenClaw runtime
- do not change task/review/change semantics
- do not replace SQLite or the existing data service yet
- do not move to a desktop client in this phase

## 3. Chosen Approach

**Incremental upgrade inside the existing repo.**

- introduce `FastAPI` as the new service entrypoint
- keep `DashboardDataService` and `TaskRepository` as the data layer
- keep existing HTML pages in place while the API layer stabilizes
- later introduce Vite/React as a modular UI layer, behind stable APIs

This approach keeps risk low while still establishing a long-term migration path.

## 4. Architecture Boundaries

### 4.1 Service Layer

The service layer becomes the only place where rules and gate logic live:

- business gate
- handoff gate
- review gate
- publish gate

Frontend reads and writes only through service APIs. Frontend must not read SQLite or config JSON directly.

### 4.2 Data Layer

The data layer stays as-is for now:

- `task_repository.py` and SQLite remain the persistence layer
- `DashboardDataService` remains the aggregation layer
- new API endpoints wrap and shape existing service output

### 4.3 UI Layer

Short term:

- existing HTML pages remain entrypoints
- FastAPI serves static files and API responses

Mid term:

- Vite/React adds modular UI components
- legacy HTML can be replaced page-by-page
- API contract remains stable across UI rewrites

## 5. API Compatibility

FastAPI must preserve the existing API contract to avoid breaking current UI logic. The first migration phase only adds a new server entrypoint and a compatibility layer, not a new API surface.

Required endpoints in the first phase:

- `GET /api/health`
- `GET /api/tasks`
- `GET /api/reviews`
- `GET /api/change-tasks`
- `GET /api/config/team-state-machines`

Static file serving must preserve:

- `/task_dashboard.html`
- `/system_dashboard.html`
- `/static/*`

## 6. Migration Phases

### Phase A: Service Skeleton

- add `app/main.py` with FastAPI app
- implement health and basic list endpoints
- use `DashboardDataService` as the backend source

### Phase B: Static Compatibility

- serve existing HTML and static assets through FastAPI
- keep `server.py` intact for rollback

### Phase C: UI Modularization

- add a Vite-powered `frontend/`
- begin migrating UI logic into modules without breaking entrypoints

### Phase D: Cutover

- update `start.sh` and launch scripts to point at FastAPI
- keep `server.py` as fallback until stability is confirmed

## 7. Risks And Mitigations

- **Risk:** API mismatch between FastAPI and legacy handlers
  - **Mitigation:** tests for each endpoint response shape

- **Risk:** UI regressions from static serving or routing differences
  - **Mitigation:** browser smoke tests against `localhost:8888`

- **Risk:** rule logic gets duplicated in UI
  - **Mitigation:** enforce gate logic in service; UI only renders status

## 8. Testing Strategy

- unit tests for API endpoints
- smoke tests for deep-links and main UI flows
- explicit regression checks for `favicon.ico` and console errors

## 9. Rollback

If FastAPI causes regressions:

- revert `start.sh` to run `server.py`
- keep the new API layer isolated to `app/`
- no data migrations occur in Phase A/B, so rollback is safe

## 10. Doc And Collaboration Rules

- update `docs/README.md` to index the upgrade design and plan
- update `docs/handovers/` after any behavior change
- keep `AGENTS.md` current with new workflow entrypoints
