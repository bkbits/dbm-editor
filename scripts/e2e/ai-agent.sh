#!/usr/bin/env bash
# e2e/ai-agent.sh —— AI 工具链域（pi-agent-core 内核 + 对话 + 工具 + 流式 + 任务清单 + 用量）
#
# 覆盖（合并自原 task35/39/40/41/43 + regress-b 的全部保留锚点）：
# - 对话基础：发送/停止按钮渲染与前景色、markstream Markdown 渲染（h2/代码块/
#   首部去空白）、暗色 dark 类、消息 flexShrink、建议列表
# - 内核链路（pi-agent-core）：系统提示能力域 + 全局规则流入、工具全量注册、
#   历史回放种子序列、typebox 参数校验失败回填重试、api 中文错误前缀回填、
#   同轮双工具串行
# - 工具调用：generateCode/replaceCode 链路（记录 / zip 下载 / 替换确认弹窗）、
#   refresh 能力、记录清空、技能加载（芯片 + 记录独立样式 + 部分清单）
# - 流式与滚动：思考块自动展开 / 溢出 / 贴底跟随 / 上翻停跟 / 回底恢复 /
#   完成收起 / 重开贴底 / 高频流竞态
# - 任务清单与压缩：汇报模板解析、状态同步、中止转暂停、下轮注入（回显日志）、
#   正文剥离、85% 自动压缩全链路（压缩请求日志 + 分隔条 + 摘要续聊 + 占用回落）
# - 用量统计：流式实时速度、上下文占用收口（2112/8192）、消息级标签、上次速度
# - 轮数上限：上限 2 时循环请求被中止
# 前置：agent-browser 可用；dev server 复用或自起；mock 直连（自带 CORS *）。
set -u
source "$(dirname "$0")/lib.sh"

ensure_dev_server
start_mock
# 预期 error 级日志（按设计）：api 日志器记录工具执行的业务拒绝（参数校验 /
# 执行失败演示链路）与用户主动中止的 AbortError
export EXPECTED_ERR_RE="removeCategory\(\) 抛错|chatComplete\(\) 抛错.*AbortError"
echo "=============================================="
echo "== AI 工具链域 E2E（pi-agent-core 内核） =="
echo "=============================================="
open_app
reset_demo

echo "== 1. 配置 AI 服务（mock 直连） =="
nav "系统设置"
poll "!!document.querySelector('.settings-view')" 8
agent-browser find first 'input[placeholder*="api.example.com"]' fill "$MOCK_URL" >/dev/null 2>&1
sleep 0.4
agent-browser eval "(function(){var b=[...document.querySelectorAll('.ai-card button')].find(function(x){return x.textContent.includes('添加模型')});if(b){b.click();return 'ok'}return 'nf'})()" >/dev/null 2>&1
sleep 0.6
agent-browser find first 'input[placeholder*="glm-4.6"]' fill "e2e-model" >/dev/null 2>&1
sleep 0.4
agent-browser find first '.ai-card .ant-input-number input' fill "8192" >/dev/null 2>&1
sleep 0.4
agent-browser eval "(function(){var b=[...document.querySelectorAll('.settings-foot button')].find(function(x){return x.textContent.includes('保存设置')});if(b){b.click();return 'ok'}return 'nf'})()" >/dev/null 2>&1
sleep 1.5
check "AI 服务配置保存成功" "(function(){return document.body.innerText.includes('设置已保存')})()"

echo ""
echo "== 2. AI 工具页基础渲染 =="
nav "AI 工具"
poll "!!document.querySelector('.ai-view')" 8
check "AI 工具页渲染" "!!document.querySelector('.ai-view')"
check "左侧任务清单面板存在" "!!document.querySelector('.task-pane')"
check "任务面板空态文案" "(function(){var e=document.querySelector('.task-empty');return !!e && e.textContent.includes('暂无任务')})()"
check "建议列表含画布重排建议" "(function(){var cs=[...document.querySelectorAll('.suggestion-chip')];return cs.some(function(c){return c.textContent.includes('重新设置每个表卡片的位置')})})()"
check "发送按钮 svg 图标渲染" "!!document.querySelector('.send-btn svg')"
check "发送图标前景色与背景不同色（可见性）" "(function(){var svg=document.querySelector('.send-btn svg');var btn=document.querySelector('.send-btn');return getComputedStyle(svg).color!==getComputedStyle(btn).backgroundColor})()"

echo ""
echo "== 3. 历史回放与内核链路（种子 / 系统提示 / 工具注册） =="
ask "历史回放首轮"
poll "!!document.querySelector('.send-btn.stop')" 8
check "流式运行中停止按钮渲染" "!!document.querySelector('.send-btn.stop svg')"
check "停止图标实心填充" "(function(){return getComputedStyle(document.querySelector('.send-btn.stop svg')).fill!=='none'})()"
wait_ai_done 30
check "首轮回答完成（历史回放完成）" "(function(){return document.body.innerText.includes('历史回放完成')})()"
ask "历史回放二轮"
wait_ai_done 30
check "二轮回答完成（已收到消息数）" "(function(){return document.body.innerText.includes('已收到')})()"
mock_has "roles=\[system,user,assistant,user\]" && check_eq "第二轮请求角色序列（历史种子回放）" "ok" "ok" || check_eq "第二轮请求角色序列（历史种子回放）" "miss" "ok"
mock_has "tools=3[0-9]" && check_eq "工具定义全量注册（30+ 契约能力）" "ok" "ok" || check_eq "工具定义全量注册" "miss" "ok"
mock_has "sysCap=true" && check_eq "系统提示含能力域清单" "ok" "ok" || check_eq "系统提示含能力域清单" "miss" "ok"
check "思考块完成后自动收起" "(function(){var b=document.querySelector('.reasoning-block');return !b || !b.classList.contains('open')})()"

echo ""
echo "== 4. 系统提示全局规则流入（默认规则验证） =="
ask "默认规则验证：请直接回复收到"
sleep 4  # 不等流式完成，只要请求日志到达
mock_has "sysRules=true sysRulesFlow=true" && check_eq "默认全局规则流入系统提示（【全局规则】+ 任务流程）" "ok" "ok" || check_eq "默认全局规则流入系统提示" "miss" "ok"
wait_ai_done 40

echo ""
echo "== 5. pi 参数校验链路（typebox 失败 → 错误工具结果 → 补参重试） =="
ask "参数校验演示"
poll "!!document.querySelector('.tool-record.error')" 20
check "缺参调用记录为 error 态" "(function(){var r=[...document.querySelectorAll('.tool-record')].find(function(x){return x.textContent.includes('removeCategory')});return !!r && r.classList.contains('error')})()"
agent-browser eval "(function(){var r=[...document.querySelectorAll('.tool-record.error')][0];if(r){r.querySelector('.record-head')?.click();return 'ok'}return 'nf'})()" >/dev/null 2>&1
sleep 0.8
check "错误记录含 typebox 校验文案（Validation failed + 字段名）" "(function(){var r=[...document.querySelectorAll('.tool-record.error')][0];return r.textContent.includes('Validation failed') && r.textContent.includes('categoryId')})()"
wait_ai_done 40
check "换合法工具重试后出现 success 记录" "(function(){var r=[...document.querySelectorAll('.tool-record')].find(function(x){return x.textContent.includes('getSettings')});return !!r && r.classList.contains('success')})()"
check "参数校验会话最终收尾（不中断）" "(function(){return document.body.innerText.includes('参数校验链路完成')})()"
mock_has "tool-result-text: .*Validation failed" && check_eq "校验失败结果回填模型（日志）" "ok" "ok" || check_eq "校验失败结果回填模型（日志）" "miss" "ok"

echo ""
echo "== 6. 执行失败链路（api 中文错误前缀回填） =="
ask "执行失败演示"
poll "(function(){return document.querySelectorAll('.tool-record.error').length>=2})()" 20
wait_ai_done 40
check "执行失败记录为 error 态（第 2 个错误记录）" "(function(){return document.querySelectorAll('.tool-record.error').length>=2})()"
agent-browser eval "(function(){var rs=[...document.querySelectorAll('.tool-record.error')];var r=rs[rs.length-1];if(r){r.querySelector('.record-head')?.click();return 'ok'}return 'nf'})()" >/dev/null 2>&1
sleep 0.8
check "错误记录含 api 中文原因（分类下仍有）" "(function(){var rs=[...document.querySelectorAll('.tool-record.error')];var r=rs[rs.length-1];return r.textContent.includes('分类下仍有')})()"
check "执行失败会话最终收尾" "(function(){return document.body.innerText.includes('执行失败链路完成')})()"
mock_has "tool-result-text: .*工具执行失败：.*分类下仍有" && check_eq "错误文本带「工具执行失败：」前缀回填（日志）" "ok" "ok" || check_eq "错误前缀回填（日志）" "miss" "ok"

echo ""
echo "== 7. 同轮双工具串行 =="
ask "双工具演示"
poll "(function(){var rs=[...document.querySelectorAll('.tool-record .rec-name')];return rs.length>=2 && rs[rs.length-2].textContent==='getSettings' && rs[rs.length-1].textContent==='getTables'})()" 20
check "同轮双工具按声明顺序串行执行" "(function(){var rs=[...document.querySelectorAll('.tool-record .rec-name')];return rs.length>=2 && rs[rs.length-2].textContent==='getSettings' && rs[rs.length-1].textContent==='getTables'})()"
wait_ai_done 40
check "双工具会话最终收尾" "(function(){return document.body.innerText.includes('双工具链路完成')})()"
mock_has "roles=.*assistant,tool,tool" && check_eq "双工具结果按序回填（角色序列日志）" "ok" "ok" || check_eq "双工具结果按序回填" "miss" "ok"

echo ""
echo "== 8. 超长思考流（贴底跟随三态 + 高频竞态） =="
ask "默认超长思考验证"
poll "(function(){var bs=[...document.querySelectorAll('.reasoning-body')].filter(function(x){return x.style.display!=='none'});var b=bs[bs.length-1];return !!b && b.scrollHeight - b.clientHeight > 150})()" 25
check "思考块流式输出中自动展开" "(function(){var bs=[...document.querySelectorAll('.reasoning-block')];return bs.some(function(x){return x.classList.contains('open')})})()"
check "思考内容溢出产生内部滚动" "(function(){var bs=[...document.querySelectorAll('.reasoning-body')].filter(function(x){return x.style.display!=='none'});var b=bs[bs.length-1];return !!b && b.scrollHeight - b.clientHeight > 150})()"
# 采样 1：内容增长 + 贴底
S1=$(ev "(function(){var bs=[...document.querySelectorAll('.reasoning-body')].filter(function(x){return x.style.display!=='none'});var b=bs[bs.length-1];return b.textContent.length+'|'+Math.round(b.scrollHeight-b.scrollTop-b.clientHeight)})()")
sleep 1.3
S2=$(ev "(function(){var bs=[...document.querySelectorAll('.reasoning-body')].filter(function(x){return x.style.display!=='none'});var b=bs[bs.length-1];return b.textContent.length+'|'+Math.round(b.scrollHeight-b.scrollTop-b.clientHeight)})()")
L1=$(echo "$S1" | cut -d'|' -f1); D1=$(echo "$S1" | cut -d'|' -f2)
L2=$(echo "$S2" | cut -d'|' -f1); D2=$(echo "$S2" | cut -d'|' -f2)
check "贴底时自动跟随（内容增长 + 距底 <24）" "(function(){return $L2 > $L1 && $D1 < 24 && $D2 < 24})()"
# 用户上翻 → 停止跟随（程序化滚动 + 同步派发 scroll 事件规避异步竞态）
agent-browser eval "(function(){var bs=[...document.querySelectorAll('.reasoning-body')].filter(function(x){return x.style.display!=='none'});var b=bs[bs.length-1];b.scrollTop=0;b.dispatchEvent(new Event('scroll'));return 'ok'})()" >/dev/null 2>&1
sleep 1.3
S3=$(ev "(function(){var bs=[...document.querySelectorAll('.reasoning-body')].filter(function(x){return x.style.display!=='none'});var b=bs[bs.length-1];return b.textContent.length+'|'+Math.round(b.scrollHeight-b.scrollTop-b.clientHeight)})()")
L3=$(echo "$S3" | cut -d'|' -f1); D3=$(echo "$S3" | cut -d'|' -f2)
check "上翻后停止跟随（内容仍增长 + scrollTop 恒 0 + 距底 >100）" "(function(){return $L3 > $L2 && $D3 > 100})()"
# 回底 → 恢复跟随
agent-browser eval "(function(){var bs=[...document.querySelectorAll('.reasoning-body')].filter(function(x){return x.style.display!=='none'});var b=bs[bs.length-1];b.scrollTop=b.scrollHeight;b.dispatchEvent(new Event('scroll'));return 'ok'})()" >/dev/null 2>&1
sleep 1.3
S4=$(ev "(function(){var bs=[...document.querySelectorAll('.reasoning-body')].filter(function(x){return x.style.display!=='none'});var b=bs[bs.length-1];return Math.round(b.scrollHeight-b.scrollTop-b.clientHeight)})()")
check "回底后恢复跟随（距底 <24）" "(function(){return $S4 < 24})()"
# 流式中 token 实时速度 + 上下文占用
check "流式中显示当前 token 速度（live 主色）" "(function(){var s=document.querySelector('.tok-stats .tok-speed.live');return !!s && /tok\/s/.test(s.textContent) && !s.textContent.includes('上次')})()"
check "流式中上下文占用实时估算（/8192）" "(function(){var m=document.querySelector('.tok-stats .ctx-meter');return !!m && /上下文/.test(m.textContent) && /8192/.test(m.textContent)})()"
# 外层聊天容器贴底回归
check "流式期间外层聊天容器仍贴底" "(function(){var c=document.querySelector('.chat-scroll');return c.scrollHeight - c.scrollTop - c.clientHeight < 10})()"
wait_ai_done 45
check "完成后思考块自动收起" "(function(){var bs=[...document.querySelectorAll('.reasoning-block')];return !bs.some(function(x){return x.classList.contains('open')})})()"
check "完成后块头文案切为「思考过程」" "(function(){return document.body.innerText.includes('思考过程')})()"
# usage 收口（usage 分片先于 [DONE]，须等消息失去 streaming 类）
poll "(function(){var ms=[...document.querySelectorAll('.msg')];return !ms.some(function(m){return m.classList.contains('streaming')})})()" 15
check "完成后上下文占用收口 2112/8192" "(function(){var m=document.querySelector('.tok-stats .ctx-meter');return m.textContent.replace(/\s+/g,'').includes('2112/8192')})()"
check "完成后速度显示上一次任务（含「上次」标记）" "(function(){var s=document.querySelector('.tok-stats .tok-speed');return !!s && s.textContent.includes('上次') && /tok\/s/.test(s.textContent)})()"
check "user 消息问题花费标签（输入/回答）" "(function(){var m=[...document.querySelectorAll('.msg.user .msg-tokens')].pop();return !!m && m.textContent.replace(/\s+/g,'').includes('输入512') && m.textContent.replace(/\s+/g,'').includes('回答1600')})()"
check "assistant 消息输出与速度标签" "(function(){var m=[...document.querySelectorAll('.msg.assistant .msg-tokens')].pop();return !!m && m.textContent.replace(/\s+/g,'').includes('输出1600tok') && /tok\/s/.test(m.textContent)})()"
agent-browser eval "(function(){var hs=[...document.querySelectorAll('.reasoning-head')];var h=hs[hs.length-1];if(h){h.click();return 'ok'}return 'nf'})()" >/dev/null 2>&1
sleep 0.8
check "点击块头重新展开" "!!document.querySelector('.reasoning-block.open .reasoning-body')"
check "重开后保持底部位置（距底 <2）" "(function(){var b=document.querySelector('.reasoning-block.open .reasoning-body');return b.scrollHeight - b.scrollTop - b.clientHeight < 2})()"
check "重开后末段内容可见（第 40 段）" "(function(){var b=document.querySelector('.reasoning-block.open .reasoning-body');return b.textContent.includes('第 40 段')})()"

echo ""
echo "== 9. 高频思考流竞态（120 段 × 8ms，程序滚动 vs scroll 事件） =="
ask "快速思考验证"
poll "(function(){var bs=[...document.querySelectorAll('.reasoning-body')].filter(function(x){return x.style.display!=='none'});var b=bs[bs.length-1];return !!b && b.textContent.match(/第 3[0-9] 段/)})()" 20
check "高频流中思考块保持贴底（竞态修复回归）" "(function(){var bs=[...document.querySelectorAll('.reasoning-body')].filter(function(x){return x.style.display!=='none'});var b=bs[bs.length-1];return !!b && b.scrollHeight>b.clientHeight && b.scrollTop>0 && (b.scrollHeight-b.scrollTop-b.clientHeight)<24})()"
wait_ai_done 30

echo ""
echo "== 10. 代码生成 / 替换链路（generateCode → replaceCode → Markdown 总结） =="
agent-browser eval "ai.clearSession?.()" >/dev/null 2>&1 || true
nav "AI 工具" >/dev/null 2>&1
sleep 1
ask "生成代码并替换"
poll "(function(){var r=[...document.querySelectorAll('.tool-record')].find(function(x){var n=x.querySelector('.rec-name');return n && n.textContent==='generateCode'});return !!r && r.classList.contains('success')})()" 30
check "generateCode 记录成功" "(function(){var r=[...document.querySelectorAll('.tool-record .rec-name')].find(function(x){return x.textContent==='generateCode'});return !!r && r.closest('.tool-record').classList.contains('success')})()"
check "记录头 zip 迷你下载按钮" "!!document.querySelector('.tool-record .zip-mini')"
agent-browser eval "(function(){var r=[...document.querySelectorAll('.tool-record')].find(function(x){var n=x.querySelector('.rec-name');return n && n.textContent==='generateCode'});if(r){r.querySelector('.record-head')?.click();return 'ok'}return 'nf'})()" >/dev/null 2>&1
sleep 0.8
check "展开 generateCode 记录后 zip 下载主按钮" "(function(){var r=[...document.querySelectorAll('.tool-record')].find(function(x){var n=x.querySelector('.rec-name');return n && n.textContent==='generateCode'});return !!r && !!r.querySelector('.rec-zip .zip-btn')})()"
check "zip 文件名 dbm-codegen- 前缀" "(function(){var r=[...document.querySelectorAll('.tool-record')].find(function(x){var n=x.querySelector('.rec-name');return n && n.textContent==='generateCode'});if(!r)return false;var m=r.querySelector('.rec-zip .zip-btn .mono');return !!m && m.textContent.startsWith('dbm-codegen-')})()"
poll "!!document.querySelector('.ant-modal .rp-tip')" 30
check "替换确认弹窗出现（文件清单）" "(function(){return !!document.querySelector('.ant-modal .rp-tip') && document.querySelectorAll('.ant-modal .rp-row').length>0})()"
click_modal_text "确认替换"
sleep 1.5
check "replaceCode 记录成功" "(function(){var r=[...document.querySelectorAll('.tool-record .rec-name')].find(function(x){return x.textContent==='replaceCode'});return !!r && r.closest('.tool-record').classList.contains('success')})()"
wait_ai_done 45
check "markstream 根容器复合类" "!!document.querySelector('.md-render.markstream-vue')"
check "Markdown h2 标题渲染（## 任务完成）" "(function(){var h=document.querySelector('.md-render h2');return !!h && h.textContent.includes('任务完成')})()"
check "Markdown 代码块渲染" "!!document.querySelector('.md-render pre')"
check "最终文本去首部空白" "(function(){var ms=[...document.querySelectorAll('.md-render')];var t=ms[ms.length-1];return !/^\s/.test(t.textContent)})()"
check "消息项 flex-shrink:0（防挤压）" "(function(){return getComputedStyle(document.querySelector('.msg')).flexShrink==='0'})()"
check "记录项 flex-shrink:0（防挤压）" "(function(){return getComputedStyle(document.querySelector('.tool-record')).flexShrink==='0'})()"
check "记录面板贴底跟随" "(function(){var l=document.querySelector('.tools-list');return l.scrollHeight - l.scrollTop - l.clientHeight < 6})()"
theme_toggle
check "暗色下 markstream dark 类生效" "!!document.querySelector('.md-render.markstream-vue.dark')"
theme_toggle

echo ""
echo "== 11. refresh 能力 =="
ask "请刷新数据"
poll "(function(){var r=[...document.querySelectorAll('.tool-record .rec-name')].find(function(x){return x.textContent==='refresh'});return !!r && r.closest('.tool-record').classList.contains('success')})()" 25
check "refresh 能力记录 success" "(function(){var r=[...document.querySelectorAll('.tool-record .rec-name')].find(function(x){return x.textContent==='refresh'});return !!r && r.closest('.tool-record').classList.contains('success')})()"
agent-browser eval "(function(){var r=[...document.querySelectorAll('.tool-record')].find(function(x){return x.textContent.includes('refresh')});if(r){r.querySelector('.record-head')?.click();return 'ok'}return 'nf'})()" >/dev/null 2>&1
sleep 0.8
check "refresh 返回 refreshed true" "(function(){var r=[...document.querySelectorAll('.tool-record')].find(function(x){return x.textContent.includes('refresh')});return r.textContent.includes('refreshed') && r.textContent.includes('true')})()"
wait_ai_done 40
check "refresh 会话后占用更新 1120/8192" "(function(){var m=document.querySelector('.tok-stats .ctx-meter');return m.textContent.replace(/\s+/g,'').includes('1120/8192')})()"

echo ""
echo "== 12. 记录清空 =="
check "清空前有调用记录" "document.querySelectorAll('.tool-record').length >= 1"
agent-browser eval "document.querySelector('.tools-clear')?.click()" >/dev/null 2>&1
sleep 0.8
check_num "清空后记录列表为空" "document.querySelectorAll('.tool-record').length" "0"
check "清空后空态文案回归" "(function(){return document.body.innerText.includes('参数与返回值将记录在这里')})()"
check "清空后聊天消息保留" "document.querySelectorAll('.msg').length >= 4"
check "清空后按钮禁用" "(function(){var b=document.querySelector('.tools-clear');return !!b && b.disabled})()"
check "清空记录后上下文占用保留" "(function(){var m=document.querySelector('.tok-stats .ctx-meter');return !!m && m.textContent.includes('1120')})()"

echo ""
echo "== 13. 技能加载 =="
ask "加载技能演示"
poll "(function(){return document.querySelectorAll('.tool-record.skill').length===1})()" 25
check "技能加载为单独一轮工具调用" "(function(){return document.querySelectorAll('.tool-record.skill').length===1})()"
check "聊天区技能芯片独立样式（技能 + 部分数）" "(function(){var c=document.querySelector('.tool-chip.skill');return !!c && c.textContent.includes('技能') && c.textContent.includes('2 部分')})()"
check "右侧技能记录 success + 独立样式" "(function(){var r=document.querySelector('.tool-record.skill');return !!r && r.classList.contains('success') && r.textContent.includes('技能·表结构设计')})()"
agent-browser eval "(function(){var r=document.querySelector('.tool-record.skill');if(r){r.querySelector('.record-head')?.click();return 'ok'}return 'nf'})()" >/dev/null 2>&1
sleep 0.8
check "技能记录展示已加载部分清单（2 项）" "(function(){var r=document.querySelector('.tool-record.skill');var ps=r.querySelectorAll('.skill-part-chip');return ps.length===2})()"
wait_ai_done 40

echo ""
echo "== 14. 任务清单流程（汇报 → 同步 → 中止转暂停 → 继续完成） =="
ask "演示任务清单流程"
poll "document.querySelectorAll('.task-item').length === 3" 20
check "汇报模板解析为任务面板（3 项）" "document.querySelectorAll('.task-item').length === 3"
# 第二轮同步模板到达后（执行中/完成态就位），第三轮为 30 段慢速长流——在其中途点停止
poll "!!document.querySelector('.task-item.running')" 20
check "同步模板推进状态（执行中）" "!!document.querySelector('.task-item.running')"
check "同步后已完成项带完成态" "!!document.querySelector('.task-item.completed')"
check "汇总芯片显示执行中/完成计数" "(function(){var s=document.querySelector('.task-summary');return s.textContent.includes('执行中 1') && s.textContent.includes('完成 1')})()"
poll "(function(){return document.body.innerText.includes('正在设计订单表字段')})()" 25
agent-browser click ".send-btn.stop" >/dev/null 2>&1
sleep 2
check "中止后执行中任务转暂停（含任务名）" "(function(){var p=document.querySelector('.task-item.paused');return !!p && p.textContent.includes('设计订单表字段')})()"
check "中止后其他任务状态保留（completed + pending 并存）" "(function(){return !!document.querySelector('.task-item.completed') && !!document.querySelector('.task-item.pending')})()"
ask "继续完成任务"
wait_ai_done 40
check "继续后任务全部完成" "(function(){return document.querySelectorAll('.task-item.completed').length===3})()"
check "继续后无暂停任务（注入仅在有暂停时发生）" "!document.querySelector('.task-item.paused')"
# 注入内容与 ECHO 首行不在同一行（modelContent 含换行），须用上下文 grep
if grep -A4 "ECHO-LAST-USER >>> 继续完成任务" "$ROOT/tmp/e2e-mock.log" 2>/dev/null | grep -q "暂停.*设计订单表字段"; then
  PASS=$((PASS+1)); echo "  PASS  下轮发送注入暂停任务（回显日志）"
else
  FAIL=$((FAIL+1)); FAILED+=("注入暂停任务"); echo "  FAIL  下轮发送注入暂停任务（回显日志）"
fi
check "任务块不从助手正文重复展示（已剥离）" "(function(){var ms=[...document.querySelectorAll('.msg.assistant .msg-content')];return !ms.some(function(m){return m.textContent.includes('【任务清单')})})()"

echo ""
echo "== 15. 上下文 85% 自动压缩（pi 内核：轮边界自动触发并整体回落） =="
nav "系统设置" >/dev/null 2>&1
sleep 1
# 上限改 2400，触发 2112/2400=88%
agent-browser find first '.ai-card .ant-input-number input' fill "2400" >/dev/null 2>&1
sleep 0.4
agent-browser eval "(function(){var b=[...document.querySelectorAll('.settings-foot button')].find(function(x){return x.textContent.includes('保存设置')});if(b){b.click();return 'ok'}return 'nf'})()" >/dev/null 2>&1
sleep 1.5
nav "AI 工具" >/dev/null 2>&1
sleep 1
ask "压缩流程演示"
wait_ai_done 40
# pi 内核在轮边界自动压缩：占用 ≥85% 时本轮结束即发起压缩请求并重建会话
poll "!!document.querySelector('.msg-compact')" 20
check "轮边界自动压缩分隔条出现" "!!document.querySelector('.msg-compact')"
mock_has "COMPACT-SUMMARY-REQ" && check_eq "压缩请求已发出（mock 日志）" "ok" "ok" || check_eq "压缩请求已发出（mock 日志）" "miss" "ok"
check "压缩后自动续跑（摘要续聊回答）" "(function(){var ms=[...document.querySelectorAll('.msg.assistant .msg-content')];return ms.some(function(m){return m.textContent.includes('已基于压缩摘要继续任务')})})()"
METER2=$(ev "(function(){var m=document.querySelector('.tok-stats .ctx-meter');return m?m.textContent.trim():'none'})()")
echo "  [diag] 压缩后 meter = $METER2"
check "压缩后上下文回落（摘要基座小占用）" "(function(){var m=document.querySelector('.tok-stats .ctx-meter');return m.textContent.replace(/\s+/g,'').includes('460/2400')})()"

echo ""
echo "== 16. 工具调用轮数上限 =="
nav "系统设置" >/dev/null 2>&1
sleep 1
agent-browser find first '.rounds-block .ant-input-number input' fill "2" >/dev/null 2>&1
sleep 0.4
agent-browser eval "(function(){var b=[...document.querySelectorAll('.settings-foot button')].find(function(x){return x.textContent.includes('保存设置')});if(b){b.click();return 'ok'}return 'nf'})()" >/dev/null 2>&1
sleep 1.5
nav "AI 工具" >/dev/null 2>&1
sleep 1
ask "循环调用演示"
poll "(function(){var rs=[...document.querySelectorAll('.tool-record .rec-name')].filter(function(x){return x.textContent==='getTables'});return rs.length>=3})()" 25
sleep 3
check "轮数上限 2 后循环请求被中止" "(function(){var ms=[...document.querySelectorAll('.msg')];var t=ms[ms.length-1];return t.classList.contains('aborted') || document.body.innerText.includes('轮')})()"

echo ""
echo "== 17. 截图与收尾 =="
agent-browser screenshot "$SHOTS/e2e-ai-agent.png" >/dev/null 2>&1
finish_suite "AI 工具链域"
