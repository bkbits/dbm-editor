/**
 * AI E2E 模拟服务器：openai compatible /v1/chat/completions 流式接口（SSE）
 *
 * 脚本化两轮 AGENT 对话：
 * - 第一轮（请求无 tool 消息）：reasoning 流 → 正文短句 → tool_calls(getTables) → [DONE]
 * - 第二轮（请求含 tool 消息）：reasoning 流 → Markdown 正文（含代码围栏）→ [DONE]
 * 带 CORS 头（演示应用从 localhost:dev 跨端口访问），chunk 间隔 ~60ms 便于观察流式。
 *
 * 用法：node scripts/ai-sse-mock.mjs [port=4833]
 */
import http from 'node:http'

const port = Number(process.argv[2]) || 4833

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
      setTimeout(tick, 400)
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
    const hasToolResult = (parsed.messages || []).some((m) => m.role === 'tool')
    console.log(
      `[mock] model=${parsed.model} messages=${(parsed.messages || []).length} tools=${(parsed.tools || []).length} round=${hasToolResult ? 2 : 1} reasoning_effort=${parsed.reasoning_effort ?? '-'}`,
    )
    if (!hasToolResult) {
      // 第一轮：思考 + 短正文 + 工具调用
      sse(
        res,
        [
          { choices: [{ delta: { role: 'assistant' } }] },
          { choices: [{ delta: { reasoning_content: '用户想了解当前模型概况，' } }] },
          {
            choices: [
              { delta: { reasoning_content: '我先调用 getTables 查询全部表，再汇总回答。' } },
            ],
          },
          { choices: [{ delta: { content: '我先查询一下当前模型的表结构。' } }] },
          {
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: 'call_e2e_1',
                      function: { name: 'getTables', arguments: '{}' },
                    },
                  ],
                },
                finish_reason: null,
              },
            ],
          },
          { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
        ],
        () => console.log('[mock] round 1 done'),
      )
    } else {
      // 第二轮：思考 + Markdown 总结（含代码围栏）
      sse(
        res,
        [
          { choices: [{ delta: { role: 'assistant' } }] },
          { choices: [{ delta: { reasoning_content: '工具返回了表列表，整理为简明摘要。' } }] },
          {
            choices: [
              {
                delta: {
                  content:
                    '## 查询结果\n\n当前模型共有 **2** 张表：\n\n- `user` 用户表\n- `role` 角色表\n\n示例实体：\n\n```java\npublic class User {\n    private Long id;\n}\n```\n任务完成。',
                },
              },
            ],
          },
          { choices: [{ delta: {}, finish_reason: 'stop' }] },
        ],
        () => console.log('[mock] round 2 done'),
      )
    }
  })
})

server.listen(port, () => {
  console.log(`[mock] openai compatible SSE server at http://localhost:${port}/v1`)
})
