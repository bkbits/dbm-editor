#!/usr/bin/env bash
# Task 43-47 回归测试 A：画布 / 模型 / 页面 / 主题 / nanoid / AI 默认规则（45 项断言）
#
# 覆盖改动面：
# - Task 43 格式化基线切换（无行为）+ AI 全局规则默认文本增强
# - Task 44 uid 生成器改 nanoid（新表 / 新字段 id 格式校验）
# - Task 45/46 AI、画布、模型三仓库拆分后的功能等价性（CRUD / 拖拽 / 撤销 / 剪贴板 /
#   隐藏 / 自动美化 / 对话框 / 五页渲染 / 双主题）
#
# 前置：agent-browser 可用；dev server 若未运行则本脚本自行启动（可用 PORT 覆盖端口）。
# 判读要点（历史排障沉淀）：
# - antdv 弹层关闭后 DOM 保留 → 所有 modal 判定用「可见性」而非存在性
# - autoLayout() 末尾自带 fitAll()（视口变化不进历史）→ 位置断言比较 localStorage world 坐标
# - 「Ctrl+Z 撤销隐藏表」非历史行为（setTableHidden 只做乐观更新 + 失败回滚），属既有设计
set -u

ROOT="$(cd "$(dirname "$0")/.." && { pwd -W 2>/dev/null || pwd; })"
PORT="${PORT:-3000}"
BASE_URL="http://localhost:$PORT"
SHOTS="$ROOT/docs/screenshots"
PASS=0; FAIL=0; FAILED=()

cd "$ROOT" || exit 1
mkdir -p "$SHOTS" "$ROOT/tmp"

# ---------- dev server：复用已有实例，否则自起 ----------
DEV_PID=""
if ! curl -s -o /dev/null -m 3 "$BASE_URL/"; then
  echo "== 未检测到 $BASE_URL，自行启动 dev server =="
  ./node_modules/.bin/vp dev > "$ROOT/tmp/regress-a-dev.log" 2>&1 &
  DEV_PID=$!
  for _ in $(seq 1 40); do
    curl -s -o /dev/null -m 2 "$BASE_URL/" && break
    sleep 1
  done
fi
if ! curl -s -o /dev/null -m 3 "$BASE_URL/"; then
  echo "FATAL: dev server 未就绪（$BASE_URL）"
  [ -n "$DEV_PID" ] && tail -20 "$ROOT/tmp/regress-a-dev.log"
  exit 1
fi

cleanup() { [ -n "$DEV_PID" ] && kill "$DEV_PID" 2>/dev/null; }
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

# 相对数比较断言：expr 求值为数字，与期望值比较
check_num() {
  local name="$1" expr="$2" want="$3" out
  out=$(agent-browser eval "$expr" 2>/dev/null | tr -d '"')
  if [ "$out" = "$want" ]; then
    PASS=$((PASS+1)); echo "  PASS  $name"
  else
    FAIL=$((FAIL+1)); FAILED+=("$name"); echo "  FAIL  $name  =>  $out (期望 $want)"
  fi
}

ev() { agent-browser eval "$1" 2>/dev/null | tr -d '"'; }

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

fit_all() {
  agent-browser eval "(function(){var b=[...document.querySelectorAll('.canvas-toolbar button')].find(function(x){return x.querySelector('svg.lucide-maximize-2')});if(b){b.click();return 'ok'}return 'nf'})()" >/dev/null 2>&1
  sleep 1
}

# 点击弹层/菜单中文本按钮（antdv 中文双字按钮渲染插入空格 → 去空白匹配；只在可见弹层内查找）
click_modal_text() {
  agent-browser eval "(function(){var ws=[...document.querySelectorAll('.ant-modal-wrap, .ant-modal-confirm')].filter(function(w){return getComputedStyle(w).display!=='none'});for(var i=0;i<ws.length;i++){var b=[...ws[i].querySelectorAll('button')].find(function(x){return x.textContent.replace(/\\s+/g,'')==='$1'});if(b){b.click();return 'ok'}}var c=document.querySelector('.ctx-menu');if(c){var cb=[...c.querySelectorAll('button')].find(function(x){return x.textContent.replace(/\\s+/g,'')==='$1'});if(cb){cb.click();return 'ctx-ok'}}return 'nf'})()" >/dev/null 2>&1
}

reset_demo() {
  agent-browser eval "document.querySelectorAll('.outline-actions button')[1]?.click()" >/dev/null 2>&1
  sleep 1
  click_modal_text "重置"
  poll "document.querySelectorAll('.table-card').length === 10" 15
  sleep 0.5
}

open_canvas_menu() {
  agent-browser press Escape >/dev/null 2>&1
  sleep 0.3
  agent-browser mouse move 700 450 >/dev/null 2>&1
  agent-browser mouse down right >/dev/null 2>&1
  agent-browser mouse up right >/dev/null 2>&1
  sleep 0.8
}

dbl_card() {
  agent-browser eval "(function(){var c=document.querySelector('.table-card');if(!c)return 'nf';c.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));return 'ok'})()" >/dev/null 2>&1
  sleep 1
}

dbl_edge() {
  agent-browser eval "(function(){var e=document.querySelector('.edge-hit');if(!e)return 'nf';e.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));return 'ok'})()" >/dev/null 2>&1
  sleep 1
}

echo "=============================================="
echo "== -1. 页面重载（清理残留弹窗态） =="
agent-browser open "$BASE_URL" >/dev/null 2>&1
sleep 3
agent-browser errors --clear >/dev/null 2>&1
agent-browser console --clear >/dev/null 2>&1
echo "== 0. 重置演示数据（确定初态） =="
reset_demo
check_num "重置后卡片 10 张" "document.querySelectorAll('.table-card').length" "10"
check_num "重置后导航线 10 条" "document.querySelectorAll('path.edge-hit').length" "10"

echo ""
echo "== 1. 初态结构 =="
check_num "分类 3 个" "document.querySelectorAll('.category-node').length" "3"
check_num "NN 胶囊 3 个" "document.querySelectorAll('g.nn-pill').length" "3"
check_num "大纲表行 13 条" "document.querySelectorAll('.table-row[data-outline-table]').length" "13"
check "画布状态栏显示 10 张表" "(function(){var e=document.querySelector('.canvas-status');return !!e && e.textContent.includes('10 张表')})()"

echo ""
echo "== 2. 选择（Ctrl+A / Ctrl+D） =="
agent-browser click ".canvas-area" >/dev/null 2>&1
sleep 0.4
agent-browser press "Control+a" >/dev/null 2>&1
sleep 0.6
check_num "Ctrl+A 全选 10 张" "document.querySelectorAll('.table-card.selected').length" "10"
agent-browser press "Control+d" >/dev/null 2>&1
sleep 0.6
check_num "Ctrl+D 取消选中" "document.querySelectorAll('.table-card.selected').length" "0"

echo ""
echo "== 3. 拖拽 + updateTablePos 批量契约 =="
fit_all
agent-browser console --clear >/dev/null 2>&1
READ=$(agent-browser eval "(function(){var r=document.querySelector('.table-card').getBoundingClientRect();return Math.round(r.x)+','+Math.round(r.y+r.height/2)+','+Math.round(r.x+r.width/2)})()" 2>/dev/null | tr -d '"')
X0=$(echo "$READ" | cut -d, -f1)
CY=$(echo "$READ" | cut -d, -f2)
CX=$(echo "$READ" | cut -d, -f3)
agent-browser mouse move "$CX" "$CY" >/dev/null 2>&1
agent-browser mouse down >/dev/null 2>&1
sleep 0.2
agent-browser mouse move "$((CX + 40))" "$((CY + 20))" >/dev/null 2>&1
sleep 0.25
agent-browser mouse move "$((CX + 80))" "$((CY + 40))" >/dev/null 2>&1
sleep 0.25
agent-browser mouse move "$((CX + 160))" "$((CY + 80))" >/dev/null 2>&1
sleep 0.25
agent-browser mouse up >/dev/null 2>&1
sleep 1.2
check "拖拽后卡片位移 >20px（原 x=$X0）" "(function(){var r=document.querySelector('.table-card').getBoundingClientRect();return Math.abs(r.x-$X0)>20})()"
CNT=$(agent-browser console 2>/dev/null | grep -c "updateTablePos() 入参")
if [ "$CNT" = "1" ]; then
  PASS=$((PASS+1)); echo "  PASS  console 中 updateTablePos 调用 1 次"
else
  FAIL=$((FAIL+1)); FAILED+=("updateTablePos 次数"); echo "  FAIL  console 中 updateTablePos 调用 $CNT 次"
fi

echo ""
echo "== 4. 撤销恢复位置 =="
agent-browser press "Control+z" >/dev/null 2>&1
sleep 1.5
check "Ctrl+Z 后位置复原（x=$X0）" "(function(){var r=document.querySelector('.table-card').getBoundingClientRect();return Math.abs(r.x-$X0)<3})()"

echo ""
echo "== 5. 新增表 + nanoid id（Task 44） =="
open_canvas_menu
agent-browser find text "新增表（此处）" click >/dev/null 2>&1
poll "(function(){var i=document.querySelector('.ant-modal input[placeholder=\"如 sys_user\"]');return !!i && i.offsetParent!==null})()" 8
check "右键菜单打开新增表对话框（输入框可见）" "(function(){var i=document.querySelector('.ant-modal input[placeholder=\"如 sys_user\"]');return !!i && i.offsetParent!==null})()"
sleep 0.5
agent-browser find first 'input[placeholder="如 sys_user"]' fill "t_reg043" >/dev/null 2>&1
sleep 0.6
click_modal_text "保存"
poll "document.querySelectorAll('.table-card').length === 11" 12
check_num "保存后卡片 11 张" "document.querySelectorAll('.table-card').length" "11"
check "新表 id 为 nanoid（t- + 21 位 0-9a-zA-Z）" "(function(){var db=JSON.parse(localStorage.getItem('gdbme:db:v2'));var t=db.tables.find(function(x){return x.tableName==='t_reg043'});return !!t && /^t-[0-9a-zA-Z]{21}\$/.test(t.id)})()"
check "新表默认字段 id 为 nanoid（c- 前缀）" "(function(){var db=JSON.parse(localStorage.getItem('gdbme:db:v2'));var t=db.tables.find(function(x){return x.tableName==='t_reg043'});if(!t)return false;var cols=db.columns.filter(function(c){return c.tableId===t.id});return cols.length>0 && cols.every(function(c){return /^c-[0-9a-zA-Z]{21}\$/.test(c.id)})})()"

echo ""
echo "== 6. 删除表 + 撤销 =="
reset_demo
fit_all
agent-browser click ".table-card" >/dev/null 2>&1
sleep 0.8
check_num "点击卡片选中 1 张" "document.querySelectorAll('.table-card.selected').length" "1"
agent-browser press "Delete" >/dev/null 2>&1
sleep 1.2
check "Delete 弹出删除确认框" "(function(){var ws=[...document.querySelectorAll('.ant-modal-wrap')].filter(function(w){return getComputedStyle(w).display!=='none'});return ws.some(function(w){return w.textContent.includes('将删除表')})})()"
click_modal_text "删除"
sleep 1.5
check_num "删除后卡片 9 张" "document.querySelectorAll('.table-card').length" "9"
agent-browser press "Control+z" >/dev/null 2>&1
sleep 1.5
check_num "Ctrl+Z 撤销删除后 10 张" "document.querySelectorAll('.table-card').length" "10"

echo ""
echo "== 7. 复制粘贴 =="
fit_all
agent-browser click ".table-card" >/dev/null 2>&1
sleep 0.8
agent-browser press "Control+c" >/dev/null 2>&1
sleep 0.5
agent-browser press "Control+v" >/dev/null 2>&1
sleep 1.5
check_num "粘贴后卡片 11 张" "document.querySelectorAll('.table-card').length" "11"
agent-browser press "Control+z" >/dev/null 2>&1
sleep 1.5
check_num "Ctrl+Z 撤销粘贴后 10 张" "document.querySelectorAll('.table-card').length" "10"

echo ""
echo "== 8. 自动美化布局 + 撤销（比较 world 坐标） =="
fit_all
SNAP1=$(ev "(function(){var db=JSON.parse(localStorage.getItem('gdbme:db:v2'));return JSON.stringify(db.tables.map(function(t){return Math.round(t.x)+','+Math.round(t.y)}).sort())})()")
open_canvas_menu
agent-browser find text "自动美化布局" click >/dev/null 2>&1
sleep 2.2
SNAP2=$(ev "(function(){var db=JSON.parse(localStorage.getItem('gdbme:db:v2'));return JSON.stringify(db.tables.map(function(t){return Math.round(t.x)+','+Math.round(t.y)}).sort())})()")
if [ "$SNAP1" != "$SNAP2" ]; then
  PASS=$((PASS+1)); echo "  PASS  自动美化后表坐标发生变化"
else
  FAIL=$((FAIL+1)); FAILED+=("自动美化"); echo "  FAIL  自动美化后表坐标未变"
fi
agent-browser press "Control+z" >/dev/null 2>&1
sleep 1.8
SNAP3=$(ev "(function(){var db=JSON.parse(localStorage.getItem('gdbme:db:v2'));return JSON.stringify(db.tables.map(function(t){return Math.round(t.x)+','+Math.round(t.y)}).sort())})()")
if [ "$SNAP1" = "$SNAP3" ]; then
  PASS=$((PASS+1)); echo "  PASS  Ctrl+Z 撤销自动美化后表坐标复原"
else
  FAIL=$((FAIL+1)); FAILED+=("自动美化撤销"); echo "  FAIL  自动美化撤销后表坐标未复原"
fi

echo ""
echo "== 9. NN 胶囊显示隐藏中间表 =="
agent-browser eval "document.querySelector('g.nn-pill').dispatchEvent(new MouseEvent('click',{bubbles:true}))" >/dev/null 2>&1
sleep 1.5
check_num "点击 NN 胶囊后卡片 11 张" "document.querySelectorAll('.table-card').length" "11"
reset_demo
check_num "重置复原 10 张" "document.querySelectorAll('.table-card').length" "10"

echo ""
echo "== 10. 隐藏/显示表（大纲眼睛） =="
agent-browser eval "(function(){var b=document.querySelector('.table-row:not(.hidden) .t-eye');if(b){b.click();return 'ok'}return 'nf'})()" >/dev/null 2>&1
sleep 1.5
check_num "隐藏后卡片 9 张" "document.querySelectorAll('.table-card').length" "9"
agent-browser eval "(function(){var b=document.querySelector('.table-row.hidden .t-eye');if(b){b.click();return 'ok'}return 'nf'})()" >/dev/null 2>&1
sleep 1.5
check_num "再点显示后卡片 10 张" "document.querySelectorAll('.table-card').length" "10"

echo ""
echo "== 11. 表编辑对话框（双击卡片） =="
fit_all
dbl_card
check "双击卡片打开表编辑对话框" "(function(){var i=document.querySelector('.ant-modal input[placeholder=\"如 sys_user\"]');return !!i && i.offsetParent!==null})()"
click_modal_text "取消"
sleep 1.2
check "点取消后对话框隐藏" "(function(){var i=document.querySelector('.ant-modal input[placeholder=\"如 sys_user\"]');return !i || i.offsetParent===null})()"

echo ""
echo "== 12. 导航编辑对话框（双击导航线） =="
dbl_edge
check "双击导航线打开导航编辑对话框" "(function(){var ws=[...document.querySelectorAll('.ant-modal-wrap')].filter(function(w){return getComputedStyle(w).display!=='none'});return ws.some(function(w){return w.textContent.includes('编辑导航')})})()"
click_modal_text "取消"
sleep 1.2
check "关闭导航对话框" "(function(){var w=document.querySelector('.ant-modal-wrap');return !w || getComputedStyle(w).display==='none'})()"

echo ""
echo "== 13. 页面切换渲染 =="
nav "字典管理"
poll "!!document.querySelector('.dict-view')" 6
check "字典页渲染，字典项 >=5" "document.querySelectorAll('.dict-item').length >= 5"
nav "模板管理"
poll "!!document.querySelector('.template-view')" 6
check "模板页渲染，模板项 >=4" "document.querySelectorAll('.tpl-item').length >= 4"
nav "AI 工具"
poll "!!document.querySelector('.ai-view')" 6
check "AI 工具页渲染" "!!document.querySelector('.ai-view')"
nav "模型编辑器"
poll "!!document.querySelector('.canvas-area')" 6
check "返回编辑器页且 10 张卡片" "!!document.querySelector('.canvas-area') && document.querySelectorAll('.table-card').length === 10"

echo ""
echo "== 14. 主题切换 =="
agent-browser eval "[...document.querySelectorAll('.header-right .icon-btn')].find(b=>b.title&&b.title.includes('主题'))?.click()" >/dev/null 2>&1
sleep 1
check "切到暗色 data-theme=dark" "document.documentElement.getAttribute('data-theme')==='dark'"
agent-browser screenshot "$SHOTS/regress-43-47-dark.png" >/dev/null 2>&1
agent-browser eval "[...document.querySelectorAll('.header-right .icon-btn')].find(b=>b.title&&b.title.includes('主题'))?.click()" >/dev/null 2>&1
sleep 1
check "切回亮色 data-theme=light" "document.documentElement.getAttribute('data-theme')==='light'"

echo ""
echo "== 15. 设置页 + AI 全局规则默认文本（Task 43） =="
nav "系统设置"
poll "!!document.querySelector('.settings-view')" 6
check "设置页渲染" "!!document.querySelector('.settings-view')"
check "AI 全局规则含「# 术语」段" "(function(){var t=document.querySelector('.ai-card .rules-block textarea');return !!t && t.value.includes('# 术语')})()"
check "默认文本含「输出任务报告」" "(function(){var t=document.querySelector('.ai-card .rules-block textarea');return !!t && t.value.includes('输出任务报告')})()"
check "默认文本含「一轮问答只负责添加一个元素」" "(function(){var t=document.querySelector('.ai-card .rules-block textarea');return !!t && t.value.includes('一轮问答只负责添加一个元素')})()"
agent-browser eval "document.querySelector('.rules-reset')?.click()" >/dev/null 2>&1
sleep 0.6
check "点「恢复默认」后仍为默认文本" "(function(){var t=document.querySelector('.ai-card .rules-block textarea');return !!t && t.value.includes('# 术语')})()"
check "AI 卡片「恢复默认」按钮存在" "!!document.querySelector('.rules-reset')"
agent-browser screenshot "$SHOTS/regress-43-47-settings.png" >/dev/null 2>&1

echo ""
echo "== 16. 截图与错误检查 =="
nav "模型编辑器"
poll "!!document.querySelector('.canvas-area')" 6
sleep 1
agent-browser screenshot "$SHOTS/regress-43-47-editor.png" >/dev/null 2>&1
ERRS=$(agent-browser errors 2>/dev/null | grep -v "^$" | wc -l)
if [ "$ERRS" = "0" ]; then
  PASS=$((PASS+1)); echo "  PASS  全程页面错误 0 条"
else
  FAIL=$((FAIL+1)); FAILED+=("页面错误"); echo "  FAIL  页面错误 $ERRS 条"; agent-browser errors 2>/dev/null | tail -5
fi
DBG_ERR=$(agent-browser console 2>/dev/null | grep -c "\[ERROR\]")
if [ "$DBG_ERR" = "0" ]; then
  PASS=$((PASS+1)); echo "  PASS  控制台 ERROR 日志 0 条"
else
  FAIL=$((FAIL+1)); FAILED+=("控制台 ERROR"); echo "  FAIL  控制台 ERROR $DBG_ERR 条"; agent-browser console 2>/dev/null | grep "\[ERROR\]" | tail -5
fi

echo ""
echo "=============================================="
echo "PASS: $PASS  FAIL: $FAIL"
if [ ${#FAILED[@]} -gt 0 ]; then echo "失败项: ${FAILED[*]}"; fi
echo "=============================================="
[ "$FAIL" -eq 0 ] && echo "ALL_GREEN" || exit 1
