// Eta v4 API 冒烟测试
import { Eta } from 'eta'

console.log('=== Eta 构造与选项测试 ===')
const eta = new Eta({ useWith: true, autoEscape: false })
console.log('instance methods:', Object.getOwnPropertyNames(Object.getPrototypeOf(eta)))

const utils = {
  quote: (c, cond = true) => (cond ? `"${c}"` : String(c)),
  toCamelCase: (s) => String(s).replace(/_(\w)/g, (_, c) => c.toUpperCase()),
}

// 1. renderString + useWith（模板中直接用 context/utils，不带 it.）
const tpl = `Hello <%= context.name %>! utils: <%= utils.quote('abc') %>
<% if (context.flag) { %>FLAG_ON<% } %>`

try {
  const out = eta.renderString(tpl, { context: { name: 'world', flag: true }, utils })
  console.log('--- renderString+useWith 输出:\n' + JSON.stringify(out))
} catch (e) {
  console.error('renderString 失败:', e.message)
}

// 2. 注释标签 <%# ... %> 预处理
const tpl2 = `<%# 这是注释 %>\nvalue=<%= context.name %>`
const cleaned = tpl2.replace(/<%#[\s\S]*?%>/g, '')
console.log('--- 注释剥离后:', JSON.stringify(cleaned))

// 3. 赋值副作用（模板内修改 context）
const tpl3 = `<% context.fileName = utils.toCamelCase(context.tableName) + ".java"; %>class <%= context.fileName %>`
const ctx = { tableName: 'sys_user' }
const out3 = eta.renderString(tpl3, { context: ctx, utils })
console.log('--- 副作用测试 输出:', JSON.stringify(out3), 'fileName =', ctx.fileName)

// 4. autoEscape 检查（不应转义引号）
const out4 = eta.renderString(`<%= utils.quote("x") %>`, { utils })
console.log('--- autoEscape=false 输出:', JSON.stringify(out4))

// 5. autoTrim 行为
const etaTrim = new Eta({ useWith: true, autoEscape: false, autoTrim: 'nl' })
const tpl5 = `line1\n<% if (true) { %>\nline2\n<% } %>\nline3`
console.log('--- autoTrim=nl 输出:', JSON.stringify(etaTrim.renderString(tpl5, {})))
const etaNoTrim = new Eta({ useWith: true, autoEscape: false, autoTrim: false })
console.log('--- autoTrim=false 输出:', JSON.stringify(etaNoTrim.renderString(tpl5, {})))

console.log('=== 测试完成 ===')
