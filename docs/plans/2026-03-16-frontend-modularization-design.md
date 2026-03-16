# Frontend Modularization Design (Vite Multi-Entry)

## Goal

Modularize the existing dashboard frontend without changing visual design or DOM structure. Preserve all existing behavior and deep links while enabling maintainable, testable JS modules.

## Non-Goals

- no UI/visual redesign
- no React rewrite in this phase
- no changes to HTML layout structure
- no breaking changes to API or routing

## Approach

Use Vite with multiple entry points and fixed output filenames, then replace only the `<script>` tags in existing HTML files.

### Entry Points

- `frontend/task/index.ts` -> `static/build/task_dashboard.js`
- `frontend/system/index.ts` -> `static/build/system_dashboard.js`

The HTML pages keep their current structure and styles. Only JS entrypoints change.

### Module Boundaries

- `frontend/shared/http.ts`
  - fetch wrapper, JSON parsing, error handling
- `frontend/shared/dom.ts`
  - DOM helpers, safe query utilities
- `frontend/task/`
  - `state.ts` route + UI state
  - `render.ts` rendering logic
  - `actions.ts` event wiring
- `frontend/system/`
  - `state.ts`
  - `render.ts`
  - `actions.ts`

Existing utility files are migrated gradually:
- `static/task_dashboard_utils.js` -> `frontend/shared/task_utils.ts`
- `static/workflow_designer_model.js` -> `frontend/system/workflow_model.ts`

## Build + Runtime

- `npm run build` outputs to `static/build/`
- Filenames must be stable (no hash) to avoid modifying HTML during each deploy
- FastAPI continues to serve `/task_dashboard.html`, `/system_dashboard.html`, and `/static/*`

## Compatibility Constraints

- No DOM structure changes
- No CSS changes
- JS behavior must match current pages
- Existing deep-link routing must remain

## Migration Steps

1. Add Vite config with multi-entry build
2. Create frontend module skeletons
3. Port `task_dashboard` JS to modules
4. Port `system_dashboard` JS to modules
5. Replace HTML script tags to load `static/build/*.js`

## Risks + Mitigations

- **Risk:** JS behavior divergence during migration
  - **Mitigation:** keep old code side-by-side until equivalent feature passes

- **Risk:** Output filenames changing per build
  - **Mitigation:** force fixed build filenames in Vite config

- **Risk:** Missing features due to manual module extraction
  - **Mitigation:** port in small increments with feature parity checks

## Success Criteria

- Both pages load with identical UI and behavior
- New code lives under `frontend/`
- Vite build outputs stable JS files
- No runtime console errors beyond existing baseline

