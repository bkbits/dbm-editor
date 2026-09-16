/**
 * AI 思考块滚动跟随 E2E 模拟服务器：openai compatible /v1/chat/completions 流式接口（SSE）
 *
 * 单轮超长 reasoning 流（40 段 × 500ms = 20 秒，约 80 行文本，远超思考块
 * 240px max-height，制造充足的内部滚动）→ 短正文 → stop 收尾，无工具调用。
 * 每段带序号与换行（pre-wrap 逐行渲染），便于 E2E 断言"内容仍在增长"。
 * 带 CORS 头（配合 vite AI_MOCK_PROXY 同源代理使用亦可直连）。
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
    console.log(`[mock-scroll] serve reasoning stream: ${CHUNKS} chunks x ${INTERVAL}ms`)
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
    ]
    sse(res, events, () => console.log('[mock-scroll] stream done'))
  })
})

server.listen(port, () => {
  console.log(`[mock-scroll] openai compatible SSE server at http://localhost:${port}/v1`)
})
