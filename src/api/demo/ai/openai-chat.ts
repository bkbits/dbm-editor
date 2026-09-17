/**
 * AIApi 对话协议客户端 · OpenAI Chat Completions
 *
 * 从原 demo/chat-complete.ts 迁移改造：POST {baseUrl}/chat/completions
 * （stream + include_usage），SSE 逐行解析四类增量（正文 / 思考
 * reasoning_content|reasoning / 工具调用按 index 分槽拼接 / 用量归一）
 * 经 onDelta 增量回调，结束时聚合为 ChatCompletionResult。
 * 建流与 SSE 迭代经共用设施（./sse.ts），wire 转换经 ./wire.ts。
 */
import type {
  AIProviderConfig,
  ChatCompletionDelta,
  ChatCompletionRequest,
  ChatCompletionResult,
  ChatUsage,
} from "@/types/ai";
import { consumeSse, postSse } from "./sse";
import { openaiChatMessages, openaiChatTools } from "./wire";

/** 供应商地址归一：去尾部斜杠（地址校验由设置保存层保证以 /v1 结尾） */
export function trimBaseUrl(provider: AIProviderConfig): string {
  return String(provider?.baseUrl ?? "")
    .trim()
    .replace(/\/+$/, "");
}

/** openai chat completions 流式对话（AIApi.chat 的 openai-chat 协议实现体） */
export async function chatViaOpenaiChat(
  request: ChatCompletionRequest,
  onDelta?: (delta: ChatCompletionDelta) => void,
): Promise<ChatCompletionResult> {
  const baseUrl = trimBaseUrl(request.provider);
  if (!baseUrl) throw new Error("未配置 AI 服务地址，请先在「系统设置 → AI」中配置");

  const body: Record<string, unknown> = {
    model: request.model,
    messages: openaiChatMessages(request?.messages || []),
    stream: true,
    // 请求末尾 usage 分片（openai compatible 标准方式；不支持的服务静默忽略）
    stream_options: { include_usage: true },
  };
  if (request?.tools?.length) body.tools = openaiChatTools(request.tools);
  if (request?.reasoningEffort) body.reasoning_effort = request.reasoningEffort;
  if (request?.maxTokens) body.max_tokens = request.maxTokens;

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (request.provider.apiKey) headers.Authorization = `Bearer ${request.provider.apiKey}`;

  const stream = await postSse({
    url: `${baseUrl}/chat/completions`,
    headers,
    body,
    signal: request?.signal,
    label: baseUrl,
  });

  // SSE 逐行解析：data: {chunk} 与 [DONE] 哨兵；四类增量聚合（正文/思考/工具调用/用量）
  const contentParts: string[] = [];
  const reasoningParts: string[] = [];
  const toolSlots = new Map<number, { id: string; name: string; args: string }>();
  let finishReason: string | undefined;
  let usage: ChatUsage | undefined;
  const emit = (delta: ChatCompletionDelta) => {
    if (!onDelta) return;
    try {
      onDelta(delta);
    } catch {
      /* 回调异常不中断流式消费 */
    }
  };
  await consumeSse(stream, (payload) => {
    if (payload === "[DONE]") return true;
    let chunk: {
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | null;
      choices?: Array<{
        finish_reason?: string | null;
        delta?: {
          content?: string | null;
          reasoning_content?: string | null;
          reasoning?: string | null;
          tool_calls?: Array<{
            index?: number;
            id?: string;
            function?: { name?: string; arguments?: string };
          }>;
        };
      }>;
    };
    try {
      chunk = JSON.parse(payload);
    } catch {
      return; // 非完整 JSON 分片（粘包残留）跳过
    }
    // usage 分片（include_usage 时末尾携带，choices 可为空数组）：归一后 emit + 落结果
    const rawUsage = chunk.usage;
    if (rawUsage && typeof rawUsage === "object") {
      usage = {
        promptTokens: Math.max(0, Math.floor(Number(rawUsage.prompt_tokens) || 0)),
        completionTokens: Math.max(0, Math.floor(Number(rawUsage.completion_tokens) || 0)),
        totalTokens: Math.max(0, Math.floor(Number(rawUsage.total_tokens) || 0)),
      };
      if (usage.totalTokens || usage.promptTokens || usage.completionTokens) {
        emit({ usage });
      }
    }
    const choice = chunk.choices?.[0];
    if (choice?.finish_reason) finishReason = String(choice.finish_reason);
    const delta = choice?.delta;
    if (!delta) return;
    if (typeof delta.content === "string" && delta.content) {
      contentParts.push(delta.content);
      emit({ content: delta.content });
    }
    const reasoning =
      typeof delta.reasoning_content === "string"
        ? delta.reasoning_content
        : typeof delta.reasoning === "string"
          ? delta.reasoning
          : "";
    if (reasoning) {
      reasoningParts.push(reasoning);
      emit({ reasoning });
    }
    if (Array.isArray(delta.tool_calls)) {
      for (const tc of delta.tool_calls) {
        const index = Number(tc?.index ?? 0) || 0;
        let slot = toolSlots.get(index);
        if (!slot) {
          slot = { id: "", name: "", args: "" };
          toolSlots.set(index, slot);
        }
        if (tc?.id) slot.id = String(tc.id);
        const fn = tc?.function || {};
        if (fn.name) slot.name = String(fn.name);
        const argsPiece = typeof fn.arguments === "string" ? fn.arguments : "";
        if (argsPiece) slot.args += argsPiece;
        emit({
          toolCall: {
            index,
            ...(tc?.id ? { id: String(tc.id) } : {}),
            ...(fn.name ? { name: String(fn.name) } : {}),
            ...(argsPiece ? { arguments: argsPiece } : {}),
          },
        });
      }
    }
    return;
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
    finishReason,
    ...(usage ? { usage } : {}),
  };
}
