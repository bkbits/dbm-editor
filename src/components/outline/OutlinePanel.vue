<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { Modal, message } from 'antdv-next'
import {
  ChevronRight,
  ChevronDown,
  Plus,
  Pencil,
  Trash2,
  Table as TableIcon,
  Link2,
  EyeOff,
  Eye,
  Search,
  RefreshCcw,
  Folder,
} from '@lucide/vue'
import { useModelStore } from '@/stores/model'
import { useCanvasStore } from '@/stores/canvas'
import { useUiStore } from '@/stores/ui'
import { useHistoryStore } from '@/stores/history'

const model = useModelStore()
const canvas = useCanvasStore()
const ui = useUiStore()

const keyword = ref('')
const expanded = reactive(new Set<string>())

const filteredCategories = computed(() => {
  const kw = keyword.value.trim().toLowerCase()
  const cats = [...model.categories]
  if (!kw) return cats
  return cats.filter((c) => {
    const inCat = c.name.toLowerCase().includes(kw) || c.basePackage.toLowerCase().includes(kw)
    const inTables = model
      .tablesByCategory(c.id)
      .some(
        (t) =>
          t.tableName.toLowerCase().includes(kw) || (t.comment || '').toLowerCase().includes(kw),
      )
    return inCat || inTables
  })
})

function tablesOf(categoryId: string) {
  const kw = keyword.value.trim().toLowerCase()
  const list = model.tablesByCategory(categoryId)
  if (!kw) return list
  return list.filter(
    (t) =>
      t.tableName.toLowerCase().includes(kw) ||
      (t.comment || '').toLowerCase().includes(kw) ||
      model.categories
        .find((c) => c.id === categoryId)
        ?.name.toLowerCase()
        .includes(kw),
  )
}

/** 大纲眼睛：显示隐藏表并保证完整进入视野 */
function revealTable(tableId: string) {
  canvas.showTable(tableId)
  canvas.ensureTableVisible(tableId)
}

function isExpanded(categoryId: string) {
  // 搜索时自动展开
  if (keyword.value.trim()) return true
  return expanded.has(categoryId)
}
function toggleExpand(categoryId: string) {
  if (expanded.has(categoryId)) expanded.delete(categoryId)
  else expanded.add(categoryId)
}

function catColor(categoryId: string, index: number) {
  return `var(--dbm-cat-${index % 8})`
}

/** 点击大纲表名：双向联动高亮 + 画布居中定位 */
function clickTable(tableId: string, e: MouseEvent) {
  canvas.selectTable(tableId, e.ctrlKey || e.shiftKey)
  canvas.centerOnTable(tableId)
}
function dblClickTable(tableId: string) {
  ui.openTableEdit(tableId)
}
function contextTable(tableId: string, e: MouseEvent) {
  e.preventDefault()
  const local = canvas.localPoint(e)
  canvas.openMenu({
    kind: 'card',
    x: local.x,
    y: local.y,
    world: canvas.screenToWorld(local),
    tableId,
  })
}

function clickCategory(categoryId: string, e: MouseEvent) {
  canvas.selectCategory(categoryId, e.ctrlKey || e.shiftKey)
}

function addTableIn(categoryId: string) {
  // 在该分类下新增表，落点取画布可视区域中心
  const world = canvas.screenToWorld({ x: canvas.viewportW / 2, y: canvas.viewportH / 2 })
  ui.openTableEdit(null, world, categoryId)
}

function removeCategory(categoryId: string) {
  const cat = model.categoryById(categoryId)
  const count = model.tablesByCategory(categoryId).length
  if (count > 0) {
    message.warning(`分类「${cat?.name}」下仍有 ${count} 张表，请先移动或删除`)
    return
  }
  Modal.confirm({
    title: `删除分类「${cat?.name}」？`,
    content: '仅删除分类本身，不含任何表。',
    okText: '删除',
    okType: 'danger',
    cancelText: '取消',
    onOk: () => model.removeCategory(categoryId),
  })
}

async function resetDemo() {
  Modal.confirm({
    title: '重置为演示数据？',
    content: '将清空本地全部修改，恢复内置演示模型（含字典与模板）。',
    okText: '重置',
    okType: 'danger',
    cancelText: '取消',
    onOk: async () => {
      await model.resetDemoData()
      useHistoryStore().clear()
      canvas.setSelection([])
      canvas.fitAll(true)
      message.success('已重置为演示数据')
    },
  })
}

watch(
  () => model.loaded,
  (loaded) => {
    if (loaded && !expanded.size && model.categories.length) {
      model.categories.forEach((c) => expanded.add(c.id))
    }
  },
  { immediate: true },
)
</script>

<template>
  <aside class="outline-panel">
    <div class="outline-header">
      <span class="outline-title">
        <Folder :size="14" />
        表格大纲
      </span>
      <div class="outline-actions">
        <a-tooltip title="新增分类">
          <button class="mini-btn" type="button" @click="ui.openCategoryEdit(null)">
            <Plus :size="13" />
          </button>
        </a-tooltip>
        <a-tooltip title="重置演示数据">
          <button class="mini-btn" type="button" @click="resetDemo">
            <RefreshCcw :size="13" />
          </button>
        </a-tooltip>
      </div>
    </div>

    <div class="outline-search">
      <Search :size="13" class="search-icon" />
      <input
        v-model="keyword"
        type="text"
        placeholder="搜索分类 / 表名 / 注释"
        spellcheck="false"
      />
    </div>

    <div class="outline-tree">
      <div v-for="(cat, index) in filteredCategories" :key="cat.id" class="category-node">
        <div
          class="category-row"
          :class="{ selected: canvas.selectedCategoryIds.includes(cat.id) }"
          @click="clickCategory(cat.id, $event)"
        >
          <button class="chevron" type="button" @click.stop="toggleExpand(cat.id)">
            <ChevronDown v-if="isExpanded(cat.id)" :size="13" />
            <ChevronRight v-else :size="13" />
          </button>
          <span class="cat-dot" :style="{ background: catColor(cat.id, index) }" />
          <span class="cat-name" :title="cat.name">{{ cat.name }}</span>
          <span class="cat-count">{{ model.tablesByCategory(cat.id).length }}</span>
          <span class="cat-actions" @click.stop @dblclick.stop>
            <a-tooltip title="在此分类下新增表">
              <button class="mini-btn" type="button" @click="addTableIn(cat.id)">
                <Plus :size="12" />
              </button>
            </a-tooltip>
            <a-tooltip title="编辑分类">
              <button class="mini-btn" type="button" @click="ui.openCategoryEdit(cat.id)">
                <Pencil :size="12" />
              </button>
            </a-tooltip>
            <a-tooltip title="删除分类">
              <button class="mini-btn danger" type="button" @click="removeCategory(cat.id)">
                <Trash2 :size="12" />
              </button>
            </a-tooltip>
          </span>
        </div>
        <div v-if="isExpanded(cat.id)" :title="cat.basePackage" class="cat-package mono">
          {{ cat.basePackage }}
        </div>

        <div v-if="isExpanded(cat.id)" class="table-list">
          <div
            v-for="t in tablesOf(cat.id)"
            :key="t.id"
            class="table-row"
            :class="{
              selected: canvas.selectedIds.includes(t.id),
              hidden: canvas.hiddenTableIds.includes(t.id),
            }"
            :data-outline-table="t.id"
            @click="clickTable(t.id, $event)"
            @dblclick.stop="dblClickTable(t.id)"
            @contextmenu.stop.prevent="contextTable(t.id, $event)"
          >
            <TableIcon :size="12" class="t-icon" />
            <span class="t-name mono">{{ t.tableName }}</span>
            <Link2
              v-if="model.isMappingTable(t.id)"
              :size="11"
              class="t-mapping"
              title="中间映射表"
            />
            <button
              v-if="canvas.hiddenTableIds.includes(t.id)"
              class="t-eye"
              type="button"
              title="在画布中显示"
              @click.stop="revealTable(t.id)"
            >
              <EyeOff :size="12" />
            </button>
            <button
              v-else
              class="t-eye"
              type="button"
              title="在画布中隐藏"
              @click.stop="canvas.hideTable(t.id)"
            >
              <Eye :size="12" />
            </button>
          </div>
          <div v-if="!tablesOf(cat.id).length" class="table-empty">（空）</div>
        </div>
      </div>

      <div v-if="!filteredCategories.length" class="tree-empty">
        <p>暂无分类</p>
        <a-button size="small" type="dashed" @click="ui.openCategoryEdit(null)">新增分类</a-button>
      </div>
    </div>

    <div class="outline-footer">
      <span>{{ model.categoryCount }} 个分类</span>
      <span>{{ model.tableCount }} 张表</span>
      <span>{{ model.navigateCount }} 条导航</span>
    </div>
  </aside>
</template>

<style lang="scss" scoped>
.outline-panel {
  display: flex;
  flex-direction: column;
  width: var(--dbm-outline-width);
  min-width: var(--dbm-outline-width);
  height: 100%;
  background: var(--dbm-bg-panel);
  border-right: 1px solid var(--dbm-border);
  flex-shrink: 0;
}

.outline-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 10px 6px;

  .outline-title {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-weight: 600;
    font-size: 13px;
    color: var(--dbm-text-1);
  }

  .outline-actions {
    display: flex;
    gap: 4px;
  }
}

.mini-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border: none;
  border-radius: var(--dbm-radius-s);
  background: transparent;
  color: var(--dbm-text-3);
  cursor: pointer;

  &:hover {
    background: var(--dbm-primary-weak);
    color: var(--dbm-primary-text);
  }

  &.danger:hover {
    background: var(--dbm-danger-weak);
    color: var(--dbm-danger);
  }
}

.outline-search {
  position: relative;
  margin: 0 10px 8px;

  .search-icon {
    position: absolute;
    left: 8px;
    top: 50%;
    transform: translateY(-50%);
    color: var(--dbm-text-3);
  }

  input {
    width: 100%;
    height: 28px;
    border: 1px solid var(--dbm-border);
    border-radius: var(--dbm-radius-m);
    background: var(--dbm-bg-2);
    color: var(--dbm-text-1);
    padding: 0 8px 0 28px;
    font-size: 12px;
    outline: none;

    &:focus {
      border-color: var(--dbm-primary);
    }
  }
}

.outline-tree {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 0 6px 8px;
}

.category-node {
  margin-bottom: 2px;
}

.category-row {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 6px;
  border-radius: var(--dbm-radius-s);
  cursor: pointer;

  &:hover {
    background: var(--dbm-bg-hover);
    .cat-actions {
      opacity: 1;
    }
  }

  &.selected {
    background: var(--dbm-primary-weak);
    .cat-name {
      color: var(--dbm-primary-text);
    }
  }

  .chevron {
    display: inline-flex;
    border: none;
    background: none;
    color: var(--dbm-text-3);
    cursor: pointer;
    padding: 0;
    width: 16px;
    height: 16px;
    align-items: center;
    justify-content: center;
  }

  .cat-dot {
    width: 8px;
    height: 8px;
    border-radius: 2px;
    flex-shrink: 0;
  }

  .cat-name {
    flex: 1;
    font-size: 12.5px;
    font-weight: 600;
    color: var(--dbm-text-1);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .cat-count {
    font-size: 10.5px;
    color: var(--dbm-text-3);
    font-family: var(--dbm-font-mono);
    flex-shrink: 0;
  }

  .cat-actions {
    display: none;
    gap: 2px;
    opacity: 0;
    transition: opacity 0.12s ease;
  }
}

.cat-package {
  padding: 1px 6px 3px 30px;
  font-size: 10px;
  color: var(--dbm-text-3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.table-list {
  padding-left: 14px;
}

.table-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 6px 3px 8px;
  margin-left: 12px;
  border-left: 1px solid var(--dbm-border);
  border-radius: 0 var(--dbm-radius-s) var(--dbm-radius-s) 0;
  cursor: pointer;

  &:hover {
    background: var(--dbm-bg-hover);
    .t-eye {
      opacity: 1;
    }
  }

  &.selected {
    background: var(--dbm-primary-weak);
    border-left-color: var(--dbm-primary);
    .t-name {
      color: var(--dbm-primary-text);
      font-weight: 600;
    }
  }

  &.hidden .t-name {
    color: var(--dbm-text-3);
  }

  .t-icon {
    color: var(--dbm-text-3);
    flex-shrink: 0;
  }

  .t-name {
    flex: 1;
    font-size: 12px;
    color: var(--dbm-text-1);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .t-mapping {
    color: var(--dbm-text-3);
    flex-shrink: 0;
  }

  .t-eye {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    border: none;
    border-radius: 3px;
    background: transparent;
    color: var(--dbm-text-3);
    cursor: pointer;
    opacity: 0;
    flex-shrink: 0;
    padding: 0;

    &:hover {
      background: var(--dbm-primary-weak);
      color: var(--dbm-primary-text);
    }
  }

  &.hidden .t-eye {
    opacity: 1;
  }
}

.table-empty,
.tree-empty {
  padding: 4px 10px;
  color: var(--dbm-text-3);
  font-size: 11.5px;
}

.tree-empty {
  text-align: center;
  padding-top: 26px;

  p {
    margin: 6px 0 10px;
  }
}

.outline-footer {
  display: flex;
  justify-content: space-around;
  gap: 6px;
  padding: 7px 8px;
  border-top: 1px solid var(--dbm-border);
  font-size: 10.5px;
  color: var(--dbm-text-3);
  font-family: var(--dbm-font-mono);
  flex-shrink: 0;
}
</style>
