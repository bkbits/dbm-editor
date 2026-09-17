/**
 * 模型仓库：表复制 / 粘贴
 * （复制为不含 id 的载荷草稿，粘贴经契约新建并返回新表 id）
 */
import type { TableAddPayload } from "@/types/model";
import { uid } from "@/utils/id";
import { toCamelCase } from "@/utils/string";
import { getJavaTypeByType } from "@/utils/javaType";
import { clone } from "./helpers";
import type { ModelDeps, ModelStore } from "./types";

/**
 * 剪贴板域 part 工厂：把表结构复制为草稿载荷、按草稿在指定位置粘贴出新表。
 * 返回对象的方法以 `this` 访问仓库状态，this 上下文由 `ThisType<ModelStore>` 提供。
 */
export function clipboardMethods(deps: ModelDeps) {
  return {
    /** 复制表结构到剪贴板载荷（不含导航；副本始终可见） */
    buildCopyDraft(tableId: string): Omit<TableAddPayload, "id"> | null {
      const t = this.tableById(tableId);
      if (!t) return null;
      let name = `${t.tableName}_copy`;
      let n = 1;
      while (this.tableNames.has(name)) {
        n += 1;
        name = `${t.tableName}_copy${n}`;
      }
      return {
        categoryId: t.categoryId,
        tableName: name,
        className: toCamelCase(name),
        comment: t.comment || "",
        parentIdColumn: t.parentIdColumn,
        x: (t.x ?? 0) + 40,
        y: (t.y ?? 0) + 40,
        columns: this.columnsOf(tableId).map((c) => ({
          ...c,
          id: uid("c-"),
          tableId: "",
          propertyName: c.propertyName || toCamelCase(c.columnName, true),
          javaType: c.javaType || getJavaTypeByType(c.type),
        })),
        indexes: this.indexesOf(tableId).map((i) => ({ ...i, id: uid("i-"), tableId: "" })),
      };
    },

    /**
     * 按草稿粘贴新表：position 优先于草稿坐标，表 id 由本方法新生成；
     * 本地先行 + await addTable，失败回滚并抛错（此处不 capture 撤销点）。
     */
    async pasteTable(draft: Omit<TableAddPayload, "id">, position?: { x: number; y: number }) {
      const api = deps.getApi();
      const snap = this.takeSnapshot();
      const tableId = uid("t-");
      const x = position?.x ?? draft.x ?? 0;
      const y = position?.y ?? draft.y ?? 0;
      this.tables.push({
        id: tableId,
        categoryId: String(draft.categoryId),
        tableName: String(draft.tableName),
        className: String(draft.className || "").trim() || undefined,
        comment: String(draft.comment || "").trim(),
        parentIdColumn: String(draft.parentIdColumn || "").trim() || undefined,
        hidden: false,
        x: Number(x) || 0,
        y: Number(y) || 0,
      });
      this.setColumnsOf(tableId, (draft.columns || []).map(clone));
      this.setIndexesOf(tableId, (draft.indexes || []).map(clone));
      try {
        await api.addTable(this.managerTableOf(tableId));
      } catch (e) {
        this.rollback(snap);
        throw e;
      }
      return tableId;
    },
  } satisfies ThisType<ModelStore> & Partial<ModelStore>;
}
