#!/bin/bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DEPLOY_DIR="${DEPLOY_DIR:-/Users/tianshuai/.openclaw/workspace/dashboard-live}"

mkdir -p "$DEPLOY_DIR"
rsync -a --delete \
  --exclude '.git/' \
  --exclude '.tmp/' \
  --exclude '__pycache__/' \
  --exclude '*.pyc' \
  --exclude 'dashboard.launchd.err.log' \
  --exclude 'dashboard.launchd.out.log' \
  --exclude 'control_audit.jsonl' \
  "$REPO_DIR/" "$DEPLOY_DIR/"

echo "deployed:$DEPLOY_DIR"
