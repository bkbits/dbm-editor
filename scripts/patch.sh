#!/usr/bin/env bash
# 保存当前源码修改的 patch 到 patch/[年月日时分秒].patch
# patch 范围：git 工作区相对最近一次提交的源码改动（新增源文件先 intent-to-add 纳入 diff；
#             snapshot/ 与 patch/ 会话产物目录已 gitignore，不会混入）
set -euo pipefail
cd "$(dirname "$0")/.."

TS="$(date +%Y%m%d%H%M%S)"
OUT="patch/${TS}.patch"

mkdir -p patch

# 新增的源码文件标记 intent-to-add，使其出现在 git diff 中
git add -N -- src/ 2>/dev/null || true

git diff -- src/ README.md package.json index.html vite.config.ts tsconfig.json .gitignore scripts/ > "$OUT"

echo "--- patch 已保存: $OUT ---"
echo "改动文件数: $(grep -c '^diff --git' "$OUT" || true)"
echo "大小: $(du -h "$OUT" | cut -f1)"
