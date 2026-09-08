<script setup lang="ts">
import { onMounted } from 'vue'
import { useModelStore } from '@/stores/model'
import OutlinePanel from '@/components/outline/OutlinePanel.vue'
import CanvasToolbar from '@/components/canvas/CanvasToolbar.vue'
import ModelCanvas from '@/components/canvas/ModelCanvas.vue'
import TableEditDialog from '@/components/dialog/TableEditDialog.vue'
import NavigateEditDialog from '@/components/dialog/NavigateEditDialog.vue'
import CategoryEditDialog from '@/components/dialog/CategoryEditDialog.vue'
import ImportDBDialog from '@/components/dialog/ImportDBDialog.vue'
import CodePreviewModal from '@/components/dialog/CodePreviewModal.vue'
import ReplaceConfirmModal from '@/components/dialog/ReplaceConfirmModal.vue'

const model = useModelStore()

onMounted(() => {
  model.init()
})
</script>

<template>
  <div class="editor-layout">
    <OutlinePanel />
    <section class="canvas-area">
      <CanvasToolbar />
      <ModelCanvas />
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
}
</style>
