<script setup lang="ts">
import { computed } from 'vue'
import type { TableNavigate } from '@/types/model'
import { useCanvasStore } from '@/stores/canvas'
import { useModelStore } from '@/stores/model'
import { useUiStore } from '@/stores/ui'
import { NAVIGATE_TYPE_LABEL } from '@/utils/navigate'
import {
  anchorOf,
  bezierPath,
  chooseSides,
  pointOnBezier,
  rectCenter,
  selfLoopPath,
  type Point,
  type Rect,
  type Side,
} from '@/utils/geometry'

const props = defineProps<{
  navigate: TableNavigate
  /** NN 且中间表可见时：连线经由中间表 */
  routeThroughMapping: boolean
}>()

const canvas = useCanvasStore()
const model = useModelStore()
const ui = useUiStore()

const nav = computed(() => props.navigate)

function rectOfTable(tableId: string): Rect | null {
  const t = model.tableById(tableId)
  if (!t) return null
  const size = canvas.cardSizes[tableId] || { w: 268, h: 120 }
  return { x: t.x ?? 0, y: t.y ?? 0, w: size.w, h: size.h }
}

/** 命中/连线几何 */
const geo = computed(() => {
  const selfRect = rectOfTable(nav.value.self)
  const targetRect = rectOfTable(nav.value.target)
  if (!selfRect || !targetRect) return null

  if (nav.value.self === nav.value.target) {
    const loop = selfLoopPath(selfRect)
    return {
      d: loop.d,
      selfAnchor: anchorOf(selfRect, 'n'),
      targetAnchor: anchorOf(selfRect, 'e'),
      selfDir: { x: 1, y: -1 },
      targetDir: { x: 1, y: -1 },
      mid: loop.mid,
    }
  }

  if (props.routeThroughMapping && nav.value.mappingTable) {
    const mapRect = rectOfTable(nav.value.mappingTable)
    if (mapRect) {
      const [sSide, mSide1] = chooseSides(selfRect, mapRect)
      const [mSide2, tSide] = chooseSides(mapRect, targetRect)
      const a = anchorOf(selfRect, sSide)
      const m1 = anchorOf(mapRect, mSide1)
      const m2 = anchorOf(mapRect, mSide2)
      const b = anchorOf(targetRect, tSide)
      const d = `${bezierPath(a, sSide, m1, mSide1)} ${bezierPath(m2, mSide2, b, tSide)}`
      return {
        d,
        selfAnchor: a,
        targetAnchor: b,
        selfDir: dirBetween(rectCenter(selfRect), rectCenter(mapRect)),
        targetDir: dirBetween(rectCenter(targetRect), rectCenter(mapRect)),
        mid: pointOnBezier(a, sSide, m1, mSide1, 0.5),
      }
    }
  }

  const [sSide, tSide] = chooseSides(selfRect, targetRect)
  const a = anchorOf(selfRect, sSide)
  const b = anchorOf(targetRect, tSide)
  return {
    d: bezierPath(a, sSide, b, tSide),
    selfAnchor: a,
    targetAnchor: b,
    selfDir: dirBetween(a, b),
    targetDir: dirBetween(b, a),
    mid: pointOnBezier(a, sSide, b, tSide, 0.5),
  }
})

function dirBetween(a: Point, b: Point): { x: number; y: number } {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = Math.hypot(dx, dy) || 1
  return { x: dx / len, y: dy / len }
}

/** 端点基数标记：type 字符即 self/target 两侧的 '1'/'N' */
const selfMark = computed(() => (nav.value.type[0] === '1' ? '1' : 'N'))
const targetMark = computed(() => (nav.value.type[1] === '1' ? '1' : 'N'))

const markOffset = 26
const selfMarkPos = computed(() => {
  const g = geo.value
  if (!g) return { x: 0, y: 0 }
  return { x: g.selfAnchor.x + g.selfDir.x * markOffset, y: g.selfAnchor.y + g.selfDir.y * markOffset }
})
const targetMarkPos = computed(() => {
  const g = geo.value
  if (!g) return { x: 0, y: 0 }
  return { x: g.targetAnchor.x + g.targetDir.x * markOffset, y: g.targetAnchor.y + g.targetDir.y * markOffset }
})

/** NN 中间表胶囊（中间表隐藏时：-N--中间表名+--N-） */
const pill = computed(() => {
  if (nav.value.type !== 'NN' || !nav.value.mappingTable || props.routeThroughMapping) return null
  const t = model.tableById(nav.value.mappingTable)
  if (!t || !geo.value) return null
  const label = t.tableName
  const w = label.length * 7.2 + 34
  return {
    x: geo.value.mid.x - w / 2,
    y: geo.value.mid.y - 11,
    w,
    h: 22,
    label,
    tableId: nav.value.mappingTable,
  }
})

const selfTable = computed(() => model.tableById(nav.value.self))
const targetTable = computed(() => model.tableById(nav.value.target))
const typeLabel = computed(() => NAVIGATE_TYPE_LABEL[nav.value.type])

const tipText = computed(() => {
  const s = selfTable.value?.tableName ?? '?'
  const t = targetTable.value?.tableName ?? '?'
  return `${s} -${selfMark.value}----${targetMark.value}- ${t}（${typeLabel.value}）`
})
const tipSub = computed(() => {
  const a = nav.value.selfPropertyName
  const b = nav.value.targetPropertyName
  return `${a} ⇄ ${b}`
})

const isHovered = computed(() => canvas.hoveredNavigateId === nav.value.id)
const isSelected = computed(() => canvas.selectedNavigateId === nav.value.id)
/** 悬停卡片时，其关联线段联动高亮 */
const isRelated = computed(() => {
  const h = canvas.hoveredTableId
  return Boolean(h) && (h === nav.value.self || h === nav.value.target)
})

const tipWidth = computed(() => Math.max(tipText.value.length, tipSub.value.length) * 7.4 + 20)

function onEnter() {
  canvas.setHoveredNavigate(nav.value.id)
}
function onLeave() {
  canvas.setHoveredNavigate('')
}
function onClick() {
  canvas.setSelectedNavigate(nav.value.id)
}
function onDblClick() {
  ui.openNavigateEdit(nav.value.id)
}
function onContext(e: MouseEvent) {
  const local = canvas.localPoint(e)
  canvas.openMenu({
    kind: 'edge',
    x: local.x,
    y: local.y,
    world: canvas.screenToWorld(local),
    navigateId: nav.value.id,
  })
}
function showMappingTable() {
  if (nav.value.mappingTable) canvas.showTable(nav.value.mappingTable)
}
</script>

<template>
  <svg class="edge-root">
    <g
      v-if="geo"
      class="edge"
      :class="{ hovered: isHovered, selected: isSelected, related: isRelated }"
      :data-navigate-id="nav.id"
      @pointerenter.stop="onEnter"
      @pointerleave.stop="onLeave"
      @click.stop="onClick"
      @dblclick.stop="onDblClick"
      @contextmenu.stop.prevent="onContext"
    >
      <!-- 命中区（更宽的透明描边） -->
      <path class="edge-hit" :d="geo.d" />
      <!-- 主线 -->
      <path class="edge-line" :d="geo.d" />
      <!-- 端点基数标记 -->
      <g class="edge-mark">
        <rect :x="selfMarkPos.x - 8" :y="selfMarkPos.y - 9" width="16" height="18" rx="4" />
        <text :x="selfMarkPos.x" :y="selfMarkPos.y + 5" text-anchor="middle">{{ selfMark }}</text>
      </g>
      <g class="edge-mark">
        <rect :x="targetMarkPos.x - 8" :y="targetMarkPos.y - 9" width="16" height="18" rx="4" />
        <text :x="targetMarkPos.x" :y="targetMarkPos.y + 5" text-anchor="middle">{{ targetMark }}</text>
      </g>

      <!-- NN 中间表胶囊：中间表名 + 展开按钮 -->
      <g v-if="pill" class="nn-pill" @click.stop="showMappingTable">
        <rect :x="pill.x" :y="pill.y" :width="pill.w" :height="pill.h" rx="11" />
        <text class="pill-label" :x="pill.x + 12" :y="pill.y + 15">{{ pill.label }}</text>
        <circle class="pill-plus-bg" :cx="pill.x + pill.w - 12" :cy="pill.y + pill.h / 2" r="7.5" />
        <path
          class="pill-plus"
          :d="`M ${pill.x + pill.w - 15.5} ${pill.y + pill.h / 2} L ${pill.x + pill.w - 8.5} ${pill.y + pill.h / 2} M ${pill.x + pill.w - 12} ${pill.y + pill.h / 2 - 3.5} L ${pill.x + pill.w - 12} ${pill.y + pill.h / 2 + 3.5}`"
        />
      </g>

      <!-- 悬停信息提示 -->
      <g v-if="isHovered || isSelected" class="edge-tip">
        <rect :x="geo.mid.x - tipWidth / 2" :y="geo.mid.y - 46" :width="tipWidth" height="38" rx="6" />
        <text class="tip-main" :x="geo.mid.x" :y="geo.mid.y - 31" text-anchor="middle">{{ tipText }}</text>
        <text class="tip-sub" :x="geo.mid.x" :y="geo.mid.y - 15" text-anchor="middle">{{ tipSub }}</text>
      </g>
    </g>
  </svg>
</template>

<style lang="scss" scoped>
.edge-root {
  position: absolute;
  left: 0;
  top: 0;
  width: 1px;
  height: 1px;
  overflow: visible;
  pointer-events: none;
}

.edge {
  pointer-events: none;

  .edge-hit {
    fill: none;
    stroke: transparent;
    stroke-width: 16;
    pointer-events: stroke;
    vector-effect: non-scaling-stroke;
    cursor: pointer;
  }

  .edge-line {
    fill: none;
    stroke: var(--edge);
    stroke-width: 2;
    vector-effect: non-scaling-stroke;
    pointer-events: none;
    transition: stroke 0.15s ease;
  }

  .edge-mark {
    pointer-events: none;
    rect {
      fill: var(--edge-label-bg);
      stroke: var(--edge-pill-border);
      stroke-width: 1;
      vector-effect: non-scaling-stroke;
    }
    text {
      font-size: 11px;
      font-family: var(--font-mono);
      fill: var(--edge-label-text);
      font-weight: 600;
    }
  }

  .nn-pill {
    cursor: pointer;
    rect {
      fill: var(--edge-pill-bg);
      stroke: var(--edge-pill-border);
      stroke-width: 1;
      vector-effect: non-scaling-stroke;
    }
    .pill-label {
      font-size: 11px;
      font-family: var(--font-mono);
      fill: var(--edge-label-text);
    }
    .pill-plus-bg {
      fill: var(--primary-weak);
      stroke: none;
    }
    .pill-plus {
      stroke: var(--primary-text);
      stroke-width: 1.6;
      vector-effect: non-scaling-stroke;
    }
    &:hover {
      rect {
        stroke: var(--primary);
      }
      .pill-label {
        fill: var(--primary-text);
      }
    }
  }

  .edge-tip {
    pointer-events: none;
    rect {
      fill: var(--bg-panel);
      stroke: var(--border-strong);
      stroke-width: 1;
      vector-effect: non-scaling-stroke;
      filter: drop-shadow(0 2px 6px rgba(0, 0, 0, 0.12));
    }
    .tip-main {
      font-size: 11px;
      fill: var(--text-1);
    }
    .tip-sub {
      font-size: 10.5px;
      fill: var(--text-3);
      font-family: var(--font-mono);
    }
  }

  &.hovered,
  &.related {
    .edge-line {
      stroke: var(--edge-hover);
      stroke-width: 2.6;
    }
    .edge-mark text {
      fill: var(--primary-text);
    }
  }

  &.selected {
    .edge-line {
      stroke: var(--primary);
      stroke-width: 3;
      stroke-dasharray: 7 4;
    }
    .edge-mark rect {
      stroke: var(--primary);
    }
    .edge-mark text {
      fill: var(--primary-text);
    }
  }
}
</style>
