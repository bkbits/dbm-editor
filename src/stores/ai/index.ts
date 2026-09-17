/**
 * AI 仓库模块出口（barrel）
 *
 * 拆分后对外的唯一导入面：保持与拆分前 src/stores/ai.ts 相同的公开导出，
 * 外部（stores/context.ts、views/AiView.vue、components/settings/AiSettingsSection.vue）
 * 无需改动导入路径。
 *
 * 内部结构：
 * - types.ts       展示模型与类型契约（会话消息 / 任务项 / 工具记录 / 依赖与钩子）
 * - task-list.ts   任务清单块解析与渲染
 * - tool-schema.ts 工具参数 JSON Schema
 * - codegen.ts     代码生成共用逻辑
 * - prompt.ts      系统提示与上下文压缩提示
 * - tools.ts       AGENT 工具注册表构建
 * - store.ts       会话状态与运行编排（createAiStore / useAiStore）
 */
export type {
  AiChatMessage,
  AiChatToolCall,
  AiDeps,
  AiPendingDanger,
  AiPendingReplace,
  AiReplaceFile,
  AiTaskItem,
  AiTaskStatus,
  AiToolRecord,
  AiZipDownload,
} from "./types";
export { TASK_STATUS_LABEL, parseAiTaskList } from "./task-list";
export { createAiStore, useAiStore, modelKeyOf, splitModelKey } from "./store";
export type { AiStore, AiModelPair } from "./store";
