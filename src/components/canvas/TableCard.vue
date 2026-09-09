<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { Key, CircleCheck, CircleX, Plus, Link2, ChevronDown, EyeOff, ArrowDown, GitBranch } from '@lucide/vue'
import { useCanvasStore } from '@/stores/canvas'
import { useModelStore } from '@/stores/model'
import { useUiStore } from '@/stores/ui'
import { useDictStore } from '@/stores/dict'
import { CARD_WIDTH, type Side } from '@/utils/geometry'
import { NAVIGATE_TYPE_LABEL } from '@/utils/navigate'

const props = defineProps<{ tableId: string }>()

const canvas = useCanvasStore()
const model = useModelStore()
const ui = useUiStore()
const dictStore = useDictStore()

const elRef = ref<HTMLElement>()

const table = computed(() => model.tableById(props.tableId))
const columns = computed(() => model.columnsOf(props.tableId))
const indexes = computed(() => model.indexesOf(props.tableId))
const isMapping = computed(() => model.isMappingTable(props.tableId))
const isHidden = computed(() => canvas.hiddenTableIds.includes(props.tableId))

const COLLAPSE_COUNT = 6
const expanded = computed(() => canvas.isExpanded(props.tableId))
const shownColumns = computed(() => (expanded.value ? columns.value : columns.value.slice(0, COLLAPSE_COUNT)))

const showIndexes = computed(() => canvas.showIndexes(props.tableId))

const isSelected = computed(() => canvas.selectedIds.includes(props.tableId))
const isHovered = computed(() => canvas.hoveredTableId === props.tableId)
const isConnectTarget = computed(
  () => canvas.connectDraft?.hoverTableId === props.tableId && canvas.connectDraft.fromTableId !== props.tableId,
)

const catColor = computed(() => {
  const idx = model.categories.findIndex((c) => c.id === table.value?.categoryId)
  return `var(--cat-${Math.max(0, idx) % 8})`
})

/** 隐藏导航摘要：对端表被隐藏的导航 */
const hiddenNavs = computed(() => {
  return model
    .navigatesOf(props.tableId)
    .map((n) => {
      const otherId = n.self === props.tableId ? n.target : n.self
      if (!canvas.hiddenTableIds.includes(otherId)) return null
      const other = model.tableById(otherId)
      // 视角类型：若本表是 target，则类型翻转
      const viewType = n.self === props.tableId ? n.type : n.type === '1N' ? 'N1' : n.type === 'N1' ? '1N' : n.type
      return {
        id: n.id,
        label: NAVIGATE_TYPE_LABEL[viewType],
        otherName: other?.tableName ?? '?',
        otherId,
      }
    })
    .filter(Boolean) as Array<{ id: string; label: string; otherName: string; otherId: string }>
})

function dictOf(dictKey: string) {
  return dictStore.dicts.find((d) => d.dictKey === dictKey)
}

function onPointerDown(e: PointerEvent) {
  if (e.button !== 0) return
  canvas.closeMenu()
  canvas.beginCardDrag(props.tableId, e)
}
function onDblClick() {
  ui.openTableEdit(props.tableId)
}
function onContext(e: MouseEvent) {
  const local = canvas.localPoint(e)
  canvas.openMenu({
    kind: 'card',
    x: local.x,
    y: local.y,
    world: canvas.screenToWorld(local),
    tableId: props.tableId,
  })
}
function onConnectorDown(e: PointerEvent, side: Side) {
  if (e.button !== 0) return
  canvas.closeMenu()
  canvas.startConnect(props.tableId, side, e)
}
/** 隐藏本表（不删除数据，仅从画布视图移除；可在左侧大纲重新显示） */
function onHide(e: MouseEvent) {
  canvas.hideTable(props.tableId)
  e.stopPropagation()
}

const SIDES: Array<{ side: Side; cls: string }> = [
  { side: 'n', cls: 'conn-n' },
  { side: 'e', cls: 'conn-e' },
  { side: 's', cls: 'conn-s' },
  { side: 'w', cls: 'conn-w' },
]

/* 卡片尺寸上报（连线锚点计算用） */
let ro: ResizeObserver | null = null
onMounted(() => {
  if (elRef.value) {
    ro = new ResizeObserver(() => {
      if (elRef.value) {
        canvas.setCardSize(props.tableId, elRef.value.offsetWidth, elRef.value.offsetHeight)
      }
    })
    ro.observe(elRef.value)
    canvas.setCardSize(props.tableId, elRef.value.offsetWidth, elRef.value.offsetHeight)
  }
})
onBeforeUnmount(() => {
  ro?.disconnect()
  // 卡片可能因隐藏/删除/视口裁剪而卸载：若卸载时仍处于悬停态，mouseleave 不一定触发，
  // 需主动清理，否则 hoveredTableId 残留会让关联导航线一直保持联动高亮
  if (canvas.hoveredTableId === props.tableId) canvas.setHoveredTable('')
})
</script>

<template>
  <div
    v-if="table"
    ref="elRef"
    class="table-card"
    :class="{ selected: isSelected, hovered: isHovered, 'connect-target': isConnectTarget, mapping: isMapping, 'layout-animating': canvas.layoutAnimating }"
    :data-table-id="tableId"
    :style="{ left: `${table.x ?? 0}px`, top: `${table.y ?? 0}px`, width: `${CARD_WIDTH}px`, '--cat-color': catColor }"
    @pointerdown.stop="onPointerDown"
    @dblclick.stop="onDblClick"
    @contextmenu.stop.prevent="onContext"
    @mouseenter="canvas.setHoveredTable(tableId)"
    @mouseleave="canvas.setHoveredTable('')"
  >
    <!-- 四向连接点（拖拽创建导航） -->
    <div
      v-for="s in SIDES"
      :key="s.cls"
      :class="['connector', s.cls]"
      :title="`拖拽到目标表创建导航（${s.side.toUpperCase()}）`"
      @pointerdown.stop="onConnectorDown($event, s.side)"
    >
      <Plus :size="10" :stroke-width="2.5" />
    </div>

    <!-- 表头 -->
    <div class="card-head">
      <div class="head-row">
        <span class="head-name mono">{{ table.tableName }}</span>
        <GitBranch
          v-if="table.parentIdColumn"
          :size="12"
          class="head-tree"
          :title="`树形表（父ID字段：${table.parentIdColumn}）`"
        />
        <Link2 v-if="isMapping" :size="12" class="head-mapping" title="中间映射表" />
        <EyeOff v-if="isHidden" :size="12" class="head-hidden" title="已隐藏（仅此提示）" />
        <button
          class="head-hide-btn"
          type="button"
          title="在画布中隐藏此表（可在大纲中恢复）"
          @pointerdown.stop
          @click.stop="onHide"
        >
          <EyeOff :size="12" />
        </button>
      </div>
      <div v-if="table.comment" class="head-comment" :title="table.comment">{{ table.comment }}</div>
    </div>

    <!-- 字段列表（默认折叠为 6 个） -->
    <div class="card-columns">
      <div v-for="col in shownColumns" :key="col.id" class="col-row" :class="{ pk: col.primaryKey }">
        <span class="col-icons">
          <Key v-if="col.primaryKey" :size="11" class="icon-pk" title="主键" />
          <CircleCheck v-if="!col.notNull" :size="11" class="icon-null" title="可空" />
          <CircleX v-else :size="11" class="icon-notnull" title="非空" />
        </span>
        <span class="col-name mono" :title="col.columnName">{{ col.columnName }}</span>
        <span class="col-type mono">{{ col.type }}</span>
        <span v-if="col.dict" class="col-dict" :title="`字典: ${col.dict}`">{{ col.dict }}</span>
        <span v-if="col.comment" class="col-comment" :title="col.comment">{{ col.comment }}</span>
      </div>
      <div
        v-if="columns.length > COLLAPSE_COUNT || expanded"
        class="cols-toggle"
        @pointerdown.stop
        @click="canvas.toggleExpand(tableId)"
      >
        <template v-if="!expanded">展开其余 {{ columns.length - COLLAPSE_COUNT }} 个字段</template>
        <template v-else>收起字段</template>
        <ChevronDown :size="12" :class="{ flip: expanded }" />
      </div>
      <div v-if="!columns.length" class="cols-empty">暂无字段</div>
    </div>

    <!-- 索引区（默认隐藏） -->
    <div class="card-indexes-toggle" @pointerdown.stop @click="canvas.toggleShowIndexes(tableId)">
      <span>索引（{{ indexes.length }}）</span>
      <ChevronDown :size="12" :class="{ flip: showIndexes }" />
    </div>
    <div v-if="showIndexes" class="card-indexes">
      <div v-for="idx in indexes" :key="idx.id" class="idx-row">
        <span class="idx-type" :class="idx.type.toLowerCase()">{{ idx.type }}</span>
        <span class="idx-name mono" :title="idx.columns.join(', ')">{{ idx.indexName }}</span>
        <span class="idx-cols mono" :title="idx.columns.join(', ')">{{ idx.columns.join(', ') }}</span>
      </div>
      <div v-if="!indexes.length" class="idx-empty">暂无索引</div>
    </div>

    <!-- 隐藏导航摘要 -->
    <div v-if="hiddenNavs.length" class="card-hidden-navs">
      <div class="hidden-navs-title">
        <EyeOff :size="10" />
        <span>隐藏导航（{{ hiddenNavs.length }}）</span>
      </div>
      <div v-for="h in hiddenNavs" :key="h.id" class="hidden-nav-row">
        <span class="nav-type">{{ h.label }}</span>
        <span class="nav-target mono" :title="`点击定位到 ${h.otherName}`" @pointerdown.stop @click="canvas.showTable(h.otherId); canvas.centerOnTable(h.otherId)">{{ h.otherName }}</span>
      </div>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.table-card {
  position: absolute;
  background: var(--card-bg);
  border: 1.5px solid var(--card-border);
  border-radius: var(--radius-m);
  box-shadow: var(--card-shadow);
  font-size: 12px;
  z-index: 2;
  transition: box-shadow 0.18s ease, border-color 0.18s ease;

  /* 自动美化/对齐后的位置过渡：left/top 平滑滑动到新坐标 */
  &.layout-animating {
    transition:
      box-shadow 0.18s ease,
      border-color 0.18s ease,
      left 0.46s cubic-bezier(0.22, 0.61, 0.36, 1),
      top 0.46s cubic-bezier(0.22, 0.61, 0.36, 1);
  }

  &:hover {
    box-shadow: var(--card-shadow-hover);
  }

  &.selected {
    border-color: var(--card-border-selected);
    box-shadow: 0 0 0 3px var(--primary-weak), var(--card-shadow-hover);
  }

  &.connect-target {
    border-color: var(--primary);
    box-shadow: 0 0 0 4px var(--primary-weak);
  }

  &.mapping .card-head {
    .head-mapping {
      color: var(--cat-color);
    }
  }
}

/* 连接点：常驻渲染，默认透明缩小且不拦截事件；卡片悬停/选中时淡入放大
   （用 opacity + scale 过渡代替 display 切换；translate/scale 独立属性避免与定位变换冲突） */
.connector {
  position: absolute;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--bg-panel);
  border: 1.5px solid var(--card-conn);
  color: var(--text-3);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: crosshair;
  z-index: 3;
  opacity: 0;
  scale: 0.55;
  pointer-events: none;
  transition: opacity 0.16s ease, scale 0.16s ease, background-color 0.12s ease,
    border-color 0.12s ease, color 0.12s ease;

  &:hover {
    background: var(--primary);
    border-color: var(--primary);
    color: #fff;
  }
}

.table-card:hover .connector,
.table-card.selected .connector {
  opacity: 1;
  scale: 1;
  pointer-events: auto;
}

/* 隐藏按钮：卡片悬停时淡入（与连接点同规则；常驻占位保持表头布局稳定） */
.table-card:hover .head-hide-btn {
  opacity: 1;
  pointer-events: auto;
}

.conn-n {
  left: 50%;
  top: -8px;
  translate: -50% 0;
}
.conn-s {
  left: 50%;
  bottom: -8px;
  translate: -50% 0;
}
.conn-e {
  top: 50%;
  right: -8px;
  translate: 0 -50%;
}
.conn-w {
  top: 50%;
  left: -8px;
  translate: 0 -50%;
}

/* 表头 */
.card-head {
  padding: 7px 10px 6px;
  background: var(--card-head-bg);
  border-bottom: 1px solid var(--border);
  border-radius: var(--radius-m) var(--radius-m) 0 0;
  position: relative;
  overflow: hidden;

  &::before {
    content: '';
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    width: 3px;
    background: var(--cat-color);
  }

  .head-row {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .head-name {
    font-weight: 600;
    color: var(--card-head-text);
    font-size: 12.5px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
  }

  .head-mapping {
    color: var(--text-3);
    flex-shrink: 0;
  }
  .head-hidden {
    color: var(--text-3);
    flex-shrink: 0;
  }

  .head-tree {
    color: var(--success);
    flex-shrink: 0;
  }

  /* 隐藏按钮：常驻占位但透明不可点，卡片悬停时淡入（悬停规则在顶层 .table-card:hover 中） */
  .head-hide-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    margin-left: auto;
    flex-shrink: 0;
    padding: 0;
    border: none;
    border-radius: 4px;
    background: transparent;
    color: var(--text-3);
    cursor: pointer;
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.16s ease, background-color 0.12s ease, color 0.12s ease;

    &:hover {
      background: var(--danger-weak);
      color: var(--danger);
    }
  }

  .head-comment {
    margin-top: 2px;
    font-size: 11px;
    color: var(--text-3);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}

/* 字段列表 */
.card-columns {
  padding: 2px 0;
}

.col-row {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 2.5px 10px;
  min-height: 22px;
  transition: background-color 0.12s ease;

  &:hover {
    background: var(--card-row-hover);
  }

  &.pk .col-name {
    color: var(--text-1);
    font-weight: 600;
  }

  .col-icons {
    display: inline-flex;
    gap: 2px;
    flex-shrink: 0;
    width: 26px;

    .icon-pk {
      color: var(--warning);
    }
    .icon-null {
      color: var(--success);
    }
    .icon-notnull {
      color: var(--text-3);
    }
  }

  .col-name {
    color: var(--text-1);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 45%;
  }

  .col-type {
    flex-shrink: 0;
    max-width: 80px;
    overflow: hidden;
    text-overflow: ellipsis;
    font-size: 10.5px;
    color: var(--primary-text);
    background: var(--primary-weak);
    border-radius: 3px;
    padding: 0 4px;
    line-height: 16px;
  }

  .col-dict {
    flex-shrink: 0;
    font-size: 10px;
    color: var(--info);
    background: var(--info-weak);
    border-radius: 3px;
    padding: 0 4px;
    line-height: 16px;
    max-width: 70px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .col-comment {
    color: var(--text-3);
    font-size: 10.5px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
    min-width: 0;
    text-align: right;
  }
}

.cols-toggle,
.card-indexes-toggle {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 3px 0;
  margin: 1px 6px 3px;
  color: var(--text-3);
  font-size: 11px;
  cursor: pointer;
  border-radius: var(--radius-s);
  border: 1px dashed var(--border);
  transition: color 0.15s ease, border-color 0.15s ease, background-color 0.15s ease;

  &:hover {
    color: var(--primary-text);
    border-color: var(--primary);
    background: var(--primary-weak);
  }

  svg {
    transition: transform 0.15s ease;
    &.flip {
      transform: rotate(180deg);
    }
  }
}

.cols-empty,
.idx-empty {
  padding: 6px 0;
  text-align: center;
  color: var(--text-3);
  font-size: 11px;
}

.card-indexes {
  border-top: 1px dashed var(--border);
  padding: 3px 0 4px;
}

.idx-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 10px;

  .idx-type {
    flex-shrink: 0;
    font-size: 9.5px;
    border-radius: 3px;
    padding: 0 4px;
    line-height: 15px;

    &.unique {
      color: var(--warning);
      background: var(--warning-weak);
    }
    &.normal {
      color: var(--info);
      background: var(--info-weak);
    }
    &.fulltext {
      color: var(--primary-text);
      background: var(--primary-weak);
    }
  }

  .idx-name {
    font-size: 11px;
    color: var(--text-1);
    max-width: 40%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .idx-cols {
    font-size: 10px;
    color: var(--text-3);
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-align: right;
  }
}

/* 隐藏导航摘要 */
.card-hidden-navs {
  border-top: 1px dashed var(--border);
  background: var(--bg-2);
  border-radius: 0 0 var(--radius-m) var(--radius-m);
  padding: 4px 10px 5px;

  .hidden-navs-title {
    display: flex;
    align-items: center;
    gap: 4px;
    color: var(--text-3);
    font-size: 10.5px;
    margin-bottom: 2px;
  }

  .hidden-nav-row {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 11px;

    .nav-type {
      color: var(--info);
      background: var(--info-weak);
      border-radius: 3px;
      padding: 0 4px;
      line-height: 16px;
      flex-shrink: 0;
    }

    .nav-target {
      color: var(--primary-text);
      cursor: pointer;
      transition: color 0.12s ease;

      &:hover {
        text-decoration: underline;
      }
    }
  }
}
</style>
