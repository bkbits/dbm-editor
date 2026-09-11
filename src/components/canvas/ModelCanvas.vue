<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Modal } from 'antdv-next'
import { useCanvasStore } from '@/stores/canvas'
import { useModelStore } from '@/stores/model'
import { useHistoryStore } from '@/stores/history'
import { useThemeStore } from '@/stores/theme'
import { useUiStore } from '@/stores/ui'
import NavigateEdge from './NavigateEdge.vue'
import TableCard from './TableCard.vue'
import Minimap from './Minimap.vue'
import CanvasContextMenu from './CanvasContextMenu.vue'
import ConnectionDraft from './ConnectionDraft.vue'

const canvas = useCanvasStore()
const model = useModelStore()
const history = useHistoryStore()
const theme = useThemeStore()
const ui = useUiStore()

const rootRef = ref<HTMLElement>()
const gridRef = ref<HTMLCanvasElement>()
const worldRef = ref<HTMLElement>()

/** 可渲染的导航（任一端表隐藏则整线不渲染） */
const visibleNavigates = computed(() =>
  model.navigates.filter(
    (n) => !canvas.hiddenTableIds.includes(n.self) && !canvas.hiddenTableIds.includes(n.target),
  ),
)

/** 视口内的卡片（渲染范围裁剪，保证 100+ 卡片流畅） */
const viewportWorld = computed(() => canvas.viewportWorldRect)
const visibleCards = computed(() => {
  // 布局动画期间放宽裁剪缓冲：卡片滑向新位置途中不因离开视口而被卸载
  const margin = (canvas.layoutAnimating ? 2400 : 400) / canvas.zoom
  const rect = viewportWorld.value
  return canvas.visibleTableIds.filter((id) => {
    const t = model.tableById(id)
    if (!t) return false
    const size = canvas.cardSizes[id] || { w: 268, h: 120 }
    const x = t.x ?? 0
    const y = t.y ?? 0
    return (
      x + size.w > rect.x - margin &&
      x < rect.x + rect.w + margin &&
      y + size.h > rect.y - margin &&
      y < rect.y + rect.h + margin
    )
  })
})

/* ==================== 网格绘制 ==================== */
let gridFrame = 0
function scheduleGrid() {
  if (gridFrame) return
  gridFrame = requestAnimationFrame(() => {
    gridFrame = 0
    drawGrid()
  })
}

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

function drawGrid() {
  const cv = gridRef.value
  const root = rootRef.value
  if (!cv || !root) return
  const w = canvas.viewportW
  const h = canvas.viewportH
  if (w <= 0 || h <= 0) return
  const dpr = window.devicePixelRatio || 1
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
    cv.width = Math.round(w * dpr)
    cv.height = Math.round(h * dpr)
    cv.style.width = `${w}px`
    cv.style.height = `${h}px`
  }
  const ctx = cv.getContext('2d')
  if (!ctx) return
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, w, h)

  const BASE = 20 // 世界坐标网格间距
  let minor = BASE * canvas.zoom
  while (minor < 9) minor *= 5 // 缩放过小时隐藏细网格
  const major = minor * 5

  ctx.lineWidth = 1 // 网格线粗细固定 1px，不随缩放变化
  ctx.strokeStyle = cssVar('--grid-minor')
  drawGridLines(ctx, w, h, minor, canvas.panX, canvas.panY)
  ctx.strokeStyle = cssVar('--grid-major')
  drawGridLines(ctx, w, h, major, canvas.panX, canvas.panY)
}

function drawGridLines(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  step: number,
  panX: number,
  panY: number,
) {
  if (step <= 0) return
  ctx.beginPath()
  const startX = ((panX % step) + step) % step
  for (let x = startX; x <= w; x += step) {
    const px = Math.round(x) + 0.5
    ctx.moveTo(px, 0)
    ctx.lineTo(px, h)
  }
  const startY = ((panY % step) + step) % step
  for (let y = startY; y <= h; y += step) {
    const py = Math.round(y) + 0.5
    ctx.moveTo(0, py)
    ctx.lineTo(w, py)
  }
  ctx.stroke()
}

watch(
  () => [canvas.zoom, canvas.panX, canvas.panY, canvas.viewportW, canvas.viewportH, theme.theme],
  scheduleGrid,
  { immediate: true },
)

/* ==================== 事件绑定 ==================== */
let resizeObserver: ResizeObserver | null = null
const boundWheel = (e: WheelEvent) => {
  e.preventDefault()
  canvas.onWheel(e)
}

/* window 级 pointerup/pointercancel 兜底：
   延迟指针捕获后，无位移的单击不再捕获指针，
   若指针在画布外（大纲/头部）释放，根元素的 @pointerup 收不到事件，
   会导致交互模式卡死；onPointerUp 为幂等早退设计，重复调用安全 */
const boundWindowPointerUp = (e: PointerEvent) => canvas.onPointerUp(e)
const boundWindowPointerCancel = (e: PointerEvent) => canvas.onPointerUp(e)

function onRootPointerDown(e: PointerEvent) {
  // 事件仅在未被卡片/连线拦截（冒泡到根）时触发 —— 即空白区域
  canvas.closeMenu()
  canvas.onCanvasPointerDown(e)
}

function onRootContextMenu(e: MouseEvent) {
  e.preventDefault()
  const target = e.target as HTMLElement
  const card = target.closest('[data-table-id]')
  if (card) return // 卡片自身已处理
  const edge = target.closest('[data-navigate-id]')
  if (edge) return // 线段自身已处理
  const local = canvas.localPoint(e)
  canvas.openMenu({
    kind: 'canvas',
    x: local.x,
    y: local.y,
    world: canvas.screenToWorld(local),
  })
}

function isTypingTarget(e: Event): boolean {
  const t = e.target as HTMLElement | null
  if (!t) return false
  const tag = t.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable
}

function onKeyDown(e: KeyboardEvent) {
  if (isTypingTarget(e)) return
  if (e.code === 'Space') {
    if (!canvas.spacePressed) {
      canvas.spacePressed = true
      e.preventDefault()
    }
    return
  }
  const mod = e.ctrlKey || e.metaKey
  if (mod && e.key.toLowerCase() === 'z') {
    e.preventDefault()
    if (e.shiftKey) history.redo()
    else history.undo()
    return
  }
  if (mod && e.key.toLowerCase() === 'y') {
    e.preventDefault()
    history.redo()
    return
  }
  if (mod && e.key.toLowerCase() === 'c') {
    if (canvas.selectedIds.length) canvas.copySelection()
    return
  }
  // Ctrl+A 全选所有表卡片（仅可见表，隐藏表无卡片不参与）
  if (mod && e.key.toLowerCase() === 'a') {
    e.preventDefault()
    canvas.setSelection([...canvas.visibleTableIds])
    return
  }
  // Ctrl+D 取消选中（同 Esc；阻止浏览器书签快捷键）
  if (mod && e.key.toLowerCase() === 'd') {
    e.preventDefault()
    canvas.clearSelection()
    canvas.closeMenu()
    return
  }
  if (mod && e.key.toLowerCase() === 'v') {
    if (canvas.hasClipboard()) {
      const center = canvas.screenToWorld({ x: canvas.viewportW / 2, y: canvas.viewportH / 2 })
      canvas.pasteAt(center)
    }
    return
  }
  if (e.key === 'Delete' || e.key === 'Backspace') {
    if (canvas.selectedIds.length) {
      e.preventDefault()
      confirmDeleteTables()
    }
    return
  }
  if (e.key === 'Escape') {
    canvas.clearSelection()
    canvas.closeMenu()
  }
}

function onKeyUp(e: KeyboardEvent) {
  if (e.code === 'Space') canvas.spacePressed = false
}

function confirmDeleteTables() {
  const ids = [...canvas.selectedIds]
  const names = ids.map((id) => model.tableById(id)?.tableName).filter(Boolean)
  const navCount = model.navigates.filter(
    (n) => ids.includes(n.self) || ids.includes(n.target) || ids.includes(n.mappingTable),
  ).length
  Modal.confirm({
    title: `删除 ${ids.length} 张表？`,
    content: `将删除表：${names.join('、')}${navCount ? `，及其涉及的 ${navCount} 条导航关系` : ''}。该操作可通过 Ctrl+Z 撤销。`,
    okText: '删除',
    okType: 'danger',
    cancelText: '取消',
    onOk: async () => {
      await model.removeTables(ids)
      canvas.setSelection([])
    },
  })
}

onMounted(() => {
  if (!rootRef.value) return
  canvas.init(rootRef.value)
  resizeObserver = new ResizeObserver(() => {
    canvas.measure()
    scheduleGrid()
  })
  resizeObserver.observe(rootRef.value)
  rootRef.value.addEventListener('wheel', boundWheel, { passive: false })
  window.addEventListener('pointerup', boundWindowPointerUp)
  window.addEventListener('pointercancel', boundWindowPointerCancel)
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  rootRef.value?.removeEventListener('wheel', boundWheel)
  window.removeEventListener('pointerup', boundWindowPointerUp)
  window.removeEventListener('pointercancel', boundWindowPointerCancel)
  window.removeEventListener('keydown', onKeyDown)
  window.removeEventListener('keyup', onKeyUp)
  if (gridFrame) cancelAnimationFrame(gridFrame)
})

defineExpose({ rootRef })
</script>

<template>
  <div
    ref="rootRef"
    class="model-canvas"
    :class="{
      'cursor-grab': canvas.spacePressed || canvas.mode === 'pan',
      'cursor-selecting': canvas.mode === 'select',
      'cursor-connecting': canvas.mode === 'connect',
    }"
    @pointerdown="onRootPointerDown"
    @pointermove="canvas.onPointerMove($event)"
    @pointerup="canvas.onPointerUp($event)"
    @pointercancel="canvas.onPointerUp($event)"
    @contextmenu="onRootContextMenu"
  >
    <canvas ref="gridRef" class="grid-layer" />

    <div ref="worldRef" class="world-layer" :style="canvas.worldStyle">
      <NavigateEdge
        v-for="nav in visibleNavigates"
        :key="nav.id"
        :navigate="nav"
        :route-through-mapping="
          nav.type === 'NN' && !canvas.hiddenTableIds.includes(nav.mappingTable)
        "
      />
      <ConnectionDraft />
      <TableCard v-for="id in visibleCards" :key="id" :table-id="id" />
    </div>

    <!-- 框选矩形（屏幕坐标层） -->
    <div
      v-if="canvas.selectDraft && canvas.mode === 'select'"
      class="selection-rect"
      :style="{
        left: `${Math.min(canvas.selectDraft.x0, canvas.selectDraft.x1)}px`,
        top: `${Math.min(canvas.selectDraft.y0, canvas.selectDraft.y1)}px`,
        width: `${Math.abs(canvas.selectDraft.x1 - canvas.selectDraft.x0)}px`,
        height: `${Math.abs(canvas.selectDraft.y1 - canvas.selectDraft.y0)}px`,
      }"
    />

    <Minimap />
    <CanvasContextMenu />

    <!-- 状态栏 -->
    <div class="canvas-status">
      <span class="status-item">缩放 {{ canvas.zoomPercent }}%</span>
      <span class="status-item">{{ canvas.visibleTableIds.length }} 张表</span>
      <span class="status-item">{{ model.navigates.length }} 条导航</span>
      <span v-if="canvas.selectedIds.length" class="status-item"
        >已选 {{ canvas.selectedIds.length }} 张</span
      >
      <span class="status-hint">左键拖框选 · 中键/空格拖拽平移 · 滚轮缩放</span>
    </div>

    <div v-if="model.loaded && !model.tables.length" class="empty-state">
      <p>画布为空</p>
      <p class="text-tertiary">右键新建表，或从左侧大纲 / 数据库导入</p>
    </div>
    <div v-if="model.loading" class="loading-state"><a-spin /></div>
  </div>
</template>

<style lang="scss" scoped>
.model-canvas {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: var(--canvas-bg);
  touch-action: none;
  user-select: none;

  &.cursor-grab {
    cursor: grab;
  }
  &.cursor-grab:active {
    cursor: grabbing;
  }
  &.cursor-selecting {
    cursor: crosshair;
  }
  &.cursor-connecting {
    cursor: crosshair;
  }
}

.grid-layer {
  position: absolute;
  inset: 0;
  z-index: 0;
}

.world-layer {
  position: absolute;
  left: 0;
  top: 0;
  width: 1px;
  height: 1px;
  overflow: visible;
  z-index: 1;
}

.selection-rect {
  position: absolute;
  z-index: 5;
  border: 1px solid var(--primary);
  background: var(--primary-weak);
  pointer-events: none;
}

.canvas-status {
  position: absolute;
  left: 12px;
  bottom: 10px;
  z-index: 6;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 4px 10px;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: var(--radius-m);
  box-shadow: var(--card-shadow);
  font-size: 11px;
  color: var(--text-2);
  pointer-events: none;

  .status-item {
    color: var(--text-2);
  }
  .status-hint {
    color: var(--text-3);
    border-left: 1px solid var(--border);
    padding-left: 10px;
  }
}

.empty-state {
  position: absolute;
  inset: 0;
  z-index: 4;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: var(--text-2);
  pointer-events: none;
  font-size: 14px;
}

.loading-state {
  position: absolute;
  inset: 0;
  z-index: 7;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--mask);
}
</style>
