#!/usr/bin/env bash
# Task 43-47 回归测试 B：AI 工具链路（22 项断言）
#
# 覆盖改动面：
# - Task 45 AI 仓库拆分（stores/ai.ts → stores/ai/ 八文件）后的功能等价性
# - 内核链路：系统提示能力域流入 / 工具全量注册 / 历史回放种子序列 /
#   typebox 参数校验失败回填重试 / api 中文错误前缀回填 / 同轮双工具串行 / usage 收口
#
# 前置：agent-browser 可用；dev server 若未运行则本脚本自行启动（PORT 可覆盖）；
#       mock SSE 由本脚本在 MOCK_PORT（默认 4833）启动并在退出时回收。
# 判读要点：mock 自带 CORS `*`，浏览器直连跨域端口即可（无需 AI_MOCK_PROXY 同源代理）。
set -u

ROOT="$(cd "$(dirname "$0")/.." && { pwd -W 2>/dev/null || pwd; })"
PORT="${PORT:-3000}"
BASE_URL="http://localhost:$PORT"
MOCK_PORT="${MOCK_PORT:-4833}"
SHOTS="$ROOT/docs/screenshots"
MOCK_LOG="$ROOT/tmp/regress-b-mock.log"
PASS=0; FAIL=0; FAILED=()

cd "$ROOT" || exit 1
mkdir -p "$SHOTS" "$ROOT/tmp"

# ---------- dev server：复用已有实例，否则自起 ----------
DEV_PID=""
if ! curl -s -o /dev/null -m 3 "$BASE_URL/"; then
  echo "== 未检测到 $BASE_URL，自行启动 dev server =="
  ./node_modules/.bin/vp dev > "$ROOT/tmp/regress-b-dev.log" 2>&1 &
  DEV_PID=$!
  for _ in $(seq 1 40); do
    curl -s -o /dev/null -m 2 "$BASE_URL/" && break
    sleep 1
  done
fi
if ! curl -s -o /dev/null -m 3 "$BASE_URL/"; then
  echo "FATAL: dev server 未就绪（$BASE_URL）"
  [ -n "$DEV_PID" ] && tail -20 "$ROOT/tmp/regress-b-dev.log"
  exit 1
fi

# ---------- mock SSE ----------
node scripts/ai-sse-mock-pi.mjs "$MOCK_PORT" > "$MOCK_LOG" 2>&1 &
MOCK_PID=$!
sleep 2
if ! kill -0 "$MOCK_PID" 2>/dev/null; then
  echo "FATAL: mock 启动失败（端口 $MOCK_PORT 可能被占用）"
  tail -10 "$MOCK_LOG"
  exit 1
fi

cleanup() {
  kill "$MOCK_PID" 2>/dev/null
  [ -n "$DEV_PID" ] && kill "$DEV_PID" 2>/dev/null
}
trap cleanup EXIT

check() {
  local name="$1" expr="$2" out
  out=$(agent-browser eval "$expr" 2>/dev/null | tr -d '"')
  if [ "$out" = "true" ]; then
    PASS=$((PASS+1)); echo "  PASS  $name"
  else
    FAIL=$((FAIL+1)); FAILED+=("$name"); echo "  FAIL  $name  =>  $out"
  fi
}

poll() {
  local expr="$1" t="${2:-10}" i=0 out
  while [ $i -lt $((t * 2)) ]; do
    out=$(agent-browser eval "$expr" 2>/dev/null | tr -d '"')
    [ "$out" = "true" ] && return 0
    sleep 0.5; i=$((i+1))
  done
  return 1
}

nav() { agent-browser eval "document.querySelector('.nav-btn[aria-label=\"$1\"]')?.click()" >/dev/null 2>&1; }

ask() {
  agent-browser find first ".input-box textarea" fill "$1" >/dev/null 2>&1
  sleep 0.3
  agent-browser eval "document.querySelector('.send-btn').click()" >/dev/null 2>&1
}

echo "=============================================="
echo "== 0. 页面重载并进入设置页（配置 AI 服务） =="
agent-browser open "$BASE_URL" >/dev/null 2>&1
sleep 3
agent-browser errors --clear >/dev/null 2>&1
nav "系统设置"
poll "!!document.querySelector('.settings-view')" 8
agent-browser find first '.ai-card input[placeholder*="api.example.com"]' fill "http://localhost:$MOCK_PORT/v1" >/dev/null 2>&1
sleep 0.3
agent-browser find text "添加模型" click >/dev/null 2>&1
sleep 0.6
agent-browser find first '.ai-card input[placeholder*="glm-4.6"]' fill "glm-4.6" >/dev/null 2>&1
sleep 0.4
agent-browser eval "(function(){var b=[...document.querySelectorAll('.settings-foot button')].find(function(x){return x.textContent.replace(/\\s+/g,'')==='保存设置'});if(b){b.click();return 'ok'}return 'nf'})()" >/dev/null 2>&1
poll "document.body.innerText.includes('设置已保存')" 10
check "AI 服务配置保存（设置已保存）" "document.body.innerText.includes('设置已保存')"

echo ""
echo "== 1. 系统提示与工具定义流入 =="
nav "AI 工具"
poll "!!document.querySelector('.ai-view')" 8
ask "历史回放首轮"
poll "!document.querySelector('.send-btn.stop')" 30
sleep 1.5
check "首轮回答完成（默认分支）" "document.body.innerText.includes('历史回放完成')"
if grep -q "sys-has-capability=true" "$MOCK_LOG" 2>/dev/null; then
  PASS=$((PASS+1)); echo "  PASS  系统提示含能力域清单（system 流入）"
else
  FAIL=$((FAIL+1)); FAILED+=("系统提示能力域"); echo "  FAIL  系统提示能力域"; grep "pi-mock" "$MOCK_LOG" 2>/dev/null | head -3
fi
if grep -qE "tools=3[0-9]" "$MOCK_LOG" 2>/dev/null; then
  PASS=$((PASS+1)); echo "  PASS  工具定义全量注册（30+ 个契约能力）"
else
  FAIL=$((FAIL+1)); FAILED+=("工具定义注册"); echo "  FAIL  工具定义注册"; grep -o "tools=[0-9]*" "$MOCK_LOG" 2>/dev/null | head -3
fi

echo ""
echo "== 2. 历史回放第二轮的种子序列 =="
ask "历史回放二轮"
poll "document.body.innerText.includes('已收到 4 条消息')" 30
sleep 1
check "二轮回答完成（已收到 4 条消息）" "document.body.innerText.includes('已收到 4 条消息')"
if grep -q "roles=\[system,user,assistant,user\]" "$MOCK_LOG" 2>/dev/null; then
  PASS=$((PASS+1)); echo "  PASS  第二轮角色序列 system,user,assistant,user（种子回放正确）"
else
  FAIL=$((FAIL+1)); FAILED+=("历史回放角色序列"); echo "  FAIL  历史回放角色序列"; grep "roles=" "$MOCK_LOG" 2>/dev/null | tail -2
fi

echo ""
echo "== 3. 参数校验链路（typebox schema 校验） =="
ask "参数校验演示"
poll "(function(){var recs=[...document.querySelectorAll('.tool-record')];return recs.some(function(x){return x.textContent.includes('removeCategory') && x.classList.contains('error')})})()" 35
check "缺参调用记录为 error 态" "(function(){var recs=[...document.querySelectorAll('.tool-record')];return recs.some(function(x){return x.textContent.includes('removeCategory') && x.classList.contains('error')})})()"
agent-browser eval "document.querySelector('.tool-record.error .record-head')?.click()" >/dev/null 2>&1
sleep 0.6
check "错误记录含 typebox 校验文案（Validation failed / categoryId）" "(function(){var b=document.querySelector('.tool-record.error .record-body');return !!b && b.textContent.includes('Validation failed') && b.textContent.includes('categoryId')})()"
poll "(function(){var recs=[...document.querySelectorAll('.tool-record')];return recs.some(function(x){return x.textContent.includes('getSettings') && x.classList.contains('success')})})()" 35
check "换合法工具重试后记录 success" "(function(){var recs=[...document.querySelectorAll('.tool-record')];return recs.some(function(x){return x.textContent.includes('getSettings') && x.classList.contains('success')})})()"
poll "document.body.innerText.includes('参数校验链路完成')" 30
check "参数校验会话最终收尾（不中断）" "document.body.innerText.includes('参数校验链路完成')"
if grep -q "tool-result-text: Validation failed" "$MOCK_LOG" 2>/dev/null; then
  PASS=$((PASS+1)); echo "  PASS  校验失败结果已回填模型并触发重试"
else
  FAIL=$((FAIL+1)); FAILED+=("校验失败回填重试"); echo "  FAIL  校验失败回填重试"; grep "tool-result-text" "$MOCK_LOG" 2>/dev/null | tail -2
fi

echo ""
echo "== 4. 执行失败链路（api 中文错误 + 前缀回填） =="
ask "执行失败演示"
poll "(function(){return [...document.querySelectorAll('.tool-record.error')].length >= 2})()" 35
check "removeCategory(cat-system) 记录为 error 态" "(function(){return [...document.querySelectorAll('.tool-record.error')].length >= 2})()"
agent-browser eval "document.querySelector('.tool-record.error:last-of-type .record-head')?.click()" >/dev/null 2>&1
sleep 0.6
check "错误记录含 api 中文原因（分类下仍有表）" "(function(){var b=document.querySelector('.tool-record.error:last-of-type .record-body');return !!b && b.textContent.includes('分类下仍有')})()"
poll "document.body.innerText.includes('执行失败链路完成')" 30
check "执行失败会话最终收尾" "document.body.innerText.includes('执行失败链路完成')"
if grep -q "tool-result-text: .*工具执行失败：.*分类下仍有" "$MOCK_LOG" 2>/dev/null; then
  PASS=$((PASS+1)); echo "  PASS  错误文本带前缀回填模型"
else
  FAIL=$((FAIL+1)); FAILED+=("错误前缀回填"); echo "  FAIL  错误前缀回填"; grep "tool-result-text" "$MOCK_LOG" 2>/dev/null | tail -2
fi

echo ""
echo "== 5. 同轮双工具（串行执行） =="
ask "双工具演示"
poll "(function(){var recs=[...document.querySelectorAll('.tool-record .rec-name')];return recs.length >= 2 && recs[recs.length-2].textContent === 'getSettings' && recs[recs.length-1].textContent === 'getTables'})()" 35
check "同轮双工具按声明顺序串行执行（getSettings → getTables）" "(function(){var recs=[...document.querySelectorAll('.tool-record .rec-name')];return recs.length >= 2 && recs[recs.length-2].textContent === 'getSettings' && recs[recs.length-1].textContent === 'getTables'})()"
check "双工具均 success" "(function(){var recs=[...document.querySelectorAll('.tool-record')];var last2=recs.slice(-2);return last2.every(function(x){return x.classList.contains('success')})})()"
poll "document.body.innerText.includes('双工具链路完成')" 30
check "双工具会话最终收尾" "document.body.innerText.includes('双工具链路完成')"
if grep -q "roles=.*assistant,tool,tool" "$MOCK_LOG" 2>/dev/null; then
  PASS=$((PASS+1)); echo "  PASS  双工具结果按序回填（assistant,tool,tool 序列）"
else
  FAIL=$((FAIL+1)); FAILED+=("双工具回填序列"); echo "  FAIL  双工具回填序列"; grep "roles=" "$MOCK_LOG" 2>/dev/null | tail -2
fi

echo ""
echo "== 6. 会话统计（usage 收口） =="
check "上下文占用已展示（usage total）" "(function(){var el=document.querySelector('.tok-stats .ctx-meter');return !!el && /上下文/.test(el.textContent)})()"
check "assistant 消息携带输出标签" "(function(){var els=[...document.querySelectorAll('.msg.assistant')];return els.some(function(e){return /输出.*tok/.test(e.textContent)})})()"

echo ""
echo "== 7. 截图与错误检查 =="
agent-browser screenshot "$SHOTS/regress-43-47-ai.png" >/dev/null 2>&1
ERRS=$(agent-browser errors 2>/dev/null | grep -v "^$" | wc -l)
if [ "$ERRS" = "0" ]; then
  PASS=$((PASS+1)); echo "  PASS  AI 页全程页面错误 0 条"
else
  FAIL=$((FAIL+1)); FAILED+=("AI 页错误"); echo "  FAIL  AI 页错误 $ERRS 条"; agent-browser errors 2>/dev/null | tail -5
fi

echo ""
echo "=============================================="
echo "PASS: $PASS  FAIL: $FAIL"
if [ ${#FAILED[@]} -gt 0 ]; then echo "失败项: ${FAILED[*]}"; fi
echo "=============================================="
[ "$FAIL" -eq 0 ] && echo "ALL_GREEN" || exit 1
