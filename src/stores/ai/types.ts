/**
 * AI 仓库：展示模型与类型契约
 * （由 src/stores/ai.ts 按逻辑拆分而来：本文件只放界面展示形态的类型定义
 *   与工厂依赖声明，不含任何运行逻辑）
 */
import type { ChatToolSpec, ManagerApi } from "@/types/model";
import type { DictStore } from "../dict";
import type { ModelStore } from "../model";
import type { SettingsStore } from "../settings";
import type { TemplateStore } from "../template";

/* ==================== 会话展示模型 ==================== */

/** 助手消息携带的工具调用摘要（展示用；完整记录见 AiToolRecord） */
export interface AiChatToolCall {
  id: string; // 与 ChatToolCall.id 对应（点击可定位右侧记录）
  name: string;
  args: string; // 原始 JSON 参数文本
  /** 技能加载调用的展示信息（loadSkill 专用样式：加载了哪个技能的哪些部分） */
  skill?: { name: string; title: string; parts: string[] };
}

/** 会话消息（左侧聊天区展示形态） */
export interface AiChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  /** 思考内容（reasoning 流式聚合） */
  reasoning?: string;
  /** 思考块展开态：流式输出思考时自动展开，消息完成后自动收起（用户可随时手动切换） */
  reasoningOpen?: boolean;
  /** 本条消息触发的工具调用（展示摘要） */
  toolCalls?: AiChatToolCall[];
  status: "streaming" | "done" | "error" | "aborted";
  error?: string;
  createdAt: number;
  /** token 用量：user 消息 = 该问题全部轮次输入/输出合计；assistant 消息 = 本轮 usage */
  tokens?: { input: number; output: number };
  /** 输出速度（tok/s；assistant 消息本轮真实速度，usage 到达时计算） */
  speedTokSec?: number;
  /** 发送给模型的实际内容（含系统附加信息如暂停任务同步；缺省回退 content） */
  modelContent?: string;
  /** 上下文自动压缩标记：此消息之前的历史已被压缩为 summary（重建模型序列时以此为界） */
  compact?: { summary: string };
}

/* ==================== 任务清单 ==================== */

/** 任务状态（与模板文案一一对应） */
export type AiTaskStatus = "running" | "pending" | "completed" | "paused";

/** 任务项（左侧任务面板展示形态） */
export interface AiTaskItem {
  id: string;
  title: string;
  status: AiTaskStatus;
}
/** 能力调用记录（右侧面板展示形态） */
export interface AiToolRecord {
  id: string;
  /** 对应 ChatToolCall.id（聊天区工具芯片点击定位用；zip 下载也按此索引） */
  callId: string;
  name: string;
  argsText: string; // 参数（pretty JSON / 原始文本）
  resultText: string; // 返回值（pretty JSON）或错误信息
  status: "running" | "success" | "error";
  durationMs?: number;
  createdAt: number;
  /** 技能加载记录（loadSkill 专用样式：加载了哪个技能的哪些部分） */
  kind?: "skill";
  skill?: { name: string; title: string; parts: string[] };
}

/** 代码生成产物的 zip 下载缓存（Blob URL，会话内可重复下载） */
export interface AiZipDownload {
  fileName: string;
  url: string;
  size: number;
  fileCount: number;
  createdAt: number;
}

/** 代码替换确认弹窗中的待替换文件 */
export interface AiReplaceFile {
  fileName: string;
  filePath: string;
  templateName: string;
  tableName: string;
  size: number;
}

/** 待确认的代码替换（弹窗确认 / 取消后 resolve） */
export interface AiPendingReplace {
  files: AiReplaceFile[];
  resolve: (ok: boolean) => void;
}

/* ==================== 工具注册表 ==================== */

/** 工具改动后会话结束需同步刷新的仓库域 */
export type ToolDomain = "model" | "dict" | "template" | "settings";

/** 工具执行上下文（调用记录关联 zip 下载等界面态） */
export interface ToolInvokeCtx {
  callId: string;
}

/** AGENT 工具（openai function calling 形态 + 执行器） */
export interface AgentTool {
  spec: ChatToolSpec;
  domains: ToolDomain[];
  /** 界面专用样式标记：skill = 技能加载（独立样式展示加载内容） */
  kind?: "skill";
  invoke: (args: Record<string, unknown>, ctx: ToolInvokeCtx) => Promise<unknown>;
}

/** 工厂依赖 */
export interface AiDeps {
  getApi: () => ManagerApi;
  getModel: () => ModelStore;
  getDict: () => DictStore;
  getTemplate: () => TemplateStore;
  getSettings: () => SettingsStore;
}

/** 界面态钩子（zip 缓存注册 / 代码替换确认），由仓库实例提供 */
export interface AgentHooks {
  /** 代码生成完成后注册 zip 下载缓存（按 callId 索引） */
  registerZip: (callId: string, blob: Blob, fileName: string, fileCount: number) => void;
  /** 代码替换前弹出确认（用户确认 resolve(true)、取消 resolve(false)） */
  requestReplaceConfirm: (files: AiReplaceFile[]) => Promise<boolean>;
}
