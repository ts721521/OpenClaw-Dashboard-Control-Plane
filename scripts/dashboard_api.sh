#!/bin/bash
# dashboard_api.sh - Dashboard 数据 API 脚本
# 提供团队和任务数据接口

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
OPENCLAW_BASE_DIR="${OPENCLAW_BASE_DIR:-$HOME/.openclaw}"
WORKSPACE="${OPENCLAW_WORKSPACE:-$OPENCLAW_BASE_DIR/workspace}"
OUTPUT_DIR="${OUTPUT_DIR:-$REPO_DIR/.tmp/dashboard-api}"

mkdir -p "$OUTPUT_DIR"

# 获取团队数据
get_teams() {
  cat << 'EOF'
{
  "teams": [
    {
      "team_id": "team-rd",
      "team_name": "研发团队",
      "team_type": "execution",
      "description": "负责软件需求开发与实现",
      "lead": {
        "agent_id": "rd_lead",
        "name": "RD Lead",
        "model": "qwen3.5-plus",
        "backup_model": "qwen3-plus"
      },
      "members": [
        {
          "agent_id": "rd_developer",
          "name": "RD Developer",
          "role": "Developer",
          "model": "qwen3.5-plus",
          "backup_model": "qwen3-plus",
          "status": "working",
          "current_task": "TASK-20260314-001"
        },
        {
          "agent_id": "rd_tester",
          "name": "RD Tester",
          "role": "Tester",
          "model": "qwen3.5-plus",
          "backup_model": "qwen3-plus",
          "status": "working",
          "current_task": "TASK-20260314-001"
        },
        {
          "agent_id": "rd_documentation",
          "name": "RD Documentation",
          "role": "Documentation",
          "model": "qwen3.5-plus",
          "backup_model": "qwen3-plus",
          "status": "idle",
          "current_task": null
        }
      ],
      "responsibilities": [
        "软件需求开发",
        "代码编写",
        "单元测试",
        "技术文档"
      ],
      "workflow": {
        "stages": ["需求分析", "设计", "开发", "测试", "交付"],
        "current_stage": "开发"
      }
    },
    {
      "team_id": "team-km",
      "team_name": "知识管理团队",
      "team_type": "knowledge",
      "description": "负责知识收集、整理、沉淀",
      "lead": {
        "agent_id": "scholar",
        "name": "Scholar",
        "model": "qwen3.5-plus",
        "backup_model": "qwen3-plus"
      },
      "members": [
        {
          "agent_id": "km_collector",
          "name": "KM Collector",
          "role": "Collector",
          "model": "qwen3.5-plus",
          "backup_model": "qwen3-plus",
          "status": "idle",
          "current_task": null
        },
        {
          "agent_id": "km_indexer",
          "name": "KM Indexer",
          "role": "Indexer",
          "model": "qwen3.5-plus",
          "backup_model": "qwen3-plus",
          "status": "idle",
          "current_task": null
        }
      ],
      "responsibilities": [
        "知识收集",
        "知识整理",
        "知识索引",
        "知识沉淀"
      ],
      "workflow": {
        "stages": ["收集", "处理", "索引", "发布"],
        "current_stage": "收集"
      }
    },
    {
      "team_id": "team-braintrust",
      "team_name": "智囊团",
      "team_type": "review",
      "description": "负责审查、决策、裁决",
      "lead": {
        "agent_id": "braintrust_chief",
        "name": "Braintrust Chief",
        "model": "qwen3.5-plus",
        "backup_model": "qwen3-plus"
      },
      "members": [
        {
          "agent_id": "braintrust_architect",
          "name": "Braintrust Architect",
          "role": "Architect Reviewer",
          "model": "qwen3.5-plus",
          "backup_model": "qwen3-plus",
          "status": "working",
          "current_task": "BT-20260314-008"
        },
        {
          "agent_id": "braintrust_coder",
          "name": "Braintrust Coder",
          "role": "Code Reviewer",
          "model": "qwen3.5-plus",
          "backup_model": "qwen3-plus",
          "status": "idle",
          "current_task": null
        }
      ],
      "responsibilities": [
        "架构审查",
        "代码审查",
        "最终裁决",
        "流程审查"
      ],
      "workflow": {
        "stages": ["待审查", "审查中", "裁决中", "已完成"],
        "current_stage": "审查中"
      }
    }
  ],
  "temporary_agents": [],
  "updated_at": "TIMESTAMP"
}
EOF
}

# 获取任务数据
get_tasks() {
  local tasks_json="[]"
  
  # 读取所有任务文件
  for task_file in "$WORKSPACE"/tasks/*_20260314_*.json; do
    [[ -f "$task_file" ]] || continue
    
    task_data=$(cat "$task_file" | jq '{
      task_id: .task_id,
      task_name: .task_name,
      status: (.execution.status // .status),
      progress: (.execution.progress // .progress // 0),
      created_at: .created_at,
      owner: (.execution.assigned_to // "unassigned"),
      team: (if .task_name | contains("Main") then "team-rd" elif .task_name | contains("Team") then "team-km" elif .task_name | contains("Recovery") then "team-braintrust" else "team-rd" end),
      stages: (.requirements.deliverables | length // 0),
      completed_stages: (if (.execution.status // .status) == "completed" then (.requirements.deliverables | length // 0) else 0 end)
    }')
    
    tasks_json=$(echo "$tasks_json" | jq --argjson task "$task_data" '. += [$task]')
  done
  
  echo "{\"tasks\": $tasks_json, \"updated_at\": \"$(date -Iseconds)\"}"
}

# 主函数
case "${1:-teams}" in
  teams)
    get_teams | sed "s/TIMESTAMP/$(date -Iseconds)/"
    ;;
  tasks)
    get_tasks
    ;;
  all)
    echo "{\"teams\": $(get_teams | sed "s/TIMESTAMP/$(date -Iseconds)/" | jq '.teams'), \"tasks\": $(get_tasks | jq '.tasks')}"
    ;;
  *)
    echo "用法：$0 [teams|tasks|all]"
    exit 1
    ;;
esac
