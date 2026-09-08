/**
 * 历史仓库：基于模型快照的撤销/重做
 * 恢复后通过 API 差量同步（新增/更新/删除）保持 mock 后端一致
 */
import { defineStore } from 'pinia'
import { categoryApi, tableApi } from '@/api/modules'
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
      await this.resync(before, snap)
    },
    /** 差量同步：分类与表的增/改/删（导航随表更新载荷一并替换） */
    async resync(prev: ModelSnapshot, next: ModelSnapshot) {
      const prevCat = new Map(prev.categories.map((c) => [c.id, c]))
      const nextCat = new Map(next.categories.map((c) => [c.id, c]))
      const prevTable = new Map(prev.tables.map((t) => [t.id, t]))
      const nextTable = new Map(next.tables.map((t) => [t.id, t]))
      const tasks: Promise<unknown>[] = []
      // 分类
      for (const [id, cat] of nextCat) {
        const old = prevCat.get(id)
        if (!old) tasks.push(categoryApi.add(cat))
        else if (JSON.stringify(old) !== JSON.stringify(cat)) tasks.push(categoryApi.update(cat))
      }
      for (const id of prevCat.keys()) if (!nextCat.has(id)) tasks.push(categoryApi.remove(id))
      // 表（新增/更新）
      for (const [id, t] of nextTable) {
        if (!prevTable.has(id)) {
          tasks.push(
            tableApi.add({
              ...JSON.parse(JSON.stringify(t)),
              columns: next.columns.filter((c) => c.tableId === id),
              indexes: next.indexes.filter((i) => i.tableId === id),
              rawNavigates: next.navigates.filter((n) => n.self === id || n.target === id),
            }),
          )
        }
      }
      await Promise.allSettled(tasks)
      // 更新/删除（待新增完成后顺序执行，避免导航替换语义竞态）
      const tasks2: Promise<unknown>[] = []
      for (const [id, t] of nextTable) {
        if (!prevTable.has(id)) continue
        const rawNavigates = next.navigates.filter((n) => n.self === id || n.target === id)
        const prevNavs = prev.navigates.filter((n) => n.self === id || n.target === id)
        const changedNavs = JSON.stringify(rawNavigates) !== JSON.stringify(prevNavs)
        const prevCols = prev.columns.filter((c) => c.tableId === id)
        const nextCols = next.columns.filter((c) => c.tableId === id)
        const prevIdx = prev.indexes.filter((i) => i.tableId === id)
        const nextIdx = next.indexes.filter((i) => i.tableId === id)
        if (
          JSON.stringify(prevTable.get(id)) !== JSON.stringify(t) ||
          JSON.stringify(prevCols) !== JSON.stringify(nextCols) ||
          JSON.stringify(prevIdx) !== JSON.stringify(nextIdx) ||
          changedNavs
        ) {
          tasks2.push(
            tableApi.update({
              ...JSON.parse(JSON.stringify(t)),
              columns: JSON.parse(JSON.stringify(nextCols)),
              indexes: JSON.parse(JSON.stringify(nextIdx)),
              rawNavigates: JSON.parse(JSON.stringify(rawNavigates)),
            }),
          )
        }
      }
      for (const id of prevTable.keys()) {
        if (!nextTable.has(id)) tasks2.push(tableApi.remove(id))
      }
      await Promise.allSettled(tasks2)
    },
  },
})
