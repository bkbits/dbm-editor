/**
 * DemoManagerApi：ManagerApi 的内置演示实现
 *
 * 由原 axios mock 分发层迁移而来：数据存于内存（src/mock/db.ts）并
 * 持久化到 localStorage（gdbme:db:v2）。除 replace 的 zip 解析外全部
 * 同步完成；校验失败抛出 Error（message 为中文业务提示）。
 */
import JSZip from 'jszip'
import { message } from 'antdv-next'
import type {
  DBTable,
  Dict,
  DictValue,
  LoadResultVO,
  ManagerApi,
  ManagerTable,
  Settings,
  Table,
  TableCategory,
  TableIndex,
  TableNavigate,
  Template,
  TypeMapping,
} from '@/types/model'
import { getDB, persistDB, resetDB } from '@/mock/db'
import { SEED_DB_TABLES } from '@/mock/seed'
import { uid } from '@/utils/id'

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T
}

function requireStr(value: unknown, field: string, label: string): string {
  const s = String(value ?? '').trim()
  if (!s) throw new Error(`${label}不能为空（${field}）`)
  return s
}

/** 校验正则合法性，非法时抛错 */
function assertRegex(pattern: string): void {
  try {
    new RegExp(pattern, 'i')
  } catch {
    throw new Error(`无效的正则表达式：${pattern}`)
  }
}

const NAVIGATE_TYPES = ['11', '1N', 'N1', 'NN']

export class DemoManagerApi implements ManagerApi {
  /* ==================== 设置 ==================== */

  getSettings(): Settings {
    const db = getDB()
    const s = db.settings || ({ indexTypes: [], typeMappings: [] } as Settings)
    const typeMappings = (Array.isArray(s.typeMappings) ? s.typeMappings : [])
      .slice()
      .sort((a, b) => a.sort - b.sort)
      .map((m) => ({ sort: Number(m.sort) || 0, pattern: String(m.pattern ?? ''), javaType: String(m.javaType || 'String') }))
    const indexTypes = (Array.isArray(s.indexTypes) ? s.indexTypes : [])
      .map((t) => String(t).trim().toUpperCase())
      .filter(Boolean)
    return { indexTypes, typeMappings }
  }

  saveSettings(settings: Settings): void {
    // 规则校验：非空 pattern + 合法正则；索引类型去重归一
    const typeMappings: TypeMapping[] = (settings.typeMappings || []).map((m, i) => {
      const pattern = String(m.pattern ?? '').trim()
      if (!pattern) throw new Error('存在空的列类型正则表达式')
      assertRegex(pattern)
      return { sort: i, pattern, javaType: String(m.javaType || 'String') }
    })
    const seen = new Set<string>()
    const indexTypes: string[] = []
    for (const raw of settings.indexTypes || []) {
      const t = String(raw ?? '').trim().toUpperCase()
      if (!t) throw new Error('索引类型不能为空')
      if (seen.has(t)) throw new Error(`索引类型重复：${t}`)
      seen.add(t)
      indexTypes.push(t)
    }
    if (!indexTypes.length) throw new Error('至少保留一个索引类型')
    getDB().settings = { indexTypes, typeMappings }
    persistDB()
  }

  /* ==================== 数据库导入 ==================== */

  importFromDB(): DBTable[] {
    // 演示实现：返回内置模拟真实库表结构（正式实现对接真实数据库）
    return clone(SEED_DB_TABLES)
  }

  /* ==================== 模型全量加载 / 保存 ==================== */

  load(): LoadResultVO {
    const db = getDB()
    const tables: ManagerTable[] = db.tables.map((t) => ({
      ...clone(t),
      columns: db.columns
        .filter((c) => c.tableId === t.id)
        .sort((a, b) => a.sort - b.sort)
        .map((c) => ({ ...c })),
      indexes: db.indexes
        .filter((i) => i.tableId === t.id)
        .map((i) => ({ ...i, columns: [...i.columns] })),
    }))
    return {
      categories: clone(db.categories),
      tables,
      navigates: clone(db.navigates),
    }
  }

  save(categories: TableCategory[], tables: ManagerTable[], navigates: TableNavigate[]): void {
    /* ---------- 校验 ---------- */
    const catNames = new Set<string>()
    for (const c of categories || []) {
      const name = requireStr(c?.name, 'name', '分类名称')
      if (catNames.has(name)) throw new Error(`分类名称已存在: ${name}`)
      catNames.add(name)
      requireStr(c?.basePackage, 'basePackage', '基础包路径')
    }
    const tableIds = new Set<string>()
    const tableNames = new Set<string>()
    for (const t of tables || []) {
      const name = requireStr(t?.tableName, 'tableName', '表名')
      if (tableNames.has(name)) throw new Error(`表名已存在: ${name}`)
      tableNames.add(name)
      if (!tableIds.has(t.id)) tableIds.add(t.id)
      if (!(categories || []).some((c) => c.id === t.categoryId)) {
        throw new Error(`表 ${name} 的所属分类不存在`)
      }
      const colNames = new Set<string>()
      for (const c of t.columns || []) {
        const colName = requireStr(c?.columnName, 'columnName', '字段名')
        if (colNames.has(colName)) throw new Error(`表 ${name} 存在重复字段名：${colName}`)
        colNames.add(colName)
      }
      const idxNames = new Set<string>()
      for (const i of t.indexes || []) {
        const idxName = requireStr(i?.indexName, 'indexName', '索引名')
        if (idxNames.has(idxName)) throw new Error(`表 ${name} 存在重复索引名：${idxName}`)
        idxNames.add(idxName)
      }
    }
    for (const n of navigates || []) {
      if (!tableIds.has(n.self)) throw new Error(`导航 ${n.id || ''} 的 self 表不存在`)
      if (!tableIds.has(n.target)) throw new Error(`导航 ${n.id || ''} 的 target 表不存在`)
      if (n.mappingTable && !tableIds.has(n.mappingTable)) {
        throw new Error(`导航 ${n.id || ''} 的中间映射表不存在`)
      }
      if (!NAVIGATE_TYPES.includes(n.type)) throw new Error(`导航 ${n.id || ''} 的类型无效: ${n.type}`)
    }

    /* ---------- 写入（保留字典/模板/设置等其余数据） ---------- */
    const db = getDB()
    const flatTables: Table[] = []
    const flatColumns = []
    const flatIndexes: TableIndex[] = []
    for (const t of tables || []) {
      const { columns, indexes, ...table } = t
      flatTables.push(clone(table))
      for (const c of columns || []) flatColumns.push({ ...clone(c), tableId: t.id })
      for (const i of indexes || []) flatIndexes.push({ ...clone(i), tableId: t.id, columns: [...i.columns] })
    }
    db.categories = clone(categories || [])
    db.tables = flatTables
    db.columns = flatColumns
    db.indexes = flatIndexes
    db.navigates = clone(navigates || [])
    persistDB()
  }

  /* ==================== 字典 ==================== */

  getDicts(): Dict[] {
    return clone(getDB().dicts)
  }

  addDict(dict: Dict): void {
    const db = getDB()
    const dictKey = requireStr(dict?.dictKey, 'dictKey', '字典键')
    if (db.dicts.some((d) => d.dictKey === dictKey)) throw new Error(`字典键已存在: ${dictKey}`)
    const normalized = normalizeDict(dict, dictKey)
    if (!normalized.id) throw new Error('新增字典必须提供 id')
    db.dicts.push(clone(normalized))
    persistDB()
  }

  updateDict(dict: Dict): void {
    const db = getDB()
    const id = requireStr(dict?.id, 'id', '字典ID')
    const target = db.dicts.find((d) => d.id === id)
    if (!target) throw new Error(`字典不存在: ${id}`)
    const dictKey = requireStr(dict?.dictKey, 'dictKey', '字典键')
    if (db.dicts.some((d) => d.dictKey === dictKey && d.id !== id)) throw new Error(`字典键已存在: ${dictKey}`)
    Object.assign(target, clone(normalizeDict(dict, dictKey)))
    persistDB()
  }

  removeDict(dictId: string): void {
    const db = getDB()
    db.dicts = db.dicts.filter((d) => d.id !== dictId)
    persistDB()
  }

  /* ==================== 模板 ==================== */

  getTemplates(): Template[] {
    return getDB().templates.map((t) => ({ id: t.id, templateName: t.name, content: t.content }))
  }

  addTemplate(template: Template): void {
    const db = getDB()
    const name = requireStr(template?.templateName, 'templateName', '模板名称')
    if (db.templates.some((t) => t.name === name)) throw new Error(`模板名称已存在: ${name}`)
    if (!template.id) throw new Error('新增模板必须提供 id')
    db.templates.push({ id: template.id, name, content: String(template.content || '') })
    persistDB()
  }

  updateTemplate(template: Template): void {
    const db = getDB()
    const id = requireStr(template?.id, 'id', '模板ID')
    const target = db.templates.find((t) => t.id === id)
    if (!target) throw new Error(`模板不存在: ${id}`)
    const name = requireStr(template?.templateName, 'templateName', '模板名称')
    if (db.templates.some((t) => t.name === name && t.id !== id)) throw new Error(`模板名称已存在: ${name}`)
    target.name = name
    target.content = String(template.content || '')
    persistDB()
  }

  removeTemplate(templateId: string): void {
    const db = getDB()
    db.templates = db.templates.filter((t) => t.id !== templateId)
    persistDB()
  }

  /* ==================== 代码替换 ==================== */

  replace(zipFile: Blob): void {
    // void 契约：zip 解析为异步内部处理，结果由本实现自行反馈
    void JSZip.loadAsync(zipFile)
      .then((archive) => {
        const files = Object.keys(archive.files).filter((name) => !archive.files[name].dir)
        message.success(`已接收 zip 并"替换" ${files.length} 个代码文件（demo 行为，未发生真实写入）`)
      })
      .catch((e: unknown) => {
        message.error(`zip 文件解析失败: ${e instanceof Error ? e.message : String(e)}`)
      })
  }

  /* ==================== demo 扩展 ==================== */

  /** 重置为内置演示数据（ManagerApi 契约之外，仅 demo 实现提供） */
  resetDemo(): void {
    resetDB()
  }
}

/** 字典值归一：空值键拦截、标签回退、类型/颜色兜底 */
function normalizeDictValue(v: Partial<DictValue>, dictKey: string): DictValue {
  const valueKey = String(v?.valueKey ?? '').trim()
  if (!valueKey) throw new Error(`字典 ${dictKey} 存在空值键`)
  const labelType = ['I', 'S', 'W', 'D'].includes(v?.labelType as string) ? (v?.labelType as DictValue['labelType']) : 'I'
  return {
    id: v?.id || uid('dv-'),
    dictId: String(v?.dictId || ''),
    valueKey,
    label: String(v?.label ?? '').trim() || valueKey,
    labelType,
    comment: String(v?.comment || ''),
    color: String(v?.color || '').trim() || undefined,
  }
}

function normalizeDict(dict: Partial<Dict>, dictKey: string): Dict {
  const label = requireStr(dict?.label, 'label', '字典标签')
  return {
    id: String(dict?.id || ''),
    dictKey,
    label,
    comment: String(dict?.comment || ''),
    values: (dict?.values || []).map((v) => normalizeDictValue(v, dictKey)),
  }
}
