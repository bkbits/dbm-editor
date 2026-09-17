<script setup lang="ts">
import { computed, ref } from "vue";
import { message } from "antdv-next";
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
} from "@lucide/vue";
import { useCanvasStore, MIN_ZOOM, MAX_ZOOM } from "@/stores/canvas";
import { useModelStore } from "@/stores/model";
import { useHistoryStore } from "@/stores/history";
import { useUiStore } from "@/stores/ui";
import { useTemplateStore } from "@/stores/template";
import { useDictStore } from "@/stores/dict";
import type { GeneratedFile } from "@/types/model";
import TemplateSelectModal from "@/components/dialog/TemplateSelectModal.vue";

const canvas = useCanvasStore();
const model = useModelStore();
const history = useHistoryStore();
const ui = useUiStore();
const templateStore = useTemplateStore();
const dictStore = useDictStore();

/** 模板选择对话框（生成/替换前勾选本次参与的模板，默认全选） */
const selectOpen = ref(false);
const selectMode = ref<"generate" | "replace">("generate");

/** 代码生成范围：选中分类 > 选中表 > 全部 */
const scopeTableIds = computed<string[]>(() => {
  if (canvas.selectedCategoryIds.length) {
    return model.tables
      .filter((t) => canvas.selectedCategoryIds.includes(t.categoryId))
      .map((t) => t.id);
  }
  if (canvas.selectedIds.length) return [...canvas.selectedIds];
  return model.tables.map((t) => t.id);
});

const scopeLabel = computed(() => {
  if (canvas.selectedCategoryIds.length) {
    const names = canvas.selectedCategoryIds
      .map((id) => model.categoryById(id)?.name)
      .filter(Boolean);
    return `分类: ${names.join("、")}（${scopeTableIds.value.length} 表）`;
  }
  if (canvas.selectedIds.length) return `已选 ${canvas.selectedIds.length} 张表`;
  return `全部 ${model.tableCount} 张表`;
});

function previewCode() {
  if (canvas.selectedIds.length === 1) {
    ui.openCodePreview(canvas.selectedIds[0]);
  } else {
    ui.openCodePreview(null);
  }
}

function generate() {
  if (!model.tables.length) {
    message.warning("当前没有可生成的表");
    return;
  }
  // 先弹模板选择框（默认全选），确认后下载 zip
  selectMode.value = "generate";
  selectOpen.value = true;
}

/** 模板选择确认：生成并下载 zip（dictEnabled = 是否生成字典分类代码，默认生成） */
async function onGenerateConfirm(templateNames: string[], dictEnabled: boolean) {
  // 字典分类代码依赖字典数据：生成前确保字典仓库已加载（未进过字典页时补拉）
  if (dictEnabled) await dictStore.init();
  await templateStore.generateAndDownload(scopeTableIds.value, templateNames, dictEnabled);
}

/** 模板选择确认分发：按模式路由（避免模板内联多参数表达式） */
function onSelectConfirm(templateNames: string[], dictEnabled: boolean) {
  if (selectMode.value === "generate") onGenerateConfirm(templateNames, dictEnabled);
  else onReplaceConfirm(templateNames, dictEnabled);
}

/** 代码替换：先弹模板选择框，确认后生成文件并进入替换确认 */
function replace() {
  if (!model.tables.length) {
    message.warning("当前没有可生成的表");
    return;
  }
  selectMode.value = "replace";
  selectOpen.value = true;
}

/** 模板选择确认：生成文件，经确认后调用 /api/codegen/replace */
async function onReplaceConfirm(templateNames: string[], dictEnabled: boolean) {
  await templateStore.init();
  if (dictEnabled) await dictStore.init();
  const { files } = templateStore.generateFiles(scopeTableIds.value, templateNames, dictEnabled);
  if (!files.length) {
    message.warning("未生成任何文件");
    return;
  }
  ui.openReplaceConfirm(files as GeneratedFile[]);
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
        <a-button
          size="small"
          :disabled="canvas.zoom <= MIN_ZOOM + 0.001"
          @click="canvas.zoomStep(1 / 1.25)"
        >
          <template #icon><ZoomOut :size="13" /></template>
        </a-button>
      </a-tooltip>
      <button
        class="zoom-display"
        type="button"
        title="点击重置为 100%"
        @click="canvas.resetZoom()"
      >
        {{ canvas.zoomPercent }}%
      </button>
      <a-tooltip title="放大（25% ~ 500%）">
        <a-button
          size="small"
          :disabled="canvas.zoom >= MAX_ZOOM - 0.001"
          @click="canvas.zoomStep(1.25)"
        >
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

    <TemplateSelectModal v-model:open="selectOpen" :mode="selectMode" @confirm="onSelectConfirm" />
  </div>
</template>

<style lang="scss" scoped>
.canvas-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  background: var(--dbm-bg-panel);
  border-bottom: 1px solid var(--dbm-border);
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
  background: var(--dbm-border);
  margin: 0 2px;
}

.zoom-display {
  border: 1px solid var(--dbm-border);
  background: var(--dbm-bg-2);
  color: var(--dbm-text-2);
  font-size: 12px;
  font-family: var(--dbm-font-mono);
  border-radius: var(--dbm-radius-s);
  padding: 0 8px;
  height: 24px;
  min-width: 52px;
  cursor: pointer;

  &:hover {
    color: var(--dbm-primary-text);
    border-color: var(--dbm-primary);
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
    color: var(--dbm-text-3);
    max-width: 220px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}

/* ===== 移动端适配：紧凑间距 + 隐藏生成范围文字（按钮组自然换行） ===== */
@media (max-width: 768px) {
  .canvas-toolbar {
    padding: 5px 8px;
    gap: 6px;
  }

  .toolbar-right {
    margin-left: 0;
    width: 100%;
    justify-content: flex-start;

    .scope-label {
      display: none;
    }
  }
}
</style>
