/**
 * 画布仓库：视口（平移/缩放）、选择、交互状态机（框选/拖卡/连线）、
 * 隐藏表、右键菜单、剪贴板等
 */
import { defineStore } from 'pinia'
import { message } from 'antdv-next'
import type { TableAddPayload } from '@/types/model'
import type { Point, Rect, Side } from '@/utils/geometry'
import { CARD_WIDTH, rectCenter, rectsIntersect } from '@/utils/geometry'
import { SEED_HIDDEN_TABLES } from '@/mock/seed'
import { useModelStore } from './model'
import { useUiStore } from './ui'
import { useHistoryStore } from './history'

const HIDDEN_KEY = 'gdbme:hidden'
export const MIN_ZOOM = 0.25
export const MAX_ZOOM = 5

export type ContextMenuKind = 'canvas' | 'card' | 'edge'

export interface ContextMenuState {
  kind: ContextMenuKind
  x: number // 屏幕坐标（相对画布根元素）
  y: number
  world: Point
  tableId?: string
  navigateId?: string
}

type Mode = 'pan' | 'select' | 'dragCards' | 'connect' | null

function loadHidden(): string[] {
  try {
    const raw = localStorage.getItem(HIDDEN_KEY)
    if (raw) return JSON.parse(raw) as string[]
  } catch {
    /* ignore */
  }
  return [...SEED_HIDDEN_TABLES]
}

export const useCanvasStore = defineStore('canvas', {
  state: () => ({
    rootEl: null as HTMLElement | null,
    zoom: 1,
    panX: 0,
    panY: 0,
    viewportW: 0,
    viewportH: 0,
    selectedIds: [] as string[],
    selectedCategoryIds: [] as string[],
    selectedNavigateId: '',
    hoveredNavigateId: '',
    hoveredTableId: '',
    hiddenTableIds: loadHidden(),
    expandedTableIds: [] as string[],
    showIndexIds: [] as string[],
    cardSizes: {} as Record<string, { w: number; h: number }>,
    mode: null as Mode,
    spacePressed: false,
    additiveSelect: false,
    /** 当前手势是否已捕获指针（延迟捕获：超过位移阈值才捕获，避免偷走 click/dblclick） */
    pointerCaptured: false,
    panDraft: null as { lastX: number; lastY: number } | null,
    selectDraft: null as { x0: number; y0: number; x1: number; y1: number } | null,
    dragDraft: null as
      | { startWorld: Point; ids: string[]; origPositions: Record<string, Point>; moved: boolean }
      | null,
    connectDraft: null as { fromTableId: string; fromSide: Side; world: Point; hoverTableId: string | null } | null,
    clipboard: [] as Array<Omit<TableAddPayload, 'id'>>,
    menu: null as ContextMenuState | null,
    animating: false,
    _everFit: false,
  }),

  getters: {
    zoomPercent(): number {
      return Math.round(this.zoom * 100)
    },
    /** 世界层变换样式 */
    worldStyle(): Record<string, string> {
      return {
        transform: `translate(${this.panX}px, ${this.panY}px) scale(${this.zoom})`,
        transformOrigin: '0 0',
      }
    },
    /** 当前视口对应的世界矩形 */
    viewportWorldRect(): Rect {
      return {
        x: (0 - this.panX) / this.zoom,
        y: (0 - this.panY) / this.zoom,
        w: this.viewportW / this.zoom,
        h: this.viewportH / this.zoom,
      }
    },
    visibleTableIds(): string[] {
      const model = useModelStore()
      return model.tables.filter((t) => !this.hiddenTableIds.includes(t.id)).map((t) => t.id)
    },
  },

  actions: {
    /* ==================== 初始化 ==================== */
    init(rootEl: HTMLElement) {
      this.rootEl = rootEl
      this.measure()
      if (this.viewportW > 0 && !this._everFit) {
        this._everFit = true
        this.fitAll(true)
      }
    },
    measure() {
      if (!this.rootEl) return
      const rect = this.rootEl.getBoundingClientRect()
      this.viewportW = rect.width
      this.viewportH = rect.height
    },

    /* ==================== 坐标换算 ==================== */
    localPoint(e: { clientX: number; clientY: number }): Point {
      const rect = this.rootEl?.getBoundingClientRect()
      return { x: e.clientX - (rect?.left ?? 0), y: e.clientY - (rect?.top ?? 0) }
    },
    screenToWorld(p: Point): Point {
      return { x: (p.x - this.panX) / this.zoom, y: (p.y - this.panY) / this.zoom }
    },
    worldToScreen(p: Point): Point {
      return { x: p.x * this.zoom + this.panX, y: p.y * this.zoom + this.panY }
    },

    /* ==================== 视口 ==================== */
    zoomAt(localX: number, localY: number, factor: number) {
      const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, this.zoom * factor))
      if (next === this.zoom) return
      // 保持鼠标下的世界点不动
      const wx = (localX - this.panX) / this.zoom
      const wy = (localY - this.panY) / this.zoom
      this.zoom = next
      this.panX = localX - wx * next
      this.panY = localY - wy * next
    },
    zoomStep(factor: number) {
      this.zoomAt(this.viewportW / 2, this.viewportH / 2, factor)
    },
    resetZoom() {
      this.animateTo({ zoom: 1 })
    },
    cardRectsOf(ids: string[]): Rect[] {
      const model = useModelStore()
      const rects: Rect[] = []
      for (const id of ids) {
        const t = model.tableById(id)
        if (!t) continue
        const size = this.cardSizes[id] || { w: CARD_WIDTH, h: 140 }
        rects.push({ x: t.x ?? 0, y: t.y ?? 0, w: size.w, h: size.h })
      }
      return rects
    },
    fitAll(instant = false) {
      const rects = this.cardRectsOf(this.visibleTableIds)
      if (!rects.length) {
        if (instant) {
          this.panX = 0
          this.panY = 0
        }
        return
      }
      let minX = Infinity
      let minY = Infinity
      let maxX = -Infinity
      let maxY = -Infinity
      for (const r of rects) {
        minX = Math.min(minX, r.x)
        minY = Math.min(minY, r.y)
        maxX = Math.max(maxX, r.x + r.w)
        maxY = Math.max(maxY, r.y + r.h)
      }
      const pad = 60
      const w = maxX - minX + pad * 2
      const h = maxY - minY + pad * 2
      const zoom = Math.min(Math.max(Math.min(this.viewportW / w, this.viewportH / h), MIN_ZOOM), 1.25)
      const target = {
        zoom,
        panX: this.viewportW / 2 - ((minX + maxX) / 2) * zoom,
        panY: this.viewportH / 2 - ((minY + maxY) / 2) * zoom,
      }
      if (instant) {
        this.zoom = target.zoom
        this.panX = target.panX
        this.panY = target.panY
      } else {
        this.animateTo(target)
      }
    },
    centerOnTable(tableId: string) {
      const rects = this.cardRectsOf([tableId])
      if (!rects.length) return
      const c = rectCenter(rects[0])
      const zoom = this.zoom < 0.6 ? 0.85 : this.zoom > 1.8 ? 1.25 : this.zoom
      this.animateTo({
        zoom,
        panX: this.viewportW / 2 - c.x * zoom,
        panY: this.viewportH / 2 - c.y * zoom,
      })
    },
    /** 平滑动画到目标视图 */
    animateTo(target: { zoom?: number; panX?: number; panY?: number }, duration = 220) {
      const from = { zoom: this.zoom, panX: this.panX, panY: this.panY }
      const to = {
        zoom: target.zoom ?? this.zoom,
        panX: target.panX ?? this.panX,
        panY: target.panY ?? this.panY,
      }
      if (duration <= 0 || (from.zoom === to.zoom && from.panX === to.panX && from.panY === to.panY)) {
        this.zoom = to.zoom
        this.panX = to.panX
        this.panY = to.panY
        return
      }
      this.animating = true
      const start = performance.now()
      const tick = (now: number) => {
        const t = Math.min(1, (now - start) / duration)
        const ease = 1 - Math.pow(1 - t, 3)
        this.zoom = from.zoom + (to.zoom - from.zoom) * ease
        this.panX = from.panX + (to.panX - from.panX) * ease
        this.panY = from.panY + (to.panY - from.panY) * ease
        if (t < 1) requestAnimationFrame(tick)
        else this.animating = false
      }
      requestAnimationFrame(tick)
    },
    jumpTo(worldX: number, worldY: number) {
      this.animateTo(
        {
          zoom: this.zoom,
          panX: this.viewportW / 2 - worldX * this.zoom,
          panY: this.viewportH / 2 - worldY * this.zoom,
        },
        0,
      )
    },

    /* ==================== 选择 ==================== */
    setSelection(ids: string[]) {
      this.selectedIds = ids
    },
    selectCategory(id: string, additive = false) {
      if (additive) {
        this.selectedCategoryIds = this.selectedCategoryIds.includes(id)
          ? this.selectedCategoryIds.filter((x) => x !== id)
          : [...this.selectedCategoryIds, id]
      } else {
        this.selectedCategoryIds = this.selectedCategoryIds.includes(id) && this.selectedCategoryIds.length === 1
          ? []
          : [id]
      }
    },
    selectTable(id: string, additive = false) {
      if (additive) {
        this.selectedIds = this.selectedIds.includes(id)
          ? this.selectedIds.filter((x) => x !== id)
          : [...this.selectedIds, id]
      } else {
        this.selectedIds = [id]
      }
    },
    clearSelection() {
      this.selectedIds = []
      this.selectedNavigateId = ''
    },

    /* ==================== 交互状态机 ==================== */
    capturePointer(e: PointerEvent) {
      try {
        this.rootEl?.setPointerCapture(e.pointerId)
      } catch {
        /* ignore */
      }
    },
    /**
     * 延迟捕获：仅在手势真正开始移动后捕获指针。
     * 若在 pointerdown 时立即捕获，浏览器会把后续 click/dblclick 派发到
     * 捕获元素（画布根）而非实际点击目标，导致双击卡片/双击线段/
     * 点击 NN 胶囊等全部失效。因此仅在位移超过阈值后才捕获。
     */
    captureOnce(e: PointerEvent) {
      if (this.pointerCaptured) return
      this.pointerCaptured = true
      this.capturePointer(e)
    },
    resetPointerCapture() {
      this.pointerCaptured = false
    },
    /** 画布空白处按下（左键=框选，中键/空格+左键=平移） */
    onCanvasPointerDown(e: PointerEvent) {
      if (this.mode) return
      if (e.button === 1 || (e.button === 0 && this.spacePressed)) {
        this.beginPan(e)
      } else if (e.button === 0) {
        this.beginSelect(e)
      }
    },
    beginPan(e: PointerEvent) {
      this.mode = 'pan'
      this.panDraft = { lastX: e.clientX, lastY: e.clientY }
    },
    beginSelect(e: PointerEvent) {
      const local = this.localPoint(e)
      this.mode = 'select'
      this.additiveSelect = e.ctrlKey || e.shiftKey
      this.selectDraft = { x0: local.x, y0: local.y, x1: local.x, y1: local.y }
    },
    /** 表卡片按下（卡片组件转发） */
    beginCardDrag(tableId: string, e: PointerEvent) {
      if (this.mode || e.button !== 0) return
      const model = useModelStore()
      const additive = e.ctrlKey || e.shiftKey
      if (additive) {
        this.selectTable(tableId, true)
      } else if (!this.selectedIds.includes(tableId)) {
        this.setSelection([tableId])
      }
      const ids = this.selectedIds.length ? [...this.selectedIds] : [tableId]
      const origPositions: Record<string, Point> = {}
      for (const id of ids) {
        const t = model.tableById(id)
        if (t) origPositions[id] = { x: t.x ?? 0, y: t.y ?? 0 }
      }
      this.mode = 'dragCards'
      this.dragDraft = {
        startWorld: this.screenToWorld(this.localPoint(e)),
        ids,
        origPositions,
        moved: false,
      }
    },
    /** 连接点按下（卡片组件转发） */
    startConnect(tableId: string, side: Side, e: PointerEvent) {
      if (this.mode || e.button !== 0) return
      this.mode = 'connect'
      this.connectDraft = {
        fromTableId: tableId,
        fromSide: side,
        world: this.screenToWorld(this.localPoint(e)),
        hoverTableId: null,
      }
    },
    onPointerMove(e: PointerEvent) {
      if (!this.mode) return
      if (this.mode === 'pan' && this.panDraft) {
        // 平移：首次移动即捕获（无点击语义依赖）
        this.captureOnce(e)
        this.panX += e.clientX - this.panDraft.lastX
        this.panY += e.clientY - this.panDraft.lastY
        this.panDraft.lastX = e.clientX
        this.panDraft.lastY = e.clientY
      } else if (this.mode === 'select' && this.selectDraft) {
        const local = this.localPoint(e)
        this.selectDraft.x1 = local.x
        this.selectDraft.y1 = local.y
        // 位移超过阈值才捕获：无位移的单击/双击仍指向原目标（卡片/线段/胶囊）
        if (Math.hypot(local.x - this.selectDraft.x0, local.y - this.selectDraft.y0) > 3) this.captureOnce(e)
      } else if (this.mode === 'dragCards' && this.dragDraft) {
        const model = useModelStore()
        const world = this.screenToWorld(this.localPoint(e))
        const dx = world.x - this.dragDraft.startWorld.x
        const dy = world.y - this.dragDraft.startWorld.y
        if (!this.dragDraft.moved && Math.hypot(dx, dy) * this.zoom < 3) return
        if (!this.dragDraft.moved) {
          this.dragDraft.moved = true
          useHistoryStore().capture(model.takeSnapshot())
        }
        // 拖拽阈值已过，此时捕获指针（拖出画布也能持续跟踪）
        this.captureOnce(e)
        for (const id of this.dragDraft.ids) {
          const orig = this.dragDraft.origPositions[id]
          const t = model.tableById(id)
          if (orig && t) {
            t.x = orig.x + dx
            t.y = orig.y + dy
          }
        }
      } else if (this.mode === 'connect' && this.connectDraft) {
        // 连线：首次移动即捕获（连接点无点击语义依赖）
        this.captureOnce(e)
        this.connectDraft.world = this.screenToWorld(this.localPoint(e))
        this.connectDraft.hoverTableId = this.hitTableAt(e)
      }
    },
    onPointerUp(e: PointerEvent) {
      this.resetPointerCapture()
      if (!this.mode) return
      const mode = this.mode
      this.mode = null
      if (mode === 'select' && this.selectDraft) {
        const draft = this.selectDraft
        this.selectDraft = null
        const moved = Math.hypot(draft.x1 - draft.x0, draft.y1 - draft.y0) > 3
        if (!moved) {
          if (!this.additiveSelect) this.clearSelection()
          return
        }
        const rect: Rect = {
          x: Math.min(draft.x0, draft.x1),
          y: Math.min(draft.y0, draft.y1),
          w: Math.abs(draft.x1 - draft.x0),
          h: Math.abs(draft.y1 - draft.y0),
        }
        const worldRect: Rect = {
          x: (rect.x - this.panX) / this.zoom,
          y: (rect.y - this.panY) / this.zoom,
          w: rect.w / this.zoom,
          h: rect.h / this.zoom,
        }
        const hits = this.cardRectsOf(this.visibleTableIds)
          .map((r, i) => ({ r, id: this.visibleTableIds[i] }))
          .filter(({ r }) => rectsIntersect(r, worldRect))
          .map(({ id }) => id)
        this.selectedIds = this.additiveSelect
          ? [...new Set([...this.selectedIds, ...hits])]
          : hits
      } else if (mode === 'dragCards' && this.dragDraft) {
        const ids = this.dragDraft.ids
        const moved = this.dragDraft.moved
        this.dragDraft = null
        if (moved) {
          const model = useModelStore()
          model.persistTables(ids).catch(() => undefined)
        }
      } else if (mode === 'connect' && this.connectDraft) {
        const draft = this.connectDraft
        this.connectDraft = null
        this.finishConnect(draft.fromTableId, draft.hoverTableId)
      }
      this.panDraft = null
    },
    hitTableAt(e: { clientX: number; clientY: number }): string | null {
      const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null
      const card = el?.closest('[data-table-id]') as HTMLElement | null
      return card?.getAttribute('data-table-id') ?? null
    },
    /** 完成连线：校验重复后打开新增导航对话框 */
    finishConnect(fromTableId: string, hoverTableId: string | null) {
      const ui = useUiStore()
      const model = useModelStore()
      if (!hoverTableId || hoverTableId === fromTableId) return
      if (model.hasNavigateBetween(fromTableId, hoverTableId)) {
        message.warning('两个表之间已存在导航关系，不能重复创建')
        return
      }
      ui.openNavigateEdit(null, { self: fromTableId, target: hoverTableId })
    },

    /* ==================== 滚轮缩放 ==================== */
    onWheel(e: WheelEvent) {
      const local = this.localPoint(e)
      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15
      this.zoomAt(local.x, local.y, factor)
    },

    /* ==================== 卡片状态 ==================== */
    setCardSize(tableId: string, w: number, h: number) {
      const prev = this.cardSizes[tableId]
      if (prev && Math.abs(prev.w - w) < 1 && Math.abs(prev.h - h) < 1) return
      this.cardSizes[tableId] = { w, h }
    },
    toggleExpand(tableId: string) {
      this.expandedTableIds = this.expandedTableIds.includes(tableId)
        ? this.expandedTableIds.filter((x) => x !== tableId)
        : [...this.expandedTableIds, tableId]
    },
    isExpanded(tableId: string): boolean {
      return this.expandedTableIds.includes(tableId)
    },
    toggleShowIndexes(tableId: string) {
      this.showIndexIds = this.showIndexIds.includes(tableId)
        ? this.showIndexIds.filter((x) => x !== tableId)
        : [...this.showIndexIds, tableId]
    },
    showIndexes(tableId: string): boolean {
      return this.showIndexIds.includes(tableId)
    },
    toggleHiddenTable(tableId: string) {
      if (this.hiddenTableIds.includes(tableId)) {
        this.hiddenTableIds = this.hiddenTableIds.filter((x) => x !== tableId)
      } else {
        this.hiddenTableIds = [...this.hiddenTableIds, tableId]
        this.selectedIds = this.selectedIds.filter((x) => x !== tableId)
      }
      this.persistHidden()
    },
    hideTable(tableId: string) {
      if (!this.hiddenTableIds.includes(tableId)) {
        this.hiddenTableIds = [...this.hiddenTableIds, tableId]
        this.selectedIds = this.selectedIds.filter((x) => x !== tableId)
        this.persistHidden()
      }
    },
    showTable(tableId: string) {
      if (this.hiddenTableIds.includes(tableId)) {
        this.hiddenTableIds = this.hiddenTableIds.filter((x) => x !== tableId)
        this.persistHidden()
      }
    },
    persistHidden() {
      localStorage.setItem(HIDDEN_KEY, JSON.stringify(this.hiddenTableIds))
    },
    resetHidden() {
      this.hiddenTableIds = [...SEED_HIDDEN_TABLES]
      this.persistHidden()
    },

    /* ==================== 右键菜单 ==================== */
    openMenu(menu: ContextMenuState) {
      this.menu = menu
    },
    closeMenu() {
      this.menu = null
    },

    /* ==================== 复制 / 粘贴 ==================== */
    copySelection() {
      const model = useModelStore()
      const ids = this.selectedIds.length ? this.selectedIds : []
      const drafts = ids
        .map((id) => model.buildCopyDraft(id))
        .filter((d): d is Omit<TableAddPayload, 'id'> => Boolean(d))
      this.clipboard = drafts
      return drafts.length
    },
    async pasteAt(world: Point) {
      const model = useModelStore()
      if (!this.clipboard.length) return
      const history = useHistoryStore()
      history.capture(model.takeSnapshot())
      const created: string[] = []
      let i = 0
      for (const draft of this.clipboard) {
        const id = await model.pasteTable(draft, { x: world.x + i * 24, y: world.y + i * 24 })
        created.push(id)
        i += 1
      }
      this.setSelection(created)
    },
    hasClipboard(): boolean {
      return this.clipboard.length > 0
    },

    /* ==================== 视图工具 ==================== */
    setHoveredTable(id: string) {
      this.hoveredTableId = id
    },
    setHoveredNavigate(id: string) {
      this.hoveredNavigateId = id
    },
    setSelectedNavigate(id: string) {
      this.selectedNavigateId = this.selectedNavigateId === id ? '' : id
      if (id) this.selectedIds = []
    },
  },
})
