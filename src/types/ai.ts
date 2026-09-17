/**
 * AI 相关类型定义
 *
 * AI 设置（多供应商 / 多模型 / 全局规则）与统一对话契约（请求 / 增量 / 结果 /
 * 用量统计）+ AIApi 专用能力接口。三种对话协议（OpenAI Chat Completions /
 * OpenAI Responses / Anthropic Messages）在 AIApi.chat 内部归一到同一套
 * 契约形态，调用方无需感知协议差异。
 */

/* ==================== AI 设置（多供应商 / 多模型） ==================== */

/** 思考强度档位（随请求下发；各协议映射见 AIApi 实现） */
export type ThinkingIntensity = "low" | "medium" | "high" | "xhigh" | "max";

/** 对话协议类型（决定请求 / 响应的 wire 形态与鉴权方式） */
export type ChatProtocol = "openai-chat" | "openai-responses" | "anthropic";

/** 全部合法协议（设置页下拉与校验共用） */
export const CHAT_PROTOCOLS: ChatProtocol[] = ["openai-chat", "openai-responses", "anthropic"];

/** 协议的展示名（设置页下拉与 AI 工具页提示用） */
export const CHAT_PROTOCOL_LABELS: Record<ChatProtocol, string> = {
  "openai-chat": "OpenAI Chat Completions",
  "openai-responses": "OpenAI Responses",
  anthropic: "Anthropic Messages",
};

/** AI 模型配置（供应商「模型列表」项） */
export interface AiModelConfig {
  id: string; // 模型 id（请求的 model 参数）
  name: string; // 展示名称（空时回退显示模型 id）
  supportsThinking: boolean; // 是否支持思考（思考内容流式回传）
  /** 思考强度（模型支持思考时随请求下发） */
  thinkingIntensity?: ThinkingIntensity;
  inputContextLength?: number; // 输入上下文长度（token）
  outputContextLength?: number; // 输出上下文长度（token）
}

/**
 * AI 供应商配置：一个供应商 = 一组连接信息（协议 / 地址 / 密钥）+ 其下模型列表。
 * 模型的唯一标识为「供应商 id + 模型 id」二元组（模型 id 可跨供应商重名）。
 */
export interface AIProviderConfig {
  id: string; // 供应商 id（客户端生成，前缀 prv-）
  name: string; // 供应商名称（AI 工具页模型下拉显示为「供应商名/模型名」）
  protocol: ChatProtocol; // 对话协议
  baseUrl: string; // 服务地址（openai 系以 /v1 结尾；anthropic 兼容带或不带 /v1）
  apiKey: string; // API Key（openai 系 Bearer；anthropic 系 x-api-key）
  models: AiModelConfig[]; // 该供应商下的模型列表
}

/** AI 设置：多供应商 + 默认模型 + 全局规则 */
export interface AiSettings {
  providers: AIProviderConfig[]; // 供应商列表
  /** 默认模型（AI 工具页启动时选中的模型；仅运行时切换不写回设置） */
  currentModel?: { providerId: string; modelId: string };
  /** 全局规则（多行文本；非空时作为规则文本附加在 AI 工具的系统提示中） */
  globalRules?: string;
  /** 单次任务工具调用轮数上限（防失控；缺省 50，范围 1-500） */
  maxToolRounds?: number;
}

/* ==================== 统一对话契约（三协议归一） ==================== */

/** 工具调用（归一形态：assistant 消息携带，tool 消息按 id 回填结果） */
export interface ChatToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

/** 聊天消息（归一角色与字段子集；wire 转换见 AIApi 实现） */
export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | null;
  /** assistant 消息的工具调用列表 */
  toolCalls?: ChatToolCall[];
  /** tool 消息对应的调用 id */
  toolCallId?: string;
}

/** 工具定义（归一形态；wire 转换见 AIApi 实现） */
export interface ChatToolSpec {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>; // JSON Schema
  };
}

/** AIApi.chat 请求（provider 携带连接信息与协议；三协议共用一套归一契约） */
export interface ChatCompletionRequest {
  /** 供应商连接信息（协议 / 地址 / 密钥，按其 protocol 分派请求形态） */
  provider: AIProviderConfig;
  model: string; // 模型 id（provider.models 之一）
  messages: ChatMessage[]; // 对话消息（含 system / user / assistant / tool）
  tools?: ChatToolSpec[]; // 可调用工具定义（function calling）
  /** 思考强度（模型支持思考时生效；各协议映射为实现细节） */
  reasoningEffort?: ThinkingIntensity;
  /** 最大输出 token 数（anthropic 协议必填，未提供时实现方兜底） */
  maxTokens?: number;
  /** 取消信号（中止流式输出，abort 后以 reject 收尾） */
  signal?: AbortSignal;
}

/** 用量统计（三协议归一形态；流式末尾携带一次） */
export interface ChatUsage {
  promptTokens: number; // 输入 token（含系统提示与历史）
  completionTokens: number; // 输出 token（正文 + 思考）
  totalTokens: number; // 合计
}

/** 流式增量（SSE 每个分片解析出的增量；三类内容互斥到达） */
export interface ChatCompletionDelta {
  content?: string; // 正文增量
  reasoning?: string; // 思考增量（reasoning_content / reasoning / thinking 等协议字段归一）
  /** 工具调用增量（按 index 聚合：id/name 先到，arguments 分片追加） */
  toolCall?: {
    index: number;
    id?: string;
    name?: string;
    arguments?: string;
  };
  /** 用量统计（仅末尾携带一次，此时其他字段为空） */
  usage?: ChatUsage;
}

/** chat 结果（流结束后的聚合） */
export interface ChatCompletionResult {
  content: string; // 正文（无正文仅工具调用时为空串）
  reasoning?: string; // 思考内容
  toolCalls: ChatToolCall[]; // 本轮流到的工具调用（按 index 序）
  finishReason?: string; // stop / tool_calls / length 等（协议原始值归一）
  /** 用量统计（服务端返回 usage 时携带） */
  usage?: ChatUsage;
}

/* ==================== AIApi 专用能力接口 ==================== */

/** AIApi.fetch 请求（AI 的 fetch 工具经此发起网络请求） */
export interface AIFetchRequest {
  url: string; // 完整请求地址
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD";
  headers?: Record<string, string>; // 附加请求头
  body?: string; // 请求体（原样发送；通常为 JSON 文本）
  signal?: AbortSignal;
}

/** AIApi.fetch 结果（响应体读为文本，超长截断） */
export interface AIFetchResult {
  status: number; // HTTP 状态码
  statusText: string; // 状态文本
  headers: Record<string, string>; // 响应头（小写键）
  body: string; // 响应体文本（超长截断并附提示）
  truncated: boolean; // 响应体是否被截断
}

/**
 * AI 专用能力接口：AI 设置读写、对话（三协议）与网络请求。
 *
 * 与 ManagerApi（模型元素 / 字典 / 模板 / 设置等数据能力）相互独立：
 * AI 功能的全部专属调用（含 AI 工具面板的对话与 AI 设置工具）经本接口。
 * 全部方法返回 Promise，校验失败以 reject 抛出中文业务提示。
 */
export interface AIApi {
  /** 获取 AI 设置 */
  getAISettings(): Promise<AiSettings>;

  /** 保存 AI 设置（校验失败 reject 中文业务提示） */
  setAISettings(settings: AiSettings): Promise<void>;

  /**
   * 统一对话接口（流式）：按 provider.protocol 分派到
   * OpenAI Chat Completions / OpenAI Responses / Anthropic Messages，
   * 三协议的流式增量归一为 ChatCompletionDelta 经 onDelta 回调，
   * 流结束后 resolve 聚合结果；中止经 request.signal（abort 后 reject 收尾）。
   */
  chat(
    request: ChatCompletionRequest,
    onDelta?: (delta: ChatCompletionDelta) => void,
  ): Promise<ChatCompletionResult>;

  /** 网络请求（AI 的 fetch 工具经此发起；错误转中文提示） */
  fetch(request: AIFetchRequest): Promise<AIFetchResult>;
}
