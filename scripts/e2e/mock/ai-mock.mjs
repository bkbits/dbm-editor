/**
 * E2E 统一 AI mock 服务器：openai compatible /v1/chat/completions 流式接口（SSE）
 *
 * 合并原 ai-sse-mock.mjs / ai-sse-mock-scroll.mjs / ai-sse-mock-pi.mjs 三者的
 * 全部场景分支（重写套件的唯一 mock）。自带 CORS `*`，浏览器可直连跨域端口
 * （无需 vite 同源代理）。场景分支按「结构性判定 → 关键词优先级 → 轮次」路由：
 *
 * - 压缩请求（结构性：请求无 tools 且 system 含「压缩器」）→ 固定摘要文本；
 *   打印 `COMPACT-SUMMARY-REQ received` 供日志断言
 * - 压缩后的主请求（结构性：末条为新 user 且其前一条是含「【上下文压缩】」
 *   的 user，或消息序列恰为 [system, 摘要]）→「已基于压缩摘要继续任务」
 * - 关键词分支（userBase = 最后一条 user 剥离「【任务清单·同步】」注入块后的
 *   首行；轮次 round = 最后一条 user 之后的 tool 结果数，历史旧结果不计数，
 *   多场景连续发送不互相污染）：
 *   · 含「参数校验」：r0 removeCategory 缺参（typebox 校验失败）→ r1 getSettings
 *     → r2 总结
 *   · 含「执行失败」：r0 removeCategory(cat-system)（api 中文错误）→ r1 总结
 *   · 含「双工具」：r0 同轮 getSettings + getTables → r1 总结
 *   · 含「任务清单」：r0 汇报模板（3 项未开始）→ r1 同步模板（推进状态）→
 *     r2+ 慢速长流 30 段（供中止）
 *   · 含「继续」：打印 `ECHO-LAST-USER >>> <完整 user 正文>`；回全完成同步模板
 *   · 含「技能」：r0 loadSkill(table-design, 2 parts) → r1 总结
 *   · 含「压缩流程」：r0 getTables(usage 2112) → r1 收尾（配 2400 上限触发 88%）
 *   · 含「循环」：永远返回 getTables 不收尾（轮数上限验证）
 *   · 含「快速思考」：120 段 × 8ms 高频思考流（贴底竞态验证）
 *   · 含「刷新」：r0 refresh {} → r1 总结（usage 1120）
 *   · 含「生成代码」：r0 generateCode → r1 replaceCode → r2 Markdown 总结
 *     （首部 \n\n + 尾部空白测去空白收口 + h2 + java 代码围栏）
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
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

/** SSE 逐事件下发（interval 毫秒间隔），末尾 [DONE] */
function sse(res, events, interval, done) {
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

const server = http.createServer((req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, CORS);
    res.end();
    return;
  }
  if (req.method !== "POST" || !req.url.includes("/chat/completions")) {
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
    const msgs = parsed.messages || [];
    const roles = msgs.map((m) => m.role).join(",");
    const lastUserIdx = msgs.map((m) => m.role).lastIndexOf("user");
    // 本轮次序号：最后一条 user 之后的 tool 结果数（历史旧结果不计数，防跨场景污染）
    const round = msgs.filter((m, i) => m.role === "tool" && i > lastUserIdx).length;
    const toolResults = msgs.filter((m) => m.role === "tool");
    const toolResultTexts = toolResults
      .map((m) =>
        String(m.content || "")
          .replace(/\n/g, "\\n")
          .slice(0, 120),
      )
      .join(" ||| ");
    const lastUser = String([...msgs].reverse().find((m) => m.role === "user")?.content || "");
    // 界面在中止后的下轮发送会注入「【任务清单·同步】上轮任务被用户中止」块——
    // 分支匹配基准必须剥离该注入（其含「任务清单」字样会污染关键词路由）
    const userBase = lastUser.split("\n\n【任务清单·同步】")[0].split("\n")[0];
    const sysText = String(msgs.find((m) => m.role === "system")?.content || "");
    console.log(
      `[ai-mock] roles=[${roles}] tools=${(parsed.tools || []).length} toolResults=${toolResults.length} round=${round} sysRules=${sysText.includes("【全局规则】")} sysRulesFlow=${sysText.includes("# 任务流程")} sysCap=${sysText.includes("能力域")} lastUser=${userBase.slice(0, 60)}`,
    );
    if (toolResultTexts) console.log(`[ai-mock] tool-result-text: ${toolResultTexts}`);

    /* ---------- 1. 压缩请求（结构性判定优先：无 tools + system 含压缩器） ---------- */
    if (!(parsed.tools || []).length && sysText.includes("压缩器")) {
      console.log("COMPACT-SUMMARY-REQ received");
      sse(
        res,
        [
          delta({ role: "assistant" }),
          delta({ content: COMPACT_SUMMARY }),
          finish("stop"),
          usageChunk(600, 80, 680),
        ],
        30,
      );
      return;
    }

    /* ---------- 2. 压缩后的主请求（结构性：末条 user 前一条是压缩摘要 user；
       不能用「消息数恰为 2」判定——会话首轮 [system, user] 同样满足） ---------- */
    const prevOfLastUser = lastUserIdx > 0 ? msgs[lastUserIdx - 1] : null;
    // pi 重建行为：压缩后先发 [system, 摘要]（带 tools）的续跑请求，再发
    // [system, 摘要, assistant, 新问题]——两者都按压缩后续跑处理
    const anyCompactUser = msgs.some(
      (m) => m.role === "user" && String(m.content || "").includes("【上下文压缩】"),
    );
    const afterCompact =
      (prevOfLastUser &&
        prevOfLastUser.role === "user" &&
        String(prevOfLastUser.content || "").includes("【上下文压缩】")) ||
      (anyCompactUser && msgs.length === 2 && msgs[0].role === "system");
    if (afterCompact) {
      sse(
        res,
        [
          delta({ role: "assistant" }),
          delta({ content: "已基于压缩摘要继续任务，全部完成。" }),
          finish("stop"),
          usageChunk(420, 40, 460),
        ],
        40,
      );
      return;
    }

    /* ---------- 3. 关键词分支 ---------- */

    // 参数校验链路（pi typebox 校验失败 → 补参重试）
    if (userBase.includes("参数校验")) {
      if (round === 0) {
        sse(
          res,
          [
            delta({ role: "assistant" }),
            delta({ reasoning_content: "先尝试删除一个分类。" }),
            toolCall("call_pi_bad", "removeCategory", {}), // 缺必填 categoryId → 校验失败
            finish("tool_calls"),
            usageChunk(100, 20, 120),
          ],
          40,
        );
      } else if (round === 1) {
        sse(
          res,
          [
            delta({ role: "assistant" }),
            toolCall("call_pi_good", "getSettings", {}),
            finish("tool_calls"),
            usageChunk(120, 20, 140),
          ],
          40,
        );
      } else {
        sse(
          res,
          [
            delta({ role: "assistant" }),
            delta({ content: "参数校验链路完成：缺参被校验拦截，补参后查询成功。" }),
            finish("stop"),
            usageChunk(140, 30, 170),
          ],
          40,
        );
      }
      return;
    }

    // 执行失败链路（api 中文错误前缀回填）
    if (userBase.includes("执行失败")) {
      if (round === 0) {
        sse(
          res,
          [
            delta({ role: "assistant" }),
            toolCall("call_pi_rm", "removeCategory", { categoryId: "cat-system" }),
            finish("tool_calls"),
            usageChunk(100, 20, 120),
          ],
          40,
        );
      } else {
        sse(
          res,
          [
            delta({ role: "assistant" }),
            delta({ content: "执行失败链路完成：错误原因已回填。" }),
            finish("stop"),
            usageChunk(130, 30, 160),
          ],
          40,
        );
      }
      return;
    }

    // 同轮双工具（串行执行顺序验证）
    if (userBase.includes("双工具")) {
      if (round === 0) {
        sse(
          res,
          [
            delta({ role: "assistant" }),
            delta({ content: "我同时查询设置与表结构。" }),
            toolCall("call_pi_a", "getSettings", {}, 0),
            toolCall("call_pi_b", "getTables", {}, 1),
            finish("tool_calls"),
            usageChunk(100, 20, 120),
          ],
          40,
        );
      } else {
        sse(
          res,
          [
            delta({ role: "assistant" }),
            delta({ content: "双工具链路完成：两个查询均已执行。" }),
            finish("stop"),
            usageChunk(150, 30, 180),
          ],
          40,
        );
      }
      return;
    }

    // 任务清单流程（汇报 → 同步 → 慢速长流供中止）
    if (userBase.includes("任务清单")) {
      if (round === 0) {
        sse(
          res,
          [
            delta({ role: "assistant" }),
            delta({ content: `${TASK_REPORT}\n\n先加载表结构：` }),
            toolCall("call_tl_load", "getTables", {}),
            finish("tool_calls"),
            usageChunk(512, 96, 608),
          ],
          40,
        );
      } else if (round === 1) {
        sse(
          res,
          [
            delta({ role: "assistant" }),
            delta({ content: `${TASK_SYNC}\n\n继续推进：` }),
            toolCall("call_tl_sync", "getTables", {}),
            finish("tool_calls"),
            usageChunk(640, 80, 720),
          ],
          40,
        );
      } else {
        // 慢速长流（30 段 × 400ms），供 E2E 中途点停止
        const events = [delta({ role: "assistant" })];
        for (let i = 1; i <= 30; i++) {
          events.push(delta({ content: `正在设计订单表字段（${i}/30）……\n` }));
        }
        events.push(finish("stop"), usageChunk(700, 120, 820));
        sse(res, events, 400);
      }
      return;
    }

    // 继续（回显完整 user 正文 + 全完成同步模板）
    if (userBase.includes("继续")) {
      console.log(`ECHO-LAST-USER >>> ${lastUser}`);
      sse(
        res,
        [
          delta({ role: "assistant" }),
          delta({ content: `${TASK_SYNC_ALL_DONE}\n\n全部任务已完成。` }),
          finish("stop"),
          usageChunk(500, 40, 540),
        ],
        40,
      );
      return;
    }

    // 技能加载（loadSkill 单独一轮）
    if (userBase.includes("技能")) {
      if (round === 0) {
        sse(
          res,
          [
            delta({ role: "assistant" }),
            delta({ reasoning_content: "先加载表结构设计技能。" }),
            toolCall("call_skill", "loadSkill", {
              skill: "table-design",
              parts: ["conventions", "indexes"],
            }),
            finish("tool_calls"),
            usageChunk(300, 40, 340),
          ],
          40,
        );
      } else {
        sse(
          res,
          [
            delta({ role: "assistant" }),
            delta({ content: "技能加载完成：已获得主键约定与索引设计规范两部分知识。" }),
            finish("stop"),
            usageChunk(420, 50, 470),
          ],
          40,
        );
      }
      return;
    }

    // 压缩流程演示（usage total=2112，配 2400 上限触发 88%）
    if (userBase.includes("压缩流程")) {
      if (round === 0) {
        sse(
          res,
          [
            delta({ role: "assistant" }),
            toolCall("call_cpx", "getTables", {}),
            finish("tool_calls"),
            usageChunk(1800, 312, 2112),
          ],
          40,
        );
      } else {
        sse(
          res,
          [
            delta({ role: "assistant" }),
            delta({ content: "压缩流程演示完成。" }),
            finish("stop"),
            usageChunk(1900, 212, 2112),
          ],
          40,
        );
      }
      return;
    }

    // 循环不收尾（轮数上限验证）
    if (userBase.includes("循环")) {
      sse(
        res,
        [
          delta({ role: "assistant" }),
          toolCall(`call_loop_${round}`, "getTables", {}),
          finish("tool_calls"),
          usageChunk(100, 20, 120),
        ],
        30,
      );
      return;
    }

    // 快速思考（120 段 × 8ms 高频流，贴底竞态验证）
    if (userBase.includes("快速思考")) {
      const events = [delta({ role: "assistant" })];
      for (let i = 1; i <= 120; i++) {
        events.push(delta({ reasoning_content: `第 ${i} 段思考内容。\n` }));
      }
      events.push(delta({ content: "快速思考完成。" }), finish("stop"), usageChunk(400, 600, 1000));
      sse(res, events, 8);
      return;
    }

    // 刷新（refresh 工具 + 返回 refreshed: true）
    if (userBase.includes("刷新")) {
      if (round === 0) {
        sse(
          res,
          [
            delta({ role: "assistant" }),
            toolCall("call_refresh", "refresh", {}),
            finish("tool_calls"),
            usageChunk(256, 64, 320),
          ],
          40,
        );
      } else {
        sse(
          res,
          [
            delta({ role: "assistant" }),
            delta({ content: "刷新完成：画布、字典、模板与设置已重载。" }),
            finish("stop"),
            usageChunk(1024, 96, 1120),
          ],
          40,
        );
      }
      return;
    }

    // 代码生成 / 替换链路（轮次按 round——本套件会话连续累积历史 tool 结果，
    // 不能用全量 toolCount 判定轮次）
    if (userBase.includes("生成代码")) {
      {
        if (round === 0) {
          sse(
            res,
            [
              delta({ role: "assistant" }),
              delta({ reasoning_content: "先为全部表生成代码。" }),
              toolCall("call_gen", "generateCode", {}),
              finish("tool_calls"),
              usageChunk(1024, 256, 1280),
            ],
            400,
          );
        } else if (round === 1) {
          sse(
            res,
            [
              delta({ role: "assistant" }),
              delta({ reasoning_content: "接着执行代码替换。" }),
              toolCall("call_rep", "replaceCode", {}),
              finish("tool_calls"),
              usageChunk(2048, 128, 2176),
            ],
            400,
          );
        } else {
          sse(
            res,
            [
              delta({ role: "assistant" }),
              // 首部 \n\n + 尾部空白：验证最终文本去空白收口
              delta({
                content:
                  "\n\n## 任务完成\n\n已生成并替换代码。\n\n```java\npublic class Demo {\n}\n```\n\n  \n",
              }),
              finish("stop"),
              usageChunk(4096, 512, 4608),
            ],
            400,
          );
        }
        return;
      }
    }

    /* ---------- 4. 默认 / 历史回放：超长思考流 + 短正文 ---------- */
    const isReplay = userBase.includes("历史回放") || userBase.includes("默认规则");
    const reply = isReplay ? `已收到 ${msgs.length} 条消息，历史回放完成。` : "思考流演示完成。";
    const events = [delta({ role: "assistant" })];
    for (let i = 1; i <= 40; i++) {
      events.push(
        delta({ reasoning_content: `第 ${String(i).padStart(2, "0")} 段：思考内容……\n` }),
      );
    }
    events.push(delta({ content: reply }), finish("stop"), usageChunk(512, 1600, 2112));
    sse(res, events, 500);
  });
});

server.listen(port, () => {
  console.log(`[ai-mock] unified E2E mock server at http://localhost:${port}/v1`);
});
