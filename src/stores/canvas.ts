/**
 * 画布仓库：视口（平移/缩放）、选择、交互状态机（框选/拖卡/连线）、
 * 隐藏表（Table.hidden 派生）、右键菜单、剪贴板、对齐/自动美化布局等
 * （reactive 对象工厂形态，由 DBManagerView 经上下文注入，不依赖 Pinia）
 */
import { reactive } from 'vue'
import { message } from 'antdv-next'
import { useDBManagerContext } from './context'
import type { TableAddPayload } from '@/types/model'
import type { Point, Rect, Side } from '@/utils/geometry'
import { CARD_WIDTH, rectCenter, rectContains } from '@/utils/geometry'
import { computeAutoLayout } from '@/utils/layout'
import type { ModelStore } from './model'
import type { UiStore } from './ui'
import type { HistoryStore } from './history'

export const MIN_ZOOM = 0.25
export const MAX_ZOOM = 5

export type ContextMenuKind = 'canvas' | 'card' | 'edge'

/** 对齐/分布模式 */
export type AlignMode =
  | 'left'
  | 'hcenter'
  | 'right'
  | 'top'
  | 'vcenter'
  | 'bottom'
  | 'hdistribute'
  | 'vdistribute'

export interface ContextMenuState {
  kind: ContextMenuKind
  x: number // 屏幕坐标（相对画布根元素）
  y: number
  world: Point
  tableId?: string
  navigateId?: string
}

type Mode = 'pan' | 'select' | 'dragCards' | 'connect' | 'pinch' | null

/** 工厂依赖（惰性取用，与原先 action 内 useXxxStore() 的运行时语义一致） */
export interface CanvasDeps {
  getModel: () => ModelStore
  getUi: () => UiStore
  getHistory: () => HistoryStore
}

/* ==================== 触屏手势内部状态（非响应式，闭包私有） ====================
 * 说明：手势跟踪数据（指针坐标/基线/定时器）不需要驱动渲染，
 * 放闭包避免 reactive 代理开销；渲染相关的 zoom/panX/panY 本身已是响应式字段 */
const LONG_PRESS_MS = 480
const LONG_PRESS_SLOP = 10
const DOUBLE_TAP_MS = 350
const DOUBLE_TAP_RANGE = 48
/** 当前按下的触屏指针（pointerId → 最新坐标，client 系） */
const touchPts = new Map<number, { x: number; y: number }>()
/** 触屏指针按下时刻的起点/时间/目标（轻点与长按判定用） */
const touchStart = new Map<number, { x: number; y: number; t: number; target: Element | null }>()
/** 双指缩放基线（起始间距/起始缩放/锚点世界坐标）；null = 当前无缩放 */
let pinchBase: { dist: number; zoom: number; worldMid: Point } | null = null
/** 本次手势簇内是否出现过双指（出现过则整簇的轻点不再参与双击判定） */
let pinchSeen = false
let longPressTimer = 0
let longPressFired = false
let lastTap: { t: number; tableId: string; x: number; y: number } | null = null
/** 长按打开菜单的时刻（压制 Android 原生 contextmenu 重复开菜单） */
let lastMenuAt = 0

export function createCanvasStore(deps: CanvasDeps) {
  return reactive({
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
    expandedTableIds: [] as string[],
    showIndexIds: [] as string[],
    cardSizes: {} as Record<string, { w: number; h: number }>,
    mode: null as Mode,
    spacePressed: false,
    additiveSelect: false,
    /** 当前手势是否已捕获指针（延迟捕获：超过位移阈值才捕获，避免偷走 click/dblclick） */
    pointerCaptured: false,
    panDraft: null as {
      sx: number
      sy: number
      lastX: number
      lastY: number
      /** 累计位移是否超过阈值（触屏轻点空白 = 取消选择，需区分轻点与拖动） */
      moved: boolean
      /** 是否触屏发起（触屏轻点语义：无位移时清空选择） */
      touch: boolean
    } | null,
    selectDraft: null as { x0: number; y0: number; x1: number; y1: number } | null,
    dragDraft: null as {
      startWorld: Point
      ids: string[]
      origPositions: Record<string, Point>
      moved: boolean
    } | null,
    connectDraft: null as {
      fromTableId: string
      fromSide: Side
      world: Point
      hoverTableId: string | null
    } | null,
    clipboard: [] as Array<Omit<TableAddPayload, 'id'>>,
    menu: null as ContextMenuState | null,
    animating: false,
    /** 自动美化/对齐后卡片位置过渡动画进行中（卡片渲染层启用 left/top 过渡） */
    layoutAnimating: false,
    _everFit: false,

    get zoomPercent(): number {
      return Math.round(this.zoom * 100)
    },
    /** 世界层变换样式 */
    get worldStyle(): Record<string, string> {
      return {
        transform: `translate(${this.panX}px, ${this.panY}px) scale(${this.zoom})`,
        transformOrigin: '0 0',
      }
    },
    /** 当前视口对应的世界矩形 */
    get viewportWorldRect(): Rect {
      return {
        x: (0 - this.panX) / this.zoom,
        y: (0 - this.panY) / this.zoom,
        w: this.viewportW / this.zoom,
        h: this.viewportH / this.zoom,
      }
    },
    get visibleTableIds(): string[] {
      const model = deps.getModel()
      return model.tables.filter((t) => !t.hidden).map((t) => t.id)
    },
    /** 隐藏表 id 列表（由 Table.hidden 派生，不再单独持久化） */
    get hiddenTableIds(): string[] {
      const model = deps.getModel()
      return model.tables.filter((t) => t.hidden).map((t) => t.id)
    },

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
    cardRectOf(id: string): Rect | null {
      const t = deps.getModel().tableById(id)
      if (!t) return null
      const size = this.cardSizes[id] || { w: CARD_WIDTH, h: 140 }
      return { x: t.x ?? 0, y: t.y ?? 0, w: size.w, h: size.h }
    },
    cardRectsOf(ids: string[]): Rect[] {
      return ids.map((id) => this.cardRectOf(id)).filter((r): r is Rect => Boolean(r))
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
      const zoom = Math.min(
        Math.max(Math.min(this.viewportW / w, this.viewportH / h), MIN_ZOOM),
        1.25,
      )
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
    /**
     * 确保指定表卡片完整进入视口（含 60px 边距）：
     * 已可见则完全不动视口；否则按最小偏移平滑平移（保持当前缩放，不强行居中）。
     * 用于「显示隐藏表」类操作（NN 胶囊展开中间表 / 大纲眼睛恢复显示），
     * 避免表虽已解除隐藏但落在屏幕外 —— 用户以为点击无效
     */
    ensureTableVisible(tableId: string) {
      const r = this.cardRectOf(tableId)
      if (!r) return
      const view = this.viewportWorldRect
      const pad = 60
      let dx = 0
      let dy = 0
      if (r.x < view.x + pad) dx = r.x - pad - view.x
      else if (r.x + r.w > view.x + view.w - pad) dx = r.x + r.w + pad - (view.x + view.w)
      if (r.y < view.y + pad) dy = r.y - pad - view.y
      else if (r.y + r.h > view.y + view.h - pad) dy = r.y + r.h + pad - (view.y + view.h)
      if (!dx && !dy) return
      // dx/dy 为视口需要扩展的世界坐标量 → 世界内容需反向移动：屏幕平移 = -偏移 × 缩放
      this.animateTo({ panX: this.panX - dx * this.zoom, panY: this.panY - dy * this.zoom })
    },
    /** 平滑动画到目标视图 */
    animateTo(target: { zoom?: number; panX?: number; panY?: number }, duration = 220) {
      const from = { zoom: this.zoom, panX: this.panX, panY: this.panY }
      const to = {
        zoom: target.zoom ?? this.zoom,
        panX: target.panX ?? this.panX,
        panY: target.panY ?? this.panY,
      }
      if (
        duration <= 0 ||
        (from.zoom === to.zoom && from.panX === to.panX && from.panY === to.panY)
      ) {
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
      // 单一焦点语义：选中表时清除导航线选中态，避免表选中与线段选中两种高亮叠加混淆
      this.selectedNavigateId = ''
    },
    selectCategory(id: string, additive = false) {
      if (additive) {
        this.selectedCategoryIds = this.selectedCategoryIds.includes(id)
          ? this.selectedCategoryIds.filter((x) => x !== id)
          : [...this.selectedCategoryIds, id]
      } else {
        this.selectedCategoryIds =
          this.selectedCategoryIds.includes(id) && this.selectedCategoryIds.length === 1 ? [] : [id]
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
      // 单一焦点语义（含 Ctrl/Shift 多选卡片路径）
      this.selectedNavigateId = ''
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
    /** 画布根按下（左键=框选，中键/空格+左键=平移；触屏单指=平移）。
     *  注意：卡片会 stop 掉 pointerdown 冒泡，但导航线（含 NN 胶囊）不会 ——
     *  在线段上按下时事件同样会冒泡到根走到这里 */
    onCanvasPointerDown(e: PointerEvent) {
      if (this.mode) return
      if (e.button === 1 || (e.button === 0 && this.spacePressed)) {
        this.beginPan(e)
      } else if (e.button === 0) {
        // 触屏：空白处单指拖动 = 平移（框选无鼠标不可用，多选改由右键菜单「全选表」覆盖）；
        // 轻点空白取消选择见 onPointerUp 的 pan 分支
        if (e.pointerType === 'touch') this.beginPan(e)
        else this.beginSelect(e)
      }
    },
    beginPan(e: PointerEvent) {
      this.mode = 'pan'
      this.panDraft = {
        sx: e.clientX,
        sy: e.clientY,
        lastX: e.clientX,
        lastY: e.clientY,
        moved: false,
        touch: e.pointerType === 'touch',
      }
    },
    beginSelect(e: PointerEvent) {
      const local = this.localPoint(e)
      this.mode = 'select'
      this.additiveSelect = e.ctrlKey || e.shiftKey
      this.selectDraft = { x0: local.x, y0: local.y, x1: local.x, y1: local.y }
      // 按下目标为空白画布：立即捕获指针 —— 框选没有 click/dblclick 目标语义，无需延迟；
      // 且立即捕获后指针移出画布（首个 move 即出界）仍能持续更新选框，
      // 否则快速拖拽时选框会卡在起点（move 事件派发到画布外的元素）。
      // 按下目标为导航线/NN 胶囊（pointerdown 会冒泡到根）：必须延迟捕获（位移>3px 才捕获），
      // 否则立即捕获会把后续 click/dblclick 派发到捕获元素（画布根）而非线段本身，
      // 导致线段单击选中、双击编辑、胶囊点击展开中间表全部失效
      const target = e.target as Element | null
      const fromBlank = !target?.closest?.('[data-navigate-id]')
      if (fromBlank) this.captureOnce(e)
    },
    /** 表卡片按下（卡片组件转发） */
    beginCardDrag(tableId: string, e: PointerEvent) {
      if (this.mode || e.button !== 0) return
      // 布局过渡动画中开始拖拽：立即终止过渡，避免拖拽跟手性被 CSS 过渡拖慢
      if (this.layoutAnimating) this.layoutAnimating = false
      const model = deps.getModel()
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
        // 累计位移超过阈值：标记为拖动（触屏轻点空白=取消选择的长按/轻点判定用）
        if (
          !this.panDraft.moved &&
          Math.hypot(e.clientX - this.panDraft.sx, e.clientY - this.panDraft.sy) > 3
        )
          this.panDraft.moved = true
      } else if (this.mode === 'select' && this.selectDraft) {
        const local = this.localPoint(e)
        this.selectDraft.x1 = local.x
        this.selectDraft.y1 = local.y
        // 位移超过阈值才捕获：无位移的单击/双击仍指向原目标（卡片/线段/胶囊）
        if (Math.hypot(local.x - this.selectDraft.x0, local.y - this.selectDraft.y0) > 3)
          this.captureOnce(e)
      } else if (this.mode === 'dragCards' && this.dragDraft) {
        const model = deps.getModel()
        const world = this.screenToWorld(this.localPoint(e))
        const dx = world.x - this.dragDraft.startWorld.x
        const dy = world.y - this.dragDraft.startWorld.y
        if (!this.dragDraft.moved && Math.hypot(dx, dy) * this.zoom < 3) return
        if (!this.dragDraft.moved) {
          this.dragDraft.moved = true
          deps.getHistory().capture(model.takeSnapshot())
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
    onPointerUp(_e: PointerEvent) {
      this.resetPointerCapture()
      if (!this.mode) return
      // 双指缩放的生命周期由触屏手势层（onTouchPointerEnd）管理
      if (this.mode === 'pinch') return
      // 触屏手势层仍在跟踪的指针抬起（如双指抬其一转单指平移）：不清理其模式
      if (_e.pointerType === 'touch' && touchPts.size > 0) return
      const mode = this.mode
      this.mode = null
      // 触屏轻点空白（无位移的平移按下）：取消选择（与鼠标框选轻点语义一致）
      if (mode === 'pan' && this.panDraft && this.panDraft.touch && !this.panDraft.moved) {
        this.clearSelection()
      }
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
        const hits = this.visibleTableIds
          .map((id) => ({ id, r: this.cardRectOf(id) }))
          .filter(({ r }) => r && rectContains(worldRect, r))
          .map(({ id }) => id)
        this.selectedIds = this.additiveSelect ? [...new Set([...this.selectedIds, ...hits])] : hits
        // 框选切换为表焦点：清除导航线选中态
        this.selectedNavigateId = ''
      } else if (mode === 'dragCards' && this.dragDraft) {
        const ids = this.dragDraft.ids
        const moved = this.dragDraft.moved
        this.dragDraft = null
        if (moved) {
          const model = deps.getModel()
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
      const ui = deps.getUi()
      const model = deps.getModel()
      if (!hoverTableId || hoverTableId === fromTableId) return
      if (model.hasNavigateBetween(fromTableId, hoverTableId)) {
        message.warning('两个表之间已存在导航关系，不能重复创建')
        return
      }
      ui.openNavigateEdit(null, { self: fromTableId, target: hoverTableId })
    },

    /* ==================== 触屏手势（双指缩放 / 长按菜单 / 双击编辑） ====================
     * 由 ModelCanvas 以 window 捕获相位监听转发（capture: true）：
     * - 捕获相位先于卡片/线段自身的冒泡处理，双指落在卡片上也能进入缩放；
     * - window 级监听保证手指滑出画布（悬停在工具栏上空）仍持续跟踪。
     * 手势内部状态见文件顶部闭包（touchPts / pinchBase / longPressTimer / lastTap 等）。 */
    /** 触屏指针按下（仅画布区域内的 touch 指针登记） */
    onTouchPointerDown(e: PointerEvent) {
      if (e.pointerType !== 'touch') return
      if (!this.rootEl?.contains(e.target as Node)) return
      // 小地图（自有拖拽语义）与右键菜单本身（点按菜单项）不参与画布手势
      const t = e.target as Element | null
      if (t?.closest?.('.minimap, .ctx-menu')) return
      touchPts.set(e.pointerId, { x: e.clientX, y: e.clientY })
      touchStart.set(e.pointerId, {
        x: e.clientX,
        y: e.clientY,
        t: Date.now(),
        target: e.target as Element | null,
      })
      longPressFired = false
      if (touchPts.size === 1) {
        this.scheduleLongPress(e.pointerId)
      } else if (touchPts.size === 2) {
        // 第二指落下：终止单指手势（拖卡/框选/连线/平移/长按），进入双指缩放
        pinchSeen = true
        this.cancelLongPress()
        this.abortActiveGesture()
        this.mode = 'pinch'
        pinchBase = this.buildPinchBase()
      }
      // 第三指及以后仅登记生命周期（缩放始终取前两指）
    },
    /** 触屏指针移动（仅已登记的指针） */
    onTouchPointerMove(e: PointerEvent) {
      if (e.pointerType !== 'touch') return
      if (!touchPts.has(e.pointerId)) return
      touchPts.set(e.pointerId, { x: e.clientX, y: e.clientY })
      if (this.mode === 'pinch') {
        if (!pinchBase) pinchBase = this.buildPinchBase() // 双指过近时推迟到分开后建立基线
        this.applyPinch()
        return
      }
      // 单指阶段的长按位移守卫：手指挪动超过容差即取消长按定时器
      const st = touchStart.get(e.pointerId)
      if (st && !longPressFired && Math.hypot(e.clientX - st.x, e.clientY - st.y) > LONG_PRESS_SLOP)
        this.cancelLongPress()
    },
    /** 触屏指针抬起/取消 */
    onTouchPointerEnd(e: PointerEvent) {
      if (e.pointerType !== 'touch') return
      const st = touchStart.get(e.pointerId) ?? null
      touchPts.delete(e.pointerId)
      touchStart.delete(e.pointerId)
      this.cancelLongPress()
      const inPinch = pinchBase !== null || this.mode === 'pinch'
      if (inPinch) {
        if (touchPts.size >= 2) {
          // 三指抬其一：以剩余前两指重建缩放基线
          pinchBase = this.buildPinchBase()
        } else if (touchPts.size === 1) {
          // 剩一指：无缝转为单指平移（已移动标记，避免轻点误清选择）
          pinchBase = null
          const [p] = [...touchPts.values()]
          this.mode = 'pan'
          this.panDraft = {
            sx: p.x,
            sy: p.y,
            lastX: p.x,
            lastY: p.y,
            moved: true,
            touch: true,
          }
        } else {
          // 全部抬起：结束手势簇
          pinchBase = null
          this.mode = null
          this.panDraft = null
          pinchSeen = false
        }
        return
      }
      const wasPinchCluster = pinchSeen
      if (touchPts.size === 0) pinchSeen = false
      if (wasPinchCluster) return
      // 干净轻点（时长短 + 位移小 + 未触发长按）：双击卡片 = 打开表编辑
      const tapDisplacement = st ? Math.hypot(e.clientX - st.x, e.clientY - st.y) : Infinity
      if (!longPressFired && st && Date.now() - st.t < 400 && tapDisplacement < LONG_PRESS_SLOP) {
        const target = st.target
        const onConnector = Boolean(target?.closest?.('.connector'))
        const card = target?.closest?.('[data-table-id]') as HTMLElement | null
        const tableId = card?.getAttribute('data-table-id')
        if (tableId && !onConnector) {
          if (
            lastTap &&
            Date.now() - lastTap.t < DOUBLE_TAP_MS &&
            lastTap.tableId === tableId &&
            Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < DOUBLE_TAP_RANGE
          ) {
            lastTap = null
            deps.getUi().openTableEdit(tableId)
          } else {
            lastTap = { t: Date.now(), tableId, x: e.clientX, y: e.clientY }
          }
        } else {
          lastTap = null
        }
      }
    },
    /** 调度长按菜单（480ms 无位移触发，按按下目标分流卡片/线段/画布菜单） */
    scheduleLongPress(pointerId: number) {
      this.cancelLongPress()
      longPressTimer = window.setTimeout(() => {
        longPressTimer = 0
        if (touchPts.size !== 1 || this.mode === 'pinch' || pinchBase) return
        const st = touchStart.get(pointerId)
        const cur = touchPts.get(pointerId)
        if (!st || !cur) return
        if (Math.hypot(cur.x - st.x, cur.y - st.y) > LONG_PRESS_SLOP) return
        longPressFired = true
        this.abortActiveGesture()
        const local = this.localPoint({ clientX: st.x, clientY: st.y })
        const world = this.screenToWorld(local)
        const target = st.target
        const card = target?.closest?.('[data-table-id]') as HTMLElement | null
        const edge = target?.closest?.('[data-navigate-id]') as HTMLElement | null
        lastMenuAt = Date.now()
        if (card?.getAttribute('data-table-id')) {
          this.openMenu({
            kind: 'card',
            x: local.x,
            y: local.y,
            world,
            tableId: card.getAttribute('data-table-id') as string,
          })
        } else if (edge?.getAttribute('data-navigate-id')) {
          this.openMenu({
            kind: 'edge',
            x: local.x,
            y: local.y,
            world,
            navigateId: edge.getAttribute('data-navigate-id') as string,
          })
        } else {
          this.openMenu({ kind: 'canvas', x: local.x, y: local.y, world })
        }
        // 轻微触觉反馈（支持的浏览器静默忽略）
        navigator.vibrate?.(12)
      }, LONG_PRESS_MS)
    },
    cancelLongPress() {
      if (longPressTimer) {
        clearTimeout(longPressTimer)
        longPressTimer = 0
      }
    },
    /** 长按刚开过菜单（压制 Android 长按后紧接着派发的原生 contextmenu 重复开菜单） */
    touchMenuGuard(): boolean {
      return Date.now() - lastMenuAt < 400
    },
    /** 无副作用丢弃当前单指手势（进入双指缩放 / 长按菜单前调用） */
    abortActiveGesture() {
      if (!this.mode || this.mode === 'pinch') return
      const mode = this.mode
      this.mode = null
      this.resetPointerCapture()
      if (mode === 'dragCards' && this.dragDraft) {
        const ids = this.dragDraft.ids
        const moved = this.dragDraft.moved
        this.dragDraft = null
        // 已发生位移的拖卡：按正常落点语义落库，避免位置更新滞留内存
        if (moved)
          deps
            .getModel()
            .persistTables(ids)
            .catch(() => undefined)
      } else if (mode === 'connect') {
        this.connectDraft = null
      }
      this.selectDraft = null
      this.panDraft = null
    },
    /** 建立双指缩放基线（间距过近时不建立，待分开后补建） */
    buildPinchBase(): { dist: number; zoom: number; worldMid: Point } | null {
      const pts = [...touchPts.values()].slice(0, 2)
      if (pts.length < 2) return null
      const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y)
      if (dist < 12) return null
      const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 }
      const local = this.localPoint({ clientX: mid.x, clientY: mid.y })
      return { dist, zoom: this.zoom, worldMid: this.screenToWorld(local) }
    },
    /** 应用双指缩放：锚定按下时的世界点跟随双指中点（缩放 + 双指平移一体） */
    applyPinch() {
      if (!pinchBase) return
      const pts = [...touchPts.values()].slice(0, 2)
      if (pts.length < 2) return
      const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y)
      if (dist < 12) return
      const factor = dist / pinchBase.dist
      const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, pinchBase.zoom * factor))
      const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 }
      const local = this.localPoint({ clientX: mid.x, clientY: mid.y })
      this.zoom = next
      this.panX = local.x - pinchBase.worldMid.x * next
      this.panY = local.y - pinchBase.worldMid.y * next
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
      const model = deps.getModel()
      const next = !this.hiddenTableIds.includes(tableId)
      if (next) this.selectedIds = this.selectedIds.filter((x) => x !== tableId)
      model.setTableHidden(tableId, next).catch((e: unknown) => {
        message.error((e as Error)?.message || '切换隐藏状态失败')
      })
    },
    hideTable(tableId: string) {
      const model = deps.getModel()
      if (!this.hiddenTableIds.includes(tableId)) {
        this.selectedIds = this.selectedIds.filter((x) => x !== tableId)
        model.setTableHidden(tableId, true).catch((e: unknown) => {
          message.error((e as Error)?.message || '隐藏表失败')
        })
      }
    },
    showTable(tableId: string) {
      const model = deps.getModel()
      if (this.hiddenTableIds.includes(tableId)) {
        model.setTableHidden(tableId, false).catch((e: unknown) => {
          message.error((e as Error)?.message || '显示表失败')
        })
      }
    },

    /* ==================== 自动美化 / 对齐分布 ==================== */

    /**
     * 自动美化：以导航关系为边做力导向布局，自动规划每个表卡片的位置。
     * 相关联的表彼此靠近、孤立表散开不重叠，结果按 20px 网格对齐。
     */
    async autoLayout() {
      const model = deps.getModel()
      const ids = [...this.visibleTableIds]
      if (!ids.length) {
        message.warning('画布上没有可见的表卡片')
        return
      }
      const visibleSet = new Set(ids)
      const nodes = ids
        .map((id) => ({ id, rect: this.cardRectOf(id) }))
        .filter((x): x is { id: string; rect: Rect } => Boolean(x.rect))
      // 布局边：两端均可见的导航；NN 且中间表可见时拆为两段（self↔中间表↔target）
      const edges: Array<{ source: string; target: string }> = []
      for (const nav of model.navigates) {
        if (!visibleSet.has(nav.self) || !visibleSet.has(nav.target)) continue
        if (nav.type === 'NN' && nav.mappingTable && visibleSet.has(nav.mappingTable)) {
          edges.push({ source: nav.self, target: nav.mappingTable })
          edges.push({ source: nav.mappingTable, target: nav.target })
        } else {
          edges.push({ source: nav.self, target: nav.target })
        }
      }
      const positions = computeAutoLayout(nodes, edges)
      const history = deps.getHistory()
      history.capture(model.takeSnapshot())
      this.layoutAnimating = true
      for (const [id, p] of Object.entries(positions)) {
        const t = model.tableById(id)
        if (t) {
          t.x = p.x
          t.y = p.y
        }
      }
      await model.persistTables(ids).catch(() => undefined)
      // 卡片位置过渡 460ms，结束后收起动画标记；期间开始拖拽会提前终止
      setTimeout(() => {
        this.layoutAnimating = false
      }, 500)
      this.fitAll()
      message.success(`已自动排列 ${ids.length} 张表卡片`)
    },

    /**
     * 对齐/分布当前选中的表卡片：
     * 左/右/顶/底对齐边缘，水平/垂直对齐居中（中心线对齐），
     * 水平/垂直均匀分布（首尾不动，等间距分布中间卡片）
     */
    async alignSelection(mode: AlignMode) {
      const model = deps.getModel()
      const ids = this.selectedIds.filter((id) => this.visibleTableIds.includes(id))
      const isDistribute = mode === 'hdistribute' || mode === 'vdistribute'
      const need = isDistribute ? 3 : 2
      if (ids.length < need) {
        message.warning(isDistribute ? '均匀分布至少需要选中 3 张表' : '对齐至少需要选中 2 张表')
        return
      }
      const items = ids
        .map((id) => ({ id, rect: this.cardRectOf(id) }))
        .filter((x): x is { id: string; rect: Rect } => Boolean(x.rect))
      if (items.length < need) return

      const moves: Array<{ id: string; x: number; y: number }> = items.map((it) => ({
        id: it.id,
        x: it.rect.x,
        y: it.rect.y,
      }))

      switch (mode) {
        case 'left': {
          const v = Math.min(...items.map((it) => it.rect.x))
          moves.forEach((m) => (m.x = v))
          break
        }
        case 'right': {
          const v = Math.max(...items.map((it) => it.rect.x + it.rect.w))
          moves.forEach((m) => (m.x = v - (this.cardRectOf(m.id)?.w ?? 0)))
          break
        }
        case 'top': {
          const v = Math.min(...items.map((it) => it.rect.y))
          moves.forEach((m) => (m.y = v))
          break
        }
        case 'bottom': {
          const v = Math.max(...items.map((it) => it.rect.y + it.rect.h))
          moves.forEach((m) => (m.y = v - (this.cardRectOf(m.id)?.h ?? 0)))
          break
        }
        case 'hcenter': {
          // 水平对齐：各卡片垂直中心对齐到平均中心线（同一水平线）
          const mean = items.reduce((s, it) => s + it.rect.y + it.rect.h / 2, 0) / items.length
          moves.forEach((m) => (m.y = mean - (this.cardRectOf(m.id)?.h ?? 0) / 2))
          break
        }
        case 'vcenter': {
          // 垂直对齐：各卡片水平中心对齐到平均中心线（同一垂直线）
          const mean = items.reduce((s, it) => s + it.rect.x + it.rect.w / 2, 0) / items.length
          moves.forEach((m) => (m.x = mean - (this.cardRectOf(m.id)?.w ?? 0) / 2))
          break
        }
        case 'hdistribute': {
          // 水平均匀分布：按 x 排序，首尾卡片保持不动，中间卡片等间距
          const sorted = [...items].sort((a, b) => a.rect.x - b.rect.x)
          const first = sorted[0].rect
          const last = sorted[sorted.length - 1].rect
          const sumW = sorted.reduce((s, it) => s + it.rect.w, 0)
          const span = last.x + last.w - first.x
          const gap = (span - sumW) / (sorted.length - 1)
          let cursor = first.x
          for (const it of sorted) {
            const m = moves.find((mv) => mv.id === it.id)
            if (m) m.x = cursor
            cursor += it.rect.w + gap
          }
          break
        }
        case 'vdistribute': {
          // 垂直均匀分布：按 y 排序，首尾卡片保持不动，中间卡片等间距
          const sorted = [...items].sort((a, b) => a.rect.y - b.rect.y)
          const first = sorted[0].rect
          const last = sorted[sorted.length - 1].rect
          const sumH = sorted.reduce((s, it) => s + it.rect.h, 0)
          const span = last.y + last.h - first.y
          const gap = (span - sumH) / (sorted.length - 1)
          let cursor = first.y
          for (const it of sorted) {
            const m = moves.find((mv) => mv.id === it.id)
            if (m) m.y = cursor
            cursor += it.rect.h + gap
          }
          break
        }
      }

      const history = deps.getHistory()
      history.capture(model.takeSnapshot())
      this.layoutAnimating = true
      for (const mv of moves) {
        const t = model.tableById(mv.id)
        if (t) {
          t.x = Math.round(mv.x)
          t.y = Math.round(mv.y)
        }
      }
      await model.persistTables(moves.map((m) => m.id)).catch(() => undefined)
      setTimeout(() => {
        this.layoutAnimating = false
      }, 500)
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
      const model = deps.getModel()
      const ids = this.selectedIds.length ? this.selectedIds : []
      const drafts = ids
        .map((id) => model.buildCopyDraft(id))
        .filter((d): d is Omit<TableAddPayload, 'id'> => Boolean(d))
      this.clipboard = drafts
      return drafts.length
    },
    async pasteAt(world: Point) {
      const model = deps.getModel()
      if (!this.clipboard.length) return
      const history = deps.getHistory()
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
  })
}

export type CanvasStore = ReturnType<typeof createCanvasStore>

/** 子组件取用画布仓库（须处于 DBManagerView 组件树内） */
export function useCanvasStore(): CanvasStore {
  return useDBManagerContext().canvas
}
