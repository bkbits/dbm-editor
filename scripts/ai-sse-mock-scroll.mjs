/**
 * AI 思考块滚动跟随 / token 用量 E2E 模拟服务器：openai compatible /v1/chat/completions 流式接口（SSE）
 *
 * 按最后一条 user 消息内容分支：
 * - 含「刷新」：第一轮 tool_calls(refresh) → [DONE]；收到 tool 结果后第二轮总结（带 usage）
 * - 其他：单轮超长 reasoning 流（40 段 × 500ms = 20 秒，约 80 行文本，远超思考块
 *   240px max-height，制造充足的内部滚动）→ 短正文 → stop 收尾，无工具调用。
 *
 * 每轮末尾均发送 openai 标准 usage 分片（stream_options.include_usage 的响应形态），
 * 数值固定便于断言：普通流 prompt 512 / completion 1600 / total 2112；
 * 刷新分支第一轮 256/64/320、第二轮 1024/96/1120。
 *
 * 用法：node scripts/ai-sse-mock-scroll.mjs [port=4834]
 */
import http from 'node:http'

const port = Number(process.argv[2]) || 4834
const CHUNKS = 40
const INTERVAL = 500

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

/** 逐事件下发（最后一个事件为 usage 分片，choices 为空数组——openai include_usage 形态） */
function sse(res, events, done) {
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
      setTimeout(tick, INTERVAL)
    } else {
      res.write('data: [DONE]\n\n')
      res.end()
      done?.()
    }
  }
  tick()
}

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
    const toolCount = (parsed.messages || []).filter((m) => m.role === 'tool').length
    const lastUser = [...(parsed.messages || [])].reverse().find((m) => m.role === 'user')
    const wantsRefresh = String(lastUser?.content || '').includes('刷新')
    console.log(
      `[m[m[mock-scroll] model=${parsed.model} toolResults=${toolCount} wantsRefresh=${wantsRefresh}`,
    )

    if (wantsRefresh && toolCount === 0) {
      // 刷新分支第一轮：思考 + refresh 工具调用
      sse(
        res,
        [
          { choices: [{ delta: { role: 'assistant' } }] },
          {
            choices: [
              { delta: { reasoning_content: '用户要求刷新，调用 refresh 工具重新加载数据。' } },
            ],
          },
          {
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: 'call_e2e_refresh',
                      function: { name: 'refresh', arguments: '{}' },
                    },
                  ],
                },
                finish_reason: null,
              },
            ],
          },
          { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
          { choices: [], usage: { prompt_tokens: 256, completion_tokens: 64, total_tokens: 320 } },
        ],
        () => console.log('[m[m[mock-scroll] refresh round 1 done'),
      )
    } else if (wantsRefresh) {
      // 刷新分支第二轮：总结
      sse(
        res,
        [
          { choices: [{ delta: { role: 'assistant' } }] },
          {
            choices: [{ delta: { content: '已刷新全部数据：画布、字典、模板与设置均已是最新。' } }],
          },
          { choices: [{ delta: {}, finish_reason: 'stop' }] },
          {
            choices: [],
            usage: { prompt_tokens: 1024, completion_tokens: 96, total_tokens: 1120 },
          },
        ],
        () => console.log('[m[m[mock-scroll] refresh round 2 done'),
      )
    } else {
      // 普通分支：超长思考流
      const events = [
        { choices: [{ delta: { role: 'assistant' } }] },
        ...Array.from({ length: CHUNKS }, (_, i) => ({
          choices: [
            {
              delta: {
                reasoning_content: `第 ${String(i + 1).padStart(2, '0')} 段：正在分析数据库模型的整体结构，逐表核对字段约定与索引设置，评估逻辑删除标记与审计字段的覆盖情况，输出这段较长的思考文本用于验证思考块内部的滚动跟随行为。\n`,
              },
            },
          ],
        })),
        { choices: [{ delta: { content: '思考与验证已完成。' } }] },
        { choices: [{ delta: {}, finish_reason: 'stop' }] },
        { choices: [], usage: { prompt_tokens: 512, completion_tokens: 1600, total_tokens: 2112 } },
      ]
      sse(res, events, () => console.log('[m[m[mock-scroll] stream done'))
    }
  })
})

server.listen(port, () => {
  console.log(`[m[m[mock-scroll] openai compatible SSE server at http://localhost:${port}/v1`)
})
