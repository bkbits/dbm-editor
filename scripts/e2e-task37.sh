#!/usr/bin/env bash
# Task 37 E2E：表编辑固定列透出修复（.cell-pin 包裹层纵向铺满行高）+「删除逻辑字段」整列移除
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
echo "== 表编辑：固定列包裹层几何 =="
header_nav 模型编辑器
poll_expr "!!document.querySelector('.table-card')" 5

agent-browser eval "document.querySelector('.table-card').dispatchEvent(new MouseEvent('dblclick', {bubbles: true}))" >/dev/null 2>&1
poll_expr "!!(document.querySelector('.columns-head') && document.querySelector('.columns-head').getClientRects().length > 0)" 8
sleep 0.8

# ---------- 3. 包裹层几何断言（透出根因修复的直接证据） ----------
# 修复前：sticky 格子按内容高度居中（删除按钮 22px），行高由最高格子（复选框列）决定，
# 格子上下留空 → 滚动内容从排序/字段名缝隙与删除按钮底部透出。
# 修复后：.cell-pin align-self:stretch 纵向铺满行轨，高度 ≥ 行内任何中间列格子。
check "每行固定列包裹层为 3 个" "(function(){var rows=[...document.querySelectorAll('.columns-body .column-row')];return rows.length>0 && rows.every(function(r){var pins=[...r.children].filter(function(c){return c.classList.contains('cell-pin')});return pins.length===3})})()"
check "删除列包裹层纵向铺满（≥ 行内最高格）" "(function(){var rows=[...document.querySelectorAll('.columns-body .column-row')];for(var i=0;i<rows.length;i++){var r=rows[i];var pin=r.querySelector('.cell-pin-del');var pinH=pin.getBoundingClientRect().height;var maxH=0;[...r.children].forEach(function(c){if(!c.classList.contains('cell-pin')){maxH=Math.max(maxH,c.getBoundingClientRect().height)}});if(pinH<maxH-0.5)return 'row'+i+' pin'+pinH+' lt max'+maxH}return 'true'})()"
check "排序/字段名列包裹层纵向铺满" "(function(){var rows=[...document.querySelectorAll('.columns-body .column-row')];for(var i=0;i<rows.length;i++){var r=rows[i];var a=r.querySelector('.cell-pin-sort');var b=r.querySelector('.cell-pin-name');var maxH=0;[...r.children].forEach(function(c){if(!c.classList.contains('cell-pin')){maxH=Math.max(maxH,c.getBoundingClientRect().height)}});if(a.getBoundingClientRect().height<maxH-0.5||b.getBoundingClientRect().height<maxH-0.5)return 'row'+i}return 'true'})()"
check "包裹层高度贴合行高（无上下空隙）" "(function(){var rows=[...document.querySelectorAll('.columns-body .column-row')];for(var i=0;i<rows.length;i++){var r=rows[i];var rowH=r.getBoundingClientRect().height;var pins=[...r.children].filter(function(c){return c.classList.contains('cell-pin')});var pinH=pins[0].getBoundingClientRect().height;if(rowH-pinH>6)return 'row'+i+' gap'+(rowH-pinH)}return 'true'})()"
check "遮缝伪元素随包裹层铺满行高" "(function(){var r=document.querySelector('.columns-body .column-row:not(.pk-row)')||document.querySelector('.column-row');var p=r.querySelector('.cell-pin-name');var h=p.getBoundingClientRect().height;var bh=parseFloat(getComputedStyle(p,'::before').height);return !isNaN(bh) && Math.abs(bh-h)<=2})()"

# ---------- 4. 横向滚动吸附不回归（包裹层承接原 sticky 几何） ----------
echo "== 表编辑：横向滚动吸附 =="
check "窄视口横向滚动出现" "(function(){var g=document.querySelector('.grid-scroll');return g && g.scrollWidth > g.clientWidth + 4})()"
agent-browser eval "document.querySelector('.grid-scroll').scrollLeft = Math.floor(document.querySelector('.grid-scroll').scrollWidth / 3)" >/dev/null 2>&1
sleep 0.5
agent-browser screenshot "$SHOTS/task37-sticky-mid.png" >/dev/null 2>&1
agent-browser eval "document.querySelector('.grid-scroll').scrollLeft = 999999" >/dev/null 2>&1
sleep 0.5
check "排序手柄列吸附左缘" "(function(){var g=document.querySelector('.grid-scroll');var row=document.querySelector('.column-row');var c=row.children[0];return Math.abs(c.getBoundingClientRect().left - g.getBoundingClientRect().left) < 2})()"
check "字段名列吸附左缘（偏移 34px）" "(function(){var g=document.querySelector('.grid-scroll');var row=document.querySelector('.column-row');var c=row.children[1];return Math.abs(c.getBoundingClientRect().left - g.getBoundingClientRect().left - 34) < 2})()"
check "删除按钮吸附右缘（含滚动条带宽）" "(function(){var g=document.querySelector('.grid-scroll');var row=document.querySelector('.column-row');var c=row.children[row.children.length-1];var r=c.getBoundingClientRect().right,gr=g.getBoundingClientRect().right;return r<=gr+2 && r>=gr-20})()"
check "中间列滚出可视区（滚动生效）" "(function(){var g=document.querySelector('.grid-scroll');var row=document.querySelector('.column-row');var c=row.children[4];return c.getBoundingClientRect().left < g.getBoundingClientRect().left - 4})()"
check "表头字段名同步吸附" "(function(){var g=document.querySelector('.grid-scroll');var h=document.querySelector('.columns-head');var c=h.children[1];return Math.abs(c.getBoundingClientRect().left - g.getBoundingClientRect().left - 34) < 2})()"
agent-browser screenshot "$SHOTS/task37-sticky-fixed.png" >/dev/null 2>&1

# ---------- 5. 固定列不透明性 + 表头遮缝（半透明底色/空末格透出修复） ----------
echo "== 表编辑：固定列不透明性 =="
check "pk 行删除位包裹层背景不透明（无 alpha 透底）" "(function(){var r=document.querySelector('.column-row.pk-row');var pin=r?.querySelector('.cell-pin-del');if(!pin)return false;var c=getComputedStyle(pin).backgroundColor;if(c.indexOf('rgba')===-1)return true;var a=parseFloat(c.slice(c.lastIndexOf(',')+1).replace(')','').trim());return a===1})()"
check "pk 行包裹层带悬停色叠层（视觉与行底色一致）" "(function(){var r=document.querySelector('.column-row.pk-row');var pin=r?.querySelector('.cell-pin-del');return !!pin && getComputedStyle(pin).backgroundImage.indexOf('linear-gradient')>-1})()"
check "普通行包裹层背景不透明且无叠层" "(function(){var r=[...document.querySelectorAll('.column-row')].find(function(x){return !x.classList.contains('pk-row')});var pin=r?.querySelector('.cell-pin-del');if(!pin)return false;var c=getComputedStyle(pin).backgroundColor;if(c.indexOf('rgba')>-1)return false;return getComputedStyle(pin).backgroundImage==='none'})()"
check "pk 行遮缝伪元素继承不透明合成背景" "(function(){var r=document.querySelector('.column-row.pk-row');var pin=r?.querySelector('.cell-pin-name');var s=getComputedStyle(pin,'::before');if(s.content==='none')return false;var c=s.backgroundColor;if(c.indexOf('rgba')>-1)return false;return s.backgroundImage.indexOf('linear-gradient')>-1})()"
check "表头末格纵向拉伸（空 span 高度非 0）" "(function(){var h=document.querySelector('.columns-head');var c=h.children[h.children.length-1];return c.getBoundingClientRect().height > 10})()"
check "表头字段名左侧遮缝伪元素存在" "(function(){var h=document.querySelector('.columns-head');var s=getComputedStyle(h.children[1],'::before');return s.content !== 'none' && s.width === '7px'})()"
check "表头末格左侧遮缝伪元素存在" "(function(){var h=document.querySelector('.columns-head');var c=h.children[h.children.length-1];var s=getComputedStyle(c,'::before');return s.content !== 'none' && s.width === '7px'})()"

# 裁剪坐标（供事后 PIL 裁切 + VLM 视觉复核）
agent-browser eval "JSON.stringify({grid:(function(){var r=document.querySelector('.grid-scroll').getBoundingClientRect();return {l:Math.round(r.left),t:Math.round(r.top),w:Math.round(r.width),h:Math.round(r.height)}})(),pk:(function(){var r=document.querySelector('.column-row.pk-row').getBoundingClientRect();return {t:Math.round(r.top),b:Math.round(r.bottom)}})()})" 2>/dev/null

# ---------- 6. 删除逻辑字段 = 整列移除（非仅清标记） ----------
echo "== 表编辑：删除逻辑字段 =="
agent-browser eval "window.__rows = document.querySelectorAll('.columns-body .column-row').length" >/dev/null 2>&1
agent-browser eval "[...document.querySelectorAll('.audit-actions button')].find(b => b.textContent.includes('添加逻辑删除字段'))?.click()" >/dev/null 2>&1
sleep 0.5
check "添加后行数 +1" "document.querySelectorAll('.columns-body .column-row').length === window.__rows + 1"
check "deleted 字段行已添加" "(function(){return [...document.querySelectorAll('.column-row')].some(r => r.querySelector('.cell-pin-name input')?.value === 'deleted')})()"
check "deleted 行逻辑删勾选" "(function(){var r=[...document.querySelectorAll('.column-row')].find(r => r.querySelector('.cell-pin-name input')?.value === 'deleted');var c=r?.querySelectorAll('.ant-checkbox-input');return !!c && c[2].checked})()"
check "按钮切换为「删除逻辑字段」" "!![...document.querySelectorAll('.audit-actions button')].find(b => b.textContent.includes('删除逻辑字段'))"

agent-browser eval "[...document.querySelectorAll('.audit-actions button')].find(b => b.textContent.includes('删除逻辑字段'))?.click()" >/dev/null 2>&1
sleep 0.5
check "删除后行数复原（整列移除）" "document.querySelectorAll('.columns-body .column-row').length === window.__rows"
check "deleted 字段行已消失" "(function(){return ![...document.querySelectorAll('.column-row')].some(r => r.querySelector('.cell-pin-name input')?.value === 'deleted')})()"
check "删除 toast 出现（已删除逻辑删除字段）" "document.body.innerText.includes('已删除逻辑删除字段')"
check "按钮切回「添加逻辑删除字段」" "!![...document.querySelectorAll('.audit-actions button')].find(b => b.textContent.includes('添加逻辑删除字段'))"

# ---------- 7. 汇总 ----------
echo ""
echo "== 汇总: PASS=$PASS FAIL=$FAIL =="
if [ ${#FAILED_NAMES[@]} -gt 0 ]; then
  printf '  失败项: %s\n' "${FAILED_NAMES[*]}"
  exit 1
fi
