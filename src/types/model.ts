/**
 * 数据模型类型定义 —— 与《图形数据库模型编辑工具需求规格说明书》保持一致
 */

/** 导航类型 */
export type NavigateType = '11' | '1N' | 'N1' | 'NN'

/** 级联操作 */
export type NavigateCascade = 'AUTO' | 'NO_ACTION' | 'SET_NULL' | 'DELETE'

/** 表分类 */
export interface TableCategory {
  id: string // 分类ID
  name: string // 分类名称(唯一)
  src?: string // 源码路径(用于替换)
  basePackage: string // 基础包路径
}

/** 表信息 */
export interface Table {
  id: string // 表ID
  categoryId: string // 分类ID
  tableName: string // 表名(唯一)
  className?: string // 实体类名(默认为表名大驼峰命名)
  comment?: string // 表注释
  parentIdColumn?: string // 树形表父id列（如 parent_id），为空则代表非树形表
  hidden?: boolean // 是否隐藏
  x?: number // x坐标
  y?: number // y坐标
}

/** 表VO：完整表信息（含字段/索引/导航） */
export interface TableVO extends Table {
  columns: TableColumn[] // 字段列表
  indexes: TableIndex[] // 索引列表
  navigates: Navigate[] // 导航关系列表(单向视图)
  /**
   * mock 扩展：以本表为 self 的原始导航(TableNavigate)列表。
   * 规范未定义全局导航查询接口，为保证原始导航关系可被还原，
   * mock 层在 TableVO 上附带该字段（对模板渲染无影响，可安全忽略）。
   */
  rawNavigates?: TableNavigate[]
}

/** 列信息 */
export interface TableColumn {
  id: string // 列ID
  tableId: string // 所属表ID
  columnName: string // 字段名(唯一)
  propertyName?: string // Java属性名（默认使用小驼峰）
  sort: number // 排序
  type: string // 数据库类型
  javaType?: string // Java类型映射
  comment?: string // 注释
  notNull: boolean // 是否非空
  primaryKey: boolean // 是否主键
  dict: string // 关联字典键
}

/** 索引信息 */
export interface TableIndex {
  id: string // 索引ID
  tableId: string // 所属表ID
  indexName: string // 索引名称(唯一)
  type: string // 索引类型（可选列表由应用设置 indexTypes 管理）
  columns: string[] // 字段名列表
  comment?: string // 索引注释
}

/** 导航信息（该对象的self与target可以反转调换，但反转后type导航关系类型同时也需要调换） */
export interface TableNavigate {
  id: string // 导航ID
  type: NavigateType // '11' | '1N' | 'N1' | 'NN'
  comment?: string // 导航注释

  selfPropertyName: string // self的属性名
  targetPropertyName: string // target的属性名

  self: string // 本表
  selfProperty: string[] // 本表关联属性
  selfMappingProperty: string[] // 本表映射属性

  mappingTable: string // 中间映射表（多对多时）

  target: string // 目标表
  targetProperty: string[] // 目标表关联属性
  targetMappingProperty: string[] // 目标表映射属性

  selfToTargetCascade: NavigateCascade // 级联操作
  targetToSelfCascade: NavigateCascade // 级联操作
}

/** 单向导航信息，由 TableNavigate 生成（用于模板上下文） */
export interface Navigate {
  propertyName: string // Java属性名(唯一)
  type: NavigateType // 导航关系
  self: TableVO // 本表
  selfProperty: string[] // 本表关联属性
  selfMappingProperty: string[]
  mappingTable: TableVO // 中间映射表（多对多时）
  target: TableVO // 目标表
  targetProperty: string[] // 目标表关联属性
  targetMappingProperty: string[] // 目标表映射属性
  cascade: NavigateCascade // 级联操作
}

/** 模板渲染上下文 */
export interface TemplateContext {
  templateName: string // 模板名称
  templateContent: string // 模板内容
  result?: string // 生成结果
  basePackage: string // 基础包名
  fileName: string // 文件名
  filePath: string // 文件路径
  /** 显式指定 highlight.js 高亮语言（如 java/sql/xml/javascript）；未设置时按文件名后缀自动识别 */
  language?: string
  table: TableVO // 当前表信息
}

/** 表更新请求载荷（mock 扩展：rawNavigates 为该表参与的全部原始导航，替换语义） */
export interface TableUpdatePayload extends Omit<Table, 'id'> {
  id: string
  columns: TableColumn[]
  indexes: TableIndex[]
  rawNavigates: TableNavigate[]
}

/** 表新增请求载荷 */
export interface TableAddPayload extends Omit<Table, 'id'> {
  columns: TableColumn[]
  indexes: TableIndex[]
  rawNavigates?: TableNavigate[]
}

/* ==================== 字典 ==================== */

/** 字典值标签类型：I=Info S=Success W=Warning D=Danger */
export type DictValueLabelType = 'I' | 'S' | 'W' | 'D'

/** 字典值 */
export interface DictValue {
  id: string // 值ID
  dictId: string // 所属字典ID
  valueKey: string // 值键(唯一)
  label: string // 值标签
  labelType: DictValueLabelType // 值类型
  comment?: string // 值注释
  color?: string // 自定义颜色(为空时回退使用值类型默认颜色)
}

/** 字典 */
export interface Dict {
  id: string // 字典ID
  dictKey: string // 字典键(唯一)
  label: string // 字典标签
  comment?: string // 字典注释
  values: DictValue[] // 字典值列表
}

/* ==================== 模板 ==================== */

/** 代码模板（ManagerApi 契约形态：模板名称字段为 templateName） */
export interface Template {
  id: string // 模板ID
  templateName: string // 模板名称(唯一)
  content: string // 模板脚本(Eta 语法)
}

/** 应用内部使用的模板形态（name 即 templateName） */
export interface CodeTemplate {
  id: string // 模板ID
  name: string // 模板名称(唯一)
  content: string // 模板脚本(Eta 语法)
}

/** 代码生成产物文件 */
export interface GeneratedFile {
  templateName: string
  tableName: string
  fileName: string
  filePath: string
  content: string
}

/* ==================== 设置（ManagerApi 契约形态） ==================== */

/**
 * 列类型映射规则：从数据库导入列时，按 sort 升序（越小越优先）依次
 * 对列类型进行正则表达式匹配（忽略大小写），取第一条命中的 javaType
 */
export interface TypeMapping {
  sort: number // 排序序号(升序，越小越优先)
  pattern: string // 列类型正则表达式
  javaType: string // 目标 Java 类型
}

/** 应用设置 */
export interface Settings {
  indexTypes: string[] // 索引类型列表
  typeMappings: TypeMapping[] // 列类型映射规则列表
}

/* ==================== 数据库导入（ManagerApi 契约形态） ==================== */

/** 数据库列定义：从真实数据库导入的表列信息 */
export interface DBColumn {
  columnName: string // 列名
  type: string // 数据库类型
  primaryKey: boolean // 是否主键
  comment?: string // 列注释
  /** demo 扩展：是否非空（真实实现可不提供，缺省视为可空） */
  notNull?: boolean
}

/** 数据库索引定义：从真实数据库导入的表索引信息 */
export interface DBIndex {
  indexName: string // 索引名称
  type: string // 索引类型（UNIQUE/NORMAL/FULLTEXT 等）
  columns: string[] // 索引包含的列名列表
  comment?: string // 索引注释
}

/** 数据库表定义：从真实数据库导入的完整表结构 */
export interface DBTable {
  tableName: string // 表名
  comment?: string // 表注释
  columns: DBColumn[] // 列列表
  indexes: DBIndex[] // 索引列表
}

/** 模型加载结果：分类、表与导航关系的完整模型 */
export interface LoadResultVO {
  categories: TableCategory[] // 表分类列表
  tables: ManagerTable[] // 表列表（含字段与索引）
  navigates: TableNavigate[] // 导航关系列表
}

/**
 * 完整表定义：规格中 Table 的完整语义（元信息 + 字段 + 索引），
 * 用于 ManagerApi.load / save 的全量模型读写
 */
export interface ManagerTable extends Table {
  columns: TableColumn[] // 字段列表
  indexes: TableIndex[] // 索引列表
}

/** 本地管理能力接口：设置、数据库导入、模型全量加载/保存、字典与模板管理、代码替换 */
export interface ManagerApi {
  /** 获取应用设置 */
  getSettings(): Settings

  /** 保存应用设置 */
  saveSettings(settings: Settings): void

  /** 从真实数据库读取表结构（用于导入建模） */
  importFromDB(): DBTable[]

  /** 加载完整模型（分类/表/导航），初次进入加载以及点击刷新按钮时使用它 */
  load(): LoadResultVO

  /** 全量保存模型（分类/表/导航）,仅在 `点击保存所有` 时调用 */
  save(): void

  /* ---------- 分类 ---------- */

  /** 获取全部分类 */
  getCategories(): TableCategory[]

  /** 新增分类 */
  addCategory(category: TableCategory): void

  /** 更新分类 */
  updateCategory(category: TableCategory): void

  /** 删除分类 */
  removeCategory(categoryId: string): void

  /* ---------- 表 ---------- */

  /** 获取全部表（含字段与索引） */
  getTables(): ManagerTable[]

  /** 新增表（含字段与索引） */
  addTable(table: ManagerTable): void

  /** 更新表（含字段与索引） */
  updateTable(table: ManagerTable): void

  /** 删除表（一并删除其字段、索引与关联导航） */
  removeTable(tableId: string): void

  /** 更新表位置（拖动表卡片结束时使用它进行保存） */
  updateTablePos(tableId: string, pos: { x: number; y: number }): void

  /* ---------- 导航 ---------- */

  /** 获取全部导航关系 */
  getNavigates(): TableNavigate[]

  /** 新增导航关系 */
  addNavigate(navigate: TableNavigate): void

  /** 更新导航关系 */
  updateNavigate(navigate: TableNavigate): void

  /** 删除导航关系 */
  removeNavigate(navigateId: string): void

  /** 获取全部字典 */
  getDicts(): Dict[]

  /** 新增字典 */
  addDict(dict: Dict): void

  /** 更新字典 */
  updateDict(dict: Dict): void

  /** 删除字典 */
  removeDict(dictId: string): void

  /** 获取全部代码模板 */
  getTemplates(): Template[]

  /** 新增代码模板 */
  addTemplate(template: Template): void

  /** 更新代码模板 */
  updateTemplate(template: Template): void

  /** 删除代码模板 */
  removeTemplate(templateId: string): void

  /** 上传 zip 产物代码，直接替换对应源码文件 */
  replace(zipFile: Blob): void

  /**
   * demo 扩展：重置为内置演示数据（仅 DemoManagerApi 提供，
   * 正式实现无需实现该方法）
   */
  resetDemo?(): void
}
