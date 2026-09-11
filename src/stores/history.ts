/**
 * 历史仓库：基于模型快照的撤销/重做
 * 恢复后通过细粒度 diff 同步（model.syncToApi）将持久层对齐到本地状态
 */
import { defineStore } from 'pinia'
import type { ModelSnapshot } from './model'
import { useModelStore } from './model'

const MAX_STACK = 50

export const useHistoryStore = defineStore('history', {
  state: () => ({
    undoStack: [] as ModelSnapshot[],
    redoStack: [] as ModelSnapshot[],
  }),
  getters: {
    canUndo: (s) => s.undoStack.length > 0,
    canRedo: (s) => s.redoStack.length > 0,
  },
  actions: {
    /** 变更前捕获快照（同一快照重复调用会去重跳过） */
    capture(snapshot: ModelSnapshot) {
      const current = JSON.stringify(snapshot)
      const last = this.undoStack[this.undoStack.length - 1]
      if (last && JSON.stringify(last) === current) return
      this.undoStack.push(snapshot)
      if (this.undoStack.length > MAX_STACK) this.undoStack.shift()
      this.redoStack = []
    },
    async undo() {
      const model = useModelStore()
      const snap = this.undoStack.pop()
      if (!snap) return
      this.redoStack.push(model.takeSnapshot())
      await this.restore(model, snap)
    },
    async redo() {
      const model = useModelStore()
      const snap = this.redoStack.pop()
      if (!snap) return
      this.undoStack.push(model.takeSnapshot())
      await this.restore(model, snap)
    },
    clear() {
      this.undoStack = []
      this.redoStack = []
    },
    async restore(model: ReturnType<typeof useModelStore>, snap: ModelSnapshot) {
      const before = model.takeSnapshot()
      model.applySnapshot(snap)
      try {
        // diff 同步：api 校验失败（如恢复到不一致状态）时回滚本地并中止
        model.syncToApi()
      } catch (e) {
        model.applySnapshot(before)
        throw e
      }
    },
  },
})
