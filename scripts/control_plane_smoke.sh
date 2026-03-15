#!/bin/bash
set -euo pipefail

API_BASE="${API_BASE:-http://localhost:8888}"
CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"
PWCLI="$CODEX_HOME/skills/playwright/scripts/playwright_cli.sh"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
WORK_DIR="${WORK_DIR:-$REPO_DIR/.tmp/playwright/control-plane-smoke}"

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "missing command: $1" >&2
    exit 1
  }
}

require_cmd curl
require_cmd python3
require_cmd npx

mkdir -p "$WORK_DIR"
cd "$WORK_DIR"
rm -rf .playwright-cli

latest_snapshot() {
  ls -t .playwright-cli/page-*.yml | head -n 1
}

snapshot_session() {
  local session="$1"
  local log_file="$2"
  "$PWCLI" --session "$session" snapshot >"$log_file"
}

ref_from_snapshot() {
  local snapshot_file="$1"
  local regex="$2"
  python3 - "$snapshot_file" "$regex" <<'PY'
import re
import sys

snapshot_path, regex = sys.argv[1], sys.argv[2]
text = open(snapshot_path).read()
match = re.search(regex, text)
if not match:
    raise SystemExit(1)
print(match.group(1))
PY
}

ts="$(date +%Y%m%d-%H%M%S)"
review_incident="INC-SMOKE-$ts"
review_session="rv$ts"
change_session="ch$ts"
architecture_session="ar$ts"
advanced_session="ad$ts"
task_session="tk$ts"
sessions=("$review_session" "$change_session" "$architecture_session" "$advanced_session" "$task_session")

cleanup_session() {
  local session="$1"
  python3 - "$PWCLI" "$session" close <<'PY' >/dev/null 2>&1 || true
import subprocess
import sys

cmd = [sys.argv[1], "--session", sys.argv[2], sys.argv[3]]
try:
    subprocess.run(cmd, check=False, timeout=5)
except Exception:
    pass
PY
  python3 - "$PWCLI" "$session" delete-data <<'PY' >/dev/null 2>&1 || true
import subprocess
import sys

cmd = [sys.argv[1], "--session", sys.argv[2], sys.argv[3]]
try:
    subprocess.run(cmd, check=False, timeout=5)
except Exception:
    pass
PY
}

cleanup_session_processes() {
  python3 - "$WORK_DIR" "${sessions[@]}" <<'PY' >/dev/null 2>&1 || true
import os
import signal
import subprocess
import sys
import time

work_dir = sys.argv[1]
sessions = sys.argv[2:]
markers = [work_dir, ".playwright-cli"] + [f"--daemon-session={session}" for session in sessions]

try:
    output = subprocess.check_output(["ps", "-axo", "pid=,command="], text=True)
except Exception:
    raise SystemExit(0)

targets = []
for line in output.splitlines():
    line = line.strip()
    if not line:
        continue
    parts = line.split(None, 1)
    if len(parts) != 2:
        continue
    pid_s, cmd = parts
    try:
        pid = int(pid_s)
    except ValueError:
        continue
    if pid == os.getpid():
        continue
    if any(marker and marker in cmd for marker in markers):
        targets.append(pid)

for sig in (signal.SIGTERM, signal.SIGKILL):
    for pid in list(targets):
        try:
            os.kill(pid, sig)
        except ProcessLookupError:
            continue
        except Exception:
            continue
    time.sleep(0.2)
PY
}

cleanup() {
  set +e
  for session in "${sessions[@]}"; do
    cleanup_session "$session"
  done
  cleanup_session_processes
}

trap cleanup EXIT INT TERM

task_payload="$(cat <<JSON
{"actor_id":"dashboard-ui","actor_role":"admin","task_name":"Control plane smoke $ts","description":"Browser smoke task","task_type":"general","owner":"rd_lead","team":"team-rd","task_pool":"intake_pool","dispatch_state":"dispatched","status":"in_progress","business_bound":true,"requirements":{"deliverables":[{"stage":"PRD","owner":"rd_lead","owner_role":"lead","description":"Draft PRD"},{"stage":"BUILD","owner":"developer","owner_role":"developer","description":"Implement changes"}]}}
JSON
)"
task_json="$(curl -sS -X POST "$API_BASE/api/tasks" -H 'Content-Type: application/json' -d "$task_payload")"
task_id="$(printf '%s' "$task_json" | python3 -c 'import json,sys; print(json.loads(sys.stdin.read())["task_id"])')"

change_payload="$(cat <<JSON
{"title":"Smoke change $ts","description":"Validate change deep-link and detail view","scope":"shared","impact_targets":["task_dashboard","system_dashboard"],"at_risk_tasks":["$task_id"],"rollback_plan":"revert smoke change","actor_id":"luban","actor_role":"admin"}
JSON
)"
change_json="$(curl -sS -X POST "$API_BASE/api/change-tasks" -H 'Content-Type: application/json' -d "$change_payload")"
change_id="$(printf '%s' "$change_json" | python3 -c 'import json,sys; print(json.loads(sys.stdin.read())["change_id"])')"

review_payload="$(cat <<JSON
{"title":"Smoke review $ts","submission_bundle":{"incident_key":"$review_incident","summary":"Validate review deep-link and seat rendering","artifacts":[{"path":"/tmp/$review_incident.md"}],"target_task_id":"$task_id"},"actor_id":"main","actor_role":"admin"}
JSON
)"
review_json="$(curl -sS -X POST "$API_BASE/api/reviews" -H 'Content-Type: application/json' -d "$review_payload")"
review_id="$(printf '%s' "$review_json" | python3 -c 'import json,sys; print(json.loads(sys.stdin.read())["review_id"])')"

"$PWCLI" --session "$review_session" open "$API_BASE/system_dashboard.html?subview=governance&governance=review&review_id=$review_id" >/tmp/ocp-smoke-review-open.log
review_snapshot=""
for _ in 1 2 3 4 5 6; do
  sleep 1
  "$PWCLI" --session "$review_session" snapshot >/tmp/ocp-smoke-review-snap.log
  review_snapshot="$(ls -t .playwright-cli/page-*.yml | head -n 1)"
  if rg -q "$review_id" "$review_snapshot" && rg -q "治理中心" "$review_snapshot" && rg -q "审查详情" "$review_snapshot"; then
    break
  fi
done
rg -q "$review_id" "$review_snapshot"
rg -q "治理中心" "$review_snapshot"
rg -q "审查详情" "$review_snapshot"
! rg -q "团队 Lead 配置" "$review_snapshot"
! rg -q "团队状态机配置" "$review_snapshot"

"$PWCLI" --session "$change_session" open "$API_BASE/system_dashboard.html?subview=governance&governance=change&change_id=$change_id" >/tmp/ocp-smoke-change-open.log
change_snapshot=""
for _ in 1 2 3 4 5 6; do
  sleep 1
  "$PWCLI" --session "$change_session" snapshot >/tmp/ocp-smoke-change-snap.log
  change_snapshot="$(ls -t .playwright-cli/page-*.yml | head -n 1)"
  if rg -q "$change_id" "$change_snapshot" && rg -q "治理中心" "$change_snapshot" && rg -q "变更详情与发布审计" "$change_snapshot"; then
    break
  fi
done
rg -q "$change_id" "$change_snapshot"
rg -q "治理中心" "$change_snapshot"
rg -q "变更详情与发布审计" "$change_snapshot"
! rg -q "团队 Lead 配置" "$change_snapshot"
! rg -q "团队状态机配置" "$change_snapshot"

"$PWCLI" --session "$architecture_session" open "$API_BASE/system_dashboard.html?subview=architecture" >/tmp/ocp-smoke-architecture-open.log
sleep 2
snapshot_session "$architecture_session" /tmp/ocp-smoke-architecture-pre-snap.log
architecture_pre_snapshot="$(latest_snapshot)"
team_ref="$(ref_from_snapshot "$architecture_pre_snapshot" 'generic \[ref=(e\d+)\]: 研发团队')"
"$PWCLI" --session "$architecture_session" click "$team_ref" >/tmp/ocp-smoke-architecture-team-click.log
sleep 1
snapshot_session "$architecture_session" /tmp/ocp-smoke-architecture-team-snap.log
architecture_team_snapshot="$(ls -t .playwright-cli/page-*.yml | head -n 1)"
rg -q "对象详情" "$architecture_team_snapshot"
rg -q "team-rd" "$architecture_team_snapshot"
rg -q "当前可编辑对象" "$architecture_team_snapshot"
rg -q "进入配置" "$architecture_team_snapshot"

enter_config_ref="$(ref_from_snapshot "$architecture_team_snapshot" 'button "进入配置" \[ref=(e\d+)\]')"
"$PWCLI" --session "$architecture_session" click "$enter_config_ref" >/tmp/ocp-smoke-architecture-open-config.log
sleep 2
snapshot_session "$architecture_session" /tmp/ocp-smoke-architecture-config-snap.log
architecture_config_snapshot="$(ls -t .playwright-cli/page-*.yml | head -n 1)"
rg -q "高级配置" "$architecture_config_snapshot"
rg -q "流程设计器" "$architecture_config_snapshot"
rg -q "当前团队" "$architecture_config_snapshot"
rg -q "ANALYZING" "$architecture_config_snapshot"
! rg -q "团队负责人" "$architecture_config_snapshot"

edge_ref="$(ref_from_snapshot "$architecture_config_snapshot" 'article \[ref=(e\d+)\][^\n]*\n\s*- generic \[ref=e\d+\]:\n\s*- generic \[ref=e\d+\]: ANALYZING -> DESIGNING')"
"$PWCLI" --session "$architecture_session" click "$edge_ref" >/tmp/ocp-smoke-workflow-edge-click.log
sleep 1
snapshot_session "$architecture_session" /tmp/ocp-smoke-workflow-edge-snap.log
workflow_edge_snapshot="$(latest_snapshot)"
edge_condition_ref="$(ref_from_snapshot "$workflow_edge_snapshot" 'generic \[ref=e\d+\]: 条件块\n\s*- combobox \[ref=(e\d+)\]')"
"$PWCLI" --session "$architecture_session" select "$edge_condition_ref" "通过" >/tmp/ocp-smoke-workflow-edge-edit.log
sleep 1
snapshot_session "$architecture_session" /tmp/ocp-smoke-workflow-save-pre-snap.log
workflow_save_snapshot="$(latest_snapshot)"
save_workflow_ref="$(ref_from_snapshot "$workflow_save_snapshot" 'button "保存草稿" \[ref=(e\d+)\]')"
"$PWCLI" --session "$architecture_session" click "$save_workflow_ref" >/tmp/ocp-smoke-workflow-save.log
"$PWCLI" --session "$architecture_session" dialog-accept >/tmp/ocp-smoke-workflow-save-accept.log
sleep 2
"$PWCLI" --session "$architecture_session" open "$API_BASE/system_dashboard.html?subview=advanced-config&object_type=team&object_id=team-rd&target_type=team&target_id=team-rd&mode=workflow-designer" >/tmp/ocp-smoke-workflow-reopen.log
sleep 2
snapshot_session "$architecture_session" /tmp/ocp-smoke-workflow-reopen-snap.log
workflow_reopen_snapshot="$(ls -t .playwright-cli/page-*.yml | head -n 1)"
rg -q "流程设计器" "$workflow_reopen_snapshot"
rg -q "ANALYZING -> DESIGNING" "$workflow_reopen_snapshot"
rg -q "通过" "$workflow_reopen_snapshot"

"$PWCLI" --session "$architecture_session" open "$API_BASE/system_dashboard.html?subview=architecture" >/tmp/ocp-smoke-architecture-reopen.log
sleep 2
"$PWCLI" --session "$architecture_session" open "$API_BASE/system_dashboard.html?subview=architecture&object_type=member&object_id=coordinator" >/tmp/ocp-smoke-architecture-member-click.log
sleep 2
snapshot_session "$architecture_session" /tmp/ocp-smoke-architecture-member-snap.log
architecture_member_snapshot="$(ls -t .playwright-cli/page-*.yml | head -n 1)"
rg -q "coordinator" "$architecture_member_snapshot"
rg -q "该成员无独立底层配置" "$architecture_member_snapshot"
rg -q "team-rd" "$architecture_member_snapshot"

"$PWCLI" --session "$advanced_session" open "$API_BASE/system_dashboard.html?subview=advanced-config" >/tmp/ocp-smoke-advanced-open.log
advanced_snapshot=""
for _ in 1 2 3 4 5 6; do
  sleep 1
  snapshot_session "$advanced_session" /tmp/ocp-smoke-advanced-snap.log
  advanced_snapshot="$(ls -t .playwright-cli/page-*.yml | head -n 1)"
  if rg -q "高级配置" "$advanced_snapshot" && rg -q "当前未选中任何对象" "$advanced_snapshot" && rg -q "请先从架构关系图选择团队/角色" "$advanced_snapshot"; then
    break
  fi
done
rg -q "高级配置" "$advanced_snapshot"
rg -q "当前未选中任何对象" "$advanced_snapshot"
rg -q "请先从架构关系图选择团队/角色" "$advanced_snapshot"
! rg -q "团队负责人" "$advanced_snapshot"
! rg -q "团队流程状态机" "$advanced_snapshot"

"$PWCLI" --session "$task_session" open "$API_BASE/task_dashboard.html?task_id=$task_id" >/tmp/ocp-smoke-task-open.log
sleep 3
"$PWCLI" --session "$task_session" snapshot >/tmp/ocp-smoke-task-snap-1.log
task_snapshot_1="$(ls -t .playwright-cli/page-*.yml | head -n 1)"
rg -q "$task_id" "$task_snapshot_1"
rg -q "缺少业务真相源" "$task_snapshot_1"
rg -q "阶段交接与产物操作" "$task_snapshot_1"

"$PWCLI" --session "$task_session" eval "document.getElementById('artifactPathInput').value='/tmp/$task_id-prd.md',document.getElementById('artifactSummaryInput').value='Smoke artifact from control_plane_smoke.sh',document.getElementById('addArtifactBtn').click(),1" >/tmp/ocp-smoke-artifact.log
"$PWCLI" --session "$task_session" dialog-accept >/tmp/ocp-smoke-artifact-accept.log

"$PWCLI" --session "$task_session" eval "document.getElementById('handoffNextOwnerInput').value='developer',document.getElementById('handoffNoteInput').value='Smoke handoff',document.getElementById('handoffArtifactSummaryInput').value='Smoke PRD ready for build',document.getElementById('handoffStageBtn').click(),1" >/tmp/ocp-smoke-handoff.log
"$PWCLI" --session "$task_session" dialog-accept >/tmp/ocp-smoke-handoff-accept.log

sleep 2
"$PWCLI" --session "$task_session" snapshot >/tmp/ocp-smoke-task-snap-2.log
task_snapshot_2="$(ls -t .playwright-cli/page-*.yml | head -n 1)"
rg -q "阶段2" "$task_snapshot_2"
rg -q "Smoke artifact from control_plane_smoke.sh" "$task_snapshot_2"

detail_json="$(curl -sS "$API_BASE/api/task/detail?task_id=$task_id")"
printf '%s' "$detail_json" | python3 -c 'import json, sys; d = json.loads(sys.stdin.read()); task_id = sys.argv[1]; artifacts = d.get("artifact_index") or []; assert any(item.get("path") == f"/tmp/{task_id}-prd.md" for item in artifacts), artifacts; cards = d.get("stage_cards") or []; assert cards and cards[0].get("status") == "completed", cards; assert len(cards) > 1 and cards[1].get("status") == "assigned", cards; assert d.get("next_agent") == "developer", d.get("next_agent")' "$task_id"

python3 - <<'PY'
from pathlib import Path
root = Path('.playwright-cli')
for path in root.glob('console-*.log'):
    text = path.read_text(errors='ignore')
    if '[ERROR]' in text and 'favicon.ico' not in text:
        raise SystemExit(f'unexpected console errors found in {path}')
PY

cat <<EOF
smoke_ok
task_id=$task_id
change_id=$change_id
review_id=$review_id
work_dir=$WORK_DIR
EOF
