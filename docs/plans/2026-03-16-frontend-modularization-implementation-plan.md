# Frontend Modularization Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Modularize the dashboard frontend with Vite multi-entry bundles while preserving existing HTML structure and UI behavior.

**Architecture:** Keep `task_dashboard.html` and `system_dashboard.html` as entrypoints, introduce Vite multi-entry builds that output fixed filenames under `static/build/`, and migrate existing JS into modular `frontend/` code without changing DOM or CSS.

**Tech Stack:** Vite, TypeScript, existing HTML/JS, FastAPI static serving.

---

### Task 1: Add Vite project scaffold with multi-entry build

**Files:**
- Create: `package.json`
- Create: `vite.config.ts`
- Create: `tsconfig.json`
- Create: `frontend/shared/http.ts`
- Create: `frontend/shared/dom.ts`

**Step 1: Write the failing test**

Create a minimal build check script that fails if output files are missing:

```bash
# scripts/check_vite_build.sh
set -euo pipefail
if [ ! -f static/build/task_dashboard.js ]; then
  echo "missing task_dashboard.js"; exit 1; fi
if [ ! -f static/build/system_dashboard.js ]; then
  echo "missing system_dashboard.js"; exit 1; fi
```

**Step 2: Run test to verify it fails**

Run: `bash scripts/check_vite_build.sh`
Expected: FAIL with "missing task_dashboard.js"

**Step 3: Write minimal implementation**

- `vite.config.ts` uses multi-entry:
  - `frontend/task/index.ts`
  - `frontend/system/index.ts`
- Output to `static/build/` with fixed filenames (no hash)
- `package.json` includes `build` script
- add shared helpers in `frontend/shared/`

**Step 4: Run test to verify it passes**

Run:
```
npm install
npm run build
bash scripts/check_vite_build.sh
```
Expected: PASS

**Step 5: Commit**

```bash
git add package.json vite.config.ts tsconfig.json frontend/shared/http.ts frontend/shared/dom.ts scripts/check_vite_build.sh

git commit -m "feat: add Vite multi-entry build scaffold"
```

---

### Task 2: Port task dashboard JS into modules

**Files:**
- Create: `frontend/task/index.ts`
- Create: `frontend/task/state.ts`
- Create: `frontend/task/render.ts`
- Create: `frontend/task/actions.ts`
- Create: `frontend/shared/task_utils.ts`
- Modify: `task_dashboard.html`
- Test: `tests/test_task_dashboard_bundle.py`

**Step 1: Write the failing test**

```python
import os
import unittest

class TestTaskDashboardBundle(unittest.TestCase):
    def test_task_bundle_exists(self):
        self.assertTrue(os.path.exists("static/build/task_dashboard.js"))
```

**Step 2: Run test to verify it fails**

Run: `python3 -m unittest tests/test_task_dashboard_bundle.py`
Expected: FAIL if bundle missing

**Step 3: Write minimal implementation**

- Move `static/task_dashboard_utils.js` logic into `frontend/shared/task_utils.ts`
- In `frontend/task/index.ts`, wire state + render + actions
- Update `task_dashboard.html` to load `static/build/task_dashboard.js` and remove old inline script tag if present

**Step 4: Run test to verify it passes**

Run:
```
npm run build
python3 -m unittest tests/test_task_dashboard_bundle.py
```
Expected: PASS

**Step 5: Commit**

```bash
git add frontend/task frontend/shared/task_utils.ts task_dashboard.html tests/test_task_dashboard_bundle.py

git commit -m "feat: modularize task dashboard JS"
```

---

### Task 3: Port system dashboard JS into modules

**Files:**
- Create: `frontend/system/index.ts`
- Create: `frontend/system/state.ts`
- Create: `frontend/system/render.ts`
- Create: `frontend/system/actions.ts`
- Create: `frontend/system/workflow_model.ts`
- Modify: `system_dashboard.html`
- Test: `tests/test_system_dashboard_bundle.py`

**Step 1: Write the failing test**

```python
import os
import unittest

class TestSystemDashboardBundle(unittest.TestCase):
    def test_system_bundle_exists(self):
        self.assertTrue(os.path.exists("static/build/system_dashboard.js"))
```

**Step 2: Run test to verify it fails**

Run: `python3 -m unittest tests/test_system_dashboard_bundle.py`
Expected: FAIL if bundle missing

**Step 3: Write minimal implementation**

- Move `static/workflow_designer_model.js` logic into `frontend/system/workflow_model.ts`
- Modularize system dashboard JS into `frontend/system/*`
- Update `system_dashboard.html` to load `static/build/system_dashboard.js`

**Step 4: Run test to verify it passes**

Run:
```
npm run build
python3 -m unittest tests/test_system_dashboard_bundle.py
```
Expected: PASS

**Step 5: Commit**

```bash
git add frontend/system system_dashboard.html tests/test_system_dashboard_bundle.py

git commit -m "feat: modularize system dashboard JS"
```

---

### Task 4: Update docs and integration notes

**Files:**
- Modify: `docs/README.md`
- Modify: `docs/handovers/2026-03-15-control-plane-handover.md`

**Step 1: Update docs index**

Add `2026-03-16-frontend-modularization-implementation-plan.md` to `docs/README.md`.

**Step 2: Update handover**

Record Vite multi-entry workflow and the new module paths.

**Step 3: Commit**

```bash
git add docs/README.md docs/handovers/2026-03-15-control-plane-handover.md

git commit -m "docs: record frontend modularization plan"
```
