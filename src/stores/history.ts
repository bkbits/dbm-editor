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

/**
 * 创建历史仓库（reactive 对象工厂，不依赖 Pinia；由 createDBManagerState 注入组件树）
 *
 * @param deps 依赖经工厂入参惰性取用：getModel 取当前模型仓库
 */
export function createHistoryStore(deps: HistoryDeps) {
  return reactive({
    undoStack: [] as ModelSnapshot[],
    redoStack: [] as ModelSnapshot[],

    /** 是否可撤销（只看栈深，不反映恢复是否在途） */
    get canUndo(): boolean {
      return this.undoStack.length > 0;
    },
    /** 是否可重做（capture 会清空重做栈，出现新变更后恒为 false） */
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
    /**
     * 撤销：弹出撤销栈顶为恢复目标，先把当前状态压入重做栈再恢复。
     * 栈空直接返回；恢复失败（syncToApi 拒绝）时抛出且栈移位不回退，
     * 仅模型本身由 restore 回滚到恢复前状态。
     */
    async undo() {
      const model = deps.getModel();
      const snap = this.undoStack.pop();
      if (!snap) return;
      this.redoStack.push(model.takeSnapshot());
      await this.restore(model, snap);
    },
    /**
     * 重做：弹出重做栈顶为恢复目标，先把当前状态压入撤销栈再恢复；
     * 栈空直接返回，失败语义与 undo 一致（抛出，栈移位不回退）。
     */
    async redo() {
      const model = deps.getModel();
      const snap = this.redoStack.pop();
      if (!snap) return;
      this.undoStack.push(model.takeSnapshot());
      await this.restore(model, snap);
    },
    /** 清空撤销/重做栈（数据整体重载或 api 切换后调用，避免跨数据源恢复出脏状态；不触碰模型） */
    clear() {
      this.undoStack = [];
      this.redoStack = [];
    },
    /**
     * 恢复指定快照：内部先记录恢复前状态，applySnapshot 后以 model.syncToApi
     * 做细粒度 diff 同步；api 校验失败（如恢复到不一致状态）时回滚本地并抛出，
     * 由调用方（undo/redo）决定撤销/重做栈的移位。
     */
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
