/**
 * AIApi 对话协议客户端 · Anthropic Messages
 *
 * POST {baseUrl}/v1/messages（地址以 /v1 结尾时拼 /messages，否则补 /v1）。
 * 鉴权 x-api-key + anthropic-version。请求：system 独立字段、消息严格交替
 * （连续 tool 结果合并，见 wire.ts）、tools 用 input_schema；max_tokens 协议
 * 必填（未提供兜底 8192）；模型支持思考时 thinking: {type:"enabled",
 * budget_tokens}（档位由思考强度映射，且保证 max_tokens > budget）。
 *
 * SSE 事件（event:/data: 对，只解析 data: 行）→ 归一增量：
 * - content_block_start：content_block.type === "tool_use" → 工具调用开块
 *   （index = 块序号，id/name 就位）
 * - content_block_delta：text_delta → 正文；thinking_delta → 思考；
 *   input_json_delta → 工具参数分片追加
 * - message_start：usage.input_tokens（输入侧先到）
 * - message_delta：stop_reason（end_turn→stop / tool_use→tool_calls /
 *   max_tokens→length）+ usage.output_tokens（输出侧后到，配齐 total 后 emit）
 * - message_stop：流结束哨兵
 */
import type {
  ChatCompletionDelta,
  ChatCompletionRequest,
  ChatCompletionResult,
  ChatUsage,
  ThinkingIntensity,
} from "@/types/ai";
import { consumeSse, postSse } from "./sse";
import { anthropicPayload, anthropicTools } from "./wire";

/** 思考强度 → anthropic 思考预算（budget_tokens）映射 */
const ANTHROPIC_BUDGETS: Record<ThinkingIntensity, number> = {
  low: 1024,
  medium: 4096,
  high: 8192,
  xhigh: 16384,
  max: 32768,
};

/** anthropic stop_reason → 归一 finishReason */
function normalizedStopReason(reason: string | undefined): string | undefined {
  if (!reason) return undefined;
  if (reason === "tool_use") return "tool_calls";
  if (reason === "max_tokens") return "length";
  if (reason === "end_turn" || reason === "stop_sequence") return "stop";
  return reason;
}

/** anthropic messages 流式对话（AIApi.chat 的 anthropic 协议实现体） */
export async function chatViaAnthropic(
  request: ChatCompletionRequest,
  onDelta?: (delta: ChatCompletionDelta) => void,
): Promise<ChatCompletionResult> {
  const baseUrl = String(request.provider?.baseUrl ?? "")
    .trim()
    .replace(/\/+$/, "");
  if (!baseUrl) throw new Error("未配置 AI 服务地址，请先在「系统设置 → AI」中配置");
  // 地址约定：以 /v1 结尾直接拼 /messages，否则补 /v1/messages（两种写法均可用）
  const path = baseUrl.endsWith("/v1") ? "/messages" : "/v1/messages";
  const url = `${baseUrl}${path}`;

  const { system, messages } = anthropicPayload(request?.messages || []);
  // max_tokens 协议必填；开启思考时保证输出上限大于思考预算
  const budget = request.reasoningEffort ? ANTHROPIC_BUDGETS[request.reasoningEffort] : 0;
  const maxTokens = Math.max(
    Math.max(1, Math.floor(Number(request?.maxTokens) || 0)) || 8192,
    budget ? budget + 1024 : 0,
  );
  const body: Record<string, unknown> = {
    model: request.model,
    max_tokens: maxTokens,
    messages,
    stream: true,
    ...(system ? { system } : {}),
  };
  if (request?.tools?.length) {
    body.tools = anthropicTools(request.tools);
    body.tool_choice = { type: "auto" };
  }
  if (budget) body.thinking = { type: "enabled", budget_tokens: budget };

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "anthropic-version": "2023-06-01",
  };
  if (request.provider.apiKey) headers["x-api-key"] = request.provider.apiKey;

  const stream = await postSse({ url, headers, body, signal: request?.signal, label: url });

  const contentParts: string[] = [];
  const reasoningParts: string[] = [];
  const toolSlots = new Map<number, { id: string; name: string; args: string }>();
  let usageIn = 0;
  let usageOut = 0;
  let usage: ChatUsage | undefined;
  let finishReason: string | undefined;
  const emit = (delta: ChatCompletionDelta) => {
    if (!onDelta) return;
    try {
      onDelta(delta);
    } catch {
      /* 回调异常不中断流式消费 */
    }
  };
  /** 输出用量配齐即 emit（input 先到、output 后到） */
  const emitUsage = () => {
    if (usageIn > 0 || usageOut > 0) {
      usage = {
        promptTokens: usageIn,
        completionTokens: usageOut,
        totalTokens: usageIn + usageOut,
      };
      emit({ usage });
    }
  };
  await consumeSse(stream, (payload) => {
    if (payload === "[DONE]") return true;
    let ev: {
      type?: string;
      index?: number;
      delta?: {
        type?: string;
        text?: string;
        thinking?: string;
        partial_json?: string;
        stop_reason?: string;
      };
      content_block?: { type?: string; id?: string; name?: string };
      message?: { usage?: { input_tokens?: number; output_tokens?: number } };
      usage?: { input_tokens?: number; output_tokens?: number };
      error?: { message?: string };
    };
    try {
      ev = JSON.parse(payload);
    } catch {
      return false; // 非完整 JSON 分片跳过
    }
    switch (ev.type) {
      case "message_start": {
        const u = ev.message?.usage;
        if (u?.input_tokens) usageIn = Math.max(0, Math.floor(Number(u.input_tokens) || 0));
        break;
      }
      case "content_block_start": {
        const block = ev.content_block;
        const index = Math.max(0, Math.floor(Number(ev.index) || 0));
        if (block?.type === "tool_use") {
          const id = String(block.id ?? "");
          const name = String(block.name ?? "");
          let slot = toolSlots.get(index);
          if (!slot) {
            slot = { id: "", name: "", args: "" };
            toolSlots.set(index, slot);
          }
          if (id) slot.id = id;
          if (name) slot.name = name;
          emit({ toolCall: { index, ...(id ? { id } : {}), ...(name ? { name } : {}) } });
        }
        break;
      }
      case "content_block_delta": {
        const index = Math.max(0, Math.floor(Number(ev.index) || 0));
        const d = ev.delta ?? {};
        if (d.type === "text_delta" && d.text) {
          contentParts.push(d.text);
          emit({ content: d.text });
        } else if (d.type === "thinking_delta" && d.thinking) {
          reasoningParts.push(d.thinking);
          emit({ reasoning: d.thinking });
        } else if (d.type === "input_json_delta" && d.partial_json) {
          let slot = toolSlots.get(index);
          if (!slot) {
            slot = { id: "", name: "", args: "" };
            toolSlots.set(index, slot);
          }
          slot.args += d.partial_json;
          emit({ toolCall: { index, arguments: d.partial_json } });
        }
        break;
      }
      case "message_delta": {
        const stop = normalizedStopReason(ev.delta?.stop_reason);
        if (stop) finishReason = stop;
        const out = Number(ev.usage?.output_tokens);
        if (Number.isFinite(out) && out > 0) usageOut = Math.floor(out);
        emitUsage();
        break;
      }
      case "message_stop":
        return true;
      case "error": {
        throw new Error(String(ev.error?.message || "AI 服务返回错误事件"));
      }
      default:
        break;
    }
    return false;
  });
  return {
    content: contentParts.join(""),
    reasoning: reasoningParts.length ? reasoningParts.join("") : undefined,
    toolCalls: [...toolSlots.entries()]
      .sort((a, b) => a[0] - b[0])
      .filter(([, t]) => t.name)
      .map(([i, t]) => ({
        id: t.id || `call_${i}`,
        type: "function" as const,
        function: { name: t.name, arguments: t.args || "{}" },
      })),
    finishReason: finishReason ?? (toolSlots.size ? "tool_calls" : "stop"),
    ...(usage ? { usage } : {}),
  };
}
