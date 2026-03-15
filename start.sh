#!/bin/bash
# OpenClaw Dashboard 启动脚本

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
OPENCLAW_BASE_DIR="${OPENCLAW_BASE_DIR:-$HOME/.openclaw}"
OPENCLAW_WORKSPACE="${OPENCLAW_WORKSPACE:-$OPENCLAW_BASE_DIR/workspace}"
PORT="${1:-${PORT:-8080}}"

echo "=========================================="
echo "  OpenClaw Dashboard 启动器"
echo "=========================================="
echo ""
echo "📁 Dashboard 仓库：$SCRIPT_DIR"
echo "🧭 OpenClaw 运行态：$OPENCLAW_BASE_DIR"
echo "🗂️  OpenClaw Workspace：$OPENCLAW_WORKSPACE"
echo "🌐 端口：$PORT"
echo ""

# 检查 Python3
if ! command -v python3 &> /dev/null; then
    echo "❌ 错误：未找到 Python3"
    exit 1
fi

echo "✅ Python3: $(python3 --version)"
echo ""

# 启动服务器
echo "🚀 启动 Dashboard API 服务器..."
echo ""
echo "=========================================="
echo "  访问地址："
echo "  👥 团队管理：http://localhost:$PORT/team_dashboard.html"
echo "  📋 任务管理：http://localhost:$PORT/task_dashboard.html"
echo "  🏠 首页：http://localhost:$PORT/"
echo "=========================================="
echo ""
echo "按 Ctrl+C 停止服务"
echo ""

cd "$SCRIPT_DIR"
python3 server.py "$PORT"
