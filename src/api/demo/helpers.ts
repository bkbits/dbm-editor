/**
 * DemoManagerApi / DemoAIApi · 纯辅助函数集（归一 / 校验 / 日志包装，无契约方法）
 *
 * 从原 demo-manager-api.ts 单文件拆出。三类职责：
 * - 通用工具：深拷贝、必填字符串校验、正则合法性校验
 * - 归一函数：设置（选项定义 / 轮数上限）、表（字段 / 索引）、导航、
 *   字典（值 / 分类 / 字典）——写库前的数据层兜底（脏数据拦截与形态归一），
 *   校验失败抛 Error（中文业务提示，由 UI 层捕获展示）
 * - 调用日志包装（withCallLogging）：为实例全部方法以 Proxy 打印入参与
 *   返回结果（异步感知），供演示实现的调用可观测性
 */
import { Logger } from "@/log/Logger";
import type {
  Dict,
  DictCategory,
  DictValue,
  ManagerTable,
  OptionSetting,
  TableColumn,
  TableIndex,
  TableNavigate,
} from "@/types/model";
import { getDB } from "@/mock/db";
import { uid } from "@/utils/id";
import { normalizeNavigateProps } from "@/utils/navigate";

/** 深拷贝（JSON 序列化；演示数据均为纯数据形态） */
export function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

/** 必填字符串校验：去空白后为空即抛中文业务提示 */
export function requireStr(value: unknown, field: string, label: string): string {
  const s = String(value ?? "").trim();
  if (!s) throw new Error(`${label}不能为空（${field}）`);
  return s;
}

/** 校验正则合法性，非法时抛错 */
export function assertRegex(pattern: string): void {
  try {
    new RegExp(pattern, "i");
  } catch {
    throw new Error(`无效的正则表达式：${pattern}`);
  }
}

/** 选项定义归一：名称非空、列表内唯一、类型/标签兜底（label 缺省回退 name） */
export function normalizeOptionSettings(raw: unknown, listLabel?: string): OptionSetting[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: OptionSetting[] = [];
  for (const item of raw) {
    const o = item as Partial<OptionSetting>;
    const name = String(o?.name ?? "").trim();
    if (!name) {
      if (listLabel) throw new Error(`${listLabel}存在空名称`);
      continue;
    }
    if (seen.has(name)) {
      if (listLabel) throw new Error(`${listLabel}名称重复：${name}`);
      continue;
    }
    seen.add(name);
    out.push({
      name,
      type: String(o?.type ?? "boolean").trim() || "boolean",
      label: String(o?.label ?? "").trim() || name,
      remark: String(o?.remark ?? "").trim() || undefined,
      dict: String(o?.dict ?? "").trim() || undefined,
    });
  }
  return out;
}

/** 导航类型合法枚举 */
export const NAVIGATE_TYPES = ["11", "1N", "N1", "NN"];

/** 工具调用轮数上限缺省值（AI 设置缺省 / 非法值回退） */
export const DEFAULT_MAX_TOOL_ROUNDS = 50;

/** 归一工具调用轮数上限：整数 1-500，缺省 / 非法回退 50 */
export function normalizeMaxToolRounds(v: unknown): number {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n) || n < 1) return DEFAULT_MAX_TOOL_ROUNDS;
  return Math.min(500, n);
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
export function withCallLogging<T extends object>(instance: T, label: string): T {
  const wrappedCache = new Map<string, (...args: unknown[]) => unknown>();
  return new Proxy(instance, {
    /** Proxy get 拦截：方法访问经日志包装缓存返回 */
    get(target: T, prop: string | symbol): unknown {
      if (typeof prop !== "string" || prop === "constructor") {
        return Reflect.get(target, prop);
      }
      const value = Reflect.get(target, prop);
      if (typeof value !== "function") return value;
      let wrapped = wrappedCache.get(prop);
      if (!wrapped) {
        const original = value as (this: T, ...args: unknown[]) => unknown;
        wrapped = function (this: unknown, ...args: unknown[]): unknown {
          Logger.debug(`[${label}] ${prop}() 入参`, args);
          try {
            const result = original.apply(target, args);
            if (
              typeof result === "object" &&
              result !== null &&
              typeof (result as { then?: unknown }).then === "function"
            ) {
              return (result as Promise<unknown>).then(
                (resolved: unknown) => {
                  Logger.debug(`[${label}] ${prop}() 返回`, resolved);
                  return resolved;
                },
                (e: unknown) => {
                  Logger.error(`[${label}] ${prop}() 抛错`, e);
                  throw e;
                },
              );
            }
            Logger.debug(`[${label}] ${prop}() 返回`, result);
            return result;
          } catch (e) {
            Logger.error(`[${label}] ${prop}() 抛错`, e);
            throw e;
          }
        };
        wrappedCache.set(prop, wrapped);
      }
      return wrapped;
    },
  });
}

/* ==================== 表结构归一（写库前兜底） ==================== */

/**
 * 字段列表归一：字段名非空唯一、tableId 归一、sort 重排；
 * 逻辑删除字段每表至多一个（多标拒绝，UI 勾选互斥之外的数据层兜底）
 */
export function normalizeColumns(table: ManagerTable, tableName: string): TableColumn[] {
  const colNames = new Set<string>();
  let logicDeleteCount = 0;
  const columns = (table.columns || []).map((c, i) => {
    const colName = requireStr(c?.columnName, "columnName", "字段名");
    if (colNames.has(colName)) throw new Error(`表 ${tableName} 存在重复字段名：${colName}`);
    colNames.add(colName);
    if (c?.logicDelete === true) logicDeleteCount++;
    return {
      ...clone(c),
      id: c.id || uid("c-"),
      tableId: table.id,
      sort: Number(c.sort ?? i) || i,
      // 仅显式 true 落库（false/缺省归一为 undefined，减少数据噪音）
      logicDelete: c?.logicDelete === true ? true : undefined,
    };
  });
  if (logicDeleteCount > 1)
    throw new Error(
      `表 ${tableName} 的逻辑删除字段最多只能有一个（当前标记了 ${logicDeleteCount} 个）`,
    );
  return columns;
}

/** 索引列表归一：索引名非空唯一、索引字段存在 */
export function normalizeIndexes(
  table: ManagerTable,
  tableName: string,
  columns: Array<{ columnName: string }>,
): TableIndex[] {
  const colNames = new Set(columns.map((c) => c.columnName));
  const idxNames = new Set<string>();
  return (table.indexes || []).map((i) => {
    const idxName = requireStr(i?.indexName, "indexName", "索引名");
    if (idxNames.has(idxName)) throw new Error(`表 ${tableName} 存在重复索引名：${idxName}`);
    idxNames.add(idxName);
    const cols = (i.columns || []).map(String);
    for (const col of cols) {
      if (!colNames.has(col))
        throw new Error(`表 ${tableName} 的索引 ${idxName} 引用了不存在的字段：${col}`);
    }
    return { ...clone(i), id: i.id || uid("i-"), tableId: table.id, columns: cols };
  });
}

/** 导航关系归一：四列名数组 / 级联枚举兜底，两端表存在、类型枚举合法、属性名非空 */
export function normalizeNavigate(input: TableNavigate): TableNavigate {
  const db = getDB();
  const nav = normalizeNavigateProps(clone(input));
  if (!nav.id) throw new Error("新增导航必须提供 id");
  requireStr(nav.selfPropertyName, "selfPropertyName", "self 属性名");
  requireStr(nav.targetPropertyName, "targetPropertyName", "target 属性名");
  if (!db.tables.some((t) => t.id === nav.self)) throw new Error(`导航 ${nav.id} 的 self 表不存在`);
  if (!db.tables.some((t) => t.id === nav.target))
    throw new Error(`导航 ${nav.id} 的 target 表不存在`);
  if (nav.mappingTable && !db.tables.some((t) => t.id === nav.mappingTable)) {
    throw new Error(`导航 ${nav.id} 的中间映射表不存在`);
  }
  if (!NAVIGATE_TYPES.includes(nav.type)) throw new Error(`导航 ${nav.id} 的类型无效: ${nav.type}`);
  return nav;
}

/* ==================== 字典归一（写库前兜底） ==================== */

/** 字典值归一：空值键拦截、标签回退、类型/颜色兜底；常量属性名统一转大写 */
export function normalizeDictValue(v: Partial<DictValue>, dictKey: string): DictValue {
  const valueKey = String(v?.valueKey ?? "").trim();
  if (!valueKey) throw new Error(`字典 ${dictKey} 存在空值键`);
  const labelType = ["I", "S", "W", "D"].includes(v?.labelType as string)
    ? (v?.labelType as DictValue["labelType"])
    : "I";
  return {
    id: v?.id || uid("dv-"),
    dictId: String(v?.dictId || ""),
    valueKey,
    // 常量属性名仅允许全大写：小写输入自动转大写（数据层兜底，UI 层同步转换）
    propertyName: String(v?.propertyName ?? "")
      .trim()
      .toUpperCase(),
    label: String(v?.label ?? "").trim() || valueKey,
    labelType,
    comment: String(v?.comment || ""),
    color: String(v?.color || "").trim() || undefined,
  };
}

/**
 * 字典分类属性归一：basePackage 基础包路径（仅去空白与首尾点、压缩连续点）+
 * className 类名（非空时必须为大驼峰结构——首字母大写且仅字母数字，如 SysDictConstants）
 */
export function normalizeDictCategory(category: DictCategory): {
  basePackage: string;
  className: string;
} {
  const basePackage = String(category?.basePackage || "")
    .trim()
    .replace(/\.{2,}/g, ".")
    .replace(/^\.+|\.+$/g, "");
  const className = String(category?.className || "").trim();
  if (className && !/^[A-Z][A-Za-z0-9]*$/.test(className))
    throw new Error(`类名称必须为大驼峰结构（如 SysDictConstants）: ${className}`);
  return { basePackage, className };
}

/** 字典归一：标签必填，值列表逐项归一 */
export function normalizeDict(dict: Partial<Dict>, dictKey: string): Dict {
  const label = requireStr(dict?.label, "label", "字典标签");
  return {
    id: String(dict?.id || ""),
    categoryId: String(dict?.categoryId || "").trim(),
    dictKey,
    label,
    comment: String(dict?.comment || ""),
    values: (dict?.values || []).map((v) => normalizeDictValue(v, dictKey)),
  };
}
