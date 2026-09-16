/**
 * Mock 数据库（demo 数据存储）：内存数据 + localStorage 持久化
 *
 * 由 DemoManagerApi 直接读写；原 axios mock 分发层已被 ManagerApi 体系取代。
 * 持久化键保持 v2 不变，读取时按需迁移（设置形态 / hidden 字段 / 模板种子版本）。
 */
import type {
  AiModelConfig,
  AiSettings,
  CodeTemplate,
  Dict,
  DictCategory,
  OptionSetting,
  Settings,
  Table,
  TableColumn,
  TableCategory,
  TableIndex,
  TableNavigate,
  ThinkingIntensity,
  TypeMapping,
} from '@/types/model'
import { DEFAULT_AI_GLOBAL_RULES } from '@/ai/defaults'
import { normalizeFieldConventions } from '@/utils/fieldConvention'
import { toCamelCase } from '@/utils/string'
import {
  SEED_CATEGORIES,
  SEED_COLUMN_OPTIONS,
  SEED_DICTS,
  SEED_DICT_CATEGORIES,
  SEED_DICT_CATEGORY_TEMPLATE,
  SEED_HIDDEN_TABLE_NAMES,
  SEED_NAVIGATES,
  SEED_SETTINGS,
  SEED_TABLES,
  SEED_TABLE_OPTIONS,
  SEED_TEMPLATES,
} from './seed'

const STORAGE_KEY = 'gdbme:db:v2'
const LEGACY_STORAGE_KEYS = ['gdbme:db:v1']
/**
 * 模板种子版本：种子模板集发生变更时递增（1=通用四件套，2=solon3 七件套，
 * 3=entity 模板 easy-query 规范化，4=八件套：新增 mapper（MapStruct），
 * java 模板全面升级——javadoc/@author/@since、@EntityProxy + ProxyEntityAvailable、
 * swagger2 注解、表/列选项驱动条件生成、import 块与代码间空行，
 * 5=controller/vue/menuSql 路径与权限码风格升级——/api/模块/功能/操作、
 * 模块.功能.操作权限码、查询条件三分支（时间 rangeClosed / id 与字典 eq / 字符串 like））。
 * 旧库不含 seedTemplatesVersion 字段（视为 1），读取时低于当前值即整体替换为
 * 最新种子模板集并回写版本号——与「用户是否删过某个种子模板」无关，杜绝形态
 * 嗅探漏判；此后用户对模板的增删改不再被种子覆盖（版本号已是最新）。
 */
const SEED_TEMPLATES_VERSION = 5
/**
 * 字典分类模板种子版本（独立于表模板版本）：1=Task31 初版（分类文件 file 推导
 * 产物路径、数字值键 int 常量），2=常量值统一 String 类型、常量名取字典值
 * 的常量属性名（propertyName）、产物路径按 basePackage/className 推导。
 * 旧库无此字段（视为 1）：低于当前值时整体替换为最新种子并回写版本号。
 */
const DICT_TEMPLATE_SEED_VERSION = 2

export interface MockDB {
  version: number
  /** 模板种子版本（旧库无此字段 = 1）：低于当前值时读取时升级模板种子 */
  seedTemplatesVersion?: number
  /** 字典分类模板种子版本（旧库无此字段 = 1）：低于当前值时读取时替换字典分类模板 */
  dictTemplateSeedVersion?: number
  categories: TableCategory[]
  tables: Table[]
  columns: TableColumn[]
  indexes: TableIndex[]
  navigates: TableNavigate[]
  /** 字典分类（v6 新增：旧库读取时补种子并按种子映射迁移字典归属） */
  dictCategories: DictCategory[]
  dicts: Dict[]
  templates: CodeTemplate[]
  /** 字典分类模板（仅一个；v6 新增：旧库读取时补种子） */
  dictCategoryTemplate: CodeTemplate
  settings: Settings
  /** AI 设置（openai compatible 供应商 / 模型列表 / 全局规则；旧库读取时补空缺省） */
  aiSettings: AiSettings
}

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T
}

function createSeedDB(): MockDB {
  const columns: TableColumn[] = []
  const indexes: TableIndex[] = []
  const tables: Table[] = SEED_TABLES.map((t) => {
    columns.push(...t.columns)
    if (t.indexes?.length) indexes.push(...t.indexes)
    const { columns: _c, indexes: _i, ...table } = t
    return table as Table
  })
  return {
    version: 2,
    seedTemplatesVersion: SEED_TEMPLATES_VERSION,
    dictTemplateSeedVersion: DICT_TEMPLATE_SEED_VERSION,
    categories: clone(SEED_CATEGORIES),
    tables,
    columns,
    indexes,
    navigates: clone(SEED_NAVIGATES),
    dictCategories: clone(SEED_DICT_CATEGORIES),
    dicts: clone(SEED_DICTS),
    templates: clone(SEED_TEMPLATES),
    dictCategoryTemplate: clone(SEED_DICT_CATEGORY_TEMPLATE),
    settings: clone(SEED_SETTINGS),
    aiSettings: {
      baseUrl: '',
      apiKey: '',
      models: [],
      // 新库开箱即带默认任务流程约定（旧库已保存值不受影响，含主动清空的空串）
      globalRules: DEFAULT_AI_GLOBAL_RULES,
    },
  }
}

/** 选项定义归一：保留合法定义，缺字段时兕底（boolean 类型/标签回退名称） */
function normalizeOptionSettings(raw: unknown, fallback: OptionSetting[]): OptionSetting[] {
  if (!Array.isArray(raw)) return clone(fallback)
  const list = raw
    .map((o: Partial<OptionSetting>) => ({
      name: String(o?.name ?? '').trim(),
      type: String(o?.type ?? 'boolean').trim() || 'boolean',
      label: String(o?.label ?? '').trim(),
      remark: String(o?.remark ?? '').trim() || undefined,
      dict: String(o?.dict ?? '').trim() || undefined,
    }))
    .filter((o) => o.name)
    .map((o) => ({ ...o, label: o.label || o.name }))
  return list.length ? list : clone(fallback)
}

/** 旧版设置读取时归一为完整 Settings 形态（保留已有 indexTypes/typeMappings/author，补齐选项定义与字段约定） */
function normalizeSettings(raw: unknown): Settings {
  const s = (raw || {}) as {
    indexTypes?: unknown
    typeMappings?: unknown
    columnTypeRules?: unknown
    author?: unknown
    tableOptions?: unknown
    columnOptions?: unknown
    fieldConventions?: unknown
  }
  const typeMappings: TypeMapping[] = Array.isArray(s.typeMappings)
    ? s.typeMappings.map((m: Partial<TypeMapping>, i: number) => ({
        sort: Number(m?.sort ?? i) || i,
        pattern: String(m?.pattern ?? '').trim(),
        javaType: String(m?.javaType ?? 'String'),
      }))
    : Array.isArray(s.columnTypeRules)
      ? s.columnTypeRules.map((r: { pattern?: unknown; javaType?: unknown }, i: number) => ({
          sort: i,
          pattern: String(r?.pattern ?? '').trim(),
          javaType: String(r?.javaType ?? 'String'),
        }))
      : clone(SEED_SETTINGS.typeMappings)
  const indexTypes: string[] =
    Array.isArray(s.indexTypes) && s.indexTypes.length
      ? s.indexTypes.map((t: unknown) => String(t).trim().toUpperCase()).filter(Boolean)
      : clone(SEED_SETTINGS.indexTypes)
  const author = String(s.author ?? '').trim() || undefined
  const tableOptions = normalizeOptionSettings(s.tableOptions, SEED_TABLE_OPTIONS)
  const columnOptions = normalizeOptionSettings(s.columnOptions, SEED_COLUMN_OPTIONS)
  const fieldConventions = normalizeFieldConventions(s.fieldConventions)
  return { indexTypes, typeMappings, author, tableOptions, columnOptions, fieldConventions }
}

/** 思考强度合法档位（AI 模型配置校验用） */
const THINKING_INTENSITIES: ThinkingIntensity[] = ['low', 'medium', 'high', 'xhigh', 'max']

/**
 * AI 设置读取时归一：保留用户已配置内容，逐字段兜底形态；
 * 模型列表去重（按 id）、思考强度非法值回退 medium、上下文长度归一为非负整数
 */
function normalizeAiSettings(raw: unknown): AiSettings {
  const s = (raw || {}) as {
    baseUrl?: unknown
    apiKey?: unknown
    models?: unknown
    globalRules?: unknown
  }
  const models: AiModelConfig[] = []
  const seen = new Set<string>()
  if (Array.isArray(s.models)) {
    for (const m of s.models as Array<Partial<AiModelConfig>>) {
      const id = String(m?.id ?? '').trim()
      if (!id || seen.has(id)) continue
      seen.add(id)
      const supportsThinking = Boolean(m?.supportsThinking)
      const intensity = THINKING_INTENSITIES.includes(m?.thinkingIntensity as ThinkingIntensity)
        ? (m?.thinkingIntensity as ThinkingIntensity)
        : 'medium'
      models.push({
        id,
        name: String(m?.name ?? '').trim() || id,
        supportsThinking,
        thinkingIntensity: supportsThinking ? intensity : undefined,
        inputContextLength:
          Math.max(0, Math.floor(Number(m?.inputContextLength) || 0)) || undefined,
        outputContextLength:
          Math.max(0, Math.floor(Number(m?.outputContextLength) || 0)) || undefined,
      })
    }
  }
  return {
    baseUrl: String(s.baseUrl ?? '').trim(),
    apiKey: String(s.apiKey ?? ''),
    models,
    globalRules: String(s.globalRules ?? ''),
  }
}

function loadDB(): MockDB {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as MockDB
      if (parsed && parsed.version === 2 && Array.isArray(parsed.tables)) {
        let migrated = false
        // 兼容旧数据（设置字段形态升级 / 缺失）：读取时迁移并立即归一落盘。
        // v4 起设置新增 author / tableOptions / columnOptions，任一缺失即归一补齐；
        // v5 起新增 fieldConventions（主键与审计字段约定），缺省同样补齐默认值
        const s = parsed.settings as
          | {
              author?: unknown
              tableOptions?: unknown
              columnOptions?: unknown
              fieldConventions?: unknown
            }
          | undefined
        if (
          !parsed.settings ||
          !Array.isArray(parsed.settings.typeMappings) ||
          s?.tableOptions === undefined ||
          s?.columnOptions === undefined ||
          s?.author === undefined ||
          s?.fieldConventions === undefined
        ) {
          parsed.settings = normalizeSettings(parsed.settings)
          migrated = true
        }
        // v5.1：审计字段默认名由驼峰改为蛇形（create_by 等）。旧库存的恰好是
        // 旧默认驼峰名时（用户未自定义的特征签名）升级为新默认蛇形名
        const audit = (
          parsed.settings as
            | { fieldConventions?: { auditFields?: Record<string, { name?: string }> } }
            | undefined
        )?.fieldConventions?.auditFields
        if (
          audit &&
          (['createBy', 'createTime', 'updateBy', 'updateTime'] as const).every(
            (role) => audit[role]?.name === role,
          )
        ) {
          audit.createBy!.name = 'create_by'
          audit.createTime!.name = 'create_time'
          audit.updateBy!.name = 'update_by'
          audit.updateTime!.name = 'update_time'
          migrated = true
        }
        // 旧版 hidden 存于独立 localStorage 键（gdbme:hidden），模型未带 hidden 字段：
        // 读取时按旧键合并（存在即读），否则按种子隐藏表名补齐，随即归一落盘
        if (parsed.tables.some((t) => typeof t.hidden !== 'boolean')) {
          const legacyHidden = readLegacyHidden()
          parsed.tables = parsed.tables.map((t) => ({
            ...t,
            hidden: legacyHidden
              ? legacyHidden.includes(t.id)
              : SEED_HIDDEN_TABLE_NAMES.has(t.tableName),
          }))
          migrated = true
        }
        // 模板种子版本升级（1=通用四件套 → 2=solon3 七件套）：旧库无版本字段，
        // 一律整体替换为当前种子模板集（含用户曾删光模板的场景）并回写版本号
        if (
          !Array.isArray(parsed.templates) ||
          (parsed.seedTemplatesVersion ?? 1) < SEED_TEMPLATES_VERSION
        ) {
          parsed.templates = clone(SEED_TEMPLATES)
          parsed.seedTemplatesVersion = SEED_TEMPLATES_VERSION
          migrated = true
        }
        // v6：字典分类 + 字典分类模板。旧库无 dictCategories/dictCategoryTemplate：
        // 补种子分类，字典按种子 dictKey 映射补 categoryId（未匹配保持未分类），
        // 字典分类模板补种子（独立于表模板版本，用户编辑过即保留）
        if (!Array.isArray(parsed.dictCategories)) {
          parsed.dictCategories = clone(SEED_DICT_CATEGORIES)
          const seedCatOf = new Map(SEED_DICTS.map((d) => [d.dictKey, d.categoryId || ''] as const))
          for (const d of parsed.dicts) {
            if (!d.categoryId) d.categoryId = seedCatOf.get(d.dictKey) || ''
          }
          migrated = true
        }
        if (!parsed.dictCategoryTemplate || !parsed.dictCategoryTemplate.content) {
          parsed.dictCategoryTemplate = clone(SEED_DICT_CATEGORY_TEMPLATE)
          migrated = true
        }
        // v7：字典分类属性升级——file 分类文件 → basePackage 基础包路径 +
        // className 大驼峰类名。旧分类按 file 推导（目录去 src/main/java/ 前缀
        // 后点化为包名、文件名去 .java 后缀为类名；无 file 时由分类名推导兜底——
        // 兜底仅在其结果为合法大驼峰时落库，中文分类名等推导不合法时置空，
        // 渲染层会以相同公式兜底，行为不变且不持久化非法类名）
        if (
          !parsed.dictCategories.every(
            (c) => c.basePackage !== undefined && c.className !== undefined,
          )
        ) {
          parsed.dictCategories = parsed.dictCategories.map((c) => {
            if (c.basePackage !== undefined && c.className !== undefined) return c
            const legacy = c as DictCategory & { file?: string }
            const file = String(legacy.file || '')
              .replace(/\\/g, '/')
              .replace(/^\/+/, '')
              .trim()
            const parts = file.split('/').filter(Boolean)
            const fileBase = parts.length ? parts[parts.length - 1] : ''
            let dir = parts.slice(0, -1).join('/')
            if (dir.startsWith('src/main/java/')) dir = dir.slice('src/main/java/'.length)
            const { file: _file, ...rest } = legacy
            const nameFallback = `${toCamelCase(c.name)}DictConstants`
            return {
              ...rest,
              basePackage: dir ? dir.split('/').filter(Boolean).join('.') : '',
              className:
                fileBase.replace(/\.java$/, '') ||
                (/^[A-Z][A-Za-z0-9]*$/.test(nameFallback) ? nameFallback : ''),
            }
          })
          migrated = true
        }
        // v7：字典值补常量属性名（propertyName）。仅回填缺失（undefined）的值：
        // 种子字典按（dictKey, valueKey）映射回填有语义英文名；非种子字典置空串
        // （模板渲染时由值键推导兜底）——用户主动清空（''）不会被覆盖
        if (parsed.dicts.some((d) => d.values.some((v) => v.propertyName === undefined))) {
          const seedProps = new Map(
            SEED_DICTS.flatMap((d) =>
              d.values.map(
                (v) => [`${d.dictKey}\u0000${v.valueKey}`, v.propertyName || ''] as const,
              ),
            ),
          )
          for (const d of parsed.dicts) {
            for (const v of d.values) {
              if (v.propertyName === undefined)
                v.propertyName = seedProps.get(`${d.dictKey}\u0000${v.valueKey}`) ?? ''
            }
          }
          migrated = true
        }
        // v7：字典分类模板种子升级（常量统一 String、常量名取 propertyName、
        // 包名/类名推导产物路径）——版本号驱动替换，与表模板迁移策略一致
        if ((parsed.dictTemplateSeedVersion ?? 1) < DICT_TEMPLATE_SEED_VERSION) {
          parsed.dictCategoryTemplate = clone(SEED_DICT_CATEGORY_TEMPLATE)
          parsed.dictTemplateSeedVersion = DICT_TEMPLATE_SEED_VERSION
          migrated = true
        }
        // v8：AI 设置（openai compatible 供应商 / 模型列表 / 全局规则）。
        // 旧库无 aiSettings 字段：补空缺省（未配置态），此后用户保存即持久化
        if (!parsed.aiSettings) {
          parsed.aiSettings = normalizeAiSettings(undefined)
          migrated = true
        }
        if (migrated) {
          db = parsed
          persistDB()
        }
        return parsed
      }
    }
  } catch {
    /* 忽略损坏数据，回退种子 */
  }
  // 清理旧版本存储（v1 缺少 parentIdColumn 等字段，直接回退种子）
  for (const key of LEGACY_STORAGE_KEYS) localStorage.removeItem(key)
  // 首次加载（无有效存储）即落盘种子：消除「内存已有、存储为空」的首载分歧
  db = createSeedDB()
  persistDB()
  return db
}

/** 读取旧版隐藏表存储键（gdbme:hidden），迁移成功后清除该键 */
function readLegacyHidden(): string[] | null {
  try {
    const raw = localStorage.getItem('gdbme:hidden')
    if (raw) {
      const ids = JSON.parse(raw) as string[]
      localStorage.removeItem('gdbme:hidden')
      return Array.isArray(ids) ? ids : null
    }
  } catch {
    /* ignore */
  }
  return null
}

let db: MockDB

db = loadDB()

/** 获取内存数据库（引用，供 DemoManagerApi 直接读写） */
export function getDB(): MockDB {
  return db
}

/** 持久化当前内存状态至 localStorage */
export function persistDB() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(db))
  } catch {
    /* 存储满时静默失败 */
  }
}

/** 重置为种子数据（清空 localStorage 并重建内存态） */
export function resetDB(): void {
  localStorage.removeItem(STORAGE_KEY)
  db = createSeedDB()
  persistDB()
}
