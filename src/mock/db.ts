/**
 * Mock 数据库：内存数据 + localStorage 持久化 + 接口路由分发
 *
 * 说明：规范未定义字典/模板的接口，此处按相同的 REST 风格扩展 mock 接口；
 * 规范定义的 9 个接口严格保持路径与方法不变。
 */
import JSZip from 'jszip'
import type {
  CodeTemplate,
  DBTableDef,
  Dict,
  DictValue,
  Table,
  TableColumn,
  TableCategory,
  TableIndex,
  TableNavigate,
  TableVO,
} from '@/types/model'
import { buildNavigateView } from '@/utils/navigate'
import { uid } from '@/utils/id'
import {
  SEED_CATEGORIES,
  SEED_DB_TABLES,
  SEED_DICTS,
  SEED_NAVIGATES,
  SEED_TABLES,
  SEED_TEMPLATES,
} from './seed'

const STORAGE_KEY = 'gdbme:db:v2'
const LEGACY_STORAGE_KEYS = ['gdbme:db:v1']

interface MockDB {
  version: number
  categories: TableCategory[]
  tables: Table[]
  columns: TableColumn[]
  indexes: TableIndex[]
  navigates: TableNavigate[]
  dicts: Dict[]
  templates: CodeTemplate[]
}

/** 业务错误 */
export class MockError extends Error {
  status: number
  constructor(message: string, status = 400) {
    super(message)
    this.status = status
  }
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
    categories: JSON.parse(JSON.stringify(SEED_CATEGORIES)),
    tables,
    columns,
    indexes,
    navigates: JSON.parse(JSON.stringify(SEED_NAVIGATES)),
    dicts: JSON.parse(JSON.stringify(SEED_DICTS)),
    templates: JSON.parse(JSON.stringify(SEED_TEMPLATES)),
  }
}

function loadDB(): MockDB {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as MockDB
      if (parsed && parsed.version === 2 && Array.isArray(parsed.tables)) return parsed
    }
  } catch {
    /* 忽略损坏数据，回退种子 */
  }
  // 清理旧版本存储（v1 缺少 parentIdColumn 等字段，直接回退种子）
  for (const key of LEGACY_STORAGE_KEYS) localStorage.removeItem(key)
  return createSeedDB()
}

let db: MockDB = loadDB()

function saveDB() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(db))
  } catch {
    /* 存储满时静默失败 */
  }
}

/** 重置为种子数据 */
export function resetDB(): MockDB {
  localStorage.removeItem(STORAGE_KEY)
  db = createSeedDB()
  saveDB()
  return JSON.parse(JSON.stringify(db))
}

/* ==================== 组装 TableVO ==================== */

function columnsOf(tableId: string): TableColumn[] {
  return db.columns
    .filter((c) => c.tableId === tableId)
    .sort((a, b) => a.sort - b.sort)
    .map((c) => ({ ...c }))
}

function indexesOf(tableId: string): TableIndex[] {
  return db.indexes.filter((i) => i.tableId === tableId).map((i) => ({ ...i, columns: [...i.columns] }))
}

/** 浅层 TableVO（navigates 置空，避免循环引用） */
function shallowVO(tableId: string): TableVO {
  const t = db.tables.find((x) => x.id === tableId)
  if (!t) return undefined as unknown as TableVO
  return { ...t, columns: columnsOf(tableId), indexes: indexesOf(tableId), navigates: [] }
}

function buildTableVO(tableId: string): TableVO | null {
  const base = shallowVO(tableId)
  if (!base) return null
  const navigates = db.navigates
    .filter((n) => n.self === tableId || n.target === tableId)
    .map((n) => buildNavigateView(n, tableId, shallowVO))
    .filter(Boolean) as NonNullable<ReturnType<typeof buildNavigateView>>[]
  const rawNavigates = db.navigates.filter((n) => n.self === tableId).map((n) => ({ ...n }))
  return { ...base, navigates, rawNavigates }
}

/* ==================== 校验工具 ==================== */

function requireStr(value: unknown, field: string, label: string): string {
  const s = String(value ?? '').trim()
  if (!s) throw new MockError(`${label}不能为空（${field}）`)
  return s
}

function findTable(id: string): Table {
  const t = db.tables.find((x) => x.id === id)
  if (!t) throw new MockError(`表不存在: ${id}`, 404)
  return t
}

/* ==================== 接口处理器 ==================== */

interface Ctx {
  body: any
  params: Record<string, any>
}

type Handler = (ctx: Ctx) => any

const handlers: Record<string, Handler> = {
  /* ---------- 分类 ---------- */
  'GET /codegen/category/query': () => JSON.parse(JSON.stringify(db.categories)),

  'POST /codegen/category/add': ({ body }) => {
    const name = requireStr(body?.name, 'name', '分类名称')
    const basePackage = requireStr(body?.basePackage, 'basePackage', '基础包路径')
    if (db.categories.some((c) => c.name === name)) throw new MockError(`分类名称已存在: ${name}`)
    const category: TableCategory = { id: uid('cat-'), name, basePackage, src: body?.src || '' }
    db.categories.push(category)
    return JSON.parse(JSON.stringify(category))
  },

  'POST /codegen/category/update': ({ body }) => {
    const id = requireStr(body?.id, 'id', '分类ID')
    const name = requireStr(body?.name, 'name', '分类名称')
    const basePackage = requireStr(body?.basePackage, 'basePackage', '基础包路径')
    const target = db.categories.find((c) => c.id === id)
    if (!target) throw new MockError(`分类不存在: ${id}`, 404)
    if (db.categories.some((c) => c.name === name && c.id !== id)) throw new MockError(`分类名称已存在: ${name}`)
    Object.assign(target, { name, basePackage, src: body?.src || '' })
    return JSON.parse(JSON.stringify(target))
  },

  'POST /codegen/category/remove': ({ body }) => {
    const id = requireStr(body?.id, 'id', '分类ID')
    if (db.tables.some((t) => t.categoryId === id)) {
      throw new MockError('该分类下仍有表，请先移动或删除这些表')
    }
    db.categories = db.categories.filter((c) => c.id !== id)
    return true
  },

  /* ---------- 表 ---------- */
  'GET /codegen/table/queryFromDB': () => JSON.parse(JSON.stringify(SEED_DB_TABLES)),

  'GET /codegen/table/query': ({ params }) => {
    const categoryId = params?.categoryId ? String(params.categoryId) : ''
    const keyword = params?.tableName ? String(params.tableName).toLowerCase() : ''
    const vos = db.tables
      .filter((t) => (categoryId ? t.categoryId === categoryId : true))
      .filter((t) => (keyword ? t.tableName.toLowerCase().includes(keyword) : true))
      .map((t) => buildTableVO(t.id))
      .filter(Boolean)
    vos.sort((a: any, b: any) => a.tableName.localeCompare(b.tableName))
    return JSON.parse(JSON.stringify(vos))
  },

  'POST /codegen/table/add': ({ body }) => {
    const tableName = requireStr(body?.tableName, 'tableName', '表名')
    if (db.tables.some((t) => t.tableName === tableName)) throw new MockError(`表名已存在: ${tableName}`)
    if (!db.categories.some((c) => c.id === body?.categoryId)) throw new MockError('所属分类不存在')
    const tableId = uid('t-')
    const table: Table = {
      id: tableId,
      categoryId: String(body.categoryId),
      tableName,
      className: String(body.className || '').trim() || undefined,
      comment: String(body.comment || '').trim(),
      parentIdColumn: String(body?.parentIdColumn || '').trim() || undefined,
      x: Number(body?.x ?? 0) || 0,
      y: Number(body?.y ?? 0) || 0,
    }
    db.tables.push(table)
    replaceColumns(tableId, body?.columns || [])
    replaceIndexes(tableId, body?.indexes || [])
    if (Array.isArray(body?.rawNavigates)) insertNavigates(body.rawNavigates, tableId)
    return JSON.parse(JSON.stringify(buildTableVO(tableId)))
  },

  'POST /codegen/table/update': ({ body }) => {
    const tableId = requireStr(body?.id, 'id', '表ID')
    const target = findTable(tableId)
    const tableName = requireStr(body?.tableName, 'tableName', '表名')
    if (db.tables.some((t) => t.tableName === tableName && t.id !== tableId)) {
      throw new MockError(`表名已存在: ${tableName}`)
    }
    Object.assign(target, {
      categoryId: String(body?.categoryId ?? target.categoryId),
      tableName,
      className: String(body.className || '').trim() || undefined,
      comment: String(body.comment || '').trim(),
      // 树形父ID字段：空值代表取消树形（ ?? target.parentIdColumn 兼容局部载荷）
      parentIdColumn: String(body?.parentIdColumn ?? target.parentIdColumn ?? '').trim() || undefined,
      x: Number(body?.x ?? target.x ?? 0) || 0,
      y: Number(body?.y ?? target.y ?? 0) || 0,
    })
    replaceColumns(tableId, body?.columns || [])
    replaceIndexes(tableId, body?.indexes || [])
    // 导航替换语义：先移除该表参与的全部旧导航，再插入提交的新导航
    db.navigates = db.navigates.filter((n) => n.self !== tableId && n.target !== tableId)
    if (Array.isArray(body?.rawNavigates)) insertNavigates(body.rawNavigates, tableId)
    return JSON.parse(JSON.stringify(buildTableVO(tableId)))
  },

  'POST /codegen/table/remove': ({ body }) => {
    const tableId = requireStr(body?.id, 'id', '表ID')
    findTable(tableId)
    db.tables = db.tables.filter((t) => t.id !== tableId)
    db.columns = db.columns.filter((c) => c.tableId !== tableId)
    db.indexes = db.indexes.filter((i) => i.tableId !== tableId)
    db.navigates = db.navigates.filter(
      (n) => n.self !== tableId && n.target !== tableId && n.mappingTable !== tableId,
    )
    return true
  },

  /* ---------- 代码替换 ---------- */
  'POST /codegen/replace': async ({ body }) => {
    if (!(body instanceof FormData)) throw new MockError('请使用 multipart/form-data 上传 zip 文件')
    const zip = body.get('zip')
    if (!zip || typeof zip === 'string') throw new MockError('缺少 zip 文件字段')
    try {
      const archive = await JSZip.loadAsync(zip as Blob)
      const files = Object.keys(archive.files).filter((name) => !archive.files[name].dir)
      return {
        success: true,
        files: files.length,
        message: `已接收 zip 并"替换" ${files.length} 个代码文件（mock 行为，未发生真实写入）`,
      }
    } catch (e: unknown) {
      throw new MockError(`zip 文件解析失败: ${e instanceof Error ? e.message : String(e)}`)
    }
  },

  /* ---------- 字典（规范未定义，mock 扩展接口） ---------- */
  'GET /codegen/dict/query': () => JSON.parse(JSON.stringify(db.dicts)),

  'POST /codegen/dict/add': ({ body }) => {
    const dictKey = requireStr(body?.dictKey, 'dictKey', '字典键')
    if (db.dicts.some((d) => d.dictKey === dictKey)) throw new MockError(`字典键已存在: ${dictKey}`)
    const dict: Dict = {
      id: uid('dict-'),
      dictKey,
      label: requireStr(body?.label, 'label', '字典标签'),
      comment: String(body?.comment || ''),
      values: (body?.values || []).map((v: any) => normalizeDictValue(v, dictKey)),
    }
    db.dicts.push(dict)
    return JSON.parse(JSON.stringify(dict))
  },

  'POST /codegen/dict/update': ({ body }) => {
    const id = requireStr(body?.id, 'id', '字典ID')
    const target = db.dicts.find((d) => d.id === id)
    if (!target) throw new MockError(`字典不存在: ${id}`, 404)
    const dictKey = requireStr(body?.dictKey, 'dictKey', '字典键')
    if (db.dicts.some((d) => d.dictKey === dictKey && d.id !== id)) throw new MockError(`字典键已存在: ${dictKey}`)
    target.dictKey = dictKey
    target.label = requireStr(body?.label, 'label', '字典标签')
    target.comment = String(body?.comment || '')
    target.values = (body?.values || []).map((v: any) => normalizeDictValue(v, dictKey))
    return JSON.parse(JSON.stringify(target))
  },

  'POST /codegen/dict/remove': ({ body }) => {
    const id = requireStr(body?.id, 'id', '字典ID')
    db.dicts = db.dicts.filter((d) => d.id !== id)
    return true
  },

  /* ---------- 模板（规范未定义，mock 扩展接口） ---------- */
  'GET /codegen/template/query': () => JSON.parse(JSON.stringify(db.templates)),

  'POST /codegen/template/add': ({ body }) => {
    const name = requireStr(body?.name, 'name', '模板名称')
    if (db.templates.some((t) => t.name === name)) throw new MockError(`模板名称已存在: ${name}`)
    const template: CodeTemplate = { id: uid('tpl-'), name, content: String(body?.content || '') }
    db.templates.push(template)
    return JSON.parse(JSON.stringify(template))
  },

  'POST /codegen/template/update': ({ body }) => {
    const id = requireStr(body?.id, 'id', '模板ID')
    const target = db.templates.find((t) => t.id === id)
    if (!target) throw new MockError(`模板不存在: ${id}`, 404)
    const name = requireStr(body?.name, 'name', '模板名称')
    if (db.templates.some((t) => t.name === name && t.id !== id)) throw new MockError(`模板名称已存在: ${name}`)
    target.name = name
    target.content = String(body?.content || '')
    return JSON.parse(JSON.stringify(target))
  },

  'POST /codegen/template/remove': ({ body }) => {
    const id = requireStr(body?.id, 'id', '模板ID')
    db.templates = db.templates.filter((t) => t.id !== id)
    return true
  },
}

function normalizeDictValue(v: any, dictKey: string): DictValue {
  const valueKey = String(v?.valueKey ?? '').trim()
  if (!valueKey) throw new MockError(`字典 ${dictKey} 存在空值键`)
  const labelType = ['I', 'S', 'W', 'D'].includes(v?.labelType) ? v.labelType : 'I'
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

function replaceColumns(tableId: string, columns: any[]) {
  db.columns = db.columns.filter((c) => c.tableId !== tableId)
  columns.forEach((col, i) => {
    db.columns.push({
      id: col?.id || uid('c-'),
      tableId,
      columnName: String(col?.columnName ?? '').trim(),
      propertyName: String(col?.propertyName || '').trim() || undefined,
      sort: Number(col?.sort ?? i) || i,
      type: String(col?.type || 'VARCHAR(50)'),
      javaType: String(col?.javaType || '').trim() || undefined,
      comment: String(col?.comment || ''),
      notNull: Boolean(col?.notNull),
      primaryKey: Boolean(col?.primaryKey),
      dict: String(col?.dict || ''),
    })
  })
}

function replaceIndexes(tableId: string, indexes: any[]) {
  db.indexes = db.indexes.filter((i) => i.tableId !== tableId)
  indexes.forEach((idx) => {
    db.indexes.push({
      id: idx?.id || uid('i-'),
      tableId,
      indexName: String(idx?.indexName ?? '').trim(),
      type: ['UNIQUE', 'NORMAL', 'FULLTEXT'].includes(idx?.type) ? idx.type : 'NORMAL',
      columns: Array.isArray(idx?.columns) ? idx.columns.map(String) : [],
      comment: String(idx?.comment || ''),
    })
  })
}

function insertNavigates(navigates: any[], tableId: string) {
  for (const nav of navigates) {
    // 接受以本表为 self 或 target 的导航（payload 语义为"该表参与的全部导航"）
    if (!nav || (nav.self !== tableId && nav.target !== tableId)) continue
    db.navigates.push({
      ...nav,
      id: nav.id || uid('n-'),
      type: ['11', '1N', 'N1', 'NN'].includes(nav.type) ? nav.type : '1N',
      selfProperty: Array.isArray(nav.selfProperty) ? nav.selfProperty.map(String) : [],
      selfMappingProperty: Array.isArray(nav.selfMappingProperty) ? nav.selfMappingProperty.map(String) : [],
      targetProperty: Array.isArray(nav.targetProperty) ? nav.targetProperty.map(String) : [],
      targetMappingProperty: Array.isArray(nav.targetMappingProperty) ? nav.targetMappingProperty.map(String) : [],
      mappingTable: String(nav.mappingTable || ''),
      selfToTargetCascade: ['AUTO', 'NO_ACTION', 'SET_NULL', 'DELETE'].includes(nav.selfToTargetCascade)
        ? nav.selfToTargetCascade
        : 'AUTO',
      targetToSelfCascade: ['AUTO', 'NO_ACTION', 'SET_NULL', 'DELETE'].includes(nav.targetToSelfCascade)
        ? nav.targetToSelfCascade
        : 'AUTO',
    })
  }
}

/* ==================== 分发入口 ==================== */

export interface MockResult {
  status: number
  data: any
}

const DELAY = 80

export async function mockDispatch(
  method: string,
  url: string,
  body: unknown,
  params: Record<string, unknown> | undefined,
): Promise<MockResult> {
  await new Promise((r) => setTimeout(r, DELAY))
  let path = String(url || '')
  if (path.startsWith('/api')) path = path.slice(4)
  const q = path.indexOf('?')
  if (q >= 0) path = path.slice(0, q)
  path = path.replace(/\/+$/, '')
  const key = `${method.toUpperCase()} ${path}`
  const handler = handlers[key]
  if (!handler) return { status: 404, data: { message: `接口不存在: ${key}（mock 未实现）` } }
  try {
    const result = await handler({ body, params: params || {} })
    if (method.toUpperCase() === 'POST') saveDB()
    return { status: 200, data: result === undefined ? null : result }
  } catch (e: unknown) {
    if (e instanceof MockError) return { status: e.status, data: { message: e.message } }
    return { status: 500, data: { message: e instanceof Error ? e.message : String(e) } }
  }
}
