#!/usr/bin/env bash
# 快照当前源码到 snapshot/[年月日时分秒].zip（排除依赖/构建产物/快照自身）
set -euo pipefail
cd "$(dirname "$0")/.."

TS="$(date +%Y%m%d%H%M%S)"
OUT="snapshot/${TS}.zip"

mkdir -p snapshot

zip -rq "$OUT" . \
  -x 'node_modules/*' \
  -x 'dist/*' \
  -x '.git/*' \
  -x '.zscripts/*' \
  -x 'skills/*' \
  -x 'zip-stage/*' \
  -x 'download/*' \
  -x 'upload/*' \
  -x 'agent-ctx/*' \
  -x 'snapshot/*' \
  -x 'patch/*' \
  -x '*.log' \
  -x '.DS_Store' \
  -x 'bun.lock' \
  -x 'snapshot.sh' 2>/dev/null || true

echo "--- 快照完成: $OUT ---"
unzip -l "$OUT" | tail -2
du -h "$OUT"
