/**
 * 模型仓库：分类 / 表 / 字段 / 索引 / 导航关系
 * （reactive 对象工厂形态，由 DBManagerView 经上下文注入，不依赖 Pinia）
 *
 * 本地状态为 UI 单一数据源；所有变更遵循 ManagerApi 细粒度异步契约：
 * - 每次操作先改本地状态，再 await 对应 api 方法（add/update/remove）
 *   即时持久化，持久化失败回滚快照并抛错（事务模式）
 * - 拖动/对齐/布局等纯位置变更走 updateTablePos 批量契约（一次调用保存全部移动的表）
 * - saveAll 对应 api.save()（点击「保存所有」）；refresh 对应 api.load()（点击「刷新」）
 * - 撤销/重做恢复后通过 diff 同步（syncToApi）将持久层对齐到本地状态
 */
import { reactive } from 'vue'
import { useDBManagerContext } from './context'
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
import { uid } from '@/utils/id'
import { toCamelCase } from '@/utils/string'
import { getJavaTypeByType } from '@/utils/javaType'
import { buildNavigateView, flipNavigateType } from '@/utils/navigate'
import type { HistoryStore } from './history'
import type { SettingsStore } from './settings'
import type { DictStore } from './dict'
import type { TemplateStore } from './template'

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

/** 实体是否与目标一致（逐字节比较，避免多余 api 调用） */
function sameEntity(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/** 工厂依赖（均惰性取用，与原先 action 内 useXxxStore() 的运行时语义一致） */
export interface ModelDeps {
  getApi: () => ManagerApi
  getHistory: () => HistoryStore
  getSettings: () => SettingsStore
  getDict: () => DictStore
  getTemplate: () => TemplateStore
}

export function createModelStore(deps: ModelDeps) {
  return reactive({
    loaded: false,
    loading: false,
    error: '',
    categories: [] as TableCategory[],
    tables: [] as Table[],
    columns: [] as TableColumn[],
    indexes: [] as TableIndex[],
    navigates: [] as TableNavigate[],

    get tableCount(): number {
      return this.tables.length
    },
    get navigateCount(): number {
      return this.navigates.length
    },
    get categoryCount(): number {
      return this.categories.length
    },
    get tableNames(): Set<string> {
      return new Set(this.tables.map((t) => t.tableName))
    },
    get categoryNames(): Set<string> {
      return new Set(this.categories.map((c) => c.name))
    },
    get tableById(): (id: string) => Table | undefined {
      return (id) => this.tables.find((t) => t.id === id)
    },
    get categoryById(): (id: string) => TableCategory | undefined {
      return (id) => this.categories.find((c) => c.id === id)
    },
    get tablesByCategory(): (categoryId: string) => Table[] {
      return (categoryId) => this.tables.filter((t) => t.categoryId === categoryId)
    },
    /** 该表参与的全部原始导航 */
    get navigatesOf(): (tableId: string) => TableNavigate[] {
      return (tableId) => this.navigates.filter((n) => n.self === tableId || n.target === tableId)
    },
    /** 是否为中间映射表 */
    get isMappingTable(): (tableId: string) => boolean {
      return (tableId) => this.navigates.some((n) => n.mappingTable === tableId)
    },
    get hasNavigateBetween(): (a: string, b: string, excludeId?: string) => boolean {
      return (a, b, excludeId) =>
        this.navigates.some((n) => {
          if (excludeId && n.id === excludeId) return false
          return (n.self === a && n.target === b) || (n.self === b && n.target === a)
        })
    },

    /* ==================== 初始化 / 全量动作 ==================== */

    async init() {
      if (this.loading || this.loaded) return
      this.loading = true
      this.error = ''
      try {
        const result = await deps.getApi().load()
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

    /** 刷新：放弃本地状态，重新从 api.load() 加载（点击「刷新」按钮） */
    async refresh() {
      this.loading = true
      this.error = ''
      try {
        const result = await deps.getApi().load()
        this.categories = result.categories.map(clone)
        this.applyTables(result.tables)
        this.navigates = result.navigates.map(clone)
        this.loaded = true
      } catch (e: unknown) {
        this.error = (e as Error)?.message || '数据刷新失败'
        throw e
      } finally {
        this.loading = false
      }
    },

    /** 全量保存（点击「保存所有」按钮或按 Ctrl+S 时调用，对应 api.save()） */
    async saveAll() {
      await deps.getApi().save()
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

    /**
     * diff 同步：把持久层（api）对齐到本地当前状态。
     * 用于撤销/重做恢复等本地状态整体变化的场景——按分类/表/导航
     * 三组做增删改 diff，逐个 await 契约的细粒度异步方法。
     */
    async syncToApi() {
      const api = deps.getApi()

      /* ---- 分类：先补新增/更新（保证表引用分类可通过校验） ---- */
      const apiCategories = await api.getCategories()
      const catIds = new Set(this.categories.map((c) => c.id))
      for (const c of this.categories) {
        const existing = apiCategories.find((x) => x.id === c.id)
        if (!existing) await api.addCategory(clone(c))
        else if (!sameEntity(existing, c)) await api.updateCategory(clone(c))
      }

      /* ---- 表：先删后加再改（removeTable 会级联删导航） ---- */
      // 表内容（字段/索引/顺序）全量以本地为准，不做内容比较，
      // 避免键序/排序差异造成误判「相同」而漏同步
      const apiTables = await api.getTables()
      const tableIds = new Set(this.tables.map((t) => t.id))
      for (const t of apiTables) {
        if (!tableIds.has(t.id)) await api.removeTable(t.id)
      }
      for (const t of this.tables) {
        const vo = this.managerTableOf(t.id)
        const existing = apiTables.find((x) => x.id === t.id)
        if (!existing) await api.addTable(clone(vo))
        else await api.updateTable(clone(vo))
      }

      /* ---- 导航：基于（可能被级联修改后的）最新持久层状态 diff ---- */
      const apiNavigates = await api.getNavigates()
      const navIds = new Set(this.navigates.map((n) => n.id))
      for (const n of apiNavigates) {
        if (!navIds.has(n.id)) await api.removeNavigate(n.id)
      }
      for (const n of this.navigates) {
        const existing = apiNavigates.find((x) => x.id === n.id)
        if (!existing) await api.addNavigate(clone(n))
        else if (!sameEntity(existing, n)) await api.updateNavigate(clone(n))
      }

      /* ---- 分类删除放最后（此时分类下已无表） ---- */
      for (const c of apiCategories) {
        if (!catIds.has(c.id)) await api.removeCategory(c.id)
      }
    },

    /** 以快照回滚本地状态（api 调用抛错时使用） */
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
      indexes.forEach((i) =>
        this.indexes.push({ ...clone(i), tableId, columns: [...(i.columns || [])] }),
      )
    },

    columnsOf(tableId: string): TableColumn[] {
      return this.columns
        .filter((c) => c.tableId === tableId)
        .sort((a, b) => a.sort - b.sort)
        .map((c) => ({ ...c }))
    },

    indexesOf(tableId: string): TableIndex[] {
      return this.indexes
        .filter((i) => i.tableId === tableId)
        .map((i) => ({ ...i, columns: [...i.columns] }))
    },

    /** 组装完整 ManagerTable（表元信息 + 字段 + 索引），用于 api 调用 */
    managerTableOf(tableId: string): ManagerTable {
      const t = this.tableById(tableId)
      if (!t) throw new Error(`表不存在: ${tableId}`)
      return { ...clone(t), columns: this.columnsOf(tableId), indexes: this.indexesOf(tableId) }
    },

    shallowVO(tableId: string): TableVO {
      const t = this.tableById(tableId)
      if (!t) return undefined as unknown as TableVO
      return {
        ...t,
        columns: this.columnsOf(tableId),
        indexes: this.indexesOf(tableId),
        navigates: [],
      }
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
      const api = deps.getApi()
      const history = deps.getHistory()
      const snap = this.takeSnapshot()
      let saved: TableCategory
      if (draft.id) {
        const idx = this.categories.findIndex((c) => c.id === draft.id)
        if (idx < 0) throw new Error(`分类不存在: ${draft.id}`)
        saved = { ...this.categories[idx], id: draft.id, name, basePackage, src: draft.src || '' }
        history.capture(snap)
        this.categories[idx] = clone(saved)
        try {
          await api.updateCategory(clone(saved))
        } catch (e) {
          this.rollback(snap)
          throw e
        }
      } else {
        saved = { id: uid('cat-'), name, basePackage, src: draft.src || '' }
        history.capture(snap)
        this.categories.push(clone(saved))
        try {
          await api.addCategory(clone(saved))
        } catch (e) {
          this.rollback(snap)
          throw e
        }
      }
      return saved
    },

    async removeCategory(id: string) {
      const history = deps.getHistory()
      const snap = this.takeSnapshot()
      history.capture(snap)
      this.categories = this.categories.filter((c) => c.id !== id)
      try {
        await deps.getApi().removeCategory(id)
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
      const api = deps.getApi()
      const history = deps.getHistory()
      const snap = this.takeSnapshot()
      const tableId = uid('t-')
      const table: Table = {
        id: tableId,
        categoryId: String(draft.categoryId),
        tableName,
        className: String(draft.className || '').trim() || undefined,
        comment: String(draft.comment || '').trim(),
        parentIdColumn: String(draft.parentIdColumn || '').trim() || undefined,
        hidden: false,
        x: Number(draft.x ?? 0) || 0,
        y: Number(draft.y ?? 0) || 0,
        templates: String(draft.templates ?? '').trim() || undefined,
        // 新表在对话框中尚无真实 id：选项条目的 tableId 归一为落库后的表 id
        options: draft.options
          ? Object.fromEntries(
              Object.entries(clone(draft.options)).map(([k, v]) => [k, { ...v, tableId }]),
            )
          : undefined,
      }
      this.tables.push(table)
      this.setColumnsOf(tableId, (draft.columns || []).map(clone))
      this.setIndexesOf(tableId, (draft.indexes || []).map(clone))
      history.capture(snap)
      try {
        await api.addTable(this.managerTableOf(tableId))
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
      const api = deps.getApi()
      const history = deps.getHistory()
      const snap = this.takeSnapshot()
      Object.assign(target, {
        categoryId: String(draft.categoryId ?? target.categoryId),
        tableName,
        className: String(draft.className || '').trim() || undefined,
        comment: String(draft.comment || '').trim(),
        parentIdColumn: String(draft.parentIdColumn ?? '').trim() || undefined,
        x: Number(draft.x ?? target.x ?? 0) || 0,
        y: Number(draft.y ?? target.y ?? 0) || 0,
        // templates/options 采用替换语义（undefined 即清除：启用全部模板/选项全默认）
        templates: String(draft.templates ?? '').trim() || undefined,
        options: draft.options ? clone(draft.options) : undefined,
      })
      this.setColumnsOf(tableId, (draft.columns || []).map(clone))
      this.setIndexesOf(tableId, (draft.indexes || []).map(clone))
      history.capture(snap)
      try {
        await api.updateTable(this.managerTableOf(tableId))
      } catch (e) {
        this.rollback(snap)
        throw e
      }
    },

    /** 切换表隐藏状态（Table.hidden），持久化走 updateTable */
    async setTableHidden(tableId: string, hidden: boolean) {
      const target = this.tableById(tableId)
      if (!target || target.hidden === hidden) return
      const snap = this.takeSnapshot()
      target.hidden = hidden
      try {
        await deps.getApi().updateTable(this.managerTableOf(tableId))
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

    /**
     * 持久化表位置（拖动卡片结束/对齐/布局后调用）。
     * 走 updateTablePos 批量契约：多张表卡片被选中并同时移动时，
     * 仅调用一次 api（tables 携带全部移动的表与最终坐标）。
     */
    async persistTables(ids: string[]) {
      const api = deps.getApi()
      const tables = ids
        .map((id) => this.tableById(id))
        .filter((t): t is Table => !!t)
        .map((t) => ({ tableId: t.id, pos: { x: t.x ?? 0, y: t.y ?? 0 } }))
      if (!tables.length) return
      await api.updateTablePos({ tables })
    },

    async removeTables(ids: string[]) {
      const api = deps.getApi()
      const history = deps.getHistory()
      const snap = this.takeSnapshot()
      history.capture(snap)
      this.tables = this.tables.filter((t) => !ids.includes(t.id))
      this.columns = this.columns.filter((c) => !ids.includes(c.tableId))
      this.indexes = this.indexes.filter((i) => !ids.includes(i.tableId))
      this.navigates = this.navigates.filter(
        (n) => !ids.includes(n.self) && !ids.includes(n.target) && !ids.includes(n.mappingTable),
      )
      try {
        for (const id of ids) await api.removeTable(id)
      } catch (e) {
        this.rollback(snap)
        throw e
      }
    },

    /* ==================== 导航 ==================== */

    /** 新增导航（自动创建中间表的逻辑由调用方完成后传入） */
    async addNavigate(nav: TableNavigate) {
      const api = deps.getApi()
      const history = deps.getHistory()
      const snap = this.takeSnapshot()
      history.capture(snap)
      this.navigates.push(clone(nav))
      try {
        await api.addNavigate(clone(nav))
      } catch (e) {
        this.rollback(snap)
        throw e
      }
    },

    async updateNavigate(nav: TableNavigate) {
      const idx = this.navigates.findIndex((n) => n.id === nav.id)
      if (idx < 0) return
      const api = deps.getApi()
      const history = deps.getHistory()
      const snap = this.takeSnapshot()
      history.capture(snap)
      this.navigates[idx] = clone(nav)
      try {
        await api.updateNavigate(clone(nav))
      } catch (e) {
        this.rollback(snap)
        throw e
      }
    },

    async removeNavigate(id: string) {
      const nav = this.navigates.find((n) => n.id === id)
      if (!nav) return
      const api = deps.getApi()
      const history = deps.getHistory()
      const snap = this.takeSnapshot()
      history.capture(snap)
      this.navigates = this.navigates.filter((n) => n.id !== id)
      try {
        await api.removeNavigate(id)
      } catch (e) {
        this.rollback(snap)
        throw e
      }
    },

    /** 反转导航（self/target 调换，类型同步调换） */
    async reverseNavigate(id: string) {
      const nav = this.navigates.find((n) => n.id === id)
      if (!nav) return
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

    /** 复制表结构到剪贴板载荷（不含导航；副本始终可见） */
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
      const api = deps.getApi()
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
        hidden: false,
        x: Number(x) || 0,
        y: Number(y) || 0,
      })
      this.setColumnsOf(tableId, (draft.columns || []).map(clone))
      this.setIndexesOf(tableId, (draft.indexes || []).map(clone))
      try {
        await api.addTable(this.managerTableOf(tableId))
      } catch (e) {
        this.rollback(snap)
        throw e
      }
      return tableId
    },

    /* ==================== 从数据库导入 ==================== */

    async importFromDB(categoryId: string, defs: DBTable[]) {
      const api = deps.getApi()
      // 列类型映射规则：设置中 sort 最小命中优先，未命中回退内置映射
      const settings = deps.getSettings()
      if (!settings.loaded) await settings.init()
      const history = deps.getHistory()
      const snap = this.takeSnapshot()
      history.capture(snap)
      const indexTypes = settings.indexTypes.length
        ? settings.indexTypes
        : ['UNIQUE', 'NORMAL', 'FULLTEXT']
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
          hidden: false,
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
              const type = String(idx.type || '')
                .trim()
                .toUpperCase()
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
        for (const id of createdIds) await api.addTable(this.managerTableOf(id))
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
      const api = deps.getApi()
      await api.resetDemo?.()
      // 全量刷新各仓库（经工厂依赖引用，无模块环问题）
      const dict = deps.getDict()
      const templateStore = deps.getTemplate()
      const settings = deps.getSettings()
      for (const s of [this, dict, templateStore, settings] as Array<{
        loaded: boolean
        loading: boolean
      }>) {
        s.loaded = false
        s.loading = false
      }
      await Promise.all([this.init(), dict.init(), templateStore.init(), settings.init()])
    },
  })
}

export type ModelStore = ReturnType<typeof createModelStore>

/** 子组件取用模型仓库（须处于 DBManagerView 组件树内） */
export function useModelStore(): ModelStore {
  return useDBManagerContext().model
}
