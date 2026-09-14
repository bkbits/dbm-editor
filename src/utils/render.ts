/**
 * 代码模板渲染管线（基于 Eta 模板引擎）
 *
 * - 自定义标签 `<%# ... %>` 作为注释（渲染前剥离）
 * - useWith 模式：模板中直接使用 context / utils 顶层标识
 * - 模板内可对 context.fileName / context.filePath 赋值，渲染后回读
 */
import { Eta } from 'eta'
import type { TableVO, TemplateContext } from '@/types/model'
import { toCamelCase, toSnakeCase, isEmpty, isBlank, quote, wrap } from '@/utils/string'
import { getJavaType } from '@/utils/javaType'

const eta = new Eta({
  useWith: true, // 模板中直接访问 context / utils（无需 it. 前缀）
  autoEscape: false, // 生成代码不应转义
  autoTrim: false, // 保留换行，输出后处理统一清理
})

/** 注入模板的工具函数（utils） */
export const templateUtils = {
  toCamelCase,
  toSnakeCase,
  getJavaType,
  quote,
  wrap,
  isEmpty,
  isBlank,
}

/** 剥离自定义注释标签 <%# ... %> */
export function stripEtaComments(content: string): string {
  return String(content ?? '').replace(/<%#[\s\S]*?%>/g, '')
}

/** 生成结果后处理：清理标签行造成的空行/行尾空白 */
function postProcess(result: string): string {
  return String(result ?? '')
    .replace(/[ \t]+$/gm, '') // 行尾空白
    .replace(/\n{2,}/g, '\n') // 折叠连续空行
    .replace(/^\n+/, '') // 头部空行
    .replace(/\n+$/, '') // 尾部空行
}

export interface RenderOutput extends TemplateContext {
  error?: string // 渲染异常信息
}

/**
 * 渲染单个模板
 * @param templateName 模板名称
 * @param templateContent 模板内容（Eta 语法）
 * @param table 目标表 VO
 * @param basePackage 基础包名
 */
export function renderTemplate(
  templateName: string,
  templateContent: string,
  table: TableVO,
  basePackage: string,
): RenderOutput {
  const context: TemplateContext = {
    templateName,
    templateContent,
    result: '',
    basePackage: basePackage || '',
    fileName: '',
    filePath: '',
    language: '',
    table,
    /** 按数据库列名精确查询（模板内 context.hasColumn / context.getColumn 调用） */
    hasColumn: (columnName: string) => table.columns.some((c) => c.columnName === columnName),
    getColumn: (columnName: string) => table.columns.find((c) => c.columnName === columnName),
  }
  try {
    const cleaned = stripEtaComments(templateContent)
    const raw = eta.renderString(cleaned, { context, utils: templateUtils })
    context.result = postProcess(raw)
  } catch (err: unknown) {
    const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err)
    context.result = `⚠ 模板渲染失败：${msg}`
    return { ...context, error: msg }
  }
  // 模板未设置文件名/路径时给默认值（language 由模板内赋值，未赋值时由展示层按后缀自动识别）
  if (!context.fileName) {
    context.fileName = `${toCamelCase(table.className || table.tableName, true)}_${templateName}.txt`
  }
  if (!context.filePath) {
    const pkgPath = (basePackage || '').replace(/\./g, '/')
    context.filePath = pkgPath ? `${pkgPath}/${context.fileName}` : context.fileName
  }
  return { ...context }
}
