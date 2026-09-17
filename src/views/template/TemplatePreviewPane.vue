<script setup lang="ts">
/**
 * 模板页 · 实时预览面板
 *
 * 从原 TemplateView.vue 单文件拆出。展示渲染产物：语言徽标（显式指定
 * 优先，否则按文件后缀识别）、错误条 / 丢弃提示条 / 产物路径条、
 * highlight.js 代码视图；头部按模式提供预览目标选择（表模板选目标表 /
 * 字典分类模板选目标分类，经 v-model 与页面级双向绑定）。
 */
import type { SelectProps } from "antdv-next";

defineProps<{
  /** 编辑区模式：table = 表模板（选目标表）；dict = 字典分类模板（选目标分类） */
  activeKind: "table" | "dict";
  /** 预览状态（output / fileName / filePath / error / language / aborted） */
  previewState: {
    output: string;
    fileName: string;
    filePath: string;
    error: string;
    language: string;
    aborted: boolean;
  };
  /** 产物代码高亮 HTML（错误态为空串） */
  highlighted: string;
  /** 实际生效的高亮语言（错误态为空串） */
  effectiveLanguage: string;
  /** 目标表下拉选项 */
  tableOptions: SelectProps["options"];
  /** 目标字典分类下拉选项 */
  categoryOptions: SelectProps["options"];
}>();

/** 预览目标表（表模板） */
const previewTableId = defineModel<string>("previewTableId", { required: true });
/** 预览目标字典分类（字典分类模板） */
const previewCatId = defineModel<string>("previewCatId", { required: true });
</script>

<template>
  <div class="tpl-preview">
    <div class="pane-head preview-head">
      <span class="preview-title">实时预览</span>
      <span
        v-if="effectiveLanguage"
        class="lang-chip mono"
        title="高亮语言：模板内 context.language 显式指定，未设置时按文件后缀自动识别"
      >
        {{ effectiveLanguage }}
      </span>
      <a-select
        v-if="activeKind === 'dict'"
        v-model:value="previewCatId"
        :options="categoryOptions"
        size="small"
        style="width: 220px"
        placeholder="选择目标字典分类"
      />
      <a-select
        v-else
        v-model:value="previewTableId"
        :options="tableOptions"
        size="small"
        show-search
        option-filter-prop="label"
        style="width: 220px"
        placeholder="选择目标表"
      />
    </div>
    <div v-if="previewState.error" class="preview-error mono">⚠ {{ previewState.error }}</div>
    <div v-else-if="previewState.aborted" class="preview-aborted">
      ⚠ 模板已标记丢弃（context.aborted = true）：本次生成不会打包该产物
    </div>
    <div v-else-if="previewState.filePath" class="preview-file mono">
      {{ previewState.filePath }}
    </div>
    <pre
      v-if="!previewState.error && !previewState.aborted"
      class="code-view"
    ><code class="hljs mono" v-html="highlighted"></code></pre>
  </div>
</template>

<style lang="scss" scoped>
.tpl-preview {
  display: flex;
  flex-direction: column;
  min-height: 0;
  border: 1px solid var(--dbm-border);
  border-radius: var(--dbm-radius-m);
  background: var(--dbm-bg-panel);
  overflow: hidden;
}

.pane-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 7px 12px;
  border-bottom: 1px solid var(--dbm-border);
  font-size: 11.5px;
  color: var(--dbm-text-2);
  flex-shrink: 0;

  code {
    font-family: var(--dbm-font-mono);
    color: var(--dbm-primary-text);
    background: var(--dbm-primary-weak);
    border-radius: 3px;
    padding: 0 4px;
  }
}

.preview-head {
  gap: 8px;
}

.preview-title {
  flex-shrink: 0;
}

.lang-chip {
  flex-shrink: 0;
  font-size: 10px;
  color: var(--dbm-primary-text);
  background: var(--dbm-primary-weak);
  border: 1px solid color-mix(in srgb, var(--dbm-primary) 30%, transparent);
  border-radius: 4px;
  padding: 0 6px;
  line-height: 18px;
}

.preview-file {
  padding: 5px 12px;
  font-size: 10.5px;
  color: var(--dbm-text-3);
  border-bottom: 1px dashed var(--dbm-border);
  background: var(--dbm-bg-2);
  flex-shrink: 0;
}

.preview-error {
  padding: 6px 12px;
  font-size: 11px;
  color: var(--dbm-danger);
  background: var(--dbm-danger-weak);
  border-bottom: 1px dashed var(--dbm-danger);
  flex-shrink: 0;
}

.preview-aborted {
  padding: 6px 12px;
  font-size: 11px;
  color: var(--dbm-warning);
  background: var(--dbm-warning-weak);
  border-bottom: 1px dashed var(--dbm-warning);
  flex-shrink: 0;
}

.code-view {
  flex: 1;
  margin: 0;
  overflow: auto;
  background: var(--dbm-code-bg);
  padding: 12px 14px;
  font-size: 12px;
  line-height: 1.55;

  code {
    font-family: var(--dbm-font-mono);
    white-space: pre;
  }
}
</style>
