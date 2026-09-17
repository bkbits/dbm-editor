/**
 * 模型仓库：表增删改与位置持久化
 * （新建 / 更新 / 隐藏 / 批量移动 / 批量删表；位置变更走 updateTablePos 批量契约）
 */
import type { Table, TableAddPayload, TableUpdatePayload } from "@/types/model";
import { uid } from "@/utils/id";
import { clone } from "./helpers";
import type { ModelDeps, ModelStore } from "./types";

/**
 * 表域 part 工厂：表的新建 / 更新 / 隐藏 / 批量移动 / 批量删除与位置持久化。
 * 返回对象的方法以 `this` 访问仓库状态，this 上下文由 `ThisType<ModelStore>` 提供。
 */
export function tableMethods(deps: ModelDeps) {
  return {
    /**
     * 新建表：校验表名非空且唯一、分类存在；options 条目的 tableId 归一为落库后的新 id，
     * 本地先行并 capture 撤销点，await addTable 失败回滚并抛错；成功返回新表 id。
     */
    async createTable(draft: Omit<TableAddPayload, "id">): Promise<string> {
      const tableName = String(draft.tableName || "").trim();
      if (!tableName) throw new Error("表名不能为空");
      if (this.tableNames.has(tableName)) throw new Error(`表名已存在: ${tableName}`);
      if (!this.categories.some((c) => c.id === draft.categoryId))
        throw new Error("所属分类不存在");
      const api = deps.getApi();
      const history = deps.getHistory();
      const snap = this.takeSnapshot();
      const tableId = uid("t-");
      const table: Table = {
        id: tableId,
        categoryId: String(draft.categoryId),
        tableName,
        className: String(draft.className || "").trim() || undefined,
        comment: String(draft.comment || "").trim(),
        parentIdColumn: String(draft.parentIdColumn || "").trim() || undefined,
        hidden: false,
        x: Number(draft.x ?? 0) || 0,
        y: Number(draft.y ?? 0) || 0,
        templates: String(draft.templates ?? "").trim() || undefined,
        // 新表在对话框中尚无真实 id：选项条目的 tableId 归一为落库后的表 id
        options: draft.options
          ? Object.fromEntries(
              Object.entries(clone(draft.options)).map(([k, v]) => [k, { ...v, tableId }]),
            )
          : undefined,
      };
      this.tables.push(table);
      this.setColumnsOf(tableId, (draft.columns || []).map(clone));
      this.setIndexesOf(tableId, (draft.indexes || []).map(clone));
      history.capture(snap);
      try {
        await api.addTable(this.managerTableOf(tableId));
      } catch (e) {
        this.rollback(snap);
        throw e;
      }
      return tableId;
    },

    /**
     * 更新表元信息与字段 / 索引：templates 与 options 为替换语义（传 undefined 即清空），
     * 字段与索引整体覆盖；本地先行 + capture 撤销点，失败回滚并抛错。
     */
    async saveTable(draft: Omit<TableUpdatePayload, "rawNavigates">): Promise<void> {
      const tableId = String(draft.id || "");
      const target = this.tableById(tableId);
      if (!target) throw new Error(`表不存在: ${tableId}`);
      const tableName = String(draft.tableName || "").trim();
      if (!tableName) throw new Error("表名不能为空");
      if (this.tables.some((t) => t.tableName === tableName && t.id !== tableId)) {
        throw new Error(`表名已存在: ${tableName}`);
      }
      const api = deps.getApi();
      const history = deps.getHistory();
      const snap = this.takeSnapshot();
      Object.assign(target, {
        categoryId: String(draft.categoryId ?? target.categoryId),
        tableName,
        className: String(draft.className || "").trim() || undefined,
        comment: String(draft.comment || "").trim(),
        parentIdColumn: String(draft.parentIdColumn ?? "").trim() || undefined,
        x: Number(draft.x ?? target.x ?? 0) || 0,
        y: Number(draft.y ?? target.y ?? 0) || 0,
        // templates/options 采用替换语义（undefined 即清除：启用全部模板/选项全默认）
        templates: String(draft.templates ?? "").trim() || undefined,
        options: draft.options ? clone(draft.options) : undefined,
      });
      this.setColumnsOf(tableId, (draft.columns || []).map(clone));
      this.setIndexesOf(tableId, (draft.indexes || []).map(clone));
      history.capture(snap);
      try {
        await api.updateTable(this.managerTableOf(tableId));
      } catch (e) {
        this.rollback(snap);
        throw e;
      }
    },

    /** 切换表隐藏状态（Table.hidden），持久化走 updateTable */
    async setTableHidden(tableId: string, hidden: boolean) {
      const target = this.tableById(tableId);
      if (!target || target.hidden === hidden) return;
      const snap = this.takeSnapshot();
      target.hidden = hidden;
      try {
        await deps.getApi().updateTable(this.managerTableOf(tableId));
      } catch (e) {
        this.rollback(snap);
        throw e;
      }
    },

    /** 拖拽移动（不触发历史记录，拖拽开始时已捕获） */
    moveTablesBy(ids: string[], dx: number, dy: number) {
      for (const id of ids) {
        const t = this.tableById(id);
        if (!t) continue;
        t.x = (t.x ?? 0) + dx;
        t.y = (t.y ?? 0) + dy;
      }
    },

    /**
     * 持久化表位置（拖动卡片结束/对齐/布局后调用）。
     * 走 updateTablePos 批量契约：多张表卡片被选中并同时移动时，
     * 仅调用一次 api（tables 携带全部移动的表与最终坐标）。
     */
    async persistTables(ids: string[]) {
      const api = deps.getApi();
      const tables = ids
        .map((id) => this.tableById(id))
        .filter((t): t is Table => !!t)
        .map((t) => ({ tableId: t.id, pos: { x: t.x ?? 0, y: t.y ?? 0 } }));
      if (!tables.length) return;
      await api.updateTablePos({ tables });
    },

    /**
     * 批量删表：capture 撤销点后本地级联移除字段 / 索引 / 相关导航，再逐个 await removeTable；
     * 任一步失败回滚快照并抛错。
     */
    async removeTables(ids: string[]) {
      const api = deps.getApi();
      const history = deps.getHistory();
      const snap = this.takeSnapshot();
      history.capture(snap);
      this.tables = this.tables.filter((t) => !ids.includes(t.id));
      this.columns = this.columns.filter((c) => !ids.includes(c.tableId));
      this.indexes = this.indexes.filter((i) => !ids.includes(i.tableId));
      this.navigates = this.navigates.filter(
        (n) => !ids.includes(n.self) && !ids.includes(n.target) && !ids.includes(n.mappingTable),
      );
      try {
        for (const id of ids) await api.removeTable(id);
      } catch (e) {
        this.rollback(snap);
        throw e;
      }
    },
  } satisfies ThisType<ModelStore> & Partial<ModelStore>;
}
