<script setup lang="ts">
/**
 * Eta 模板编辑器（textarea + 语法高亮覆盖层）
 *
 * 从原 TemplateView.vue 单文件拆出。textarea 置于高亮 pre 之上：文字透明、
 * 光标可见，背景透出下方高亮层；两层使用完全一致的字体/字号/行高/内边距/
 * 换行策略，逐字符对齐。高亮用 highlights-eta 插件（<% %> 逻辑 /
 * <%= %> 输出 / <%# %> 注释区分着色）；尾行补偿：内容以换行结尾时补一个
 * 换行，保证覆盖层与 textarea 的滚动高度一致。
 *
 * 通用受控组件：v-model 绑定内容，placeholder 透传；滚动同步（输入/滚动
 * 时覆盖层与 textarea 逐行对齐）内聚于本组件。
 */
import { computed, ref } from "vue";
import { highlightTemplateSource } from "@/utils/highlight";

const props = defineProps<{ modelValue: string; placeholder?: string }>();
const emit = defineEmits<{ "update:modelValue": [value: string] }>();

const editorRef = ref<HTMLTextAreaElement>();
const overlayRef = ref<HTMLElement>();

/** 编辑器源码高亮（含尾行换行补偿） */
const highlightedSource = computed(() => {
  const html = highlightTemplateSource(props.modelValue);
  return props.modelValue.endsWith("\n") ? `${html}\n` : html;
});

/** 输入：透传 v-model 更新 */
function onEditorInput(e: Event) {
  emit("update:modelValue", (e.target as HTMLTextAreaElement).value);
}

/** 覆盖层滚动位置与 textarea 同步（输入/滚动时保持逐行对齐） */
function syncScroll() {
  const ta = editorRef.value;
  const pre = overlayRef.value;
  if (!ta || !pre) return;
  pre.scrollTop = ta.scrollTop;
  pre.scrollLeft = ta.scrollLeft;
}
</script>

<template>
  <div class="editor-code-wrap">
    <!-- 高亮覆盖层：与 textarea 完全同构的排版，位于其下方，不可交互 -->
    <pre
      ref="overlayRef"
      class="code-overlay mono"
      aria-hidden="true"
    ><code class="hljs" v-html="highlightedSource"></code></pre>
    <textarea
      ref="editorRef"
      :value="modelValue"
      class="tpl-textarea mono"
      spellcheck="false"
      wrap="off"
      :placeholder="placeholder"
      @input="onEditorInput"
      @scroll="syncScroll"
    ></textarea>
  </div>
</template>

<style lang="scss" scoped>
/* textarea 置于高亮 pre 之上：文字透明、光标可见，背景透出下方高亮层 */
.editor-code-wrap {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.code-overlay,
.tpl-textarea {
  position: absolute;
  inset: 0;
  margin: 0;
  border: none;
  outline: none;
  resize: none;
  padding: 12px 14px;
  font-size: 12px;
  line-height: 1.6;
  font-family: var(--dbm-font-mono);
  white-space: pre;
  word-wrap: normal;
  overflow-wrap: normal;
  tab-size: 4;
}

.code-overlay {
  z-index: 1;
  pointer-events: none;
  overflow: hidden;
  color: var(--dbm-code-text);
  background: var(--dbm-code-bg);

  code {
    display: block;
    font-family: var(--dbm-font-mono);
    white-space: pre;
  }
}

.tpl-textarea {
  z-index: 2;
  background: transparent;
  color: transparent;
  caret-color: var(--dbm-primary-text);
  overflow: auto;

  &::placeholder {
    color: var(--dbm-text-3);
  }

  &::selection {
    background: var(--dbm-primary);
    color: var(--dbm-on-primary);
  }
}
</style>
