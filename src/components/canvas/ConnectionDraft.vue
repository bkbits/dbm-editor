<script setup lang="ts">
import { computed } from 'vue'
import { useCanvasStore } from '@/stores/canvas'
import { useModelStore } from '@/stores/model'
import { anchorOf, bezierPath, chooseSides, type Side } from '@/utils/geometry'

const canvas = useCanvasStore()
const model = useModelStore()

const draft = computed(() => canvas.connectDraft)

function rectOfTable(tableId: string) {
  const t = model.tableById(tableId)
  if (!t) return null
  const size = canvas.cardSizes[tableId] || { w: 268, h: 120 }
  return { x: t.x ?? 0, y: t.y ?? 0, w: size.w, h: size.h }
}

const path = computed(() => {
  const d = draft.value
  if (!d) return ''
  const rect = rectOfTable(d.fromTableId)
  if (!rect) return ''
  const other = rectOfTable(d.hoverTableId || '')
  const side = d.fromSide as Side
  if (other && d.hoverTableId) {
    const [s, t] = chooseSides(rect, other)
    return bezierPath(anchorOf(rect, s), s, anchorOf(other, t), t)
  }
  // 自由拖拽：从连接点指向鼠标
  const a = anchorOf(rect, side)
  const dx = d.world.x - (rect.x + rect.w / 2)
  const dy = d.world.y - (rect.y + rect.h / 2)
  const side2: Side = Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? 'w' : 'e') : dy >= 0 ? 'n' : 's'
  return bezierPath(a, side, d.world, side2)
})
</script>

<template>
  <svg v-if="draft" class="connect-draft">
    <path class="draft-line" :d="path" />
    <circle class="draft-end" :cx="draft.world.x" :cy="draft.world.y" r="5" />
  </svg>
</template>

<style lang="scss" scoped>
.connect-draft {
  position: absolute;
  left: 0;
  top: 0;
  width: 1px;
  height: 1px;
  overflow: visible;
  pointer-events: none;
  z-index: 10;

  .draft-line {
    fill: none;
    stroke: var(--primary);
    stroke-width: 2;
    stroke-dasharray: 6 5;
    vector-effect: non-scaling-stroke;
    opacity: 0.85;
  }

  .draft-end {
    fill: var(--primary);
    stroke: var(--bg-panel);
    stroke-width: 2;
    vector-effect: non-scaling-stroke;
  }
}
</style>
