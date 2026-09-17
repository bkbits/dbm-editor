/**
 * 历史仓库：基于模型快照的撤销/重做
 * （reactive 对象工厂形态，由 DBManagerView 经上下文注入，不依赖 Pinia）
 * 恢复后通过细粒度 diff 同步（model.syncToApi）将持久层对齐到本地状态
 */
import { reactive } from "vue";
import { useDBManagerContext } from "./context";
import type { ModelSnapshot, ModelStore } from "./model";

const MAX_STACK = 50;

/** 工厂依赖 */
export interface HistoryDeps {
  getModel: () => ModelStore;
}

export function createHistoryStore(deps: HistoryDeps) {
  return reactive({
    undoStack: [] as ModelSnapshot[],
    redoStack: [] as ModelSnapshot[],

    get canUndo(): boolean {
      return this.undoStack.length > 0;
    },
    get canRedo(): boolean {
      return this.redoStack.length > 0;
    },

    /** 变更前捕获快照（同一快照重复调用会去重跳过） */
    capture(snapshot: ModelSnapshot) {
      const current = JSON.stringify(snapshot);
      const last = this.undoStack[this.undoStack.length - 1];
      if (last && JSON.stringify(last) === current) return;
      this.undoStack.push(snapshot);
      if (this.undoStack.length > MAX_STACK) this.undoStack.shift();
      this.redoStack = [];
    },
    async undo() {
      const model = deps.getModel();
      const snap = this.undoStack.pop();
      if (!snap) return;
      this.redoStack.push(model.takeSnapshot());
      await this.restore(model, snap);
    },
    async redo() {
      const model = deps.getModel();
      const snap = this.redoStack.pop();
      if (!snap) return;
      this.undoStack.push(model.takeSnapshot());
      await this.restore(model, snap);
    },
    clear() {
      this.undoStack = [];
      this.redoStack = [];
    },
    async restore(model: ModelStore, snap: ModelSnapshot) {
      const before = model.takeSnapshot();
      model.applySnapshot(snap);
      try {
        // diff 同步：api 校验失败（如恢复到不一致状态）时回滚本地并中止
        await model.syncToApi();
      } catch (e) {
        model.applySnapshot(before);
        throw e;
      }
    },
  });
}

export type HistoryStore = ReturnType<typeof createHistoryStore>;

/** 子组件取用历史仓库（须处于 DBManagerView 组件树内） */
export function useHistoryStore(): HistoryStore {
  return useDBManagerContext().history;
}
