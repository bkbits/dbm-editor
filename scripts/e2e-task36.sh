#!/usr/bin/env bash
# Task 36 E2E：字段约定逻辑删除 + 表编辑左右固定列 + 保存链路验证
# 单次调用内完成：起 dev server → 浏览器全流程断言 → 截图 → 杀服务
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
}
trap cleanup EXIT

cd "$ROOT"

# ---------- 1. 起服务 ----------
./node_modules/.bin/vp dev > /tmp/task36-dev.log 2>&1 &
DEV_PID=$!

PORT=""
for i in $(seq 1 40); do
  PORT=$(grep -oE 'localhost:[0-9]+' /tmp/task36-dev.log | head -1 | cut -d: -f2)
  if [ -n "$PORT" ] && curl -s "http://localhost:$PORT" >/dev/null 2>&1; then break; fi
  sleep 1
done
if [ -z "$PORT" ]; then echo "FATAL: dev server 未就绪"; tail -20 /tmp/task36-dev.log; exit 1; fi
echo "== dev server: http://localhost:$PORT =="

export AGENT_BROWSER_SESSION="task36-e2e-$$"
agent-browser set viewport 1440 900 >/dev/null 2>&1
agent-browser open "http://localhost:$PORT" >/dev/null 2>&1
agent-browser wait --load networkidle >/dev/null 2>&1 || true

# ---------- 2. 设置页：逻辑删除字段设置（需求 2） ----------
echo "== 设置页：逻辑删除约定 =="
header_nav 系统设置
poll_expr "!!document.querySelector('.settings-view')" 5

check "分区导航含「字段约定」" "(function(){return [...document.querySelectorAll('.settings-nav .nav-item')].some(n => n.textContent.includes('字段约定'))})()"
check "逻辑删除约定行存在" "!!document.querySelector('.conv-logic')"
check "逻辑删除名称默认 placeholder" "document.querySelector('.conv-logic input')?.placeholder === 'deleted'"
check "逻辑删除类型默认 placeholder" "(function(){var ph=document.querySelector('.conv-logic .ant-select-selection-placeholder');return ph ? ph.textContent.trim()==='TINYINT' : document.querySelectorAll('.conv-logic input')[1]?.value==='TINYINT'})()"

# 修改逻辑删除约定名（del_flag）→ 统一保存 → 持久化验证
agent-browser find first ".conv-logic input" fill "del_flag" >/dev/null 2>&1
sleep 0.3
check "约定修改后保存按钮启用" "![...document.querySelectorAll('.settings-foot button')].find(b=>b.textContent.trim()==='保存设置')?.disabled"
agent-browser eval "[...document.querySelectorAll('.settings-foot button')].find(b => b.textContent.trim() === '保存设置')?.click()" >/dev/null 2>&1
poll_expr "document.body.innerText.includes('设置已保存')" 8
check "统一保存成功提示" "document.body.innerText.includes('设置已保存')"
sleep 0.5
check "逻辑删除约定已持久化（del_flag）" "(function(){try{var db=JSON.parse(localStorage.getItem('gdbme:db:v2'));return db.settings.fieldConventions.logicDelete.name==='del_flag'}catch(e){return false}})()"

# ---------- 3. 表编辑：逻辑删除字段标记 + 唯一互斥（需求 3） ----------
echo "== 表编辑：逻辑删除字段 =="
header_nav 模型编辑器
poll_expr "!!document.querySelector('.table-card')" 5

agent-browser eval "document.querySelector('.table-card').dispatchEvent(new MouseEvent('dblclick', {bubbles: true}))" >/dev/null 2>&1
poll_expr "!!(document.querySelector('.sync-table') && document.querySelector('.sync-table').getClientRects().length > 0)" 8
sleep 0.8

check "字段表头含「逻辑删」列" "(function(){return [...document.querySelectorAll('.st-head-center th')].some(s => s.textContent.trim() === '逻辑删')})()"
check "「添加逻辑删除字段」按钮存在" "!![...document.querySelectorAll('.audit-actions button')].find(b => b.textContent.includes('添加逻辑删除字段'))"
check "逻辑删除约定提示（del_flag）" "document.body.innerText.includes('逻辑删除：del_flag · TINYINT')"

# 点击「添加逻辑删除字段」→ 依约定建列（del_flag，非空，标记勾选）
agent-browser eval "[...document.querySelectorAll('.audit-actions button')].find(b => b.textContent.includes('添加逻辑删除字段'))?.click()" >/dev/null 2>&1
sleep 0.5
check "del_flag 字段行已添加" "(function(){return [...document.querySelectorAll('.st-body-left .column-row')].some(r => r.querySelector('.st-c-name input')?.value === 'del_flag')})()"

# 勾选序（非空=0 主键=1 逻辑删=2，均在中间表）：del_flag 行逻辑删应勾选
check "del_flag 行逻辑删已勾选" "(function(){var rows=[...document.querySelectorAll('.st-body-left .column-row')];var li=rows.findIndex(r => r.querySelector('.st-c-name input')?.value === 'del_flag');var c=document.querySelectorAll('.st-body-center .column-row')[li]?.querySelectorAll('.ant-checkbox-input');return !!c && c[2].checked})()"

# 互斥验证：给另一普通字段行勾选逻辑删 → del_flag 行勾选被自动转移
agent-browser eval "(function(){var rows=[...document.querySelectorAll('.st-body-left .column-row')];var li=rows.findIndex(r => {var v=r.querySelector('.st-c-name input')?.value;return v && v!=='del_flag' && !r.classList.contains('pk-row')});var c=document.querySelectorAll('.st-body-center .column-row')[li]?.querySelectorAll('.ant-checkbox-input');if(c&&c[2]){c[2].click();return true}return false})()" >/dev/null 2>&1
sleep 0.5
check "互斥：原 del_flag 行勾选被取消" "(function(){var rows=[...document.querySelectorAll('.st-body-left .column-row')];var li=rows.findIndex(r => r.querySelector('.st-c-name input')?.value === 'del_flag');var c=document.querySelectorAll('.st-body-center .column-row')[li]?.querySelectorAll('.ant-checkbox-input');return !!c && !c[2].checked})()"
check "互斥：转移 toast 提示出现" "(function(){return document.body.innerText.includes('每表最多一个')})()"
check "按钮切换为「删除逻辑字段」" "!![...document.querySelectorAll('.audit-actions button')].find(b => b.textContent.includes('删除逻辑字段'))"

# 保存表 → 持久化（勾选在新行上）；antdv 双字按钮自动插空格（「保 存」），匹配需剔除空白
agent-browser eval "[...document.querySelectorAll('.ant-modal-footer button')].find(b => b.textContent.replace(/\s/g, '') === '保存')?.click()" >/dev/null 2>&1
poll_expr "document.body.innerText.includes('已更新') || document.body.innerText.includes('已创建')" 8
check "表保存成功提示" "document.body.innerText.includes('已更新') || document.body.innerText.includes('已创建')"
# 确认对话框真实隐藏（保存生效的硬证据；antd 关闭后 DOM 保留，需按可见性判断），再重开验证持久化
poll_expr "(function(){var el=document.querySelector('.sync-table');return !el || el.getClientRects().length===0})()" 8
check "保存后对话框已隐藏" "(function(){var el=document.querySelector('.sync-table');return !el || el.getClientRects().length===0})()"
sleep 0.5

# 重开对话框 → 持久化勾选验证（可见性确认真实重开；勾选应在转移后的行而非 del_flag）
agent-browser eval "document.querySelector('.table-card').dispatchEvent(new MouseEvent('dblclick', {bubbles: true}))" >/dev/null 2>&1
poll_expr "!!(document.querySelector('.sync-table') && document.querySelector('.sync-table').getClientRects().length > 0)" 8
sleep 0.8
check "重开后逻辑删标记持久化（仅一个）" "(function(){var cs=[...document.querySelectorAll('.st-body-center .column-row')];var n=0;cs.forEach(r => {var c=r.querySelectorAll('.ant-checkbox-input');if(c.length>=3&&c[2].checked)n++});return n===1})()"
check "持久化勾选在转移后的行（非 del_flag）" "(function(){var rows=[...document.querySelectorAll('.st-body-left .column-row')];var li=-1;rows.forEach((r,i)=>{if(r.querySelector('.st-c-name input')?.value==='del_flag')li=i});var c=document.querySelectorAll('.st-body-center .column-row');var idx=[...c].findIndex(r => {var x=r.querySelectorAll('.ant-checkbox-input');return x.length>=3&&x[2].checked});return idx>=0 && idx!==li})()"

agent-browser screenshot "$SHOTS/task36-logic-delete.png" >/dev/null 2>&1
agent-browser eval "document.querySelector('.ant-modal .ant-modal-close')?.click()" >/dev/null 2>&1
sleep 0.5

# ---------- 4. 左右固定列（需求 1：多表同步滚动，窄视口横向滚动） ----------
echo "== 表编辑：左右固定列（多表同步滚动） =="
agent-browser set viewport 760 900 >/dev/null 2>&1
sleep 0.5
agent-browser eval "document.querySelector('.table-card').dispatchEvent(new MouseEvent('dblclick', {bubbles: true}))" >/dev/null 2>&1
poll_expr "!!(document.querySelector('.sync-table') && document.querySelector('.sync-table').getClientRects().length > 0)" 8
sleep 0.8

check "窄视口横向滚动条出现（专用滚动源）" "(function(){var b=document.querySelector('.st-scrollbar-h');return b && b.scrollWidth > b.clientWidth + 4})()"
agent-browser eval "window.__leftBefore = document.querySelector('.st-body-left').getBoundingClientRect().left; window.__rightBefore = document.querySelector('.st-body-right').getBoundingClientRect().right; 'ok'" >/dev/null 2>&1
agent-browser eval "document.querySelector('.st-scrollbar-h').scrollLeft = 999999" >/dev/null 2>&1
sleep 0.5
check "排序手柄列固定左缘（不随滚动平移）" "(function(){var root=document.querySelector('.sync-table');return Math.abs(document.querySelector('.st-body-left').getBoundingClientRect().left - root.getBoundingClientRect().left) < 2 && Math.abs(document.querySelector('.st-body-left').getBoundingClientRect().left - window.__leftBefore) < 1})()"
check "字段名输入框仍可见于左壳" "(function(){var root=document.querySelector('.sync-table');var r=document.querySelector('.st-body-left .st-c-name input').getBoundingClientRect();var rt=root.getBoundingClientRect();return r.left >= rt.left && r.right <= document.querySelector('.st-body-left').getBoundingClientRect().right})()"
check "删除按钮列固定右缘（不随滚动平移）" "(function(){var root=document.querySelector('.sync-table');var rr=document.querySelector('.st-body-right').getBoundingClientRect().right;return rr <= root.getBoundingClientRect().right + 2 && Math.abs(rr - window.__rightBefore) < 1})()"
check "中间列随滚动平移（滚出可视区）" "(function(){var left=document.querySelector('.st-body-left');return document.querySelector('.st-body-center .st-c-propertyName').getBoundingClientRect().left < left.getBoundingClientRect().right - 4})()"
check "表头与表体中间列同步滚动" "(function(){var b=document.querySelector('.st-scrollbar-h');var h=document.querySelector('.st-head-center');var c=document.querySelector('.st-body-center');return b.scrollLeft > 10 && h.scrollLeft === b.scrollLeft && c.scrollLeft === b.scrollLeft})()"
check "左右壳不产生横向滚动（固定列恒在位）" "(function(){return document.querySelector('.st-body-left').scrollLeft === 0 && document.querySelector('.st-body-right').scrollLeft === 0})()"

agent-browser screenshot "$SHOTS/task36-sticky-columns.png" >/dev/null 2>&1
agent-browser set viewport 1440 900 >/dev/null 2>&1

# ---------- 5. 汇总 ----------
echo ""
echo "== 汇总: PASS=$PASS FAIL=$FAIL =="
if [ ${#FAILED_NAMES[@]} -gt 0 ]; then
  printf '  失败项: %s\n' "${FAILED_NAMES[*]}"
  exit 1
fi
