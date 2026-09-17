/**
 * 表编辑对话框 · 字段草稿纯逻辑（无组件依赖，供对话框与字段分区共享）
 *
 * 从原 TableEditDialog.vue 单文件拆出。承载三类纯函数：
 * - 草稿类型定义（DraftColumn / DraftIndex / TableEditDraft）
 * - 选项工具：options 记录 ⇄ UI 扁平值互转（表/列选项共用）
 * - 依「主键与审计字段约定」构造 / 归一化字段草稿（新建表、打开既有表、
 *   一键补齐审计与逻辑删除字段共用同一套工厂）
 *
 * 工厂函数经 deps 注入约定与列选项定义（而非直接读 store），保持纯函数
 * 语义便于复用与测试；调用方在调用时点取 store 快照传入。
 */
import type {
  AuditFieldRole,
  FieldConventions,
  OptionSetting,
  TableColumn,
  TableIndex,
} from "@/types/model";
import { AUDIT_FIELD_LABELS, AUDIT_FIELD_NOT_NULL } from "@/utils/fieldConvention";
import { toCamelCase } from "@/utils/string";
import { getJavaTypeByType } from "@/utils/javaType";
import { uid } from "@/utils/id";

/** 字段草稿：UI 编辑态扩展（属性/Java 类型手工改动标记 + 列选项扁平值） */
export type DraftColumn = TableColumn & {
  _propTouched?: boolean;
  _javaTouched?: boolean;
  /** 列选项扁平值（UI 编辑态；保存时转换为 TableColumn.options） */
  _optVals: Record<string, boolean | string>;
};

/** 索引草稿（与持久层结构一致，仅做防篡改拷贝） */
export type DraftIndex = TableIndex;

/** 表编辑草稿整体形态（对话框持有，各分区组件作为 prop 接收并就地编辑） */
export interface TableEditDraft {
  id: string;
  categoryId: string;
  tableName: string;
  className: string;
  comment: string;
  /** 树形表父ID字段，空代表非树形表 */
  parentIdColumn: string;
  x: number;
  y: number;
  columns: DraftColumn[];
  indexes: DraftIndex[];
  activeTab: string;
  /** 启用的模板（显式选择；空 = 启用全部，配合 templatesExplicit/templatesTouched 语义） */
  templates: string[];
  /** 表选项扁平值（UI 编辑态；boolean 定义存 boolean，其余存 string） */
  optionVals: Record<string, any>;
}

/* ==================== 选项工具（表/列选项扁平值 ⇄ options 记录） ==================== */

/** 已存 options 记录 → 扁平值（不含定义色限，按存值展开） */
export function flattenRawOptions(
  options?: Record<string, { value?: boolean | string | number }>,
): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [name, entry] of Object.entries(options || {})) {
    out[name] =
      entry?.value === undefined || entry?.value === null ? true : (entry.value as boolean);
  }
  return out;
}

/** 补齐缺失定义的默认值（不动已有值；boolean 默认 true，其余空串） */
export function fillOptionDefaults(
  vals: Record<string, boolean | string>,
  defs: OptionSetting[],
): void {
  for (const def of defs) {
    if (vals[def.name] === undefined) vals[def.name] = def.type === "boolean" ? true : "";
  }
}

/** 扁平值 → options 记录：boolean 仅存 false（true=默认缺省即启用），非 boolean 存非空值 */
export function buildOptionRecord<T extends { name: string; value?: boolean | string | number }>(
  vals: Record<string, boolean | string>,
  defs: OptionSetting[],
  makeEntry: (name: string, value: boolean | string | number) => T,
): Record<string, T> | undefined {
  const out: Record<string, T> = {};
  for (const def of defs) {
    const v = vals[def.name];
    if (def.type === "boolean") {
      if (v === false) out[def.name] = makeEntry(def.name, false);
    } else {
      const s = String(v ?? "").trim();
      if (s) {
        const numeric = def.type === "int" || def.type === "long" || def.type === "double";
        out[def.name] = makeEntry(def.name, numeric ? Number(s) : s);
      }
    }
  }
  return Object.keys(out).length ? out : undefined;
}

/* ==================== 字段工厂（依设置约定构造 / 归一化） ==================== */

/** 字段工厂依赖：字段约定 + 列选项定义 + Java 类型规则匹配器（先规则后内置） */
export interface ColumnFactoryDeps {
  /** 主键与审计字段约定（来自应用设置） */
  conventions: FieldConventions;
  /** 列选项定义（用于补齐新字段的选项默认值） */
  columnOptionDefs: OptionSetting[];
  /** 按列类型映射规则匹配 Java 类型（设置 store 的 matchJavaType） */
  matchJavaType: (dbType: string) => string | null | undefined;
}

/** 依约定构造主键字段草稿（每表首字段，强制非空） */
export function makePkColumn(deps: ColumnFactoryDeps): DraftColumn {
  const pk = deps.conventions.primaryKey;
  const col: DraftColumn = {
    id: uid("c-"),
    tableId: "",
    columnName: pk.name,
    propertyName: toCamelCase(pk.name, true),
    sort: 0,
    type: pk.type,
    javaType: getJavaTypeByType(pk.type),
    comment: "主键",
    notNull: true,
    primaryKey: true,
    dict: "",
    _optVals: {},
  };
  // 列选项默认值在创建时即补齐（设置未加载时为空列表，加载后 watch 兜底）
  fillOptionDefaults(col._optVals, deps.columnOptionDefs);
  return col;
}

/** 依约定构造审计字段草稿（非空约束随角色固定语义；Java 类型显式设定优先，空则按类型映射规则推导） */
export function makeAuditColumn(
  deps: ColumnFactoryDeps,
  role: AuditFieldRole,
  sort: number,
): DraftColumn {
  const conv = deps.conventions.auditFields[role];
  const col: DraftColumn = {
    id: uid("c-"),
    tableId: "",
    columnName: conv.name,
    propertyName: toCamelCase(conv.name, true),
    sort,
    type: conv.type,
    javaType: conv.javaType || (deps.matchJavaType(conv.type) ?? getJavaTypeByType(conv.type)),
    comment: AUDIT_FIELD_LABELS[role],
    notNull: AUDIT_FIELD_NOT_NULL[role],
    primaryKey: false,
    dict: "",
    _optVals: {},
  };
  fillOptionDefaults(col._optVals, deps.columnOptionDefs);
  return col;
}

/** 依约定构造逻辑删除字段草稿（软删除标记 0/1，强制非空） */
export function makeLogicDeleteColumn(deps: ColumnFactoryDeps, sort: number): DraftColumn {
  const conv = deps.conventions.logicDelete;
  const col: DraftColumn = {
    id: uid("c-"),
    tableId: "",
    columnName: conv.name,
    propertyName: toCamelCase(conv.name, true),
    sort,
    type: conv.type,
    javaType: conv.javaType || (deps.matchJavaType(conv.type) ?? getJavaTypeByType(conv.type)),
    comment: "逻辑删除标记（0=正常，1=已删除）",
    notNull: true,
    primaryKey: false,
    logicDelete: true,
    dict: "",
    _optVals: {},
  };
  fillOptionDefaults(col._optVals, deps.columnOptionDefs);
  return col;
}

/** 构造空白普通字段草稿（「添加字段」按钮；类型默认 VARCHAR(50)） */
export function newColumnDraft(columnOptionDefs: OptionSetting[]): DraftColumn {
  const col: DraftColumn = {
    id: uid("c-"),
    tableId: "",
    columnName: "",
    propertyName: "",
    sort: 0,
    type: "VARCHAR(50)",
    javaType: "String",
    comment: "",
    notNull: false,
    primaryKey: false,
    dict: "",
    _optVals: {},
  };
  // 新建字段即补齐列选项默认值（选项复选框缺省应显示为启用）
  fillOptionDefaults(col._optVals, columnOptionDefs);
  return col;
}

/**
 * 打开既有表时归一：主键字段强制存在且固定为首行——
 * 已有同名列则上移到首位并对齐约定属性（名称/类型/主键/非空），
 * 没有则依约定补建；其余列一律清除主键标记（单一主键语义，与模板渲染假定一致）
 */
export function normalizePkColumn(deps: ColumnFactoryDeps, cols: DraftColumn[]): DraftColumn[] {
  const pk = deps.conventions.primaryKey;
  const pkName = pk.name.trim();
  const out = [...cols];
  const idx = out.findIndex((c) => c.columnName.trim() === pkName);
  let pkCol: DraftColumn;
  if (idx >= 0) {
    [pkCol] = out.splice(idx, 1);
    pkCol.columnName = pkName;
    pkCol.type = pk.type;
    pkCol.javaType = getJavaTypeByType(pk.type);
    pkCol.notNull = true;
    pkCol.primaryKey = true;
    pkCol.propertyName = toCamelCase(pkName, true);
  } else {
    pkCol = makePkColumn(deps);
  }
  for (const c of out) c.primaryKey = false;
  const result = [pkCol, ...out];
  result.forEach((c, i) => (c.sort = i));
  return result;
}
