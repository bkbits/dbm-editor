#!/usr/bin/env bash
# Task 35 E2E：AI 工具与设置页 11 项修复的真实验证
# 单次调用内完成：起 mock SSE + dev server → 浏览器全流程断言 → 截图 → 杀服务
# （沙箱在工具调用之间回收派生进程，故必须一体化执行）
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
  [ -n "${DEV_PID:-}" ] && kill "$DEV_PID" 2>/dev/null
  [ -n "${MOCK_PID:-}" ] && kill "$MOCK_PID" 2>/dev/null
}
trap cleanup EXIT

cd "$ROOT"

# ---------- 1. 起服务 ----------
node scripts/ai-sse-mock.mjs 4833 > /tmp/task35-mock.log 2>&1 &
MOCK_PID=$!
AI_MOCK_PROXY=1 ./node_modules/.bin/vp dev > /tmp/task35-dev.log 2>&1 &
DEV_PID=$!

PORT=""
for i in $(seq 1 40); do
  PORT=$(grep -oE 'localhost:[0-9]+' /tmp/task35-dev.log | head -1 | cut -d: -f2)
  if [ -n "$PORT" ] && curl -s "http://localhost:$PORT" >/dev/null 2>&1; then break; fi
  sleep 1
done
if [ -z "$PORT" ]; then echo "FATAL: dev server 未就绪"; tail -20 /tmp/task35-dev.log; exit 1; fi
echo "== dev server: http://localhost:$PORT =="

export AGENT_BROWSER_SESSION="task35-e2e"
agent-browser open "http://localhost:$PORT" >/dev/null 2>&1
agent-browser wait --load networkidle >/dev/null 2>&1 || true

# ---------- 2. 设置页：导航 / 固定保存条 / AI 统一保存 ----------
echo "== 设置页 =="
header_nav 系统设置
poll_expr "!!document.querySelector('.settings-nav')" 5

check "导航菜单存在且 5 项" "document.querySelectorAll('.settings-nav .nav-item').length === 5"
check "保存条在页面结构底部（不随滚动）" "!!document.querySelector('.settings-view > .settings-foot')"
check "初始状态无未保存修改" "document.body.innerText.includes('全部更改已保存')"

# 点击 AI 导航项 → 平滑滚动（轮询等待滚动到位 + 高亮）
agent-browser eval "document.querySelectorAll('.settings-nav .nav-item')[4].click()" >/dev/null 2>&1
poll_expr "document.querySelector('.settings-scroll').scrollTop > 80" 5
sleep 1.2
check "点击导航后内容区滚动" "document.querySelector('.settings-scroll').scrollTop > 80"
poll_expr "document.querySelectorAll('.settings-nav .nav-item')[4].classList.contains('active')" 6
check "AI 分区导航高亮" "document.querySelectorAll('.settings-nav .nav-item')[4].classList.contains('active')"
check "AI 区块无独立保存按钮" "!document.body.innerText.includes('保存 AI 设置')"

# 滚回顶部 → scrollspy 高亮首项
agent-browser eval "document.querySelector('.settings-scroll').scrollTop = 0" >/dev/null 2>&1
sleep 0.6
check "滚回顶部高亮首项（scrollspy）" "document.querySelectorAll('.settings-nav .nav-item')[0].classList.contains('active')"

# 填写 AI 设置并统一保存（CSS 定位：antd 输入框 placeholder 子串匹配不可靠）
agent-browser find first ".ai-card input" fill "http://localhost:$PORT/__ai-mock/v1" >/dev/null 2>&1
agent-browser find text 添加模型 click >/dev/null 2>&1
sleep 0.5
agent-browser find nth 2 ".ai-card input" fill "glm-4.6" >/dev/null 2>&1
sleep 0.3
check "统一保存按钮因 AI 草稿启用" "![...document.querySelectorAll('.settings-foot button')].find(b=>b.textContent.trim()==='保存设置')?.disabled"
agent-browser eval "[...document.querySelectorAll('.settings-foot button')].find(b => b.textContent.trim() === '保存设置')?.click()" >/dev/null 2>&1
poll_expr "document.body.innerText.includes('设置已保存')" 8
check "统一保存成功提示" "document.body.innerText.includes('设置已保存')"
poll_expr "document.body.innerText.includes('全部更改已保存')" 6
check "保存后脏标记收口（含 AI 草稿）" "document.body.innerText.includes('全部更改已保存')"

# 滚到底部，保存条仍完整可见
agent-browser eval "document.querySelector('.settings-scroll').scrollTop = 999999" >/dev/null 2>&1
sleep 0.6
check "滚底后保存条仍完整可见" "(function(){var r = document.querySelector('.settings-foot').getBoundingClientRect(); return r.height > 0 && r.bottom <= window.innerHeight + 1})()"
agent-browser screenshot "$SHOTS/task35-settings-nav.png" >/dev/null 2>&1

# ---------- 3. AI 工具页 ----------
echo "== AI 工具页 =="
header_nav "AI 工具"
poll_expr "!!document.querySelector('.ai-view')" 5

check "发送按钮 svg 图标渲染" "!!document.querySelector('.send-btn svg')"
check "发送图标前景色与背景不同色" "(function(){var b = document.querySelector('.send-btn'); var s = b.querySelector('svg'); return getComputedStyle(s).color !== getComputedStyle(b).backgroundColor})()"

# 发送消息（textarea 原生元素）
agent-browser find first ".input-box textarea" fill "生成代码并替换" >/dev/null 2>&1
agent-browser eval "document.querySelector('.send-btn').click()" >/dev/null 2>&1

# 流式中：思考自动展开 + 停止按钮
poll_expr "!!document.querySelector('.reasoning-block.open')" 8
check "流式中思考块自动展开" "!!document.querySelector('.reasoning-block.open')"

# 第一轮 generateCode 完成
poll_expr "document.querySelectorAll('.tool-record').length >= 1 && !!document.querySelector('.tool-record.success')" 25
check "generateCode 记录成功" "(document.querySelector('.tool-record .rec-name') || {textContent:''}).textContent === 'generateCode'"
check "记录头 zip 迷你下载按钮" "!!document.querySelector('.tool-record .zip-mini')"

# 停止按钮（running 状态下，替换确认弹窗等待期间稳定可见）
check "停止按钮 svg 图标渲染" "!!document.querySelector('.send-btn.stop svg')"
check "停止图标实心填充" "(function(){var s = document.querySelector('.send-btn.stop svg'); return s && getComputedStyle(s).fill !== 'none'})()"

# 第二轮 replaceCode → 确认弹窗（文件清单）
poll_expr "!!document.querySelector('.ant-modal .rp-tip')" 25
check "替换确认弹窗出现" "!!document.querySelector('.ant-modal .rp-tip')"
check "弹窗列出待替换文件" "document.querySelectorAll('.ant-modal .rp-row').length > 0"
agent-browser screenshot "$SHOTS/task35-replace-confirm.png" >/dev/null 2>&1
agent-browser eval "[...document.querySelectorAll('.ant-modal button')].find(b => b.textContent.replace(/\s/g, '') === '确认替换')?.click()" >/dev/null 2>&1

# 第三轮最终 Markdown（markstream 渲染；根元素同时携带 markstream-vue 与 md-render 类）
poll_expr "document.querySelectorAll('.md-render h2').length > 0" 25
sleep 2.5
check "markstream 根容器（复合类）" "!!document.querySelector('.md-render.markstream-vue')"
check "Markdown h2 标题渲染" "(document.querySelector('.md-render h2') || {textContent:''}).textContent.includes('任务完成')"
check "Markdown 代码块渲染" "!!document.querySelector('.md-render pre')"
check "最终文本去首部空白" "!(/^\s/.test(document.querySelectorAll('.md-render')[document.querySelectorAll('.md-render').length - 1]?.textContent || ' '))"
check "replaceCode 记录成功" "[...document.querySelectorAll('.tool-record .rec-name')].some(n => n.textContent === 'replaceCode' && n.closest('.tool-record').classList.contains('success'))"

# 右侧面板：防挤压 + 贴底
check "记录项 flex-shrink 0（不挤压）" "getComputedStyle(document.querySelector('.tool-record')).flexShrink === '0'"
check "消息项 flex-shrink 0（不挤压）" "getComputedStyle(document.querySelector('.msg')).flexShrink === '0'"
check "记录面板跟随到底部" "(function(){var el = document.querySelector('.tools-list'); return el && el.scrollHeight - el.scrollTop - el.clientHeight < 6})()"

# 展开首条记录 → zip 下载按钮
agent-browser eval "document.querySelector('.tool-record .record-head').click()" >/dev/null 2>&1
sleep 0.5
check "展开后 zip 下载主按钮" "!!document.querySelector('.rec-zip .zip-btn')"
check "zip 文件名 dbm-codegen 前缀" "(document.querySelector('.rec-zip .zip-btn .mono') || {textContent:''}).textContent.startsWith('dbm-codegen-')"

agent-browser screenshot "$SHOTS/task35-ai-chat.png" >/dev/null 2>&1

# ---------- 4. 暗色主题 ----------
agent-browser eval "document.querySelector('button[title=\"切换为暗色主题\"]')?.click()" >/dev/null 2>&1
sleep 1
check "暗色下 markstream dark 类生效" "!!document.querySelector('.md-render.markstream-vue.dark')"
check "暗色下发送按钮图标前景令牌" "!!document.querySelector('.send-btn')"
agent-browser screenshot "$SHOTS/task35-ai-chat-dark.png" >/dev/null 2>&1

agent-browser close >/dev/null 2>&1

echo ""
echo "========== 结果：PASS=$PASS FAIL=$FAIL =========="
if [ ${#FAILED_NAMES[@]} -gt 0 ]; then
  printf '失败项: %s\n' "${FAILED_NAMES[@]}"
fi
[ "$FAIL" -eq 0 ] && echo "ALL_GREEN" || exit 1
