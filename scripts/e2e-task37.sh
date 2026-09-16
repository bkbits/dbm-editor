#!/usr/bin/env bash
# Task 37 E2E：字段表多 table 同步滚动架构（SyncTable）验证
# - 结构：表头三壳 + 表体三壳六张表 + 两条专用滚动条（sizer 撑尺寸）
# - 列宽分配：显式列精确宽 / 弹性列 ≥ minWidth / 总和 = sizer 宽
# - 约束：三表体行高一致、表头与表体同列等宽
# - 滚动同步：横向条驱动表头/表体中间壳，纵向条驱动表体三壳；左右壳恒不滚
# - 遮挡证明：elementFromPoint 采样（左/右壳控件位置命中自身，非中间列内容）
# - 「删除逻辑字段」= 整列移除（行为链）
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
./node_modules/.bin/vp dev > /tmp/task37-dev.log 2>&1 &
DEV_PID=$!

PORT=""
for i in $(seq 1 40); do
  PORT=$(grep -oE 'localhost:[0-9]+' /tmp/task37-dev.log | head -1 | cut -d: -f2)
  if [ -n "$PORT" ] && curl -s "http://localhost:$PORT" >/dev/null 2>&1; then break; fi
  sleep 1
done
if [ -z "$PORT" ]; then echo "FATAL: dev server 未就绪"; tail -20 /tmp/task37-dev.log; exit 1; fi
echo "== dev server: http://localhost:$PORT =="

export AGENT_BROWSER_SESSION="task37-e2e-$$"
agent-browser set viewport 760 900 >/dev/null 2>&1
agent-browser open "http://localhost:$PORT" >/dev/null 2>&1
agent-browser wait --load networkidle >/dev/null 2>&1 || true

# ---------- 2. 窄视口打开表编辑（横向滚动场景） ----------
echo "== 表编辑：多表同步滚动结构 =="
header_nav 模型编辑器
poll_expr "!!document.querySelector('.table-card')" 5

agent-browser eval "document.querySelector('.table-card').dispatchEvent(new MouseEvent('dblclick', {bubbles: true}))" >/dev/null 2>&1
poll_expr "!!(document.querySelector('.sync-table') && document.querySelector('.sync-table').getClientRects().length > 0)" 8
sleep 0.8

# ---------- 3. 结构断言（六张表 + 两条专用滚动条） ----------
check "表头三壳各含一张表" "(function(){var l=document.querySelector('.st-head-left table'),c=document.querySelector('.st-head-center table'),r=document.querySelector('.st-head-right table');return !!(l&&c&&r)})()"
check "表体三壳各含一张表" "(function(){var l=document.querySelector('.st-body-left table'),c=document.querySelector('.st-body-center table'),r=document.querySelector('.st-body-right table');return !!(l&&c&&r)})()"
check "左壳表仅两列（排序+字段名）" "document.querySelectorAll('.st-body-left col').length === 2"
check "右壳表仅一列（删除）" "document.querySelectorAll('.st-body-right col').length === 1"
check "横向滚动条为唯一横向滚动源（sizer 撑宽）" "(function(){var b=document.querySelector('.st-scrollbar-h'),s=document.querySelector('.st-sizer-h');return !!(b&&s) && s.getBoundingClientRect().width > b.clientWidth})()"
check "窄视口横向溢出成立" "(function(){var b=document.querySelector('.st-scrollbar-h');return b.scrollWidth > b.clientWidth + 4})()"

# ---------- 4. 列宽分配（显式列精确 / 弹性列下限 / 总和 = sizer 宽） ----------
echo "== 表编辑：列宽分配 =="
check "显式宽度列精确（数据库类型 136px）" "(function(){var cols=[...document.querySelectorAll('.st-body-center col')];var i=1;return Math.abs(parseFloat(cols[i].style.width) - 136) < 0.6})()"
check "弹性列不低于 minWidth（字段名 ≥100 / 属性名 ≥88 / 注释 ≥76）" "(function(){var w=function(sel){return document.querySelector(sel).getBoundingClientRect().width};return w('.st-body-left td.st-c-name')>=100-0.6 && w('.st-body-center td.st-c-propertyName')>=88-0.6 && w('.st-body-center td.st-c-comment')>=76-0.6})()"
check "三区列宽总和 = 横向 sizer 宽（分配总和精确）" "(function(){var sum=function(sel){return [...document.querySelectorAll(sel)].reduce(function(s,c){return s+parseFloat(c.style.width)},0)};var t=sum('.st-body-left col')+sum('.st-body-center col')+sum('.st-body-right col');var sw=document.querySelector('.st-sizer-h').getBoundingClientRect().width;return Math.abs(t-sw)<=1})()"

# ---------- 5. 对齐约束（行高一致 / 表头表体同列等宽） ----------
echo "== 表编辑：对齐约束 =="
check "三表体行高一致（每行 32px）" "(function(){var hs=[...document.querySelectorAll('.st-body tr')].map(function(r){return r.getBoundingClientRect().height});return hs.length>0 && hs.every(function(h){return Math.abs(h-32)<=1})})()"
check "表头与表体同列等宽（中间列逐列比对）" "(function(){var hc=[...document.querySelectorAll('.st-head-center th')],bc=[...document.querySelectorAll('.st-body-center tr:first-child td')];if(hc.length!==bc.length||!hc.length)return false;for(var i=0;i<hc.length;i++){if(Math.abs(hc[i].getBoundingClientRect().width-bc[i].getBoundingClientRect().width)>1)return false}return true})()"
check "左壳与右壳首行横向对齐表体（y 一致）" "(function(){var l=document.querySelector('.st-body-left tr').getBoundingClientRect(),c=document.querySelector('.st-body-center tr').getBoundingClientRect(),r=document.querySelector('.st-body-right tr').getBoundingClientRect();return Math.abs(l.top-c.top)<=1 && Math.abs(c.top-r.top)<=1})()"

# ---------- 6. 横向滚动同步 ----------
echo "== 表编辑：横向滚动同步 =="
agent-browser eval "window.__leftBefore=document.querySelector('.st-body-left').getBoundingClientRect().left;window.__rightBefore=document.querySelector('.st-body-right').getBoundingClientRect().right;'ok'" >/dev/null 2>&1
agent-browser eval "document.querySelector('.st-scrollbar-h').scrollLeft = Math.floor(document.querySelector('.st-scrollbar-h').scrollWidth / 3)" >/dev/null 2>&1
sleep 0.5
agent-browser screenshot "$SHOTS/task37-sync-mid.png" >/dev/null 2>&1
check "表头中间壳同步横向滚动" "(function(){var b=document.querySelector('.st-scrollbar-h');return b.scrollLeft>10 && document.querySelector('.st-head-center').scrollLeft===b.scrollLeft})()"
check "表体中间壳同步横向滚动" "(function(){var b=document.querySelector('.st-scrollbar-h');return document.querySelector('.st-body-center').scrollLeft===b.scrollLeft})()"
check "左/右壳不随横向滚动平移（几何恒定）" "(function(){return Math.abs(document.querySelector('.st-body-left').getBoundingClientRect().left-window.__leftBefore)<1 && Math.abs(document.querySelector('.st-body-right').getBoundingClientRect().right-window.__rightBefore)<1})()"

# elementFromPoint 采样：滚动中途在左壳字段名输入框 / 右壳删除按钮位置采样，
# 命中元素应属于对应壳内的控件（证明固定列不被中间列内容遮挡、也不遮挡交互）
check "采样：字段名输入框位置命中左壳输入框" "(function(){var el=document.querySelector('.st-body-left .st-c-name input');var r=el.getBoundingClientRect();var hit=document.elementFromPoint(r.left+r.width/2, r.top+r.height/2);return !!hit && !!hit.closest('.st-body-left')})()"
check "采样：删除按钮位置命中右壳按钮" "(function(){var el=document.querySelector('.st-body-right .st-c-del button, .st-body-right .row-del-placeholder');var r=el.getBoundingClientRect();var hit=document.elementFromPoint(r.left+r.width/2, r.top+r.height/2);return !!hit && !!hit.closest('.st-body-right')})()"

agent-browser eval "document.querySelector('.st-scrollbar-h').scrollLeft = 999999" >/dev/null 2>&1
sleep 0.5
check "滚动到最右：越界 scrollLeft 被钳制" "(function(){var b=document.querySelector('.st-scrollbar-h');return b.scrollLeft <= b.scrollWidth - b.clientWidth + 1})()"
check "滚动到最右：中间首列完全滚出" "(function(){var left=document.querySelector('.st-body-left');return document.querySelector('.st-body-center .st-c-propertyName').getBoundingClientRect().left < left.getBoundingClientRect().right - 4})()"
agent-browser screenshot "$SHOTS/task37-sync-fixed.png" >/dev/null 2>&1

# ---------- 7. 滚轮转发（壳内容滚轮驱动专用滚动条） ----------
echo "== 表编辑：滚轮转发 =="
agent-browser eval "window.__sl=document.querySelector('.st-scrollbar-h').scrollLeft;'ok'" >/dev/null 2>&1
agent-browser eval "document.querySelector('.st-body-center').dispatchEvent(new WheelEvent('wheel', {deltaX: -120, bubbles: true, cancelable: true}))" >/dev/null 2>&1
sleep 0.3
check "壳上滚轮驱动横向滚动条回滚" "document.querySelector('.st-scrollbar-h').scrollLeft < window.__sl"

# ---------- 8. 纵向滚动同步（添加字段至溢出 → 纵向条驱动表体三壳） ----------
echo "== 表编辑：纵向滚动同步 =="
agent-browser eval "for(var i=0;i<8;i++){[...document.querySelectorAll('.add-btn')].find(b=>b.textContent.includes('添加字段'))?.click()}" >/dev/null 2>&1
sleep 0.8
check "行数增加后纵向滚动条出现" "(function(){var b=document.querySelector('.st-scrollbar-v');var t=document.querySelector('.sync-table');return t.classList.contains('st-has-vbar') && !!b && b.scrollHeight > b.clientHeight})()"
agent-browser eval "document.querySelector('.st-scrollbar-v').scrollTop = 60" >/dev/null 2>&1
sleep 0.4
check "纵向滚动：表体三壳 scrollTop 同步" "(function(){var b=document.querySelector('.st-scrollbar-v');var l=document.querySelector('.st-body-left'),c=document.querySelector('.st-body-center'),r=document.querySelector('.st-body-right');return b.scrollTop===60 && l.scrollTop===60 && c.scrollTop===60 && r.scrollTop===60})()"
check "纵向滚动：表头恒不纵滚" "(function(){return document.querySelector('.st-head-center').scrollTop===0 && document.querySelector('.st-header').getBoundingClientRect().height < 40})()"
agent-browser screenshot "$SHOTS/task37-sync-vscroll.png" >/dev/null 2>&1

# ---------- 9. 删除逻辑字段 = 整列移除（非仅清标记） ----------
echo "== 表编辑：删除逻辑字段 =="
agent-browser eval "window.__rows = document.querySelectorAll('.st-body-left .column-row').length" >/dev/null 2>&1
agent-browser eval "[...document.querySelectorAll('.audit-actions button')].find(b => b.textContent.includes('添加逻辑删除字段'))?.click()" >/dev/null 2>&1
sleep 0.5
check "添加后行数 +1" "document.querySelectorAll('.st-body-left .column-row').length === window.__rows + 1"
check "deleted 字段行已添加" "(function(){return [...document.querySelectorAll('.st-body-left .column-row')].some(r => r.querySelector('.st-c-name input')?.value === 'deleted')})()"
check "deleted 行逻辑删勾选" "(function(){var rows=[...document.querySelectorAll('.st-body-left .column-row')];var li=rows.findIndex(r => r.querySelector('.st-c-name input')?.value === 'deleted');var c=document.querySelectorAll('.st-body-center .column-row')[li]?.querySelectorAll('.ant-checkbox-input');return !!c && c[2].checked})()"
check "按钮切换为「删除逻辑字段」" "!![...document.querySelectorAll('.audit-actions button')].find(b => b.textContent.includes('删除逻辑字段'))"

agent-browser eval "[...document.querySelectorAll('.audit-actions button')].find(b => b.textContent.includes('删除逻辑字段'))?.click()" >/dev/null 2>&1
sleep 0.5
check "删除后行数复原（整列移除）" "document.querySelectorAll('.st-body-left .column-row').length === window.__rows"
check "deleted 字段行已消失" "(function(){return ![...document.querySelectorAll('.st-body-left .column-row')].some(r => r.querySelector('.st-c-name input')?.value === 'deleted')})()"
check "删除 toast 出现（已删除逻辑删除字段）" "document.body.innerText.includes('已删除逻辑删除字段')"
check "按钮切回「添加逻辑删除字段」" "!![...document.querySelectorAll('.audit-actions button')].find(b => b.textContent.includes('添加逻辑删除字段'))"

# ---------- 10. 汇总 ----------
echo ""
echo "== 汇总: PASS=$PASS FAIL=$FAIL =="
if [ ${#FAILED_NAMES[@]} -gt 0 ]; then
  printf '  失败项: %s\n' "${FAILED_NAMES[*]}"
  exit 1
fi
