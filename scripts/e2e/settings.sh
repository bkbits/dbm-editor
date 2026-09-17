#!/usr/bin/env bash
# e2e/settings.sh —— 设置域：非 AI 设置（列默认类型 / 索引类型 / 字段约定 / 代码生成）+ AI 设置
#
# 覆盖（合并自原 task35 设置页结构 + task36 字段约定保存链路 + task40 模型
# 上下文与轮数上限 + task42 全局规则默认文本 + regress-a 设置/AI 默认文本）：
# - 分区导航（5 项 / 点击滚动 / 滚动高亮 / 保存条固定底部）
# - 字段约定：逻辑删除默认 placeholder、修改保存启用、统一保存提示、
#   localStorage 持久化
# - 索引类型：清空 → 保存禁用提示；恢复
# - AI 设置：无独立保存按钮、草稿修改启用统一保存、统一保存链路收口
# - AI 模型上下文长度可配置（8192）
# - 工具调用轮数上限：默认 50、可改（2）并保存
# - AI 全局规则默认文本：稳定锚点（# 术语 / # 任务流程 / # 遵守规则 /
#   输出任务报告）、清空 / 恢复默认、保存持久化、旧库空值不被种子覆盖、
#   空值下恢复默认同样生效
# 前置：agent-browser 可用；dev server 复用或自起。需要 mock（AI 服务配置项）。
set -u
source "$(dirname "$0")/lib.sh"

ensure_dev_server
start_mock
echo "=============================================="
echo "== 设置域 E2E（设置 + AI 设置） =="
echo "=============================================="
open_app
reset_demo

echo "== 1. 设置页结构与分区导航 =="
nav "系统设置"
poll "!!document.querySelector('.settings-view')" 8
check "设置页渲染" "!!document.querySelector('.settings-view')"
check_num "分区导航 5 项" "document.querySelectorAll('.settings-nav .nav-item').length" "5"
check "保存条位于页面结构底部（不随滚动）" "!!document.querySelector('.settings-view > .settings-foot')"
check "初始状态「全部更改已保存」" "(function(){return document.body.innerText.includes('全部更改已保存')})()"
check "分区导航含「字段约定」" "(function(){var ns=[...document.querySelectorAll('.settings-nav .nav-item')];return ns.some(function(n){return n.textContent.includes('字段约定')})})()"

echo ""
echo "== 2. 字段约定（主键 / 审计 / 逻辑删除） =="
check "逻辑删除约定行存在" "!!document.querySelector('.conv-logic')"
check "逻辑删除名称默认 placeholder = deleted" "(function(){var i=document.querySelector('.conv-logic input');return !!i && i.placeholder==='deleted'})()"
check "逻辑删除约定类型为 TINYINT（类型输入值/占位）" "(function(){var ins=[...document.querySelectorAll('.conv-logic input')];var t=ins[1];return !!t && (t.value==='TINYINT' || t.placeholder==='TINYINT')})()"
agent-browser find first '.conv-logic input' fill "del_flag" >/dev/null 2>&1
sleep 0.6
check "约定修改后保存按钮启用" "(function(){var b=[...document.querySelectorAll('.settings-foot button')].find(function(x){return x.textContent.includes('保存设置')});return !!b && !b.disabled})()"
agent-browser eval "(function(){var b=[...document.querySelectorAll('.settings-foot button')].find(function(x){return x.textContent.includes('保存设置')});if(b){b.click();return 'ok'}return 'nf'})()" >/dev/null 2>&1
sleep 1.5
check "统一保存成功提示「设置已保存」" "(function(){return document.body.innerText.includes('设置已保存')})()"
check "保存后脏标记收口「全部更改已保存」" "(function(){return document.body.innerText.includes('全部更改已保存')})()"
check "逻辑删除约定 localStorage 持久化" "(function(){var db=JSON.parse(localStorage.getItem('gdbme:db:v2'));return db.settings.fieldConventions.logicDelete.name==='del_flag'})()"

echo ""
echo "== 3. 索引类型清空 → 保存禁用（逐个点击防数组索引错位） =="
for _k in 1 2 3 4 5 6; do
  agent-browser eval "(function(){var c=document.querySelector('.index-chip .chip-close');if(c){c.click();return 'ok'}return 'none'})()" >/dev/null 2>&1
  sleep 0.4
done
check_num "索引类型芯片已全部清空" "document.querySelectorAll('.index-chip').length" "0"
check "清空后提示「索引类型列表为空，保存已禁用」" "(function(){return document.body.innerText.includes('索引类型列表为空，保存已禁用')})()"
check "保存按钮被禁用" "(function(){var b=[...document.querySelectorAll('.settings-foot button')].find(function(x){return x.textContent.includes('保存设置')});return !!b && b.disabled})()"
agent-browser find first '.index-input' fill "NORMAL" >/dev/null 2>&1
sleep 0.3
agent-browser eval "(function(){var b=[...document.querySelectorAll('.index-add button')].find(function(x){return x.textContent.includes('添加')});if(b){b.click();return 'ok'}return 'nf'})()" >/dev/null 2>&1
sleep 0.8
check "补回类型后保存恢复可用" "(function(){var b=[...document.querySelectorAll('.settings-foot button')].find(function(x){return x.textContent.includes('保存设置')});return !!b && !b.disabled})()"

echo ""
echo "== 4. AI 设置（统一保存链路 + 模型上下文 + 轮数上限） =="
check "AI 区块无独立保存按钮（统一保存）" "!document.body.innerText.includes('保存 AI 设置')"
agent-browser find first 'input[placeholder*="api.example.com"]' fill "$MOCK_URL" >/dev/null 2>&1
sleep 0.4
agent-browser eval "(function(){var b=[...document.querySelectorAll('.ai-card button')].find(function(x){return x.textContent.includes('添加模型')});if(b){b.click();return 'ok'}return 'nf'})()" >/dev/null 2>&1
sleep 0.6
agent-browser find first 'input[placeholder*="glm-4.6"]' fill "e2e-model" >/dev/null 2>&1
sleep 0.4
poll "(function(){var b=[...document.querySelectorAll('.settings-foot button')].find(function(x){return x.textContent.includes('保存设置')});return !!b && !b.disabled})()" 5
check "AI 草稿修改后统一保存按钮启用" "(function(){var b=[...document.querySelectorAll('.settings-foot button')].find(function(x){return x.textContent.includes('保存设置')});return !!b && !b.disabled})()"
# 模型输入上下文（inputContextLength = 8192）
agent-browser eval "(function(){var i=document.querySelector('.ai-card .ant-input-number input');if(i){i.focus();return 'ok'}return 'nf'})()" >/dev/null 2>&1
sleep 0.3
agent-browser find first '.ai-card .ant-input-number input' fill "8192" >/dev/null 2>&1
sleep 0.4
# 轮数上限默认值
ROUNDS=$(ev "(function(){var i=document.querySelector('.rounds-block .ant-input-number input');return i?i.value:''})()")
check_eq "工具调用轮数上限默认 50" "$ROUNDS" "50"
agent-browser find first '.rounds-block .ant-input-number input' fill "2" >/dev/null 2>&1
sleep 0.4
agent-browser eval "(function(){var b=[...document.querySelectorAll('.settings-foot button')].find(function(x){return x.textContent.includes('保存设置')});if(b){b.click();return 'ok'}return 'nf'})()" >/dev/null 2>&1
sleep 1.5
check "统一保存成功提示（含 AI 草稿）" "(function(){return document.body.innerText.includes('设置已保存')})()"
check "保存后脏标记收口" "(function(){return document.body.innerText.includes('全部更改已保存')})()"
check "AI 服务地址持久化" "(function(){var db=JSON.parse(localStorage.getItem('gdbme:db:v2'));return db.aiSettings.baseUrl==='$MOCK_URL' && db.aiSettings.models.length===1})()"

echo ""
echo "== 5. AI 全局规则默认文本（新库种子） =="
check "规则区提示文案存在" "(function(){var h=document.querySelector('.rules-head .rules-hint');return !!h && h.textContent.includes('留空则仅使用内置默认规则')})()"
T1=$(ev "(function(){var t=document.querySelector('.rules-block textarea');return t?t.value:''})()")
check "默认文本含「# 术语」段" "(function(){var t=document.querySelector('.rules-block textarea');return t.value.includes('# 术语')})()"
check "默认文本含「# 任务流程」" "(function(){var t=document.querySelector('.rules-block textarea');return t.value.includes('# 任务流程')})()"
check "默认文本含「# 遵守规则」" "(function(){var t=document.querySelector('.rules-block textarea');return t.value.includes('# 遵守规则')})()"
check "默认文本含「输出任务报告」" "(function(){var t=document.querySelector('.rules-block textarea');return t.value.includes('输出任务报告')})()"
check "默认文本含「一轮问答只负责添加一个元素」" "(function(){var t=document.querySelector('.rules-block textarea');return t.value.includes('一轮问答只负责添加一个元素')})()"
check "「恢复默认」按钮存在" "(function(){var b=document.querySelector('.rules-reset');return !!b && b.textContent.includes('恢复默认')})()"

echo ""
echo "== 6. 清空 → 恢复默认 → 持久化 =="
agent-browser find first '.rules-block textarea' fill "" >/dev/null 2>&1
sleep 0.5
check "清空后 textarea 为空" "(function(){var t=document.querySelector('.rules-block textarea');return t.value.trim()===''})()"
agent-browser eval "document.querySelector('.rules-reset')?.click()" >/dev/null 2>&1
sleep 0.6
check "点击「恢复默认」后草稿恢复默认文本" "(function(){var t=document.querySelector('.rules-block textarea');return t.value.includes('# 任务流程') && t.value.includes('# 遵守规则')})()"
agent-browser eval "(function(){var b=[...document.querySelectorAll('.settings-foot button')].find(function(x){return x.textContent.includes('保存设置')});if(b){b.click();return 'ok'}return 'nf'})()" >/dev/null 2>&1
sleep 1.5
check "保存后 localStorage 持久化默认规则" "(function(){var db=JSON.parse(localStorage.getItem('gdbme:db:v2'));return db.aiSettings.globalRules.includes('# 任务流程') && db.aiSettings.globalRules.includes('# 术语')})()"

echo ""
echo "== 7. 旧库空值不被种子覆盖（尊重主动清空） =="
agent-browser eval "(function(){var db=JSON.parse(localStorage.getItem('gdbme:db:v2'));db.aiSettings.globalRules='';localStorage.setItem('gdbme:db:v2',JSON.stringify(db));return 'ok'})()" >/dev/null 2>&1
agent-browser open "$BASE_URL" >/dev/null 2>&1
sleep 3
nav "系统设置"
poll "(function(){var t=document.querySelector('.rules-block textarea');return !!t && t.value===''})()" 8
check "旧库已保存空值不被种子默认覆盖" "(function(){var t=document.querySelector('.rules-block textarea');return t.value.trim()===''})()"
agent-browser eval "document.querySelector('.rules-reset')?.click()" >/dev/null 2>&1
sleep 0.6
check "空值下「恢复默认」同样生效" "(function(){var t=document.querySelector('.rules-block textarea');return t.value.includes('# 任务流程')})()"

echo ""
echo "== 8. 截图与收尾 =="
agent-browser screenshot "$SHOTS/e2e-settings.png" >/dev/null 2>&1
finish_suite "设置域"
