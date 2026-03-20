#!/bin/bash
set -euo pipefail

API_BASE="${API_BASE:-http://localhost:8888}"
CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"
PWCLI="$CODEX_HOME/skills/playwright/scripts/playwright_cli.sh"
WORK_DIR="${WORK_DIR:-/Users/tianshuai/.openclaw/output/playwright/control-plane-smoke}"

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "missing command: $1" >&2
    exit 1
  }
}

require_cmd curl
require_cmd python3
require_cmd rg

mkdir -p "$WORK_DIR"
cd "$WORK_DIR"
rm -rf .playwright-cli

wait_for_health() {
  local tries="${1:-30}"
  local url="$API_BASE/api/health"
  for _ in $(seq 1 "$tries"); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  echo "dashboard health check failed: $url" >&2
  return 1
}

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
text = open(snapshot_path, encoding="utf-8").read()
match = re.search(regex, text, re.S)
if not match:
    raise SystemExit(1)
print(match.group(1))
PY
}

ts="$(date +%Y%m%d-%H%M%S)"
architecture_session="ar$ts"
inter_team_session="it$ts"
team_workflow_session="tw$ts"
flow_detail_session="fd$ts"
task_session="tk$ts"
sessions=("$architecture_session" "$inter_team_session" "$team_workflow_session" "$flow_detail_session" "$task_session")
task_id=""

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
  if [[ -n "${task_id:-}" ]]; then
    curl -sS -X POST "$API_BASE/api/task/delete" \
      -H 'Content-Type: application/json' \
      -d "{\"task_id\":\"$task_id\",\"operator\":\"control_plane_smoke\",\"reason\":\"smoke cleanup\",\"operator_role\":\"admin\"}" >/dev/null 2>&1 || true
  fi
  cleanup_session_processes
}

trap cleanup EXIT INT TERM

wait_for_health 30

fixture_json="$(python3 - "$API_BASE" <<'PY'
import json
import urllib.request
import sys

base = sys.argv[1]
teams = json.load(urllib.request.urlopen(f"{base}/api/teams"))["teams"]
flows = json.load(urllib.request.urlopen(f"{base}/api/flows"))["flows"]
if not teams:
    raise SystemExit("no teams found")
team = teams[0]
second = teams[1] if len(teams) > 1 else team
flow_ids = [flow["flow_id"] for flow in flows if flow.get("flow_type") == "team"]
payload = {
    "team_id": team["team_id"],
    "team_name": team["team_name"],
    "lead_id": team.get("lead", {}).get("agent_id") or "main",
    "second_team_id": second["team_id"],
    "second_team_name": second["team_name"],
    "team_flow_id": f"team:{team['team_id']}",
    "default_inter_team_flow": "inter-team:default",
    "available_flow_id": flow_ids[0] if flow_ids else f"team:{team['team_id']}",
}
print(json.dumps(payload, ensure_ascii=False))
PY
)"

team_id="$(printf '%s' "$fixture_json" | python3 -c 'import json,sys; print(json.loads(sys.stdin.read())["team_id"])')"
team_name="$(printf '%s' "$fixture_json" | python3 -c 'import json,sys; print(json.loads(sys.stdin.read())["team_name"])')"
lead_id="$(printf '%s' "$fixture_json" | python3 -c 'import json,sys; print(json.loads(sys.stdin.read())["lead_id"])')"
second_team_name="$(printf '%s' "$fixture_json" | python3 -c 'import json,sys; print(json.loads(sys.stdin.read())["second_team_name"])')"
team_flow_id="$(printf '%s' "$fixture_json" | python3 -c 'import json,sys; print(json.loads(sys.stdin.read())["team_flow_id"])')"
inter_team_flow_id="$(printf '%s' "$fixture_json" | python3 -c 'import json,sys; print(json.loads(sys.stdin.read())["default_inter_team_flow"])')"

task_payload="$(cat <<JSON
{"actor_id":"dashboard-ui","actor_role":"admin","task_name":"Control plane smoke $ts","description":"Browser smoke task","task_type":"general","owner":"$lead_id","team":"$team_id","team_flow":["$team_id"],"task_pool":"intake_pool","dispatch_state":"dispatched","status":"in_progress","business_bound":true,"requirements":{"deliverables":[{"stage":"PRD","owner":"$lead_id","owner_role":"lead","description":"Draft PRD"}]}}
JSON
)"
task_json="$(curl -sS -X POST "$API_BASE/api/tasks" -H 'Content-Type: application/json' -d "$task_payload")"
task_id="$(printf '%s' "$task_json" | python3 -c 'import json,sys; print(json.loads(sys.stdin.read())["task_id"])')"

"$PWCLI" --session "$architecture_session" open "$API_BASE/system_dashboard.html?subview=architecture" >/tmp/ocp-smoke-architecture-open.log
sleep 2
architecture_snapshot="$(latest_snapshot)"
rg -q "架构关系图" "$architecture_snapshot"
rg -q "团队间流程" "$architecture_snapshot"
rg -q "团队内流程" "$architecture_snapshot"
rg -q "流程详情" "$architecture_snapshot"
rg -q "$team_name" "$architecture_snapshot"
! rg -q "治理中心" "$architecture_snapshot"
! rg -q "高级配置" "$architecture_snapshot"

"$PWCLI" --session "$inter_team_session" open "$API_BASE/system_dashboard.html?subview=inter-team-flow&team_id=$team_id" >/tmp/ocp-smoke-inter-team-open.log
sleep 2
inter_team_snapshot="$(latest_snapshot)"
rg -q "团队间流程" "$inter_team_snapshot"
rg -q "$team_name" "$inter_team_snapshot"
rg -q "$second_team_name" "$inter_team_snapshot"
rg -q "查看该团队任务" "$inter_team_snapshot"

team_tasks_ref="$(ref_from_snapshot "$inter_team_snapshot" 'link "查看该团队任务" \[ref=(e\d+)\]')"
"$PWCLI" --session "$inter_team_session" click "$team_tasks_ref" >/tmp/ocp-smoke-inter-team-click.log
sleep 2
inter_team_task_snapshot="$(latest_snapshot)"
rg -q "任务管理中心" "$inter_team_task_snapshot"
rg -q "$task_id" "$inter_team_task_snapshot"

"$PWCLI" --session "$team_workflow_session" open "$API_BASE/system_dashboard.html?subview=team-workflow&target_id=$team_id" >/tmp/ocp-smoke-team-workflow-open.log
sleep 2
team_workflow_snapshot="$(latest_snapshot)"
rg -q "团队内流程" "$team_workflow_snapshot"
rg -q "$team_name" "$team_workflow_snapshot"
rg -q "查看流程详情" "$team_workflow_snapshot"

encoded_team_flow_id="$(python3 - "$team_flow_id" <<'PY'
import sys
import urllib.parse

print(urllib.parse.quote(sys.argv[1], safe=""))
PY
)"
"$PWCLI" --session "$flow_detail_session" open "$API_BASE/system_dashboard.html?subview=flow-detail&flow_id=$encoded_team_flow_id" >/tmp/ocp-smoke-flow-detail-open.log
sleep 2
flow_detail_snapshot="$(latest_snapshot)"
rg -q "流程详情" "$flow_detail_snapshot"
rg -q "流程摘要" "$flow_detail_snapshot"
rg -q "结构与上下游" "$flow_detail_snapshot"
rg -q "校验结果" "$flow_detail_snapshot"
rg -q "关联任务" "$flow_detail_snapshot"
rg -q "查看全部关联任务" "$flow_detail_snapshot"

"$PWCLI" --session "$task_session" open "$API_BASE/task_dashboard.html?task_id=$task_id" >/tmp/ocp-smoke-task-open.log
sleep 3
task_snapshot_1="$(latest_snapshot)"
rg -q "$task_id" "$task_snapshot_1"
rg -q "运行态" "$task_snapshot_1"
rg -q "实时数据" "$task_snapshot_1"
rg -q "Gate" "$task_snapshot_1"
rg -q "缺少业务真相源" "$task_snapshot_1"
rg -q "阶段交接与产物操作" "$task_snapshot_1"

curl -sS -X POST "$API_BASE/api/tasks/$task_id/artifact" \
  -H 'Content-Type: application/json' \
  -d "{\"actor_id\":\"control_plane_smoke\",\"actor_role\":\"admin\",\"artifact\":{\"artifact_type\":\"阶段1\",\"version\":\"v1\",\"path\":\"/tmp/$task_id-prd.md\",\"summary\":\"Smoke artifact from control_plane_smoke.sh\",\"producer\":\"$lead_id\"}}" >/tmp/ocp-smoke-artifact.log

curl -sS -X POST "$API_BASE/api/tasks/$task_id/stage/1/handoff" \
  -H 'Content-Type: application/json' \
  -d "{\"actor_id\":\"control_plane_smoke\",\"actor_role\":\"admin\",\"handoff_note\":\"Smoke handoff\",\"artifact_summary\":\"Smoke PRD ready for build\",\"next_owner\":\"developer\"}" >/tmp/ocp-smoke-handoff.log

"$PWCLI" --session "$task_session" open "$API_BASE/task_dashboard.html?task_id=$task_id" >/tmp/ocp-smoke-task-reopen.log
sleep 3
task_snapshot_2="$(latest_snapshot)"
rg -q "Smoke artifact from control_plane_smoke.sh" "$task_snapshot_2"

detail_json="$(curl -sS "$API_BASE/api/task/detail?task_id=$task_id")"
printf '%s' "$detail_json" | python3 -c 'import json, sys; d = json.loads(sys.stdin.read()); task_id = sys.argv[1]; artifacts = d.get("artifact_index") or []; assert any(item.get("path") == f"/tmp/{task_id}-prd.md" for item in artifacts), artifacts; cards = d.get("stage_cards") or []; assert cards and cards[0].get("status") == "completed", cards; assert cards[0].get("next_owner") == "developer", cards[0]' "$task_id"

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
team_id=$team_id
inter_team_flow_id=$inter_team_flow_id
work_dir=$WORK_DIR
EOF
