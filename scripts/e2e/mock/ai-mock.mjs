/**
 * E2E 统一 AI mock 服务器：三协议流式接口 + fetch 数据端点
 *
 * 合并历史 mock 的全部场景分支（重写套件的唯一 mock）。自带 CORS `*`，
 * 浏览器可直连跨域端口（无需 vite 同源代理）。
 *
 * 三协议端点（同一场景路由，wire 归一后共享）：
 * - POST /chat/completions  —— OpenAI Chat Completions（data: {chunk} + [DONE]）
 * - POST /responses         —— OpenAI Responses（response.* 事件 + [DONE]）
 * - POST /v1/messages       —— Anthropic Messages（content_block / message_* 事件）
 * - GET  /hello             —— fetch 工具的数据端点（返回 JSON）
 *
 * 场景分支按「结构性判定 → 关键词优先级 → 轮次」路由：
 * - 压缩请求（结构性：请求无 tools 且 system 含「压缩器」）→ 固定摘要文本；
 *   打印 `COMPACT-SUMMARY-REQ received` 供日志断言
 * - 压缩后的主请求（结构性：末条为新 user 且其前一条是含「【上下文压缩】」
 *   的 user，或消息序列恰为 [system, 摘要]）→「已基于压缩摘要继续任务」
 * - 关键词分支（userBase = 最后一条 user 剥离「【任务清单·同步】」注入块后的
 *   首行；轮次 round = 最后一条 user 之后的工具结果数，历史旧结果不计数，
 *   多场景连续发送不互相污染）：
 *   · 含「参数校验」：r0 removeTableCategory 缺参（typebox 校验失败）→ r1 getSettings
 *     → r2 总结
 *   · 含「执行失败」：r0 removeTableCategory(cat-system)（api 中文错误）→ r1 总结
 *   · 含「双工具」：r0 同轮 getSettings + getTables → r1 总结
 *   · 含「选项演示」：单轮回复带【选项】块（界面解析为可点击按钮）
 *   · 含「选择方案」：用户点击选项按钮后的回执（打印 OPTION-CHOICE）
 *   · 含「请求失败」：首个请求 HTTP 500（打印 REQ-FAIL-500），重试后成功
 *   · 含「任务清单」：r0 汇报模板（3 项未开始）→ r1 同步模板（推进状态）→
 *     r2+ 慢速长流 30 段（供中止）
 *   · 含「继续」：打印 `ECHO-LAST-USER >>> <完整 user 正文>`；回全完成同步模板
 *   · 含「技能」：r0 skill(table-design, 2 parts) → r1 总结
 *   · 含「压缩流程」：r0 getTables(usage 2112) → r1 收尾（配 2400 上限触发 88%）
 *   · 含「循环」：永远返回 getTables 不收尾（轮数上限验证）
 *   · 含「快速思考」：120 段 × 8ms 高频思考流（贴底竞态验证）
 *   · 含「刷新」：r0 同轮 reload + reloadDicts + reloadTemplates + reloadSettings
 *     （顶栏「刷新」按钮等价的四工具）→ r1 总结（usage 1120）
 *   · 含「生成代码」：r0 genCodeZip → r1 genCodeReplace → r2 Markdown 总结
 *   · 含「AI 设置」：r0 getAISettings → r1 setCurrentModel（providerId 从 r0 结果
 *     提取）→ r2 总结
 *   · 含「撤销」：r0 addTableCategory → r1 undo → r2 redo → r3 clearHistory → r4 总结
 *   · 含「清空模型」：r0 removeAll（E2E 点危险确认弹窗）→ r1 总结
 *   · 含「重置演示」：r0 resetDemo（E2E 点危险确认弹窗）→ r1 总结
 *   · 含「网络请求」：r0 fetch(/hello) → r1 总结
 *   · 含「协议演示」：短思考 + 短正文（三协议对话回归）
 *   · 默认 /「历史回放」：40 段 × 500ms 超长思考流 + 短正文
 *     （历史回放场景回「已收到 N 条消息」）
 *
 * 每个请求统一打印一行契约日志 + tool 结果文本（120 字截断）：
 *   [ai-mock] roles=[..] tools=N toolResults=N round=N sysRules=? sysRulesFlow=? sysCap=? lastUser=..
 *   [ai-mock] tool-result-text: .. ||| ..
 *
 * usage 数值契约（断言侧引用，双处保持一致）：
 *   CODEGEN: 1024/256/1280 → 2048/128/2176 → 4096/512/4608
 *   LONG_THINK: 512/1600/2112（默认分支，8192 上限收口）
 *   COMPACT_FLOW: 1800/312/2112 → 1900/212/2112（2400 上限触发 88%）
 *   AFTER_COMPACT: 420/40/460（压缩后回落）
 *   REFRESH: 256/64/320 → 1024/96/1120
 *
 * 用法：node scripts/e2e/mock/ai-mock.mjs [port=4841]
 */
import http from "node:http";

const port = Number(process.argv[2]) || 4841;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, x-api-key, anthropic-version",
};

/* ==================== 归一请求（三协议 → 统一路由上下文） ==================== */

/** 归一后的路由上下文（协议无关） */
function normalizeChat(parsed) {
  const msgs = parsed.messages || [];
  return {
    roles: msgs.map((m) => m.role).join(","),
    sysText: String(msgs.find((m) => m.role === "system")?.content || ""),
    lastUser: String([...msgs].reverse().find((m) => m.role === "user")?.content || ""),
    round: (() => {
      const lastUserIdx = msgs.map((m) => m.role).lastIndexOf("user");
      return msgs.filter((m, i) => m.role === "tool" && i > lastUserIdx).length;
    })(),
    toolResults: msgs.filter((m) => m.role === "tool").map((m) => String(m.content || "")),
    toolsCount: (parsed.tools || []).length,
  };
}

/** OpenAI Responses：input items（消息 / function_call / function_call_output）归一 */
function normalizeResponses(parsed) {
  const items = parsed.input || [];
  const roles = [];
  const toolResults = [];
  let sysText = "";
  let lastUser = "";
  for (const item of items) {
    if (item.type === "function_call") {
      roles.push("assistant"); // 工具调用消息（assistant 侧）
      continue;
    }
    if (item.type === "function_call_output") {
      roles.push("tool");
      toolResults.push(String(item.output || ""));
      continue;
    }
    const role = item.role || "user";
    roles.push(role);
    const text = String(item.content ?? "");
    if (role === "system") sysText = text;
    if (role === "user") lastUser = text;
  }
  const lastUserIdx = roles.lastIndexOf("user");
  const round = roles.filter((r, i) => r === "tool" && i > lastUserIdx).length;
  return {
    roles: roles.join(","),
    sysText,
    lastUser,
    round,
    toolResults,
    toolsCount: (parsed.tools || []).length,
  };
}

/** Anthropic Messages：system 字段 + messages（text / tool_use / tool_result 块）归一 */
function normalizeAnthropic(parsed) {
  const sysText = String(parsed.system || "");
  const messages = parsed.messages || [];
  const roles = [];
  const toolResults = [];
  let lastUser = "";
  for (const m of messages) {
    const content = Array.isArray(m.content) ? m.content : [{ type: "text", text: m.content }];
    const text = content
      .filter((b) => b.type === "text")
      .map((b) => String(b.text ?? ""))
      .join("");
    const hasToolResult = content.some((b) => b.type === "tool_result");
    const hasToolUse = content.some((b) => b.type === "tool_use");
    if (hasToolResult) {
      for (const b of content) {
        if (b.type === "tool_result") toolResults.push(String(b.content ?? ""));
      }
      // 纯 tool_result 的 user 消息计为 tool 轮
      if (!text) {
        roles.push("tool");
        continue;
      }
    }
    roles.push(m.role === "assistant" && hasToolUse ? "assistant" : m.role);
    if (m.role === "user" && text) lastUser = text;
  }
  const lastUserIdx = roles.lastIndexOf("user");
  const round = roles.filter((r, i) => r === "tool" && i > lastUserIdx).length;
  return {
    roles: [sysText ? "system," : "", ...roles].join("").replace(/,$/, ""),
    sysText,
    lastUser,
    round,
    toolResults,
    toolsCount: (parsed.tools || []).length,
  };
}

/* ==================== SSE 下发（openai data: 行风格） ==================== */

function sseChat(res, events, interval, done) {
  res.writeHead(200, {
    ...CORS,
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  let i = 0;
  const tick = () => {
    if (i < events.length) {
      res.write(`data: ${JSON.stringify(events[i++])}\n\n`);
      setTimeout(tick, interval);
    } else {
      res.write("data: [DONE]\n\n");
      res.end();
      done?.();
    }
  };
  tick();
}

/** SSE 下发（anthropic event:/data: 对风格） */
function sseAnthropic(res, events, interval, done) {
  res.writeHead(200, {
    ...CORS,
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  let i = 0;
  const tick = () => {
    if (i < events.length) {
      const ev = events[i++];
      res.write(`event: ${ev.event}\ndata: ${JSON.stringify(ev.data)}\n\n`);
      setTimeout(tick, interval);
    } else {
      res.end();
      done?.();
    }
  };
  tick();
}

/* ---------- openai chat chunk 构造 ---------- */

const delta = (d) => ({ choices: [{ delta: d }] });
const finish = (reason) => ({ choices: [{ delta: {}, finish_reason: reason }] });
const usageChunk = (p, c, t) => ({
  choices: [],
  usage: { prompt_tokens: p, completion_tokens: c, total_tokens: t },
});
const toolCall = (id, name, args, index = 0) => ({
  choices: [
    {
      delta: {
        tool_calls: [{ index, id, function: { name, arguments: JSON.stringify(args) } }],
      },
    },
  ],
});

/* ---------- 统一响应描述（协议无关中间表示） ---------- */

/**
 * 统一响应描述 → 各协议事件流。
 * desc: { reasoning?: string[], text?: string[] | string, toolCalls?: [{id,name,args}],
 *         usage: [in, out], finish?: "stop"|"tool_calls" }
 */
function toChatEvents(desc) {
  const events = [delta({ role: "assistant" })];
  for (const r of desc.reasoning || []) events.push(delta({ reasoning_content: r }));
  const textChunks = Array.isArray(desc.text) ? desc.text : desc.text ? [desc.text] : [];
  for (const t of textChunks) events.push(delta({ content: t }));
  (desc.toolCalls || []).forEach((tc, i) => events.push(toolCall(tc.id, tc.name, tc.args, i)));
  events.push(finish(desc.finish || (desc.toolCalls?.length ? "tool_calls" : "stop")));
  const [p, c] = desc.usage || [0, 0];
  events.push(usageChunk(p, c, p + c));
  return events;
}

function toResponsesEvents(desc) {
  const events = [];
  let outIdx = 0;
  for (const r of desc.reasoning || []) {
    events.push({
      type: "response.output_item.added",
      output_index: outIdx,
      item: { type: "reasoning", id: `rs_${outIdx}` },
    });
    events.push({
      type: "response.reasoning_text.delta",
      output_index: outIdx,
      delta: r,
    });
    events.push({ type: "response.output_item.done", output_index: outIdx });
    outIdx++;
  }
  const textChunks = Array.isArray(desc.text) ? desc.text : desc.text ? [desc.text] : [];
  if (textChunks.length) {
    events.push({
      type: "response.output_item.added",
      output_index: outIdx,
      item: { type: "message", role: "assistant" },
    });
    for (const t of textChunks) {
      events.push({ type: "response.output_text.delta", output_index: outIdx, delta: t });
    }
    events.push({ type: "response.output_item.done", output_index: outIdx });
    outIdx++;
  }
  for (const tc of desc.toolCalls || []) {
    events.push({
      type: "response.output_item.added",
      output_index: outIdx,
      item: { type: "function_call", call_id: tc.id, name: tc.name, arguments: "" },
    });
    events.push({
      type: "response.function_call_arguments.delta",
      output_index: outIdx,
      delta: JSON.stringify(tc.args),
    });
    events.push({ type: "response.output_item.done", output_index: outIdx });
    outIdx++;
  }
  const [p, c] = desc.usage || [0, 0];
  events.push({
    type: "response.completed",
    response: {
      status: "completed",
      usage: { input_tokens: p, output_tokens: c, total_tokens: p + c },
    },
  });
  return events;
}

function toAnthropicEvents(desc) {
  const events = [
    {
      event: "message_start",
      data: {
        type: "message_start",
        message: { usage: { input_tokens: (desc.usage || [0, 0])[0] } },
      },
    },
  ];
  let idx = 0;
  for (const r of desc.reasoning || []) {
    events.push({
      event: "content_block_start",
      data: {
        type: "content_block_start",
        index: idx,
        content_block: { type: "thinking", thinking: "" },
      },
    });
    events.push({
      event: "content_block_delta",
      data: {
        type: "content_block_delta",
        index: idx,
        delta: { type: "thinking_delta", thinking: r },
      },
    });
    events.push({ event: "content_block_stop", data: { type: "content_block_stop", index: idx } });
    idx++;
  }
  const textChunks = Array.isArray(desc.text) ? desc.text : desc.text ? [desc.text] : [];
  if (textChunks.length) {
    events.push({
      event: "content_block_start",
      data: { type: "content_block_start", index: idx, content_block: { type: "text", text: "" } },
    });
    for (const t of textChunks) {
      events.push({
        event: "content_block_delta",
        data: { type: "content_block_delta", index: idx, delta: { type: "text_delta", text: t } },
      });
    }
    events.push({ event: "content_block_stop", data: { type: "content_block_stop", index: idx } });
    idx++;
  }
  for (const tc of desc.toolCalls || []) {
    events.push({
      event: "content_block_start",
      data: {
        type: "content_block_start",
        index: idx,
        content_block: { type: "tool_use", id: tc.id, name: tc.name, input: {} },
      },
    });
    events.push({
      event: "content_block_delta",
      data: {
        type: "content_block_delta",
        index: idx,
        delta: { type: "input_json_delta", partial_json: JSON.stringify(tc.args) },
      },
    });
    events.push({ event: "content_block_stop", data: { type: "content_block_stop", index: idx } });
    idx++;
  }
  const [, c] = desc.usage || [0, 0];
  events.push({
    event: "message_delta",
    data: {
      type: "message_delta",
      delta: { stop_reason: desc.toolCalls?.length ? "tool_use" : "end_turn" },
      usage: { output_tokens: c },
    },
  });
  events.push({ event: "message_stop", data: { type: "message_stop" } });
  return events;
}

/* ---------- 任务清单模板（系统提示内置的汇报 / 同步消息格式） ---------- */

const TASK_REPORT = `【任务清单·汇报】
1. [未开始] 分析 sys_user 表结构
2. [未开始] 设计订单表字段
3. [未开始] 校验字段约定`;

const TASK_SYNC = `【任务清单·同步】
1. [已完成] 分析 sys_user 表结构
2. [执行中] 设计订单表字段
3. [未开始] 校验字段约定`;

const TASK_SYNC_ALL_DONE = `【任务清单·同步】
1. [已完成] 分析 sys_user 表结构
2. [已完成] 设计订单表字段
3. [已完成] 校验字段约定`;

/** 压缩固定摘要（与系统提示的压缩器输出约定一致） */
const COMPACT_SUMMARY = `【上下文压缩】
- 任务：演示任务清单流程与压缩
- 已完成：加载了模型与设置
- 任务清单最新状态：1 项完成，2 项进行中
- 待办：继续设计字段并校验`;

/** 选项演示回复（【选项】块 → 界面解析为可点击按钮；正文仅留引入语） */
const OPTIONS_REPLY =
  "设计订单表前需要先确认数据规模方向：\n\n【选项】\n1. 采用单表设计，结构简单，适合小规模数据\n2. 采用主子两表设计，扩展性强，适合持续增长\n3. 引入字典冗余，查询性能最好，维护成本略高\n";

/** 「请求失败」场景状态：首个请求 500，重试后成功（每个 mock 进程一次） */
let reqFailOnce = false;

/** 从工具结果文本中提取 prv- 供应商 id（AI 设置链路的 setCurrentModel 参数用） */
function extractProviderId(ctx) {
  for (const text of [...ctx.toolResults].reverse()) {
    const m = String(text).match(/"id"\s*:\s*"(prv-[0-9A-Za-z]+)"/);
    if (m) return m[1];
  }
  return "";
}

/**
 * 场景路由（协议无关）：返回统一响应描述 + 发送间隔；
 * null = 走默认分支（超长思考流）。
 */
function route(ctx) {
  const msgs = ctx.msgs;
  const userBase = ctx.lastUser.split("\n\n【任务清单·同步】")[0].split("\n")[0];
  const round = ctx.round;

  /* ---------- 1. 压缩请求（结构性判定优先：无 tools + system 含压缩器） ---------- */
  if (!ctx.toolsCount && ctx.sysText.includes("压缩器")) {
    console.log("COMPACT-SUMMARY-REQ received");
    return { desc: { text: COMPACT_SUMMARY, usage: [600, 80] }, interval: 30 };
  }

  /* ---------- 2. 压缩后的主请求（结构性：末条 user 前一条是压缩摘要 user） ---------- */
  const anyCompactUser = msgs.some(
    (m) => m.role === "user" && String(m.content || "").includes("【上下文压缩】"),
  );
  const lastUserIdx = msgs.map((m) => m.role).lastIndexOf("user");
  const prevOfLastUser = lastUserIdx > 0 ? msgs[lastUserIdx - 1] : null;
  const afterCompact =
    (prevOfLastUser &&
      prevOfLastUser.role === "user" &&
      String(prevOfLastUser.content || "").includes("【上下文压缩】")) ||
    (anyCompactUser && msgs.length === 2 && msgs[0].role === "system");
  if (afterCompact) {
    return {
      desc: { text: "已基于压缩摘要继续任务，全部完成。", usage: [420, 40] },
      interval: 40,
    };
  }

  /* ---------- 3. 关键词分支 ---------- */

  // 参数校验链路（pi typebox 校验失败 → 补参重试）
  if (userBase.includes("参数校验")) {
    if (round === 0) {
      return {
        desc: {
          reasoning: ["先尝试删除一个分类。"],
          toolCalls: [{ id: "call_pi_bad", name: "removeTableCategory", args: {} }],
          usage: [100, 20],
        },
        interval: 40,
      };
    }
    if (round === 1) {
      return {
        desc: {
          toolCalls: [{ id: "call_pi_good", name: "getSettings", args: {} }],
          usage: [120, 20],
        },
        interval: 40,
      };
    }
    return {
      desc: { text: "参数校验链路完成：缺参被校验拦截，补参后查询成功。", usage: [140, 30] },
      interval: 40,
    };
  }

  // 执行失败链路（api 中文错误前缀回填）
  if (userBase.includes("执行失败")) {
    if (round === 0) {
      return {
        desc: {
          toolCalls: [
            { id: "call_pi_rm", name: "removeTableCategory", args: { categoryId: "cat-system" } },
          ],
          usage: [100, 20],
        },
        interval: 40,
      };
    }
    return { desc: { text: "执行失败链路完成：错误原因已回填。", usage: [130, 30] }, interval: 40 };
  }

  // 同轮双工具（串行执行顺序验证）
  if (userBase.includes("双工具")) {
    if (round === 0) {
      return {
        desc: {
          text: "我同时查询设置与表结构。",
          toolCalls: [
            { id: "call_pi_a", name: "getSettings", args: {} },
            { id: "call_pi_b", name: "getTables", args: {} },
          ],
          usage: [100, 20],
        },
        interval: 40,
      };
    }
    return { desc: { text: "双工具链路完成：两个查询均已执行。", usage: [150, 30] }, interval: 40 };
  }

  // 点击选项（模型输出【选项】块，界面解析为可点击按钮；等待用户选择）
  if (userBase.includes("选项演示")) {
    return { desc: { text: OPTIONS_REPLY, usage: [280, 40] }, interval: 40 };
  }

  // 点击选项的回执（用户点击按钮 → 新 user 消息「选择方案 N：…」）
  if (userBase.includes("选择方案")) {
    console.log(`OPTION-CHOICE >>> ${ctx.lastUser}`);
    return {
      desc: { text: "已按所选方案继续执行：选项链路完成。", usage: [260, 40] },
      interval: 40,
    };
  }

  // 请求失败重试（首个请求 HTTP 500 → 界面展示错误与重试按钮；重试后成功）
  if (userBase.includes("请求失败")) {
    if (!reqFailOnce) {
      reqFailOnce = true;
      console.log("REQ-FAIL-500 sent");
      return { httpError: { status: 500, message: "e2e 模拟服务内部异常" } };
    }
    return { desc: { text: "重试链路完成：请求已成功恢复。", usage: [300, 40] }, interval: 40 };
  }

  // 任务清单流程（汇报 → 同步 → 慢速长流供中止）
  if (userBase.includes("任务清单")) {
    if (round === 0) {
      return {
        desc: {
          text: [`${TASK_REPORT}\n\n先加载表结构：`],
          toolCalls: [{ id: "call_tl_load", name: "getTables", args: {} }],
          usage: [512, 96],
        },
        interval: 40,
      };
    }
    if (round === 1) {
      return {
        desc: {
          text: [`${TASK_SYNC}\n\n继续推进：`],
          toolCalls: [{ id: "call_tl_sync", name: "getTables", args: {} }],
          usage: [640, 80],
        },
        interval: 40,
      };
    }
    // 慢速长流（30 段 × 400ms），供 E2E 中途点停止
    const chunks = [];
    for (let i = 1; i <= 30; i++) chunks.push(`正在设计订单表字段（${i}/30）……\n`);
    return { desc: { text: chunks, usage: [700, 120] }, interval: 400 };
  }

  // 继续（回显完整 user 正文 + 全完成同步模板）
  if (userBase.includes("继续")) {
    console.log(`ECHO-LAST-USER >>> ${ctx.lastUser}`);
    return {
      desc: { text: [`${TASK_SYNC_ALL_DONE}\n\n全部任务已完成。`], usage: [500, 40] },
      interval: 40,
    };
  }

  // 技能加载（skill 单独一轮）
  if (userBase.includes("技能")) {
    if (round === 0) {
      return {
        desc: {
          reasoning: ["先加载表结构设计技能。"],
          toolCalls: [
            {
              id: "call_skill",
              name: "skill",
              args: { skill: "table-design", parts: ["conventions", "indexes"] },
            },
          ],
          usage: [300, 40],
        },
        interval: 40,
      };
    }
    return {
      desc: { text: "技能加载完成：已获得主键约定与索引设计规范两部分知识。", usage: [420, 50] },
      interval: 40,
    };
  }

  // 压缩流程演示（usage total=2112，配 2400 上限触发 88%）
  if (userBase.includes("压缩流程")) {
    if (round === 0) {
      return {
        desc: { toolCalls: [{ id: "call_cpx", name: "getTables", args: {} }], usage: [1800, 312] },
        interval: 40,
      };
    }
    return { desc: { text: "压缩流程演示完成。", usage: [1900, 212] }, interval: 40 };
  }

  // 循环不收尾（轮数上限验证）
  if (userBase.includes("循环")) {
    return {
      desc: {
        toolCalls: [{ id: `call_loop_${round}`, name: "getTables", args: {} }],
        usage: [100, 20],
      },
      interval: 30,
    };
  }

  // 快速思考（120 段 × 8ms 高频流，贴底竞态验证）
  if (userBase.includes("快速思考")) {
    const reasoning = [];
    for (let i = 1; i <= 120; i++) reasoning.push(`第 ${i} 段思考内容。\n`);
    return {
      desc: { reasoning, text: "快速思考完成。", usage: [400, 600] },
      interval: 8,
    };
  }

  // 刷新（顶栏「刷新」按钮等价的四个 reload 工具，同轮串行）
  if (userBase.includes("刷新")) {
    if (round === 0) {
      return {
        desc: {
          toolCalls: [
            { id: "call_reload_1", name: "reload", args: {} },
            { id: "call_reload_2", name: "reloadDicts", args: {} },
            { id: "call_reload_3", name: "reloadTemplates", args: {} },
            { id: "call_reload_4", name: "reloadSettings", args: {} },
          ],
          usage: [256, 64],
        },
        interval: 40,
      };
    }
    return {
      desc: { text: "刷新完成：模型元素、字典、模板与设置已重载。", usage: [1024, 96] },
      interval: 40,
    };
  }

  // 代码生成 / 替换链路（轮次按 round——本套件会话连续累积历史 tool 结果）
  if (userBase.includes("生成代码")) {
    if (round === 0) {
      return {
        desc: {
          reasoning: ["先为全部表生成代码。"],
          toolCalls: [{ id: "call_gen", name: "genCodeZip", args: {} }],
          usage: [1024, 256],
        },
        interval: 400,
      };
    }
    if (round === 1) {
      return {
        desc: {
          reasoning: ["接着执行代码替换。"],
          toolCalls: [{ id: "call_rep", name: "genCodeReplace", args: {} }],
          usage: [2048, 128],
        },
        interval: 400,
      };
    }
    return {
      desc: {
        // 首部 \n\n + 尾部空白：验证最终文本去空白收口
        text: [
          "\n\n## 任务完成\n\n已生成并替换代码。\n\n```java\npublic class Demo {\n}\n```\n\n  \n",
        ],
        usage: [4096, 512],
      },
      interval: 400,
    };
  }

  // AI 设置工具链（getAISettings → setCurrentModel → 总结）
  if (userBase.includes("AI 设置")) {
    if (round === 0) {
      return {
        desc: {
          toolCalls: [{ id: "call_ais", name: "getAISettings", args: {} }],
          usage: [200, 30],
        },
        interval: 40,
      };
    }
    if (round === 1) {
      const prvId = extractProviderId(ctx);
      return {
        desc: {
          toolCalls: [
            {
              id: "call_scm",
              name: "setCurrentModel",
              args: prvId ? { providerId: prvId, modelId: "e2e-model" } : {},
            },
          ],
          usage: [220, 30],
        },
        interval: 40,
      };
    }
    return {
      desc: { text: "AI 设置链路完成：已读取并设置当前模型。", usage: [240, 40] },
      interval: 40,
    };
  }

  // 撤销 / 重做 / 清历史
  if (userBase.includes("撤销")) {
    if (round === 0) {
      return {
        desc: {
          toolCalls: [
            {
              id: "call_cat_add",
              name: "addTableCategory",
              args: { name: "e2e-ai-cat", basePackage: "com.e2e.ai" },
            },
          ],
          usage: [200, 30],
        },
        interval: 40,
      };
    }
    if (round === 1) {
      return {
        desc: { toolCalls: [{ id: "call_undo", name: "undo", args: {} }], usage: [220, 30] },
        interval: 40,
      };
    }
    if (round === 2) {
      return {
        desc: { toolCalls: [{ id: "call_redo", name: "redo", args: {} }], usage: [240, 30] },
        interval: 40,
      };
    }
    if (round === 3) {
      return {
        desc: { toolCalls: [{ id: "call_ch", name: "clearHistory", args: {} }], usage: [260, 30] },
        interval: 40,
      };
    }
    return {
      desc: { text: "撤销链路完成：新增→撤销→重做→清历史全通过。", usage: [280, 40] },
      interval: 40,
    };
  }

  // 清空模型元素（removeAll，E2E 点危险确认弹窗）
  if (userBase.includes("清空模型")) {
    if (round === 0) {
      return {
        desc: { toolCalls: [{ id: "call_rmall", name: "removeAll", args: {} }], usage: [200, 30] },
        interval: 40,
      };
    }
    return { desc: { text: "模型元素已清空。", usage: [220, 40] }, interval: 40 };
  }

  // 重置演示数据（resetDemo，E2E 点危险确认弹窗）
  if (userBase.includes("重置演示")) {
    if (round === 0) {
      return {
        desc: { toolCalls: [{ id: "call_reset", name: "resetDemo", args: {} }], usage: [200, 30] },
        interval: 40,
      };
    }
    return { desc: { text: "已重置为演示数据。", usage: [220, 40] }, interval: 40 };
  }

  // 网络请求（fetch 工具 → GET /hello）
  if (userBase.includes("网络请求")) {
    if (round === 0) {
      return {
        desc: {
          toolCalls: [
            { id: "call_fetch", name: "fetch", args: { url: `http://localhost:${port}/hello` } },
          ],
          usage: [200, 30],
        },
        interval: 40,
      };
    }
    return { desc: { text: "网络请求完成：已获取外部数据。", usage: [220, 40] }, interval: 40 };
  }

  // 协议演示（三协议短思考 + 短正文回归）
  if (userBase.includes("协议")) {
    return {
      desc: {
        reasoning: ["先思考一下。", "再思考一下。", "思考完毕。"],
        text: "协议演示完成：当前协议对话正常。",
        usage: [700, 100],
      },
      interval: 40,
    };
  }

  /* ---------- 4. 默认 / 历史回放：超长思考流 + 短正文 ---------- */
  const isReplay = userBase.includes("历史回放") || userBase.includes("默认规则");
  const reply = isReplay ? `已收到 ${msgs.length} 条消息，历史回放完成。` : "思考流演示完成。";
  const reasoning = [];
  for (let i = 1; i <= 40; i++) {
    reasoning.push(`第 ${String(i).padStart(2, "0")} 段：思考内容……\n`);
  }
  return { desc: { reasoning, text: reply, usage: [512, 1600] }, interval: 500 };
}

/* ==================== HTTP 服务器 ==================== */

const server = http.createServer((req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, CORS);
    res.end();
    return;
  }

  // fetch 工具的数据端点（GET /hello）
  if (req.method === "GET" && req.url.includes("/hello")) {
    res.writeHead(200, { ...CORS, "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, source: "e2e-ai-mock", greeting: "hello from mock" }));
    return;
  }

  const isChat = req.method === "POST" && req.url.includes("/chat/completions");
  const isResponses = req.method === "POST" && /\/responses\/?$/.test(req.url);
  const isAnthropic =
    req.method === "POST" && (/\/v1\/messages\/?$/.test(req.url) || /\/messages\/?$/.test(req.url));
  if (!isChat && !isResponses && !isAnthropic) {
    res.writeHead(404, CORS);
    res.end("not found");
    return;
  }

  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    let parsed = {};
    try {
      parsed = JSON.parse(body);
    } catch {
      /* ignore */
    }
    // 按协议归一（anthropic 的 system 独立字段 + messages；其余见各自函数）
    const ctx = isResponses
      ? normalizeResponses(parsed)
      : isAnthropic
        ? normalizeAnthropic(parsed)
        : normalizeChat(parsed);
    ctx.msgs = isAnthropic
      ? (parsed.messages || []).map((m) => ({
          role: m.role,
          content: Array.isArray(m.content)
            ? m.content
                .filter((b) => b.type === "text")
                .map((b) => b.text)
                .join("")
            : m.content,
        }))
      : (parsed.messages || parsed.input || []).map((item) =>
          item.type === "function_call"
            ? { role: "assistant", content: null }
            : item.type === "function_call_output"
              ? { role: "tool", content: item.output }
              : { role: item.role, content: item.content },
        );
    // 界面在中止后的下轮发送会注入「【任务清单·同步】上轮任务被用户中止」块——
    // 分支匹配基准必须剥离该注入（其含「任务清单」字样会污染关键词路由）
    const userBase = ctx.lastUser.split("\n\n【任务清单·同步】")[0].split("\n")[0];
    console.log(
      `[ai-mock] roles=[${ctx.roles}] tools=${ctx.toolsCount} toolResults=${ctx.toolResults.length} round=${ctx.round} sysRules=${ctx.sysText.includes("【全局规则】")} sysRulesFlow=${ctx.sysText.includes("# 任务流程")} sysCap=${ctx.sysText.includes("能力域")} lastUser=${userBase.slice(0, 60)}`,
    );
    const toolResultTexts = ctx.toolResults
      .map((t) =>
        String(t || "")
          .replace(/\n/g, "\\n")
          .slice(0, 120),
      )
      .join(" ||| ");
    if (toolResultTexts) console.log(`[ai-mock] tool-result-text: ${toolResultTexts}`);
    // 协议标识日志（三协议端点各自到达的断言锚点）
    if (isResponses) console.log("RES-MOCK-REQ received");
    if (isAnthropic) console.log("ANT-MOCK-REQ received");

    const routed = route(ctx) || {};
    // 场景指定 HTTP 错误（请求失败重试链路：非 SSE，直接 JSON 错误体）
    if (routed.httpError) {
      res.writeHead(routed.httpError.status, {
        ...CORS,
        "Content-Type": "application/json",
      });
      res.end(JSON.stringify({ error: { message: routed.httpError.message } }));
      return;
    }
    const { desc, interval } = routed;
    if (isAnthropic) {
      sseAnthropic(res, toAnthropicEvents(desc), interval ?? 40);
    } else if (isResponses) {
      sseChat(res, toResponsesEvents(desc), interval ?? 40);
    } else {
      sseChat(res, toChatEvents(desc), interval ?? 40);
    }
  });
});

server.listen(port, () => {
  console.log(`[ai-mock] unified E2E mock server at http://localhost:${port}/v1`);
});
