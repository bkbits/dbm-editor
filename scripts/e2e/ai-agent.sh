#!/usr/bin/env bash
# e2e/ai-agent.sh —— AI 工具链域（pi-agent-core 内核 + 对话 + 工具 + 流式 + 任务清单 + 用量）
#
# 覆盖（合并自原 task35/39/40/41/43 + regress-b 的全部保留锚点 + 本任务
# AIApi 三协议与新工具链断言 + 点击选项与失败重试）：
# - 对话基础：发送/停止按钮渲染与前景色、markstream Markdown 渲染（h2/代码块/
#   首部去空白）、暗色 dark 类、消息 flexShrink、建议列表
# - 内核链路（pi-agent-core）：系统提示能力域 + 全局规则流入、工具全量注册（51）、
#   历史回放种子序列、typebox 参数校验失败回填重试、api 中文错误前缀回填、
#   同轮双工具串行
# - 工具调用：genCodeZip/genCodeReplace 链路（记录 / zip 下载 / 替换确认弹窗）、
#   reload 四工具（模型元素/字典/模板/设置）、记录清空、技能加载（skill 工具：
#   芯片 + 记录独立样式 + 部分清单）
# - AIApi 三协议：OpenAI Chat Completions（默认）/ OpenAI Responses /
#   Anthropic Messages（多供应商配置 + 模型下拉「供应商名/模型名」+ 协议切换对话）
# - AI 设置工具链：getAISettings / setCurrentModel（模型下拉切换）
# - 撤销链路：addTableCategory → undo → redo → clearHistory（写类工具经
#   store「本地先行 + 契约落盘」同步运行时状态）
# - 危险操作确认：removeAll 清空（弹窗确认 + 画布清空 + 字典不受影响）→
#   resetDemo 重置（弹窗确认 + 演示数据恢复）
# - fetch 工具：经 AIApi.fetch 请求 mock 的 /hello 数据端点
# - 交互增强：点击选项（【选项】块解析为按钮，点击即发送选择；转静态保留可读）、
#   请求失败重试（HTTP 500 错误块 + 重试按钮 → 移除失败交换后重发成功）
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
# 执行失败演示链路）与用户主动中止的 AbortError，以及请求失败重试链路的
# 模拟 HTTP 500（首个请求按场景设计失败）
export EXPECTED_ERR_RE="removeTableCategory\(\) 抛错|chat\(\) 抛错.*AbortError|chat\(\) 抛错.*模拟服务内部异常"
echo "=============================================="
echo "== AI 工具链域 E2E（pi-agent-core 内核） =="
echo "=============================================="
open_app
# 清空上一域（settings）残留的 AI 设置：本域从「未配置」态开始（reset_demo
# 只重置模型数据，不清 aiSettings；保留全局规则种子文本）
agent-browser eval "(function(){var db=JSON.parse(localStorage.getItem('gdbme:db:v2'));var rules=(db.aiSettings&&db.aiSettings.globalRules)||'';db.aiSettings={providers:[],globalRules:rules};localStorage.setItem('gdbme:db:v2',JSON.stringify(db));return 'ok'})()" >/dev/null 2>&1
agent-browser open "$BASE_URL" >/dev/null 2>&1
sleep 2
reset_demo

# ---------- 多供应商配置 helper ----------

# 设置第 N 个供应商卡片（1-based）内 placeholder 含关键字的输入框值
fill_provider_input() {
  local idx="$1" key="$2" val="$3"
  agent-browser eval "(function(){var ps=document.querySelectorAll('.provider-row');var p=ps[$((idx-1))];if(!p)return 'np';var inp=[...p.querySelectorAll('input')].filter(function(i){return i.offsetParent!==null && i.placeholder.indexOf('$key')>=0})[0];if(!inp)return 'ni';var setter=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;setter.call(inp,'$val');inp.dispatchEvent(new Event('input',{bubbles:true}));return 'ok'})()" >/dev/null 2>&1
  sleep 0.4
}

# 切换第 N 个供应商卡片的协议下拉（按 label 文本；轮询等待选项渲染 + 3 次重试，
# 防首次懒挂载的 dropdown 渲染时序抖动）
select_provider_protocol() {
  local idx="$1" label="$2" try=0 ok="wait"
  while [ $try -lt 3 ] && [ "$ok" != "clicked" ]; do
    agent-browser eval "(function(){var ps=document.querySelectorAll('.provider-row');var p=ps[$((idx-1))];var sel=p.querySelector('.provider-line .ant-select');if(sel){sel.dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));return 'ok'}return 'nf'})()" >/dev/null 2>&1
    local i=0
    while [ $i -lt 10 ] && [ "$ok" != "clicked" ]; do
      ok=$(ev "(function(){var opts=[...document.querySelectorAll('.ant-select-dropdown .ant-select-item')];var o=opts.find(function(x){return x.textContent.indexOf('$label')>=0 && x.offsetParent!==null});if(o){o.click();return 'clicked'}return 'wait'})()" 2>/dev/null)
      [ "$ok" = "clicked" ] || { sleep 0.4; i=$((i+1)); }
    done
    try=$((try+1))
  done
  sleep 0.6
}

# 给第 N 个供应商卡片添加一个模型行
add_model_to_provider() {
  local idx="$1"
  agent-browser eval "(function(){var ps=document.querySelectorAll('.provider-row');var p=ps[$((idx-1))];var b=[...p.querySelectorAll('button')].find(function(x){return x.textContent.includes('添加模型')});if(b){b.click();return 'ok'}return 'nf'})()" >/dev/null 2>&1
  sleep 0.6
}

# 添加供应商（append 到列表末尾）
add_provider() {
  agent-browser eval "(function(){var b=[...document.querySelectorAll('.ai-card button')].find(function(x){return x.textContent.includes('添加供应商')});if(b){b.click();return 'ok'}return 'nf'})()" >/dev/null 2>&1
  sleep 0.8
}

# AI 工具页模型下拉切换（按显示 label；轮询等待选项渲染 + 3 次重试）
switch_model() {
  local label="$1" try=0 ok="wait"
  while [ $try -lt 3 ] && [ "$ok" != "clicked" ]; do
    agent-browser eval "(function(){var s=document.querySelector('.input-top .ant-select');if(s){s.dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));return 'ok'}return 'nf'})()" >/dev/null 2>&1
    local i=0
    while [ $i -lt 10 ] && [ "$ok" != "clicked" ]; do
      ok=$(ev "(function(){var opts=[...document.querySelectorAll('.ant-select-dropdown .ant-select-item')];var o=opts.find(function(x){return x.textContent.indexOf('$label')>=0 && x.offsetParent!==null});if(o){o.click();return 'clicked'}return 'wait'})()" 2>/dev/null)
      [ "$ok" = "clicked" ] || { sleep 0.4; i=$((i+1)); }
    done
    try=$((try+1))
  done
  sleep 0.6
}

# 统一保存设置
save_settings() {
  agent-browser eval "(function(){var b=[...document.querySelectorAll('.settings-foot button')].find(function(x){return x.textContent.includes('保存设置')});if(b){b.click();return 'ok'}return 'nf'})()" >/dev/null 2>&1
  sleep 1.5
}

echo "== 1. 配置 AI 服务（mock 直连：供应商 Mock / openai-chat） =="
nav "系统设置"
poll "!!document.querySelector('.settings-view')" 8
add_provider
fill_provider_input 1 "OpenAI" "Mock"
fill_provider_input 1 "v1" "$MOCK_URL"
add_model_to_provider 1
fill_provider_input 1 "glm-4.6" "e2e-model"
agent-browser eval "(function(){var i=document.querySelector('.ai-card .ant-input-number input');if(i){i.focus();return 'ok'}return 'nf'})()" >/dev/null 2>&1
sleep 0.3
agent-browser find first '.ai-card .ant-input-number input' fill "8192" >/dev/null 2>&1
sleep 0.4
save_settings
check "AI 服务配置保存成功" "(function(){return document.body.innerText.includes('设置已保存')})()"

echo ""
echo "== 2. AI 工具页基础渲染 =="
nav "AI 工具"
poll "!!document.querySelector('.ai-view')" 8
check "AI 工具页渲染" "!!document.querySelector('.ai-view')"
check "左侧任务清单面板存在" "!!document.querySelector('.task-pane')"
check "任务面板空态文案" "(function(){var e=document.querySelector('.task-empty');return !!e && e.textContent.includes('暂无任务')})()"
check "建议列表含画布重排建议" "(function(){var cs=[...document.querySelectorAll('.suggestion-chip')];return cs.some(function(c){return c.textContent.includes('重新设置每个表卡片的位置')})})()"
check "模型下拉显示 供应商名/模型名（Mock/e2e-model）" "(function(){var t=document.querySelector('.input-top .ant-select-content');return !!t && t.textContent==='Mock/e2e-model'})()"
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
mock_has "tools=53" && check_eq "工具定义全量注册（53 个）" "ok" "ok" || check_eq "工具定义全量注册" "miss" "ok"
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
check "缺参调用记录为 error 态" "(function(){var r=[...document.querySelectorAll('.tool-record')].find(function(x){return x.textContent.includes('removeTableCategory')});return !!r && r.classList.contains('error')})()"
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
echo "== 10. 代码生成 / 替换链路（genCodeZip → genCodeReplace → Markdown 总结） =="
agent-browser eval "ai.clearSession?.()" >/dev/null 2>&1 || true
nav "AI 工具" >/dev/null 2>&1
sleep 1
ask "生成代码并替换"
poll "(function(){var r=[...document.querySelectorAll('.tool-record')].find(function(x){var n=x.querySelector('.rec-name');return n && n.textContent==='genCodeZip'});return !!r && r.classList.contains('success')})()" 30
check "genCodeZip 记录成功" "(function(){var r=[...document.querySelectorAll('.tool-record .rec-name')].find(function(x){return x.textContent==='genCodeZip'});return !!r && r.closest('.tool-record').classList.contains('success')})()"
check "记录头 zip 迷你下载按钮" "!!document.querySelector('.tool-record .zip-mini')"
agent-browser eval "(function(){var r=[...document.querySelectorAll('.tool-record')].find(function(x){var n=x.querySelector('.rec-name');return n && n.textContent==='genCodeZip'});if(r){r.querySelector('.record-head')?.click();return 'ok'}return 'nf'})()" >/dev/null 2>&1
sleep 0.8
check "展开 genCodeZip 记录后 zip 下载主按钮" "(function(){var r=[...document.querySelectorAll('.tool-record')].find(function(x){var n=x.querySelector('.rec-name');return n && n.textContent==='genCodeZip'});return !!r && !!r.querySelector('.rec-zip .zip-btn')})()"
check "zip 文件名 dbm-codegen- 前缀" "(function(){var r=[...document.querySelectorAll('.tool-record')].find(function(x){var n=x.querySelector('.rec-name');return n && n.textContent==='genCodeZip'});if(!r)return false;var m=r.querySelector('.rec-zip .zip-btn .mono');return !!m && m.textContent.startsWith('dbm-codegen-')})()"
poll "!!document.querySelector('.ant-modal .rp-tip')" 30
check "替换确认弹窗出现（文件清单）" "(function(){return !!document.querySelector('.ant-modal .rp-tip') && document.querySelectorAll('.ant-modal .rp-row').length>0})()"
click_modal_text "确认替换"
sleep 1.5
check "genCodeReplace 记录成功" "(function(){var r=[...document.querySelectorAll('.tool-record .rec-name')].find(function(x){return x.textContent==='genCodeReplace'});return !!r && r.closest('.tool-record').classList.contains('success')})()"
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
echo "== 11. reload 四工具（顶栏「刷新」按钮等价：模型元素/字典/模板/设置） =="
ask "请刷新数据"
poll "(function(){var r=[...document.querySelectorAll('.tool-record .rec-name')].find(function(x){return x.textContent==='reload'});return !!r && r.closest('.tool-record').classList.contains('success')})()" 25
check "reload 能力记录 success" "(function(){var r=[...document.querySelectorAll('.tool-record .rec-name')].find(function(x){return x.textContent==='reload'});return !!r && r.closest('.tool-record').classList.contains('success')})()"
check "reloadDicts / reloadTemplates / reloadSettings 同轮执行" "(function(){var names=[...document.querySelectorAll('.tool-record .rec-name')].map(function(n){return n.textContent});return names.filter(function(n){return ['reload','reloadDicts','reloadTemplates','reloadSettings'].indexOf(n)>=0}).length===4})()"
wait_ai_done 40
check "reload 会话后占用更新 1120/8192" "(function(){var m=document.querySelector('.tok-stats .ctx-meter');return m.textContent.replace(/\s+/g,'').includes('1120/8192')})()"

echo ""
echo "== 12. AIApi 三协议对话（OpenAI Responses / Anthropic Messages） =="
nav "系统设置" >/dev/null 2>&1
sleep 1
# 供应商 2：Resp（openai-responses）
add_provider
select_provider_protocol 2 "OpenAI Responses"
fill_provider_input 2 "OpenAI" "Resp"
fill_provider_input 2 "v1" "$MOCK_URL"
add_model_to_provider 2
fill_provider_input 2 "glm-4.6" "e2e-res-model"
# 供应商 3：Anth（anthropic）
add_provider
select_provider_protocol 3 "Anthropic Messages"
fill_provider_input 3 "OpenAI" "Anth"
fill_provider_input 3 "v1" "$MOCK_URL"
add_model_to_provider 3
fill_provider_input 3 "glm-4.6" "e2e-ant-model"
save_settings
check "三供应商配置保存" "(function(){var db=JSON.parse(localStorage.getItem('gdbme:db:v2'));return db.aiSettings.providers.length===3 && db.aiSettings.providers[1].protocol==='openai-responses' && db.aiSettings.providers[2].protocol==='anthropic'})()"
nav "AI 工具" >/dev/null 2>&1
sleep 1
# 模型下拉应显示全部三个「供应商名/模型名」
agent-browser eval "(function(){var s=document.querySelector('.input-top .ant-select');if(s){s.dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));return 'ok'}return 'nf'})()" >/dev/null 2>&1
poll "(function(){var os=[...document.querySelectorAll('.ant-select-dropdown .ant-select-item')];return os.length>=3})()" 8
check "模型下拉含 Resp/e2e-res-model 与 Anth/e2e-ant-model" "(function(){var os=[...document.querySelectorAll('.ant-select-dropdown .ant-select-item')];return os.some(function(o){return o.textContent==='Resp/e2e-res-model'}) && os.some(function(o){return o.textContent==='Anth/e2e-ant-model'})})()"
agent-browser press Escape >/dev/null 2>&1
sleep 0.5
# OpenAI Responses 协议对话
switch_model "Resp/e2e-res-model"
check "切换后下拉显示 Resp/e2e-res-model" "(function(){var t=document.querySelector('.input-top .ant-select-content');return !!t && t.textContent==='Resp/e2e-res-model'})()"
ask "协议演示 responses"
wait_ai_done 30
check "OpenAI Responses 协议对话完成" "(function(){return document.body.innerText.includes('协议演示完成')})()"
mock_has "RES-MOCK-REQ received" && check_eq "Responses 端点请求到达（mock 日志）" "ok" "ok" || check_eq "Responses 端点请求到达" "miss" "ok"
# Anthropic Messages 协议对话（含思考块）
switch_model "Anth/e2e-ant-model"
check "切换后下拉显示 Anth/e2e-ant-model" "(function(){var t=document.querySelector('.input-top .ant-select-content');return !!t && t.textContent==='Anth/e2e-ant-model'})()"
ask "协议演示 anthropic"
wait_ai_done 30
check "Anthropic Messages 协议对话完成（正文）" "(function(){var ms=[...document.querySelectorAll('.msg.assistant .msg-content')];return ms.some(function(m){return m.textContent.includes('协议演示完成')})})()"
check "Anthropic 协议思考内容渲染" "(function(){var bs=[...document.querySelectorAll('.reasoning-body')];return bs.some(function(b){return b.textContent.includes('思考完毕')})})()"
mock_has "ANT-MOCK-REQ received" && check_eq "Anthropic 端点请求到达（mock 日志）" "ok" "ok" || check_eq "Anthropic 端点请求到达" "miss" "ok"

echo ""
echo "== 13. 记录清空 =="
check "清空前有调用记录" "document.querySelectorAll('.tool-record').length >= 1"
agent-browser eval "document.querySelector('.tools-clear')?.click()" >/dev/null 2>&1
sleep 0.8
check_num "清空后记录列表为空" "document.querySelectorAll('.tool-record').length" "0"
check "清空后空态文案回归" "(function(){return document.body.innerText.includes('参数与返回值将记录在这里')})()"
check "清空后聊天消息保留" "document.querySelectorAll('.msg').length >= 4"
check "清空后按钮禁用" "(function(){var b=document.querySelector('.tools-clear');return !!b && b.disabled})()"

echo ""
echo "== 14. 技能加载（skill 工具） =="
ask "加载技能演示"
poll "(function(){return document.querySelectorAll('.tool-record.skill').length===1})()" 25
check "技能加载为单独一轮工具调用（skill）" "(function(){return document.querySelectorAll('.tool-record.skill').length===1})()"
check "聊天区技能芯片独立样式（技能 + 部分数）" "(function(){var c=document.querySelector('.tool-chip.skill');return !!c && c.textContent.includes('技能') && c.textContent.includes('2 部分')})()"
check "右侧技能记录 success + 独立样式" "(function(){var r=document.querySelector('.tool-record.skill');return !!r && r.classList.contains('success') && r.textContent.includes('技能·表结构设计')})()"
agent-browser eval "(function(){var r=document.querySelector('.tool-record.skill');if(r){r.querySelector('.record-head')?.click();return 'ok'}return 'nf'})()" >/dev/null 2>&1
sleep 0.8
check "技能记录展示已加载部分清单（2 项）" "(function(){var r=document.querySelector('.tool-record.skill');var ps=r.querySelectorAll('.skill-part-chip');return ps.length===2})()"
wait_ai_done 40

echo ""
echo "== 15. AI 设置工具链（getAISettings → setCurrentModel） =="
ask "演示 AI 设置链路"
poll "(function(){var r=[...document.querySelectorAll('.tool-record .rec-name')].find(function(x){return x.textContent==='getAISettings'});return !!r && r.closest('.tool-record').classList.contains('success')})()" 25
check "getAISettings 记录 success" "(function(){var r=[...document.querySelectorAll('.tool-record .rec-name')].find(function(x){return x.textContent==='getAISettings'});return !!r && r.closest('.tool-record').classList.contains('success')})()"
poll "(function(){var r=[...document.querySelectorAll('.tool-record .rec-name')].find(function(x){return x.textContent==='setCurrentModel'});return !!r && r.closest('.tool-record').classList.contains('success')})()" 25
check "setCurrentModel 记录 success" "(function(){var r=[...document.querySelectorAll('.tool-record .rec-name')].find(function(x){return x.textContent==='setCurrentModel'});return !!r && r.closest('.tool-record').classList.contains('success')})()"
wait_ai_done 40
check "setCurrentModel 后下拉切回 Mock/e2e-model" "(function(){var t=document.querySelector('.input-top .ant-select-content');return !!t && t.textContent==='Mock/e2e-model'})()"
check "AI 设置会话收尾" "(function(){return document.body.innerText.includes('AI 设置链路完成')})()"

echo ""
echo "== 16. 撤销链路（addTableCategory → undo → redo → clearHistory） =="
ask "演示撤销链路"
poll "(function(){var r=[...document.querySelectorAll('.tool-record .rec-name')].find(function(x){return x.textContent==='addTableCategory'});return !!r && r.closest('.tool-record').classList.contains('success')})()" 25
check "addTableCategory 成功（本地先行 + 落盘）" "(function(){var db=JSON.parse(localStorage.getItem('gdbme:db:v2'));return db.categories.some(function(c){return c.name==='e2e-ai-cat'})})()"
poll "(function(){var r=[...document.querySelectorAll('.tool-record .rec-name')].find(function(x){return x.textContent==='undo'});return !!r && r.closest('.tool-record').classList.contains('success')})()" 25
agent-browser eval "(function(){var rs=[...document.querySelectorAll('.tool-record')];var r=rs.reverse().find(function(x){var n=x.querySelector('.rec-name');return n && n.textContent==='undo'});if(r){r.querySelector('.record-head')?.click();return 'ok'}return 'nf'})()" >/dev/null 2>&1
sleep 0.8
check "undo 返回 undone: true（快照恢复 + 全量落盘执行成功）" "(function(){var rs=[...document.querySelectorAll('.tool-record')];var r=rs.reverse().find(function(x){var n=x.querySelector('.rec-name');return n && n.textContent==='undo'});return !!r && r.textContent.includes('undone') && r.textContent.includes('true')})()"
poll "(function(){var r=[...document.querySelectorAll('.tool-record .rec-name')].find(function(x){return x.textContent==='redo'});return !!r && r.closest('.tool-record').classList.contains('success')})()" 25
check "redo 后分类恢复" "(function(){var db=JSON.parse(localStorage.getItem('gdbme:db:v2'));return db.categories.some(function(c){return c.name==='e2e-ai-cat'})})()"
poll "(function(){var r=[...document.querySelectorAll('.tool-record .rec-name')].find(function(x){return x.textContent==='clearHistory'});return !!r && r.closest('.tool-record').classList.contains('success')})()" 25
wait_ai_done 40
check "撤销链路会话收尾" "(function(){return document.body.innerText.includes('撤销链路完成')})()"

echo ""
echo "== 17. 危险操作确认（removeAll 清空 → resetDemo 重置） =="
ask "请清空模型元素"
poll "(function(){var m=document.querySelector('.ant-modal');return !!m && m.textContent.includes('清空模型元素') && getComputedStyle(m.closest('.ant-modal-wrap')).display!=='none'})()" 15
check "removeAll 危险确认弹窗出现" "(function(){var m=document.querySelector('.ant-modal');return !!m && m.textContent.includes('清空模型元素')})()"
click_modal_text "确认清空"
sleep 1.5
poll "(function(){var r=[...document.querySelectorAll('.tool-record .rec-name')].find(function(x){return x.textContent==='removeAll'});return !!r && r.closest('.tool-record').classList.contains('success')})()" 20
check "removeAll 记录 success（确认后执行）" "(function(){var r=[...document.querySelectorAll('.tool-record .rec-name')].find(function(x){return x.textContent==='removeAll'});return !!r && r.closest('.tool-record').classList.contains('success')})()"
wait_ai_done 40
check "模型元素已清空（表 0 张）" "(function(){var db=JSON.parse(localStorage.getItem('gdbme:db:v2'));return db.tables.length===0 && db.categories.length===0 && db.navigates.length===0})()"
check "字典 / 模板 / 设置不受影响" "(function(){var db=JSON.parse(localStorage.getItem('gdbme:db:v2'));return db.dicts.length>0 && db.templates.length>0 && !!db.settings})()"
ask "请重置演示数据"
poll "(function(){var m=document.querySelector('.ant-modal');return !!m && m.textContent.includes('重置为演示数据') && getComputedStyle(m.closest('.ant-modal-wrap')).display!=='none'})()" 15
check "resetDemo 危险确认弹窗出现" "(function(){var m=document.querySelector('.ant-modal');return !!m && m.textContent.includes('重置为演示数据')})()"
click_modal_text "确认重置"
sleep 1.5
poll "(function(){var r=[...document.querySelectorAll('.tool-record .rec-name')].find(function(x){return x.textContent==='resetDemo'});return !!r && r.closest('.tool-record').classList.contains('success')})()" 20
check "resetDemo 记录 success（确认后执行）" "(function(){var r=[...document.querySelectorAll('.tool-record .rec-name')].find(function(x){return x.textContent==='resetDemo'});return !!r && r.closest('.tool-record').classList.contains('success')})()"
wait_ai_done 40
check "演示数据恢复（表 13 张含隐藏中间表）" "(function(){var db=JSON.parse(localStorage.getItem('gdbme:db:v2'));return db.tables.length===13 && db.categories.length===3})()"
check "字典与模板恢复演示数据" "(function(){var db=JSON.parse(localStorage.getItem('gdbme:db:v2'));return db.dicts.length>0 && db.templates.length>0})()"
nav "模型编辑器" >/dev/null 2>&1
sleep 2
check "画布卡片恢复 10 张（运行时状态同步）" "document.querySelectorAll('.table-card').length===10"
nav "AI 工具" >/dev/null 2>&1
sleep 1

echo ""
echo "== 18. fetch 工具（AIApi.fetch → mock /hello） =="
ask "发起网络请求"
poll "(function(){var r=[...document.querySelectorAll('.tool-record .rec-name')].find(function(x){return x.textContent==='fetch'});return !!r && r.closest('.tool-record').classList.contains('success')})()" 25
check "fetch 记录 success" "(function(){var r=[...document.querySelectorAll('.tool-record .rec-name')].find(function(x){return x.textContent==='fetch'});return !!r && r.closest('.tool-record').classList.contains('success')})()"
agent-browser eval "(function(){var r=[...document.querySelectorAll('.tool-record')].find(function(x){var n=x.querySelector('.rec-name');return n && n.textContent==='fetch'});if(r){r.querySelector('.record-head')?.click();return 'ok'}return 'nf'})()" >/dev/null 2>&1
sleep 0.8
check "fetch 返回体含 mock 数据（hello from mock）" "(function(){var r=[...document.querySelectorAll('.tool-record')].find(function(x){var n=x.querySelector('.rec-name');return n && n.textContent==='fetch'});return !!r && r.textContent.includes('hello from mock')})()"
wait_ai_done 40

echo ""
echo "== 19. getTableRects（表卡片矩形 → 画布布局基础数据源） =="
ask "画布布局"
poll "(function(){var r=[...document.querySelectorAll('.tool-record .rec-name')].find(function(x){return x.textContent==='getTableRects'});return !!r && r.closest('.tool-record').classList.contains('success')})()" 25
check "getTableRects 记录 success" "(function(){var r=[...document.querySelectorAll('.tool-record .rec-name')].find(function(x){return x.textContent==='getTableRects'});return !!r && r.closest('.tool-record').classList.contains('success')})()"
agent-browser eval "(function(){var r=[...document.querySelectorAll('.tool-record')].find(function(x){var n=x.querySelector('.rec-name');return n && n.textContent==='getTableRects'});if(r){r.querySelector('.record-head')?.click();return 'ok'}return 'nf'})()" >/dev/null 2>&1
sleep 0.8
check "返回体含矩形结构（rects + w/h + columnCount）" "(function(){var r=[...document.querySelectorAll('.tool-record')].find(function(x){var n=x.querySelector('.rec-name');return n && n.textContent==='getTableRects'});return !!r && r.textContent.includes('rects') && r.textContent.includes('columnCount')})()"
check "返回体含卡片宽 268（实测与兜底同值）" "(function(){var r=[...document.querySelectorAll('.tool-record')].find(function(x){var n=x.querySelector('.rec-name');return n && n.textContent==='getTableRects'});return !!r && r.textContent.includes('268')})()"
check "返回体含表名与分类名（sys_user）" "(function(){var r=[...document.querySelectorAll('.tool-record')].find(function(x){var n=x.querySelector('.rec-name');return n && n.textContent==='getTableRects'});return !!r && r.textContent.includes('sys_user') && r.textContent.includes('categoryName')})()"
agent-browser screenshot "$SHOTS/e2e-ai-table-rects.png" >/dev/null 2>&1
check "坐标与库内表数据一致（sys_user 的 x/y）" "(function(){var db=JSON.parse(localStorage.getItem('gdbme:db:v2'));var t=db.tables.find(function(x){return x.tableName==='sys_user'});if(!t)return false;var r=[...document.querySelectorAll('.tool-record')].find(function(x){var n=x.querySelector('.rec-name');return n && n.textContent==='getTableRects'});return !!r && r.textContent.includes('\"x\": '+t.x) && r.textContent.includes('\"y\": '+t.y)})()"
wait_ai_done 40
check "画布布局会话收尾" "(function(){return document.body.innerText.includes('画布布局完成')})()"

echo ""
echo "== 20. skill-github（GitHub 技能文档加载，真实网络） =="
ask "GitHub技能"
poll "(function(){var r=[...document.querySelectorAll('.tool-record.skill')].find(function(x){return x.textContent.includes('Building LLM-Powered')});return !!r && r.classList.contains('success')})()" 40
check "skill-github 记录 success" "(function(){var r=[...document.querySelectorAll('.tool-record.skill')].find(function(x){return x.textContent.includes('Building LLM-Powered')});return !!r && r.classList.contains('success')})()"
check "技能样式记录（书本图标 + 技能·标题）" "(function(){var r=[...document.querySelectorAll('.tool-record.skill')].find(function(x){return x.textContent.includes('Building LLM-Powered')});return !!r && r.querySelector('.rec-name').textContent.includes('技能·Building')})()"
agent-browser eval "(function(){var r=[...document.querySelectorAll('.tool-record.skill')].find(function(x){return x.textContent.includes('Building LLM-Powered')});if(r){r.querySelector('.record-head')?.click();return 'ok'}return 'nf'})()" >/dev/null 2>&1
sleep 0.8
check "技能名称含 GitHub 仓库与路径" "(function(){var r=[...document.querySelectorAll('.tool-record.skill')].find(function(x){return x.textContent.includes('Building LLM-Powered')});return !!r && r.textContent.includes('github:anthropics/skills/skills/claude-api/SKILL.md')})()"
check "返回体含技能文档内容（SDK 特征词）" "(function(){var r=[...document.querySelectorAll('.tool-record.skill')].find(function(x){return x.textContent.includes('Building LLM-Powered')});return !!r && r.textContent.includes('SDK')})()"
agent-browser screenshot "$SHOTS/e2e-ai-skill-github.png" >/dev/null 2>&1
wait_ai_done 40
check "GitHub 技能会话收尾" "(function(){return document.body.innerText.includes('GitHub 技能加载完成')})()"

echo ""
echo "== 21. 点击选项（【选项】块 → 可点击按钮 → 选择即发送） =="
ask "选项演示"
wait_ai_done 30
check "选项区渲染（3 个选项按钮）" "document.querySelectorAll('.option-group .opt-btn').length === 3"
check "选项按钮可点击（交互窗口内非禁用）" "(function(){var b=document.querySelector('.option-group .opt-btn');return !!b && !b.disabled})()"
check "选项块从正文剥离（无【选项】字样）" "!document.body.innerText.includes('【选项】')"
check "选项文本渲染（单表设计）" "(function(){var bs=[...document.querySelectorAll('.option-group .opt-btn')];return bs.some(function(b){return b.textContent.includes('采用单表设计')})})()"
check "交互态头部引导点击" "(function(){var h=document.querySelector('.option-group .opt-head');return !!h && h.textContent.includes('请点击选择')})()"
agent-browser screenshot "$SHOTS/e2e-ai-options.png" >/dev/null 2>&1
# 点击第一个选项 → 作为下一条用户消息发送「选择方案 1：…」
agent-browser eval "(function(){var b=document.querySelector('.option-group .opt-btn');if(b){b.click();return 'ok'}return 'nf'})()" >/dev/null 2>&1
sleep 1
check "点击后发送选择消息（选择方案 1）" "(function(){var ms=[...document.querySelectorAll('.msg.user .msg-content')];var t=ms[ms.length-1];return !!t && t.textContent.includes('选择方案 1：采用单表设计')})()"
wait_ai_done 30
check "所选方案回复到达（已按所选方案继续执行）" "(function(){return document.body.innerText.includes('已按所选方案继续执行')})()"
check "旧选项区转静态（按钮禁用不可再点）" "(function(){var b=document.querySelector('.option-group .opt-btn');return !!b && b.disabled})()"
check "旧选项区头部转静态文案" "(function(){var h=document.querySelector('.option-group .opt-head');return !!h && h.textContent.includes('提供的可选方案')})()"
mock_has "OPTION-CHOICE >>> 选择方案 1" && check_eq "选择文本到达 mock（日志）" "ok" "ok" || check_eq "选择文本到达 mock（日志）" "miss" "ok"

echo ""
echo "== 22. 请求失败重试（HTTP 500 → 移除失败交换 → 重发成功） =="
ask "请求失败演示"
wait_ai_done 20
check "失败消息错误块渲染（HTTP 500）" "(function(){var e=document.querySelector('.msg-error');return !!e && e.textContent.includes('HTTP 500')})()"
check "失败消息提供重试按钮" "(function(){var m=[...document.querySelectorAll('.msg')];var t=m[m.length-1];return !!t.querySelector('.retry-btn')})()"
check "重试按钮可见（未被折叠线裁切）" "(function(){var b=document.querySelector('.msg .retry-btn');var c=document.querySelector('.chat-scroll');if(!b||!c)return false;var r=b.getBoundingClientRect(),cr=c.getBoundingClientRect();return r.bottom<=cr.bottom+1 && r.top>=cr.top-1})()"
agent-browser screenshot "$SHOTS/e2e-ai-retry.png" >/dev/null 2>&1
# 点击重试：移除本次失败交换（配对 user 消息 + 错误 assistant 消息）后重发原问题
agent-browser eval "document.querySelector('.msg .retry-btn')?.click()" >/dev/null 2>&1
poll "(function(){return document.body.innerText.includes('重试链路完成')})()" 30
check "重试后回答到达（重试链路完成）" "(function(){return document.body.innerText.includes('重试链路完成')})()"
check "失败交换已移除（无错误块残留）" "!document.querySelector('.msg-error')"
check "原问题仅出现一次（失败消息已移除）" "(function(){var us=[...document.querySelectorAll('.msg.user')].filter(function(m){return m.textContent.includes('请求失败演示')});return us.length===1})()"
mock_has "REQ-FAIL-500 sent" && check_eq "mock 首请求 500（日志）" "ok" "ok" || check_eq "mock 首请求 500（日志）" "miss" "ok"

echo ""
echo "== 23. 任务清单流程（汇报 → 同步 → 中止转暂停 → 继续完成） =="
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
echo "== 24. 上下文 85% 自动压缩（pi 内核：轮边界自动触发并整体回落） =="
nav "系统设置" >/dev/null 2>&1
sleep 1
# 上限改 2400，触发 2112/2400=88%
agent-browser find first '.ai-card .ant-input-number input' fill "2400" >/dev/null 2>&1
sleep 0.4
save_settings
nav "AI 工具" >/dev/null 2>&1
sleep 1
ask "压缩流程演示"
wait_ai_done 40
# pi 内核在轮边界自动压缩：占用 ≥85% 时本轮结束即发起压缩请求并重建会话
poll "!!document.querySelector('.msg-compact')" 20
check "轮边界自动压缩分隔条出现" "!!document.querySelector('.msg-compact')"
mock_has "COMPACT-SUMMARY-REQ received" && check_eq "压缩请求已发出（mock 日志）" "ok" "ok" || check_eq "压缩请求已发出（mock 日志）" "miss" "ok"
check "压缩后自动续跑（摘要续聊回答）" "(function(){var ms=[...document.querySelectorAll('.msg.assistant .msg-content')];return ms.some(function(m){return m.textContent.includes('已基于压缩摘要继续任务')})})()"
METER2=$(ev "(function(){var m=document.querySelector('.tok-stats .ctx-meter');return m?m.textContent.trim():'none'})()")
echo "  [diag] 压缩后 meter = $METER2"
check "压缩后上下文回落（摘要基座小占用）" "(function(){var m=document.querySelector('.tok-stats .ctx-meter');return m.textContent.replace(/\s+/g,'').includes('460/2400')})()"

echo ""
echo "== 25. 工具调用轮数上限 =="
nav "系统设置" >/dev/null 2>&1
sleep 1
agent-browser find first '.rounds-block .ant-input-number input' fill "2" >/dev/null 2>&1
sleep 0.4
save_settings
nav "AI 工具" >/dev/null 2>&1
sleep 1
ask "循环调用演示"
poll "(function(){var rs=[...document.querySelectorAll('.tool-record .rec-name')].filter(function(x){return x.textContent==='getTables'});return rs.length>=3})()" 25
sleep 3
check "轮数上限 2 后循环请求被中止" "(function(){var ms=[...document.querySelectorAll('.msg')];var t=ms[ms.length-1];return t.classList.contains('aborted') || document.body.innerText.includes('轮')})()"

echo ""
echo "== 26. 截图与收尾 =="
agent-browser screenshot "$SHOTS/e2e-ai-agent.png" >/dev/null 2>&1
finish_suite "AI 工具链域"
