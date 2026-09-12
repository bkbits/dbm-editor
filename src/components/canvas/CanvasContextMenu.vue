<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { Modal } from 'antdv-next'
import {
  Pencil,
  Trash2,
  Plus,
  ClipboardPaste,
  EyeOff,
  Eye,
  Copy,
  Maximize2,
  RotateCcw,
  WandSparkles,
  AlignStartHorizontal,
  AlignCenterHorizontal,
  AlignEndHorizontal,
  AlignStartVertical,
  AlignCenterVertical,
  AlignEndVertical,
  AlignHorizontalDistributeCenter,
  AlignVerticalDistributeCenter,
} from '@lucide/vue'
import type { FunctionalComponent } from 'vue'
import { useCanvasStore, type AlignMode } from '@/stores/canvas'
import { useModelStore } from '@/stores/model'
import { useUiStore } from '@/stores/ui'
import { message } from 'antdv-next'

interface MenuItem {
  key: string
  label: string
  icon: FunctionalComponent | null
  danger: boolean
  disabled?: boolean
  /** 分组小标题（不可点击） */
  header?: boolean
  /** 分割线（不可点击） */
  divider?: boolean
  /** 悬停提示（如不可用原因） */
  title?: string
  run: () => void
}

const canvas = useCanvasStore()
const model = useModelStore()
const ui = useUiStore()

const rootRef = ref<HTMLElement>()

const menu = computed(() => canvas.menu)
const visible = computed(() => Boolean(menu.value))

const menuWidth = 178

/** 菜单内容项高度估算（用于菜单位置的垂直裁剪） */
const menuHeight = computed(() => {
  let h = 10
  for (const it of items.value) {
    if (it.divider) h += 7
    else if (it.header) h += 22
    else h += 29
  }
  return h
})

/** 菜单位置（画布内裁剪） */
const posStyle = computed(() => {
  if (!menu.value) return {}
  const x = Math.min(menu.value.x, Math.max(0, canvas.viewportW - menuWidth - 8))
  const y = Math.min(menu.value.y, Math.max(0, canvas.viewportH - menuHeight.value - 8))
  return { left: `${x}px`, top: `${y}px` }
})

function close() {
  canvas.closeMenu()
}

function withClose(fn: () => void) {
  return () => {
    close()
    fn()
  }
}

/* ==================== 各类菜单项 ==================== */

/** 对齐/分布菜单定义（选中 ≥ 2 张表时出现；均匀分布需 ≥ 3 张） */
const ALIGN_DEFS: Array<{ mode: AlignMode; label: string; icon: FunctionalComponent }> = [
  { mode: 'left', label: '左对齐', icon: AlignStartHorizontal },
  { mode: 'hcenter', label: '水平对齐', icon: AlignCenterHorizontal },
  { mode: 'right', label: '右对齐', icon: AlignEndHorizontal },
  { mode: 'top', label: '顶部对齐', icon: AlignStartVertical },
  { mode: 'vcenter', label: '垂直对齐', icon: AlignCenterVertical },
  { mode: 'bottom', label: '底部对齐', icon: AlignEndVertical },
  { mode: 'hdistribute', label: '水平均匀分布', icon: AlignHorizontalDistributeCenter },
  { mode: 'vdistribute', label: '垂直均匀分布', icon: AlignVerticalDistributeCenter },
]

function alignItemsSection(): MenuItem[] {
  const count = canvas.selectedIds.length
  if (count < 2) return []
  return [
    { key: 'align-div', label: '', icon: null, danger: false, divider: true, run: () => undefined },
    {
      key: 'align-head',
      label: '对齐与分布',
      icon: null,
      danger: false,
      header: true,
      run: () => undefined,
    },
    ...ALIGN_DEFS.map(({ mode, label, icon }) => {
      const isDistribute = mode === 'hdistribute' || mode === 'vdistribute'
      return {
        key: `align-${mode}`,
        label,
        icon,
        danger: false,
        disabled: isDistribute && count < 3,
        title:
          isDistribute && count < 3
            ? '均匀分布至少需要选中 3 张表'
            : `${label}已选中的 ${count} 张表`,
        run: withClose(() => canvas.alignSelection(mode)),
      }
    }),
  ]
}

const cardItems = computed<MenuItem[]>(() => {
  const id = menu.value?.tableId ?? ''
  const t = model.tableById(id)
  const hidden = canvas.hiddenTableIds.includes(id)
  return [
    {
      key: 'edit',
      label: '编辑表',
      icon: Pencil,
      danger: false,
      run: withClose(() => ui.openTableEdit(id)),
    },
    {
      key: 'copy',
      label: '复制表',
      icon: Copy,
      danger: false,
      run: withClose(() => {
        canvas.setSelection([id])
        const n = canvas.copySelection()
        if (n) message.success(`已复制 ${n} 张表，右键空白处可粘贴`)
      }),
    },
    {
      key: 'hide',
      label: hidden ? '在画布中显示' : '在画布中隐藏',
      icon: hidden ? Eye : EyeOff,
      danger: false,
      run: withClose(() => canvas.toggleHiddenTable(id)),
    },
    ...alignItemsSection(),
    {
      key: 'div',
      label: '',
      icon: null,
      danger: false,
      run: () => undefined,
      divider: true,
    },
    {
      key: 'remove',
      label: '删除表',
      icon: Trash2,
      danger: true,
      run: withClose(() => {
        const name = t?.tableName ?? ''
        Modal.confirm({
          title: `删除表「${name}」？`,
          content: '将同时删除其字段、索引及涉及的导航关系。可通过 Ctrl+Z 撤销。',
          okText: '删除',
          okType: 'danger',
          cancelText: '取消',
          onOk: async () => {
            await model.removeTables([id])
            canvas.setSelection([])
          },
        })
      }),
    },
  ]
})

const edgeItems = computed<MenuItem[]>(() => {
  const id = menu.value?.navigateId ?? ''
  const nav = model.navigates.find((n) => n.id === id)
  return [
    {
      key: 'edit',
      label: '编辑导航',
      icon: Pencil,
      danger: false,
      run: withClose(() => ui.openNavigateEdit(id)),
    },
    {
      key: 'div',
      label: '',
      icon: null,
      danger: false,
      run: () => undefined,
      divider: true,
    },
    {
      key: 'remove',
      label: '删除导航',
      icon: Trash2,
      danger: true,
      run: withClose(() => {
        Modal.confirm({
          title: '删除该导航关系？',
          content: nav
            ? `${model.tableById(nav.self)?.tableName} 与 ${model.tableById(nav.target)?.tableName} 之间的导航将被移除。`
            : '',
          okText: '删除',
          okType: 'danger',
          cancelText: '取消',
          onOk: () => model.removeNavigate(id),
        })
      }),
    },
  ]
})

const canvasItems = computed<MenuItem[]>(() => [
  {
    key: 'add',
    label: '新增表（此处）',
    icon: Plus,
    danger: false,
    run: withClose(() => {
      ui.openTableEdit(null, menu.value?.world ?? null)
    }),
  },
  {
    key: 'paste',
    label: canvas.hasClipboard() ? `粘贴（${canvas.clipboard.length} 张）` : '粘贴（无内容）',
    icon: ClipboardPaste,
    danger: false,
    disabled: !canvas.hasClipboard(),
    run: withClose(() => {
      const w = menu.value?.world
      if (w) canvas.pasteAt(w)
    }),
  },
  {
    key: 'div',
    label: '',
    icon: null,
    danger: false,
    run: () => undefined,
    divider: true,
  },
  {
    key: 'auto-layout',
    label: '自动美化布局',
    icon: WandSparkles,
    danger: false,
    run: withClose(() => canvas.autoLayout()),
  },
  {
    key: 'fit',
    label: '适应画布',
    icon: Maximize2,
    danger: false,
    run: withClose(() => canvas.fitAll()),
  },
  {
    key: 'reset',
    label: '重置缩放',
    icon: RotateCcw,
    danger: false,
    run: withClose(() => canvas.resetZoom()),
  },
  ...alignItemsSection(),
])

const items = computed(() => {
  if (!menu.value) return []
  if (menu.value.kind === 'card') return cardItems.value
  if (menu.value.kind === 'edge') return edgeItems.value
  return canvasItems.value
})

/* 点击外部关闭 */
function onWindowPointerDown(e: PointerEvent) {
  if (!visible.value) return
  const target = e.target as HTMLElement
  if (rootRef.value?.contains(target)) return
  close()
}

onMounted(() => {
  window.addEventListener('pointerdown', onWindowPointerDown, true)
})
onBeforeUnmount(() => {
  window.removeEventListener('pointerdown', onWindowPointerDown, true)
})
</script>

<template>
  <!--
    ⚠ @pointerdown.stop：阻止冒泡到画布根元素。
    否则点击菜单项时，画布根的 onRootPointerDown 会先执行 closeMenu()，
    菜单被 v-if 卸载，随后的 click 事件落在已删除的按钮上，菜单项永远不触发。
    （窗口捕获监听器仍能正确处理菜单外部点击关闭）
  -->
  <div
    v-if="visible && items.length"
    ref="rootRef"
    class="ctx-menu"
    :style="posStyle"
    @pointerdown.stop
    @contextmenu.stop.prevent
  >
    <template v-for="item in items" :key="item.key">
      <div v-if="item.header" class="ctx-header">{{ item.label }}</div>
      <div v-else-if="item.divider" class="ctx-divider" />
      <button
        v-else
        class="ctx-item"
        :class="{ danger: item.danger, disabled: item.disabled }"
        type="button"
        :disabled="item.disabled"
        :title="item.title"
        @click="item.run"
      >
        <component :is="item.icon" v-if="item.icon" :size="13" />
        <span v-else class="icon-spacer" />
        <span class="ctx-label">{{ item.label }}</span>
      </button>
    </template>
  </div>
</template>

<style lang="scss" scoped>
.ctx-menu {
  position: absolute;
  z-index: 30;
  min-width: 178px;
  background: var(--dbm-bg-panel);
  border: 1px solid var(--dbm-border);
  border-radius: var(--dbm-radius-m);
  box-shadow: var(--dbm-shadow-pop);
  padding: 4px;
  /* 弹出过渡：淡入 + 轻微上移，避免生硬闪现 */
  animation: ctx-menu-in 0.14s ease both;
}

@keyframes ctx-menu-in {
  from {
    opacity: 0;
    transform: translateY(3px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.ctx-header {
  padding: 5px 8px 2px;
  font-size: 10.5px;
  font-weight: 600;
  color: var(--dbm-text-3);
  letter-spacing: 0.5px;
  pointer-events: none;
  user-select: none;
}

.ctx-divider {
  margin: 3px 4px;
  height: 1px;
  background: var(--dbm-border);
  pointer-events: none;
}

.ctx-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 8px;
  border: none;
  border-radius: var(--dbm-radius-s);
  background: transparent;
  color: var(--dbm-text-1);
  font-size: 12.5px;
  cursor: pointer;
  text-align: left;
  transition:
    background-color 0.12s ease,
    color 0.12s ease;

  .icon-spacer {
    width: 13px;
    height: 13px;
  }

  .ctx-label {
    flex: 1;
  }

  &:hover:not(.disabled) {
    background: var(--dbm-bg-hover);
  }

  &.danger {
    color: var(--dbm-danger);
    &:hover {
      background: var(--dbm-danger-weak);
    }
  }

  &.disabled {
    color: var(--dbm-text-3);
    cursor: not-allowed;
  }
}
</style>
