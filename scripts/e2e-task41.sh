#!/usr/bin/env bash
# Task 41 E2E：AI 工具八项增强
# 1. 用户消息选中样式：::selection 实底主色（与气泡底色区分）
# 2. 上下文 85% 自动 compact：2112/2400=88% → 下一条消息触发压缩请求 + 分隔条 + 摘要续聊
# 3. 工具调用轮数上限设置项（默认 50，可改 2 → 循环分支验证中止文案）
# 4. 思考块铺满宽度（助手消息主体 flex:1）
# 5. 思考块贴底跟随修复：80 段 × 8ms 高频流（程序滚动 vs scroll 事件竞态）仍贴底
# 6. 技能加载单独一轮工具调用：loadSkill(table-design: conventions+indexes)
#    聊天芯片独立样式「技能 表结构设计 · 2 部分」+ 右侧记录技能部分清单
# 7. 任务清单：汇报/同步模板解析为左侧面板（四态）→ 中止转暂停 → 下轮注入暂停任务（mock 日志验证）
# 8. 建议列表新增画布重排建议
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
node scripts/ai-sse-mock-scroll.mjs 4833 > /tmp/task41-mock.log 2>&1 &
MOCK_PID=$!
AI_MOCK_PROXY=1 ./node_modules/.bin/vp dev > /tmp/task41-dev.log 2>&1 &
DEV_PID=$!

PORT=""
for i in $(seq 1 40); do
  PORT=$(grep -oE 'localhost:[0-9]+' /tmp/task41-dev.log | head -1 | cut -d: -f2)
  if [ -n "$PORT" ] && curl -s "http://localhost:$PORT" >/dev/null 2>&1; then break; fi
  sleep 1
done
if [ -z "$PORT" ]; then echo "FATAL: dev server 未就绪"; tail -20 /tmp/task41-dev.log; exit 1; fi
echo "== dev server: http://localhost:$PORT =="

export AGENT_BROWSER_SESSION="task41-e2e-$$"
agent-browser open "http://localhost:$PORT" >/dev/null 2>&1
agent-browser wait --load networkidle >/dev/null 2>&1 || true

# ---------- 2. 设置页：配置 AI 服务 + 上下文 2400（2112/2400=88% 触发压缩）----------
echo "== 设置页 =="
header_nav 系统设置
poll_expr "!!document.querySelector('.settings-nav')" 5

agent-browser find first ".ai-card input" fill "http://localhost:$PORT/__ai-mock/v1" >/dev/null 2>&1
agent-browser find text 添加模型 click >/dev/null 2>&1
sleep 0.5
agent-browser find nth 2 ".ai-card input" fill "glm-4.6" >/dev/null 2>&1
# 模型行「输入上下文」（第一个 ant-input-number，rounds 块在模型列表之后不影响顺序）
sleep 0.3
agent-browser find first ".ai-card .ant-input-number input" fill "2400" >/dev/null 2>&1
sleep 0.3
# 轮数上限：默认 50（bash 比较——eval 内不能用 shell 语法）
ROUNDS_DEFAULT=$(agent-browser eval "document.querySelector('.rounds-block .ant-input-number input')?.value" 2>/dev/null | tr -d '"')
if [ "$ROUNDS_DEFAULT" = "50" ]; then
  PASS=$((PASS+1)); echo "  PASS  轮数上限设置项存在且默认 50"
else
  FAIL=$((FAIL+1)); FAILED_NAMES+=("轮数上限默认值"); echo "  FAIL  轮数上限设置项存在且默认 50（当前 $ROUNDS_DEFAULT）"
fi
agent-browser eval "[...document.querySelectorAll('.settings-foot button')].find(b => b.textContent.trim() === '保存设置')?.click()" >/dev/null 2>&1
poll_expr "document.body.innerText.includes('设置已保存')" 8
check "AI 服务配置保存" "document.body.innerText.includes('设置已保存')"

# ---------- 3. AI 工具页：三栏布局 + 建议列表 + 选中样式 ----------
echo "== AI 工具页布局 =="
header_nav "AI 工具"
poll_expr "!!document.querySelector('.ai-view')" 5

check "左侧任务清单面板存在" "!!document.querySelector('.task-pane')"
check "任务面板空态文案" "(function(){var el=document.querySelector('.task-empty');return el && el.textContent.includes('暂无任务')})()"
check "建议列表含画布重排建议" "(function(){return [...document.querySelectorAll('.suggestion-chip')].some(c => c.textContent.includes('重新设置每个表卡片的位置') && c.textContent.includes('美化当前画布布置'))})()"

# 选中样式：发送一条消息产生用户气泡
agent-browser find first ".input-box textarea" fill "选中样式测试" >/dev/null 2>&1
agent-browser eval "document.querySelector('.send-btn').click()" >/dev/null 2>&1
poll_expr "!document.querySelector('.send-btn.stop')" 30
check "用户消息已渲染" "(function(){return [...document.querySelectorAll('.msg.user .user-text')].some(e => e.textContent.includes('选中样式测试'))})()"

# 选中样式：::selection 规则应为实底主色 + 专用前景色（旧实现仅 primary-weak 背景，与气泡同色不可见）
check "用户消息选中样式规则为实底主色（可见）" "(function(){
  var hits = [];
  for (var i = 0; i < document.styleSheets.length; i++) {
    try {
      var rules = document.styleSheets[i].cssRules;
      for (var j = 0; j < rules.length; j++) {
        var r = rules[j];
        if (r.selectorText && r.selectorText.indexOf('::selection') >= 0) hits.push(String(r.style.cssText));
      }
    } catch (e) {}
  }
  var solid = hits.filter(function(t){return t.indexOf('--dbm-primary)') >= 0 && t.indexOf('on-primary') >= 0;});
  var weakOnly = hits.filter(function(t){return t.indexOf('primary-weak') >= 0 && t.indexOf('on-primary') < 0;});
  return solid.length >= 1 && weakOnly.length === 0;
})()"

# ---------- 4. 快速思考流：贴底跟随竞态修复 + 思考块铺满宽度 ----------
echo "== 快速思考流（高频分片竞态） =="
agent-browser find first ".input-box textarea" fill "快速思考验证" >/dev/null 2>&1
agent-browser eval "document.querySelector('.send-btn').click()" >/dev/null 2>&1
poll_expr "!!document.querySelector('.reasoning-block.open .reasoning-body')" 8
# 120 段 × 8ms ≈ 1s：段落到 30+ 时立即检查（旧实现在此竞态下早已停跟，最后一段不可见）
poll_expr "(function(){var els=document.querySelectorAll('.reasoning-body');var last=els[els.length-1];return last && /第 3[0-9] 段/.test(last.textContent)})()" 10
check "高频流中思考块保持贴底（溢出 + 已滚下 + 距底 < 24px）" "(function(){var els=document.querySelectorAll('.reasoning-body');var el=els[els.length-1];if(!el)return false;if(getComputedStyle(el).display==='none')return false;return el.scrollHeight>el.clientHeight && el.scrollTop>0 && (el.scrollHeight-el.scrollTop-el.clientHeight)<24})()"
poll_expr "!document.querySelector('.send-btn.stop')" 20

# 完成后重开思考块量宽度（v-show 保留 DOM）
agent-browser eval "[...document.querySelectorAll('.reasoning-head')].pop()?.click()" >/dev/null 2>&1
sleep 0.5
check "思考块铺满聊天区宽度（≥ 内容宽 - 80）" "(function(){var block=document.querySelector('.reasoning-block');var scroll=document.querySelector('.chat-scroll');return block && scroll && block.offsetWidth >= scroll.clientWidth - 80})()"
check "助手消息主体铺满（flex 拉伸）" "(function(){var body=[...document.querySelectorAll('.msg.assistant .msg-body')].pop();var scroll=document.querySelector('.chat-scroll');return body && scroll && body.offsetWidth >= scroll.clientWidth - 80})()"

# ---------- 5. 技能加载：单独一轮工具调用 + 独立样式 ----------
echo "== 技能加载 =="
agent-browser find first ".input-box textarea" fill "加载技能演示" >/dev/null 2>&1
agent-browser eval "document.querySelector('.send-btn').click()" >/dev/null 2>&1
poll_expr "!!document.querySelector('.tool-chip.skill')" 20
check "聊天区技能芯片独立样式" "(function(){var c=document.querySelector('.tool-chip.skill');return c && c.textContent.includes('技能') && c.textContent.includes('表结构设计') && c.textContent.includes('2 部分')})()"
poll_expr "(function(){var r=[...document.querySelectorAll('.tool-record.skill')].find(x=>x.classList.contains('success'));return !!r})()" 20
check "右侧技能记录 success + 独立样式" "(function(){var r=[...document.querySelectorAll('.tool-record.skill')].find(x=>x.classList.contains('success'));return r && r.textContent.includes('技能·表结构设计')})()"
agent-browser eval "[...document.querySelectorAll('.tool-record.skill .record-head')].pop()?.click()" >/dev/null 2>&1
sleep 0.5
check "技能记录展示已加载部分清单" "(function(){var rec=[...document.querySelectorAll('.tool-record.skill')].pop();if(!rec)return false;var chips=[...rec.querySelectorAll('.skill-part-chip')].map(c=>c.textContent);return chips.includes('主键与约定字段') && chips.includes('索引设计规范') && chips.length===2})()"
check "技能加载为单独一轮工具调用（单条 loadSkill 记录）" "(function(){return document.querySelectorAll('.tool-record.skill').length===1})()"
poll_expr "!document.querySelector('.send-btn.stop')" 20
agent-browser screenshot "$SHOTS/task41-skill-load.png" >/dev/null 2>&1

# ---------- 6. 任务清单：模板解析 → 中止暂停 → 下轮注入 ----------
echo "== 任务清单 =="
agent-browser find first ".input-box textarea" fill "演示任务清单流程" >/dev/null 2>&1
agent-browser eval "document.querySelector('.send-btn').click()" >/dev/null 2>&1
poll_expr "document.querySelectorAll('.task-item').length === 3" 15
check "汇报模板解析为任务面板（3 项）" "document.querySelectorAll('.task-item').length === 3"
poll_expr "!!document.querySelector('.task-item.running')" 15
check "同步模板更新状态（执行中出现）" "!!document.querySelector('.task-item.running')"
check "同步后已完成项带完成态" "!!document.querySelector('.task-item.completed')"
check "汇总芯片显示执行中/完成计数" "(function(){var s=document.querySelector('.task-summary');return s && s.textContent.includes('执行中 1') && s.textContent.includes('完成 1')})()"
# 第三轮慢速长流中中止 → 执行中任务转暂停
poll_expr "(function(){var els=document.querySelectorAll('.msg');var last=els[els.length-1];return last && last.textContent.includes('正在设计订单表字段')})()" 15
agent-browser eval "document.querySelector('.send-btn.stop')?.click()" >/dev/null 2>&1
poll_expr "!document.querySelector('.send-btn.stop')" 15
sleep 1
check "中止后执行中任务转暂停" "(function(){var el=document.querySelector('.task-item.paused');return el && el.textContent.includes('设计订单表字段')})()"
check "中止后其他任务状态保留" "(function(){return !!document.querySelector('.task-item.completed') && !!document.querySelector('.task-item.pending')})()"
agent-browser screenshot "$SHOTS/task41-task-paused.png" >/dev/null 2>&1

# 下一轮发送：暂停任务注入（mock 回显分支日志验证）
agent-browser find first ".input-box textarea" fill "继续完成任务" >/dev/null 2>&1
agent-browser eval "document.querySelector('.send-btn').click()" >/dev/null 2>&1
poll_expr "!document.querySelector('.send-btn.stop')" 20
if rg -q "ECHO-LAST-USER.*暂停.*设计订单表字段" /tmp/task41-mock.log 2>/dev/null; then
  PASS=$((PASS+1)); echo "  PASS  下轮发送注入暂停任务（mock 日志验证）"
else
  FAIL=$((FAIL+1)); FAILED_NAMES+=("暂停任务注入"); echo "  FAIL  暂停任务注入"
fi
check "任务块不从助手正文重复展示（已剥离）" "(function(){return ![...document.querySelectorAll('.msg.assistant .msg-content')].some(e => e.textContent.includes('【任务清单'))})()"
# 回显分支同步全部完成：任务面板全部已完成且无暂停
check "继续后任务全部完成（同步模板生效）" "(function(){var items=[...document.querySelectorAll('.task-item')];return items.length===3 && items.every(function(t){return t.classList.contains('completed')})})()"
check "继续后无暂停任务（注入仅在有暂停时发生）" "(function(){return !document.querySelector('.task-item.paused')})()"

# ---------- 7. 上下文 85% 自动压缩 ----------
echo "== 上下文自动压缩 =="
agent-browser find first ".input-box textarea" fill "压缩演示任务" >/dev/null 2>&1
agent-browser eval "document.querySelector('.send-btn').click()" >/dev/null 2>&1
poll_expr "(function(){var el=document.querySelector('.tok-stats .ctx-meter');return el && el.textContent.replace(/\\s/g,'').includes('2112/2400')})()" 25
check "压缩流程后占用 2112/2400（88%）" "(function(){var el=document.querySelector('.tok-stats .ctx-meter');return el && el.textContent.replace(/\\s/g,'').includes('2112/2400')})()"
check "占用超 80% 警告色" "(function(){var el=document.querySelector('.tok-stats .ctx-meter');return el && (el.classList.contains('warn') || el.classList.contains('compact'))})()"

# 下一条消息：轮边界触发自动压缩（2112/2400=88% ≥ 85%，sinceCompact=4）
agent-browser find first ".input-box textarea" fill "做个简单总结" >/dev/null 2>&1
agent-browser eval "document.querySelector('.send-btn').click()" >/dev/null 2>&1
poll_expr "!!document.querySelector('.msg-compact')" 25
check "自动压缩分隔条出现" "!!document.querySelector('.msg-compact')"
if rg -q "COMPACT-SUMMARY-REQ" /tmp/task41-mock.log 2>/dev/null; then
  PASS=$((PASS+1)); echo "  PASS  压缩请求已发出（mock 日志验证）"
else
  FAIL=$((FAIL+1)); FAILED_NAMES+=("压缩请求"); echo "  FAIL  压缩请求"
fi
poll_expr "!document.querySelector('.send-btn.stop')" 25
sleep 1
check "压缩后继续完成任务（摘要续聊回答）" "(function(){var els=[...document.querySelectorAll('.msg.assistant .msg-content')];return els.some(e => e.textContent.includes('已基于压缩摘要继续任务'))})()"
check "压缩后上下文回落（460/2400）" "(function(){var el=document.querySelector('.tok-stats .ctx-meter');return el && el.textContent.replace(/\\s/g,'').includes('460/2400')})()"
agent-browser screenshot "$SHOTS/task41-compact.png" >/dev/null 2>&1

# ---------- 8. 轮数上限：改为 2 → 循环分支中止 ----------
echo "== 轮数上限 =="
header_nav 系统设置
poll_expr "!!document.querySelector('.settings-nav')" 5
agent-browser find first ".rounds-block .ant-input-number input" fill "2" >/dev/null 2>&1
sleep 0.3
agent-browser eval "[...document.querySelectorAll('.settings-foot button')].find(b => b.textContent.trim() === '保存设置')?.click()" >/dev/null 2>&1
poll_expr "document.body.innerText.includes('设置已保存')" 8
check "轮数上限改为 2 已保存" "document.body.innerText.includes('设置已保存')"

header_nav "AI 工具"
poll_expr "!!document.querySelector('.ai-view')" 5
agent-browser find first ".input-box textarea" fill "循环测试" >/dev/null 2>&1
agent-browser eval "document.querySelector('.send-btn').click()" >/dev/null 2>&1
poll_expr "document.body.innerText.includes('已连续执行 2 轮工具调用仍未得到最终回答')" 30
check "达到轮数上限自动中止（提示 2 轮）" "document.body.innerText.includes('已连续执行 2 轮工具调用仍未得到最终回答')"
agent-browser screenshot "$SHOTS/task41-rounds-limit.png" >/dev/null 2>&1

agent-browser close >/dev/null 2>&1

echo ""
echo "========== 结果：PASS=$PASS FAIL=$FAIL =========="
if [ ${#FAILED_NAMES[@]} -gt 0 ]; then
  printf '失败项: %s\n' "${FAILED_NAMES[@]}"
fi
[ "$FAIL" -eq 0 ] && echo "ALL_GREEN" || exit 1
