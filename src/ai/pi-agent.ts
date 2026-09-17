/**
 * pi-agent-core 接入适配层（AI 工具内核的运行时引擎）
 *
 * 现有 openai compatible SSE 客户端（ManagerApi.chatComplete）保持不变，
 * 本层把「请求/流式协议/工具执行/会话循环」接入 @earendil-works/pi-agent-core：
 *
 * - createChatStreamFn：StreamFn 适配器——pi-ai Context 转 openai 请求，
 *   SSE 四类增量（正文/思考/工具调用/用量）翻译为 pi AssistantMessageEvent
 *   事件协议（start / text_* / thinking_* / toolcall_* / done / error）
 * - toPiTools：现有工具注册表（JSON Schema + invoke）转 pi AgentTool
 *   （typebox Type.Unsafe 包原始 JSON Schema，零改造成本；参数经 pi 校验与类型矫正）
 * - seedMessagesOf：界面会话历史（含 compact 压缩边界）重建为 pi-ai Message[]，
 *   作为 Agent 初始 transcript（界面态仍是唯一事实源，跨会话持久不变）
 * - serializeMessagesForCompact：上下文自动压缩的序列化（pi-ai 消息形态）
 *
 * 选型说明：pi-ai 自带的 provider 适配（openai/anthropic/google SDK）为 Node 端
 * 懒加载实现，浏览器打包不可用；注入自定义 StreamFn 是官方推荐的接入方式，
 * 网络层继续复用项目既有 fetch/SSE 客户端（鉴权、CORS、错误文案全部保持）。
 */
import { Agent } from "@earendil-works/pi-agent-core";
import type {
  AgentTool as PiAgentTool,
  StreamFn,
  ThinkingLevel,
} from "@earendil-works/pi-agent-core";
import { AssistantMessageEventStream } from "@earendil-works/pi-ai/utils/event-stream";
import { Type } from "@earendil-works/pi-ai";
import type {
  AssistantMessage,
  Context,
  Message,
  Model,
  TextContent,
  ThinkingContent,
  ToolCall as PiToolCall,
  Usage,
} from "@earendil-works/pi-ai";
import type {
  AiModelConfig,
  ChatCompletionDelta,
  ChatCompletionRequest,
  ChatMessage,
  ChatToolSpec,
  ChatUsage,
  ManagerApi,
  ThinkingIntensity,
} from "@/types/model";
import { errorMessageOf } from "@/api/manager-api";

/* ==================== 基础常量与辅助 ==================== */

/** 零用量（pi Usage 形态；成本字段项目内不使用，恒为零） */
export function zeroUsage(): Usage {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

/** openai usage → pi Usage（缺省回零） */
function piUsageOf(u?: ChatUsage): Usage {
  if (!u) return zeroUsage();
  return {
    input: u.promptTokens,
    output: u.completionTokens,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: u.totalTokens,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

/** 界面模型配置 → pi-ai Model（api 定为 openai-completions，实际请求由 streamFn 承接） */
export function piModelOf(config: AiModelConfig): Model<"openai-completions"> {
  return {
    id: config.id,
    name: config.name || config.id,
    api: "openai-completions",
    provider: "dbm-openai-compatible",
    baseUrl: "",
    reasoning: Boolean(config.supportsThinking),
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: Math.max(0, Math.floor(Number(config.inputContextLength) || 0)),
    maxTokens: Math.max(0, Math.floor(Number(config.outputContextLength) || 0)),
  };
}

/** 思考强度映射：项目 ThinkingIntensity → pi ThinkingLevel */
export function piThinkingLevelOf(config: AiModelConfig): ThinkingLevel {
  if (!config.supportsThinking) return "off";
  const level = config.thinkingIntensity;
  if (
    level === "low" ||
    level === "medium" ||
    level === "high" ||
    level === "xhigh" ||
    level === "max"
  )
    return level;
  return "medium";
}

/** 思考强度映射：pi ThinkingLevel → 项目 ThinkingIntensity（请求 reasoning_effort） */
function intensityOf(level?: ThinkingLevel): ThinkingIntensity | undefined {
  if (!level || level === "off") return undefined;
  if (level === "minimal") return "low";
  return level;
}

/** 助手消息正文文本（text 块拼接；无正文返回空串） */
export function textOf(message: AssistantMessage): string {
  return message.content
    .filter((c): c is TextContent => c.type === "text")
    .map((c) => c.text)
    .join("");
}

/** 助手消息思考文本（thinking 块拼接） */
export function thinkingOf(message: AssistantMessage): string {
  return message.content
    .filter((c): c is ThinkingContent => c.type === "thinking")
    .map((c) => c.thinking)
    .join("");
}

/** 助手消息携带的工具调用块（按内容顺序） */
export function toolCallsOf(message: AssistantMessage): PiToolCall[] {
  return message.content.filter((c): c is PiToolCall => c.type === "toolCall");
}

/** 工具结果文本（text 块拼接） */
function resultTextOf(content: { type: string }[]): string {
  return (content as TextContent[])
    .filter((c) => c && c.type === "text")
    .map((c) => c.text)
    .join("");
}

/* ==================== pi Context → openai 请求消息 ==================== */

/** 用户/工具消息内容 → 纯文本（本项目仅使用文本形态；兼容各类内容块数组） */
function plainText(content: string | ReadonlyArray<{ type: string; text?: string }>): string {
  if (typeof content === "string") return content;
  return content
    .filter((c) => c.type === "text")
    .map((c) => String(c.text ?? ""))
    .join("");
}

/** pi-ai Context → openai chat completions 消息序列（系统提示置首；经 toWireMessage 发送） */
export function chatMessagesOf(context: Context): ChatMessage[] {
  const out: ChatMessage[] = [];
  // pi 的 systemPrompt 独立于消息序列，openai 形态需拼回首条 system 消息
  if (context.systemPrompt) out.push({ role: "system", content: context.systemPrompt });
  for (const m of context.messages) {
    if (m.role === "user") {
      out.push({ role: "user", content: plainText(m.content) });
    } else if (m.role === "assistant") {
      const calls = m.content.filter((c): c is PiToolCall => c.type === "toolCall");
      out.push({
        role: "assistant",
        content: plainText(m.content) || null,
        ...(calls.length
          ? {
              toolCalls: calls.map((t) => ({
                id: t.id,
                type: "function" as const,
                function: { name: t.name, arguments: JSON.stringify(t.arguments ?? {}) },
              })),
            }
          : {}),
      });
    } else {
      out.push({ role: "tool", toolCallId: m.toolCallId, content: plainText(m.content) });
    }
  }
  return out;
}

/* ==================== StreamFn：SSE → pi 事件协议 ==================== */

/** 工具调用槽位（openai index 聚合：id/name 先到，arguments 分片追加） */
interface ToolSlot {
  /** 消息内容块下标（首个增量到达时占位） */
  contentIndex: number;
  emittedStart: boolean;
  id: string;
  name: string;
  json: string;
}

/**
 * 构建浏览器版 StreamFn：复用 ManagerApi.chatComplete（openai compatible SSE），
 * 把流式增量翻译为 pi AssistantMessageEvent 协议事件。
 * 契约（pi StreamFn）：不得抛出/拒绝——失败经 error 事件 + stopReason 编码返回。
 */
export function createChatStreamFn(getApi: () => ManagerApi): StreamFn {
  return (model, context, options) => {
    const stream = new AssistantMessageEventStream();
    void (async () => {
      const partial: AssistantMessage = {
        role: "assistant",
        content: [],
        api: model.api,
        provider: model.provider,
        model: model.id,
        usage: zeroUsage(),
        stopReason: "pending",
        timestamp: Date.now(),
      };
      const push = stream.push.bind(stream);
      try {
        const specTools: ChatToolSpec[] | undefined = context.tools?.length
          ? context.tools.map((t) => ({
              type: "function" as const,
              function: {
                name: t.name,
                description: t.description,
                parameters: t.parameters as Record<string, unknown>,
              },
            }))
          : undefined;
        const request: ChatCompletionRequest = {
          model: model.id,
          messages: chatMessagesOf(context),
          ...(specTools ? { tools: specTools } : {}),
          ...(model.reasoning && intensityOf(options?.reasoning)
            ? { reasoningEffort: intensityOf(options?.reasoning) }
            : {}),
          signal: options?.signal,
        };

        let textIndex = -1;
        let thinkingIndex = -1;
        const slots = new Map<number, ToolSlot>();

        push({ type: "start", partial });

        const result = await getApi().chatComplete(request, (delta: ChatCompletionDelta) => {
          // usage 分片仅作实时参考，真实收口在结果（末尾一次）
          if (delta.usage) partial.usage = piUsageOf(delta.usage);
          if (delta.reasoning) {
            if (thinkingIndex < 0) {
              partial.content.push({ type: "thinking", thinking: "" });
              thinkingIndex = partial.content.length - 1;
              push({ type: "thinking_start", contentIndex: thinkingIndex, partial });
            }
            const block = partial.content[thinkingIndex] as ThinkingContent;
            block.thinking += delta.reasoning;
            push({
              type: "thinking_delta",
              contentIndex: thinkingIndex,
              delta: delta.reasoning,
              partial,
            });
          }
          if (delta.content) {
            if (textIndex < 0) {
              partial.content.push({ type: "text", text: "" });
              textIndex = partial.content.length - 1;
              push({ type: "text_start", contentIndex: textIndex, partial });
            }
            const block = partial.content[textIndex] as TextContent;
            block.text += delta.content;
            push({ type: "text_delta", contentIndex: textIndex, delta: delta.content, partial });
          }
          if (delta.toolCall) {
            const { index, id, name, arguments: args } = delta.toolCall;
            let slot = slots.get(index);
            if (!slot) {
              partial.content.push({ type: "toolCall", id: "", name: "", arguments: {} });
              slot = {
                contentIndex: partial.content.length - 1,
                emittedStart: false,
                id: "",
                name: "",
                json: "",
              };
              slots.set(index, slot);
            }
            if (!slot.emittedStart) {
              slot.emittedStart = true;
              push({ type: "toolcall_start", contentIndex: slot.contentIndex, partial });
            }
            if (id) slot.id = id;
            if (name) slot.name = name;
            if (args) {
              slot.json += args;
              push({
                type: "toolcall_delta",
                contentIndex: slot.contentIndex,
                delta: args,
                partial,
              });
            }
          }
        });

        // 内容块收口（按流内实际到达的开块顺序）
        if (thinkingIndex >= 0) {
          const block = partial.content[thinkingIndex] as ThinkingContent;
          push({
            type: "thinking_end",
            contentIndex: thinkingIndex,
            content: block.thinking,
            partial,
          });
        }
        if (textIndex >= 0) {
          const block = partial.content[textIndex] as TextContent;
          push({ type: "text_end", contentIndex: textIndex, content: block.text, partial });
        }
        // 工具调用收口：填充 id/name/arguments（JSON 容错解析，失败回退空对象交由 schema 校验报错）
        for (const slot of slots.values()) {
          const block = partial.content[slot.contentIndex] as PiToolCall;
          block.id = slot.id;
          block.name = slot.name;
          block.arguments = safeParseArgs(slot.json);
          push({ type: "toolcall_end", contentIndex: slot.contentIndex, toolCall: block, partial });
        }

        const hasToolCalls = slots.size > 0;
        partial.stopReason = hasToolCalls
          ? "toolUse"
          : result.finishReason === "length"
            ? "length"
            : "stop";
        if (result.content && textIndex < 0) {
          // 未流经正文分片但结果聚合有正文（个别兼容服务）：补一块
          partial.content.push({ type: "text", text: result.content });
        }
        partial.usage = piUsageOf(result.usage);
        push({
          type: "done",
          reason: partial.stopReason as "stop" | "length" | "toolUse",
          message: partial,
        });
        stream.end();
      } catch (e) {
        partial.stopReason =
          options?.signal?.aborted || (e as Error)?.name === "AbortError" ? "aborted" : "error";
        partial.errorMessage = errorMessageOf(e, "AI 调用失败");
        push({ type: "error", reason: partial.stopReason as "aborted" | "error", error: partial });
        stream.end();
      }
    })();
    return stream;
  };
}

/** 工具调用参数 JSON 容错解析（失败回退空对象；schema 校验会给出可读错误） */
function safeParseArgs(json: string): Record<string, unknown> {
  const raw = String(json ?? "").trim();
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed))
      return { value: parsed };
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
}

/* ==================== 工具注册表 → pi AgentTool ==================== */

/** 现有工具注册表条目（stores/ai.ts 内部形态的结构契约） */
export interface PiToolSource {
  spec: ChatToolSpec;
  /** 工具改动后会话结束需同步刷新的仓库域（执行成功时上报） */
  domains: string[];
  invoke: (args: Record<string, unknown>, ctx: { callId: string }) => Promise<unknown>;
}

/** 工具结果回填模型的上限（与既有行为一致：超限截断） */
const MODEL_RESULT_CAP = 48000;

function capForModel(text: string): string {
  return text.length > MODEL_RESULT_CAP
    ? `${text.slice(0, MODEL_RESULT_CAP)}\n…（结果过长已截断，共 ${text.length} 字符）`
    : text;
}

function prettyJson(value: unknown): string {
  if (value === undefined) return "(void)";
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}

/**
 * 现有工具注册表 → pi AgentTool 列表：
 * - parameters 用 typebox Type.Unsafe 包原始 JSON Schema（描述/必填/嵌套全保留）
 * - 执行成功上报 domains（失败不记脏，与既有行为一致）
 * - 返回值 details 携带原始结果（界面记录展示），content 为截断后的 pretty JSON（回填模型）
 * - 抛错经 pi 捕获转错误工具结果：文本加「工具执行失败：」前缀保持模型可辨识
 */
export function toPiTools(
  tools: PiToolSource[],
  onToolSuccess: (domains: string[]) => void,
): PiAgentTool[] {
  return tools.map((tool) => ({
    name: tool.spec.function.name,
    label: tool.spec.function.name,
    description: tool.spec.function.description,
    parameters: Type.Unsafe(tool.spec.function.parameters),
    async execute(toolCallId: string, args: unknown) {
      try {
        const value = await tool.invoke(args as Record<string, unknown>, { callId: toolCallId });
        onToolSuccess(tool.domains);
        return {
          content: [{ type: "text" as const, text: capForModel(prettyJson(value).trim()) }],
          details: value,
        };
      } catch (e) {
        throw new Error(`工具执行失败：${errorMessageOf(e, "工具执行失败")}`);
      }
    },
  }));
}

/* ==================== 会话历史 → pi transcript 种子 ==================== */

/** 界面会话消息（stores/ai.ts AiChatMessage 的结构契约） */
export interface PiSeedMessage {
  role: "user" | "assistant";
  content: string;
  reasoning?: string;
  toolCalls?: Array<{ id: string; name: string; args: string }>;
  status?: string;
  compact?: { summary: string };
  /** 发送给模型的实际内容（含系统附加信息；缺省回退 content） */
  modelContent?: string;
  createdAt: number;
}

/** 能力调用记录（stores/ai.ts AiToolRecord 的结构契约） */
export interface PiSeedToolRecord {
  callId: string;
  status: "running" | "success" | "error";
  resultText: string;
  createdAt?: number;
}

/** 压缩后回填给模型的用户消息（与既有格式一致） */
export function compactUserContent(summary: string): string {
  return `【上下文压缩】此前对话已自动压缩为以下摘要，请基于摘要继续完成当前任务（无需向用户复述摘要）：\n\n${summary}`;
}

/**
 * 界面会话历史重建为 pi-ai Message[]（Agent 初始 transcript）：
 * - compact 标记消息为界：之前的历史折叠为摘要用户消息，序列重置后继续累积
 * - 失败/中止的助手消息跳过（不可作为合法上下文回放）
 * - 助手消息 → thinking/text 块 + toolCall 块；对应调用记录 → toolResult 消息
 */
export function seedMessagesOf(
  messages: PiSeedMessage[],
  toolRecords: PiSeedToolRecord[],
): Message[] {
  const out: Message[] = [];
  for (const m of messages) {
    if (m.compact) {
      out.length = 0;
      out.push({
        role: "user",
        content: compactUserContent(m.compact.summary),
        timestamp: m.createdAt,
      });
      continue;
    }
    if (m.role === "user") {
      out.push({ role: "user", content: m.modelContent || m.content, timestamp: m.createdAt });
    } else if (
      m.role === "assistant" &&
      m.status === "done" &&
      (m.content || m.toolCalls?.length)
    ) {
      const content: (TextContent | ThinkingContent | PiToolCall)[] = [];
      if (m.reasoning) content.push({ type: "thinking", thinking: m.reasoning });
      if (m.content) content.push({ type: "text", text: m.content });
      for (const tc of m.toolCalls ?? []) {
        content.push({
          type: "toolCall",
          id: tc.id,
          name: tc.name,
          arguments: safeParseArgs(tc.args),
        });
      }
      out.push({
        role: "assistant",
        content,
        api: "openai-completions",
        provider: "dbm-openai-compatible",
        model: "",
        usage: zeroUsage(),
        stopReason: m.toolCalls?.length ? "toolUse" : "stop",
        timestamp: m.createdAt,
      });
      for (const tc of m.toolCalls ?? []) {
        const rec = toolRecords.find((r) => r.callId === tc.id);
        out.push({
          role: "toolResult",
          toolCallId: tc.id,
          toolName: tc.name,
          content: [
            {
              type: "text",
              text: rec
                ? rec.status === "error"
                  ? `工具执行失败：${rec.resultText}`
                  : capForModel(rec.resultText)
                : "（无执行记录）",
            },
          ],
          isError: rec?.status === "error",
          timestamp: rec?.createdAt ?? m.createdAt,
        });
      }
    }
  }
  return out;
}

/* ==================== 上下文压缩序列化（pi-ai 消息形态） ==================== */

/** 压缩请求中单条消息的序列化上限（字符） */
const COMPACT_MSG_CAP = 4000;
/** 压缩请求中工具结果的上限（字符，比普通消息短） */
const COMPACT_TOOL_CAP = 1200;
/** 压缩请求序列化总上限（字符，超出从中间截断保留头尾） */
const COMPACT_TOTAL_CAP = 36000;

function capCompact(text: string, cap: number): string {
  const t = String(text ?? "");
  return t.length > cap ? `${t.slice(0, cap)}\n…（过长已截断，共 ${t.length} 字符）` : t;
}

/** pi-ai Message[]（含 Agent 自定义消息） → 压缩请求输入文本（只取标准角色，格式与既有压缩约定一致） */
export function serializeMessagesForCompact(
  messages: ReadonlyArray<Message | { role: string }>,
): string {
  const parts: string[] = [];
  for (const m of messages) {
    if (m.role === "user") {
      parts.push(
        `【用户】\n${capCompact(plainText((m as Message & { role: "user" }).content), COMPACT_MSG_CAP)}`,
      );
    } else if (m.role === "assistant") {
      const am = m as AssistantMessage;
      const names = toolCallsOf(am).length
        ? `\n（调用工具：${toolCallsOf(am)
            .map((t) => t.name)
            .join("、")}）`
        : "";
      parts.push(`【助手】\n${capCompact(textOf(am) || "（无正文）", COMPACT_MSG_CAP)}${names}`);
    } else if (m.role === "toolResult") {
      const tm = m as Message & { role: "toolResult" };
      parts.push(
        `【工具结果 ${(tm as { toolCallId?: string }).toolCallId ?? ""}】\n${capCompact(resultTextOf(tm.content), COMPACT_TOOL_CAP)}`,
      );
    }
  }
  let joined = parts.join("\n\n");
  if (joined.length > COMPACT_TOTAL_CAP) {
    const head = Math.floor(COMPACT_TOTAL_CAP * 0.25);
    const tail = COMPACT_TOTAL_CAP - head;
    joined = `${joined.slice(0, head)}\n\n…（中间部分省略）\n\n${joined.slice(-tail)}`;
  }
  return joined;
}

/** 重新导出 Agent（stores/ai.ts 统一从此处引入 pi-agent-core 运行时） */
export { Agent };
export type { AgentEvent } from "@earendil-works/pi-agent-core";
