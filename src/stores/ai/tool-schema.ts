/**
 * AI 仓库：AGENT 工具参数 JSON Schema
 * （紧凑书写 function calling 参数契约：基础构建器 obj / str / strArr / int / bool
 *   + 各领域对象 schema + 工具表项辅助 plainTool）
 */
import type { AgentTool, ToolInvokeCtx } from "./types";

/* ---------- JSON Schema 构建辅助（紧凑书写契约参数） ---------- */

/** 对象 schema：desc 描述 + properties 属性表 + required 必填名单（缺省空数组，即全部选填） */
function obj(
  desc: string,
  properties: Record<string, unknown>,
  required: string[] = [],
): Record<string, unknown> {
  return { type: "object", description: desc, properties, required };
}
/** 字符串 schema：{ type: "string", description } */
const str = (desc: string) => ({ type: "string", description: desc });
/** 字符串数组 schema：{ type: "array", items: { type: "string" }, description } */
const strArr = (desc: string) => ({ type: "array", items: { type: "string" }, description: desc });
/** 整数 schema：{ type: "integer", description } */
const int = (desc: string) => ({ type: "integer", description: desc });
/** 布尔 schema：{ type: "boolean", description } */
const bool = (desc: string) => ({ type: "boolean", description: desc });

const NAV_TYPE = "'11'(一对一) | '1N'(一对多) | 'N1'(多对一) | 'NN'(多对多)";
const CASCADE = "'AUTO' | 'NO_ACTION' | 'SET_NULL' | 'DELETE'";

const columnSchema = obj("表字段", {
  id: str("字段ID（新增自行生成，前缀 c-）"),
  tableId: str("所属表ID"),
  columnName: str("字段名（蛇形，如 user_name）"),
  propertyName: str("Java属性名（小驼峰，缺省由字段名推导）"),
  sort: int("排序序号"),
  type: str("数据库类型（如 BIGINT / VARCHAR(255) / DATETIME）"),
  javaType: str("Java类型映射（如 Long / String / LocalDateTime）"),
  comment: str("注释"),
  notNull: bool("是否非空"),
  primaryKey: bool("是否主键"),
  logicDelete: bool("是否逻辑删除字段（每表最多一个，依设置的逻辑删除字段约定）"),
  dict: str("关联字典键（无关联为空串）"),
});

const indexSchema = obj("表索引", {
  id: str("索引ID（新增自行生成，前缀 i-）"),
  tableId: str("所属表ID"),
  indexName: str("索引名称（唯一）"),
  type: str("索引类型（可选列表见应用设置 indexTypes，如 UNIQUE / NORMAL）"),
  columns: strArr("索引字段名列表"),
  comment: str("索引注释"),
});

const tableSchema = obj("完整表定义（元信息 + 字段 + 索引）", {
  id: str("表ID（新增自行生成，前缀 t-；更新时填现有 id）"),
  categoryId: str("所属分类ID（先 getTableCategories 查询真实值）"),
  tableName: str("表名（蛇形，唯一）"),
  className: str("实体类名（大驼峰，缺省由表名推导）"),
  comment: str("表注释"),
  parentIdColumn: str("树形表父id列名（非树形表为空）"),
  hidden: bool("是否隐藏"),
  x: int("画布x坐标"),
  y: int("画布y坐标"),
  templates: str("启用的模板名称列表（逗号分割；空 = 启用全部模板）"),
  columns: { type: "array", description: "字段列表", items: columnSchema },
  indexes: { type: "array", description: "索引列表", items: indexSchema },
});

const navigateSchema = obj(
  "导航关系（self 与 target 可反转调换，但类型需同步调换；列名数组无值时传空数组，不要省略字段）",
  {
    id: str("导航ID（新增自行生成，前缀 nav-）"),
    type: str(`导航类型：${NAV_TYPE}`),
    comment: str("导航注释"),
    selfPropertyName: str("self 侧属性名（小驼峰）"),
    targetPropertyName: str("target 侧属性名（小驼峰）"),
    self: str("self 表ID"),
    selfProperty: strArr("self 表关联属性（列名）"),
    selfMappingProperty: strArr("self 表映射属性（列名；非多对多传空数组）"),
    mappingTable: str("中间映射表ID（仅多对多 NN，其余空串）"),
    target: str("target 表ID"),
    targetProperty: strArr("target 表关联属性（列名）"),
    targetMappingProperty: strArr("target 表映射属性（列名；非多对多传空数组）"),
    selfToTargetCascade: str(`self 到 target 级联：${CASCADE}`),
    targetToSelfCascade: str(`target 到 self 级联：${CASCADE}`),
  },
  [
    "id",
    "type",
    "self",
    "target",
    "selfPropertyName",
    "targetPropertyName",
    "selfProperty",
    "targetProperty",
    "selfMappingProperty",
    "targetMappingProperty",
  ],
);

const dictValueSchema = obj("字典值", {
  id: str("值ID（新增自行生成，前缀 dv-）"),
  dictId: str("所属字典ID"),
  valueKey: str("值键（唯一）"),
  propertyName: str("常量属性名（全大写，如 ENABLED）"),
  label: str("值标签"),
  labelType: str("值类型：'I'(Info) | 'S'(Success) | 'W'(Warning) | 'D'(Danger)"),
  comment: str("值注释"),
  color: str("自定义颜色"),
});

const dictSchema = obj("字典", {
  id: str("字典ID（新增自行生成，前缀 dict-；更新时填现有 id）"),
  categoryId: str("所属字典分类ID（空 = 未分类）"),
  dictKey: str("字典键（唯一）"),
  label: str("字典标签"),
  comment: str("字典注释"),
  values: { type: "array", description: "字典值列表", items: dictValueSchema },
});

const templateSchema = obj("代码模板（Eta 语法）", {
  id: str("模板ID（新增自行生成，前缀 tpl-；字典模板 id 固定为 tpl-dict-category）"),
  templateName: str("模板名称（唯一）"),
  content: str("模板脚本内容（Eta 语法）"),
});

const categorySchema = obj("表分类", {
  id: str("分类ID（新增自行生成，前缀 cat-；更新时填现有 id）"),
  name: str("分类名称（唯一）"),
  basePackage: str("基础包路径（如 com.example.sys）"),
  src: str("源码路径（用于替换）"),
});

const dictCategorySchema = obj("字典分类", {
  id: str("分类ID（新增自行生成，前缀 dictcat-）"),
  name: str("分类名称（唯一）"),
  basePackage: str("基础包路径（如 com.example.constants.dict）"),
  className: str("类名称（大驼峰，如 SysDictConstants）"),
});

const typeMappingSchema = obj("列类型映射规则", {
  sort: int("排序序号（升序，越小越优先）"),
  pattern: str("列类型正则表达式（忽略大小写）"),
  javaType: str("目标 Java 类型"),
});

const optionSettingSchema = obj("选项元定义", {
  name: str("选项名称（合法标识符）"),
  type: str("选项类型：'boolean' | 'string' | 'int' | 'long' | 'double' 或自定义"),
  label: str("选项标签"),
  remark: str("选项说明"),
  dict: str("关联字典键"),
});

const settingsSchema = obj("应用设置（保存为整体替换语义）", {
  indexTypes: strArr("索引类型列表（大写，至少一个）"),
  typeMappings: { type: "array", description: "列类型映射规则", items: typeMappingSchema },
  author: str("代码作者（javadoc @author，空则省略）"),
  tableOptions: { type: "array", description: "表选项元定义", items: optionSettingSchema },
  columnOptions: { type: "array", description: "列选项元定义", items: optionSettingSchema },
});

const aiModelSchema = obj("AI 模型配置", {
  id: str("模型 id（请求的 model 参数）"),
  name: str("展示名称（空时回退显示模型 id）"),
  supportsThinking: bool("是否支持思考（思考内容流式回传）"),
  thinkingIntensity: str("思考强度：'low' | 'medium' | 'high' | 'xhigh' | 'max'（支持思考时有效）"),
  inputContextLength: int("输入上下文长度（token）"),
  outputContextLength: int("输出上下文长度（token）"),
});

const providerSchema = obj("AI 供应商配置（一组连接信息 + 其下模型列表）", {
  id: str("供应商ID（新增自行生成，前缀 prv-；currentModel 按它引用）"),
  name: str("供应商名称（AI 工具页模型显示为「供应商名/模型名」）"),
  protocol: str(
    "对话协议：'openai-chat'(OpenAI Chat Completions) | 'openai-responses'(OpenAI Responses) | 'anthropic'(Anthropic Messages)",
  ),
  baseUrl: str("服务地址（openai 系以 /v1 结尾；anthropic 兼容带或不带 /v1）"),
  apiKey: str("API Key（Bearer / x-api-key 鉴权；本地服务可留空）"),
  models: { type: "array", description: "该供应商下的模型列表", items: aiModelSchema },
});

const aiSettingsSchema = obj(
  "AI 设置（保存为整体替换语义；入参须为 getAISettings 结果修改后的完整快照）",
  {
    providers: { type: "array", description: "供应商列表", items: providerSchema },
    currentModel: obj("默认模型（供应商 id + 模型 id 二元组）", {
      providerId: str("供应商ID"),
      modelId: str("模型 id"),
    }),
    globalRules: str("全局规则（多行文本，附加在系统提示中，优先级最高）"),
    maxToolRounds: int("单次任务工具调用轮数上限（1-500，默认 50）"),
  },
  ["providers"],
);

/* ---------- 工具表项辅助 ---------- */

/** 显式参数方法：声明参数 schema 与执行映射 */
function plainTool(
  name: string,
  desc: string,
  parameters: Record<string, unknown>,
  invoke: (args: Record<string, unknown>, ctx: ToolInvokeCtx) => Promise<unknown>,
  kind?: "skill",
): AgentTool {
  return {
    spec: { type: "function", function: { name, description: desc, parameters } },
    ...(kind ? { kind } : {}),
    invoke,
  };
}

const NO_ARGS = obj("无参数", {});

/* ---------- 供 tools.ts 组装工具表 ---------- */

/** 集中导出：内联 export 会加长这些紧凑书写行，触发格式化重排，故统一在此导出 */
export {
  NO_ARGS,
  aiSettingsSchema,
  bool,
  categorySchema,
  dictCategorySchema,
  dictSchema,
  int,
  navigateSchema,
  obj,
  plainTool,
  settingsSchema,
  str,
  strArr,
  tableSchema,
  templateSchema,
};
