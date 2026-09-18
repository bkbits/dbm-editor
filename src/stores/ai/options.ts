/**
 * AI 仓库：选项块解析与选择文本构造
 * （【选项】块的模板常量、行解析与点击发送文本；与 task-list.ts 同构：
 *   头部行 + 项行，流式期间可重复调用——未写完的头部 / 项行也会被剔除，
 *   避免正文与选项区闪烁。选项区由 AiMessageItem 渲染为可点击按钮。）
 */

/** 选项块头部行：【选项】【选项·……】（整行仅为头部） */
const OPTION_HEADER_RE = /^\s*【选项[^】]*】?\s*$/;
/** 头部前缀（流式未写完形态，如 `【选`、`【选项`；含 `】` 但整行不匹配的不算） */
const OPTION_HEADER_PREFIX = "【选项";

/**
 * 选项项行：`1. 描述` / `A、描述` / `- 描述`（序号 / 字母 / 项目符号前缀可选）。
 * 捕获组：① 原始前缀字符（数字或字母；项目符号时为空→回退序号）② 描述文本。
 */
const OPTION_ITEM_RE = /^\s*(?:(\d{1,2}|[A-Za-z])[.、)）]\s*|[-*]\s+)(.+?)\s*$/;

/** 选项项（解析结果）：key 为原始前缀（用于选择文本与按钮角标），text 为清洗后描述 */
export interface AiOptionItem {
  key: string;
  text: string;
}

/** 选项描述清洗：去除 Markdown 强调 / 行内代码标记（按钮与选择文本用纯文本） */
function plainOption(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .trim();
}

/**
 * 解析文本中的选项块（【选项】），返回最后一个有效块解析出的选项列表
 * （无有效块为 null）与剔除选项块后的展示文本。流式期间可重复调用：
 * 未写完的头部（无 `】` 的前缀形态）/ 项行也会被剔除，避免闪烁。
 */
export function parseAiOptions(text: string): { options: AiOptionItem[] | null; cleaned: string } {
  const lines = String(text ?? "").split("\n");
  const kept: string[] = [];
  let options: AiOptionItem[] | null = null;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    // 整行即头部，或流式写了一半的头部前缀（已含 `】` 但整行不匹配的按普通文本保留）
    const isHeader =
      OPTION_HEADER_RE.test(line) ||
      (line.trimStart().startsWith(OPTION_HEADER_PREFIX) && !line.includes("】"));
    if (isHeader) {
      i += 1;
      const list: AiOptionItem[] = [];
      while (i < lines.length) {
        const m = OPTION_ITEM_RE.exec(lines[i]);
        if (!m) break;
        list.push({ key: m[1] || String(list.length + 1), text: plainOption(m[2]) });
        i += 1;
      }
      if (list.length) options = list;
      continue;
    }
    kept.push(line);
    i += 1;
  }
  const cleaned = kept
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^\n+/, "")
    .replace(/\n+$/, "");
  return { options, cleaned };
}

/** 点击选项后作为下一条用户消息发送的文本（模型侧据此对位到其输出的选项） */
export function optionChoiceText(option: AiOptionItem): string {
  return `选择方案 ${option.key}：${option.text}`;
}
