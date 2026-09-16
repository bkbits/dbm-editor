#!/usr/bin/env bash
# Task 42 E2E：AI 全局规则默认文本
# 1. 新库种子默认：设置页全局规则 textarea 开箱即为默认任务流程约定文本
# 2. 「恢复默认」按钮：清空 / 旧库空值下点击 → 草稿恢复为默认文本（需保存生效）
# 3. 保存持久化：localStorage aiSettings.globalRules 含默认文本
# 4. 旧库语义：已保存的空 globalRules 不被种子覆盖（尊重用户主动清空）
# 5. 默认规则流入系统提示：mock 收到 system 含【全局规则】块与「# 任务流程:」
# 单次调用内完成：起 mock SSE + dev server → 浏览器全流程断言 → 截图 → 杀服务
#（沙箱在工具调用之间回收派生进程，故必须一体化执行）
set -u

ROOT=/home/z/my-project/dbm-work
SHOTS=$ROOT/docs/screenshots
mkdir -p "$SHOTS"
PASS=0; FAIL=0; FAILED_NAMES=()

check() {
  local name="$1" expr="$2" out
  out=$(agent-browser eval "$expr" 2>/dev/null | tr -d '"')
  if [ "$out" = "true" ]; then
    PASS=$((PASS+1)); echo "  PASS  $name"
  else
    FAIL=$((FAIL+1)); FAILED_NAMES+=("$name"); echo "  FAIL  $name  =>  $out"
  fi
}

poll_expr() { # expr timeout_seconds
  local expr="$1" t="${2:-10}" i=0 out
  while [ $i -lt $((t * 2)) ]; do
    out=$(agent-browser eval "$expr" 2>/dev/null | tr -d '"')
    [ "$out" = "true" ] && return 0
    sleep 0.5; i=$((i+1))
  done
  return 1
}

header_nav() { # aria-label
  agent-browser eval "document.querySelector('.nav-btn[aria-label=\"$1\"]')?.click()" >/dev/null 2>&1
}

cleanup() {
  # kill 父进程之外补杀 vite 子进程，避免孤儿 dev server 占端口污染后续运行
  if [ -n "${DEV_PID:-}" ]; then
    pkill -P "$DEV_PID" 2>/dev/null
    kill "$DEV_PID" 2>/dev/null
  fi
  [ -n "${MOCK_PID:-}" ] && kill "$MOCK_PID" 2>/dev/null
}
trap cleanup EXIT

cd "$ROOT"

# ---------- 1. 起服务 ----------
node scripts/ai-sse-mock-scroll.mjs 4833 > /tmp/task42-mock.log 2>&1 &
MOCK_PID=$!
AI_MOCK_PROXY=1 ./node_modules/.bin/vp dev > /tmp/task42-dev.log 2>&1 &
DEV_PID=$!

PORT=""
for i in $(seq 1 40); do
  PORT=$(grep -oE 'localhost:[0-9]+' /tmp/task42-dev.log | head -1 | cut -d: -f2)
  if [ -n "$PORT" ] && curl -s "http://localhost:$PORT" >/dev/null 2>&1; then break; fi
  sleep 1
done
if [ -z "$PORT" ]; then echo "FATAL: dev server 未就绪"; tail -20 /tmp/task42-dev.log; exit 1; fi
echo "== dev server: http://localhost:$PORT =="

export AGENT_BROWSER_SESSION="task42-e2e-$$"
agent-browser open "http://localhost:$PORT" >/dev/null 2>&1
agent-browser wait --load networkidle >/dev/null 2>&1 || true

# ---------- 2. 新库默认文本断言（干净 session → 种子库） ----------
echo "== 设置页：新库默认文本 =="
header_nav 系统设置
poll_expr "!!document.querySelector('.rules-block textarea')" 5

check "新库全局规则默认含「# 任务流程:」" "(function(){var v=document.querySelector('.rules-block textarea')?.value||'';return v.includes('# 任务流程:')})()"
check "默认文本含七步流程（读取设置 → 校验结果）" "(function(){var v=document.querySelector('.rules-block textarea')?.value||'';return v.includes('1. 读取设置') && v.includes('7. 校验任务执行结果')})()"
check "默认文本含「# 遵守规则」与三条约定" "(function(){var v=document.querySelector('.rules-block textarea')?.value||'';return v.includes('# 遵守规则') && v.includes('层层递进') && v.includes('一轮工具调用只执行一个元素的更新') && v.includes('分批次实施')})()"
check "「恢复默认」按钮存在" "(function(){var b=document.querySelector('.rules-reset');return !!b && b.textContent.includes('恢复默认')})()"
check "规则区提示文案存在" "(function(){var h=document.querySelector('.rules-head .rules-hint');return !!h && h.textContent.includes('留空则仅使用内置默认规则')})()"

# ---------- 3. 清空 → 恢复默认（草稿级，需保存生效） ----------
echo "== 清空与恢复默认 =="
agent-browser find first ".rules-block textarea" fill "" >/dev/null 2>&1
sleep 0.3
check "清空后 textarea 为空" "(function(){var v=document.querySelector('.rules-block textarea')?.value||'';return v.trim()===''})()"

agent-browser eval "document.querySelector('.rules-reset')?.click()" >/dev/null 2>&1
sleep 0.3
check "点击恢复默认后草稿恢复完整默认文本" "(function(){var v=document.querySelector('.rules-block textarea')?.value||'';return v.includes('# 任务流程:') && v.includes('# 遵守规则') && v.includes('7. 校验任务执行结果')})()"

# ---------- 4. 配置 AI 服务并保存 → 持久化断言 ----------
echo "== 保存与持久化 =="
agent-browser find first ".ai-card input" fill "http://localhost:$PORT/__ai-mock/v1" >/dev/null 2>&1
agent-browser find text 添加模型 click >/dev/null 2>&1
sleep 0.5
agent-browser find nth 2 ".ai-card input" fill "glm-4.6" >/dev/null 2>&1
sleep 0.3
agent-browser eval "[...document.querySelectorAll('.settings-foot button')].find(b => b.textContent.trim() === '保存设置')?.click()" >/dev/null 2>&1
poll_expr "document.body.innerText.includes('设置已保存')" 8
check "保存设置成功" "document.body.innerText.includes('设置已保存')"
check "localStorage 持久化默认规则文本" "(function(){var d=JSON.parse(localStorage.getItem('gdbme:db:v2'));return (d.aiSettings.globalRules||'').includes('# 任务流程:') && (d.aiSettings.globalRules||'').includes('层层递进')})()"

# ---------- 5. 旧库语义：已保存空值不被种子覆盖 ----------
echo "== 旧库空值语义 =="
agent-browser eval "(function(){var d=JSON.parse(localStorage.getItem('gdbme:db:v2'));d.aiSettings.globalRules='';localStorage.setItem('gdbme:db:v2',JSON.stringify(d));return true})()" >/dev/null 2>&1
agent-browser open "http://localhost:$PORT" >/dev/null 2>&1
agent-browser wait --load networkidle >/dev/null 2>&1 || true
header_nav 系统设置
poll_expr "!!document.querySelector('.rules-block textarea')" 5
check "已保存的空规则不被种子默认覆盖（尊重主动清空）" "(function(){var v=document.querySelector('.rules-block textarea')?.value||'';return v.trim()===''})()"

agent-browser eval "document.querySelector('.rules-reset')?.click()" >/dev/null 2>&1
sleep 0.3
check "空值下恢复默认同样生效" "(function(){var v=document.querySelector('.rules-block textarea')?.value||'';return v.includes('# 任务流程:')})()"
agent-browser eval "[...document.querySelectorAll('.settings-foot button')].find(b => b.textContent.trim() === '保存设置')?.click()" >/dev/null 2>&1
poll_expr "document.body.innerText.includes('设置已保存')" 8
check "再次保存后 localStorage 恢复默认文本" "(function(){var d=JSON.parse(localStorage.getItem('gdbme:db:v2'));return (d.aiSettings.globalRules||'').includes('# 任务流程:')})()"

# ---------- 6. AI 工具页：默认规则流入系统提示 ----------
echo "== 系统提示流入验证 =="
header_nav "AI 工具"
poll_expr "!!document.querySelector('.ai-view')" 5
agent-browser find first ".input-box textarea" fill "默认规则验证：请简述当前任务流程" >/dev/null 2>&1
agent-browser eval "document.querySelector('.send-btn').click()" >/dev/null 2>&1
# 请求到达 mock 即写日志（不等流式完成），普通分支 40 段 × 500ms 仅作背景
sleep 4
if rg -q "sysRules=true sysRulesFlow=true" /tmp/task42-mock.log 2>/dev/null; then
  PASS=$((PASS+1)); echo "  PASS  mock 收到 system 含【全局规则】块与「# 任务流程:」默认文本"
else
  FAIL=$((FAIL+1)); FAILED_NAMES+=("系统提示默认规则流入"); echo "  FAIL  系统提示默认规则流入"; grep "ock-scroll]" /tmp/task42-mock.log | head -3
fi

# 停止背景长流，避免悬挂等待
agent-browser eval "[...document.querySelectorAll('.input-box button')].find(b => b.className.includes('stop'))?.click()" >/dev/null 2>&1
sleep 1

# ---------- 7. 截图 ----------
header_nav 系统设置
poll_expr "!!document.querySelector('.rules-block textarea')" 5
agent-browser screenshot "$SHOTS/task42-rules-default.png" >/dev/null 2>&1
echo "== 截图: $SHOTS/task42-rules-default.png =="

# ---------- 汇总 ----------
echo ""
echo "=========================================="
echo "PASS: $PASS  FAIL: $FAIL"
if [ ${#FAILED_NAMES[@]} -gt 0 ]; then
  echo "失败项: ${FAILED_NAMES[*]}"
fi
echo "=========================================="
[ "$FAIL" -eq 0 ]
