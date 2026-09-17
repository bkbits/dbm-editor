/**
 * DemoManagerApi · openai compatible 流式对话客户端（chatComplete 实现）
 *
 * 从原 demo-manager-api.ts 单文件拆出。职责：
 * - 读取持久化的 AI 设置（服务地址 / 密钥），组装 openai chat/completions
 *   请求体（camelCase 契约 → snake_case wire 形态；stream + include_usage）
 * - fetch 建流（网络 / HTTP / 空响应体错误转中文提示；AbortError 原样透传
 *   供停止生成语义）
 * - SSE 逐行解析：data: {chunk} 与 [DONE] 哨兵；四类增量聚合（正文 /
 *   思考 / 工具调用按 index 分槽拼接 / 用量归一）经 onDelta 增量回调
 *   （回调异常不中断消费），结束时聚合为 ChatCompletionResult
 */
import type {
  ChatCompletionDelta,
  ChatCompletionRequest,
  ChatCompletionResult,
  ChatUsage,
} from "@/types/ai";
import { getDB } from "@/mock/db";
import { toWireMessage } from "./helpers";

/** openai compatible 流式对话（DemoManagerApi.chatComplete 的实现体） */
export async function chatCompleteViaSse(
  request: ChatCompletionRequest,
  onDelta?: (delta: ChatCompletionDelta) => void,
): Promise<ChatCompletionResult> {
  const settings = getDB().aiSettings;
  const baseUrl = String(settings?.baseUrl ?? "")
    .trim()
    .replace(/\/+$/, "");
  if (!baseUrl) throw new Error("未配置 AI 服务地址，请先在「系统设置 → AI」中配置");
  const model = String(request?.model ?? "").trim();
  if (!model) throw new Error("缺少模型 id");

  const body: Record<string, unknown> = {
    model,
    messages: (request?.messages || []).map(toWireMessage),
    stream: true,
    // 请求末尾 usage 分片（openai compatible 标准方式；不支持的服务静默忽略）
    stream_options: { include_usage: true },
  };
  if (request?.tools?.length) body.tools = request.tools;
  if (request?.reasoningEffort) body.reasoning_effort = request.reasoningEffort;
  if (request?.maxTokens) body.max_tokens = request.maxTokens;

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (settings.apiKey) headers.Authorization = `Bearer ${settings.apiKey}`;

  let res: Response;
  try {
    res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: request?.signal,
    });
  } catch (e: unknown) {
    if ((e as Error)?.name === "AbortError") throw e;
    throw new Error(
      `无法连接 AI 服务（${baseUrl}）：${(e as Error)?.message || "网络错误"}；跨域或证书问题请检查服务端 CORS 配置`,
    );
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let detail = text;
    try {
      const parsed = JSON.parse(text) as { error?: { message?: string }; message?: string };
      detail = parsed?.error?.message || parsed?.message || text;
    } catch {
      /* 非 JSON 错误体原样展示 */
    }
    throw new Error(`AI 服务请求失败（HTTP ${res.status}）：${String(detail).slice(0, 400)}`);
  }
  const reader = res.body?.getReader();
  if (!reader) throw new Error("AI 服务未返回流式响应（响应体为空）");

  // SSE 逐行解析：data: {chunk} 与 [DONE] 哨兵；四类增量聚合（正文/思考/工具调用/用量）
  const decoder = new TextDecoder();
  const contentParts: string[] = [];
  const reasoningParts: string[] = [];
  const toolSlots = new Map<number, { id: string; name: string; args: string }>();
  let finishReason: string | undefined;
  let usage: ChatUsage | undefined;
  let doneSentinel = false;
  const emit = (delta: ChatCompletionDelta) => {
    if (!onDelta) return;
    try {
      onDelta(delta);
    } catch {
      /* 回调异常不中断流式消费 */
    }
  };
  let buffer = "";
  while (!doneSentinel) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith(":")) continue; // 空行 / SSE 注释与心跳
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (payload === "[DONE]") {
        doneSentinel = true;
        break;
      }
      let chunk: {
        usage?: {
          prompt_tokens?: number;
          completion_tokens?: number;
          total_tokens?: number;
        } | null;
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
        continue; // 非完整 JSON 分片（粘包残留）跳过
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
      if (!delta) continue;
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
    }
  }
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
