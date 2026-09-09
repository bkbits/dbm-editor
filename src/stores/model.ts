/**
 * 模型仓库：分类 / 表 / 字段 / 索引 / 导航关系
 * 本地状态为 UI 单一数据源；所有变更通过 ManagerApi.save 全量持久化
 * （变更先改本地状态，持久化失败回滚快照并抛错）
 */
import { defineStore } from 'pinia'
import type {
  DBTable,
  ManagerApi,
  ManagerTable,
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
import { getManagerApi } from '@/api/manager-api'
import { uid } from '@/utils/id'
import { toCamelCase } from '@/utils/string'
import { getJavaTypeByType } from '@/utils/javaType'
import { buildNavigateView } from '@/utils/navigate'
import { useSettingsStore } from './settings'
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
    /* ==================== 初始化 / 持久化 ==================== */

    async init() {
      if (this.loading || this.loaded) return
      this.loading = true
      this.error = ''
      try {
        const result = getManagerApi().load()
        this.categories = result.categories.map(clone)
        this.applyTables(result.tables)
        this.navigates = result.navigates.map(clone)
        this.loaded = true
      } catch (e: unknown) {
        this.error = (e as Error)?.message || '数据加载失败'
      } finally {
        this.loading = false
      }
    },

    /** 将完整表列表（含字段/索引）还原为扁平状态 */
    applyTables(tables: ManagerTable[]) {
      this.tables = []
      this.columns = []
      this.indexes = []
      for (const vo of tables) {
        const { columns, indexes, ...table } = vo
        this.tables.push(clone(table))
        this.setColumnsOf(vo.id, columns || [])
        this.setIndexesOf(vo.id, indexes || [])
      }
    },

    /** 全量持久化当前模型（分类 + 表含字段索引 + 导航） */
    persist() {
      getManagerApi().save(
        this.categories.map(clone),
        this.tables.map((t) => ({ ...clone(t), columns: this.columnsOf(t.id), indexes: this.indexesOf(t.id) })),
        this.navigates.map(clone),
      )
    },

    /** 以快照回滚本地状态（persist 抛错时调用） */
    rollback(snap: ModelSnapshot) {
      this.applySnapshot(snap)
    },

    setColumnsOf(tableId: string, columns: TableColumn[]) {
      this.columns = this.columns.filter((c) => c.tableId !== tableId)
      columns.forEach((c, i) => {
        this.columns.push({ ...clone(c), tableId, sort: Number(c.sort ?? i) || i })
      })
    },

    setIndexesOf(tableId: string, indexes: TableIndex[]) {
      this.indexes = this.indexes.filter((i) => i.tableId !== tableId)
      indexes.forEach((i) => this.indexes.push({ ...clone(i), tableId, columns: [...(i.columns || [])] }))
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

    /* ==================== 分类 ==================== */

    async saveCategory(draft: Partial<TableCategory> & { id?: string }) {
      const name = String(draft.name || '').trim()
      const basePackage = String(draft.basePackage || '').trim()
      if (!name) throw new Error('分类名称不能为空')
      if (!basePackage) throw new Error('基础包路径不能为空')
      if (this.categories.some((c) => c.name === name && c.id !== draft.id)) {
        throw new Error(`分类名称已存在: ${name}`)
      }
      const history = useHistoryStore()
      const snap = this.takeSnapshot()
      history.capture(snap)
      let saved: TableCategory
      if (draft.id) {
        const idx = this.categories.findIndex((c) => c.id === draft.id)
        if (idx < 0) throw new Error(`分类不存在: ${draft.id}`)
        saved = { ...this.categories[idx], id: draft.id, name, basePackage, src: draft.src || '' }
        this.categories[idx] = clone(saved)
      } else {
        saved = { id: uid('cat-'), name, basePackage, src: draft.src || '' }
        this.categories.push(clone(saved))
      }
      try {
        this.persist()
      } catch (e) {
        this.rollback(snap)
        throw e
      }
      return saved
    },

    async removeCategory(id: string) {
      const history = useHistoryStore()
      const snap = this.takeSnapshot()
      history.capture(snap)
      this.categories = this.categories.filter((c) => c.id !== id)
      try {
        this.persist()
      } catch (e) {
        this.rollback(snap)
        throw e
      }
    },

    /* ==================== 表 ==================== */

    async createTable(draft: Omit<TableAddPayload, 'id'>): Promise<string> {
      const tableName = String(draft.tableName || '').trim()
      if (!tableName) throw new Error('表名不能为空')
      if (this.tableNames.has(tableName)) throw new Error(`表名已存在: ${tableName}`)
      if (!this.categories.some((c) => c.id === draft.categoryId)) throw new Error('所属分类不存在')
      const history = useHistoryStore()
      const snap = this.takeSnapshot()
      history.capture(snap)
      const tableId = uid('t-')
      this.tables.push({
        id: tableId,
        categoryId: String(draft.categoryId),
        tableName,
        className: String(draft.className || '').trim() || undefined,
        comment: String(draft.comment || '').trim(),
        parentIdColumn: String(draft.parentIdColumn || '').trim() || undefined,
        x: Number(draft.x ?? 0) || 0,
        y: Number(draft.y ?? 0) || 0,
      })
      this.setColumnsOf(tableId, (draft.columns || []).map(clone))
      this.setIndexesOf(tableId, (draft.indexes || []).map(clone))
      try {
        this.persist()
      } catch (e) {
        this.rollback(snap)
        throw e
      }
      return tableId
    },

    async saveTable(draft: Omit<TableUpdatePayload, 'rawNavigates'>): Promise<void> {
      const tableId = String(draft.id || '')
      const target = this.tableById(tableId)
      if (!target) throw new Error(`表不存在: ${tableId}`)
      const tableName = String(draft.tableName || '').trim()
      if (!tableName) throw new Error('表名不能为空')
      if (this.tables.some((t) => t.tableName === tableName && t.id !== tableId)) {
        throw new Error(`表名已存在: ${tableName}`)
      }
      const history = useHistoryStore()
      const snap = this.takeSnapshot()
      history.capture(snap)
      Object.assign(target, {
        categoryId: String(draft.categoryId ?? target.categoryId),
        tableName,
        className: String(draft.className || '').trim() || undefined,
        comment: String(draft.comment || '').trim(),
        parentIdColumn: String(draft.parentIdColumn ?? '').trim() || undefined,
        x: Number(draft.x ?? target.x ?? 0) || 0,
        y: Number(draft.y ?? target.y ?? 0) || 0,
      })
      this.setColumnsOf(tableId, (draft.columns || []).map(clone))
      this.setIndexesOf(tableId, (draft.indexes || []).map(clone))
      try {
        this.persist()
      } catch (e) {
        this.rollback(snap)
        throw e
      }
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

    /** 持久化表（全量保存语义，参数仅用于语义提示） */
    async persistTables(_ids: string[]) {
      this.persist()
    },

    async removeTables(ids: string[]) {
      const history = useHistoryStore()
      const snap = this.takeSnapshot()
      history.capture(snap)
      this.tables = this.tables.filter((t) => !ids.includes(t.id))
      this.columns = this.columns.filter((c) => !ids.includes(c.tableId))
      this.indexes = this.indexes.filter((i) => !ids.includes(i.tableId))
      this.navigates = this.navigates.filter(
        (n) => !ids.includes(n.self) && !ids.includes(n.target) && !ids.includes(n.mappingTable),
      )
      try {
        this.persist()
      } catch (e) {
        this.rollback(snap)
        throw e
      }
    },

    /* ==================== 导航 ==================== */

    /** 新增导航（自动创建中间表的逻辑由调用方完成后传入） */
    async addNavigate(nav: TableNavigate) {
      const history = useHistoryStore()
      const snap = this.takeSnapshot()
      history.capture(snap)
      this.navigates.push(clone(nav))
      try {
        this.persist()
      } catch (e) {
        this.rollback(snap)
        throw e
      }
    },

    async updateNavigate(nav: TableNavigate) {
      const idx = this.navigates.findIndex((n) => n.id === nav.id)
      if (idx < 0) return
      const history = useHistoryStore()
      const snap = this.takeSnapshot()
      history.capture(snap)
      this.navigates[idx] = clone(nav)
      try {
        this.persist()
      } catch (e) {
        this.rollback(snap)
        throw e
      }
    },

    async removeNavigate(id: string) {
      const nav = this.navigates.find((n) => n.id === id)
      if (!nav) return
      const history = useHistoryStore()
      const snap = this.takeSnapshot()
      history.capture(snap)
      this.navigates = this.navigates.filter((n) => n.id !== id)
      try {
        this.persist()
      } catch (e) {
        this.rollback(snap)
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
      const snap = this.takeSnapshot()
      const tableId = uid('t-')
      const x = position?.x ?? draft.x ?? 0
      const y = position?.y ?? draft.y ?? 0
      this.tables.push({
        id: tableId,
        categoryId: String(draft.categoryId),
        tableName: String(draft.tableName),
        className: String(draft.className || '').trim() || undefined,
        comment: String(draft.comment || '').trim(),
        parentIdColumn: String(draft.parentIdColumn || '').trim() || undefined,
        x: Number(x) || 0,
        y: Number(y) || 0,
      })
      this.setColumnsOf(tableId, (draft.columns || []).map(clone))
      this.setIndexesOf(tableId, (draft.indexes || []).map(clone))
      try {
        this.persist()
      } catch (e) {
        this.rollback(snap)
        throw e
      }
      return tableId
    },

    /* ==================== 从数据库导入 ==================== */

    async importFromDB(categoryId: string, defs: DBTable[]) {
      // 列类型映射规则：设置中 sort 最小命中优先，未命中回退内置映射
      const settings = useSettingsStore()
      if (!settings.loaded) await settings.init()
      const history = useHistoryStore()
      const snap = this.takeSnapshot()
      history.capture(snap)
      const indexTypes = settings.indexTypes.length ? settings.indexTypes : ['UNIQUE', 'NORMAL', 'FULLTEXT']
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
        const tableId = uid('t-')
        this.tables.push({
          id: tableId,
          categoryId,
          tableName,
          className: toCamelCase(tableName),
          comment: def.comment || '',
          x: 40 + col * 340,
          y: maxY,
        })
        this.setColumnsOf(
          tableId,
          def.columns.map((c, i) => ({
            id: uid('c-'),
            tableId: '',
            columnName: c.columnName,
            propertyName: toCamelCase(c.columnName, true),
            sort: i,
            type: c.type,
            javaType: settings.matchJavaType(c.type) ?? getJavaTypeByType(c.type),
            comment: c.comment || '',
            notNull: Boolean(c.notNull),
            primaryKey: Boolean(c.primaryKey),
            dict: '',
          })),
        )
        // 索引：类型不在设置列表时归一为列表首项
        this.setIndexesOf(
          tableId,
          (def.indexes || [])
            .filter((idx) => String(idx.indexName || '').trim())
            .map((idx) => {
              const type = String(idx.type || '').trim().toUpperCase()
              return {
                id: uid('i-'),
                tableId: '',
                indexName: String(idx.indexName).trim(),
                type: indexTypes.includes(type) ? type : indexTypes[0],
                columns: (idx.columns || []).map(String),
                comment: idx.comment || '',
              }
            }),
        )
        createdIds.push(tableId)
        col = (col + 1) % 5
      }
      try {
        this.persist()
      } catch (e) {
        this.rollback(snap)
        throw e
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

    /** 重置为演示数据（demo api 提供 resetDemo；正式实现下等价于重新加载） */
    async resetDemoData() {
      const api = getManagerApi() as ManagerApi & { resetDemo?: () => void }
      api.resetDemo?.()
      // 全量刷新各仓库（dict / template 动态引入避免与 model 产生模块环）
      const [{ useDictStore }, { useTemplateStore }] = await Promise.all([
        import('./dict'),
        import('./template'),
      ])
      const dict = useDictStore()
      const templateStore = useTemplateStore()
      const settings = useSettingsStore()
      for (const s of [this, dict, templateStore, settings] as Array<{ loaded: boolean; loading: boolean }>) {
        s.loaded = false
        s.loading = false
      }
      await Promise.all([this.init(), dict.init(), templateStore.init(), settings.init()])
    },
  },
})
