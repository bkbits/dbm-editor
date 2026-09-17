/**
 * highlight.js 代码高亮（按需注册语言，输出 HTML）
 */
import hljs from "highlight.js/lib/core";
import java from "highlight.js/lib/languages/java";
import sql from "highlight.js/lib/languages/sql";
import xml from "highlight.js/lib/languages/xml";
import javascript from "highlight.js/lib/languages/javascript";
import plaintext from "highlight.js/lib/languages/plaintext";
// highlights-eta 插件：Eta 模板语法（宿主文本走 xml 子语言，<% %> 标签内走 javascript 子语言）
// 注意：包入口 browser 字段指向的 dist 版依赖全局 hljs，这里深路径导入其 ESM 源码（类型见 env.d.ts）
import etaBase from "highlightjs-eta/src/languages/eta.js";
import type { LanguageFn } from "highlight.js";

/** 在插件 grammar 基础上增补 <%# %> 注释模式（官方 grammar 未区分注释，需置于标签模式之前以优先命中） */
const etaLanguage: LanguageFn = (hljs) => {
  const lang = etaBase(hljs);
  lang.contains = [hljs.COMMENT("<%#", "%>"), ...(lang.contains ?? [])];
  return lang;
};

hljs.registerLanguage("java", java);
hljs.registerLanguage("sql", sql);
hljs.registerLanguage("xml", xml);
hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("plaintext", plaintext);
hljs.registerLanguage("eta", etaLanguage);

/** 依据文件名推断语言 */
export function languageOfFileName(fileName: string): string {
  const ext = (fileName.split(".").pop() || "").toLowerCase();
  switch (ext) {
    case "java":
      return "java";
    case "sql":
      return "sql";
    case "xml":
    case "html":
    case "vue":
      return "xml";
    case "js":
    case "ts":
    case "mjs":
    case "cjs":
      return "javascript";
    case "eta":
    case "ejs":
      return "eta";
    default:
      return "plaintext";
  }
}

/**
 * 解析模板产物的有效高亮语言：
 * 模板内通过 context.language 显式指定（如 <% context.language = 'java' %>）时优先，
 * 未设置则按产物文件名后缀自动识别
 */
export function resolveLanguage(fileName: string, language?: string): string {
  const explicit = String(language ?? "")
    .trim()
    .toLowerCase();
  if (explicit) return explicit;
  return languageOfFileName(fileName);
}

/**
 * 模板源码高亮（Eta 语法：<% %> 逻辑 / <%= %> 输出 / <%# %> 注释，
 * 宿主文本与标签内表达式由 highlights-eta 插件 grammar 区分着色）
 */
export function highlightTemplateSource(code: string): string {
  return highlightCode(code || "", "eta");
}

/** 高亮代码，返回 HTML 字符串（hljs 自带 HTML 转义） */
export function highlightCode(code: string, language: string): string {
  try {
    if (language === "plaintext") return escapeHtml(code);
    return hljs.highlight(code, { language, ignoreIllegals: true }).value;
  } catch {
    return escapeHtml(code);
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
