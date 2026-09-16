/**
 * AI 思考块滚动跟随 / token 用量 / 任务清单 / 技能加载 / 上下文压缩 E2E 模拟服务器：
 * openai compatible /v1/chat/completions 流式接口（SSE）
 *
 * 按最后一条 user 消息内容分支（压缩请求优先识别）：
 * - 压缩请求（无 tools 且 system 含「压缩器」）：返回固定摘要（上下文自动压缩链路）
 * - 含「上下文压缩」（压缩后的主请求）：短回答收尾
 * - 含「刷新」：第一轮 tool_calls(refresh) → [DONE]；收到 tool 结果后第二轮总结（带 usage）
 * - 含「任务清单」：汇报模板 + getTables → 同步模板（执行中）+ getTables →
 *   慢速长流（供 E2E 中止 → 暂停态验证）
 * - 含「继续」：回显分支——记录收到的最后一条 user 消息全文到日志（验证暂停任务注入），短回答
 * - 含「技能」：第一轮 tool_calls(loadSkill: table-design / conventions+indexes) → 第二轮总结
 * - 含「压缩」：两轮（getTables → 收尾，usage total 2112 / 配 2400 上限触发自动压缩）
 * - 含「循环」：永远返回 getTables 工具调用（轮数上限中止验证）
 * - 含「快速思考」：80 段 × 8ms 高频思考流（验证程序滚动与 scroll 事件竞态下的贴底跟随）
 * - 其他：单轮超长 reasoning 流（40 段 × 500ms，思考块内部滚动）→ 短正文，无工具调用
 *
 * 每轮末尾均发送 openai 标准 usage 分片（stream_options.include_usage 的响应形态）。
 * 每个请求打印 messages 数量与最后一条 user 消息（截断），供 E2E 日志断言。
 *
 * 用法：node scripts/ai-sse-mock-scroll.mjs [port=4834]
 */
import http from 'node:http'

const port = Number(process.argv[2]) || 4834

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

/** 逐事件下发（最后一个事件为 usage 分片，choices 为空数组——openai include_usage 形态） */
function sse(res, events, interval, done) {
  res.writeHead(200, {
    ...CORS,
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  })
  let i = 0
  const tick = () => {
    if (i < events.length) {
      res.write(`data: ${JSON.stringify(events[i++])}\n\n`)
      setTimeout(tick, interval)
    } else {
      res.write('data: [DONE]\n\n')
      res.end()
      done?.()
    }
  }
  tick()
}

/** 组一段流事件 */
const delta = (d) => ({ choices: [{ delta: d }] })
const finish = (reason) => ({ choices: [{ delta: {}, finish_reason: reason }] })
const usageChunk = (p, c, t) => ({
  choices: [],
  usage: { prompt_tokens: p, completion_tokens: c, total_tokens: t },
})
const toolCall = (id, name, args) => ({
  choices: [
    {
      delta: { tool_calls: [{ index: 0, id, function: { name, arguments: args } }] },
      finish_reason: null,
    },
  ],
})

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS)
    res.end()
    return
  }
  if (req.method !== 'POST' || !req.url.includes('/chat/completions')) {
    res.writeHead(404, CORS)
    res.end('not found')
    return
  }
  let body = ''
  req.on('data', (c) => (body += c))
  req.on('end', () => {
    let parsed = {}
    try {
      parsed = JSON.parse(body)
    } catch {
      /* ignore */
    }
    const msgs = parsed.messages || []
    const toolCount = msgs.filter((m) => m.role === 'tool').length
    const lastUser = [...msgs].reverse().find((m) => m.role === 'user')
    const lastUserText = String(lastUser?.content || '')
    // 分支匹配基准：剥离界面注入的「暂停任务同步」块（在用户正文之后追加，含【任务清单】字样会污染分支）
    const userBase = lastUserText.split('\n\n【任务清单·同步】上轮任务被用户中止')[0]
    const sysText = String(msgs.find((m) => m.role === 'system')?.content || '')
    // sys-rules：系统提示是否携带用户全局规则块（默认任务流程文本流入验证）
    console.log(
      `ock-scroll] model=${parsed.model} msgs=${msgs.length} toolResults=${toolCount} sysRules=${sysText.includes('【全局规则】')} sysRulesFlow=${sysText.includes('# 任务流程:')} lastUser=${lastUserText.slice(0, 80).replace(/\n/g, '\\n')}`,
    )

    /* ---------- 压缩请求（无 tools 且 system 含压缩器） ---------- */
    if (!parsed.tools?.length && sysText.includes('压缩器')) {
      console.log('ock-scroll] COMPACT-SUMMARY-REQ received')
      sse(
        res,
        [
          delta({ role: 'assistant' }),
          delta({
            content:
              '- 任务：设计订单相关表结构\n- 已完成：查询现有表结构\n- 任务清单最新状态：设计订单表字段（执行中）\n- 待办：建立导航关系',
          }),
          finish('stop'),
          usageChunk(600, 80, 680),
        ],
        40,
        () => console.log('ock-scroll] compact summary done'),
      )
      return
    }

    /* ---------- 压缩后的主请求（仅紧随压缩的轮次命中；后续请求历史里始终带摘要，不能误判）。
    旧内核压缩重建会吞掉当轮新用户消息（请求仅 [system, 摘要]）；pi-agent-core 内核
    在摘要基座之上保留当轮新问题（[system, 摘要, 新问题]），模型可同时看到两者 ---------- */
    if (parsed.messages) {
      const msgs = parsed.messages
      const lastMsg = msgs[msgs.length - 1]
      const isCompactSummary = (m) =>
        !!m && m.role === 'user' && String(m.content || '').includes('【上下文压缩】')
      // 末条为新问题且其前一条为摘要 → 发送前压缩后的首请求
      // 末条即摘要且紧随 system → 轮边界压缩后的续聊轮请求
      const isAfterCompact =
        lastMsg && lastMsg.role === 'user'
          ? isCompactSummary(msgs[msgs.length - 2])
          : msgs.length === 2 && msgs[0]?.role === 'system' && isCompactSummary(msgs[1])
      if (isAfterCompact) {
        sse(
          res,
          [
            delta({ role: 'assistant' }),
            delta({ content: '已基于压缩摘要继续任务，全部完成。' }),
            finish('stop'),
            usageChunk(420, 40, 460),
          ],
          40,
          () => console.log('ock-scroll] after-compact final done'),
        )
        return
      }
    }

    const wantsRefresh = userBase.includes('刷新')
    const wantsTasks = userBase.includes('任务清单')
    const wantsEcho = userBase.includes('继续')
    const wantsSkill = userBase.includes('技能')
    const wantsCompactFlow = userBase.includes('压缩')
    const wantsLoop = userBase.includes('循环')
    const wantsFast = userBase.includes('快速思考')

    if (wantsTasks && toolCount === 0) {
      // 任务清单流程第一轮：汇报模板 + getTables
      sse(
        res,
        [
          delta({ role: 'assistant' }),
          delta({
            content:
              '我来规划这个任务：\n\n【任务清单·汇报】\n1. [未开始] 查询现有表结构\n2. [未开始] 设计订单表字段\n3. [未开始] 建立导航关系',
          }),
          toolCall('call_e2e_t1', 'getTables', '{}'),
          finish('tool_calls'),
          usageChunk(512, 96, 608),
        ],
        60,
        () => console.log('ock-scroll] tasks round 1 done'),
      )
    } else if (wantsTasks && toolCount === 1) {
      // 任务清单流程第二轮：同步模板（执行中）+ getTables
      sse(
        res,
        [
          delta({ role: 'assistant' }),
          delta({
            content:
              '第一步已完成，正在设计字段。\n\n【任务清单·同步】\n1. [已完成] 查询现有表结构\n2. [执行中] 设计订单表字段\n3. [未开始] 建立导航关系',
          }),
          toolCall('call_e2e_t2', 'getTables', '{}'),
          finish('tool_calls'),
          usageChunk(640, 80, 720),
        ],
        60,
        () => console.log('ock-scroll] tasks round 2 done'),
      )
    } else if (wantsTasks) {
      // 任务清单流程第三轮：慢速长流（E2E 在此期间点停止 → 执行中任务转暂停）
      const events = [delta({ role: 'assistant' })]
      for (let i = 0; i < 30; i++) {
        events.push(
          delta({
            content: `正在设计订单表字段（${i + 1}/30）：逐一确定列名、类型、非空与注释，并核对字典关联与索引布局。\n`,
          }),
        )
      }
      events.push(finish('stop'), usageChunk(700, 120, 820))
      sse(res, events, 400, () => console.log('ock-scroll] tasks round 3 done'))
    } else if (wantsEcho) {
      // 回显分支：日志记录收到的完整 user 消息（验证暂停任务注入）；
      // 回复含同步模板——把全部任务置为已完成（验证恢复流程，且后续请求不再携带注入块）
      console.log(`ock-scroll] ECHO-LAST-USER >>> ${lastUserText.replace(/\n/g, '\\n')}`)
      sse(
        res,
        [
          delta({ role: 'assistant' }),
          delta({
            content:
              '已继续完成暂停的任务，全部完成。\n\n【任务清单·同步】\n1. [已完成] 查询现有表结构\n2. [已完成] 设计订单表字段\n3. [已完成] 建立导航关系',
          }),
          finish('stop'),
          usageChunk(500, 40, 540),
        ],
        40,
        () => console.log('ock-scroll] echo done'),
      )
    } else if (wantsSkill && toolCount === 0) {
      // 技能加载第一轮：loadSkill(table-design: conventions + indexes)
      sse(
        res,
        [
          delta({ role: 'assistant' }),
          delta({ reasoning_content: '需要先加载表结构设计技能的约定与索引部分。' }),
          toolCall(
            'call_e2e_skill',
            'loadSkill',
            JSON.stringify({ skill: 'table-design', parts: ['conventions', 'indexes'] }),
          ),
          finish('tool_calls'),
          usageChunk(300, 40, 340),
        ],
        60,
        () => console.log('ock-scroll] skill round 1 done'),
      )
    } else if (wantsSkill) {
      // 技能加载第二轮：总结
      sse(
        res,
        [
          delta({ role: 'assistant' }),
          delta({ content: '已按表结构设计技能的规范完成设计。' }),
          finish('stop'),
          usageChunk(420, 50, 470),
        ],
        40,
        () => console.log('ock-scroll] skill round 2 done'),
      )
    } else if (wantsCompactFlow && toolCount === 0) {
      // 压缩触发流程第一轮：getTables（usage total 2112 / 上限 2400 = 88%）
      sse(
        res,
        [
          delta({ role: 'assistant' }),
          delta({ content: '开始处理压缩演示任务。' }),
          toolCall('call_e2e_c1', 'getTables', '{}'),
          finish('tool_calls'),
          usageChunk(1800, 312, 2112),
        ],
        60,
        () => console.log('ock-scroll] compact-flow round 1 done'),
      )
    } else if (wantsCompactFlow) {
      // 压缩触发流程第二轮：收尾（此后下一条消息将触发自动压缩）
      sse(
        res,
        [
          delta({ role: 'assistant' }),
          delta({ content: '压缩流程演示第一步完成。' }),
          finish('stop'),
          usageChunk(1900, 212, 2112),
        ],
        40,
        () => console.log('ock-scroll] compact-flow round 2 done'),
      )
    } else if (wantsLoop) {
      // 循环分支：永远工具调用不收尾（轮数上限中止验证）
      sse(
        res,
        [
          delta({ role: 'assistant' }),
          toolCall(`call_e2e_loop_${toolCount}`, 'getTables', '{}'),
          finish('tool_calls'),
          usageChunk(100, 20, 120),
        ],
        40,
        () => console.log('ock-scroll] loop round done'),
      )
    } else if (wantsFast) {
      // 快速思考：120 段 × 8ms 高频流（思考块程序滚动 vs scroll 事件竞态验证）
      const events = [delta({ role: 'assistant' })]
      for (let i = 0; i < 120; i++) {
        events.push(
          delta({
            reasoning_content: `第 ${String(i + 1).padStart(2, '0')} 段：高频思考分片测试，验证内容快速增长时思考块仍保持贴底跟随，这一段输出足够长以便产生明显的滚动位移与布局增长。\n`,
          }),
        )
      }
      events.push(delta({ content: '快速思考完成。' }), finish('stop'), usageChunk(400, 600, 1000))
      sse(res, events, 8, () => console.log('ock-scroll] fast stream done'))
    } else if (wantsRefresh && toolCount === 0) {
      // 刷新分支第一轮：思考 + refresh 工具调用
      sse(
        res,
        [
          delta({ role: 'assistant' }),
          {
            choices: [
              { delta: { reasoning_content: '用户要求刷新，调用 refresh 工具重新加载数据。' } },
            ],
          },
          toolCall('call_e2e_refresh', 'refresh', '{}'),
          finish('tool_calls'),
          usageChunk(256, 64, 320),
        ],
        60,
        () => console.log('ock-scroll] refresh round 1 done'),
      )
    } else if (wantsRefresh) {
      // 刷新分支第二轮：总结
      sse(
        res,
        [
          delta({ role: 'assistant' }),
          {
            choices: [{ delta: { content: '已刷新全部数据：画布、字典、模板与设置均已是最新。' } }],
          },
          finish('stop'),
          usageChunk(1024, 96, 1120),
        ],
        40,
        () => console.log('ock-scroll] refresh round 2 done'),
      )
    } else {
      // 普通分支：超长思考流（40 段 × 500ms）
      const events = [delta({ role: 'assistant' })]
      for (let i = 0; i < 40; i++) {
        events.push(
          delta({
            reasoning_content: `第 ${String(i + 1).padStart(2, '0')} 段：正在分析数据库模型的整体结构，逐表核对字段约定与索引设置，评估逻辑删除标记与审计字段的覆盖情况，输出这段较长的思考文本用于验证思考块内部的滚动跟随行为。\n`,
          }),
        )
      }
      events.push(
        delta({ content: '思考与验证已完成。' }),
        finish('stop'),
        usageChunk(512, 1600, 2112),
      )
      sse(res, events, 500, () => console.log('ock-scroll] stream done'))
    }
  })
})

server.listen(port, () => {
  console.log(`ock-scroll] openai compatible SSE server at http://localhost:${port}/v1`)
})
