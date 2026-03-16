#!/bin/bash
set -euo pipefail

if [ ! -f static/build/task_dashboard.js ]; then
  echo "missing task_dashboard.js"; exit 1; fi
if [ ! -f static/build/system_dashboard.js ]; then
  echo "missing system_dashboard.js"; exit 1; fi
