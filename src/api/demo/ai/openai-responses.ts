/**
 * AIApi 对话协议客户端 · OpenAI Responses
 *
 * POST {baseUrl}/responses（stream: true）。请求：归一消息转 input items
 * （消息 / function_call / function_call_output 混排），工具定义拍平为
 * {type:"function", name, description, parameters}。思考经
 * reasoning: { effort } 下发（xhigh/max 收敛到 high——协议档位仅到 high）。
 *
 * SSE 事件（response.* 前缀，只解析 data: 行）→ 归一增量：
 * - response.output_item.added（item.type === "function_call"）→ 工具调用开块
 *   （index = output_index，id = item.call_id，name = item.name）
 * - response.output_text.delta → 正文增量
 * - response.reasoning_text.delta / response.reasoning_summary_text.delta → 思考增量
 * - response.function_call_arguments.delta → 工具参数分片追加
 * - response.completed → usage（input/output/total_tokens）与收尾；
 *   存在工具调用时 finishReason = "tool_calls"，response.status 为
 *   "incomplete" 时为 "length"，否则 "stop"
 */
import type {
  ChatCompletionDelta,
  ChatCompletionRequest,
  ChatCompletionResult,
  ChatUsage,
  ThinkingIntensity,
} from "@/types/ai";
import { consumeSse, postSse } from "./sse";
import { openaiResponsesInput, openaiResponsesTools } from "./wire";
import { trimBaseUrl } from "./openai-chat";

/** Responses 协议的思考档位：仅支持 low/medium/high（xhigh/max 收敛到 high） */
function responsesEffort(intensity: ThinkingIntensity): "low" | "medium" | "high" {
  if (intensity === "low" || intensity === "medium") return intensity;
  return "high";
}

/** openai responses 流式对话（AIApi.chat 的 openai-responses 协议实现体） */
export async function chatViaOpenaiResponses(
  request: ChatCompletionRequest,
  onDelta?: (delta: ChatCompletionDelta) => void,
): Promise<ChatCompletionResult> {
  const baseUrl = trimBaseUrl(request.provider);
  if (!baseUrl) throw new Error("未配置 AI 服务地址，请先在「系统设置 → AI」中配置");

  const body: Record<string, unknown> = {
    model: request.model,
    input: openaiResponsesInput(request?.messages || []),
    stream: true,
  };
  if (request?.tools?.length) body.tools = openaiResponsesTools(request.tools);
  if (request?.reasoningEffort)
    body.reasoning = { effort: responsesEffort(request.reasoningEffort) };
  if (request?.maxTokens) body.max_output_tokens = request.maxTokens;

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (request.provider.apiKey) headers.Authorization = `Bearer ${request.provider.apiKey}`;

  const stream = await postSse({
    url: `${baseUrl}/responses`,
    headers,
    body,
    signal: request?.signal,
    label: baseUrl,
  });

  const contentParts: string[] = [];
  const reasoningParts: string[] = [];
  const toolSlots = new Map<number, { id: string; name: string; args: string }>();
  let usage: ChatUsage | undefined;
  let finishReason: string | undefined;
  let failed = "";
  const emit = (delta: ChatCompletionDelta) => {
    if (!onDelta) return;
    try {
      onDelta(delta);
    } catch {
      /* 回调异常不中断流式消费 */
    }
  };
  /** SSE 事件分派（data: 载荷 = response.* 事件 JSON） */
  const onEvent = (ev: {
    type?: string;
    delta?: string;
    output_index?: number;
    item?: { type?: string; call_id?: string; name?: string; arguments?: string };
    response?: {
      status?: string;
      incomplete_details?: { reason?: string } | null;
      usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number };
      error?: { message?: string } | null;
    };
  }): boolean => {
    switch (ev.type) {
      case "response.output_item.added": {
        const item = ev.item;
        if (item?.type === "function_call") {
          const index = Math.max(0, Math.floor(Number(ev.output_index) || 0));
          let slot = toolSlots.get(index);
          if (!slot) {
            slot = { id: "", name: "", args: "" };
            toolSlots.set(index, slot);
          }
          const id = String(item.call_id ?? "");
          const name = String(item.name ?? "");
          if (id) slot.id = id;
          if (name) slot.name = name;
          emit({
            toolCall: {
              index,
              ...(id ? { id } : {}),
              ...(name ? { name } : {}),
              ...(item.arguments ? { arguments: String(item.arguments) } : {}),
            },
          });
        }
        break;
      }
      case "response.output_text.delta": {
        const text = String(ev.delta ?? "");
        if (text) {
          contentParts.push(text);
          emit({ content: text });
        }
        break;
      }
      case "response.reasoning_text.delta":
      case "response.reasoning_summary_text.delta": {
        const text = String(ev.delta ?? "");
        if (text) {
          reasoningParts.push(text);
          emit({ reasoning: text });
        }
        break;
      }
      case "response.function_call_arguments.delta": {
        const index = Math.max(0, Math.floor(Number(ev.output_index) || 0));
        const piece = String(ev.delta ?? "");
        let slot = toolSlots.get(index);
        if (!slot) {
          slot = { id: "", name: "", args: "" };
          toolSlots.set(index, slot);
        }
        if (piece) slot.args += piece;
        emit({ toolCall: { index, ...(piece ? { arguments: piece } : {}) } });
        break;
      }
      case "response.completed": {
        const u = ev.response?.usage;
        if (u) {
          usage = {
            promptTokens: Math.max(0, Math.floor(Number(u.input_tokens) || 0)),
            completionTokens: Math.max(0, Math.floor(Number(u.output_tokens) || 0)),
            totalTokens: Math.max(0, Math.floor(Number(u.total_tokens) || 0)),
          };
          if (usage.totalTokens || usage.promptTokens || usage.completionTokens) {
            emit({ usage });
          }
        }
        if (ev.response?.status === "incomplete") finishReason = "length";
        return true;
      }
      case "response.failed":
      case "response.error":
      case "error": {
        failed = String(
          (ev as { message?: string }).message ||
            ev.response?.error?.message ||
            "AI 服务返回错误事件",
        );
        return true;
      }
      default:
        break;
    }
    return false;
  };
  await consumeSse(stream, (payload) => {
    if (payload === "[DONE]") return true;
    try {
      return onEvent(JSON.parse(payload) as Parameters<typeof onEvent>[0]);
    } catch {
      return false; // 非完整 JSON 分片跳过
    }
  });
  if (failed) throw new Error(failed);
  if (toolSlots.size) finishReason = "tool_calls";
  else if (!finishReason) finishReason = "stop";
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
    finishReason,
    ...(usage ? { usage } : {}),
  };
}
