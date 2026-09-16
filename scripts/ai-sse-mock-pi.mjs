/**
 * Task 43 E2E 模拟服务器：pi-agent-core 内核专项验证分支
 * openai compatible /v1/chat/completions 流式接口（SSE）
 *
 * 按最后一条 user 消息内容分支；轮次 = 最后一条 user 消息之后的 tool 结果数
 * （会话历史中的旧 tool 结果不计入——多个场景连续发送不会互相污染分支）：
 * - 含「参数校验」：第一轮 tool_calls(removeCategory 缺必填 categoryId → pi typebox
 *   schema 校验失败，英文 Validation failed) → 第二轮 tool_calls(getSettings 合法) →
 *   第三轮总结（验证 pi 参数校验：失败转错误工具结果回填模型，会话不中断）
 * - 含「执行失败」：第一轮 tool_calls(removeCategory cat-system 持有表 → api 抛中文错误
 *   「分类下仍有 N 张表」) → 第二轮总结（错误结果文本带「工具执行失败：」前缀回填模型——日志验证）
 * - 含「双工具」：单轮两个 tool_calls（getSettings + getTables 并列）
 *   → 第二轮总结（验证串行执行顺序与结果回填）
 * - 含「历史回放」：直接总结，同时把收到的消息结构写入日志（角色序列）
 *   （E2E 发两次，第二次断言首问的 assistant/tool 消息进入请求序列）
 *
 * 每个请求打印：messages 角色序列 + 全部 tool 结果内容（截断）——供日志断言。
 * 用法：node scripts/ai-sse-mock-pi.mjs [port=4835]
 */
import http from 'node:http'

const port = Number(process.argv[2]) || 4835

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

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

const delta = (d) => ({ choices: [{ delta: d }] })
const finish = (reason) => ({ choices: [{ delta: {}, finish_reason: reason }] })
const usageChunk = (p, c, t) => ({
  choices: [],
  usage: { prompt_tokens: p, completion_tokens: c, total_tokens: t },
})
const toolCall = (id, name, args, index = 0) => ({
  choices: [
    {
      delta: {
        tool_calls: [{ index, id, function: { name, arguments: JSON.stringify(args) } }],
      },
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
    const roles = msgs.map((m) => m.role).join(',')
    // 本轮次序号：最后一条 user 消息之后的 tool 结果数（历史旧结果不计数，防跨场景污染）
    const lastUserIdx = msgs.map((m) => m.role).lastIndexOf('user')
    const roundTools = msgs.filter((m, i) => m.role === 'tool' && i > lastUserIdx).length
    const toolResults = msgs.filter((m) => m.role === 'tool')
    const toolResultTexts = toolResults
      .map((m) =>
        String(m.content || '')
          .replace(/\n/g, '\\n')
          .slice(0, 120),
      )
      .join(' ||| ')
    const lastUser = [...msgs].reverse().find((m) => m.role === 'user')?.content || ''
    const userBase = String(lastUser).split('\n')[0]
    const sysText = String(msgs.find((m) => m.role === 'system')?.content || '')
    console.log(
      `[pi-mock] roles=[${roles}] tools=${(parsed.tools || []).length} toolResults=${toolResults.length} round=${roundTools}`,
    )
    if (toolResultTexts) console.log(`[pi-mock] tool-result-text: ${toolResultTexts}`)
    console.log(
      `[pi-mock] sys-has-capability=${sysText.includes('能力域')} lastUser=${userBase.slice(0, 40)}`,
    )

    /* ---------- 参数校验分支（轮次以 round 计） ---------- */
    if (userBase.includes('参数校验')) {
      if (roundTools === 0) {
        // 第一轮：removeCategory 缺必填 categoryId（pi typebox schema 校验应失败）
        sse(
          res,
          [
            delta({ role: 'assistant' }),
            delta({ reasoning_content: '先尝试删除一个分类。' }),
            toolCall('call_pi_bad', 'removeCategory', {}),
            finish('tool_calls'),
            usageChunk(100, 20, 120),
          ],
          40,
          () => console.log('[pi-mock] validate round 1 done'),
        )
      } else if (roundTools === 1) {
        // 第二轮：合法参数（getSettings 无参必填）
        sse(
          res,
          [
            delta({ role: 'assistant' }),
            toolCall('call_pi_good', 'getSettings', {}),
            finish('tool_calls'),
            usageChunk(120, 20, 140),
          ],
          40,
          () => console.log('[pi-mock] validate round 2 done'),
        )
      } else {
        sse(
          res,
          [
            delta({ role: 'assistant' }),
            delta({ content: '参数校验链路完成：缺参被校验拦截，补参后查询成功。' }),
            finish('stop'),
            usageChunk(140, 30, 170),
          ],
          40,
          () => console.log('[pi-mock] validate final done'),
        )
      }
      return
    }

    /* ---------- 执行失败分支（轮次以 round 计） ---------- */
    if (userBase.includes('执行失败')) {
      if (roundTools === 0) {
        sse(
          res,
          [
            delta({ role: 'assistant' }),
            toolCall('call_pi_rm', 'removeCategory', { categoryId: 'cat-system' }),
            finish('tool_calls'),
            usageChunk(100, 20, 120),
          ],
          40,
          () => console.log('[pi-mock] exec-fail round 1 done'),
        )
      } else {
        sse(
          res,
          [
            delta({ role: 'assistant' }),
            delta({ content: '执行失败链路完成：错误原因已回填。' }),
            finish('stop'),
            usageChunk(130, 30, 160),
          ],
          40,
          () => console.log('[pi-mock] exec-fail final done'),
        )
      }
      return
    }

    /* ---------- 双工具（同轮两个调用，验证串行顺序；轮次以 round 计） ---------- */
    if (userBase.includes('双工具')) {
      if (roundTools === 0) {
        sse(
          res,
          [
            delta({ role: 'assistant' }),
            delta({ content: '我同时查询设置与表结构。' }),
            toolCall('call_pi_a', 'getSettings', {}, 0),
            toolCall('call_pi_b', 'getTables', {}, 1),
            finish('tool_calls'),
            usageChunk(100, 20, 120),
          ],
          40,
          () => console.log('[pi-mock] dual round 1 done'),
        )
      } else {
        sse(
          res,
          [
            delta({ role: 'assistant' }),
            delta({ content: '双工具链路完成：两个查询均已执行。' }),
            finish('stop'),
            usageChunk(150, 30, 180),
          ],
          40,
          () => console.log('[pi-mock] dual final done'),
        )
      }
      return
    }

    /* ---------- 历史回放 / 默认：直接总结 ---------- */
    sse(
      res,
      [
        delta({ role: 'assistant' }),
        delta({ content: `已收到 ${msgs.length} 条消息，历史回放完成。` }),
        finish('stop'),
        usageChunk(100, 20, 120),
      ],
      40,
      () => console.log('[pi-mock] replay done'),
    )
  })
})

server.listen(port, () => {
  console.log(`[pi-mock] pi-agent-core E2E server at http://localhost:${port}/v1`)
})
