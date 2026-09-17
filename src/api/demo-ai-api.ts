/**
 * DemoAIApi：AIApi 的内置演示实现
 *
 * AI 专属能力的缺省实现（与 DemoManagerApi 平行）：
 * - AI 设置读写：内存库（src/mock/db.ts）的 aiSettings 字段，
 *   多供应商校验（id 唯一 / 协议合法 / openai 系地址以 /v1 结尾 /
 *   模型 id 供应商内唯一）后写库落盘
 * - chat：按 provider.protocol 分派到三协议流式客户端
 *   （demo/ai/：openai-chat / openai-responses / anthropic-messages）
 * - fetch：浏览器 fetch 代理（响应体读为文本，超长截断；错误转中文提示）
 *
 * 全部方法经 Proxy 包装打调用日志（与 DemoManagerApi 一致的可观测性）。
 */
import type {
  AIApi,
  AIFetchRequest,
  AIFetchResult,
  AIProviderConfig,
  AiModelConfig,
  AiSettings,
  ChatCompletionDelta,
  ChatCompletionRequest,
  ChatCompletionResult,
  ThinkingIntensity,
} from "@/types/ai";
import { CHAT_PROTOCOLS, CHAT_PROTOCOL_LABELS } from "@/types/ai";
import { getDB, persistDB } from "@/mock/db";
import { DEFAULT_MAX_TOOL_ROUNDS, normalizeMaxToolRounds, withCallLogging } from "./demo/helpers";
import { chatViaOpenaiChat } from "./demo/ai/openai-chat";
import { chatViaOpenaiResponses } from "./demo/ai/openai-responses";
import { chatViaAnthropic } from "./demo/ai/anthropic-messages";

/** fetch 工具响应体上限（超出截断并附提示，防超长返回值撑爆上下文） */
const FETCH_BODY_CAP = 64 * 1024;

/**
 * 供应商内模型列表归一：模型 id 供应商内唯一、思考档位校验、上下文长度归一。
 * （模型 id 可跨供应商重名——唯一标识为「供应商 id + 模型 id」二元组）
 */
function normalizeModels(models: unknown): AiModelConfig[] {
  const list: AiModelConfig[] = [];
  const seen = new Set<string>();
  for (const raw of Array.isArray(models) ? (models as Array<Partial<AiModelConfig>>) : []) {
    const id = String(raw?.id ?? "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const supportsThinking = Boolean(raw?.supportsThinking);
    const intensity = raw?.thinkingIntensity;
    const thinkingIntensity: ThinkingIntensity | undefined = supportsThinking
      ? (["low", "medium", "high", "xhigh", "max"] as ThinkingIntensity[]).includes(
          intensity as ThinkingIntensity,
        )
        ? (intensity as ThinkingIntensity)
        : "medium"
      : undefined;
    list.push({
      id,
      name: String(raw?.name ?? "").trim() || id,
      supportsThinking,
      thinkingIntensity,
      inputContextLength:
        Math.max(0, Math.floor(Number(raw?.inputContextLength) || 0)) || undefined,
      outputContextLength:
        Math.max(0, Math.floor(Number(raw?.outputContextLength) || 0)) || undefined,
    });
  }
  return list;
}

/** AI 设置整备：供应商逐个归一校验（非法项直接抛中文业务提示） */
function normalizeProviders(input: unknown): AIProviderConfig[] {
  const providers: AIProviderConfig[] = [];
  const seenIds = new Set<string>();
  for (const raw of Array.isArray(input) ? (input as Array<Partial<AIProviderConfig>>) : []) {
    const id = String(raw?.id ?? "").trim();
    if (!id) throw new Error("供应商 id 不能为空");
    if (seenIds.has(id)) throw new Error(`供应商 id 重复：${id}`);
    seenIds.add(id);
    const protocol = raw?.protocol as AIProviderConfig["protocol"];
    if (!CHAT_PROTOCOLS.includes(protocol)) {
      throw new Error(`供应商 ${id} 的协议无效：${String(protocol)}`);
    }
    const baseUrl = String(raw?.baseUrl ?? "").trim();
    if (baseUrl) {
      if (!/^https?:\/\//i.test(baseUrl)) {
        throw new Error(`供应商 ${id} 的服务地址必须以 http:// 或 https:// 开头`);
      }
      // openai 系请求路径为 {baseUrl}/chat/completions 与 {baseUrl}/responses，
      // 地址须以 /v1 结尾；anthropic 兼容带或不带 /v1 两种写法
      if (protocol !== "anthropic" && !/\/v1\/?$/i.test(baseUrl)) {
        throw new Error(
          `供应商 ${id}（${CHAT_PROTOCOL_LABELS[protocol]}）的服务地址必须以 /v1 结尾（如 https://api.example.com/v1）`,
        );
      }
    }
    providers.push({
      id,
      name: String(raw?.name ?? "").trim() || `供应商${providers.length + 1}`,
      protocol,
      baseUrl,
      apiKey: String(raw?.apiKey ?? ""),
      models: normalizeModels(raw?.models),
    });
  }
  return providers;
}

/** DemoAIApi：AI 设置存取（mock 内存库）+ 三协议对话 + fetch 代理 */
export class DemoAIApi implements AIApi {
  constructor() {
    // 调用可观测性：全部方法经统一日志器打印入参与结果（与 DemoManagerApi 一致）
    return withCallLogging(this, "DemoAIApi");
  }

  /** 读取 AI 设置（旧库形态迁移在 mock/db.ts 读取时完成，此处仅归一兜底） */
  async getAISettings(): Promise<AiSettings> {
    const raw = getDB().aiSettings;
    const providers = normalizeProviders(raw?.providers);
    const current = raw?.currentModel;
    const currentModel =
      current &&
      providers.some(
        (p) => p.id === current.providerId && p.models.some((m) => m.id === current.modelId),
      )
        ? { providerId: String(current.providerId), modelId: String(current.modelId) }
        : providers[0]?.models.length
          ? { providerId: providers[0].id, modelId: providers[0].models[0].id }
          : undefined;
    return {
      providers,
      ...(currentModel ? { currentModel } : {}),
      globalRules: String(raw?.globalRules ?? ""),
      maxToolRounds: normalizeMaxToolRounds(raw?.maxToolRounds),
    };
  }

  /** 保存 AI 设置：供应商逐项校验后写库落盘（当前模型失效时归一到首个可用模型） */
  async setAISettings(settings: AiSettings): Promise<void> {
    const providers = normalizeProviders(settings?.providers);
    const current = settings?.currentModel;
    const valid =
      current &&
      providers.some(
        (p) => p.id === current.providerId && p.models.some((m) => m.id === current.modelId),
      );
    if (current && !valid) {
      throw new Error("默认模型指向的供应商或模型不存在，请重新选择");
    }
    const currentModel = valid
      ? { providerId: String(current!.providerId), modelId: String(current!.modelId) }
      : providers[0]?.models.length
        ? { providerId: providers[0].id, modelId: providers[0].models[0].id }
        : undefined;
    getDB().aiSettings = {
      providers,
      ...(currentModel ? { currentModel } : {}),
      globalRules: String(settings?.globalRules ?? ""),
      maxToolRounds: normalizeMaxToolRounds(settings?.maxToolRounds),
    };
    persistDB();
  }

  /** 统一对话：按供应商协议分派到对应流式客户端 */
  async chat(
    request: ChatCompletionRequest,
    onDelta?: (delta: ChatCompletionDelta) => void,
  ): Promise<ChatCompletionResult> {
    const protocol = request?.provider?.protocol;
    if (protocol === "openai-responses") return chatViaOpenaiResponses(request, onDelta);
    if (protocol === "anthropic") return chatViaAnthropic(request, onDelta);
    return chatViaOpenaiChat(request, onDelta);
  }

  /** 网络请求代理（AI 的 fetch 工具经此发起；响应体超长截断） */
  async fetch(request: AIFetchRequest): Promise<AIFetchResult> {
    const url = String(request?.url ?? "").trim();
    if (!url) throw new Error("请求地址不能为空");
    if (!/^(https?:)?\/\//i.test(url)) {
      throw new Error("请求地址必须以 http:// 或 https:// 开头");
    }
    let res: Response;
    try {
      res = await fetch(url, {
        method: request?.method || "GET",
        ...(request?.headers ? { headers: request.headers } : {}),
        ...(request?.body != null ? { body: request.body } : {}),
        signal: request?.signal,
      });
    } catch (e: unknown) {
      if ((e as Error)?.name === "AbortError") throw e;
      throw new Error(
        `请求失败（${url}）：${(e as Error)?.message || "网络错误"}；跨域或证书问题请检查服务端 CORS 配置`,
      );
    }
    const headers: Record<string, string> = {};
    res.headers.forEach((v, k) => {
      headers[k.toLowerCase()] = v;
    });
    const full = await res.text().catch(() => "");
    const truncated = full.length > FETCH_BODY_CAP;
    return {
      status: res.status,
      statusText: res.statusText || "",
      headers,
      body: truncated
        ? `${full.slice(0, FETCH_BODY_CAP)}\n…（响应体过长已截断，共 ${full.length} 字符）`
        : full,
      truncated,
    };
  }
}

export { DEFAULT_MAX_TOOL_ROUNDS };
