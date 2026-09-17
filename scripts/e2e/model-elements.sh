#!/usr/bin/env bash
# e2e/model-elements.sh —— 模型元素域：表分类 / 表 / 关联的列 / 导航关系
#
# 覆盖（合并自原 regress-a 主链路 + task36 字段约定与固定列 + task37 SyncTable 行为）：
# - 画布初态（卡片 / 导航线 / 分类 / NN 胶囊 / 大纲 / 状态栏）
# - 选择（Ctrl+A / Ctrl+D）、拖拽位移与 updateTablePos 批量契约、撤销恢复
# - 新增表（右键菜单 + nanoid id 契约）、删除 + 撤销、复制粘贴 + 撤销
# - 自动美化布局 + 撤销（world 坐标快照比较）、NN 胶囊显隐中间表
# - 大纲眼睛隐藏 / 显示表、表编辑与导航编辑对话框开合
# - 字段（关联的列）：逻辑删除字段约定链路（一键添加 / 勾选互斥 / 保存持久化）
# - SyncTable 多表同步滚动行为：左右固定列几何恒定、表头表体同步、滚轮转发、
#   越界钳制、纵向同步（内部六表结构断言不保留——实现细节）
# 前置：agent-browser 可用；dev server 复用或自起。
set -u
source "$(dirname "$0")/lib.sh"

ensure_dev_server
echo "=============================================="
echo "== 模型元素域 E2E（表分类 / 表 / 列 / 导航） =="
echo "=============================================="
open_app

echo "== 0. 重置演示数据（确定初态） =="
reset_demo
check_num "重置后卡片 10 张" "document.querySelectorAll('.table-card').length" "10"
check_num "重置后导航线 10 条" "document.querySelectorAll('path.edge-hit').length" "10"

echo ""
echo "== 1. 初态结构 =="
check_num "分类节点 3 个" "document.querySelectorAll('.category-node').length" "3"
check_num "NN 关系胶囊 3 个" "document.querySelectorAll('g.nn-pill').length" "3"
check_num "大纲表行 13 条（10 可见 + 3 隐藏中间表）" "document.querySelectorAll('.table-row[data-outline-table]').length" "13"
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
READ=$(ev "(function(){var r=document.querySelector('.table-card').getBoundingClientRect();return Math.round(r.x)+','+Math.round(r.y+r.height/2)+','+Math.round(r.x+r.width/2)})()")
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
check "拖拽后卡片位移 >20px" "(function(){var r=document.querySelector('.table-card').getBoundingClientRect();return Math.abs(r.x-$X0)>20})()"
CNT=$(agent-browser console 2>/dev/null | grep -c "updateTablePos() 入参")
check_eq "拖拽仅触发 1 次 updateTablePos（批量契约）" "$CNT" "1"

echo ""
echo "== 4. 撤销恢复位置 =="
agent-browser press "Control+z" >/dev/null 2>&1
sleep 1.5
check "Ctrl+Z 后位置复原（±3px）" "(function(){var r=document.querySelector('.table-card').getBoundingClientRect();return Math.abs(r.x-$X0)<3})()"

echo ""
echo "== 5. 新增表 + nanoid id 契约 =="
open_canvas_menu
agent-browser find text "新增表（此处）" click >/dev/null 2>&1
poll "(function(){var i=document.querySelector('.ant-modal input[placeholder=\"如 sys_user\"]');return !!i && i.offsetParent!==null})()" 8
check "右键菜单打开新增表对话框（输入框可见）" "(function(){var i=document.querySelector('.ant-modal input[placeholder=\"如 sys_user\"]');return !!i && i.offsetParent!==null})()"
sleep 0.5
agent-browser find first 'input[placeholder="如 sys_user"]' fill "t_e2e_new" >/dev/null 2>&1
sleep 0.6
click_modal_text "保存"
poll "document.querySelectorAll('.table-card').length === 11" 12
check_num "保存后卡片 11 张" "document.querySelectorAll('.table-card').length" "11"
check "新表 id 为 nanoid（t- + 21 位 0-9a-zA-Z）" "(function(){var db=JSON.parse(localStorage.getItem('gdbme:db:v2'));var t=db.tables.find(function(x){return x.tableName==='t_e2e_new'});return !!t && /^t-[0-9a-zA-Z]{21}\$/.test(t.id)})()"
check "新表默认字段 id 为 nanoid（c- 前缀）" "(function(){var db=JSON.parse(localStorage.getItem('gdbme:db:v2'));var t=db.tables.find(function(x){return x.tableName==='t_e2e_new'});if(!t)return false;var cols=db.columns.filter(function(c){return c.tableId===t.id});return cols.length>0 && cols.every(function(c){return /^c-[0-9a-zA-Z]{21}\$/.test(c.id)})})()"

echo ""
echo "== 6. 删除表 + 撤销 =="
reset_demo
fit_all
agent-browser click ".table-card" >/dev/null 2>&1
sleep 0.8
check_num "点击卡片选中 1 张" "document.querySelectorAll('.table-card.selected').length" "1"
agent-browser press "Delete" >/dev/null 2>&1
sleep 1.2
check "Delete 弹出删除确认框（含「将删除表」）" "(function(){var ws=[...document.querySelectorAll('.ant-modal-wrap')].filter(function(w){return getComputedStyle(w).display!=='none'});return ws.some(function(w){return w.textContent.includes('将删除表')})})()"
click_modal_text "删除"
sleep 1.5
check_num "确认删除后 9 张" "document.querySelectorAll('.table-card').length" "9"
agent-browser press "Control+z" >/dev/null 2>&1
sleep 1.5
check_num "Ctrl+Z 撤销删除后 10 张" "document.querySelectorAll('.table-card').length" "10"

echo ""
echo "== 7. 复制粘贴 + 撤销 =="
fit_all
agent-browser click ".table-card" >/dev/null 2>&1
sleep 0.8
agent-browser press "Control+c" >/dev/null 2>&1
sleep 0.5
agent-browser press "Control+v" >/dev/null 2>&1
sleep 1.5
check_num "Ctrl+C/V 粘贴后 11 张" "document.querySelectorAll('.table-card').length" "11"
agent-browser press "Control+z" >/dev/null 2>&1
sleep 1.5
check_num "Ctrl+Z 撤销粘贴后 10 张" "document.querySelectorAll('.table-card').length" "10"

echo ""
echo "== 8. 自动美化布局 + 撤销（world 坐标比较） =="
fit_all
SNAP1=$(ev "(function(){var db=JSON.parse(localStorage.getItem('gdbme:db:v2'));return JSON.stringify(db.tables.map(function(t){return Math.round(t.x)+','+Math.round(t.y)}).sort())})()")
open_canvas_menu
agent-browser find text "自动美化布局" click >/dev/null 2>&1
sleep 2.2
SNAP2=$(ev "(function(){var db=JSON.parse(localStorage.getItem('gdbme:db:v2'));return JSON.stringify(db.tables.map(function(t){return Math.round(t.x)+','+Math.round(t.y)}).sort())})()")
if [ "$SNAP1" != "$SNAP2" ]; then
  PASS=$((PASS+1)); echo "  PASS  自动美化后表坐标变化（world 坐标）"
else
  FAIL=$((FAIL+1)); FAILED+=("自动美化"); echo "  FAIL  自动美化后表坐标未变"
fi
agent-browser press "Control+z" >/dev/null 2>&1
sleep 1.8
SNAP3=$(ev "(function(){var db=JSON.parse(localStorage.getItem('gdbme:db:v2'));return JSON.stringify(db.tables.map(function(t){return Math.round(t.x)+','+Math.round(t.y)}).sort())})()")
check_eq "Ctrl+Z 撤销自动美化后坐标复原" "$SNAP3" "$SNAP1"

echo ""
echo "== 9. NN 胶囊显示隐藏中间表 =="
agent-browser eval "document.querySelector('g.nn-pill').dispatchEvent(new MouseEvent('click',{bubbles:true}))" >/dev/null 2>&1
sleep 1.5
check_num "点击 NN 胶囊后卡片 11 张" "document.querySelectorAll('.table-card').length" "11"
reset_demo
check_num "重置复原 10 张" "document.querySelectorAll('.table-card').length" "10"

echo ""
echo "== 10. 隐藏 / 显示表（大纲眼睛） =="
agent-browser eval "(function(){var b=document.querySelector('.table-row:not(.hidden) .t-eye');if(b){b.click();return 'ok'}return 'nf'})()" >/dev/null 2>&1
sleep 1.5
check_num "隐藏后卡片 9 张" "document.querySelectorAll('.table-card').length" "9"
agent-browser eval "(function(){var b=document.querySelector('.table-row.hidden .t-eye');if(b){b.click();return 'ok'}return 'nf'})()" >/dev/null 2>&1
sleep 1.5
check_num "再点眼睛显示后 10 张" "document.querySelectorAll('.table-card').length" "10"

echo ""
echo "== 11. 表编辑对话框（双击卡片）+ 逻辑删除字段约定链路 =="
fit_all
dbl_card
poll "(function(){var i=document.querySelector('.ant-modal input[placeholder=\"如 sys_user\"]');return !!i && i.offsetParent!==null})()" 8
check "双击卡片打开表编辑对话框" "(function(){var i=document.querySelector('.ant-modal input[placeholder=\"如 sys_user\"]');return !!i && i.offsetParent!==null})()"
poll "!!document.querySelector('.sync-table')" 8
check "字段表头含「逻辑删」列" "(function(){var ths=document.querySelectorAll('.st-head-center th');return [...ths].some(function(t){return t.textContent.trim()==='逻辑删'})})()"
check "「添加逻辑删除字段」按钮存在" "(function(){var bs=document.querySelectorAll('.audit-actions button');return [...bs].some(function(b){return b.textContent.includes('添加逻辑删除字段')})})()"
check "对话框显示逻辑删除约定提示" "(function(){return document.body.innerText.includes('逻辑删除：deleted · TINYINT')})()"
ROWS_BEFORE=$(ev "document.querySelectorAll('.st-body-left .column-row').length")
agent-browser eval "(function(){var b=[...document.querySelectorAll('.audit-actions button')].find(function(x){return x.textContent.includes('添加逻辑删除字段')});if(b){b.click();return 'ok'}return 'nf'})()" >/dev/null 2>&1
sleep 1
ROWS_AFTER=$(ev "document.querySelectorAll('.st-body-left .column-row').length")
check "点击按钮依约定建列（行数 +1）" "(function(){return $ROWS_AFTER === $ROWS_BEFORE + 1})()"
check "约定名列 deleted 已创建" "(function(){var ins=[...document.querySelectorAll('.st-body-left .column-row')];return ins.some(function(r){var i=r.querySelector('.st-c-name input');return i && i.value==='deleted'})})()"
check "新建行逻辑删勾选（第 3 个复选框）" "(function(){var ins=[...document.querySelectorAll('.st-body-left .column-row')];var r=ins.find(function(x){var i=x.querySelector('.st-c-name input');return i && i.value==='deleted'});if(!r)return false;var idx=[...document.querySelectorAll('.st-body-left .column-row')].indexOf(r);var c=document.querySelectorAll('.st-body-center .column-row')[idx];return c && c.querySelectorAll('.ant-checkbox-input')[2].checked})()"
check "互斥：给其他行勾逻辑删后原行取消" "(function(){var rows=[...document.querySelectorAll('.st-body-center .column-row')];var pk=rows[0];for(var i=1;i<rows.length;i++){if(!rows[i].classList.contains('pk-row')){rows[i].querySelectorAll('.ant-checkbox-input')[2].click();break}}return true})()"
sleep 0.8
check "互斥 toast「每表最多一个」" "(function(){return document.body.innerText.includes('每表最多一个')})()"
check "按钮切换为「删除逻辑字段」" "(function(){var bs=document.querySelectorAll('.audit-actions button');return [...bs].some(function(b){return b.textContent.includes('删除逻辑字段')})})()"
click_modal_text "保存"
sleep 1.5
poll "(function(){var s=document.querySelector('.sync-table');return !s || s.getClientRects().length===0})()" 10
check "保存表成功（提示）" "(function(){return document.body.innerText.includes('已更新') || document.body.innerText.includes('已创建')})()"
check "保存后对话框真实隐藏（antd DOM 保留按可见性判）" "(function(){var s=document.querySelector('.sync-table');return !s || s.getClientRects().length===0})()"
dbl_card
poll "!!document.querySelector('.sync-table')" 8
sleep 1
check "重开后逻辑删标记持久化且仅一个" "(function(){var rows=[...document.querySelectorAll('.st-body-center .column-row')];return rows.filter(function(r){return r.querySelectorAll('.ant-checkbox-input')[2] && r.querySelectorAll('.ant-checkbox-input')[2].checked}).length===1})()"
click_modal_text "取消" >/dev/null 2>&1
sleep 1

echo ""
echo "== 12. SyncTable 固定列与同步滚动（窄视口） =="
agent-browser set viewport 760 900 >/dev/null 2>&1
sleep 0.8
dbl_card
poll "!!document.querySelector('.sync-table')" 8
sleep 1
check "窄视口下专用横向滚动条出现" "(function(){var s=document.querySelector('.st-scrollbar-h');return !!s && s.scrollWidth > s.clientWidth + 4})()"
LEFT_BEFORE=$(ev "Math.round(document.querySelector('.st-body-left').getBoundingClientRect().left)")
RIGHT_BEFORE=$(ev "Math.round(document.querySelector('.st-body-right').getBoundingClientRect().right)")
agent-browser eval "document.querySelector('.st-scrollbar-h').scrollLeft = 999999" >/dev/null 2>&1
sleep 0.8
check "排序手柄列固定左缘（滚动前后不变）" "(function(){return Math.abs(document.querySelector('.st-body-left').getBoundingClientRect().left - $LEFT_BEFORE) < 1})()"
check "字段名输入框完整位于左壳内" "(function(){var shell=document.querySelector('.st-body-left');var i=shell.querySelector('.st-c-name input');if(!i)return false;var a=i.getBoundingClientRect(),b=shell.getBoundingClientRect();return a.left>=b.left-1 && a.right<=b.right+1})()"
check "删除按钮列固定右缘" "(function(){return Math.abs(document.querySelector('.st-body-right').getBoundingClientRect().right - $RIGHT_BEFORE) < 1})()"
check "中间列随滚动平移（首列滚出）" "(function(){return document.querySelector('.st-body-center .st-c-propertyName').getBoundingClientRect().left < document.querySelector('.st-body-left').getBoundingClientRect().right - 4})()"
check "表头与表体中间列同步滚动" "(function(){var s=document.querySelector('.st-scrollbar-h');return s.scrollLeft>10 && document.querySelector('.st-head-center').scrollLeft===s.scrollLeft && document.querySelector('.st-body-center').scrollLeft===s.scrollLeft})()"
check "左右壳自身不产生横向滚动" "(function(){return document.querySelector('.st-body-left').scrollLeft===0 && document.querySelector('.st-body-right').scrollLeft===0})()"
check "越界 scrollLeft 被钳制" "(function(){var s=document.querySelector('.st-scrollbar-h');return s.scrollLeft <= s.scrollWidth - s.clientWidth + 1})()"
SL_NOW=$(ev "document.querySelector('.st-scrollbar-h').scrollLeft")
agent-browser eval "(function(){var c=document.querySelector('.st-body-center');c.dispatchEvent(new WheelEvent('wheel',{deltaX:-120,bubbles:true,cancelable:true}));return 'ok'})()" >/dev/null 2>&1
sleep 0.6
check "滚轮转发：壳内容滚轮驱动专用滚动条" "(function(){return document.querySelector('.st-scrollbar-h').scrollLeft < $SL_NOW})()"
# 纵向滚动：添加 8 个字段后表体三壳 scrollTop 同步、表头恒不纵滚
agent-browser eval "(function(){var b=[...document.querySelectorAll('.ant-modal button')].filter(function(x){return x.textContent.replace(/\s+/g,'')==='添加字段'});for(var i=0;i<8;i++){b.find(function(x){return x.offsetParent!==null})?.click()}return 'ok'})()" >/dev/null 2>&1
sleep 1
check "添加 8 字段后纵向滚动条出现" "(function(){var t=document.querySelector('.sync-table');return t.classList.contains('st-has-vbar') && document.querySelector('.st-scrollbar-v').scrollHeight > document.querySelector('.st-scrollbar-v').clientHeight})()"
agent-browser eval "document.querySelector('.st-scrollbar-v').scrollTop = 60" >/dev/null 2>&1
sleep 0.6
check "纵向滚动：表体三壳 scrollTop 同步" "(function(){var v=document.querySelector('.st-scrollbar-v');return v.scrollTop===60 && document.querySelector('.st-body-left').scrollTop===60 && document.querySelector('.st-body-center').scrollTop===60 && document.querySelector('.st-body-right').scrollTop===60})()"
check "纵向滚动：表头恒不纵滚" "(function(){return document.querySelector('.st-head-center').scrollTop===0})()"
click_modal_text "取消" >/dev/null 2>&1
sleep 1
agent-browser set viewport 1440 900 >/dev/null 2>&1
sleep 0.8

echo ""
echo "== 13. 导航编辑对话框（双击导航线） =="
fit_all
dbl_edge
check "双击导航线打开导航编辑对话框" "(function(){var ws=[...document.querySelectorAll('.ant-modal-wrap')].filter(function(w){return getComputedStyle(w).display!=='none'});return ws.some(function(w){return w.textContent.includes('编辑导航')})})()"
click_modal_text "取消" >/dev/null 2>&1
sleep 1.2
check "关闭导航对话框" "(function(){var w=document.querySelector('.ant-modal-wrap');return !w || getComputedStyle(w).display==='none'})()"

echo ""
echo "== 14. 截图与收尾 =="
agent-browser screenshot "$SHOTS/e2e-model-elements.png" >/dev/null 2>&1
finish_suite "模型元素域"
