/**
 * 模型仓库：字段 / 索引装配与 VO 投影
 * （本地扁平数组 ↔ 契约 ManagerTable / 渲染用 TableVO 的转换）
 */
import type { ManagerTable, Navigate, TableColumn, TableIndex, TableVO } from "@/types/model";
import { buildNavigateView } from "@/utils/navigate";
import { clone } from "./helpers";
import type { ModelStore } from "./types";

/**
 * VO 域 part 工厂：本地扁平数组（columns/indexes）与契约 ManagerTable / 渲染用 TableVO 的投影。
 * 返回对象的方法以 `this` 访问仓库状态，this 上下文由 `ThisType<ModelStore>` 提供。
 */
export function voMethods() {
  return {
    /** 整体替换某表字段：先剔除旧项；sort 缺省时按下标补全，保证列序稳定 */
    setColumnsOf(tableId: string, columns: TableColumn[]) {
      this.columns = this.columns.filter((c) => c.tableId !== tableId);
      columns.forEach((c, i) => {
        this.columns.push({ ...clone(c), tableId, sort: Number(c.sort ?? i) || i });
      });
    },

    /** 整体替换某表索引：先剔除旧项；columns 复制一份，不与入参共享数组 */
    setIndexesOf(tableId: string, indexes: TableIndex[]) {
      this.indexes = this.indexes.filter((i) => i.tableId !== tableId);
      indexes.forEach((i) =>
        this.indexes.push({ ...clone(i), tableId, columns: [...(i.columns || [])] }),
      );
    },

    /** 取某表字段（按 sort 升序，返回元素浅拷贝；不改动本地数组顺序） */
    columnsOf(tableId: string): TableColumn[] {
      return this.columns
        .filter((c) => c.tableId === tableId)
        .sort((a, b) => a.sort - b.sort)
        .map((c) => ({ ...c }));
    },

    /** 取某表索引（元素浅拷贝且 columns 复制，调用方改动不回写状态） */
    indexesOf(tableId: string): TableIndex[] {
      return this.indexes
        .filter((i) => i.tableId === tableId)
        .map((i) => ({ ...i, columns: [...i.columns] }));
    },

    /** 组装完整 ManagerTable（表元信息 + 字段 + 索引），用于 api 调用 */
    managerTableOf(tableId: string): ManagerTable {
      const t = this.tableById(tableId);
      if (!t) throw new Error(`表不存在: ${tableId}`);
      return { ...clone(t), columns: this.columnsOf(tableId), indexes: this.indexesOf(tableId) };
    },

    /** 轻量 TableVO（无导航视图、不改状态）；表不存在时返回 undefined，调用方须判空 */
    shallowVO(tableId: string): TableVO {
      const t = this.tableById(tableId);
      if (!t) return undefined as unknown as TableVO;
      return {
        ...t,
        columns: this.columnsOf(tableId),
        indexes: this.indexesOf(tableId),
        navigates: [],
      };
    },

    /** 构建完整 TableVO（含单向导航视图），用于模板渲染/预览 */
    getVO(tableId: string): TableVO | null {
      const base = this.shallowVO(tableId);
      if (!base) return null;
      const navigates = this.navigates
        .filter((n) => n.self === tableId || n.target === tableId)
        .map((n) => buildNavigateView(n, tableId, (id) => this.shallowVO(id)))
        .filter(Boolean) as Navigate[];
      const rawNavigates = this.navigates.filter((n) => n.self === tableId).map(clone);
      return { ...base, navigates, rawNavigates };
    },
  } satisfies ThisType<ModelStore> & Partial<ModelStore>;
}
