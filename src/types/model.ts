/**
 * 数据模型类型定义 —— 与《图形数据库模型编辑工具需求规格说明书》保持一致
 */

/** 导航类型 */
export type NavigateType = '11' | '1N' | 'N1' | 'NN'

/** 级联操作 */
export type NavigateCascade = 'AUTO' | 'NO_ACTION' | 'SET_NULL' | 'DELETE'

/** 索引类型 */
export type IndexType = 'UNIQUE' | 'NORMAL' | 'FULLTEXT'

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
  type: IndexType // 索引类型
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

/** 从真实数据库查询到的表结构（用于导入） */
export interface DBTableDef {
  tableName: string
  comment?: string
  columns: Array<{
    columnName: string
    type: string
    notNull: boolean
    primaryKey: boolean
    comment?: string
  }>
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

/** 代码模板 */
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

/** 代码替换接口响应 */
export interface ReplaceResult {
  success: boolean
  files: number
  message: string
}
