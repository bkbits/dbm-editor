/**
 * AI E2E 模拟服务器：openai compatible /v1/chat/completions 流式接口（SSE）
 *
 * 脚本化三轮 AGENT 对话（按请求中 tool 消息数量区分轮次）：
 * - 第一轮（0 条 tool 消息）：reasoning 流 → 短正文 → tool_calls(generateCode) → [DONE]
 * - 第二轮（1 条 tool 消息）：reasoning 流 → tool_calls(replaceCode) → [DONE]
 * - 第三轮（2 条 tool 消息）：reasoning 流 → Markdown 总结（首尾带空白字符 + 代码围栏）→ [DONE]
 * 带 CORS 头（演示应用从 localhost:dev 跨端口访问），chunk 间隔 ~400ms 便于观察流式。
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
    const toolCount = (parsed.messages || []).filter((m) => m.role === 'tool').length
    console.log(
      `[m[m[mock] model=${parsed.model} messages=${(parsed.messages || []).length} tools=${(parsed.tools || []).length} toolResults=${toolCount} reasoning_effort=${parsed.reasoning_effort ?? '-'}`,
    )
    if (toolCount === 0) {
      // 第一轮：思考 + 短正文 + 代码生成工具调用
      sse(
        res,
        [
          { choices: [{ delta: { role: 'assistant' } }] },
          { choices: [{ delta: { reasoning_content: '用户要生成代码，' } }] },
          {
            choices: [
              {
                delta: {
                  reasoning_content: '我先调用 generateCode 生成全部产物，zip 会自动提供下载。',
                },
              },
            ],
          },
          { choices: [{ delta: { content: '我来生成代码，产物会打包为 zip 供下载。' } }] },
          {
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: 'call_e2e_gen',
                      function: { name: 'generateCode', arguments: '{}' },
                    },
                  ],
                },
                finish_reason: null,
              },
            ],
          },
          { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
          {
            choices: [],
            usage: { prompt_tokens: 1024, completion_tokens: 256, total_tokens: 1280 },
          },
        ],
        () => console.log('[m[m[mock] round 1 done'),
      )
    } else if (toolCount === 1) {
      // 第二轮：思考 + 代码替换工具调用（前端应弹出文件清单确认框）
      sse(
        res,
        [
          { choices: [{ delta: { role: 'assistant' } }] },
          {
            choices: [
              { delta: { reasoning_content: '生成完成，接着执行代码替换，需要用户确认。' } },
            ],
          },
          { choices: [{ delta: { content: '接下来执行代码替换。' } }] },
          {
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: 'call_e2e_replace',
                      function: { name: 'replaceCode', arguments: '{}' },
                    },
                  ],
                },
                finish_reason: null,
              },
            ],
          },
          { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
          {
            choices: [],
            usage: { prompt_tokens: 2048, completion_tokens: 128, total_tokens: 2176 },
          },
        ],
        () => console.log('[m[m[mock] round 2 done'),
      )
    } else {
      // 第三轮：思考 + Markdown 总结（首尾空白字符用于验证去空白收口）
      sse(
        res,
        [
          { choices: [{ delta: { role: 'assistant' } }] },
          { choices: [{ delta: { reasoning_content: '工具全部执行完成，整理总结。' } }] },
          {
            choices: [
              {
                delta: {
                  content:
                    '\n\n## 任务完成\n\n共生成 **多份** 代码产物：\n\n- `SysUser` 实体与服务\n- controller 与 vue 页面\n\n示例：\n\n```java\npublic class SysUser {\n    private Long id;\n}\n```\n已全部完成。\n\n  ',
                },
              },
            ],
          },
          { choices: [{ delta: {}, finish_reason: 'stop' }] },
          {
            choices: [],
            usage: { prompt_tokens: 4096, completion_tokens: 512, total_tokens: 4608 },
          },
        ],
        () => console.log('[m[m[mock] round 3 done'),
      )
    }
  })
})

server.listen(port, () => {
  console.log(`[m[m[mock] openai compatible SSE server at http://localhost:${port}/v1`)
})
