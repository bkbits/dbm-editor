/**
 * 模型仓库：加载与全量动作
 * （init / refresh 读契约；saveAll 以完整快照全量落盘；modelElementsOf
 *   构造当前运行时状态的 ModelElements 快照，供「保存所有」与 AI 工具共用）
 */
import type { ManagerTable, ModelElements } from "@/types/model";
import { clone } from "./helpers";
import type { ModelDeps, ModelSnapshot, ModelStore } from "./types";

/**
 * 加载域 part 工厂：init/refresh 读契约、saveAll 全量落盘（完整快照替换
 * 语义）、modelElementsOf 快照构造、rollback 回滚快照。
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

    /** 刷新：放弃本地状态，重新从 api.load() 加载（点击「刷新」按钮 / AI reload 工具） */
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

    /**
     * 全量保存（点击「保存所有」按钮或按 Ctrl+S / AI saveAll 工具时调用）：
     * 以当前运行时状态的完整快照调用 api.save（全量替换语义——持久层中
     * 不在快照内的分类 / 表 / 导航会被删除）。
     */
    async saveAll() {
      await deps.getApi().save(this.modelElementsOf());
    },

    /** 当前运行时状态的完整模型元素快照（深拷贝，含字段与索引装配） */
    modelElementsOf(): ModelElements {
      return {
        categories: clone(this.categories),
        tables: this.tables.map((t) => this.managerTableOf(t.id)),
        navigates: clone(this.navigates),
      };
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

    /** 以快照回滚本地状态（api 调用抛错时使用） */
    rollback(snap: ModelSnapshot) {
      this.applySnapshot(snap);
    },
  } satisfies ThisType<ModelStore> & Partial<ModelStore>;
}
