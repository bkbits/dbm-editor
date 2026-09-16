#!/usr/bin/env bash
# Task 40 E2E：AI 工具 token 用量统计 + 能力调用记录清空 + refresh 能力
# - 上下文占用量：usage.total（2112）实时展示，配置 inputContextLength=8192 后显示分母与占用比
# - 问答花费：user 消息「输入 512 · 回答 1600 tok」/ assistant 消息「输出 1600 tok · N tok/s」
# - token 速度：流式中显示当前速度（主色 live），停止后显示上一次（含「上次」标记）
# - refresh 能力：AI 能力列表新增 refresh 工具（发「请刷新数据」→ 记录 success + returned refreshed）
# - 清空按钮：仅清能力调用记录（消息保留、zip 释放、空态文案回归）
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
node scripts/ai-sse-mock-scroll.mjs 4833 > /tmp/task40-mock.log 2>&1 &
MOCK_PID=$!
AI_MOCK_PROXY=1 ./node_modules/.bin/vp dev > /tmp/task40-dev.log 2>&1 &
DEV_PID=$!

PORT=""
for i in $(seq 1 40); do
  PORT=$(grep -oE 'localhost:[0-9]+' /tmp/task40-dev.log | head -1 | cut -d: -f2)
  if [ -n "$PORT" ] && curl -s "http://localhost:$PORT" >/dev/null 2>&1; then break; fi
  sleep 1
done
if [ -z "$PORT" ]; then echo "FATAL: dev server 未就绪"; tail -20 /tmp/task40-dev.log; exit 1; fi
echo "== dev server: http://localhost:$PORT =="

export AGENT_BROWSER_SESSION="task40-e2e-$$"
agent-browser open "http://localhost:$PORT" >/dev/null 2>&1
agent-browser wait --load networkidle >/dev/null 2>&1 || true

# ---------- 2. 设置页：配置 AI 服务 + 模型上下文长度 8192 ----------
echo "== 设置页 =="
header_nav 系统设置
poll_expr "!!document.querySelector('.settings-nav')" 5

agent-browser find first ".ai-card input" fill "http://localhost:$PORT/__ai-mock/v1" >/dev/null 2>&1
agent-browser find text 添加模型 click >/dev/null 2>&1
sleep 0.5
agent-browser find nth 2 ".ai-card input" fill "glm-4.6" >/dev/null 2>&1
# 模型行「输入上下文」数字输入（第一个 ant-input-number）
sleep 0.3
agent-browser find first ".ai-card .ant-input-number input" fill "8192" >/dev/null 2>&1
sleep 0.3
agent-browser eval "[...document.querySelectorAll('.settings-foot button')].find(b => b.textContent.trim() === '保存设置')?.click()" >/dev/null 2>&1
poll_expr "document.body.innerText.includes('设置已保存')" 8
check "AI 服务配置保存" "document.body.innerText.includes('设置已保存')"

# ---------- 3. 发送普通消息：超长思考流（20 秒） → token 统计 ----------
echo "== AI 工具页：token 统计 =="
header_nav "AI 工具"
poll_expr "!!document.querySelector('.ai-view')" 5

agent-browser find first ".input-box textarea" fill "测试token统计" >/dev/null 2>&1
agent-browser eval "document.querySelector('.send-btn').click()" >/dev/null 2>&1

# 流式中：思考块展开 + 速度状态条出现（live 主色）
poll_expr "!!document.querySelector('.reasoning-block.open .reasoning-body')" 8
check "流式中思考块自动展开" "!!document.querySelector('.reasoning-block.open .reasoning-body')"
poll_expr "!!document.querySelector('.tok-stats .tok-speed.live')" 15
check "流式中显示当前 token 速度（live）" "(function(){var el=document.querySelector('.tok-stats .tok-speed.live');return el && /tok\/s/.test(el.textContent)})()"
check "速度状态条无「上次」标记（进行中）" "(function(){var el=document.querySelector('.tok-stats .tok-speed');return el && !el.textContent.includes('上次')})()"

# 流式中：上下文占用已开始实时估算（基准+输出）
sleep 2
check "流式中上下文占用实时展示" "(function(){var el=document.querySelector('.tok-stats .ctx-meter');return el && /上下文/.test(el.textContent) && /8192/.test(el.textContent)})()"

# 等流真正结束（usage 分片先子 [DONE]/finally 到达，需等消息完成态而非仅等 usage 值）
poll_expr "(function(){var els=document.querySelectorAll('.msg');var last=els[els.length-1];return last && !last.classList.contains('streaming')})()" 30
sleep 1.5
check "完成后上下文占用=usage.total（2112）" "(function(){var el=document.querySelector('.tok-stats .ctx-meter');return el && el.textContent.replace(/\\s/g,'').includes('2112/8192')})()"
check "完成后速度显示上一次任务（含标记）" "(function(){var el=document.querySelector('.tok-stats .tok-speed');return el && el.textContent.includes('上次') && /tok\\/s/.test(el.textContent)})()"

# 消息级 token 标签
check "user 消息问题花费标签（输入 512 · 回答 1600）" "(function(){var el=[...document.querySelectorAll('.msg.user .msg-tokens')].pop();return el && el.textContent.replace(/\\s/g,'').includes('输入512') && el.textContent.replace(/\\s/g,'').includes('回答1600')})()"
check "assistant 消息输出与速度标签" "(function(){var el=[...document.querySelectorAll('.msg.assistant .msg-tokens')].pop();return el && el.textContent.replace(/\\s/g,'').includes('输出1600tok') && /tok\\/s/.test(el.textContent)})()"
agent-browser screenshot "$SHOTS/task40-token-stats.png" >/dev/null 2>&1

# ---------- 4. refresh 能力 ----------
echo "== refresh 能力 =="
agent-browser find first ".input-box textarea" fill "请刷新数据" >/dev/null 2>&1
agent-browser eval "document.querySelector('.send-btn').click()" >/dev/null 2>&1

poll_expr "[...document.querySelectorAll('.tool-record .rec-name')].some(n => n.textContent === 'refresh' && n.closest('.tool-record').classList.contains('success'))" 25
check "refresh 能力调用记录 success" "[...document.querySelectorAll('.tool-record .rec-name')].some(n => n.textContent === 'refresh' && n.closest('.tool-record').classList.contains('success'))"

# 展开记录验证返回值
agent-browser eval "[...document.querySelectorAll('.tool-record .record-head')].find(h => h.textContent.includes('refresh'))?.click()" >/dev/null 2>&1
sleep 0.5
check "refresh 返回 refreshed true" "(function(){var el=[...document.querySelectorAll('.tool-record')].find(r => r.textContent.includes('refresh'));return el && el.textContent.includes('refreshed') && el.textContent.includes('true')})()"
if rg -q "toolResults=[0-9]+" /tmp/task40-mock.log 2>/dev/null; then
  PASS=$((PASS+1)); echo "  PASS  mock 已收到工具定义清单"
else
  FAIL=$((FAIL+1)); FAILED_NAMES+=("mock 工具清单"); echo "  FAIL  mock 工具清单"
fi
agent-browser screenshot "$SHOTS/task40-refresh-tool.png" >/dev/null 2>&1

# 等第二轮总结完成（上下文 1120 覆盖 2112）
poll_expr "(function(){var el=document.querySelector('.tok-stats .ctx-meter');return el && el.textContent.includes('1120')})()" 20
check "refresh 会话后上下文占用更新（1120）" "(function(){var el=document.querySelector('.tok-stats .ctx-meter');return el && el.textContent.replace(/\\s/g,'').includes('1120/8192')})()"

# ---------- 5. 清空能力调用记录 ----------
echo "== 清空能力调用记录 =="
# 等第二轮总结真正完成（running 收口后清空按钮才可用）
poll_expr "!document.querySelector('.send-btn.stop')" 20
sleep 1
# 先确认有记录与消息共存
check "清空前有调用记录" "document.querySelectorAll('.tool-record').length >= 1"
agent-browser eval "document.querySelector('.tools-clear').click()" >/dev/null 2>&1
sleep 0.5
check "清空后记录列表为空" "document.querySelectorAll('.tool-record').length === 0"
check "清空后空态文案回归" "document.body.innerText.includes('参数与返回值将记录在这里')"
check "清空后聊天消息保留" "document.querySelectorAll('.msg').length >= 4"
check "清空后按钮禁用" "(function(){var b=document.querySelector('.tools-clear');return b && b.disabled})()"
check "清空后上下文占用保留（不影响会话统计）" "(function(){var el=document.querySelector('.tok-stats .ctx-meter');return el && el.textContent.includes('1120')})()"
agent-browser screenshot "$SHOTS/task40-cleared.png" >/dev/null 2>&1

# ---------- 6. 回归：思考块滚动跟随（task39 行为不回退） ----------
echo "== 回归 =="
check "思考块贴底跟随仍生效（末段可见）" "(function(){var el=[...document.querySelectorAll('.reasoning-body')].find(function(e){return e.textContent.includes('第 40 段')});return el && el.scrollHeight - el.scrollTop - el.clientHeight < 2})()"

agent-browser close >/dev/null 2>&1

echo ""
echo "========== 结果：PASS=$PASS FAIL=$FAIL =========="
if [ ${#FAILED_NAMES[@]} -gt 0 ]; then
  printf '失败项: %s\n' "${FAILED_NAMES[@]}"
fi
[ "$FAIL" -eq 0 ] && echo "ALL_GREEN" || exit 1
