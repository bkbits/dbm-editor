/**
 * 字符串工具函数（同时作为模板引擎 utils 的一部分注入）
 */

/**
 * 转驼峰命名
 * @param str 源字符串（支持下划线/中划线/空格分隔，或已存在的驼峰）
 * @param firstLetterLowerCase 首字母是否小写（true=小驼峰，false/默认=大驼峰）
 */
export function toCamelCase(
  str: string | null | undefined,
  firstLetterLowerCase?: boolean,
): string {
  const s = String(str ?? '').trim()
  if (!s) return ''
  const hadSeparator = /[\s_\-.]/.test(s)
  let words: string[]
  if (hadSeparator) {
    words = s.split(/[\s_\-.]+/).filter(Boolean)
  } else {
    // 已是驼峰：在大写字母前分割（保留连续大写缩写，如 HTTPServer）
    words = s
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .split(/\s+/)
      .filter(Boolean)
  }
  const lower = words.map((w) => w.toLowerCase())
  let camel = lower.map((w, i) => (i === 0 ? w : w.charAt(0).toUpperCase() + w.slice(1))).join('')
  if (!camel) camel = s.toLowerCase()
  return firstLetterLowerCase ? camel : camel.charAt(0).toUpperCase() + camel.slice(1)
}

/** 转蛇形命名（sysUser -> sys_user） */
export function toSnakeCase(str: string | null | undefined): string {
  const s = String(str ?? '').trim()
  if (!s) return ''
  return s
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[\s\-.]+/g, '_')
    .replace(/_+/g, '_')
    .toLowerCase()
}

/** 判空（null/undefined/空字符串） */
export function isEmpty(str: unknown): boolean {
  return str == null || String(str).length === 0
}

/** 判空白（null/undefined/仅空白字符） */
export function isBlank(str: unknown): boolean {
  return str == null || String(str).trim().length === 0
}

/** 引号包裹：condition 为真时用双引号包裹内容，否则原样返回 */
export function quote(content: unknown, condition?: unknown): string {
  const text = String(content ?? '')
  return condition === undefined || condition ? `"${text}"` : text
}

/** 括号包裹：condition 为真时用圆括号包裹内容，否则原样返回 */
export function wrap(content: unknown, condition?: unknown): string {
  const text = String(content ?? '')
  return condition === undefined || condition ? `(${text})` : text
}
