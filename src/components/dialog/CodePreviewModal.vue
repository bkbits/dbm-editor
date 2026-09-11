<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { message } from 'antdv-next'
import { Copy } from '@lucide/vue'
import { useUiStore } from '@/stores/ui'
import { useModelStore } from '@/stores/model'
import { useTemplateStore } from '@/stores/template'
import { highlightCode, resolveLanguage } from '@/utils/highlight'

const ui = useUiStore()
const model = useModelStore()
const templateStore = useTemplateStore()

const dialogOpen = computed(() => ui.codePreview.open)

const tableId = ref('')
const activeTemplate = ref('')

const tableOptions = computed(() =>
  model.tables.map((t) => ({
    value: t.id,
    label: `${t.tableName}${t.comment ? `（${t.comment}）` : ''}`,
  })),
)

const templates = computed(() => templateStore.templates)

watch(dialogOpen, (open) => {
  if (!open) return
  templateStore.init()
  tableId.value = ui.codePreview.tableId || model.tables[0]?.id || ''
  activeTemplate.value = templateStore.templates[0]?.name ?? ''
})

/** 模板异步加载完成后，确保选中有效模板 */
watch(
  () => templateStore.templates,
  (tpls) => {
    if (!tpls.some((t) => t.name === activeTemplate.value)) {
      activeTemplate.value = tpls[0]?.name ?? ''
    }
  },
  { immediate: true },
)

watch(tableId, () => {
  // 切换表后保持模板选择
})

const currentTemplate = computed(() => templates.value.find((t) => t.name === activeTemplate.value))

const renderOutput = computed(() => {
  if (!tableId.value || !currentTemplate.value) return null
  return templateStore.renderFor(currentTemplate.value, tableId.value)
})

const renderedHtml = computed(() => {
  const out = renderOutput.value
  if (!out) return ''
  return highlightCode(out.result || '', resolveLanguage(out.fileName, out.language))
})

const meta = computed(() => {
  const out = renderOutput.value
  if (!out) return null
  return {
    fileName: out.fileName,
    filePath: out.filePath,
    error: out.error,
    /** 实际生效的高亮语言（显式指定优先，否则按后缀自动识别） */
    language: resolveLanguage(out.fileName, out.language),
  }
})

async function copyCode() {
  const code = renderOutput.value?.result || ''
  if (!code) return
  try {
    await navigator.clipboard.writeText(code)
    message.success('代码已复制到剪贴板')
  } catch {
    message.error('复制失败，请手动选择复制')
  }
}
</script>

<template>
  <a-modal
    :open="dialogOpen"
    title="代码生成预览"
    :width="880"
    :footer="null"
    destroy-on-hidden
    @cancel="ui.closeCodePreview()"
  >
    <div class="preview-toolbar">
      <a-select
        v-model:value="tableId"
        :options="tableOptions"
        size="small"
        show-search
        option-filter-prop="label"
        style="width: 240px"
        placeholder="选择目标表"
      />
      <span v-if="meta" class="file-path mono" :title="meta.filePath">
        {{ meta.filePath || meta.fileName }}
      </span>
      <span
        v-if="meta && !meta.error"
        class="lang-chip mono"
        title="高亮语言（模板内 context.language 显式指定，未设置时按文件后缀自动识别）"
      >
        {{ meta.language }}
      </span>
      <a-button size="small" @click="copyCode">
        <template #icon><Copy :size="12" /></template>
        复制代码
      </a-button>
    </div>

    <a-tabs v-model:active-key="activeTemplate" size="small">
      <a-tab-pane v-for="tpl in templates" :key="tpl.name" :tab="tpl.name" />
    </a-tabs>

    <div v-if="meta?.error" class="render-error">{{ renderOutput?.result }}</div>
    <pre v-else class="code-view"><code class="hljs mono" v-html="renderedHtml"></code></pre>
  </a-modal>
</template>

<style lang="scss" scoped>
.preview-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 6px;

  .file-path {
    flex: 1;
    font-size: 11px;
    color: var(--text-3);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .lang-chip {
    flex-shrink: 0;
    font-size: 10px;
    color: var(--primary-text);
    background: var(--primary-weak);
    border: 1px solid color-mix(in srgb, var(--primary) 30%, transparent);
    border-radius: 4px;
    padding: 0 6px;
    line-height: 18px;
  }
}

.code-view {
  margin: 0;
  max-height: 460px;
  overflow: auto;
  background: var(--code-bg);
  border: 1px solid var(--code-border);
  border-radius: var(--radius-m);
  padding: 12px 14px;
  font-size: 12px;
  line-height: 1.55;

  code {
    font-family: var(--font-mono);
    white-space: pre;
  }
}

.render-error {
  padding: 12px 14px;
  border: 1px solid var(--danger);
  background: var(--danger-weak);
  color: var(--danger);
  border-radius: var(--radius-m);
  font-size: 12px;
  font-family: var(--font-mono);
  white-space: pre-wrap;
}
</style>
