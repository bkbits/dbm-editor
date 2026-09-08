/**
 * 模型仓库：分类 / 表 / 字段 / 索引 / 导航关系
 * 本地状态为 UI 单一数据源，所有变更同步调用 mock API 持久化
 */
import { defineStore } from 'pinia'
import type {
  DBTableDef,
  Navigate,
  Table,
  TableAddPayload,
  TableCategory,
  TableColumn,
  TableIndex,
  TableNavigate,
  TableUpdatePayload,
  TableVO,
} from '@/types/model'
import { categoryApi, tableApi } from '@/api/modules'
import { uid } from '@/utils/id'
import { toCamelCase } from '@/utils/string'
import { getJavaTypeByType } from '@/utils/javaType'
import { buildNavigateView } from '@/utils/navigate'
import { resetDB } from '@/mock/db'
import { useHistoryStore } from './history'

/** 模型快照（撤销/重做用） */
export interface ModelSnapshot {
  categories: TableCategory[]
  tables: Table[]
  columns: TableColumn[]
  indexes: TableIndex[]
  navigates: TableNavigate[]
}

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T
}

export const useModelStore = defineStore('model', {
  state: () => ({
    loaded: false,
    loading: false,
    error: '',
    categories: [] as TableCategory[],
    tables: [] as Table[],
    columns: [] as TableColumn[],
    indexes: [] as TableIndex[],
    navigates: [] as TableNavigate[],
  }),

  getters: {
    tableCount: (s) => s.tables.length,
    navigateCount: (s) => s.navigates.length,
    categoryCount: (s) => s.categories.length,
    tableNames: (s) => new Set(s.tables.map((t) => t.tableName)),
    categoryNames: (s) => new Set(s.categories.map((c) => c.name)),

    tableById(): (id: string) => Table | undefined {
      return (id) => this.tables.find((t) => t.id === id)
    },
    categoryById(): (id: string) => TableCategory | undefined {
      return (id) => this.categories.find((c) => c.id === id)
    },
    tablesByCategory(): (categoryId: string) => Table[] {
      return (categoryId) => this.tables.filter((t) => t.categoryId === categoryId)
    },
    /** 该表参与的全部原始导航 */
    navigatesOf(): (tableId: string) => TableNavigate[] {
      return (tableId) => this.navigates.filter((n) => n.self === tableId || n.target === tableId)
    },
    /** 是否为中间映射表 */
    isMappingTable(): (tableId: string) => boolean {
      return (tableId) => this.navigates.some((n) => n.mappingTable === tableId)
    },
    hasNavigateBetween(): (a: string, b: string, excludeId?: string) => boolean {
      return (a, b, excludeId) =>
        this.navigates.some((n) => {
          if (excludeId && n.id === excludeId) return false
          return (n.self === a && n.target === b) || (n.self === b && n.target === a)
        })
    },
  },

  actions: {
    /* ==================== 初始化 ==================== */
    async init() {
      if (this.loading || this.loaded) return
      this.loading = true
      this.error = ''
      try {
        const [categories, vos] = await Promise.all([categoryApi.query(), tableApi.query()])
        this.categories = categories.map(clone)
        this.applyVOs(vos)
        this.loaded = true
      } catch (e: unknown) {
        this.error = (e as Error)?.message || '数据加载失败'
      } finally {
        this.loading = false
      }
    },

    /** 将 TableVO 列表还原为扁平状态（导航取各表 rawNavigates 并集） */
    applyVOs(vos: TableVO[]) {
      this.tables = []
      this.columns = []
      this.indexes = []
      this.navigates = []
      const navIds = new Set<string>()
      for (const vo of vos) {
        const { columns, indexes, navigates, rawNavigates, ...table } = vo
        this.tables.push(clone(table))
        for (const c of columns || []) this.columns.push({ ...clone(c), tableId: vo.id })
        for (const i of indexes || []) this.indexes.push({ ...clone(i), tableId: vo.id, columns: [...i.columns] })
        for (const n of rawNavigates || []) {
          if (!navIds.has(n.id)) {
            navIds.add(n.id)
            this.navigates.push(clone(n))
          }
        }
      }
    },

    columnsOf(tableId: string): TableColumn[] {
      return this.columns
        .filter((c) => c.tableId === tableId)
        .sort((a, b) => a.sort - b.sort)
        .map((c) => ({ ...c }))
    },

    indexesOf(tableId: string): TableIndex[] {
      return this.indexes.filter((i) => i.tableId === tableId).map((i) => ({ ...i, columns: [...i.columns] }))
    },

    shallowVO(tableId: string): TableVO {
      const t = this.tableById(tableId)
      if (!t) return undefined as unknown as TableVO
      return { ...t, columns: this.columnsOf(tableId), indexes: this.indexesOf(tableId), navigates: [] }
    },

    /** 构建完整 TableVO（含单向导航视图），用于模板渲染/预览 */
    getVO(tableId: string): TableVO | null {
      const base = this.shallowVO(tableId)
      if (!base) return null
      const navigates = this.navigates
        .filter((n) => n.self === tableId || n.target === tableId)
        .map((n) => buildNavigateView(n, tableId, (id) => this.shallowVO(id)))
        .filter(Boolean) as Navigate[]
      const rawNavigates = this.navigates.filter((n) => n.self === tableId).map(clone)
      return { ...base, navigates, rawNavigates }
    },

    /** 构建表更新载荷（附带该表参与的全部原始导航，替换语义） */
    buildUpdatePayload(tableId: string): TableUpdatePayload | null {
      const t = this.tableById(tableId)
      if (!t) return null
      return {
        ...clone(t),
        columns: this.columnsOf(tableId),
        indexes: this.indexesOf(tableId),
        rawNavigates: this.navigates.filter((n) => n.self === tableId || n.target === tableId).map(clone),
      }
    },

    /* ==================== 分类 ==================== */
    async saveCategory(draft: Partial<TableCategory> & { id?: string }) {
      const history = useHistoryStore()
      history.capture(this.takeSnapshot())
      if (draft.id) {
        const updated = await categoryApi.update(draft as TableCategory)
        const idx = this.categories.findIndex((c) => c.id === draft.id)
        if (idx >= 0) this.categories[idx] = clone(updated)
        return updated
      }
      const created = await categoryApi.add(draft)
      this.categories.push(clone(created))
      return created
    },

    async removeCategory(id: string) {
      const history = useHistoryStore()
      history.capture(this.takeSnapshot())
      await categoryApi.remove(id)
      this.categories = this.categories.filter((c) => c.id !== id)
    },

    /* ==================== 表 ==================== */
    async createTable(draft: Omit<TableAddPayload, 'id'>): Promise<string> {
      const history = useHistoryStore()
      history.capture(this.takeSnapshot())
      const vo = await tableApi.add({ ...clone(draft), rawNavigates: [] })
      this.applyVOFromApi(vo)
      return vo.id
    },

    async saveTable(draft: Omit<TableUpdatePayload, 'rawNavigates'>): Promise<void> {
      const history = useHistoryStore()
      history.capture(this.takeSnapshot())
      const rawNavigates = this.navigates
        .filter((n) => n.self === draft.id || n.target === draft.id)
        .map(clone)
      const vo = await tableApi.update({ ...clone(draft), rawNavigates })
      this.applyVOFromApi(vo)
    },

    /** 应用 API 返回的 TableVO 到本地状态（表/字段/索引；导航不动，本地已是最新） */
    applyVOFromApi(vo: TableVO) {
      const { columns, indexes, navigates, rawNavigates, ...table } = vo
      const tIdx = this.tables.findIndex((t) => t.id === vo.id)
      if (tIdx >= 0) this.tables[tIdx] = clone(table)
      else this.tables.push(clone(table))
      this.columns = this.columns.filter((c) => c.tableId !== vo.id)
      for (const c of columns || []) this.columns.push({ ...clone(c), tableId: vo.id })
      this.indexes = this.indexes.filter((i) => i.tableId !== vo.id)
      for (const i of indexes || []) this.indexes.push({ ...clone(i), tableId: vo.id, columns: [...i.columns] })
    },

    /** 拖拽移动（不触发历史记录，拖拽开始时已捕获） */
    moveTablesBy(ids: string[], dx: number, dy: number) {
      for (const id of ids) {
        const t = this.tableById(id)
        if (!t) continue
        t.x = (t.x ?? 0) + dx
        t.y = (t.y ?? 0) + dy
      }
    },

    /** 持久化若干表（全量载荷） */
    async persistTables(ids: string[]) {
      const unique = [...new Set(ids)]
      await Promise.all(unique.map((id) => {
        const payload = this.buildUpdatePayload(id)
        return payload ? tableApi.update(payload) : Promise.resolve(null)
      }))
    },

    async removeTables(ids: string[]) {
      const history = useHistoryStore()
      history.capture(this.takeSnapshot())
      await Promise.all(ids.map((id) => tableApi.remove(id)))
      this.tables = this.tables.filter((t) => !ids.includes(t.id))
      this.columns = this.columns.filter((c) => !ids.includes(c.tableId))
      this.indexes = this.indexes.filter((i) => !ids.includes(i.tableId))
      this.navigates = this.navigates.filter(
        (n) => !ids.includes(n.self) && !ids.includes(n.target) && !ids.includes(n.mappingTable),
      )
    },

    /* ==================== 导航 ==================== */
    /** 新增导航（自动创建中间表的逻辑由调用方完成后传入） */
    async addNavigate(nav: TableNavigate) {
      const history = useHistoryStore()
      history.capture(this.takeSnapshot())
      this.navigates.push(clone(nav))
      try {
        await this.persistTables([nav.self, nav.target])
      } catch (e) {
        this.navigates = this.navigates.filter((n) => n.id !== nav.id)
        throw e
      }
    },

    async updateNavigate(nav: TableNavigate) {
      const history = useHistoryStore()
      const old = this.navigates.find((n) => n.id === nav.id)
      history.capture(this.takeSnapshot())
      const idx = this.navigates.findIndex((n) => n.id === nav.id)
      if (idx < 0) return
      this.navigates[idx] = clone(nav)
      try {
        // 同时持久化新旧两端，避免旧 self 端残留被替换语义误删
        await this.persistTables([nav.self, nav.target, old?.self ?? '', old?.target ?? ''])
      } catch (e) {
        if (old) this.navigates[idx] = clone(old)
        throw e
      }
    },

    async removeNavigate(id: string) {
      const history = useHistoryStore()
      const nav = this.navigates.find((n) => n.id === id)
      if (!nav) return
      history.capture(this.takeSnapshot())
      this.navigates = this.navigates.filter((n) => n.id !== id)
      try {
        await this.persistTables([nav.self, nav.target])
      } catch (e) {
        this.navigates.push(clone(nav))
        throw e
      }
    },

    /** 反转导航（self/target 调换，类型同步调换） */
    async reverseNavigate(id: string) {
      const nav = this.navigates.find((n) => n.id === id)
      if (!nav) return
      const { flipNavigateType } = await import('@/utils/navigate')
      const reversed: TableNavigate = {
        ...clone(nav),
        type: flipNavigateType(nav.type),
        self: nav.target,
        selfProperty: [...nav.targetProperty],
        selfMappingProperty: [...nav.targetMappingProperty],
        selfPropertyName: nav.targetPropertyName,
        target: nav.self,
        targetProperty: [...nav.selfProperty],
        targetMappingProperty: [...nav.selfMappingProperty],
        targetPropertyName: nav.selfPropertyName,
        selfToTargetCascade: nav.targetToSelfCascade,
        targetToSelfCascade: nav.selfToTargetCascade,
      }
      await this.updateNavigate(reversed)
    },

    /* ==================== 复制 / 粘贴 ==================== */
    /** 复制表结构到剪贴板载荷（不含导航） */
    buildCopyDraft(tableId: string): Omit<TableAddPayload, 'id'> | null {
      const t = this.tableById(tableId)
      if (!t) return null
      let name = `${t.tableName}_copy`
      let n = 1
      while (this.tableNames.has(name)) {
        n += 1
        name = `${t.tableName}_copy${n}`
      }
      return {
        categoryId: t.categoryId,
        tableName: name,
        className: toCamelCase(name),
        comment: t.comment || '',
        parentIdColumn: t.parentIdColumn,
        x: (t.x ?? 0) + 40,
        y: (t.y ?? 0) + 40,
        columns: this.columnsOf(tableId).map((c) => ({
          ...c,
          id: uid('c-'),
          tableId: '',
          propertyName: c.propertyName || toCamelCase(c.columnName, true),
          javaType: c.javaType || getJavaTypeByType(c.type),
        })),
        indexes: this.indexesOf(tableId).map((i) => ({ ...i, id: uid('i-'), tableId: '' })),
      }
    },

    async pasteTable(draft: Omit<TableAddPayload, 'id'>, position?: { x: number; y: number }) {
      const payload = { ...clone(draft), x: position?.x ?? draft.x, y: position?.y ?? draft.y }
      const vo = await tableApi.add({ ...payload, rawNavigates: [] })
      this.applyVOFromApi(vo)
      return vo.id
    },

    /* ==================== 从数据库导入 ==================== */
    async importFromDB(categoryId: string, defs: DBTableDef[]) {
      const history = useHistoryStore()
      history.capture(this.takeSnapshot())
      // 自动布局：从当前最大 y 下方开始网格排布
      const maxY = this.tables.reduce((m, t) => Math.max(m, (t.y ?? 0) + 260), 40)
      let col = 0
      const createdIds: string[] = []
      for (const def of defs) {
        let tableName = def.tableName
        let n = 1
        while (this.tableNames.has(tableName)) {
          tableName = `${def.tableName}_${n++}`
        }
        const draft: Omit<TableAddPayload, 'id'> = {
          categoryId,
          tableName,
          className: toCamelCase(tableName),
          comment: def.comment || '',
          x: 40 + col * 340,
          y: maxY,
          columns: def.columns.map((c, i) => ({
            id: uid('c-'),
            tableId: '',
            columnName: c.columnName,
            propertyName: toCamelCase(c.columnName, true),
            sort: i,
            type: c.type,
            javaType: getJavaTypeByType(c.type),
            comment: c.comment || '',
            notNull: c.notNull,
            primaryKey: c.primaryKey,
            dict: '',
          })),
          indexes: [],
        }
        const vo = await tableApi.add({ ...clone(draft), rawNavigates: [] })
        this.applyVOFromApi(vo)
        createdIds.push(vo.id)
        col = (col + 1) % 5
      }
      return createdIds
    },

    /* ==================== 快照 / 恢复（撤销重做） ==================== */
    takeSnapshot(): ModelSnapshot {
      return {
        categories: clone(this.categories),
        tables: clone(this.tables),
        columns: clone(this.columns),
        indexes: clone(this.indexes),
        navigates: clone(this.navigates),
      }
    },

    applySnapshot(snap: ModelSnapshot) {
      this.categories = clone(snap.categories)
      this.tables = clone(snap.tables)
      this.columns = clone(snap.columns)
      this.indexes = clone(snap.indexes)
      this.navigates = clone(snap.navigates)
    },

    /** 重置为演示数据（清空 mock 持久化并重新加载） */
    async resetDemoData() {
      resetDB() // 同时重置内存与 localStorage
      this.loaded = false
      await this.init()
    },
  },
})
