<script setup lang="ts">
import { computed } from 'vue'
import { message } from 'antdv-next'
import {
  ZoomIn,
  ZoomOut,
  Maximize2,
  Undo2,
  Redo2,
  Database,
  Download,
  Upload,
  Eye,
  Plus,
  WandSparkles,
} from '@lucide/vue'
import { useCanvasStore, MIN_ZOOM, MAX_ZOOM } from '@/stores/canvas'
import { useModelStore } from '@/stores/model'
import { useHistoryStore } from '@/stores/history'
import { useUiStore } from '@/stores/ui'
import { useTemplateStore } from '@/stores/template'
import type { GeneratedFile } from '@/types/model'

const canvas = useCanvasStore()
const model = useModelStore()
const history = useHistoryStore()
const ui = useUiStore()
const templateStore = useTemplateStore()

/** 代码生成范围：选中分类 > 选中表 > 全部 */
const scopeTableIds = computed<string[]>(() => {
  if (canvas.selectedCategoryIds.length) {
    return model.tables.filter((t) => canvas.selectedCategoryIds.includes(t.categoryId)).map((t) => t.id)
  }
  if (canvas.selectedIds.length) return [...canvas.selectedIds]
  return model.tables.map((t) => t.id)
})

const scopeLabel = computed(() => {
  if (canvas.selectedCategoryIds.length) {
    const names = canvas.selectedCategoryIds
      .map((id) => model.categoryById(id)?.name)
      .filter(Boolean)
    return `分类: ${names.join('、')}（${scopeTableIds.value.length} 表）`
  }
  if (canvas.selectedIds.length) return `已选 ${canvas.selectedIds.length} 张表`
  return `全部 ${model.tableCount} 张表`
})

function previewCode() {
  if (canvas.selectedIds.length === 1) {
    ui.openCodePreview(canvas.selectedIds[0])
  } else {
    ui.openCodePreview(null)
  }
}

function generate() {
  if (!model.tables.length) {
    message.warning('当前没有可生成的表')
    return
  }
  templateStore.generateAndDownload(scopeTableIds.value)
}

/** 代码替换：先生成文件，经确认后调用 /api/codegen/replace */
async function replace() {
  if (!model.tables.length) {
    message.warning('当前没有可生成的表')
    return
  }
  await templateStore.init()
  if (!templateStore.templates.length) {
    message.warning('请先在「模板管理」中创建代码模板')
    return
  }
  const { files } = templateStore.generateFiles(scopeTableIds.value)
  if (!files.length) {
    message.warning('未生成任何文件')
    return
  }
  ui.openReplaceConfirm(files as GeneratedFile[])
}
</script>

<template>
  <div class="canvas-toolbar">
    <div class="tool-group">
      <a-button size="small" @click="ui.openTableEdit(null, null)">
        <template #icon><Plus :size="13" /></template>
        新增表
      </a-button>
      <a-button size="small" @click="ui.openImportDB()">
        <template #icon><Database :size="13" /></template>
        从数据库导入
      </a-button>
    </div>

    <div class="tool-sep" />

    <div class="tool-group">
      <a-tooltip title="撤销 (Ctrl+Z)">
        <a-button size="small" :disabled="!history.canUndo" @click="history.undo()">
          <template #icon><Undo2 :size="13" /></template>
        </a-button>
      </a-tooltip>
      <a-tooltip title="重做 (Ctrl+Shift+Z)">
        <a-button size="small" :disabled="!history.canRedo" @click="history.redo()">
          <template #icon><Redo2 :size="13" /></template>
        </a-button>
      </a-tooltip>
    </div>

    <div class="tool-sep" />

    <div class="tool-group">
      <a-tooltip title="缩小（25% ~ 500%）">
        <a-button size="small" :disabled="canvas.zoom <= MIN_ZOOM + 0.001" @click="canvas.zoomStep(1 / 1.25)">
          <template #icon><ZoomOut :size="13" /></template>
        </a-button>
      </a-tooltip>
      <button class="zoom-display" type="button" title="点击重置为 100%" @click="canvas.resetZoom()">
        {{ canvas.zoomPercent }}%
      </button>
      <a-tooltip title="放大（25% ~ 500%）">
        <a-button size="small" :disabled="canvas.zoom >= MAX_ZOOM - 0.001" @click="canvas.zoomStep(1.25)">
          <template #icon><ZoomIn :size="13" /></template>
        </a-button>
      </a-tooltip>
      <a-tooltip title="适应画布">
        <a-button size="small" @click="canvas.fitAll()">
          <template #icon><Maximize2 :size="13" /></template>
        </a-button>
      </a-tooltip>
      <a-tooltip title="自动美化：以导航关系为边自动规划每个表卡片的位置">
        <a-button size="small" @click="canvas.autoLayout()">
          <template #icon><WandSparkles :size="13" /></template>
        </a-button>
      </a-tooltip>
    </div>

    <div class="toolbar-right">
      <span class="scope-label" :title="scopeLabel">
        <Eye :size="12" />
        生成范围：{{ scopeLabel }}
      </span>
      <a-button size="small" @click="previewCode">
        <template #icon><Eye :size="13" /></template>
        代码预览
      </a-button>
      <a-button size="small" type="primary" @click="generate">
        <template #icon><Download :size="13" /></template>
        代码生成
      </a-button>
      <a-button size="small" danger @click="replace">
        <template #icon><Upload :size="13" /></template>
        代码替换
      </a-button>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.canvas-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  background: var(--bg-panel);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
  flex-wrap: wrap;
}

.tool-group {
  display: flex;
  align-items: center;
  gap: 4px;
}

.tool-sep {
  width: 1px;
  height: 18px;
  background: var(--border);
  margin: 0 2px;
}

.zoom-display {
  border: 1px solid var(--border);
  background: var(--bg-2);
  color: var(--text-2);
  font-size: 12px;
  font-family: var(--font-mono);
  border-radius: var(--radius-s);
  padding: 0 8px;
  height: 24px;
  min-width: 52px;
  cursor: pointer;

  &:hover {
    color: var(--primary-text);
    border-color: var(--primary);
  }
}

.toolbar-right {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 6px;

  .scope-label {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 11px;
    color: var(--text-3);
    max-width: 220px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}
</style>
