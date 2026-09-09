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
} from '@lucide/vue'
import type { FunctionalComponent } from 'vue'
import { useCanvasStore } from '@/stores/canvas'
import { useModelStore } from '@/stores/model'
import { useUiStore } from '@/stores/ui'
import { message } from 'antdv-next'

interface MenuItem {
  key: string
  label: string
  icon: FunctionalComponent | null
  danger: boolean
  disabled?: boolean
  divider?: boolean
  run: () => void
}

const canvas = useCanvasStore()
const model = useModelStore()
const ui = useUiStore()

const rootRef = ref<HTMLElement>()

const menu = computed(() => canvas.menu)
const visible = computed(() => Boolean(menu.value))

const menuWidth = 178

/** 菜单位置（画布内裁剪） */
const posStyle = computed(() => {
  if (!menu.value) return {}
  const x = Math.min(menu.value.x, Math.max(0, canvas.viewportW - menuWidth - 8))
  const y = Math.min(menu.value.y, Math.max(0, canvas.viewportH - 260))
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
          content: nav ? `${model.tableById(nav.self)?.tableName} 与 ${model.tableById(nav.target)?.tableName} 之间的导航将被移除。` : '',
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
    <button
      v-for="item in items"
      :key="item.key"
      class="ctx-item"
      :class="{ danger: item.danger, divider: item.divider, disabled: item.disabled }"
      type="button"
      :disabled="item.disabled"
      @click="item.run"
    >
      <component :is="item.icon" v-if="item.icon" :size="13" />
      <span v-else class="icon-spacer" />
      <span class="ctx-label">{{ item.label }}</span>
    </button>
  </div>
</template>

<style lang="scss" scoped>
.ctx-menu {
  position: absolute;
  z-index: 30;
  min-width: 178px;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: var(--radius-m);
  box-shadow: var(--shadow-pop);
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

.ctx-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 8px;
  border: none;
  border-radius: var(--radius-s);
  background: transparent;
  color: var(--text-1);
  font-size: 12.5px;
  cursor: pointer;
  text-align: left;
  transition: background-color 0.12s ease, color 0.12s ease;

  .icon-spacer {
    width: 13px;
    height: 13px;
  }

  .ctx-label {
    flex: 1;
  }

  &:hover:not(.disabled) {
    background: var(--bg-hover);
  }

  &.danger {
    color: var(--danger);
    &:hover {
      background: var(--danger-weak);
    }
  }

  &.disabled {
    color: var(--text-3);
    cursor: not-allowed;
  }

  &.divider {
    pointer-events: none;
    margin: 3px 4px;
    padding: 0;
    height: 1px;
    background: var(--border);
  }
}
</style>
