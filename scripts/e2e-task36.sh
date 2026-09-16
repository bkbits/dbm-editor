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
  [ -n "${DEV_PID:-}" ] && kill "$DEV_PID" 2>/dev/null
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

export AGENT_BROWSER_SESSION="task36-e2e"
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
poll_expr "!!document.querySelector('.columns-head')" 8
sleep 0.5

check "字段表头含「逻辑删」列" "(function(){return [...document.querySelectorAll('.columns-head > span')].some(s => s.textContent.trim() === '逻辑删')})()"
check "「添加逻辑删除字段」按钮存在" "!![...document.querySelectorAll('.audit-actions button')].find(b => b.textContent.includes('添加逻辑删除字段'))"
check "逻辑删除约定提示（del_flag）" "document.body.innerText.includes('逻辑删除：del_flag · TINYINT')"

# 点击「添加逻辑删除字段」→ 依约定建列（del_flag，非空，标记勾选）
agent-browser eval "[...document.querySelectorAll('.audit-actions button')].find(b => b.textContent.includes('添加逻辑删除字段'))?.click()" >/dev/null 2>&1
sleep 0.5
check "del_flag 字段行已添加" "(function(){return [...document.querySelectorAll('.column-row')].some(r => r.querySelector('input')?.value === 'del_flag')})()"

# 勾选序（非空=0 主键=1 逻辑删=2）：del_flag 行逻辑删应勾选
check "del_flag 行逻辑删已勾选" "(function(){var r=[...document.querySelectorAll('.column-row')].find(r => r.querySelector('input')?.value === 'del_flag');var c=r?.querySelectorAll('.ant-checkbox-input');return !!c && c[2].checked})()"

# 互斥验证：给另一普通字段行勾选逻辑删 → del_flag 行勾选被自动转移
agent-browser eval "(function(){var rows=[...document.querySelectorAll('.column-row')];var r=rows.find(r => {var v=r.querySelector('input')?.value;return v && v!=='del_flag' && r.querySelectorAll('.ant-checkbox-input').length>=3 && !r.classList.contains('pk-row')});var c=r?.querySelectorAll('.ant-checkbox-input');if(c&&c[2]){c[2].click();return true}return false})()" >/dev/null 2>&1
sleep 0.5
check "互斥：原 del_flag 行勾选被取消" "(function(){var r=[...document.querySelectorAll('.column-row')].find(r => r.querySelector('input')?.value === 'del_flag');var c=r?.querySelectorAll('.ant-checkbox-input');return !!c && !c[2].checked})()"
check "互斥：转移 toast 提示出现" "(function(){return document.body.innerText.includes('每表最多一个')})()"
check "按钮切换为「取消逻辑删除标记」" "!![...document.querySelectorAll('.audit-actions button')].find(b => b.textContent.includes('取消逻辑删除标记'))"

# 保存表 → 持久化（勾选在新行上）；antdv 双字按钮自动插空格（「保 存」），匹配需剔除空白
agent-browser eval "[...document.querySelectorAll('.ant-modal-footer button')].find(b => b.textContent.replace(/\s/g, '') === '保存')?.click()" >/dev/null 2>&1
poll_expr "document.body.innerText.includes('已更新') || document.body.innerText.includes('已创建')" 8
check "表保存成功提示" "document.body.innerText.includes('已更新') || document.body.innerText.includes('已创建')"
# 确认对话框真实隐藏（保存生效的硬证据；antd 关闭后 DOM 保留，需按可见性判断），再重开验证持久化
poll_expr "(function(){var el=document.querySelector('.columns-head');return !el || el.getClientRects().length===0})()" 8
check "保存后对话框已隐藏" "(function(){var el=document.querySelector('.columns-head');return !el || el.getClientRects().length===0})()"
sleep 0.5

# 重开对话框 → 持久化勾选验证（可见性确认真实重开；勾选应在转移后的行而非 del_flag）
agent-browser eval "document.querySelector('.table-card').dispatchEvent(new MouseEvent('dblclick', {bubbles: true}))" >/dev/null 2>&1
poll_expr "!!(document.querySelector('.columns-head') && document.querySelector('.columns-head').getClientRects().length > 0)" 8
sleep 0.8
check "重开后逻辑删标记持久化（仅一个）" "(function(){var rows=[...document.querySelectorAll('.column-row')];var n=0;rows.forEach(r => {var c=r.querySelectorAll('.ant-checkbox-input');if(c.length>=3&&c[2].checked)n++});return n===1})()"
check "持久化勾选在转移后的行（非 del_flag）" "(function(){var rows=[...document.querySelectorAll('.column-row')];var r=rows.find(r => {var c=r.querySelectorAll('.ant-checkbox-input');return c.length>=3&&c[2].checked});return !!r && r.querySelector('input')?.value !== 'del_flag'})()"

agent-browser screenshot "$SHOTS/task36-logic-delete.png" >/dev/null 2>&1
agent-browser eval "document.querySelector('.ant-modal .ant-modal-close')?.click()" >/dev/null 2>&1
sleep 0.5

# ---------- 4. 左右固定列（需求 1：窄视口横向滚动吸附） ----------
echo "== 表编辑：左右固定列 =="
agent-browser set viewport 760 900 >/dev/null 2>&1
sleep 0.5
agent-browser eval "document.querySelector('.table-card').dispatchEvent(new MouseEvent('dblclick', {bubbles: true}))" >/dev/null 2>&1
poll_expr "!!(document.querySelector('.columns-head') && document.querySelector('.columns-head').getClientRects().length > 0)" 8
sleep 0.5

check "窄视口横向滚动出现" "(function(){var g=document.querySelector('.grid-scroll');return g && g.scrollWidth > g.clientWidth + 4})()"
agent-browser eval "document.querySelector('.grid-scroll').scrollLeft = 999999" >/dev/null 2>&1
sleep 0.5
check "排序手柄列吸附左缘" "(function(){var g=document.querySelector('.grid-scroll');var row=document.querySelector('.column-row');var c=row.children[0];return Math.abs(c.getBoundingClientRect().left - g.getBoundingClientRect().left) < 2})()"
check "字段名列吸附左缘（偏移 34px）" "(function(){var g=document.querySelector('.grid-scroll');var row=document.querySelector('.column-row');var c=row.children[1];return Math.abs(c.getBoundingClientRect().left - g.getBoundingClientRect().left - 34) < 2})()"
check "删除按钮吸附右缘（含滚动条带宽）" "(function(){var g=document.querySelector('.grid-scroll');var row=document.querySelector('.column-row');var c=row.children[row.children.length-1];var r=c.getBoundingClientRect().right,gr=g.getBoundingClientRect().right;return r<=gr+2 && r>=gr-20})()"
check "中间列滚出可视区（滚动生效）" "(function(){var g=document.querySelector('.grid-scroll');var row=document.querySelector('.column-row');var c=row.children[4];return c.getBoundingClientRect().left < g.getBoundingClientRect().left - 4})()"
check "表头字段名同步吸附" "(function(){var g=document.querySelector('.grid-scroll');var h=document.querySelector('.columns-head');var c=h.children[1];return Math.abs(c.getBoundingClientRect().left - g.getBoundingClientRect().left - 34) < 2})()"

agent-browser screenshot "$SHOTS/task36-sticky-columns.png" >/dev/null 2>&1
agent-browser set viewport 1440 900 >/dev/null 2>&1

# ---------- 5. 汇总 ----------
echo ""
echo "== 汇总: PASS=$PASS FAIL=$FAIL =="
if [ ${#FAILED_NAMES[@]} -gt 0 ]; then
  printf '  失败项: %s\n' "${FAILED_NAMES[*]}"
  exit 1
fi
