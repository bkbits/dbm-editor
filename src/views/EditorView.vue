<script setup lang="ts">
import { onBeforeUnmount, onMounted } from "vue";
import { PanelLeft, X } from "@lucide/vue";
import { useModelStore } from "@/stores/model";
import { useUiStore } from "@/stores/ui";
import OutlinePanel from "@/components/outline/OutlinePanel.vue";
import CanvasToolbar from "@/components/canvas/CanvasToolbar.vue";
import ModelCanvas from "@/components/canvas/ModelCanvas.vue";
import TableEditDialog from "@/components/dialog/TableEditDialog.vue";
import NavigateEditDialog from "@/components/dialog/NavigateEditDialog.vue";
import CategoryEditDialog from "@/components/dialog/CategoryEditDialog.vue";
import ImportDBDialog from "@/components/dialog/ImportDBDialog.vue";
import CodePreviewModal from "@/components/dialog/CodePreviewModal.vue";
import ReplaceConfirmModal from "@/components/dialog/ReplaceConfirmModal.vue";

const model = useModelStore();
const ui = useUiStore();

onMounted(() => {
  model.init();
});

/* 窗口从窄屏切回宽屏时收起抽屉，避免残留遮罩状态 */
const desktopMq = window.matchMedia("(min-width: 769px)");
function onDesktopChange() {
  ui.closeMobileOutline();
}
onMounted(() => desktopMq.addEventListener("change", onDesktopChange));
onBeforeUnmount(() => desktopMq.removeEventListener("change", onDesktopChange));
</script>

<template>
  <div class="editor-layout">
    <!-- 移动端抽屉遮罩（桌面样式隐藏，仅窄屏可见） -->
    <div v-show="ui.mobileOutlineOpen" class="outline-backdrop" @click="ui.closeMobileOutline()" />

    <OutlinePanel />

    <section class="canvas-area">
      <CanvasToolbar />
      <ModelCanvas />

      <!-- 移动端：大纲抽屉开关（悬浮于画布左上角，桌面隐藏） -->
      <button
        class="outline-toggle"
        :class="{ open: ui.mobileOutlineOpen }"
        type="button"
        :title="ui.mobileOutlineOpen ? '收起表格大纲' : '展开表格大纲'"
        @click="ui.toggleMobileOutline()"
      >
        <X v-if="ui.mobileOutlineOpen" :size="16" />
        <PanelLeft v-else :size="16" />
      </button>
    </section>

    <!-- 对话框群 -->
    <TableEditDialog />
    <NavigateEditDialog />
    <CategoryEditDialog />
    <ImportDBDialog />
    <CodePreviewModal />
    <ReplaceConfirmModal />
  </div>
</template>

<style lang="scss" scoped>
.editor-layout {
  display: flex;
  height: 100%;
  overflow: hidden;
}

.canvas-area {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  position: relative; /* 移动端悬浮大纲开关的定位基准 */
}

/* ===== 移动端适配 ===== */
.outline-toggle {
  display: none; /* 桌面隐藏 */
}

@media (max-width: 768px) {
  .outline-toggle {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    position: absolute;
    top: 10px;
    left: 10px;
    width: 32px;
    height: 32px;
    border: 1px solid var(--dbm-border);
    border-radius: var(--dbm-radius-m);
    background: var(--dbm-bg-panel);
    color: var(--dbm-text-2);
    cursor: pointer;
    z-index: 12;
    box-shadow: var(--dbm-card-shadow);

    &:active {
      background: var(--dbm-primary-weak);
      color: var(--dbm-primary-text);
    }
  }

  .outline-backdrop {
    position: fixed;
    left: 0;
    right: 0;
    top: var(--dbm-header-height);
    bottom: 0;
    background: rgba(0, 0, 0, 0.38);
    z-index: 30;
  }
}
</style>
