/**
 * DemoManagerApi：ManagerApi 的内置演示实现
 *
 * 由原 axios mock 分发层迁移而来：数据存于内存（src/mock/db.ts）并
 * 持久化到 localStorage（gdbme:db:v2）。按契约全部方法返回 Promise：
 * 除 replace 的 zip 解析为真实异步外，其余方法内部同步完成后异步
 * resolve（微任务内落定）；校验失败 reject（Error message 为中文业务提示）。
 *
 * 契约语义：
 * - 细粒度方法（addXxx/updateXxx/removeXxx/updateTablePos）即时写库并落盘
 * - save() 无参全量保存：demo 的内存即真相，等价于确认落盘
 * - removeTable 一并删除其字段、索引与关联导航
 * - 所有方法经 Proxy 包装，使用统一日志器（src/log/Logger.ts）打印入参与
 *   返回（debug 级，异步方法等落定后打印 resolved 值）、抛错（error 级）；
 *   Logger.setLevel 可运行时调整输出级别
 */
import JSZip from 'jszip'
import { message } from 'antdv-next'
import { Logger } from '@/log/Logger'
import type {
  AiModelConfig,
  AiSettings,
  ChatCompletionDelta,
  ChatCompletionRequest,
  ChatCompletionResult,
  ChatMessage,
  DBTable,
  Dict,
  DictCategory,
  DictValue,
  LoadResultVO,
  ManagerApi,
  ManagerTable,
  OptionSetting,
  Settings,
  Table,
  TableCategory,
  TableColumn,
  TableIndex,
  TableNavigate,
  Template,
  ThinkingIntensity,
  TypeMapping,
  UpdateTablePosDTO,
} from '@/types/model'
import { getDB, persistDB, resetDB } from '@/mock/db'
import { SEED_DB_TABLES } from '@/mock/seed'
import { uid } from '@/utils/id'
import { AUDIT_FIELD_ROLES, normalizeFieldConventions } from '@/utils/fieldConvention'

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

/** 选项定义归一：名称非空、列表内唯一、类型/标签兜底（label 缺省回退 name） */
function normalizeOptionSettings(raw: unknown, listLabel?: string): OptionSetting[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: OptionSetting[] = []
  for (const item of raw) {
    const o = item as Partial<OptionSetting>
    const name = String(o?.name ?? '').trim()
    if (!name) {
      if (listLabel) throw new Error(`${listLabel}存在空名称`)
      continue
    }
    if (seen.has(name)) {
      if (listLabel) throw new Error(`${listLabel}名称重复：${name}`)
      continue
    }
    seen.add(name)
    out.push({
      name,
      type: String(o?.type ?? 'boolean').trim() || 'boolean',
      label: String(o?.label ?? '').trim() || name,
      remark: String(o?.remark ?? '').trim() || undefined,
      dict: String(o?.dict ?? '').trim() || undefined,
    })
  }
  return out
}

const NAVIGATE_TYPES = ['11', '1N', 'N1', 'NN']

/** 思考强度合法档位（AI 设置保存校验用） */
const THINKING_INTENSITIES: ThinkingIntensity[] = ['low', 'medium', 'high', 'xhigh', 'max']

/** openai wire 消息形态：camelCase 契约 → snake_case 标准 */
function toWireMessage(m: ChatMessage): Record<string, unknown> {
  const out: Record<string, unknown> = { role: m.role, content: m.content ?? null }
  if (m.toolCalls?.length) {
    out.tool_calls = m.toolCalls.map((c) => ({
      id: c.id,
      type: 'function',
      function: { name: c.function.name, arguments: c.function.arguments || '{}' },
    }))
  }
  if (m.toolCallId) out.tool_call_id = m.toolCallId
  return out
}

/**
 * 调用日志包装：为实例的全部方法用 Logger（src/log/Logger.ts）打印入参与返回结果，
 * 抛错时以 error 级输出后原样抛出。
 *
 * - 以 Proxy 拦截方法访问实现，契约方法（含 resetDemo 扩展）全部覆盖，
 *   后续新增方法无需逐个插桩
 * - 入参/返回走 Logger.debug（开发构建默认 DEBUG 级全量可见；
 *   setLevel('INFO') 可静默追踪噪音），抛错走 Logger.error
 * - 异步感知：方法返回 thenable（契约全部为 Promise）时等待落定后
 *   再打印 resolved 值，reject 时以 error 级输出后原样透传拒绝，
 *   保证日志始终呈现真实结果而非 pending 的 Promise 对象
 * - 包装函数以原始实例为 this 执行：内部 this.xxx 辅助互调不经过代理，
 *   每次外部调用仅产生「入参 + 返回」两条日志，内部装配过程不打扰
 * - 同名方法的包装结果缓存，保持方法引用稳定（proxy.load === proxy.load）
 */
function withCallLogging<T extends object>(instance: T, label: string): T {
  const wrappedCache = new Map<string, (...args: unknown[]) => unknown>()
  return new Proxy(instance, {
    get(target: T, prop: string | symbol): unknown {
      if (typeof prop !== 'string' || prop === 'constructor') {
        return Reflect.get(target, prop)
      }
      const value = Reflect.get(target, prop)
      if (typeof value !== 'function') return value
      let wrapped = wrappedCache.get(prop)
      if (!wrapped) {
        const original = value as (this: T, ...args: unknown[]) => unknown
        wrapped = function (this: unknown, ...args: unknown[]): unknown {
          Logger.debug(`[${label}] ${prop}() 入参`, args)
          try {
            const result = original.apply(target, args)
            if (
              typeof result === 'object' &&
              result !== null &&
              typeof (result as { then?: unknown }).then === 'function'
            ) {
              return (result as Promise<unknown>).then(
                (resolved: unknown) => {
                  Logger.debug(`[${label}] ${prop}() 返回`, resolved)
                  return resolved
                },
                (e: unknown) => {
                  Logger.error(`[${label}] ${prop}() 抛错`, e)
                  throw e
                },
              )
            }
            Logger.debug(`[${label}] ${prop}() 返回`, result)
            return result
          } catch (e) {
            Logger.error(`[${label}] ${prop}() 抛错`, e)
            throw e
          }
        }
        wrappedCache.set(prop, wrapped)
      }
      return wrapped
    },
  })
}

export class DemoManagerApi implements ManagerApi {
  constructor() {
    // 演示实现的调用可观测性：所有方法经统一日志器打印入参与结果，
    // 便于联调核对契约调用时机（级别可由 Logger.setLevel 调整）
    return withCallLogging(this, 'DemoManagerApi')
  }

  /* ==================== 设置 ==================== */

  async getSettings(): Promise<Settings> {
    const db = getDB()
    const s =
      db.settings ||
      ({ indexTypes: [], typeMappings: [], tableOptions: [], columnOptions: [] } as Settings)
    const typeMappings = (Array.isArray(s.typeMappings) ? s.typeMappings : [])
      .slice()
      .sort((a, b) => a.sort - b.sort)
      .map((m) => ({
        sort: Number(m.sort) || 0,
        pattern: String(m.pattern ?? ''),
        javaType: String(m.javaType || 'String'),
      }))
    const indexTypes = (Array.isArray(s.indexTypes) ? s.indexTypes : [])
      .map((t) => String(t).trim().toUpperCase())
      .filter(Boolean)
    return {
      indexTypes,
      typeMappings,
      author: String(s.author ?? '').trim() || undefined,
      tableOptions: normalizeOptionSettings(s.tableOptions),
      columnOptions: normalizeOptionSettings(s.columnOptions),
      fieldConventions: normalizeFieldConventions(s.fieldConventions),
    }
  }

  async saveSettings(settings: Settings): Promise<void> {
    // 规则校验：非空 pattern + 合法正则；索引类型去重归一；选项名称非空唯一
    const typeMappings: TypeMapping[] = (settings.typeMappings || []).map((m, i) => {
      const pattern = String(m.pattern ?? '').trim()
      if (!pattern) throw new Error('存在空的列类型正则表达式')
      assertRegex(pattern)
      return { sort: i, pattern, javaType: String(m.javaType || 'String') }
    })
    const seen = new Set<string>()
    const indexTypes: string[] = []
    for (const raw of settings.indexTypes || []) {
      const t = String(raw ?? '')
        .trim()
        .toUpperCase()
      if (!t) throw new Error('索引类型不能为空')
      if (seen.has(t)) throw new Error(`索引类型重复：${t}`)
      seen.add(t)
      indexTypes.push(t)
    }
    if (!indexTypes.length) throw new Error('至少保留一个索引类型')
    const tableOptions = normalizeOptionSettings(settings.tableOptions, '表选项')
    const columnOptions = normalizeOptionSettings(settings.columnOptions, '列选项')
    // 主键、审计与逻辑删除字段约定：归一后校验名称合法且互不重复
    const fieldConventions = normalizeFieldConventions(settings.fieldConventions)
    const convNames = [
      fieldConventions.primaryKey.name,
      ...AUDIT_FIELD_ROLES.map((role) => fieldConventions.auditFields[role].name),
      fieldConventions.logicDelete.name,
    ]
    for (const n of convNames) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(n))
        throw new Error(`字段约定名称需为合法标识符（字母/数字/下划线）：${n}`)
    }
    if (new Set(convNames).size !== convNames.length)
      throw new Error('主键、审计与逻辑删除字段的名称需互不重复')
    getDB().settings = {
      indexTypes,
      typeMappings,
      author: String(settings.author ?? '').trim() || undefined,
      tableOptions,
      columnOptions,
      fieldConventions,
    }
    persistDB()
  }

  /* ==================== AI 设置 ==================== */

  async getAiSettings(): Promise<AiSettings> {
    const raw = getDB().aiSettings
    // 读取时兜底归一（旧库缺字段 / 形态漂移防御），不落盘
    const models: AiModelConfig[] = []
    const seen = new Set<string>()
    for (const m of raw?.models || []) {
      const id = String(m?.id ?? '').trim()
      if (!id || seen.has(id)) continue
      seen.add(id)
      const supportsThinking = Boolean(m?.supportsThinking)
      models.push({
        id,
        name: String(m?.name ?? '').trim() || id,
        supportsThinking,
        thinkingIntensity: supportsThinking
          ? THINKING_INTENSITIES.includes(m?.thinkingIntensity as ThinkingIntensity)
            ? (m?.thinkingIntensity as ThinkingIntensity)
            : 'medium'
          : undefined,
        inputContextLength:
          Math.max(0, Math.floor(Number(m?.inputContextLength) || 0)) || undefined,
        outputContextLength:
          Math.max(0, Math.floor(Number(m?.outputContextLength) || 0)) || undefined,
      })
    }
    return {
      baseUrl: String(raw?.baseUrl ?? '').trim(),
      apiKey: String(raw?.apiKey ?? ''),
      models,
      globalRules: String(raw?.globalRules ?? ''),
    }
  }

  async saveAiSettings(settings: AiSettings): Promise<void> {
    const baseUrl = String(settings?.baseUrl ?? '').trim()
    const apiKey = String(settings?.apiKey ?? '')
    if (baseUrl) {
      if (!/^https?:\/\//i.test(baseUrl))
        throw new Error('AI 服务地址必须以 http:// 或 https:// 开头')
      if (!/\/v1\/?$/i.test(baseUrl))
        throw new Error('AI 服务地址必须以 /v1 结尾（如 https://api.example.com/v1）')
    }
    const models: AiModelConfig[] = []
    const seen = new Set<string>()
    for (const m of settings?.models || []) {
      const id = String(m?.id ?? '').trim()
      if (!id) throw new Error('模型 id 不能为空')
      if (seen.has(id)) throw new Error(`模型 id 重复：${id}`)
      seen.add(id)
      const supportsThinking = Boolean(m?.supportsThinking)
      let thinkingIntensity: ThinkingIntensity | undefined
      if (supportsThinking) {
        thinkingIntensity = THINKING_INTENSITIES.includes(m?.thinkingIntensity as ThinkingIntensity)
          ? (m?.thinkingIntensity as ThinkingIntensity)
          : 'medium'
      }
      models.push({
        id,
        name: String(m?.name ?? '').trim() || id,
        supportsThinking,
        thinkingIntensity,
        inputContextLength:
          Math.max(0, Math.floor(Number(m?.inputContextLength) || 0)) || undefined,
        outputContextLength:
          Math.max(0, Math.floor(Number(m?.outputContextLength) || 0)) || undefined,
      })
    }
    if (models.length && !baseUrl) throw new Error('已配置模型列表时必须填写 AI 服务地址')
    getDB().aiSettings = {
      baseUrl,
      apiKey,
      models,
      globalRules: String(settings?.globalRules ?? ''),
    }
    persistDB()
  }

  /* ==================== AI 对话（openai compatible 流式） ==================== */

  async chatComplete(
    request: ChatCompletionRequest,
    onDelta?: (delta: ChatCompletionDelta) => void,
  ): Promise<ChatCompletionResult> {
    const settings = getDB().aiSettings
    const baseUrl = String(settings?.baseUrl ?? '')
      .trim()
      .replace(/\/+$/, '')
    if (!baseUrl) throw new Error('未配置 AI 服务地址，请先在「系统设置 → AI」中配置')
    const model = String(request?.model ?? '').trim()
    if (!model) throw new Error('缺少模型 id')

    const body: Record<string, unknown> = {
      model,
      messages: (request?.messages || []).map(toWireMessage),
      stream: true,
    }
    if (request?.tools?.length) body.tools = request.tools
    if (request?.reasoningEffort) body.reasoning_effort = request.reasoningEffort
    if (request?.maxTokens) body.max_tokens = request.maxTokens

    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (settings.apiKey) headers.Authorization = `Bearer ${settings.apiKey}`

    let res: Response
    try {
      res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: request?.signal,
      })
    } catch (e: unknown) {
      if ((e as Error)?.name === 'AbortError') throw e
      throw new Error(
        `无法连接 AI 服务（${baseUrl}）：${(e as Error)?.message || '网络错误'}；跨域或证书问题请检查服务端 CORS 配置`,
      )
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      let detail = text
      try {
        const parsed = JSON.parse(text) as { error?: { message?: string }; message?: string }
        detail = parsed?.error?.message || parsed?.message || text
      } catch {
        /* 非 JSON 错误体原样展示 */
      }
      throw new Error(`AI 服务请求失败（HTTP ${res.status}）：${String(detail).slice(0, 400)}`)
    }
    const reader = res.body?.getReader()
    if (!reader) throw new Error('AI 服务未返回流式响应（响应体为空）')

    // SSE 逐行解析：data: {chunk} 与 [DONE] 哨兵；三类增量聚合
    const decoder = new TextDecoder()
    const contentParts: string[] = []
    const reasoningParts: string[] = []
    const toolSlots = new Map<number, { id: string; name: string; args: string }>()
    let finishReason: string | undefined
    let doneSentinel = false
    const emit = (delta: ChatCompletionDelta) => {
      if (!onDelta) return
      try {
        onDelta(delta)
      } catch {
        /* 回调异常不中断流式消费 */
      }
    }
    let buffer = ''
    while (!doneSentinel) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith(':')) continue // 空行 / SSE 注释与心跳
        if (!trimmed.startsWith('data:')) continue
        const payload = trimmed.slice(5).trim()
        if (payload === '[DONE]') {
          doneSentinel = true
          break
        }
        let chunk: {
          choices?: Array<{
            finish_reason?: string | null
            delta?: {
              content?: string | null
              reasoning_content?: string | null
              reasoning?: string | null
              tool_calls?: Array<{
                index?: number
                id?: string
                function?: { name?: string; arguments?: string }
              }>
            }
          }>
        }
        try {
          chunk = JSON.parse(payload)
        } catch {
          continue // 非完整 JSON 分片（粘包残留）跳过
        }
        const choice = chunk.choices?.[0]
        if (choice?.finish_reason) finishReason = String(choice.finish_reason)
        const delta = choice?.delta
        if (!delta) continue
        if (typeof delta.content === 'string' && delta.content) {
          contentParts.push(delta.content)
          emit({ content: delta.content })
        }
        const reasoning =
          typeof delta.reasoning_content === 'string'
            ? delta.reasoning_content
            : typeof delta.reasoning === 'string'
              ? delta.reasoning
              : ''
        if (reasoning) {
          reasoningParts.push(reasoning)
          emit({ reasoning })
        }
        if (Array.isArray(delta.tool_calls)) {
          for (const tc of delta.tool_calls) {
            const index = Number(tc?.index ?? 0) || 0
            let slot = toolSlots.get(index)
            if (!slot) {
              slot = { id: '', name: '', args: '' }
              toolSlots.set(index, slot)
            }
            if (tc?.id) slot.id = String(tc.id)
            const fn = tc?.function || {}
            if (fn.name) slot.name = String(fn.name)
            const argsPiece = typeof fn.arguments === 'string' ? fn.arguments : ''
            if (argsPiece) slot.args += argsPiece
            emit({
              toolCall: {
                index,
                ...(tc?.id ? { id: String(tc.id) } : {}),
                ...(fn.name ? { name: String(fn.name) } : {}),
                ...(argsPiece ? { arguments: argsPiece } : {}),
              },
            })
          }
        }
      }
    }
    return {
      content: contentParts.join(''),
      reasoning: reasoningParts.length ? reasoningParts.join('') : undefined,
      toolCalls: [...toolSlots.entries()]
        .sort((a, b) => a[0] - b[0])
        .filter(([, t]) => t.name)
        .map(([i, t]) => ({
          id: t.id || `call_${i}`,
          type: 'function' as const,
          function: { name: t.name, arguments: t.args || '{}' },
        })),
      finishReason,
    }
  }

  /* ==================== 数据库导入 ==================== */

  async importFromDB(): Promise<DBTable[]> {
    // 演示实现：返回内置模拟真实库表结构（正式实现对接真实数据库）
    return clone(SEED_DB_TABLES)
  }

  /* ==================== 模型全量加载 / 保存 ==================== */

  async load(): Promise<LoadResultVO> {
    const db = getDB()
    return {
      categories: clone(db.categories),
      tables: this.assembleTables(db.tables.map((t) => t.id)),
      navigates: clone(db.navigates),
    }
  }

  /** 全量保存（无参契约）：demo 的每次细粒度操作已即时写库，此处确认整体落盘 */
  async save(): Promise<void> {
    persistDB()
  }

  /* ==================== 分类 ==================== */

  async getCategories(): Promise<TableCategory[]> {
    return clone(getDB().categories)
  }

  async addCategory(category: TableCategory): Promise<void> {
    const db = getDB()
    const name = requireStr(category?.name, 'name', '分类名称')
    requireStr(category?.basePackage, 'basePackage', '基础包路径')
    if (db.categories.some((c) => c.name === name)) throw new Error(`分类名称已存在: ${name}`)
    if (!category.id) throw new Error('新增分类必须提供 id')
    if (db.categories.some((c) => c.id === category.id))
      throw new Error(`分类 id 已存在: ${category.id}`)
    db.categories.push(clone(category))
    persistDB()
  }

  async updateCategory(category: TableCategory): Promise<void> {
    const db = getDB()
    const id = requireStr(category?.id, 'id', '分类ID')
    const target = db.categories.find((c) => c.id === id)
    if (!target) throw new Error(`分类不存在: ${id}`)
    const name = requireStr(category?.name, 'name', '分类名称')
    requireStr(category?.basePackage, 'basePackage', '基础包路径')
    if (db.categories.some((c) => c.name === name && c.id !== id))
      throw new Error(`分类名称已存在: ${name}`)
    Object.assign(target, clone(category))
    persistDB()
  }

  async removeCategory(categoryId: string): Promise<void> {
    const db = getDB()
    if (!db.categories.some((c) => c.id === categoryId)) return
    const held = db.tables.filter((t) => t.categoryId === categoryId)
    if (held.length) {
      throw new Error(
        `分类下仍有 ${held.length} 张表（${held[0].tableName} 等），请先删除或迁移这些表`,
      )
    }
    db.categories = db.categories.filter((c) => c.id !== categoryId)
    persistDB()
  }

  /* ==================== 表 ==================== */

  async getTables(): Promise<ManagerTable[]> {
    return this.assembleTables(getDB().tables.map((t) => t.id))
  }

  async addTable(table: ManagerTable): Promise<void> {
    const db = getDB()
    const name = requireStr(table?.tableName, 'tableName', '表名')
    if (db.tables.some((t) => t.tableName === name)) throw new Error(`表名已存在: ${name}`)
    if (!table.id) throw new Error('新增表必须提供 id')
    if (db.tables.some((t) => t.id === table.id)) throw new Error(`表 id 已存在: ${table.id}`)
    if (!db.categories.some((c) => c.id === table.categoryId)) {
      throw new Error(`表 ${name} 的所属分类不存在`)
    }
    const columns = normalizeColumns(table, name)
    const indexes = normalizeIndexes(table, name, columns)
    const { columns: _c, indexes: _i, ...meta } = table
    db.tables.push({ ...clone(meta), id: table.id })
    for (const c of columns) db.columns.push({ ...c, tableId: table.id })
    for (const i of indexes) db.indexes.push({ ...i, tableId: table.id })
    persistDB()
  }

  async updateTable(table: ManagerTable): Promise<void> {
    const db = getDB()
    const id = requireStr(table?.id, 'id', '表ID')
    const target = db.tables.find((t) => t.id === id)
    if (!target) throw new Error(`表不存在: ${id}`)
    const name = requireStr(table?.tableName, 'tableName', '表名')
    if (db.tables.some((t) => t.tableName === name && t.id !== id))
      throw new Error(`表名已存在: ${name}`)
    if (!db.categories.some((c) => c.id === table.categoryId)) {
      throw new Error(`表 ${name} 的所属分类不存在`)
    }
    const columns = normalizeColumns(table, name)
    const indexes = normalizeIndexes(table, name, columns)
    Object.assign(target, { ...clone(table), id })
    db.columns = db.columns.filter((c) => c.tableId !== id)
    db.indexes = db.indexes.filter((i) => i.tableId !== id)
    for (const c of columns) db.columns.push({ ...c, tableId: id })
    for (const i of indexes) db.indexes.push({ ...i, tableId: id })
    persistDB()
  }

  /** 删除表（一并删除其字段、索引与关联导航） */
  async removeTable(tableId: string): Promise<void> {
    const db = getDB()
    if (!db.tables.some((t) => t.id === tableId)) return
    db.tables = db.tables.filter((t) => t.id !== tableId)
    db.columns = db.columns.filter((c) => c.tableId !== tableId)
    db.indexes = db.indexes.filter((i) => i.tableId !== tableId)
    db.navigates = db.navigates.filter(
      (n) => n.self !== tableId && n.target !== tableId && n.mappingTable !== tableId,
    )
    persistDB()
  }

  /**
   * 批量更新表位置（拖动一个或多个表卡片结束时使用；多选同动仅一次调用）
   * 先整体校验再写入：任一表不存在则抛错且不落盘（all-or-nothing），
   * 全部命中后统一写库并单次落盘。
   */
  async updateTablePos(tablePoses: UpdateTablePosDTO): Promise<void> {
    const db = getDB()
    const list = tablePoses?.tables ?? []
    if (!list.length) return
    for (const item of list) {
      if (!db.tables.some((t) => t.id === item.tableId)) {
        throw new Error(`表不存在: ${item.tableId}`)
      }
    }
    for (const item of list) {
      const target = db.tables.find((t) => t.id === item.tableId)
      if (!target) continue
      target.x = Number(item.pos?.x) || 0
      target.y = Number(item.pos?.y) || 0
    }
    persistDB()
  }

  /* ==================== 导航 ==================== */

  async getNavigates(): Promise<TableNavigate[]> {
    return clone(getDB().navigates)
  }

  async addNavigate(navigate: TableNavigate): Promise<void> {
    const db = getDB()
    const nav = normalizeNavigate(navigate)
    if (db.navigates.some((n) => n.id === nav.id)) throw new Error(`导航 id 已存在: ${nav.id}`)
    db.navigates.push(clone(nav))
    persistDB()
  }

  async updateNavigate(navigate: TableNavigate): Promise<void> {
    const db = getDB()
    const nav = normalizeNavigate(navigate)
    const idx = db.navigates.findIndex((n) => n.id === nav.id)
    if (idx < 0) throw new Error(`导航不存在: ${nav.id}`)
    db.navigates[idx] = clone(nav)
    persistDB()
  }

  async removeNavigate(navigateId: string): Promise<void> {
    const db = getDB()
    if (!db.navigates.some((n) => n.id === navigateId)) return
    db.navigates = db.navigates.filter((n) => n.id !== navigateId)
    persistDB()
  }

  /* ==================== 字典分类 ==================== */

  async getDictCategories(): Promise<DictCategory[]> {
    return clone(getDB().dictCategories)
  }

  async addDictCategory(category: DictCategory): Promise<void> {
    const db = getDB()
    const name = requireStr(category?.name, 'name', '分类名称')
    if (db.dictCategories.some((c) => c.name === name))
      throw new Error(`字典分类名称已存在: ${name}`)
    if (!category.id) throw new Error('新增字典分类必须提供 id')
    const { basePackage, className } = normalizeDictCategory(category)
    db.dictCategories.push({
      id: category.id,
      name,
      basePackage,
      className,
    })
    persistDB()
  }

  async updateDictCategory(category: DictCategory): Promise<void> {
    const db = getDB()
    const id = requireStr(category?.id, 'id', '字典分类ID')
    const target = db.dictCategories.find((c) => c.id === id)
    if (!target) throw new Error(`字典分类不存在: ${id}`)
    const name = requireStr(category?.name, 'name', '分类名称')
    if (db.dictCategories.some((c) => c.name === name && c.id !== id))
      throw new Error(`字典分类名称已存在: ${name}`)
    const { basePackage, className } = normalizeDictCategory(category)
    target.name = name
    target.basePackage = basePackage
    target.className = className
    persistDB()
  }

  async removeDictCategory(categoryId: string): Promise<void> {
    const db = getDB()
    if (db.dicts.some((d) => d.categoryId === categoryId))
      throw new Error('该分类下仍有字典，无法删除（请先移动或删除其下字典）')
    db.dictCategories = db.dictCategories.filter((c) => c.id !== categoryId)
    persistDB()
  }

  /* ==================== 字典 ==================== */

  async getDicts(): Promise<Dict[]> {
    return clone(getDB().dicts)
  }

  async addDict(dict: Dict): Promise<void> {
    const db = getDB()
    const dictKey = requireStr(dict?.dictKey, 'dictKey', '字典键')
    if (db.dicts.some((d) => d.dictKey === dictKey)) throw new Error(`字典键已存在: ${dictKey}`)
    const normalized = normalizeDict(dict, dictKey)
    if (!normalized.id) throw new Error('新增字典必须提供 id')
    db.dicts.push(clone(normalized))
    persistDB()
  }

  async updateDict(dict: Dict): Promise<void> {
    const db = getDB()
    const id = requireStr(dict?.id, 'id', '字典ID')
    const target = db.dicts.find((d) => d.id === id)
    if (!target) throw new Error(`字典不存在: ${id}`)
    const dictKey = requireStr(dict?.dictKey, 'dictKey', '字典键')
    if (db.dicts.some((d) => d.dictKey === dictKey && d.id !== id))
      throw new Error(`字典键已存在: ${dictKey}`)
    Object.assign(target, clone(normalizeDict(dict, dictKey)))
    persistDB()
  }

  async removeDict(dictId: string): Promise<void> {
    const db = getDB()
    db.dicts = db.dicts.filter((d) => d.id !== dictId)
    persistDB()
  }

  /* ==================== 字典分类模板 ==================== */

  async getDictCategoryTemplate(): Promise<Template> {
    const t = getDB().dictCategoryTemplate
    return { id: t.id, templateName: t.name, content: t.content }
  }

  async updateDictCategoryTemplate(template: Template): Promise<void> {
    const db = getDB()
    const target = db.dictCategoryTemplate
    if (!target || target.id !== template?.id)
      throw new Error(`字典分类模板不存在: ${template?.id}`)
    const name = requireStr(template?.templateName, 'templateName', '模板名称')
    target.name = name
    target.content = String(template.content || '')
    persistDB()
  }

  /* ==================== 表模板 ==================== */

  async getTemplates(): Promise<Template[]> {
    return getDB().templates.map((t) => ({ id: t.id, templateName: t.name, content: t.content }))
  }

  async addTemplate(template: Template): Promise<void> {
    const db = getDB()
    const name = requireStr(template?.templateName, 'templateName', '模板名称')
    if (db.templates.some((t) => t.name === name)) throw new Error(`模板名称已存在: ${name}`)
    if (!template.id) throw new Error('新增模板必须提供 id')
    db.templates.push({ id: template.id, name, content: String(template.content || '') })
    persistDB()
  }

  async updateTemplate(template: Template): Promise<void> {
    const db = getDB()
    const id = requireStr(template?.id, 'id', '模板ID')
    const target = db.templates.find((t) => t.id === id)
    if (!target) throw new Error(`模板不存在: ${id}`)
    const name = requireStr(template?.templateName, 'templateName', '模板名称')
    if (db.templates.some((t) => t.name === name && t.id !== id))
      throw new Error(`模板名称已存在: ${name}`)
    target.name = name
    target.content = String(template.content || '')
    persistDB()
  }

  async removeTemplate(templateId: string): Promise<void> {
    const db = getDB()
    db.templates = db.templates.filter((t) => t.id !== templateId)
    persistDB()
  }

  /* ==================== 代码替换 ==================== */

  async replace(zipFile: Blob): Promise<void> {
    // 异步契约：zip 解析完成后 resolve；解析失败 reject 由调用方捕获处理
    const archive = await JSZip.loadAsync(zipFile)
    const files = Object.keys(archive.files).filter((name) => !archive.files[name].dir)
    message.success(`已接收 zip 并"替换" ${files.length} 个代码文件（demo 行为，未发生真实写入）`)
  }

  /* ==================== demo 扩展 ==================== */

  /** 重置为内置演示数据（ManagerApi 契约之外，仅 demo 实现提供） */
  async resetDemo(): Promise<void> {
    resetDB()
  }

  /* ==================== 内部辅助 ==================== */

  /** 按 id 列表组装完整表（含字段与索引），返回深拷贝 */
  private assembleTables(ids: string[]): ManagerTable[] {
    const db = getDB()
    return ids
      .map((id) => db.tables.find((t) => t.id === id))
      .filter((t): t is Table => Boolean(t))
      .map((t) => ({
        ...clone(t),
        columns: db.columns
          .filter((c) => c.tableId === t.id)
          .sort((a, b) => a.sort - b.sort)
          .map((c) => ({ ...c })),
        indexes: db.indexes
          .filter((i) => i.tableId === t.id)
          .map((i) => ({ ...i, columns: [...i.columns] })),
      }))
  }
}

/**
 * 字段列表归一：字段名非空唯一、tableId 归一、sort 重排；
 * 逻辑删除字段每表至多一个（多标拒绝，UI 勾选互斥之外的数据层兑底）
 */
function normalizeColumns(table: ManagerTable, tableName: string): TableColumn[] {
  const colNames = new Set<string>()
  let logicDeleteCount = 0
  const columns = (table.columns || []).map((c, i) => {
    const colName = requireStr(c?.columnName, 'columnName', '字段名')
    if (colNames.has(colName)) throw new Error(`表 ${tableName} 存在重复字段名：${colName}`)
    colNames.add(colName)
    if (c?.logicDelete === true) logicDeleteCount++
    return {
      ...clone(c),
      id: c.id || uid('c-'),
      tableId: table.id,
      sort: Number(c.sort ?? i) || i,
      // 仅显式 true 落库（false/缺省归一为 undefined，减少数据噪音）
      logicDelete: c?.logicDelete === true ? true : undefined,
    }
  })
  if (logicDeleteCount > 1)
    throw new Error(
      `表 ${tableName} 的逻辑删除字段最多只能有一个（当前标记了 ${logicDeleteCount} 个）`,
    )
  return columns
}

/** 索引列表归一：索引名非空唯一、索引字段存在 */
function normalizeIndexes(
  table: ManagerTable,
  tableName: string,
  columns: Array<{ columnName: string }>,
): TableIndex[] {
  const colNames = new Set(columns.map((c) => c.columnName))
  const idxNames = new Set<string>()
  return (table.indexes || []).map((i) => {
    const idxName = requireStr(i?.indexName, 'indexName', '索引名')
    if (idxNames.has(idxName)) throw new Error(`表 ${tableName} 存在重复索引名：${idxName}`)
    idxNames.add(idxName)
    const cols = (i.columns || []).map(String)
    for (const col of cols) {
      if (!colNames.has(col))
        throw new Error(`表 ${tableName} 的索引 ${idxName} 引用了不存在的字段：${col}`)
    }
    return { ...clone(i), id: i.id || uid('i-'), tableId: table.id, columns: cols }
  })
}

/** 导航关系归一：两端表存在、类型枚举合法、属性名非空 */
function normalizeNavigate(input: TableNavigate): TableNavigate {
  const db = getDB()
  const nav = clone(input)
  if (!nav.id) throw new Error('新增导航必须提供 id')
  requireStr(nav.selfPropertyName, 'selfPropertyName', 'self 属性名')
  requireStr(nav.targetPropertyName, 'targetPropertyName', 'target 属性名')
  if (!db.tables.some((t) => t.id === nav.self)) throw new Error(`导航 ${nav.id} 的 self 表不存在`)
  if (!db.tables.some((t) => t.id === nav.target))
    throw new Error(`导航 ${nav.id} 的 target 表不存在`)
  if (nav.mappingTable && !db.tables.some((t) => t.id === nav.mappingTable)) {
    throw new Error(`导航 ${nav.id} 的中间映射表不存在`)
  }
  if (!NAVIGATE_TYPES.includes(nav.type)) throw new Error(`导航 ${nav.id} 的类型无效: ${nav.type}`)
  return nav
}

/** 字典值归一：空值键拦截、标签回退、类型/颜色兜底；常量属性名统一转大写 */
function normalizeDictValue(v: Partial<DictValue>, dictKey: string): DictValue {
  const valueKey = String(v?.valueKey ?? '').trim()
  if (!valueKey) throw new Error(`字典 ${dictKey} 存在空值键`)
  const labelType = ['I', 'S', 'W', 'D'].includes(v?.labelType as string)
    ? (v?.labelType as DictValue['labelType'])
    : 'I'
  return {
    id: v?.id || uid('dv-'),
    dictId: String(v?.dictId || ''),
    valueKey,
    // 常量属性名仅允许全大写：小写输入自动转大写（数据层兜底，UI 层同步转换）
    propertyName: String(v?.propertyName ?? '')
      .trim()
      .toUpperCase(),
    label: String(v?.label ?? '').trim() || valueKey,
    labelType,
    comment: String(v?.comment || ''),
    color: String(v?.color || '').trim() || undefined,
  }
}

/**
 * 字典分类属性归一：basePackage 基础包路径（仅去空白与首尾点、压缩连续点）+
 * className 类名（非空时必须为大驼峰结构——首字母大写且仅字母数字，如 SysDictConstants）
 */
function normalizeDictCategory(category: DictCategory): {
  basePackage: string
  className: string
} {
  const basePackage = String(category?.basePackage || '')
    .trim()
    .replace(/\.{2,}/g, '.')
    .replace(/^\.+|\.+$/g, '')
  const className = String(category?.className || '').trim()
  if (className && !/^[A-Z][A-Za-z0-9]*$/.test(className))
    throw new Error(`类名称必须为大驼峰结构（如 SysDictConstants）: ${className}`)
  return { basePackage, className }
}

function normalizeDict(dict: Partial<Dict>, dictKey: string): Dict {
  const label = requireStr(dict?.label, 'label', '字典标签')
  return {
    id: String(dict?.id || ''),
    categoryId: String(dict?.categoryId || '').trim(),
    dictKey,
    label,
    comment: String(dict?.comment || ''),
    values: (dict?.values || []).map((v) => normalizeDictValue(v, dictKey)),
  }
}
