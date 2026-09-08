/**
 * highlight.js 代码高亮（按需注册语言，输出 HTML）
 */
import hljs from 'highlight.js/lib/core'
import java from 'highlight.js/lib/languages/java'
import sql from 'highlight.js/lib/languages/sql'
import xml from 'highlight.js/lib/languages/xml'
import javascript from 'highlight.js/lib/languages/javascript'
import plaintext from 'highlight.js/lib/languages/plaintext'

hljs.registerLanguage('java', java)
hljs.registerLanguage('sql', sql)
hljs.registerLanguage('xml', xml)
hljs.registerLanguage('javascript', javascript)
hljs.registerLanguage('plaintext', plaintext)

/** 依据文件名推断语言 */
export function languageOfFileName(fileName: string): string {
  const ext = (fileName.split('.').pop() || '').toLowerCase()
  switch (ext) {
    case 'java':
      return 'java'
    case 'sql':
      return 'sql'
    case 'xml':
    case 'html':
    case 'vue':
      return 'xml'
    case 'js':
    case 'ts':
    case 'mjs':
    case 'cjs':
      return 'javascript'
    default:
      return 'plaintext'
  }
}

/** 高亮代码，返回 HTML 字符串（hljs 自带 HTML 转义） */
export function highlightCode(code: string, language: string): string {
  try {
    if (language === 'plaintext') return escapeHtml(code)
    return hljs.highlight(code, { language, ignoreIllegals: true }).value
  } catch {
    return escapeHtml(code)
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
