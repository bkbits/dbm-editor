/**
 * 模型仓库：快照与恢复
 * （撤销重做快照的取出 / 写回，以及演示数据重置）
 */
import { clone } from "./helpers";
import type { ModelDeps, ModelSnapshot, ModelStore } from "./types";

/**
 * 快照域 part 工厂：撤销 / 重做用的整仓状态深拷贝存取与演示数据重置。
 * 返回对象的方法以 `this` 访问仓库状态，this 上下文由 `ThisType<ModelStore>` 提供。
 */
export function snapshotMethods(deps: ModelDeps) {
  return {
    /** 取全量模型状态深拷贝快照（分类 / 表 / 字段 / 索引 / 导航；不访问 api） */
    takeSnapshot(): ModelSnapshot {
      return {
        categories: clone(this.categories),
        tables: clone(this.tables),
        columns: clone(this.columns),
        indexes: clone(this.indexes),
        navigates: clone(this.navigates),
      };
    },

    /** 用快照整体覆盖本地状态（再次深拷贝写入，不与快照共享引用；纯本地，不落 api） */
    applySnapshot(snap: ModelSnapshot) {
      this.categories = clone(snap.categories);
      this.tables = clone(snap.tables);
      this.columns = clone(snap.columns);
      this.indexes = clone(snap.indexes);
      this.navigates = clone(snap.navigates);
    },

    /** 重置为演示数据（demo api 提供 resetDemo；正式实现下等价于重新加载） */
    async resetDemoData() {
      const api = deps.getApi();
      await api.resetDemo?.();
      // 全量刷新各仓库（经工厂依赖引用，无模块环问题）
      const dict = deps.getDict();
      const templateStore = deps.getTemplate();
      const settings = deps.getSettings();
      for (const s of [this, dict, templateStore, settings] as Array<{
        loaded: boolean;
        loading: boolean;
      }>) {
        s.loaded = false;
        s.loading = false;
      }
      await Promise.all([this.init(), dict.init(), templateStore.init(), settings.init()]);
    },
  } satisfies ThisType<ModelStore> & Partial<ModelStore>;
}
