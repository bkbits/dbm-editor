/**
 * 代码模板渲染管线（基于 Eta 模板引擎）
 *
 * - 自定义标签 `<%# ... %>` 作为注释（渲染前剥离）
 * - useWith 模式：模板中直接使用 context / utils 顶层标识
 * - 模板内可对 context.fileName / context.filePath 赋值，渲染后回读
 * - 模板内可置 context.aborted = true 丢弃本次生成（产物不进 zip）
 * - 后处理保证：最后一条 import 与后续代码之间恰好空一行
 */
import { Eta } from 'eta'
import type {
  Dict,
  DictCategory,
  DictCategoryTemplateContext,
  Settings,
  TableVO,
  TableTemplateContext,
} from '@/types/model'
import {
  toCamelCase,
  toSnakeCase,
  isEmpty,
  isBlank,
  quote,
  wrap,
  nowDateTime,
} from '@/utils/string'
import { getJavaType } from '@/utils/javaType'

const eta = new Eta({
  useWith: true, // 模板中直接访问 context / utils（无需 it. 前缀）
  autoEscape: false, // 生成代码不应转义
  autoTrim: false, // 保留换行，输出后处理统一清理
})

/** 选项取值形态（TableOption / ColumnOption 共有结构） */
type OptionBag = Record<string, { name?: string; value?: boolean | string | number }>

/**
 * 读取 boolean 选项是否启用：值缺省（未设置）时默认启用。
 * 供模板按表/列选项分支生成代码：utils.optionEnabled(context.table.options, "add")
 */
export function optionEnabled(options: OptionBag | undefined | null, name: string): boolean {
  const v = options?.[name]?.value
  return v === undefined || v === null ? true : Boolean(v)
}

/** 注入模板的工具函数（utils） */
export const templateUtils = {
  toCamelCase,
  toSnakeCase,
  getJavaType,
  quote,
  wrap,
  isEmpty,
  isBlank,
  nowDateTime,
  optionEnabled,
}

/** settings 缺省兜底（调用方未传设置时：无作者、无选项定义，全部按默认启用） */
const FALLBACK_SETTINGS: Settings = {
  indexTypes: [],
  typeMappings: [],
  author: '',
  tableOptions: [],
  columnOptions: [],
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

/**
 * 格式保证：最后一条 import 语句与后续代码之间恰好空一行。
 * 兼容 java（`import a.B;`）与 js/ts/vue（单行/多行 `import ... from '...'`）形态；
 * 无 import 或 import 后本就为空行/文件末尾时原样返回。
 */
function ensureBlankLineAfterImports(text: string): string {
  const lines = text.split('\n')
  let inImport = false
  let lastImportEnd = -1
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!inImport && /^import[\s('"]/.test(line)) inImport = true
    if (inImport) {
      // 语句结束判定：java 以 ; 结尾；js/ts 以 from '...' 或裸模块说明符结尾
      if (
        /;\s*$/.test(line) ||
        /from\s+['"][^'"]*['"]\s*$/.test(line) ||
        /^import\s+['"][^'"]*['"]\s*$/.test(line)
      ) {
        lastImportEnd = i
        inImport = false
      }
    }
  }
  if (
    lastImportEnd >= 0 &&
    lastImportEnd < lines.length - 1 &&
    lines[lastImportEnd + 1].trim() !== ''
  ) {
    lines.splice(lastImportEnd + 1, 0, '')
  }
  return lines.join('\n')
}

export interface RenderOutput extends TableTemplateContext {
  error?: string // 渲染异常信息
}

/** 字典分类模板渲染输出 */
export interface DictCategoryRenderOutput extends DictCategoryTemplateContext {
  error?: string // 渲染异常信息
}

/**
 * 渲染单个模板
 * @param templateName 模板名称
 * @param templateContent 模板内容（Eta 语法）
 * @param table 目标表 VO
 * @param basePackage 基础包名
 * @param settings 应用设置（作者/选项元定义等；缺省使用空设置兜底）
 */
export function renderTemplate(
  templateName: string,
  templateContent: string,
  table: TableVO,
  basePackage: string,
  settings?: Settings,
): RenderOutput {
  const context: TableTemplateContext = {
    templateName,
    templateContent,
    result: '',
    basePackage: basePackage || '',
    fileName: '',
    filePath: '',
    language: '',
    table,
    settings: settings || FALLBACK_SETTINGS,
    aborted: false,
    /** 按数据库列名精确查询（模板内 context.hasColumn / context.getColumn 调用） */
    hasColumn: (columnName: string) => table.columns.some((c) => c.columnName === columnName),
    getColumn: (columnName: string) => table.columns.find((c) => c.columnName === columnName),
  }
  let failed = false
  try {
    const cleaned = stripEtaComments(templateContent)
    const raw = eta.renderString(cleaned, { context, utils: templateUtils })
    context.result = postProcess(raw)
  } catch (err: unknown) {
    failed = true
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
  // 格式保证：import 块与后续代码之间空一行（aborted 丢弃场景无产物，无需处理）
  if (!context.aborted && !failed) {
    context.result = ensureBlankLineAfterImports(context.result)
  }
  return { ...context }
}

/**
 * 渲染字典分类模板（每个字典分类执行一次，产物包含分类下全部字典与值）
 * @param templateName 模板名称
 * @param templateContent 模板内容（Eta 语法）
 * @param category 字典分类
 * @param dicts 该分类下的全部字典（含值）
 * @param settings 应用设置（缺省使用空设置兑底）
 */
export function renderDictCategoryTemplate(
  templateName: string,
  templateContent: string,
  category: DictCategory,
  dicts: Dict[],
  settings?: Settings,
): DictCategoryRenderOutput {
  const context: DictCategoryTemplateContext = {
    templateName,
    templateContent,
    result: '',
    fileName: '',
    filePath: '',
    language: '',
    category,
    dicts,
    settings: settings || FALLBACK_SETTINGS,
    aborted: false,
  }
  let failed = false
  try {
    const cleaned = stripEtaComments(templateContent)
    const raw = eta.renderString(cleaned, { context, utils: templateUtils })
    context.result = postProcess(raw)
  } catch (err: unknown) {
    failed = true
    const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err)
    context.result = `⚠ 模板渲染失败：${msg}`
    return { ...context, error: msg }
  }
  // 默认产物路径：分类文件（file）优先；模板内可对 fileName/filePath 赋值覆盖
  const file = String(category.file || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .trim()
  if (!context.fileName) {
    context.fileName = file ? file.split('/').pop() || '' : `${category.name}DictConstants.java`
  }
  if (!context.filePath) {
    context.filePath = file || context.fileName
  }
  if (!context.aborted && !failed) {
    context.result = ensureBlankLineAfterImports(context.result)
  }
  return { ...context }
}
