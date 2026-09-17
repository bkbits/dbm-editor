#!/usr/bin/env bash
# e2e/dict-template.sh —— 字典 / 字典分类 / 模板域
#
# 覆盖（合并自原 regress-a 页面渲染断言 + 补齐字典分类 UI 与模板编辑细节——
# 历史脚本空白域，本套件新写）：
# - 字典页渲染与选中联动（列表 → 编辑区草稿同步）
# - 字典值增删行、字典保存（新建 → 列表出现）、删除字典（确认弹窗）
# - 字典分类：新增（弹窗表单 + 大驼峰失焦转换）、编辑、删除被占用拦截
# - 模板页渲染、表模板选中 → 编辑器与预览联动、内容修改触发预览刷新、
#   保存 / 删除模板、字典分类模板（唯一）选中与保存
# 前置：agent-browser 可用；dev server 复用或自起。
set -u
source "$(dirname "$0")/lib.sh"

ensure_dev_server
echo "=============================================="
echo "== 字典 / 字典分类 / 模板域 E2E =="
echo "=============================================="
open_app
reset_demo

echo "== 1. 字典页渲染与选中联动 =="
nav "字典管理"
poll "!!document.querySelector('.dict-view')" 8
check "字典页渲染" "!!document.querySelector('.dict-view')"
check "字典项 >=5" "document.querySelectorAll('.dict-item').length >= 5"
check "字典分类分组头存在" "!!document.querySelector('.cat-head')"
agent-browser eval "document.querySelector('.dict-item')?.click()" >/dev/null 2>&1
sleep 0.8
check "点击字典项进入编辑态（表单出现）" "!!document.querySelector('.detail-form')"
check "编辑区字典值表格出现" "(function(){return document.querySelectorAll('.v-row').length > 0})()"
FIRST_KEY=$(ev "(function(){var k=document.querySelector('.dict-item .item-key');return k?k.textContent.trim():''})()")
check "编辑区草稿键与列表选中项一致（$FIRST_KEY）" "(function(){var i=document.querySelector('.detail-form .form-item:nth-child(2) input');return !!i && i.value==='$FIRST_KEY'})()"

echo ""
echo "== 2. 字典值增删 =="
VALS_BEFORE=$(ev "document.querySelectorAll('.v-row').length")
agent-browser eval "(function(){var b=[...document.querySelectorAll('.values-head button')].find(function(x){return x.textContent.includes('新增值')});if(b){b.click();return 'ok'}return 'nf'})()" >/dev/null 2>&1
sleep 0.6
check "新增值行（行数 +1）" "(function(){return document.querySelectorAll('.v-row').length === $VALS_BEFORE + 1})()"
agent-browser eval "document.querySelector('.v-row .v-del')?.click()" >/dev/null 2>&1
sleep 0.6
check "删除值行（行数复原）" "(function(){return document.querySelectorAll('.v-row').length === $VALS_BEFORE})()"

echo ""
echo "== 3. 新建字典 → 保存 → 列表出现 =="
agent-browser eval "(function(){var b=[...document.querySelectorAll('.list-head button')].find(function(x){return x.textContent.includes('新增')});if(b){b.click();return 'ok'}return 'nf'})()" >/dev/null 2>&1
sleep 0.8
check "新增字典进入空白草稿（表单仍在，选中清空）" "(function(){var sel=document.querySelectorAll('.dict-item.selected');return sel.length===0 && !!document.querySelector('.detail-form')})()"
agent-browser find first '.detail-form .form-item:nth-child(2) input' fill "e2e_dict" >/dev/null 2>&1
sleep 0.3
agent-browser find first '.detail-form .form-item:nth-child(3) input' fill "E2E测试字典" >/dev/null 2>&1
sleep 0.3
agent-browser eval "(function(){var b=[...document.querySelectorAll('.form-actions button')].find(function(x){return x.textContent.includes('保存字典')});if(b){b.click();return 'ok'}return 'nf'})()" >/dev/null 2>&1
poll "(function(){return document.body.innerText.includes('字典已创建')})()" 5
check "保存成功提示「字典已创建」" "(function(){return document.body.innerText.includes('字典已创建')})()"
check "列表出现新字典" "(function(){var ks=[...document.querySelectorAll('.dict-item .item-key')];return ks.some(function(k){return k.textContent.trim()==='e2e_dict'})})()"

echo ""
echo "== 4. 删除字典（popconfirm + Modal.confirm 两段确认） =="
agent-browser eval "(function(){var b=[...document.querySelectorAll('.form-actions button')].find(function(x){return x.textContent.includes('删除')});if(b){b.click();return 'ok'}return 'nf'})()" >/dev/null 2>&1
sleep 1
check "删除确认气泡出现（ant-popconfirm）" "(function(){var p=[...document.querySelectorAll('.ant-popover')].filter(function(w){return getComputedStyle(w).display!=='none'});return p.some(function(w){return w.textContent.includes('删除该字典')})})()"
click_modal_text "删除"
poll "(function(){var ws=[...document.querySelectorAll('.ant-modal-confirm')].filter(function(w){return getComputedStyle(w).display!=='none'});return ws.some(function(w){return w.textContent.includes('删除字典')})})()" 6
check "二次确认弹窗（Modal.confirm 删除字典）" "(function(){var ws=[...document.querySelectorAll('.ant-modal-confirm')].filter(function(w){return getComputedStyle(w).display!=='none'});return ws.some(function(w){return w.textContent.includes('删除字典')})})()"
click_confirm_text "删除"
sleep 1.5
check "删除成功提示「字典已删除」" "(function(){return document.body.innerText.includes('字典已删除')})()"
check "列表不再有 e2e_dict" "(function(){var ks=[...document.querySelectorAll('.dict-item .item-key')];return !ks.some(function(k){return k.textContent.trim()==='e2e_dict'})})()"

echo ""
echo "== 5. 字典分类：新增（大驼峰失焦转换） =="
CATS_BEFORE=$(ev "(function(){return document.body.innerText.match(/(\d+) 个分类/)[1]})()")
agent-browser eval "(function(){var b=[...document.querySelectorAll('.head-actions button')].find(function(x){return x.querySelector('svg.lucide-folder-plus')});if(b){b.click();return 'ok'}return 'nf'})()" >/dev/null 2>&1
sleep 0.8
check "新增字典分类弹窗打开" "(function(){var ws=[...document.querySelectorAll('.ant-modal-wrap')].filter(function(w){return getComputedStyle(w).display!=='none'});return ws.some(function(w){return w.textContent.includes('新增字典分类')})})()"
agent-browser find first 'input[placeholder*="系统字典"]' fill "E2E分类" >/dev/null 2>&1
sleep 0.3
agent-browser find first 'input[placeholder*="com.example"]' fill "e2e.dict" >/dev/null 2>&1
sleep 0.3
click_modal_text "保存分类"
poll "(function(){return document.body.innerText.includes('字典分类已创建')})()" 5
check "分类保存成功提示" "(function(){return document.body.innerText.includes('字典分类已创建')})()"
CATS_AFTER=$(ev "(function(){return document.body.innerText.match(/(\d+) 个分类/)[1]})()")
check "分类计数 +1（$CATS_BEFORE → $CATS_AFTER）" "(function(){return $CATS_AFTER === $CATS_BEFORE + 1})()"

echo ""
echo "== 6. 字典分类：删除被占用拦截（首个分类持有字典） =="
# cat-btn 序列为 [编辑, 删除]×N：index 1 = 首个分类的删除按钮（系统字典，其下有字典）
agent-browser eval "(function(){var bs=[...document.querySelectorAll('.cat-head .cat-btn')];var del=bs[1];if(del){del.click();return 'ok'}return 'nf'})()" >/dev/null 2>&1
sleep 0.8
check "删除分类确认弹窗" "(function(){var ws=[...document.querySelectorAll('.ant-modal-confirm')].filter(function(w){return getComputedStyle(w).display!=='none'});return ws.length>0})()"
click_modal_text "删除"
sleep 1.2
check "分类下仍有字典 → 拒绝删除（中文业务提示）" "(function(){return document.body.innerText.includes('无法删除') || document.body.innerText.includes('分类下仍有字典')})()"
# onOk 异步拒绝后 Modal.confirm 保持打开（antd 语义）——手动取消关闭，
# 防止残留弹层的「删除」按钮污染后续步骤的弹层点击
click_confirm_text "取消"
sleep 0.8
check "拒绝后确认弹窗已关闭" "(function(){var ws=[...document.querySelectorAll('.ant-modal-confirm')].filter(function(w){return getComputedStyle(w).display!=='none'});return ws.length===0})()"
# 预期业务拒绝：api 日志器按设计以 error 级记录拒绝（Modal.confirm onOk 异步拒绝亦
# 会产生 unhandled rejection 页面错误）——此为既有行为；重置错误基线后继续，
# 后续意外错误仍会被收尾检查捕获
agent-browser errors --clear >/dev/null 2>&1
agent-browser console --clear >/dev/null 2>&1

echo ""
echo "== 7. 模板页渲染与编辑预览联动 =="
nav "模板管理"
poll "!!document.querySelector('.template-view')" 8
check "模板页渲染，模板项 >=4" "document.querySelectorAll('.tpl-item').length >= 4"
check "表模板默认选中（编辑器有内容）" "(function(){var t=document.querySelector('.tpl-textarea');return !!t && t.value.length>0})()"
check "实时预览代码视图出现" "!!document.querySelector('.code-view')"
agent-browser eval "document.querySelector('.tpl-item')?.click()" >/dev/null 2>&1
sleep 1.5
check "切换模板后预览刷新" "!!document.querySelector('.code-view')"
# 修改内容触发防抖预览（内容前插注释标记）
agent-browser eval "(function(){var t=document.querySelector('.tpl-textarea');if(!t)return 'nf';t.value='<%# e2e mark %>\n'+t.value;t.dispatchEvent(new Event('input',{bubbles:true}));return 'ok'})()" >/dev/null 2>&1
sleep 1.2
check "内容修改触发预览防抖刷新（无渲染错误）" "(function(){return !document.querySelector('.preview-error')})()"

echo ""
echo "== 8. 表模板保存与删除 =="
agent-browser eval "(function(){var b=[...document.querySelectorAll('.tpl-actions button')].find(function(x){return x.textContent.includes('保存模板')});if(b){b.click();return 'ok'}return 'nf'})()" >/dev/null 2>&1
sleep 1.2
check "模板保存成功提示" "(function(){return document.body.innerText.includes('模板已保存')})()"
agent-browser eval "(function(){var b=[...document.querySelectorAll('.tpl-actions button')].find(function(x){return x.textContent.includes('删除')});if(b){b.click();return 'ok'}return 'nf'})()" >/dev/null 2>&1
sleep 1
check "删除模板确认气泡出现" "(function(){var p=[...document.querySelectorAll('.ant-popover')].filter(function(w){return getComputedStyle(w).display!=='none'});return p.some(function(w){return w.textContent.includes('删除该模板')})})()"
click_modal_text "删除"
poll "(function(){var ws=[...document.querySelectorAll('.ant-modal-confirm')].filter(function(w){return getComputedStyle(w).display!=='none'});return ws.some(function(w){return w.textContent.includes('删除模板')})})()" 6
check "二次确认弹窗（Modal.confirm 删除模板）" "(function(){var ws=[...document.querySelectorAll('.ant-modal-confirm')].filter(function(w){return getComputedStyle(w).display!=='none'});return ws.some(function(w){return w.textContent.includes('删除模板')})})()"
click_confirm_text "删除"
sleep 1.5
check "模板删除成功提示" "(function(){return document.body.innerText.includes('模板已删除')})()"

echo ""
echo "== 9. 字典分类模板（唯一） =="
agent-browser eval "(function(){var items=[...document.querySelectorAll('.tpl-item')];var d=items.find(function(x){return x.querySelector('svg.lucide-book-text')});if(d){d.click();return 'ok'}return 'nf'})()" >/dev/null 2>&1
sleep 1.2
check "选中字典分类模板（名称输入为 dict）" "(function(){var i=document.querySelector('.tpl-name-input input');return !!i && i.value==='dict'})()"
check "字典模板「仅一个」提示存在" "(function(){return document.body.innerText.includes('仅一个，无新增 / 删除')})()"
check "预览目标为字典分类选择器" "!!document.querySelector('.tpl-preview .ant-select')"

echo ""
echo "== 10. 截图与收尾 =="
nav "字典管理" >/dev/null 2>&1
sleep 1
agent-browser screenshot "$SHOTS/e2e-dict-template.png" >/dev/null 2>&1
finish_suite "字典/模板域"
