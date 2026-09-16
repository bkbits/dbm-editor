#!/usr/bin/env bash
# Task 39 E2E：AI 思考块流式输出贴底自动跟随滚动
# - 思考块 .reasoning-body 独立滚动容器（max-height 240px），流式追加时：
#   1) 停留在底部 → 自动跟随滚到底部（贴底距离恒 < 24px，内容持续增长）
#   2) 用户上翻（scrollTop=0）→ 停止跟随（位置不动、贴底距离增大）
#   3) 翻回底部 → 恢复跟随
# - 完成后自动收起（.open 移除 + body display:none），手动重开后保持底部位置
# - 回归：外层聊天容器流式期间仍贴底（stickBottom 不受影响）
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

# 采样思考块状态："文本长度|scrollTop|距底距离"，失败返回 none
sample_rb() {
  agent-browser eval "(function(){var el=document.querySelector('.reasoning-body');if(!el)return 'none';return el.textContent.length+'|'+el.scrollTop+'|'+(el.scrollHeight-el.scrollTop-el.clientHeight)})()" 2>/dev/null | tr -d '"'
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
node scripts/ai-sse-mock-scroll.mjs 4833 > /tmp/task39-mock.log 2>&1 &
MOCK_PID=$!
AI_MOCK_PROXY=1 ./node_modules/.bin/vp dev > /tmp/task39-dev.log 2>&1 &
DEV_PID=$!

PORT=""
for i in $(seq 1 40); do
  PORT=$(grep -oE 'localhost:[0-9]+' /tmp/task39-dev.log | head -1 | cut -d: -f2)
  if [ -n "$PORT" ] && curl -s "http://localhost:$PORT" >/dev/null 2>&1; then break; fi
  sleep 1
done
if [ -z "$PORT" ]; then echo "FATAL: dev server 未就绪"; tail -20 /tmp/task39-dev.log; exit 1; fi
echo "== dev server: http://localhost:$PORT =="

export AGENT_BROWSER_SESSION="task39-e2e-$$"
agent-browser open "http://localhost:$PORT" >/dev/null 2>&1
agent-browser wait --load networkidle >/dev/null 2>&1 || true

# ---------- 2. 设置页：配置 AI 服务（同源代理指向 mock） ----------
echo "== 设置页 =="
header_nav 系统设置
poll_expr "!!document.querySelector('.settings-nav')" 5

agent-browser find first ".ai-card input" fill "http://localhost:$PORT/__ai-mock/v1" >/dev/null 2>&1
agent-browser find text 添加模型 click >/dev/null 2>&1
sleep 0.5
agent-browser find nth 2 ".ai-card input" fill "glm-4.6" >/dev/null 2>&1
sleep 0.3
agent-browser eval "[...document.querySelectorAll('.settings-foot button')].find(b => b.textContent.trim() === '保存设置')?.click()" >/dev/null 2>&1
poll_expr "document.body.innerText.includes('设置已保存')" 8
check "AI 服务配置保存" "document.body.innerText.includes('设置已保存')"

# ---------- 3. AI 工具页：发送触发长思考流 ----------
echo "== AI 工具页 =="
header_nav "AI 工具"
poll_expr "!!document.querySelector('.ai-view')" 5

agent-browser find first ".input-box textarea" fill "测试思考滚动跟随" >/dev/null 2>&1
agent-browser eval "document.querySelector('.send-btn').click()" >/dev/null 2>&1

poll_expr "!!document.querySelector('.reasoning-block.open .reasoning-body')" 8
check "流式中思考块自动展开" "!!document.querySelector('.reasoning-block.open .reasoning-body')"

# 等待内容溢出滚动容器（距顶溢出 > 150px）
poll_expr "(function(){var el=document.querySelector('.reasoning-body');return el && el.scrollHeight - el.clientHeight > 150})()" 15
check "思考内容溢出产生内部滚动" "(function(){var el=document.querySelector('.reasoning-body');return el && el.scrollHeight - el.clientHeight > 150})()"

# ---------- 4. 断言一：贴底自动跟随 ----------
# 两次采样（间隔 > 1 个 chunk 周期）：文本增长且距底距离始终 < 24
S1=$(sample_rb); sleep 1.3; S2=$(sample_rb)
A1=${S1%%|*}; REST=${S1#*|}; ST1=${REST%%|*}; D1=${REST##*|}
A2=${S2%%|*}; REST=${S2#*|}; ST2=${REST%%|*}; D2=${REST##*|}
echo "  跟随采样: [$S1] -> [$S2]"
if [ "$A1" != "none" ] && [ "$A2" -gt "$A1" ] 2>/dev/null && [ "$D1" -lt 24 ] 2>/dev/null && [ "$D2" -lt 24 ] 2>/dev/null; then
  PASS=$((PASS+1)); echo "  PASS  新内容追加且贴底时自动跟随（距离 ${D1}px→${D2}px 恒 < 24）"
else
  FAIL=$((FAIL+1)); FAILED_NAMES+=("贴底自动跟随"); echo "  FAIL  贴底自动跟随  =>  $S1 / $S2"
fi
check "跟随期间外层聊天容器仍贴底（回归）" "(function(){var el=document.querySelector('.chat-scroll');return el && el.scrollHeight - el.scrollTop - el.clientHeight < 10})()"
agent-browser screenshot "$SHOTS/task39-follow.png" >/dev/null 2>&1

# ---------- 5. 断言二：上翻停跟 ----------
# 程序化上翻 + 同步派发 scroll 事件（模拟用户上翻，规避 scroll 事件异步竞态）
agent-browser eval "(function(){var el=document.querySelector('.reasoning-body');el.scrollTop=0;el.dispatchEvent(new Event('scroll'));return true})()" >/dev/null 2>&1
sleep 0.9
S3=$(sample_rb); sleep 1.3; S4=$(sample_rb)
A3=${S3%%|*}; REST=${S3#*|}; ST3=${REST%%|*}; D3=${REST##*|}
A4=${S4%%|*}; REST=${S4#*|}; ST4=${REST%%|*}; D4=${REST##*|}
echo "  停跟采样: [$S3] -> [$S4]"
if [ "$A4" -gt "$A3" ] 2>/dev/null && [ "$ST3" = "0" ] && [ "$ST4" = "0" ] && [ "$D4" -gt 100 ] 2>/dev/null; then
  PASS=$((PASS+1)); echo "  PASS  上翻后停止跟随（scrollTop 恒 0，内容 ${A3}→${A4} 仍增长）"
else
  FAIL=$((FAIL+1)); FAILED_NAMES+=("上翻停跟"); echo "  FAIL  上翻停跟  =>  $S3 / $S4"
fi
agent-browser screenshot "$SHOTS/task39-paused.png" >/dev/null 2>&1

# ---------- 6. 断言三：回底恢复跟随 ----------
agent-browser eval "(function(){var el=document.querySelector('.reasoning-body');el.scrollTop=el.scrollHeight;el.dispatchEvent(new Event('scroll'));return true})()" >/dev/null 2>&1
sleep 0.9
S5=$(sample_rb); sleep 1.3; S6=$(sample_rb)
A5=${S5%%|*}; REST=${S5#*|}; ST5=${REST%%|*}; D5=${REST##*|}
A6=${S6%%|*}; REST=${S6#*|}; ST6=${REST%%|*}; D6=${REST##*|}
echo "  恢复采样: [$S5] -> [$S6]"
if [ "$A6" -gt "$A5" ] 2>/dev/null && [ "$D5" -lt 24 ] 2>/dev/null && [ "$D6" -lt 24 ] 2>/dev/null; then
  PASS=$((PASS+1)); echo "  PASS  回底后恢复跟随（距离 ${D5}px→${D6}px 恒 < 24）"
else
  FAIL=$((FAIL+1)); FAILED_NAMES+=("回底恢复"); echo "  FAIL  回底恢复  =>  $S5 / $S6"
fi

# ---------- 7. 完成后收起 + 重开保持底部 ----------
echo "== 完成态 =="
poll_expr "(function(){var b=document.querySelector('.reasoning-block');var el=document.querySelector('.reasoning-body');return b && !b.classList.contains('open') && el && getComputedStyle(el).display === 'none'})()" 30
check "完成后思考块自动收起" "(function(){var b=document.querySelector('.reasoning-block');var el=document.querySelector('.reasoning-body');return b && !b.classList.contains('open') && el && getComputedStyle(el).display === 'none'})()"
check "完成后块头文案切为「思考过程」" "document.body.innerText.includes('思考过程')"

agent-browser eval "document.querySelector('.reasoning-block .reasoning-head').click()" >/dev/null 2>&1
poll_expr "!!document.querySelector('.reasoning-block.open .reasoning-body')" 5
check "点击块头可重新展开" "!!document.querySelector('.reasoning-block.open .reasoning-body')"
check "重开后保持底部位置（流式期间跟随所致）" "(function(){var el=document.querySelector('.reasoning-body');return el && el.scrollHeight - el.scrollTop - el.clientHeight < 2})()"
check "重开后末段内容可见（贴底正确性）" "(function(){var el=document.querySelector('.reasoning-body');return el && el.textContent.includes('第 40 段')})()"
agent-browser screenshot "$SHOTS/task39-reopened.png" >/dev/null 2>&1

agent-browser close >/dev/null 2>&1

echo ""
echo "========== 结果：PASS=$PASS FAIL=$FAIL =========="
if [ ${#FAILED_NAMES[@]} -gt 0 ]; then
  printf '失败项: %s\n' "${FAILED_NAMES[@]}"
fi
[ "$FAIL" -eq 0 ] && echo "ALL_GREEN" || exit 1
