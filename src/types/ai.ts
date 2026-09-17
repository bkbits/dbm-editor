/**
 * AI（openai compatible）相关类型定义
 *
 * AI 设置（供应商 / 模型列表 / 思考强度 / 全局规则）与 chat completions
 * 标准流式契约（请求 / 增量 / 结果 / 用量统计）；ManagerApi 的 AI 方法
 * 引用本文件类型。
 */

/* ==================== AI（openai compatible） ==================== */

/** 思考强度档位（随请求以 reasoning_effort 下发，openai compatible 服务约定取值） */
export type ThinkingIntensity = "low" | "medium" | "high" | "xhigh" | "max";

/** AI 模型配置（AI 设置「模型列表」项） */
export interface AiModelConfig {
  id: string; // 模型 id（openai compatible 接口的 model 参数）
  name: string; // 展示名称（空时回退显示模型 id）
  supportsThinking: boolean; // 是否支持思考（思考内容经 reasoning_content 流式回传）
  /** 思考强度（模型支持思考时随请求下发） */
  thinkingIntensity?: ThinkingIntensity;
  inputContextLength?: number; // 输入上下文长度（token）
  outputContextLength?: number; // 输出上下文长度（token）
}

/** AI 设置：供应商（openai compatible）+ 模型列表 + 全局规则 */
export interface AiSettings {
  baseUrl: string; // 服务地址（必须以 /v1 结尾，如 https://api.example.com/v1）
  apiKey: string; // API Key（Bearer 鉴权；本地服务可留空）
  models: AiModelConfig[]; // 模型列表
  /** 全局规则（多行文本；非空时作为规则文本附加在 AI 工具的系统提示中） */
  globalRules?: string;
  /** 单次任务工具调用轮数上限（防失控；缺省 50，范围 1-500） */
  maxToolRounds?: number;
}

/* ---------- openai chat completions 标准流式契约 ---------- */

/** 工具调用（openai 标准形态：assistant 消息携带，tool 消息按 id 回填结果） */
export interface ChatToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

/** 聊天消息（openai chat completions 标准角色与字段子集） */
export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | null;
  /** assistant 消息的工具调用列表 */
  toolCalls?: ChatToolCall[];
  /** tool 消息对应的调用 id */
  toolCallId?: string;
}

/** 工具定义（openai function calling 标准形态） */
export interface ChatToolSpec {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>; // JSON Schema
  };
}

/** chatComplete 请求 */
export interface ChatCompletionRequest {
  model: string; // 模型 id
  messages: ChatMessage[]; // 对话消息（含 system / user / assistant / tool）
  tools?: ChatToolSpec[]; // 可调用工具定义（function calling）
  /** 思考强度（模型支持思考时生效） */
  reasoningEffort?: ThinkingIntensity;
  /** 最大输出 token 数 */
  maxTokens?: number;
  /** 取消信号（中止流式输出，abort 后以 reject 收尾） */
  signal?: AbortSignal;
}

/** 用量统计（openai usage 归一形态；流式需 stream_options.include_usage 请求，末尾分片携带） */
export interface ChatUsage {
  promptTokens: number; // 输入 token（含系统提示与历史）
  completionTokens: number; // 输出 token（正文 + 思考）
  totalTokens: number; // 合计
}

/** 流式增量（SSE 每个分片解析出的增量；三类内容互斥到达） */
export interface ChatCompletionDelta {
  content?: string; // 正文增量
  reasoning?: string; // 思考增量（reasoning_content / reasoning 字段）
  /** 工具调用增量（按 index 聚合：id/name 先到，arguments 分片追加） */
  toolCall?: {
    index: number;
    id?: string;
    name?: string;
    arguments?: string;
  };
  /** 用量统计（仅末尾 usage 分片携带一次，此时其他字段为空） */
  usage?: ChatUsage;
}

/** chatComplete 结果（流结束后的聚合） */
export interface ChatCompletionResult {
  content: string; // 正文（无正文仅工具调用时为空串）
  reasoning?: string; // 思考内容
  toolCalls: ChatToolCall[]; // 本轮流到的工具调用（按 index 序）
  finishReason?: string; // stop / tool_calls / length 等
  /** 用量统计（服务端返回 usage 时携带） */
  usage?: ChatUsage;
}
