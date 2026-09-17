/**
 * AI 仓库：任务清单解析与渲染
 * （【任务清单·汇报】/【任务清单·同步】块的模板常量、行解析与状态映射；
 *   流式期间可重复调用：未写完的头部 / 项行也会被剔除，避免任务面板闪烁）
 */
import type { AiTaskItem, AiTaskStatus } from "./types";

/** 模板状态文案 → 状态机内值 */
const TASK_STATUS_BY_LABEL: Record<string, AiTaskStatus> = {
  执行中: "running",
  未开始: "pending",
  已完成: "completed",
  暂停: "paused",
};

/** 状态机内值 → 模板文案（注入暂停任务同步时复用模板格式） */
export const TASK_STATUS_LABEL: Record<AiTaskStatus, string> = {
  running: "执行中",
  pending: "未开始",
  completed: "已完成",
  paused: "暂停",
};

/** 任务清单块头部行：【任务清单】【任务清单·汇报】【任务清单·同步】（含流式未写完的前缀形态） */
const TASK_HEADER_RE = /^\s*【任务清单[^】]*】?\s*$/;
const TASK_HEADER_PREFIX = "【任务清单";
/** 任务项行：`1. [执行中] 任务描述`（序号可选） */
const TASK_ITEM_RE = /^\s*(?:\d+[.、)]\s*)?\[(执行中|未开始|已完成|暂停)\]\s*(.+?)\s*$/;

/** 任务清单模板头部（系统提示中约定的输出形态） */
export const TASK_HEADER_REPORT = "【任务清单·汇报】";
export const TASK_HEADER_SYNC = "【任务清单·同步】";

/** 按模板渲染任务清单块（注入暂停任务同步时复用模板格式） */
export function renderTaskBlock(header: string, tasks: AiTaskItem[]): string {
  return `${header}\n${tasks.map((t, i) => `${i + 1}. [${TASK_STATUS_LABEL[t.status]}] ${t.title}`).join("\n")}`;
}

/**
 * 解析文本中的任务清单块（【任务清单·汇报】/【任务清单·同步】），
 * 返回最后一个有效块解析出的任务列表（无有效块为 null）与剔除清单块后的展示文本。
 * 流式期间可重复调用：未写完的头部 / 项行也会被剔除，避免闪烁。
 */
export function parseAiTaskList(text: string): { tasks: AiTaskItem[] | null; cleaned: string } {
  const lines = String(text ?? "").split("\n");
  const kept: string[] = [];
  let tasks: AiTaskItem[] | null = null;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const isHeader = TASK_HEADER_RE.test(line) || line.trimStart().startsWith(TASK_HEADER_PREFIX);
    if (isHeader) {
      i += 1;
      const list: AiTaskItem[] = [];
      while (i < lines.length) {
        const m = TASK_ITEM_RE.exec(lines[i]);
        if (!m) break;
        list.push({ id: String(list.length), title: m[2], status: TASK_STATUS_BY_LABEL[m[1]] });
        i += 1;
      }
      if (list.length) tasks = list;
      continue;
    }
    kept.push(line);
    i += 1;
  }
  const cleaned = kept
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^\n+/, "");
  return { tasks, cleaned };
}

/** 从助手消息内容提取任务清单并写入仓库（无块时不动现有清单） */
export function syncTasksFromContent(store: { tasks: AiTaskItem[] }, text: string): void {
  const { tasks } = parseAiTaskList(text);
  if (tasks) store.tasks = tasks;
}
