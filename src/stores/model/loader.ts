/**
 * 模型仓库：加载与全量动作
 * （init / refresh 读契约，saveAll 落盘，syncToApi 把持久层对齐到本地状态）
 */
import type { ManagerTable } from "@/types/model";
import { clone, sameEntity } from "./helpers";
import type { ModelDeps, ModelSnapshot, ModelStore } from "./types";

/**
 * 加载域 part 工厂：init/refresh 读契约、saveAll 落盘、syncToApi 对齐持久层、rollback 回滚快照。
 * 返回对象的方法以 `this` 访问仓库状态，this 上下文由 `ThisType<ModelStore>` 提供。
 */
export function loaderMethods(deps: ModelDeps) {
  return {
    /** 首次加载（幂等：loading 中或已 loaded 直接返回）；失败仅写入 this.error，不抛错 */
    async init() {
      if (this.loading || this.loaded) return;
      this.loading = true;
      this.error = "";
      try {
        const result = await deps.getApi().load();
        this.categories = result.categories.map(clone);
        this.applyTables(result.tables);
        this.navigates = result.navigates.map(clone);
        this.loaded = true;
      } catch (e: unknown) {
        this.error = (e as Error)?.message || "数据加载失败";
      } finally {
        this.loading = false;
      }
    },

    /** 刷新：放弃本地状态，重新从 api.load() 加载（点击「刷新」按钮） */
    async refresh() {
      this.loading = true;
      this.error = "";
      try {
        const result = await deps.getApi().load();
        this.categories = result.categories.map(clone);
        this.applyTables(result.tables);
        this.navigates = result.navigates.map(clone);
        this.loaded = true;
      } catch (e: unknown) {
        this.error = (e as Error)?.message || "数据刷新失败";
        throw e;
      } finally {
        this.loading = false;
      }
    },

    /** 全量保存（点击「保存所有」按钮或按 Ctrl+S 时调用，对应 api.save()） */
    async saveAll() {
      await deps.getApi().save();
    },

    /** 将完整表列表（含字段/索引）还原为扁平状态 */
    applyTables(tables: ManagerTable[]) {
      this.tables = [];
      this.columns = [];
      this.indexes = [];
      for (const vo of tables) {
        const { columns, indexes, ...table } = vo;
        this.tables.push(clone(table));
        this.setColumnsOf(vo.id, columns || []);
        this.setIndexesOf(vo.id, indexes || []);
      }
    },

    /**
     * diff 同步：把持久层（api）对齐到本地当前状态。
     * 用于撤销/重做恢复等本地状态整体变化的场景——按分类/表/导航
     * 三组做增删改 diff，逐个 await 契约的细粒度异步方法。
     */
    async syncToApi() {
      const api = deps.getApi();

      /* ---- 分类：先补新增/更新（保证表引用分类可通过校验） ---- */
      const apiCategories = await api.getCategories();
      const catIds = new Set(this.categories.map((c) => c.id));
      for (const c of this.categories) {
        const existing = apiCategories.find((x) => x.id === c.id);
        if (!existing) await api.addCategory(clone(c));
        else if (!sameEntity(existing, c)) await api.updateCategory(clone(c));
      }

      /* ---- 表：先删后加再改（removeTable 会级联删导航） ---- */
      // 表内容（字段/索引/顺序）全量以本地为准，不做内容比较，
      // 避免键序/排序差异造成误判「相同」而漏同步
      const apiTables = await api.getTables();
      const tableIds = new Set(this.tables.map((t) => t.id));
      for (const t of apiTables) {
        if (!tableIds.has(t.id)) await api.removeTable(t.id);
      }
      for (const t of this.tables) {
        const vo = this.managerTableOf(t.id);
        const existing = apiTables.find((x) => x.id === t.id);
        if (!existing) await api.addTable(clone(vo));
        else await api.updateTable(clone(vo));
      }

      /* ---- 导航：基于（可能被级联修改后的）最新持久层状态 diff ---- */
      const apiNavigates = await api.getNavigates();
      const navIds = new Set(this.navigates.map((n) => n.id));
      for (const n of apiNavigates) {
        if (!navIds.has(n.id)) await api.removeNavigate(n.id);
      }
      for (const n of this.navigates) {
        const existing = apiNavigates.find((x) => x.id === n.id);
        if (!existing) await api.addNavigate(clone(n));
        else if (!sameEntity(existing, n)) await api.updateNavigate(clone(n));
      }

      /* ---- 分类删除放最后（此时分类下已无表） ---- */
      for (const c of apiCategories) {
        if (!catIds.has(c.id)) await api.removeCategory(c.id);
      }
    },

    /** 以快照回滚本地状态（api 调用抛错时使用） */
    rollback(snap: ModelSnapshot) {
      this.applySnapshot(snap);
    },
  } satisfies ThisType<ModelStore> & Partial<ModelStore>;
}
