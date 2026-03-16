# System Dashboard Modularization Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Further modularize `system_dashboard` by splitting architecture map, governance center, and advanced config into dedicated modules without changing UI/DOM.

**Architecture:** Keep `system_dashboard.html` as the entrypoint, keep rendering and behaviors identical, but refactor `frontend/system/index.ts` into smaller modules: `state`, `actions`, `render`, and sub-modules for architecture/governance/config. Only `index.ts` binds events and wires modules.

**Tech Stack:** Vite + TypeScript, existing HTML/JS, FastAPI static serving.

---

### Task 1: Extract architecture map module

**Files:**
- Create: `frontend/system/architecture.ts`
- Modify: `frontend/system/index.ts`
- Test: `tests/test_system_architecture_module.py`

**Step 1: Write the failing test**

```python
import unittest

class TestSystemArchitectureModule(unittest.TestCase):
    def test_architecture_module_exists(self):
        with open("frontend/system/architecture.ts", "r", encoding="utf-8") as handle:
            contents = handle.read()
        self.assertIn("renderArchitecture", contents)
        self.assertIn("selectArchitectureObject", contents)
```

**Step 2: Run test to verify it fails**

Run: `python3 -m unittest tests/test_system_architecture_module.py`
Expected: FAIL with file not found

**Step 3: Write minimal implementation**

Move the following groups from `frontend/system/index.ts` into `architecture.ts`:
- architecture index helpers
- `deriveEditableTarget`
- selection and object detail render
- architecture map rendering and object click handling

Export functions used by `index.ts`:
- `renderArchitecture`
- `selectArchitectureObject`
- `syncEditableTargetFromSelection`

**Step 4: Run test to verify it passes**

Run: `python3 -m unittest tests/test_system_architecture_module.py`
Expected: PASS

**Step 5: Commit**

```bash
git add frontend/system/architecture.ts frontend/system/index.ts tests/test_system_architecture_module.py

git commit -m "refactor: extract system architecture module"
```

---

### Task 2: Extract governance module

**Files:**
- Create: `frontend/system/governance.ts`
- Modify: `frontend/system/index.ts`
- Test: `tests/test_system_governance_module.py`

**Step 1: Write the failing test**

```python
import unittest

class TestSystemGovernanceModule(unittest.TestCase):
    def test_governance_module_exists(self):
        with open("frontend/system/governance.ts", "r", encoding="utf-8") as handle:
            contents = handle.read()
        self.assertIn("renderGovernance", contents)
        self.assertIn("loadGovernance", contents)
```

**Step 2: Run test to verify it fails**

Run: `python3 -m unittest tests/test_system_governance_module.py`
Expected: FAIL with file not found

**Step 3: Write minimal implementation**

Move governance logic from `index.ts` into `governance.ts`:
- review/change list loading
- review detail loading
- recovery scan
- review packet/chief decision actions
- governance panel render functions

Expose functions:
- `loadGovernance`
- `renderGovernance`
- `renderReviewDetail`

**Step 4: Run test to verify it passes**

Run: `python3 -m unittest tests/test_system_governance_module.py`
Expected: PASS

**Step 5: Commit**

```bash
git add frontend/system/governance.ts frontend/system/index.ts tests/test_system_governance_module.py

git commit -m "refactor: extract system governance module"
```

---

### Task 3: Extract advanced config module

**Files:**
- Create: `frontend/system/advanced_config.ts`
- Modify: `frontend/system/index.ts`
- Test: `tests/test_system_advanced_config_module.py`

**Step 1: Write the failing test**

```python
import unittest

class TestSystemAdvancedConfigModule(unittest.TestCase):
    def test_advanced_config_module_exists(self):
        with open("frontend/system/advanced_config.ts", "r", encoding="utf-8") as handle:
            contents = handle.read()
        self.assertIn("renderAdvancedConfig", contents)
        self.assertIn("loadConfigDocs", contents)
```

**Step 2: Run test to verify it fails**

Run: `python3 -m unittest tests/test_system_advanced_config_module.py`
Expected: FAIL with file not found

**Step 3: Write minimal implementation**

Move advanced config logic from `index.ts` into `advanced_config.ts`:
- team leads / team state docs loading
- workflow designer render + interactions
- expert mode and publish actions

Expose functions:
- `loadConfigDocs`
- `renderAdvancedConfig`
- `ensureWorkflowGraph`

**Step 4: Run test to verify it passes**

Run: `python3 -m unittest tests/test_system_advanced_config_module.py`
Expected: PASS

**Step 5: Commit**

```bash
git add frontend/system/advanced_config.ts frontend/system/index.ts tests/test_system_advanced_config_module.py

git commit -m "refactor: extract advanced config module"
```

---

### Task 4: Update docs and handover

**Files:**
- Modify: `docs/README.md`
- Modify: `docs/handovers/2026-03-15-control-plane-handover.md`

**Step 1: Update docs**

Add the new implementation plan and mention the new module files.

**Step 2: Commit**

```bash
git add docs/README.md docs/handovers/2026-03-15-control-plane-handover.md

git commit -m "docs: record system dashboard modularization"
```
