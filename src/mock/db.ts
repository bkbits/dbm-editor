/**
 * Mock 数据库（demo 数据存储）：内存数据 + localStorage 持久化
 *
 * 由 DemoManagerApi 直接读写；原 axios mock 分发层已被 ManagerApi 体系取代。
 * 持久化键保持 v2 不变，并对旧版设置形态（columnTypeRules）做读取时迁移。
 */
import type {
  CodeTemplate,
  Dict,
  Settings,
  Table,
  TableColumn,
  TableCategory,
  TableIndex,
  TableNavigate,
  TypeMapping,
} from '@/types/model'
import {
  SEED_CATEGORIES,
  SEED_DICTS,
  SEED_HIDDEN_TABLE_NAMES,
  SEED_NAVIGATES,
  SEED_SETTINGS,
  SEED_TABLES,
  SEED_TEMPLATES,
} from './seed'

const STORAGE_KEY = 'gdbme:db:v2'
const LEGACY_STORAGE_KEYS = ['gdbme:db:v1']

export interface MockDB {
  version: number
  categories: TableCategory[]
  tables: Table[]
  columns: TableColumn[]
  indexes: TableIndex[]
  navigates: TableNavigate[]
  dicts: Dict[]
  templates: CodeTemplate[]
  settings: Settings
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
    categories: clone(SEED_CATEGORIES),
    tables,
    columns,
    indexes,
    navigates: clone(SEED_NAVIGATES),
    dicts: clone(SEED_DICTS),
    templates: clone(SEED_TEMPLATES),
    settings: clone(SEED_SETTINGS),
  }
}

/** 旧版设置（columnTypeRules 形态）读取时迁移为 Settings 新形态 */
function migrateSettings(raw: unknown): Settings {
  const s = (raw || {}) as {
    indexTypes?: unknown
    typeMappings?: unknown
    columnTypeRules?: unknown
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
  return { indexTypes, typeMappings }
}

function loadDB(): MockDB {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as MockDB
      if (parsed && parsed.version === 2 && Array.isArray(parsed.tables)) {
        let migrated = false
        // 兼容旧数据（设置字段形态升级 / 缺失）：读取时迁移并立即归一落盘
        if (!parsed.settings || !Array.isArray(parsed.settings.typeMappings)) {
          parsed.settings = migrateSettings(parsed.settings)
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
  return createSeedDB()
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
