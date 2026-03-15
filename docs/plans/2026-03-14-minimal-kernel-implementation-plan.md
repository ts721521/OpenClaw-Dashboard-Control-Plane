# Minimal Kernel Implementation Plan

> Historical implementation plan for the first kernel. For current architecture, active state, and remaining gaps, read [2026-03-15-openclaw-control-plane-architecture.md](/Users/tianshuai/Documents/GitHub/OpenClaw-Dashboard-Control-Plane/docs/plans/2026-03-15-openclaw-control-plane-architecture.md) and [2026-03-15-control-plane-handover.md](/Users/tianshuai/Documents/GitHub/OpenClaw-Dashboard-Control-Plane/docs/handovers/2026-03-15-control-plane-handover.md).

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build the first-phase OpenClaw minimal control-plane kernel so governance, review, and execution stop competing through loose scripts and shared state.

**Architecture:** Keep one shared control plane as the only truth source, split runtime into a governance Claw and an RD Claw, and move review, change, and recovery flows under explicit task/state objects. Freeze legacy routes first, then introduce the new pools, review lifecycle, and versioned publish gate in small verified steps.

**Tech Stack:** Python dashboard server, SQLite task store, HTML dashboards, shell integration scripts, OpenClaw gateway/session runtime, Markdown governance docs.

---

### Task 1: Freeze legacy execution entrypoints

**Files:**
- Modify: `/Users/tianshuai/Documents/GitHub/OpenClaw-Dashboard-Control-Plane/server.py`
- Modify: `/Users/tianshuai/.openclaw/gateway/routing.json`
- Modify: `/Users/tianshuai/Documents/GitHub/OpenClaw-Dashboard-Control-Plane/AGENTS.md`
- Read: `/Users/tianshuai/.openclaw/workspace/TOOLS.md`

**Step 1: Write the failing tests**

Add service tests proving:

- non-core pools or teams cannot receive new active work
- legacy routes no longer map new work to `pangu`, `proposal`, `smart3d`, or other retired lanes

**Step 2: Run tests to verify they fail**

Run:

```bash
cd /Users/tianshuai/Documents/GitHub/OpenClaw-Dashboard-Control-Plane
python3 -m unittest tests/test_dashboard_data_service.py
```

Expected: FAIL because legacy routes and team definitions are still active.

**Step 3: Write minimal implementation**

Implement:

- freeze/retire flags for non-core teams
- route filtering so only governance core and `team-rd` remain active for new tasks
- docs update in `AGENTS.md` to reflect the new active topology

**Step 4: Run tests to verify they pass**

Run:

```bash
cd /Users/tianshuai/Documents/GitHub/OpenClaw-Dashboard-Control-Plane
python3 -m unittest tests/test_dashboard_data_service.py
```

Expected: PASS with non-core active routing disabled.

**Step 5: Commit**

```bash
git add /Users/tianshuai/Documents/GitHub/OpenClaw-Dashboard-Control-Plane/server.py /Users/tianshuai/.openclaw/gateway/routing.json /Users/tianshuai/Documents/GitHub/OpenClaw-Dashboard-Control-Plane/AGENTS.md
git commit -m "feat: freeze legacy routes for minimal kernel"
```

### Task 2: Introduce task pools and dispatch locks

**Files:**
- Modify: `/Users/tianshuai/Documents/GitHub/OpenClaw-Dashboard-Control-Plane/task_repository.py`
- Modify: `/Users/tianshuai/Documents/GitHub/OpenClaw-Dashboard-Control-Plane/server.py`
- Modify: `/Users/tianshuai/Documents/GitHub/OpenClaw-Dashboard-Control-Plane/task_dashboard.html`
- Test: `/Users/tianshuai/Documents/GitHub/OpenClaw-Dashboard-Control-Plane/tests/test_dashboard_data_service.py`

**Step 1: Write the failing tests**

Cover:

- `intake_pool`, `team_dispatch_pool`, `governance_pool`, `review_pool`, `recovery_pool`
- only one active lease per task or stage
- `main` creates but does not directly claim governance or team execution work

**Step 2: Run test to verify it fails**

Run:

```bash
cd /Users/tianshuai/Documents/GitHub/OpenClaw-Dashboard-Control-Plane
python3 -m unittest tests/test_dashboard_data_service.py
```

Expected: FAIL because task pools and lease policy are not modeled yet.

**Step 3: Write minimal implementation**

Implement:

- pool fields in SQLite
- dispatch and claim rules by role
- lease fields and validation
- task center UI sections or filters by pool

**Step 4: Run test to verify it passes**

Run:

```bash
cd /Users/tianshuai/Documents/GitHub/OpenClaw-Dashboard-Control-Plane
python3 -m unittest tests/test_dashboard_data_service.py
```

Expected: PASS with deterministic pool assignment and claim behavior.

**Step 5: Commit**

```bash
git add /Users/tianshuai/Documents/GitHub/OpenClaw-Dashboard-Control-Plane/task_repository.py /Users/tianshuai/Documents/GitHub/OpenClaw-Dashboard-Control-Plane/server.py /Users/tianshuai/Documents/GitHub/OpenClaw-Dashboard-Control-Plane/task_dashboard.html /Users/tianshuai/Documents/GitHub/OpenClaw-Dashboard-Control-Plane/tests/test_dashboard_data_service.py
git commit -m "feat: add task pools and dispatch leases"
```

### Task 3: Add parent task and stage card state machine

**Files:**
- Modify: `/Users/tianshuai/Documents/GitHub/OpenClaw-Dashboard-Control-Plane/task_repository.py`
- Modify: `/Users/tianshuai/Documents/GitHub/OpenClaw-Dashboard-Control-Plane/server.py`
- Modify: `/Users/tianshuai/Documents/GitHub/OpenClaw-Dashboard-Control-Plane/task_dashboard.html`
- Test: `/Users/tianshuai/Documents/GitHub/OpenClaw-Dashboard-Control-Plane/tests/test_dashboard_data_service.py`

**Step 1: Write the failing tests**

Cover:

- complex task creates a parent task and stage cards
- stage transitions require handoff note and next owner
- rework points to an explicit prior stage
- no direct jump to completed without gate evidence

**Step 2: Run test to verify it fails**

Run:

```bash
cd /Users/tianshuai/Documents/GitHub/OpenClaw-Dashboard-Control-Plane
python3 -m unittest tests/test_dashboard_data_service.py
```

Expected: FAIL because stage-card lifecycle is not enforced.

**Step 3: Write minimal implementation**

Implement:

- parent task and stage-card data model
- lifecycle endpoints for start, handoff, rework, complete
- UI rendering of stage cards and handoff state

**Step 4: Run test to verify it passes**

Run:

```bash
cd /Users/tianshuai/Documents/GitHub/OpenClaw-Dashboard-Control-Plane
python3 -m unittest tests/test_dashboard_data_service.py
```

Expected: PASS with enforced handoff and rework semantics.

**Step 5: Commit**

```bash
git add /Users/tianshuai/Documents/GitHub/OpenClaw-Dashboard-Control-Plane/task_repository.py /Users/tianshuai/Documents/GitHub/OpenClaw-Dashboard-Control-Plane/server.py /Users/tianshuai/Documents/GitHub/OpenClaw-Dashboard-Control-Plane/task_dashboard.html /Users/tianshuai/Documents/GitHub/OpenClaw-Dashboard-Control-Plane/tests/test_dashboard_data_service.py
git commit -m "feat: add parent task and stage-card lifecycle"
```

### Task 4: Move Braintrust review under the control plane

**Files:**
- Modify: `/Users/tianshuai/Documents/GitHub/OpenClaw-Dashboard-Control-Plane/task_repository.py`
- Modify: `/Users/tianshuai/Documents/GitHub/OpenClaw-Dashboard-Control-Plane/server.py`
- Modify: `/Users/tianshuai/Documents/GitHub/OpenClaw-Dashboard-Control-Plane/task_dashboard.html`
- Modify: `/Users/tianshuai/.openclaw/workspace/scripts/submit_to_braintrust.sh`
- Modify: `/Users/tianshuai/.openclaw/workspace/scripts/record_braintrust_review_packet.sh`
- Test: `/Users/tianshuai/Documents/GitHub/OpenClaw-Dashboard-Control-Plane/tests/test_dashboard_data_service.py`

**Step 1: Write the failing tests**

Cover:

- review task requires `submission_bundle`
- reviewer packets write directly to the control plane store
- duplicate incidents coalesce into one active review task
- chief decision requires `next_action` and `next_owner`

**Step 2: Run test to verify it fails**

Run:

```bash
cd /Users/tianshuai/Documents/GitHub/OpenClaw-Dashboard-Control-Plane
python3 -m unittest tests/test_dashboard_data_service.py
```

Expected: FAIL because review state still depends on legacy queue files and packet scripts.

**Step 3: Write minimal implementation**

Implement:

- review task tables and APIs
- bundle validation
- packet ingestion endpoint
- chief decision endpoint
- compatibility wrappers in shell scripts that call the new APIs instead of writing loose files

**Step 4: Run test to verify it passes**

Run:

```bash
cd /Users/tianshuai/Documents/GitHub/OpenClaw-Dashboard-Control-Plane
python3 -m unittest tests/test_dashboard_data_service.py
```

Expected: PASS with review lifecycle managed in the control plane.

**Step 5: Commit**

```bash
git add /Users/tianshuai/Documents/GitHub/OpenClaw-Dashboard-Control-Plane/task_repository.py /Users/tianshuai/Documents/GitHub/OpenClaw-Dashboard-Control-Plane/server.py /Users/tianshuai/Documents/GitHub/OpenClaw-Dashboard-Control-Plane/task_dashboard.html /Users/tianshuai/.openclaw/workspace/scripts/submit_to_braintrust.sh /Users/tianshuai/.openclaw/workspace/scripts/record_braintrust_review_packet.sh /Users/tianshuai/Documents/GitHub/OpenClaw-Dashboard-Control-Plane/tests/test_dashboard_data_service.py
git commit -m "feat: move braintrust review under control plane"
```

### Task 5: Add change-task publish gate and version locking

**Files:**
- Modify: `/Users/tianshuai/Documents/GitHub/OpenClaw-Dashboard-Control-Plane/task_repository.py`
- Modify: `/Users/tianshuai/Documents/GitHub/OpenClaw-Dashboard-Control-Plane/server.py`
- Modify: `/Users/tianshuai/Documents/GitHub/OpenClaw-Dashboard-Control-Plane/system_dashboard.html`
- Test: `/Users/tianshuai/Documents/GitHub/OpenClaw-Dashboard-Control-Plane/tests/test_dashboard_data_service.py`

**Step 1: Write the failing tests**

Cover:

- shared/global changes require impact check and publish approval
- in-flight tasks bind `workflow_version` and `routing_version`
- new change defaults to affecting only new tasks
- P0 override leaves audit evidence

**Step 2: Run test to verify it fails**

Run:

```bash
cd /Users/tianshuai/Documents/GitHub/OpenClaw-Dashboard-Control-Plane
python3 -m unittest tests/test_dashboard_data_service.py
```

Expected: FAIL because change publication and version locks are not enforced.

**Step 3: Write minimal implementation**

Implement:

- change-task schema and APIs
- impact report storage
- publish gate UI and audit
- version binding on task start

**Step 4: Run test to verify it passes**

Run:

```bash
cd /Users/tianshuai/Documents/GitHub/OpenClaw-Dashboard-Control-Plane
python3 -m unittest tests/test_dashboard_data_service.py
```

Expected: PASS with gated shared-rule changes and task version locks.

**Step 5: Commit**

```bash
git add /Users/tianshuai/Documents/GitHub/OpenClaw-Dashboard-Control-Plane/task_repository.py /Users/tianshuai/Documents/GitHub/OpenClaw-Dashboard-Control-Plane/server.py /Users/tianshuai/Documents/GitHub/OpenClaw-Dashboard-Control-Plane/system_dashboard.html /Users/tianshuai/Documents/GitHub/OpenClaw-Dashboard-Control-Plane/tests/test_dashboard_data_service.py
git commit -m "feat: add change publish gate and version locking"
```

### Task 6: Add runtime recovery and stalled-state handling

**Files:**
- Modify: `/Users/tianshuai/Documents/GitHub/OpenClaw-Dashboard-Control-Plane/server.py`
- Modify: `/Users/tianshuai/Documents/GitHub/OpenClaw-Dashboard-Control-Plane/task_dashboard.html`
- Modify: `/Users/tianshuai/Documents/GitHub/OpenClaw-Dashboard-Control-Plane/system_dashboard.html`
- Test: `/Users/tianshuai/Documents/GitHub/OpenClaw-Dashboard-Control-Plane/tests/test_dashboard_data_service.py`

**Step 1: Write the failing tests**

Cover:

- active task becomes `suspected_stalled` then `stalled`
- stalled review enters `recovery_pool`
- `luban` reclaim or redispatch action is auditable

**Step 2: Run test to verify it fails**

Run:

```bash
cd /Users/tianshuai/Documents/GitHub/OpenClaw-Dashboard-Control-Plane
python3 -m unittest tests/test_dashboard_data_service.py
```

Expected: FAIL because recovery semantics are incomplete.

**Step 3: Write minimal implementation**

Implement:

- stalled-state transitions based on heartbeat and progress windows
- recovery actions and audit trails
- UI badges, alerts, and filters for stalled and recovery work

**Step 4: Run test to verify it passes**

Run:

```bash
cd /Users/tianshuai/Documents/GitHub/OpenClaw-Dashboard-Control-Plane
python3 -m unittest tests/test_dashboard_data_service.py
```

Expected: PASS with stalled-state and recovery behavior visible in the control plane.

**Step 5: Commit**

```bash
git add /Users/tianshuai/Documents/GitHub/OpenClaw-Dashboard-Control-Plane/server.py /Users/tianshuai/Documents/GitHub/OpenClaw-Dashboard-Control-Plane/task_dashboard.html /Users/tianshuai/Documents/GitHub/OpenClaw-Dashboard-Control-Plane/system_dashboard.html /Users/tianshuai/Documents/GitHub/OpenClaw-Dashboard-Control-Plane/tests/test_dashboard_data_service.py
git commit -m "feat: add stalled-state recovery handling"
```

### Task 7: Verify docs and runtime alignment

**Files:**
- Modify: `/Users/tianshuai/Documents/GitHub/OpenClaw-Dashboard-Control-Plane/AGENTS.md`
- Read: `/Users/tianshuai/Documents/GitHub/OpenClaw-Dashboard-Control-Plane/docs/plans/2026-03-14-openclaw-control-plane-prd.md`
- Read: `/Users/tianshuai/Documents/GitHub/OpenClaw-Dashboard-Control-Plane/docs/plans/2026-03-14-braintrust-review-system-prd.md`
- Read: `/Users/tianshuai/Documents/GitHub/OpenClaw-Dashboard-Control-Plane/docs/plans/2026-03-14-constitution-runtime-mapping-spec.md`
- Read: `/Users/tianshuai/Documents/GitHub/OpenClaw-Dashboard-Control-Plane/docs/plans/2026-03-14-minimal-kernel-implementation-plan.md`

**Step 1: Run full verification**

Run:

```bash
cd /Users/tianshuai/Documents/GitHub/OpenClaw-Dashboard-Control-Plane
python3 -m py_compile server.py task_repository.py
python3 -m unittest tests/test_dashboard_data_service.py
bash -n /Users/tianshuai/.openclaw/workspace/scripts/submit_to_braintrust.sh
bash -n /Users/tianshuai/.openclaw/workspace/scripts/record_braintrust_review_packet.sh
```

Expected: all checks pass.

**Step 2: Update runtime operator docs**

Align `AGENTS.md` with:

- dual-Claw topology
- active pools
- review flow under the control plane
- change-task publish gate

**Step 3: Commit**

```bash
git add /Users/tianshuai/Documents/GitHub/OpenClaw-Dashboard-Control-Plane/AGENTS.md /Users/tianshuai/Documents/GitHub/OpenClaw-Dashboard-Control-Plane /Users/tianshuai/.openclaw/workspace/scripts
git commit -m "docs: align runtime docs with minimal kernel"
```
