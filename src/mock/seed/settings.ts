/**
 * 种子数据 · 默认设置（表/列选项定义 + 字段约定 + 类型映射基线）
 *
 * 从原 mock/seed.ts 单文件按域拆出：新库种子与字段约定缺省基线。
 */
import type { OptionSetting, Settings } from "@/types/model";

/* ============ 设置 ============ */
/**
 * 默认表选项定义：表编辑对话框据此渲染表选项编辑项，模板按表选项分支生成代码。
 * 值缺省（未设置）时一律视为启用（true）。
 */
export const SEED_TABLE_OPTIONS: OptionSetting[] = [
  { name: "query", type: "boolean", label: "查询", remark: "是否启用查询" },
  { name: "add", type: "boolean", label: "添加", remark: "是否启用添加" },
  { name: "update", type: "boolean", label: "更新", remark: "是否启用更新" },
  { name: "remove", type: "boolean", label: "删除", remark: "是否启用删除" },
];

/**
 * 默认列选项定义：表编辑对话框据此渲染列选项编辑项（字段表格中的动态选项列）。
 * 值缺省（未设置）时一律视为启用（true）。
 */
export const SEED_COLUMN_OPTIONS: OptionSetting[] = [
  { name: "show", type: "boolean", label: "显示", remark: "是否启用列表中显示" },
  { name: "query", type: "boolean", label: "查询", remark: "是否作为查询条件" },
  { name: "add", type: "boolean", label: "添加", remark: "是否启用添加" },
  { name: "update", type: "boolean", label: "更新", remark: "是否启用更新" },
  { name: "remove", type: "boolean", label: "删除", remark: "是否启用删除" },
];

/**
 * 种子设置：索引类型列表 + 列类型映射规则（按 sort 升序，导入时依序正则匹配，取第一条命中）
 * + 代码生成配置（作者 javadoc @author / 表选项 / 列选项元定义）
 * + 主键与审计字段约定（表编辑固定首字段与审计字段一键增删）。
 * 注意顺序依赖：bigint 先于 int、datetime/timestamp 先于 time/date、
 * char(1) 先于 char，否则前缀类类型会被宽泛规则抢先命中
 */
export const SEED_SETTINGS: Settings = {
  indexTypes: ["UNIQUE", "NORMAL", "FULLTEXT"],
  typeMappings: [
    { sort: 0, pattern: "^\\s*char\\s*\\(\\s*1\\s*\\)", javaType: "Character" },
    { sort: 1, pattern: "char", javaType: "String" },
    { sort: 2, pattern: "text", javaType: "String" },
    { sort: 3, pattern: "json|enum|set", javaType: "String" },
    { sort: 4, pattern: "bigint", javaType: "Long" },
    { sort: 5, pattern: "int", javaType: "Integer" },
    { sort: 6, pattern: "decimal|numeric", javaType: "BigDecimal" },
    { sort: 7, pattern: "float", javaType: "Float" },
    { sort: 8, pattern: "double|real", javaType: "Double" },
    { sort: 9, pattern: "datetime", javaType: "LocalDateTime" },
    { sort: 10, pattern: "timestamp", javaType: "Timestamp" },
    { sort: 11, pattern: "^\\s*time", javaType: "LocalTime" },
    { sort: 12, pattern: "date", javaType: "LocalDate" },
    { sort: 13, pattern: "year", javaType: "Integer" },
  ],
  author: "dbm-editor",
  tableOptions: SEED_TABLE_OPTIONS.map((o) => ({ ...o })),
  columnOptions: SEED_COLUMN_OPTIONS.map((o) => ({ ...o })),
  /** 主键与审计字段约定（默认值，与 utils/fieldConvention.ts 的 DEFAULT_FIELD_CONVENTIONS 一致；审计字段蛇形命名，Java 属性名自动转小驼峰） */
  fieldConventions: {
    primaryKey: { name: "id", type: "BIGINT" },
    auditFields: {
      createBy: { name: "create_by", type: "BIGINT" },
      createTime: { name: "create_time", type: "DATETIME" },
      updateBy: { name: "update_by", type: "BIGINT" },
      updateTime: { name: "update_time", type: "DATETIME" },
    },
    logicDelete: { name: "deleted", type: "TINYINT" },
  },
};
