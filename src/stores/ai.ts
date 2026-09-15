/**
 * AI 仓库：AI 设置（openai compatible 供应商 / 模型列表 / 全局规则）加载保存
 * + AI 工具（AGENT 模式）会话状态与运行循环
 * （reactive 对象工厂形态，由 DBManagerView 经上下文注入，不依赖 Pinia）
 *
 * AGENT 运行方式：自动将 ManagerApi 全部能力（去除 AI 设置与 chatComplete 两项）
 * + 代码生成 + 代码替换注册为可调用工具（openai function calling 标准），
 * 全局规则非空时附加在系统提示中；按「模型流式输出 → 工具调用 → 结果回填 →
 * 继续生成」循环直至产出最终回答（轮数上限防失控）。工具对模型仓库等数据的
 * 改动在会话结束后按域同步刷新，保证画布 / 字典 / 模板 / 设置页与数据一致。
 */
import { reactive } from 'vue'
import { message } from 'antdv-next'
import { useDBManagerContext } from './context'
import type {
  AiModelConfig,
  AiSettings,
  ChatMessage,
  ChatToolCall,
  ChatToolSpec,
  ManagerApi,
  UpdateTablePosDTO,
} from '@/types/model'
import { errorMessageOf } from '@/api/manager-api'
import { uid } from '@/utils/id'
import type { DictStore } from './dict'
import type { ModelStore } from './model'
import type { SettingsStore } from './settings'
import type { TemplateStore } from './template'

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T
}

/* ==================== 会话展示模型 ==================== */

/** 助手消息携带的工具调用摘要（展示用；完整记录见 AiToolRecord） */
export interface AiChatToolCall {
  id: string // 与 ChatToolCall.id 对应（点击可定位右侧记录）
  name: string
  args: string // 原始 JSON 参数文本
}

/** 会话消息（左侧聊天区展示形态） */
export interface AiChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  /** 思考内容（reasoning 流式聚合） */
  reasoning?: string
  /** 思考块展开态：流式输出思考时自动展开，消息完成后自动收起（用户可随时手动切换） */
  reasoningOpen?: boolean
  /** 本条消息触发的工具调用（展示摘要） */
  toolCalls?: AiChatToolCall[]
  status: 'streaming' | 'done' | 'error' | 'aborted'
  error?: string
  createdAt: number
}

/** 能力调用记录（右侧面板展示形态） */
export interface AiToolRecord {
  id: string
  /** 对应 ChatToolCall.id（聊天区工具芯片点击定位用） */
  callId: string
  name: string
  argsText: string // 参数（pretty JSON / 原始文本）
  resultText: string // 返回值（pretty JSON）或错误信息
  status: 'running' | 'success' | 'error'
  durationMs?: number
  createdAt: number
}

/* ==================== 工具注册表 ==================== */

/** 工具改动后会话结束需同步刷新的仓库域 */
type ToolDomain = 'model' | 'dict' | 'template' | 'settings'

/** AGENT 工具（openai function calling 形态 + 执行器） */
interface AgentTool {
  spec: ChatToolSpec
  domains: ToolDomain[]
  invoke: (args: Record<string, unknown>) => Promise<unknown>
}

/** 工厂依赖 */
export interface AiDeps {
  getApi: () => ManagerApi
  getModel: () => ModelStore
  getDict: () => DictStore
  getTemplate: () => TemplateStore
  getSettings: () => SettingsStore
}

/* ---------- JSON Schema 构建辅助（紧凑书写契约参数） ---------- */

function obj(
  desc: string,
  properties: Record<string, unknown>,
  required: string[] = [],
): Record<string, unknown> {
  return { type: 'object', description: desc, properties, required }
}
const str = (desc: string) => ({ type: 'string', description: desc })
const strArr = (desc: string) => ({ type: 'array', items: { type: 'string' }, description: desc })
const int = (desc: string) => ({ type: 'integer', description: desc })
const bool = (desc: string) => ({ type: 'boolean', description: desc })

const NAV_TYPE = "'11'(一对一) | '1N'(一对多) | 'N1'(多对一) | 'NN'(多对多)"
const CASCADE = "'AUTO' | 'NO_ACTION' | 'SET_NULL' | 'DELETE'"

const columnSchema = obj('表字段', {
  id: str('字段ID（新增自行生成，前缀 c-）'),
  tableId: str('所属表ID'),
  columnName: str('字段名（蛇形，如 user_name）'),
  propertyName: str('Java属性名（小驼峰，缺省由字段名推导）'),
  sort: int('排序序号'),
  type: str('数据库类型（如 BIGINT / VARCHAR(255) / DATETIME）'),
  javaType: str('Java类型映射（如 Long / String / LocalDateTime）'),
  comment: str('注释'),
  notNull: bool('是否非空'),
  primaryKey: bool('是否主键'),
  dict: str('关联字典键（无关联为空串）'),
})

const indexSchema = obj('表索引', {
  id: str('索引ID（新增自行生成，前缀 i-）'),
  tableId: str('所属表ID'),
  indexName: str('索引名称（唯一）'),
  type: str('索引类型（可选列表见应用设置 indexTypes，如 UNIQUE / NORMAL）'),
  columns: strArr('索引字段名列表'),
  comment: str('索引注释'),
})

const tableSchema = obj('完整表定义（元信息 + 字段 + 索引）', {
  id: str('表ID（新增自行生成，前缀 t-）'),
  categoryId: str('所属分类ID（先 getCategories 查询真实值）'),
  tableName: str('表名（蛇形，唯一）'),
  className: str('实体类名（大驼峰，缺省由表名推导）'),
  comment: str('表注释'),
  parentIdColumn: str('树形表父id列名（非树形表为空）'),
  hidden: bool('是否隐藏'),
  x: int('画布x坐标'),
  y: int('画布y坐标'),
  templates: str('启用的模板名称列表（逗号分割；空 = 启用全部模板）'),
  columns: { type: 'array', description: '字段列表', items: columnSchema },
  indexes: { type: 'array', description: '索引列表', items: indexSchema },
})

const navigateSchema = obj('导航关系（self 与 target 可反转调换，但类型需同步调换）', {
  id: str('导航ID（新增自行生成，前缀 nav-）'),
  type: str(`导航类型：${NAV_TYPE}`),
  comment: str('导航注释'),
  selfPropertyName: str('self 侧属性名（小驼峰）'),
  targetPropertyName: str('target 侧属性名（小驼峰）'),
  self: str('self 表ID'),
  selfProperty: strArr('self 表关联属性（列名）'),
  selfMappingProperty: strArr('self 表映射属性（列名）'),
  mappingTable: str('中间映射表ID（仅多对多 NN，其余空串）'),
  target: str('target 表ID'),
  targetProperty: strArr('target 表关联属性（列名）'),
  targetMappingProperty: strArr('target 表映射属性（列名）'),
  selfToTargetCascade: str(`self 到 target 级联：${CASCADE}`),
  targetToSelfCascade: str(`target 到 self 级联：${CASCADE}`),
})

const dictValueSchema = obj('字典值', {
  id: str('值ID（新增自行生成，前缀 dv-）'),
  dictId: str('所属字典ID'),
  valueKey: str('值键（唯一）'),
  propertyName: str('常量属性名（全大写，如 ENABLED）'),
  label: str('值标签'),
  labelType: str("值类型：'I'(Info) | 'S'(Success) | 'W'(Warning) | 'D'(Danger)"),
  comment: str('值注释'),
  color: str('自定义颜色'),
})

const dictSchema = obj('字典', {
  id: str('字典ID（新增自行生成，前缀 dict-）'),
  categoryId: str('所属字典分类ID（空 = 未分类）'),
  dictKey: str('字典键（唯一）'),
  label: str('字典标签'),
  comment: str('字典注释'),
  values: { type: 'array', description: '字典值列表', items: dictValueSchema },
})

const templateSchema = obj('代码模板（Eta 语法）', {
  id: str('模板ID（新增自行生成，前缀 tpl-）'),
  templateName: str('模板名称（唯一）'),
  content: str('模板脚本内容（Eta 语法）'),
})

const categorySchema = obj('表分类', {
  id: str('分类ID（新增自行生成，前缀 cat-）'),
  name: str('分类名称（唯一）'),
  basePackage: str('基础包路径（如 com.example.sys）'),
  src: str('源码路径（用于替换）'),
})

const dictCategorySchema = obj('字典分类', {
  id: str('分类ID（新增自行生成，前缀 dictcat-）'),
  name: str('分类名称（唯一）'),
  basePackage: str('基础包路径（如 com.example.constants.dict）'),
  className: str('类名称（大驼峰，如 SysDictConstants）'),
})

const typeMappingSchema = obj('列类型映射规则', {
  sort: int('排序序号（升序，越小越优先）'),
  pattern: str('列类型正则表达式（忽略大小写）'),
  javaType: str('目标 Java 类型'),
})

const optionSettingSchema = obj('选项元定义', {
  name: str('选项名称（合法标识符）'),
  type: str("选项类型：'boolean' | 'string' | 'int' | 'long' | 'double' 或自定义"),
  label: str('选项标签'),
  remark: str('选项说明'),
  dict: str('关联字典键'),
})

const settingsSchema = obj('应用设置（保存为整体替换语义）', {
  indexTypes: strArr('索引类型列表（大写，至少一个）'),
  typeMappings: { type: 'array', description: '列类型映射规则', items: typeMappingSchema },
  author: str('代码作者（javadoc @author，空则省略）'),
  tableOptions: { type: 'array', description: '表选项元定义', items: optionSettingSchema },
  columnOptions: { type: 'array', description: '列选项元定义', items: optionSettingSchema },
})

/* ---------- 工具表项辅助 ---------- */

/** 单对象参数方法：schema 直接展开为工具参数，执行时把参数对象整体作为方法入参 */
function objectTool(
  name: string,
  desc: string,
  schema: Record<string, unknown>,
  domains: ToolDomain[],
  method:
    | 'saveSettings'
    | 'addCategory'
    | 'updateCategory'
    | 'addTable'
    | 'updateTable'
    | 'addNavigate'
    | 'updateNavigate'
    | 'addDictCategory'
    | 'updateDictCategory'
    | 'addDict'
    | 'updateDict'
    | 'addTemplate'
    | 'updateTemplate'
    | 'updateDictCategoryTemplate',
  deps: AiDeps,
): AgentTool {
  return {
    spec: { type: 'function', function: { name, description: desc, parameters: schema } },
    domains,
    invoke: (args) => {
      const fn = deps.getApi()[method] as (payload: unknown) => Promise<unknown>
      return fn(args)
    },
  }
}

/** 显式参数方法：声明参数 schema 与执行映射 */
function plainTool(
  name: string,
  desc: string,
  parameters: Record<string, unknown>,
  domains: ToolDomain[],
  invoke: (args: Record<string, unknown>) => Promise<unknown>,
): AgentTool {
  return {
    spec: { type: 'function', function: { name, description: desc, parameters } },
    domains,
    invoke,
  }
}

const NO_ARGS = obj('无参数', {})

/* ---------- 代码生成 / 代码替换共用 ---------- */

/** 文件内容回填上限（includeContent 开启时单文件截断长度） */
const FILE_CONTENT_CAP = 6000

/** 解析目标表 id 列表：表名 → id（未知名报错）；缺省 = 全部表 */
function resolveTableIds(deps: AiDeps, tableNames: unknown): string[] {
  const model = deps.getModel()
  if (Array.isArray(tableNames) && tableNames.length) {
    const names = tableNames.map(String)
    const unknown = names.filter((n) => !model.tableNames.has(n))
    if (unknown.length)
      throw new Error(`以下表名不存在：${unknown.join('、')}（可用表见 getTables 结果）`)
    return model.tables.filter((t) => names.includes(t.tableName)).map((t) => t.id)
  }
  return model.tables.map((t) => t.id)
}

/** 确保相关仓库已加载后按范围生成文件 */
async function generateFilesOf(deps: AiDeps, args: Record<string, unknown>) {
  const [model, tpl, dict] = [deps.getModel(), deps.getTemplate(), deps.getDict()]
  await Promise.all([model.init(), tpl.init(), dict.init()])
  const tableIds = resolveTableIds(deps, args.tableNames)
  const templateNames = Array.isArray(args.templateNames)
    ? args.templateNames.map(String)
    : undefined
  const { files } = tpl.generateFiles(tableIds, templateNames, args.dictEnabled !== false)
  return files
}

/* ==================== 系统提示 ==================== */

/** AGENT 系统提示：能力说明 + 工作约定 +（可选）全局规则 */
function buildSystemPrompt(globalRules: string): string {
  const base = `你是「图形数据库模型编辑工具」内嵌的 AI 助手，运行在 AGENT 模式：可以通过工具直接读写当前模型数据，并执行代码生成与代码替换。

能力域：
- 表分类：getCategories / addCategory / updateCategory / removeCategory
- 表结构：getTables / addTable / updateTable / removeTable / updateTablePos（含字段与索引）
- 导航关系：getNavigates / addNavigate / updateNavigate / removeNavigate
- 字典：getDictCategories / addDictCategory / updateDictCategory / removeDictCategory / getDicts / addDict / updateDict / removeDict
- 模板：getTemplates / addTemplate / updateTemplate / removeTemplate / getDictCategoryTemplate / updateDictCategoryTemplate
- 设置与数据：getSettings / saveSettings / importFromDB / load / save / resetDemo
- 代码生成：generateCode（按模板生成产物并返回文件清单）
- 代码替换：replaceCode（生成并写回源码文件，属危险操作）

工作约定：
1. 修改前先调用查询类工具了解现状（如 getTables / getDicts），使用返回数据中的真实 id 与字段名构造载荷，不要虚构
2. 新增对象需自行生成唯一 id，惯例前缀：分类 cat-、表 t-、字段 c-、索引 i-、导航 nav-、字典分类 dictcat-、字典 dict-、字典值 dv-、模板 tpl-
3. 工具执行失败会返回中文原因：阅读后修正参数重试，不要以相同参数硬试
4. 代码生成 / 替换按表名（tableName）指定范围，不使用 id
5. 完成任务后，用简洁的中文总结所做的修改与结果`
  const rules = String(globalRules ?? '').trim()
  if (!rules) return base
  return `${base}

【全局规则】（用户在 AI 设置中配置，优先级最高，必须遵守）：
${rules}`
}

/* ==================== 结果文本辅助 ==================== */

/** 工具结果回填模型的上限（超限截断，避免撑爆上下文） */
const MODEL_RESULT_CAP = 48000

function prettyJson(value: unknown): string {
  if (value === undefined) return '(void)'
  try {
    return JSON.stringify(value, null, 2) ?? String(value)
  } catch {
    return String(value)
  }
}

function capForModel(text: string): string {
  return text.length > MODEL_RESULT_CAP
    ? `${text.slice(0, MODEL_RESULT_CAP)}\n…（结果过长已截断，共 ${text.length} 字符）`
    : text
}

/** JSON 解析（空文本回退空对象；非法 JSON 抛错） */
function safeParseJson(text: string): Record<string, unknown> {
  const raw = String(text ?? '').trim()
  if (!raw) return {}
  const parsed = JSON.parse(raw) as unknown
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed))
    return { value: parsed }
  return parsed as Record<string, unknown>
}

/** 单次会话工具调用轮数上限（防失控循环） */
const MAX_TOOL_ROUNDS = 12

/**
 * 构建 AGENT 工具注册表：ManagerApi 全部能力（去除 AI 设置与 chatComplete；
 * replace 为 zip 二进制参数不可 JSON 化，由代码替换工具承担）+ 代码生成 + 代码替换。
 * 每次 send 重建（捕获当次 deps；api prop 切换后取到新实例，resetDemo 按需注册）。
 */
function buildAgentTools(deps: AiDeps): AgentTool[] {
  const api = deps.getApi()
  const tools: AgentTool[] = []

  /* ---------- 设置 ---------- */
  tools.push(
    plainTool(
      'getSettings',
      '获取应用设置（索引类型列表 / 列类型映射规则 / 代码生成配置）',
      NO_ARGS,
      [],
      async () => api.getSettings(),
    ),
  )
  tools.push(
    objectTool(
      'saveSettings',
      '保存应用设置（整体替换语义；索引类型至少一个，正则需合法）',
      settingsSchema,
      ['settings'],
      'saveSettings',
      deps,
    ),
  )
  tools.push(
    plainTool(
      'importFromDB',
      '从真实数据库读取表结构（返回可导入的表 / 字段 / 索引定义）',
      NO_ARGS,
      [],
      async () => api.importFromDB(),
    ),
  )

  /* ---------- 模型全量 ---------- */
  tools.push(
    plainTool('load', '加载完整模型（分类 / 表 / 导航关系一次性返回）', NO_ARGS, [], async () =>
      api.load(),
    ),
  )
  tools.push(
    plainTool('save', '全量保存模型（确认全部修改落盘时使用）', NO_ARGS, [], async () =>
      api.save(),
    ),
  )

  /* ---------- 分类 ---------- */
  tools.push(
    plainTool('getCategories', '获取全部表分类', NO_ARGS, [], async () => api.getCategories()),
  )
  tools.push(
    objectTool('addCategory', '新增表分类', categorySchema, ['model'], 'addCategory', deps),
  )
  tools.push(
    objectTool(
      'updateCategory',
      '更新表分类（按 id 整体替换）',
      categorySchema,
      ['model'],
      'updateCategory',
      deps,
    ),
  )
  tools.push(
    plainTool(
      'removeCategory',
      '删除表分类（分类下仍有表时拒绝）',
      obj('删除参数', { categoryId: str('分类ID') }, ['categoryId']),
      ['model'],
      async (a) => api.removeCategory(String(a.categoryId)),
    ),
  )

  /* ---------- 表 ---------- */
  tools.push(
    plainTool(
      'getTables',
      '获取全部表（含字段 / 索引 / 画布位置；修改前先查询真实 id 与字段名）',
      NO_ARGS,
      [],
      async () => api.getTables(),
    ),
  )
  tools.push(
    objectTool(
      'addTable',
      '新增表（含字段与索引；表名唯一，字段名表内唯一）',
      tableSchema,
      ['model'],
      'addTable',
      deps,
    ),
  )
  tools.push(
    objectTool(
      'updateTable',
      '更新表（按 id 整体替换，含字段与索引）',
      tableSchema,
      ['model'],
      'updateTable',
      deps,
    ),
  )
  tools.push(
    plainTool(
      'removeTable',
      '删除表（一并删除其字段、索引与关联导航）',
      obj('删除参数', { tableId: str('表ID') }, ['tableId']),
      ['model'],
      async (a) => api.removeTable(String(a.tableId)),
    ),
  )
  tools.push(
    plainTool(
      'updateTablePos',
      '批量更新表位置（拖动结束落点保存）',
      obj(
        '位置载荷',
        {
          tables: {
            type: 'array',
            description: '移动的表位置列表',
            items: obj('单项', {
              tableId: str('表ID'),
              pos: obj('坐标', { x: int('x坐标'), y: int('y坐标') }),
            }),
          },
        },
        ['tables'],
      ),
      ['model'],
      async (a) => api.updateTablePos(a as unknown as UpdateTablePosDTO),
    ),
  )

  /* ---------- 导航 ---------- */
  tools.push(
    plainTool('getNavigates', '获取全部表间导航关系', NO_ARGS, [], async () => api.getNavigates()),
  )
  tools.push(
    objectTool(
      'addNavigate',
      '新增导航关系（两端表必须已存在）',
      navigateSchema,
      ['model'],
      'addNavigate',
      deps,
    ),
  )
  tools.push(
    objectTool(
      'updateNavigate',
      '更新导航关系（按 id 整体替换）',
      navigateSchema,
      ['model'],
      'updateNavigate',
      deps,
    ),
  )
  tools.push(
    plainTool(
      'removeNavigate',
      '删除导航关系',
      obj('删除参数', { navigateId: str('导航ID') }, ['navigateId']),
      ['model'],
      async (a) => api.removeNavigate(String(a.navigateId)),
    ),
  )

  /* ---------- 字典分类 ---------- */
  tools.push(
    plainTool('getDictCategories', '获取全部字典分类', NO_ARGS, [], async () =>
      api.getDictCategories(),
    ),
  )
  tools.push(
    objectTool(
      'addDictCategory',
      '新增字典分类',
      dictCategorySchema,
      ['dict'],
      'addDictCategory',
      deps,
    ),
  )
  tools.push(
    objectTool(
      'updateDictCategory',
      '更新字典分类（按 id 整体替换）',
      dictCategorySchema,
      ['dict'],
      'updateDictCategory',
      deps,
    ),
  )
  tools.push(
    plainTool(
      'removeDictCategory',
      '删除字典分类（分类下仍有字典时拒绝）',
      obj('删除参数', { categoryId: str('字典分类ID') }, ['categoryId']),
      ['dict'],
      async (a) => api.removeDictCategory(String(a.categoryId)),
    ),
  )

  /* ---------- 字典 ---------- */
  tools.push(
    plainTool('getDicts', '获取全部字典（含字典值）', NO_ARGS, [], async () => api.getDicts()),
  )
  tools.push(
    objectTool(
      'addDict',
      '新增字典（含字典值；字典键唯一）',
      dictSchema,
      ['dict'],
      'addDict',
      deps,
    ),
  )
  tools.push(
    objectTool(
      'updateDict',
      '更新字典（按 id 整体替换，含字典值）',
      dictSchema,
      ['dict'],
      'updateDict',
      deps,
    ),
  )
  tools.push(
    plainTool(
      'removeDict',
      '删除字典',
      obj('删除参数', { dictId: str('字典ID') }, ['dictId']),
      ['dict'],
      async (a) => api.removeDict(String(a.dictId)),
    ),
  )

  /* ---------- 模板 ---------- */
  tools.push(
    plainTool('getTemplates', '获取全部表模板（Eta 语法）', NO_ARGS, [], async () =>
      api.getTemplates(),
    ),
  )
  tools.push(
    objectTool('addTemplate', '新增表模板', templateSchema, ['template'], 'addTemplate', deps),
  )
  tools.push(
    objectTool(
      'updateTemplate',
      '更新表模板（按 id 整体替换）',
      templateSchema,
      ['template'],
      'updateTemplate',
      deps,
    ),
  )
  tools.push(
    plainTool(
      'removeTemplate',
      '删除表模板',
      obj('删除参数', { templateId: str('模板ID') }, ['templateId']),
      ['template'],
      async (a) => api.removeTemplate(String(a.templateId)),
    ),
  )
  tools.push(
    plainTool(
      'getDictCategoryTemplate',
      '获取字典分类模板（仅一个，按分类生成字典代码）',
      NO_ARGS,
      [],
      async () => api.getDictCategoryTemplate(),
    ),
  )
  tools.push(
    objectTool(
      'updateDictCategoryTemplate',
      '更新字典分类模板（按 id 整体替换）',
      templateSchema,
      ['template'],
      'updateDictCategoryTemplate',
      deps,
    ),
  )

  /* ---------- demo 扩展 ---------- */
  if (typeof api.resetDemo === 'function') {
    tools.push(
      plainTool(
        'resetDemo',
        '重置为内置演示数据（危险操作：当前全部数据将被覆盖，仅在用户明确要求时使用）',
        NO_ARGS,
        ['model', 'dict', 'template', 'settings'],
        async () => api.resetDemo!(),
      ),
    )
  }

  /* ---------- 代码生成 / 代码替换（合成能力） ---------- */
  const codegenParams = obj('生成范围（全部缺省 = 全部表 + 全部模板 + 生成字典分类代码）', {
    tableNames: strArr('目标表名列表（缺省 = 全部表）'),
    templateNames: strArr('参与的表模板名称列表（缺省 = 全部模板；表级启用模板配置仍生效）'),
    dictEnabled: bool('是否生成字典分类模板代码（默认 true）'),
  })
  tools.push(
    plainTool(
      'generateCode',
      '代码生成：按表模板与字典分类模板生成代码产物，返回文件清单（templateName / tableName / fileName / filePath / size）。不写回源码、不触发下载。',
      obj('生成参数', {
        ...(codegenParams.properties as Record<string, unknown>),
        includeContent: bool(
          '是否在结果中附带每个文件的生成内容（默认 false，内容较大时谨慎开启）',
        ),
      }),
      [],
      async (a) => {
        const files = await generateFilesOf(deps, a)
        return {
          total: files.length,
          files: files.map((f) => ({
            templateName: f.templateName,
            tableName: f.tableName,
            fileName: f.fileName,
            filePath: f.filePath,
            size: f.content.length,
            ...(a.includeContent
              ? {
                  content:
                    f.content.length > FILE_CONTENT_CAP
                      ? `${f.content.slice(0, FILE_CONTENT_CAP)}\n…（内容过长已截断，共 ${f.content.length} 字符）`
                      : f.content,
                }
              : {}),
          })),
        }
      },
    ),
  )
  tools.push(
    plainTool(
      'replaceCode',
      '代码替换：按模板生成代码产物并经代码替换接口写回对应源码文件（危险操作：会覆盖目标源码文件，仅在用户明确要求时使用）。',
      codegenParams,
      [],
      async (a) => {
        const files = await generateFilesOf(deps, a)
        if (!files.length) throw new Error('未生成任何文件，请检查表与模板范围')
        const zip = await deps.getTemplate().buildZip(files)
        await deps.getApi().replace(zip)
        return {
          replaced: files.length,
          files: files.map((f) => ({
            templateName: f.templateName,
            tableName: f.tableName,
            fileName: f.fileName,
            filePath: f.filePath,
            size: f.content.length,
          })),
        }
      },
    ),
  )
  return tools
}

/* ==================== 仓库 ==================== */

export function createAiStore(deps: AiDeps) {
  /** 在途加载 Promise：并发调用方共享同一次加载；失败可重试 */
  let initInFlight: Promise<void> | null = null
  return reactive({
    loaded: false,
    loading: false,
    /** AI 设置（已保存态；编辑草稿由设置页 AI 区块本地管理） */
    aiSettings: { baseUrl: '', apiKey: '', models: [], globalRules: '' } as AiSettings,
    /** 当前选中模型 id（缺省取模型列表第一个） */
    selectedModelId: '',

    /* ---------- 会话状态 ---------- */
    messages: [] as AiChatMessage[],
    toolRecords: [] as AiToolRecord[],
    running: false,
    abortController: null as AbortController | null,

    /** 模型下拉选项 */
    get modelOptions(): Array<{ value: string; label: string }> {
      return this.aiSettings.models.map((m) => ({ value: m.id, label: m.name || m.id }))
    },
    /** 当前生效模型配置 */
    get currentModel(): AiModelConfig | undefined {
      return (
        this.aiSettings.models.find((m) => m.id === this.selectedModelId) ||
        this.aiSettings.models[0]
      )
    },

    /* ---------- 设置读写 ---------- */

    async init(): Promise<void> {
      if (this.loaded) return
      if (!initInFlight) {
        this.loading = true
        initInFlight = (async () => {
          try {
            const s = await deps.getApi().getAiSettings()
            this.aiSettings = {
              baseUrl: String(s.baseUrl ?? ''),
              apiKey: String(s.apiKey ?? ''),
              models: Array.isArray(s.models) ? s.models.map(clone) : [],
              globalRules: String(s.globalRules ?? ''),
            }
            if (!this.aiSettings.models.some((m) => m.id === this.selectedModelId)) {
              this.selectedModelId = this.aiSettings.models[0]?.id ?? ''
            }
            this.loaded = true
          } catch (e) {
            message.error(errorMessageOf(e, 'AI 设置加载失败'))
          } finally {
            this.loading = false
            initInFlight = null
          }
        })()
      }
      await initInFlight
    },

    /** 保存 AI 设置（api 校验通过后更新本地已保存态） */
    async saveSettings(settings: AiSettings) {
      const saved: AiSettings = {
        baseUrl: String(settings.baseUrl ?? '').trim(),
        apiKey: String(settings.apiKey ?? ''),
        models: (settings.models || []).map(clone),
        globalRules: String(settings.globalRules ?? ''),
      }
      await deps.getApi().saveAiSettings(saved)
      this.aiSettings = saved
      if (!this.aiSettings.models.some((m) => m.id === this.selectedModelId)) {
        this.selectedModelId = this.aiSettings.models[0]?.id ?? ''
      }
      this.loaded = true
    },

    /* ---------- 会话操作 ---------- */

    /** 中止当前生成（流式请求 abort，消息标记为已中止） */
    stop() {
      this.abortController?.abort()
    },

    /** 开启新会话（清空消息与调用记录；不影响模型选择） */
    clearSession() {
      if (this.running) this.stop()
      this.messages = []
      this.toolRecords = []
    },

    /** api 切换时重置会话与加载态（由 DBManagerView 调用） */
    resetForApiSwitch() {
      if (this.running) this.stop()
      this.messages = []
      this.toolRecords = []
      this.loaded = false
      this.loading = false
    },

    /**
     * 发送用户消息并运行 AGENT 循环：
     * 流式输出（思考 / 正文）→ 工具调用 → 结果回填 → 继续生成，直至最终回答。
     * 全局规则非空时附加在系统提示中；工具改动过的域在结束时同步刷新仓库。
     */
    async send(text: string) {
      const content = String(text ?? '').trim()
      if (!content || this.running) return
      await this.init()
      if (!this.aiSettings.baseUrl || !this.aiSettings.models.length) {
        this.messages.push({
          id: uid('ai-'),
          role: 'assistant',
          content:
            '尚未配置 AI 服务：请先在「系统设置 → AI」中填写 openai compatible 服务地址（以 /v1 结尾）并添加模型，保存后再来对话。',
          status: 'error',
          createdAt: Date.now(),
        })
        return
      }
      const model = this.currentModel!
      const tools = buildAgentTools(deps)
      const dirtyDomains = new Set<string>()

      this.messages.push({
        id: uid('ai-'),
        role: 'user',
        content,
        status: 'done',
        createdAt: Date.now(),
      })
      this.running = true
      const controller = new AbortController()
      this.abortController = controller

      // 重建 openai 形态消息序列：系统提示 + 本会话历史（跳过失败/中止消息）
      const chatMsgs: ChatMessage[] = [
        { role: 'system', content: buildSystemPrompt(this.aiSettings.globalRules || '') },
      ]
      for (const m of this.messages) {
        if (m.role === 'user') {
          chatMsgs.push({ role: 'user', content: m.content })
        } else if (
          m.role === 'assistant' &&
          m.status === 'done' &&
          (m.content || m.toolCalls?.length)
        ) {
          chatMsgs.push({
            role: 'assistant',
            content: m.content || null,
            ...(m.toolCalls?.length
              ? {
                  toolCalls: m.toolCalls.map((t) => ({
                    id: t.id,
                    type: 'function' as const,
                    function: { name: t.name, arguments: t.args || '{}' },
                  })),
                }
              : {}),
          })
          for (const tc of m.toolCalls || []) {
            const rec = this.toolRecords.find((r) => r.callId === tc.id)
            chatMsgs.push({
              role: 'tool',
              toolCallId: tc.id,
              content: rec
                ? rec.status === 'error'
                  ? `工具执行失败：${rec.resultText}`
                  : capForModel(rec.resultText)
                : '（无执行记录）',
            })
          }
        }
      }

      try {
        let reachedFinal = false
        for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
          // reactive 包裹：流式增量经代理变更触发视图更新（原始对象直改不触发）
          const asst: AiChatMessage = reactive({
            id: uid('ai-'),
            role: 'assistant',
            content: '',
            reasoning: '',
            reasoningOpen: false,
            status: 'streaming',
            createdAt: Date.now(),
          })
          this.messages.push(asst)
          const result = await deps.getApi().chatComplete(
            {
              model: model.id,
              messages: chatMsgs,
              tools: tools.map((t) => t.spec),
              reasoningEffort: model.supportsThinking ? model.thinkingIntensity : undefined,
              signal: controller.signal,
            },
            (delta) => {
              if (delta.content) asst.content += delta.content
              if (delta.reasoning) {
                asst.reasoning = (asst.reasoning || '') + delta.reasoning
                asst.reasoningOpen = true // 思考输出中自动展开
              }
            },
          )
          if (result.content) asst.content = result.content
          if (result.reasoning) asst.reasoning = result.reasoning
          asst.status = 'done'
          asst.reasoningOpen = false // 完成后自动收起（用户可手动再展开）

          if (!result.toolCalls.length) {
            reachedFinal = true
            break
          }
          // 工具调用：记录 → 执行 → 结果回填消息序列
          asst.toolCalls = result.toolCalls.map((c: ChatToolCall) => ({
            id: c.id,
            name: c.function.name,
            args: c.function.arguments || '{}',
          }))
          chatMsgs.push({
            role: 'assistant',
            content: result.content || null,
            toolCalls: result.toolCalls,
          })
          for (const call of result.toolCalls) {
            const record: AiToolRecord = reactive({
              id: uid('tool-'),
              callId: call.id,
              name: call.function.name,
              argsText: '',
              resultText: '',
              status: 'running',
              createdAt: Date.now(),
            })
            this.toolRecords.push(record)
            const started = Date.now()
            try {
              const tool = tools.find((t) => t.spec.function.name === call.function.name)
              if (!tool) throw new Error(`未知工具：${call.function.name}`)
              const args = safeParseJson(call.function.arguments)
              record.argsText = prettyJson(safeParseJson(call.function.arguments))
              const value = await tool.invoke(args)
              for (const d of tool.domains) dirtyDomains.add(d)
              record.status = 'success'
              record.resultText = prettyJson(value)
            } catch (e) {
              record.status = 'error'
              record.resultText = errorMessageOf(e, '工具执行失败')
              record.durationMs = Date.now() - started
              chatMsgs.push({
                role: 'tool',
                toolCallId: call.id,
                content: `工具执行失败：${record.resultText}`,
              })
              continue
            }
            record.durationMs = Date.now() - started
            chatMsgs.push({
              role: 'tool',
              toolCallId: call.id,
              content: capForModel(record.resultText),
            })
          }
        }
        if (!reachedFinal) {
          this.messages.push({
            id: uid('ai-'),
            role: 'assistant',
            content: `已连续执行 ${MAX_TOOL_ROUNDS} 轮工具调用仍未得到最终回答，为避免失控已中止；可继续追问让任务收尾。`,
            status: 'error',
            createdAt: Date.now(),
          })
        }
        // 工具改动过的域：同步刷新对应仓库（画布/字典/模板/设置页保持一致）
        await this.syncDirtyStores(dirtyDomains)
      } catch (e) {
        const aborted = controller.signal.aborted || (e as Error)?.name === 'AbortError'
        const last = [...this.messages].reverse().find((m) => m.role === 'assistant')
        if (last) {
          last.status = aborted ? 'aborted' : 'error'
          last.reasoningOpen = false
          if (!aborted) last.error = errorMessageOf(e, 'AI 调用失败')
        }
        if (aborted) {
          message.info('已停止生成')
        } else {
          message.error(errorMessageOf(e, 'AI 调用失败'))
        }
      } finally {
        this.running = false
        this.abortController = null
      }
    },

    /** 按域同步刷新被工具改动的仓库（失败静默，不阻断会话） */
    async syncDirtyStores(domains: Set<string>) {
      if (domains.has('model')) {
        try {
          await deps.getModel().refresh()
        } catch {
          /* 刷新失败不打断会话 */
        }
      }
      if (domains.has('dict')) {
        const dict = deps.getDict()
        try {
          dict.loaded = false
          dict.loading = false
          await dict.init()
        } catch {
          /* ignore */
        }
      }
      if (domains.has('template')) {
        const tpl = deps.getTemplate()
        try {
          tpl.loaded = false
          tpl.loading = false
          await tpl.init()
        } catch {
          /* ignore */
        }
      }
      if (domains.has('settings')) {
        const settings = deps.getSettings()
        try {
          settings.loaded = false
          settings.loading = false
          await settings.init()
        } catch {
          /* ignore */
        }
      }
    },
  })
}

export type AiStore = ReturnType<typeof createAiStore>

/** 子组件取用 AI 仓库（须处于 DBManagerView 组件树内） */
export function useAiStore(): AiStore {
  return useDBManagerContext().ai
}
