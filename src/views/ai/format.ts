/**
 * AI 工具页共享展示格式化工具
 *
 * 从原 AiView.vue 单文件拆出（视图拆分）：聊天输入区（token 用量）与
 * 右侧能力调用记录（zip 尺寸 / 耗时 / 详情截断）共用的纯展示函数集中于此，
 * 供 AiChatPane / AiMessageItem / AiToolRecordsPane / AiReplaceConfirmModal 引用。
 */

/** 展示用 token 数：<10000 原样，≥10000 用 k/M 缩写（等宽字体下更紧凑） */
export function fmtTok(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${(n / 1000).toFixed(1)}k`;
  return String(Math.round(n));
}

/** 展示用文件大小：<1024 用字节，其余用 KB 一位小数 */
export function sizeText(size: number): string {
  return size >= 1024 ? `${(size / 1024).toFixed(1)} KB` : `${size} B`;
}

/** 展示用耗时：≥1000ms 用秒（一位小数），否则原样毫秒；空值返回空串 */
export function durationText(ms?: number): string {
  if (ms == null) return "";
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

/** 记录详情展示文本上限（超出截断，避免超长返回值撑爆面板） */
export const DISPLAY_CAP = 8000;

/** 展示文本截断（详情面板显示上限；顺带去头尾空白） */
export function capDisplay(text: string): string {
  const t = String(text ?? "").trim();
  return t.length > DISPLAY_CAP
    ? `${t.slice(0, DISPLAY_CAP)}\n…（内容过长已截断，共 ${t.length} 字符）`
    : t;
}
