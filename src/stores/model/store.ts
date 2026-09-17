/**
 * 模型仓库：状态字段、派生 getter 与各域方法组装
 * （reactive 对象工厂形态，由 DBManagerView 经上下文注入，不依赖 Pinia。
 *   本地状态为 UI 单一数据源；所有变更遵循 ManagerApi 细粒度异步契约：
 *   先改本地 → await 对应 api 方法 → 失败回滚快照并抛错（事务模式）；
 *   拖动 / 对齐等纯位置变更走 updateTablePos 批量契约一次提交；
 *   各域动作见 loader / vo / categories / tables / navigates / clipboard / import / snapshot，
 *   组装结果经 `satisfies ModelStore` 校验成员完整性）
 */
import { reactive } from "vue";
import { useDBManagerContext } from "../context";
import type { Table, TableCategory, TableColumn, TableIndex, TableNavigate } from "@/types/model";
import { categoryMethods } from "./categories";
import { clipboardMethods } from "./clipboard";
import { importMethods } from "./import";
import { loaderMethods } from "./loader";
import { navigateMethods } from "./navigates";
import { snapshotMethods } from "./snapshot";
import { tableMethods } from "./tables";
import { voMethods } from "./vo";
import type { ModelDeps, ModelStore } from "./types";

/**
 * 创建模型仓库：组装状态字段（reactive 响应式根）+ 派生 getter + 各域 part 方法，
 * 返回值经 `satisfies ModelStore` 校验成员完整性；getter 每次访问即时计算，不做缓存。
 */
export function createModelStore(deps: ModelDeps): ModelStore {
  return reactive({
    loaded: false,
    loading: false,
    error: "",
    categories: [] as TableCategory[],
    tables: [] as Table[],
    columns: [] as TableColumn[],
    indexes: [] as TableIndex[],
    navigates: [] as TableNavigate[],

    /** 表总数（由本地 tables 派生） */
    get tableCount(): number {
      return this.tables.length;
    },
    /** 导航总数（由本地 navigates 派生） */
    get navigateCount(): number {
      return this.navigates.length;
    },
    /** 分类总数（由本地 categories 派生） */
    get categoryCount(): number {
      return this.categories.length;
    },
    /** 现有表名集合（每次访问重建，供重名校验与自动命名使用） */
    get tableNames(): Set<string> {
      return new Set(this.tables.map((t) => t.tableName));
    },
    /** 现有分类名集合（每次访问重建，供分类重名校验使用） */
    get categoryNames(): Set<string> {
      return new Set(this.categories.map((c) => c.name));
    },
    /** 按 id 取表（返回本地对象引用，未命中为 undefined） */
    get tableById(): (id: string) => Table | undefined {
      return (id) => this.tables.find((t) => t.id === id);
    },
    /** 按 id 取分类（返回本地对象引用，未命中为 undefined） */
    get categoryById(): (id: string) => TableCategory | undefined {
      return (id) => this.categories.find((c) => c.id === id);
    },
    /** 取某分类下的全部表（新数组，元素仍为本地引用） */
    get tablesByCategory(): (categoryId: string) => Table[] {
      return (categoryId) => this.tables.filter((t) => t.categoryId === categoryId);
    },
    /** 该表参与的全部原始导航 */
    get navigatesOf(): (tableId: string) => TableNavigate[] {
      return (tableId) => this.navigates.filter((n) => n.self === tableId || n.target === tableId);
    },
    /** 是否为中间映射表 */
    get isMappingTable(): (tableId: string) => boolean {
      return (tableId) => this.navigates.some((n) => n.mappingTable === tableId);
    },
    /** a / b 之间是否已有导航（双向匹配；excludeId 用于排除正在编辑的导航自身） */
    get hasNavigateBetween(): (a: string, b: string, excludeId?: string) => boolean {
      return (a, b, excludeId) =>
        this.navigates.some((n) => {
          if (excludeId && n.id === excludeId) return false;
          return (n.self === a && n.target === b) || (n.self === b && n.target === a);
        });
    },
    ...loaderMethods(deps),
    ...voMethods(),
    ...categoryMethods(deps),
    ...tableMethods(deps),
    ...navigateMethods(deps),
    ...clipboardMethods(deps),
    ...importMethods(deps),
    ...snapshotMethods(deps),
  }) satisfies ModelStore;
}

/** 子组件取用模型仓库（须处于 DBManagerView 组件树内） */
export function useModelStore(): ModelStore {
  return useDBManagerContext().model;
}
