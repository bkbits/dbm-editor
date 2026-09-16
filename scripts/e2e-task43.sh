#!/usr/bin/env bash
# Task 43 E2E：AI 工具内核接入 pi-agent-core 专项验证
# 1. 参数校验链路：模型缺必填参数（saveSettings 无 indexTypes）→ pi typebox 校验失败
#    转错误工具结果（记录 error + 英文 Validation failed 文案）→ 模型补参重试成功 → 会话不中断
# 2. 执行失败链路：removeTable 不存在 id → api 中文错误 → 记录 error + 回填模型文本带
#    「工具执行失败：」前缀（mock 日志验证模型可见）
# 3. 同轮双工具：getSettings + getTables 并列调用 → 串行执行（记录顺序 A→B）+ 结果各自回填
# 4. 系统提示与工具定义流入：system 含能力域清单；tools 数量 > 30（契约全量注册）
# 5. 历史回放：第二轮请求包含首轮 assistant（含 tool_calls）与 tool 结果消息（mock 角色序列验证）
# 6. 会话基本回归：思考流式 + 正文 + usage 收口（上下文/速度/消息级标签）
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
  if [ -n "${DEV_PID:-}" ]; then
    pkill -P "$DEV_PID" 2>/dev/null
    kill "$DEV_PID" 2>/dev/null
  fi
  [ -n "${MOCK_PID:-}" ] && kill "$MOCK_PID" 2>/dev/null
}
trap cleanup EXIT

cd "$ROOT"

# ---------- 1. 起服务 ----------
node scripts/ai-sse-mock-pi.mjs 4833 > /tmp/task43-mock.log 2>&1 &
MOCK_PID=$!
AI_MOCK_PROXY=1 ./node_modules/.bin/vp dev > /tmp/task43-dev.log 2>&1 &
DEV_PID=$!

PORT=""
for i in $(seq 1 40); do
  PORT=$(grep -oE 'localhost:[0-9]+' /tmp/task43-dev.log | head -1 | cut -d: -f2)
  if [ -n "$PORT" ] && curl -s "http://localhost:$PORT" >/dev/null 2>&1; then break; fi
  sleep 1
done
if [ -z "$PORT" ]; then echo "FATAL: dev server 未就绪"; tail -20 /tmp/task43-dev.log; exit 1; fi
echo "== dev server: http://localhost:$PORT =="

export AGENT_BROWSER_SESSION="task43-e2e-$$"
agent-browser open "http://localhost:$PORT" >/dev/null 2>&1
agent-browser wait --load networkidle >/dev/null 2>&1 || true

# ---------- 2. 设置页：配置 AI 服务 ----------
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

# ---------- 3. 系统提示与工具定义流入（首个请求的 mock 日志验证） ----------
echo "== 内核接入：系统提示与工具定义 =="
header_nav "AI 工具"
poll_expr "!!document.querySelector('.ai-view')" 5
agent-browser find first ".input-box textarea" fill "历史回放首轮" >/dev/null 2>&1
agent-browser eval "document.querySelector('.send-btn').click()" >/dev/null 2>&1
poll_expr "!document.querySelector('.send-btn.stop')" 25
sleep 1
check "首轮回答完成（历史回放分支）" "document.body.innerText.includes('历史回放完成')"
if rg -q "sys-has-capability=true" /tmp/task43-mock.log 2>/dev/null; then
  PASS=$((PASS+1)); echo "  PASS  系统提示含能力域清单（system 流入）"
else
  FAIL=$((FAIL+1)); FAILED_NAMES+=("系统提示能力域"); echo "  FAIL  系统提示能力域"; grep "pi-mock" /tmp/task43-mock.log | head -3
fi
if rg -q "tools=3[0-9]" /tmp/task43-mock.log 2>/dev/null; then
  PASS=$((PASS+1)); echo "  PASS  工具定义全量注册（30+ 个契约能力）"
else
  FAIL=$((FAIL+1)); FAILED_NAMES+=("工具定义注册"); echo "  FAIL  工具定义注册"; grep -o "tools=[0-9]*" /tmp/task43-mock.log | head -3
fi

# ---------- 4. 历史回放：第二轮请求包含首轮 assistant 与 tool 形态 ----------
echo "== 历史回放 =="
agent-browser find first ".input-box textarea" fill "历史回放二轮" >/dev/null 2>&1
agent-browser eval "document.querySelector('.send-btn').click()" >/dev/null 2>&1
poll_expr "document.body.innerText.includes('已收到 4 条消息')" 25
sleep 1
if rg -q "roles=\[system,user,assistant,user\]" /tmp/task43-mock.log 2>/dev/null; then
  PASS=$((PASS+1)); echo "  PASS  第二轮请求角色序列 system,user,assistant,user（种子回放正确）"
else
  FAIL=$((FAIL+1)); FAILED_NAMES+=("历史回放角色序列"); echo "  FAIL  历史回放角色序列"; grep "roles=" /tmp/task43-mock.log | tail -2
fi
check "二轮回答完成" "document.body.innerText.includes('已收到 4 条消息')"

# ---------- 5. 参数校验链路（pi typebox schema 校验） ----------
echo "== 参数校验链路 =="
agent-browser find first ".input-box textarea" fill "参数校验演示" >/dev/null 2>&1
agent-browser eval "document.querySelector('.send-btn').click()" >/dev/null 2>&1
poll_expr "(function(){var recs=[...document.querySelectorAll('.tool-record')];var r=recs.find(x => x.textContent.includes('removeCategory') && x.classList.contains('error'));return !!r})()" 30
check "缺参调用记录为 error 态" "(function(){var recs=[...document.querySelectorAll('.tool-record')];var r=recs.find(x => x.textContent.includes('removeCategory') && x.classList.contains('error'));return !!r})()"
# 展开错误记录读校验文案（record-body 仅展开态渲染）
agent-browser eval "document.querySelector('.tool-record.error .record-head')?.click()" >/dev/null 2>&1
sleep 0.5
check "错误记录含 typebox 校验文案（Validation failed / categoryId）" "(function(){var b=document.querySelector('.tool-record.error .record-body');return b && b.textContent.includes('Validation failed') && b.textContent.includes('categoryId')})()"
poll_expr "(function(){var recs=[...document.querySelectorAll('.tool-record')];return recs.some(x => x.textContent.includes('getSettings') && x.classList.contains('success'))})()" 30
check "换合法工具重试后记录 success" "(function(){var recs=[...document.querySelectorAll('.tool-record')];return recs.some(x => x.textContent.includes('getSettings') && x.classList.contains('success'))})()"
check "参数校验会话最终收尾（不中断）" "document.body.innerText.includes('参数校验链路完成')"
if rg -q "tool-result-text: Validation failed" /tmp/task43-mock.log 2>/dev/null; then
  PASS=$((PASS+1)); echo "  PASS  校验失败结果已回填模型并触发重试（第二轮请求到达）"
else
  FAIL=$((FAIL+1)); FAILED_NAMES+=("校验失败回填重试"); echo "  FAIL  校验失败回填重试"; grep "tool-result-text" /tmp/task43-mock.log | tail -2
fi

# ---------- 6. 执行失败链路（api 中文错误 + 前缀回填） ----------
echo "== 执行失败链路 =="
agent-browser find first ".input-box textarea" fill "执行失败演示" >/dev/null 2>&1
agent-browser eval "document.querySelector('.send-btn').click()" >/dev/null 2>&1
poll_expr "(function(){var errs=[...document.querySelectorAll('.tool-record.error')];return errs.length >= 2})()" 30
check "removeCategory(cat-system) 记录为 error 态（第 2 个错误记录）" "(function(){var errs=[...document.querySelectorAll('.tool-record.error')];return errs.length >= 2})()"
agent-browser eval "document.querySelector('.tool-record.error:last-of-type .record-head')?.click()" >/dev/null 2>&1
sleep 0.5
check "错误记录含 api 中文原因（分类下仍有表）" "(function(){var b=document.querySelector('.tool-record.error:last-of-type .record-body');return b && b.textContent.includes('分类下仍有')})()"
check "执行失败会话最终收尾" "document.body.innerText.includes('执行失败链路完成')"
if rg -q "tool-result-text: .*工具执行失败：.*分类下仍有" /tmp/task43-mock.log 2>/dev/null; then
  PASS=$((PASS+1)); echo "  PASS  错误文本带前缀回填模型（mock 收到「工具执行失败：分类下仍有」）"
else
  FAIL=$((FAIL+1)); FAILED_NAMES+=("错误前缀回填"); echo "  FAIL  错误前缀回填"; grep "tool-result-text" /tmp/task43-mock.log | tail -2
fi

# ---------- 7. 同轮双工具（串行执行顺序） ----------
echo "== 同轮双工具 =="
agent-browser find first ".input-box textarea" fill "双工具演示" >/dev/null 2>&1
agent-browser eval "document.querySelector('.send-btn').click()" >/dev/null 2>&1
poll_expr "(function(){var recs=[...document.querySelectorAll('.tool-record .rec-name')];return recs.length >= 2 && recs[recs.length-2].textContent === 'getSettings' && recs[recs.length-1].textContent === 'getTables'})()" 30
check "同轮双工具按声明顺序串行执行（getSettings → getTables）" "(function(){var recs=[...document.querySelectorAll('.tool-record .rec-name')];return recs.length >= 2 && recs[recs.length-2].textContent === 'getSettings' && recs[recs.length-1].textContent === 'getTables'})()"
check "双工具均 success" "(function(){var recs=[...document.querySelectorAll('.tool-record')];var last2=recs.slice(-2);return last2.every(x => x.classList.contains('success'))})()"
check "双工具会话最终收尾" "document.body.innerText.includes('双工具链路完成')"
if rg -q "roles=.*assistant,tool,tool" /tmp/task43-mock.log 2>/dev/null; then
  PASS=$((PASS+1)); echo "  PASS  双工具结果按序回填（assistant,tool,tool 序列）"
else
  FAIL=$((FAIL+1)); FAILED_NAMES+=("双工具回填序列"); echo "  FAIL  双工具回填序列"; grep "roles=" /tmp/task43-mock.log | tail -2
fi

# ---------- 8. 会话统计回归（usage 收口） ----------
echo "== 会话统计回归 =="
check "上下文占用已展示（usage total）" "(function(){var el=document.querySelector('.tok-stats .ctx-meter');return el && /上下文/.test(el.textContent)})()"
check "assistant 消息携带输出标签" "(function(){var els=[...document.querySelectorAll('.msg.assistant')];return els.some(e => /输出.*tok/.test(e.textContent))})()"

# ---------- 9. 截图 ----------
header_nav "AI 工具"
poll_expr "!!document.querySelector('.ai-view')" 5
agent-browser screenshot "$SHOTS/task43-pi-agent-core.png" >/dev/null 2>&1
echo "== 截图: $SHOTS/task43-pi-agent-core.png =="

agent-browser close >/dev/null 2>&1

# ---------- 汇总 ----------
echo ""
echo "=========================================="
echo "PASS: $PASS  FAIL: $FAIL"
if [ ${#FAILED_NAMES[@]} -gt 0 ]; then
  echo "失败项: ${FAILED_NAMES[*]}"
fi
echo "=========================================="
[ "$FAIL" -eq 0 ] && echo "ALL_GREEN" || exit 1
