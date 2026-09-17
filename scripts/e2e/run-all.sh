#!/usr/bin/env bash
# e2e/run-all.sh —— E2E 套件总入口：顺序执行四个域脚本并汇总
#
# 四个域（用户术语口径）：
#   1. model-elements  模型元素（表分类 / 表 / 关联的列 / 导航关系）
#   2. dict-template   元素之字典 / 字典分类 / 模板
#   3. settings        设置 + AI 设置
#   4. ai-agent        AI 工具链（pi-agent-core 内核）
#
# 用法：bash scripts/e2e/run-all.sh
# 可配：PORT（dev server 端口，默认 3000，未运行则自起）
#       MOCK_PORT（AI mock 端口，默认 4841）
set -u
E2E_DIR="$(cd "$(dirname "$0")" && { pwd -W 2>/dev/null || pwd; })"

SCRIPTS=(model-elements dict-template settings ai-agent)
TOTAL_PASS=0
TOTAL_FAIL=0
RESULTS=()

for s in "${SCRIPTS[@]}"; do
  echo ""
  echo "######################################################"
  echo "## 开始执行：$s"
  echo "######################################################"
  if bash "$E2E_DIR/$s.sh"; then
    RESULTS+=("$s: PASS")
  else
    RESULTS+=("$s: FAIL")
    TOTAL_FAIL=$((TOTAL_FAIL+1))
  fi
  sleep 2
done

echo ""
echo "======================================================"
echo "E2E 全套件汇总"
for r in "${RESULTS[@]}"; do echo "  $r"; done
echo "======================================================"
[ "$TOTAL_FAIL" -eq 0 ] && echo "ALL_SUITES_GREEN" || exit 1
