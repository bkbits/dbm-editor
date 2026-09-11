<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useCanvasStore } from '@/stores/canvas'
import { useModelStore } from '@/stores/model'
import { useThemeStore } from '@/stores/theme'

const canvas = useCanvasStore()
const model = useModelStore()
const theme = useThemeStore()

const MAP_W = 200
const MAP_H = 140
const elRef = ref<HTMLCanvasElement>()

let frame = 0

function schedule() {
  if (frame) return
  frame = requestAnimationFrame(() => {
    frame = 0
    draw()
  })
}

function catColorOf(categoryId: string): string {
  return (
    getComputedStyle(document.documentElement)
      .getPropertyValue(
        `--cat-${model.categories.findIndex((c) => c.id === categoryId) % 8 >= 0 ? model.categories.findIndex((c) => c.id === categoryId) % 8 : 0}`,
      )
      .trim() || '#888'
  )
}

function draw() {
  const cv = elRef.value
  if (!cv) return
  const dpr = window.devicePixelRatio || 1
  if (cv.width !== MAP_W * dpr) {
    cv.width = MAP_W * dpr
    cv.height = MAP_H * dpr
    cv.style.width = `${MAP_W}px`
    cv.style.height = `${MAP_H}px`
  }
  const ctx = cv.getContext('2d')
  if (!ctx) return
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  const styles = getComputedStyle(document.documentElement)
  const bg = styles.getPropertyValue('--bg-panel').trim()
  const border = styles.getPropertyValue('--border').trim()
  ctx.clearRect(0, 0, MAP_W, MAP_H)
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, MAP_W, MAP_H)

  const ids = canvas.visibleTableIds
  if (!ids.length) return

  // 内容边界
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const id of ids) {
    const t = model.tableById(id)
    if (!t) continue
    const size = canvas.cardSizes[id] || { w: 268, h: 120 }
    minX = Math.min(minX, t.x ?? 0)
    minY = Math.min(minY, t.y ?? 0)
    maxX = Math.max(maxX, (t.x ?? 0) + size.w)
    maxY = Math.max(maxY, (t.y ?? 0) + size.h)
  }
  const pad = 30
  const bw = maxX - minX + pad * 2
  const bh = maxY - minY + pad * 2
  const scale = Math.min(MAP_W / bw, MAP_H / bh)
  const offX = (MAP_W - bw * scale) / 2 - (minX - pad) * scale
  const offY = (MAP_H - bh * scale) / 2 - (minY - pad) * scale

  // 表矩形（分类配色）
  for (const id of ids) {
    const t = model.tableById(id)
    if (!t) continue
    const size = canvas.cardSizes[id] || { w: 268, h: 120 }
    ctx.fillStyle = catColorOf(t.categoryId)
    ctx.globalAlpha = canvas.selectedIds.includes(id) ? 1 : 0.7
    ctx.fillRect(
      (t.x ?? 0) * scale + offX,
      (t.y ?? 0) * scale + offY,
      Math.max(2, size.w * scale),
      Math.max(2, size.h * scale),
    )
  }
  ctx.globalAlpha = 1

  // 视口矩形
  const vr = canvas.viewportWorldRect
  ctx.strokeStyle = styles.getPropertyValue('--primary').trim()
  ctx.lineWidth = 1.5
  ctx.strokeRect(vr.x * scale + offX, vr.y * scale + offY, vr.w * scale, vr.h * scale)
  ctx.fillStyle = 'rgba(13,148,136,0.08)'
  ctx.fillRect(vr.x * scale + offX, vr.y * scale + offY, vr.w * scale, vr.h * scale)

  ctx.strokeStyle = border
  ctx.lineWidth = 1
  ctx.strokeRect(0.5, 0.5, MAP_W - 1, MAP_H - 1)

  // 缓存换算供交互使用
  scaleInfo.scale = scale
  scaleInfo.offX = offX
  scaleInfo.offY = offY
}

const scaleInfo = { scale: 1, offX: 0, offY: 0 }

function mapToWorld(e: PointerEvent | MouseEvent) {
  const rect = elRef.value?.getBoundingClientRect()
  if (!rect) return null
  const mx = e.clientX - rect.left
  const my = e.clientY - rect.top
  return {
    x: (mx - scaleInfo.offX) / scaleInfo.scale,
    y: (my - scaleInfo.offY) / scaleInfo.scale,
  }
}

let dragging = false
function onPointerDown(e: PointerEvent) {
  dragging = true
  const w = mapToWorld(e)
  if (w) canvas.jumpTo(w.x, w.y)
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
}
function onPointerMove(e: PointerEvent) {
  if (!dragging) return
  const w = mapToWorld(e)
  if (w) canvas.jumpTo(w.x, w.y)
}
function onPointerUp() {
  dragging = false
}

watch(
  () => [
    model.tables,
    model.categories,
    canvas.hiddenTableIds,
    canvas.selectedIds,
    canvas.cardSizes,
    canvas.zoom,
    canvas.panX,
    canvas.panY,
    canvas.viewportW,
    canvas.viewportH,
    theme.theme,
  ],
  schedule,
  { deep: true, immediate: true },
)

onMounted(schedule)
onBeforeUnmount(() => {
  if (frame) cancelAnimationFrame(frame)
})
</script>

<template>
  <div class="minimap" title="小地图：点击/拖拽快速定位">
    <canvas
      ref="elRef"
      @pointerdown.stop.prevent="onPointerDown"
      @pointermove.stop="onPointerMove"
      @pointerup.stop="onPointerUp"
      @pointercancel="onPointerUp"
    />
  </div>
</template>

<style lang="scss" scoped>
.minimap {
  position: absolute;
  right: 14px;
  bottom: 14px;
  z-index: 6;
  border-radius: var(--radius-m);
  overflow: hidden;
  border: 1px solid var(--border);
  box-shadow: var(--card-shadow);
  background: var(--bg-panel);

  canvas {
    display: block;
    cursor: crosshair;
  }
}
</style>
