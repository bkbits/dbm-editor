/**
 * 数据模型类型定义（非 AI 部分） —— 与《图形数据库模型编辑工具需求规格说明书》保持一致
 *
 * 表分类 / 表 / 字段 / 索引 / 导航、字典、模板、整体设置、主键与审计字段约定、
 * 代码生成与数据库导入等实体与 DTO 类型；ManagerApi 契约见 ./manager.ts，
 * AI（openai compatible）相关类型见 ./ai.ts。
 */

/** 导航类型 */
export type NavigateType = "11" | "1N" | "N1" | "NN";

/** 级联操作 */
export type NavigateCascade = "AUTO" | "NO_ACTION" | "SET_NULL" | "DELETE";

/** 表分类 */
export interface TableCategory {
  id: string; // 分类ID
  name: string; // 分类名称(唯一)
  src?: string; // 源码路径(用于替换)
  basePackage: string; // 基础包路径
}

/** 表信息 */
export interface Table {
  id: string; // 表ID
  categoryId: string; // 分类ID
  tableName: string; // 表名(唯一)
  className?: string; // 实体类名(默认为表名大驼峰命名)
  comment?: string; // 表注释
  parentIdColumn?: string; // 树形表父id列（如 parent_id），为空则代表非树形表
  hidden?: boolean; // 是否隐藏
  x?: number; // x坐标
  y?: number; // y坐标
  /** 启用的模板名称列表，使用 ',' 分割；不存在（空）表示启用当前所有模板 */
  templates?: string;
  /** 表选项值列表（键为选项名称，见 Settings.tableOptions 定义）；TableVO 经继承获得该属性 */
  options?: Record<string, TableOption>;
}

/** 表VO：完整表信息（含字段/索引/导航） */
export interface TableVO extends Table {
  columns: TableColumn[]; // 字段列表
  indexes: TableIndex[]; // 索引列表
  navigates: Navigate[]; // 导航关系列表(单向视图)
  /**
   * mock 扩展：以本表为 self 的原始导航(TableNavigate)列表。
   * 规范未定义全局导航查询接口，为保证原始导航关系可被还原，
   * mock 层在 TableVO 上附带该字段（对模板渲染无影响，可安全忽略）。
   */
  rawNavigates?: TableNavigate[];
}

/** 列信息 */
export interface TableColumn {
  id: string; // 列ID
  tableId: string; // 所属表ID
  columnName: string; // 字段名(唯一)
  propertyName?: string; // Java属性名（默认使用小驼峰）
  sort: number; // 排序
  type: string; // 数据库类型
  javaType?: string; // Java类型映射
  comment?: string; // 注释
  notNull: boolean; // 是否非空
  primaryKey: boolean; // 是否主键
  dict: string; // 关联字典键
  /** 是否逻辑删除字段（每表最多一个；软删除语义，如 deleted 0/1） */
  logicDelete?: boolean;
  /** 列选项值列表（键为选项名称，见 Settings.columnOptions 定义） */
  options?: Record<string, ColumnOption>;
}

/** 索引信息 */
export interface TableIndex {
  id: string; // 索引ID
  tableId: string; // 所属表ID
  indexName: string; // 索引名称(唯一)
  type: string; // 索引类型（可选列表由应用设置 indexTypes 管理）
  columns: string[]; // 字段名列表
  comment?: string; // 索引注释
}

/** 导航信息（该对象的self与target可以反转调换，但反转后type导航关系类型同时也需要调换） */
export interface TableNavigate {
  id: string; // 导航ID
  type: NavigateType; // '11' | '1N' | 'N1' | 'NN'
  comment?: string; // 导航注释

  selfPropertyName: string; // self的属性名
  targetPropertyName: string; // target的属性名

  self: string; // 本表
  selfProperty: string[]; // 本表关联属性
  selfMappingProperty: string[]; // 本表映射属性

  mappingTable: string; // 中间映射表（多对多时）

  target: string; // 目标表
  targetProperty: string[]; // 目标表关联属性
  targetMappingProperty: string[]; // 目标表映射属性

  selfToTargetCascade: NavigateCascade; // 级联操作
  targetToSelfCascade: NavigateCascade; // 级联操作
}

/** 单向导航信息，由 TableNavigate 生成（用于模板上下文） */
export interface Navigate {
  propertyName: string; // Java属性名(唯一)
  type: NavigateType; // 导航关系
  comment?: string; // 导航注释（由原始 TableNavigate.comment 带入）
  self: TableVO; // 本表
  selfProperty: string[]; // 本表关联属性
  selfMappingProperty: string[];
  mappingTable: TableVO; // 中间映射表（多对多时）
  target: TableVO; // 目标表
  targetProperty: string[]; // 目标表关联属性
  targetMappingProperty: string[]; // 目标表映射属性
  cascade: NavigateCascade; // 级联操作
}

/* ==================== 选项设置 ==================== */

/** 选项类型（常用类型为内置枚举，亦可为任意自定义类型字符串） */
export type OptionType = "boolean" | "string" | "int" | "long" | "double" | (string & {});

/** 选项设置（表选项/列选项的元定义，由应用设置统一管理） */
export interface OptionSetting {
  name: string; // 选项名称
  type: OptionType; // 选项类型，支持 boolean/string/int/long/double 及自定义
  label: string; // 选项标签
  remark?: string; // 选项说明
  dict?: string; // 字典
}

/** 表选项参数（挂在表上的选项值，键为选项名称） */
export interface TableOption {
  tableId: string; // 所属表id
  name: string; // 选项名称
  value?: boolean | string | number; // 选项值
}

/** 列选项参数（挂在列上的选项值，键为选项名称） */
export interface ColumnOption {
  columnId: string; // 所属列id
  name: string; // 选项名称
  value?: boolean | string | number; // 选项值
}

/** 表模板渲染上下文（每表渲染一次） */
export interface TableTemplateContext {
  templateName: string; // 模板名称
  templateContent: string; // 模板内容
  result?: string; // 生成结果
  basePackage: string; // 基础包名
  fileName: string; // 文件名
  filePath: string; // 文件路径
  /** 显式指定 highlight.js 高亮语言（如 java/sql/xml/javascript）；未设置时按文件名后缀自动识别 */
  language?: string;
  table: TableVO; // 当前表信息
  /** 应用设置（含作者 author 与表/列选项元定义，供模板生成 javadoc 与选项分支） */
  settings: Settings;
  /** 是否丢弃本次生成：默认 false；模板内置为 true 时，该产物不打包进 zip */
  aborted: boolean;
  /** 是否存在指定列（按数据库列名精确匹配） */
  hasColumn(columnName: string): boolean;
  /** 获取指定列（按数据库列名精确匹配），不存在时返回 undefined */
  getColumn(columnName: string): TableColumn | undefined;
}

/** 字典分类模板渲染上下文（每个字典分类渲染一次，生成分类下的全部字典代码） */
export interface DictCategoryTemplateContext {
  templateName: string; // 模板名称
  templateContent: string; // 模板内容
  result?: string; // 生成结果
  fileName: string; // 文件名
  filePath: string; // 文件路径
  /** 显式指定 highlight.js 高亮语言；未设置时按文件名后缀自动识别 */
  language?: string;
  category: DictCategory; // 字典分类信息
  dicts: Dict[]; // 所属分类下的全部字典（含字典值信息）
  /** 应用设置（与表模板一致，供模板生成 javadoc 等） */
  settings: Settings;
  /** 是否丢弃本次生成：默认 false；模板内置为 true 时，该产物不打包进 zip */
  aborted: boolean;
}

/** 表更新请求载荷（mock 扩展：rawNavigates 为该表参与的全部原始导航，替换语义） */
export interface TableUpdatePayload extends Omit<Table, "id"> {
  id: string;
  columns: TableColumn[];
  indexes: TableIndex[];
  rawNavigates: TableNavigate[];
}

/** 表新增请求载荷 */
export interface TableAddPayload extends Omit<Table, "id"> {
  columns: TableColumn[];
  indexes: TableIndex[];
  rawNavigates?: TableNavigate[];
}

/**
 * 批量更新表位置请求：拖动表卡片结束时使用。
 * 多张表卡片被选中并同时移动时，仅调用一次 api（tables 携带全部移动的表）。
 */
export interface UpdateTablePosDTO {
  tables: Array<{
    tableId: string;
    pos: {
      x: number;
      y: number;
    };
  }>;
}

/* ==================== 字典 ==================== */

/** 字典分类（与表分类同构的管理形态，用于字典的分组与字典代码生成） */
export interface DictCategory {
  id: string; // 分类ID
  name: string; // 分类名称(唯一)
  /** 基础包路径（如 com.example.constants.dict）：字典代码生成的包名与产物目录依据 */
  basePackage?: string;
  /** 类名称（大驼峰，如 SysDictConstants）：字典代码生成的常量类名 */
  className?: string;
}

/** 字典值标签类型：I=Info S=Success W=Warning D=Danger */
export type DictValueLabelType = "I" | "S" | "W" | "D";

/** 字典值 */
export interface DictValue {
  id: string; // 值ID
  dictId: string; // 所属字典ID
  valueKey: string; // 值键(唯一)
  /** 常量属性名（全大写，如 ENABLED）：字典代码生成时的常量名；输入小写自动转大写 */
  propertyName?: string;
  label: string; // 值标签
  labelType: DictValueLabelType; // 值类型
  comment?: string; // 值注释
  color?: string; // 自定义颜色(为空时回退使用值类型默认颜色)
}

/** 字典 */
export interface Dict {
  id: string; // 字典ID
  /** 所属字典分类ID（空 = 未分类；旧数据读取时按种子映射迁移补齐） */
  categoryId?: string;
  dictKey: string; // 字典键(唯一)
  label: string; // 字典标签
  comment?: string; // 字典注释
  values: DictValue[]; // 字典值列表
}

/* ==================== 模板 ==================== */

/** 代码模板（ManagerApi 契约形态：模板名称字段为 templateName） */
export interface Template {
  id: string; // 模板ID
  templateName: string; // 模板名称(唯一)
  content: string; // 模板脚本(Eta 语法)
}

/** 应用内部使用的模板形态（name 即 templateName） */
export interface CodeTemplate {
  id: string; // 模板ID
  name: string; // 模板名称(唯一)
  content: string; // 模板脚本(Eta 语法)
}

/** 代码生成产物文件 */
export interface GeneratedFile {
  templateName: string;
  tableName: string;
  fileName: string;
  filePath: string;
  content: string;
}

/* ==================== 设置（ManagerApi 契约形态） ==================== */

/**
 * 列类型映射规则：从数据库导入列时，按 sort 升序（越小越优先）依次
 * 对列类型进行正则表达式匹配（忽略大小写），取第一条命中的 javaType
 */
export interface TypeMapping {
  sort: number; // 排序序号(升序，越小越优先)
  pattern: string; // 列类型正则表达式
  javaType: string; // 目标 Java 类型
}

/* ==================== 主键与审计字段约定 ==================== */

/** 审计字段角色（固定四项：创建人/创建时间/更新人/更新时间） */
export type AuditFieldRole = "createBy" | "createTime" | "updateBy" | "updateTime";

/** 主键字段约定 */
export interface PrimaryKeyConvention {
  name: string; // 字段名（默认 id）
  type: string; // 数据库类型（默认 BIGINT）
}

/** 审计字段约定 */
export interface AuditFieldConvention {
  name: string; // 字段名（默认为角色名蛇形，如 create_by）
  type: string; // 数据库类型（创建人/更新人默认 BIGINT，创建时间/更新时间默认 DATETIME）
  /** Java 类型（空 = 按列类型映射规则自动推导；显式设定后建列固定使用该值） */
  javaType?: string;
}

/** 逻辑删除字段约定（软删除标记，如 deleted TINYINT 0/1；每表至多一个） */
export interface LogicDeleteConvention {
  name: string; // 字段名（默认 deleted）
  type: string; // 数据库类型（默认 TINYINT）
  /** Java 类型（空 = 按列类型映射规则自动推导；显式设定后建列固定使用该值） */
  javaType?: string;
}

/**
 * 主键与审计字段约定：表编辑对话框据此固定首字段与审计字段一键增删。
 * 主键每表强制拥有且固定为第一个字段（不可修改、不可排序）；
 * 创建人/创建时间强制非空，更新人/更新时间可空（非空约束为固定语义，随角色而定）；
 * 逻辑删除字段为软删除标记（每表至多一个，标记互斥）
 */
export interface FieldConventions {
  primaryKey: PrimaryKeyConvention;
  /** 审计字段（按角色标识，顺序见 utils/fieldConvention.ts 的 AUDIT_FIELD_ROLES） */
  auditFields: Record<AuditFieldRole, AuditFieldConvention>;
  /** 逻辑删除字段约定（旧数据缺省时按内置默认补齐，见 utils/fieldConvention.ts） */
  logicDelete: LogicDeleteConvention;
}

/** 应用设置 */
export interface Settings {
  indexTypes: string[]; // 索引类型列表
  typeMappings: TypeMapping[]; // 列类型映射规则列表
  /** 代码作者（生成 javadoc 的 @author；空则省略该标签） */
  author?: string;
  /** 表选项设置列表（表编辑对话框按此渲染表选项编辑项） */
  tableOptions: OptionSetting[];
  /** 列选项设置列表（表编辑对话框按此渲染列选项编辑项） */
  columnOptions: OptionSetting[];
  /** 主键与审计字段约定（可选：旧数据缺省时按内置默认补齐，见 utils/fieldConvention.ts） */
  fieldConventions?: FieldConventions;
}

/* ==================== 数据库导入（ManagerApi 契约形态） ==================== */

/** 数据库列定义：从真实数据库导入的表列信息 */
export interface DBColumn {
  columnName: string; // 列名
  type: string; // 数据库类型
  primaryKey: boolean; // 是否主键
  comment?: string; // 列注释
  /** demo 扩展：是否非空（真实实现可不提供，缺省视为可空） */
  notNull?: boolean;
}

/** 数据库索引定义：从真实数据库导入的表索引信息 */
export interface DBIndex {
  indexName: string; // 索引名称
  type: string; // 索引类型（UNIQUE/NORMAL/FULLTEXT 等）
  columns: string[]; // 索引包含的列名列表
  comment?: string; // 索引注释
}

/** 数据库表定义：从真实数据库导入的完整表结构 */
export interface DBTable {
  tableName: string; // 表名
  comment?: string; // 表注释
  columns: DBColumn[]; // 列列表
  indexes: DBIndex[]; // 索引列表
}

/** 模型加载结果：分类、表与导航关系的完整模型 */
export interface LoadResultVO {
  categories: TableCategory[]; // 表分类列表
  tables: ManagerTable[]; // 表列表（含字段与索引）
  navigates: TableNavigate[]; // 导航关系列表
}

/**
 * 完整表定义：规格中 Table 的完整语义（元信息 + 字段 + 索引），
 * 用于 ManagerApi.load / save 的全量模型读写
 */
export interface ManagerTable extends Table {
  columns: TableColumn[]; // 字段列表
  indexes: TableIndex[]; // 索引列表
}
