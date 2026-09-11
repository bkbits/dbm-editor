#!/usr/bin/env bash
# 打包项目源码为交付 ZIP（含顶层目录，排除依赖/构建产物）
set -euo pipefail
cd "$(dirname "$0")/.."

STAGE="$(pwd)/zip-stage"
OUT="download/graph-db-model-editor.zip"

rm -rf "$STAGE"
rm -f "$OUT"
mkdir -p "$STAGE/graph-db-model-editor" download

rsync -a --delete \
  --exclude 'node_modules' \
  --exclude 'dist' \
  --exclude '.git' \
  --exclude '.zscripts' \
  --exclude 'skills' \
  --exclude 'zip-stage' \
  --exclude 'download' \
  --exclude 'upload' \
  --exclude 'agent-ctx' \
  --exclude 'tool-results' \
  --exclude '.vite-hooks' \
  --exclude '.env' \
  --exclude '.env.*' \
  --exclude 'snapshot' \
  --exclude 'patch' \
  --exclude '*.log' \
  --exclude '.DS_Store' \
  ./ "$STAGE/graph-db-model-editor/"

(cd "$STAGE" && zip -rq "$OLDPWD/$OUT" graph-db-model-editor)

cp README.md download/README.md

echo "--- 打包完成 ---"
unzip -l "$OUT" | tail -2
echo "文件数：$(unzip -l "$OUT" | grep -c 'graph-db-model-editor/')"
echo "大小：$(du -h "$OUT" | cut -f1)"
rm -rf "$STAGE"
