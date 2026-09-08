<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { message, Modal } from 'antdv-next'
import { Plus, Trash2, FileCode, Save } from '@lucide/vue'
import type { CodeTemplate } from '@/types/model'
import { useTemplateStore } from '@/stores/template'
import { useModelStore } from '@/stores/model'
import { highlightCode, languageOfFileName } from '@/utils/highlight'

const templateStore = useTemplateStore()
const model = useModelStore()

onMounted(() => {
  templateStore.init()
  model.init()
})

/* ==================== 列表与编辑状态 ==================== */

const draft = ref<CodeTemplate>({ id: '', name: '', content: '' })
const selectedId = ref('')

function selectTemplate(id: string) {
  const tpl = templateStore.templates.find((t) => t.id === id)
  if (tpl) {
    selectedId.value = id
    draft.value = { id: tpl.id, name: tpl.name, content: tpl.content }
    schedulePreview()
  }
}

function newTemplate() {
  const t = templateStore.newTemplateDraft()
  draft.value = { ...t }
  selectedId.value = ''
  schedulePreview()
}

/* ==================== 实时预览 ==================== */

const previewTableId = computed({
  get: () => templateStore.previewTableId,
  set: (v: string) => {
    templateStore.previewTableId = v
  },
})

const tableOptions = computed(() =>
  model.tables.map((t) => ({ value: t.id, label: `${t.tableName}${t.comment ? `（${t.comment}）` : ''}` })),
)

const previewState = reactive<{ output: string; fileName: string; filePath: string; error: string }>({
  output: '',
  fileName: '',
  filePath: '',
  error: '',
})

let previewTimer: ReturnType<typeof setTimeout> | null = null
function schedulePreview() {
  if (previewTimer) clearTimeout(previewTimer)
  previewTimer = setTimeout(runPreview, 350)
}

function runPreview() {
  if (!draft.value.name && !draft.value.content) {
    previewState.output = ''
    previewState.error = ''
    return
  }
  if (!previewTableId.value) {
    previewState.output = '请先在编辑器中创建表，或从数据库导入表结构。'
    previewState.error = ''
    return
  }
  const out = templateStore.renderFor(draft.value, previewTableId.value)
  if (!out) {
    previewState.output = ''
    previewState.error = '渲染目标不存在'
    return
  }
  previewState.output = out.result || ''
  previewState.fileName = out.fileName
  previewState.filePath = out.filePath
  previewState.error = out.error || ''
}

watch(() => draft.value.content, schedulePreview)
watch(() => draft.value.name, schedulePreview)

/** 模板异步加载完成后选中首个模板（先于本组件挂载时已加载也需处理） */
watch(
  () => templateStore.loaded,
  (loaded) => {
    if (loaded && !draft.value.id && templateStore.templates.length) {
      selectTemplate(templateStore.templates[0].id)
    }
  },
  { immediate: true },
)

/** 模型已加载时设置默认预览表 */
watch(
  () => model.loaded,
  (loaded) => {
    if (loaded && !previewTableId.value && model.tables.length) {
      previewTableId.value = model.tables[0].id
      schedulePreview()
    }
  },
  { immediate: true },
)

const highlighted = computed(() =>
  highlightCode(previewState.output, languageOfFileName(previewState.fileName)),
)

/* ==================== 保存 / 删除 ==================== */

const saving = reactive({ loading: false })

function validate(): string | null {
  if (!draft.value.name.trim()) return '模板名称不能为空'
  if (!draft.value.content.trim()) return '模板内容不能为空'
  return null
}

async function saveTemplate() {
  const err = validate()
  if (err) {
    message.warning(err)
    return
  }
  saving.loading = true
  try {
    const saved = await templateStore.saveTemplate({ ...draft.value })
    draft.value = { ...saved }
    selectedId.value = saved.id
    message.success('模板已保存')
  } catch {
    /* store 已提示 */
  } finally {
    saving.loading = false
  }
}

function deleteTemplate() {
  if (!draft.value.id) {
    newTemplate()
    return
  }
  Modal.confirm({
    title: `删除模板「${draft.value.name}」？`,
    content: '删除后代码生成将不再包含该模板。',
    okText: '删除',
    okType: 'danger',
    cancelText: '取消',
    onOk: async () => {
      await templateStore.removeTemplate(draft.value.id)
      message.success('模板已删除')
      if (templateStore.templates.length) selectTemplate(templateStore.templates[0].id)
      else newTemplate()
    },
  })
}

const isEdit = computed(() => Boolean(draft.value.id))
</script>

<template>
  <div class="template-view">
    <aside class="tpl-list">
      <div class="list-head">
        <span class="list-title">
          <FileCode :size="14" />
          代码模板
        </span>
        <a-button size="small" type="primary" @click="newTemplate">
          <template #icon><Plus :size="12" /></template>
          新增
        </a-button>
      </div>
      <div class="list-body">
        <div
          v-for="t in templateStore.templates"
          :key="t.id"
          class="tpl-item"
          :class="{ selected: selectedId === t.id }"
          @click="selectTemplate(t.id)"
        >
          <span class="tpl-name mono">{{ t.name }}</span>
          <span class="tpl-size">{{ (t.content.length / 1024).toFixed(1) }}k</span>
        </div>
        <div v-if="!templateStore.templates.length" class="list-empty">暂无模板</div>
      </div>
      <div class="list-foot">{{ templateStore.templates.length }} 个模板</div>
    </aside>

    <section class="tpl-main">
      <div class="tpl-head">
        <div class="tpl-name-input">
          <label>模板名称</label>
          <a-input v-model:value="draft.name" size="small" class="mono" placeholder="如 entity" style="width: 220px" />
        </div>
        <div class="tpl-actions">
          <a-popconfirm title="删除该模板？" ok-text="删除" cancel-text="取消" @confirm="deleteTemplate">
            <a-button size="small" danger>
              <template #icon><Trash2 :size="12" /></template>
              删除
            </a-button>
          </a-popconfirm>
          <a-button size="small" type="primary" :loading="saving.loading" @click="saveTemplate">
            <template #icon><Save :size="12" /></template>
            保存模板
          </a-button>
        </div>
      </div>

      <div class="tpl-split">
        <div class="tpl-editor">
          <div class="pane-head">
            <span>模板脚本（Eta 语法，<code>&lt;%# %&gt;</code> 为注释）</span>
          </div>
          <textarea
            v-model="draft.content"
            class="tpl-textarea mono"
            spellcheck="false"
            placeholder="<% context.fileName = 'demo.txt' %>&#10;Hello <%= context.table.tableName %>!"
          ></textarea>
        </div>

        <div class="tpl-preview">
          <div class="pane-head preview-head">
            <span>实时预览</span>
            <a-select
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
          <div v-else-if="previewState.filePath" class="preview-file mono">{{ previewState.filePath }}</div>
          <pre class="code-view"><code class="hljs mono" v-html="highlighted"></code></pre>
        </div>
      </div>

      <div class="tpl-help">
        <div class="help-title">模板上下文变量（context）与工具（utils）</div>
        <div class="help-grid">
          <div class="help-col">
            <p><code>context.templateName</code> 模板名称</p>
            <p><code>context.basePackage</code> 基础包名（表所属分类）</p>
            <p><code>context.fileName / filePath</code> 产物文件名/路径（模板内赋值）</p>
            <p><code>context.table.tableName / className / comment</code> 表信息</p>
            <p><code>context.table.columns</code> 字段数组（columnName/propertyName/type/javaType/comment/notNull/primaryKey/dict）</p>
            <p><code>context.table.indexes</code> 索引数组（indexName/type/columns/comment）</p>
            <p><code>context.table.navigates</code> 单向导航（propertyName/type/self/target/cascade/...）</p>
          </div>
          <div class="help-col">
            <p><code>utils.toCamelCase(str, firstLower?)</code> 转驼峰</p>
            <p><code>utils.toSnakeCase(str)</code> 转蛇形</p>
            <p><code>utils.getJavaType(column)</code> 数据库类型映射 Java 类型</p>
            <p><code>utils.quote(content, cond?)</code> 引号包裹</p>
            <p><code>utils.wrap(content, cond?)</code> 括号包裹</p>
            <p><code>utils.isEmpty(str) / utils.isBlank(str)</code> 判空 / 判空白</p>
            <p><code>&lt;% ... %&gt;</code> 逻辑 <code>&lt;%= ... %&gt;</code> 输出 <code>&lt;%# ... %&gt;</code> 注释</p>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<style lang="scss" scoped>
.template-view {
  display: flex;
  height: 100%;
  overflow: hidden;
}

.tpl-list {
  width: 216px;
  min-width: 216px;
  display: flex;
  flex-direction: column;
  background: var(--bg-panel);
  border-right: 1px solid var(--border);

  .list-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 12px 8px;

    .list-title {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-weight: 600;
      color: var(--text-1);
    }
  }

  .list-body {
    flex: 1;
    overflow-y: auto;
    padding: 0 8px;
  }

  .list-foot {
    padding: 7px 12px;
    border-top: 1px solid var(--border);
    font-size: 10.5px;
    color: var(--text-3);
    font-family: var(--font-mono);
  }
}

.tpl-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  border-radius: var(--radius-m);
  cursor: pointer;
  margin-bottom: 2px;

  &:hover {
    background: var(--bg-hover);
  }

  &.selected {
    background: var(--primary-weak);
  }

  .tpl-name {
    flex: 1;
    font-size: 12.5px;
    font-weight: 600;
    color: var(--text-1);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tpl-size {
    font-size: 10px;
    color: var(--text-3);
    font-family: var(--font-mono);
  }
}

.list-empty {
  padding: 30px 10px;
  text-align: center;
  color: var(--text-3);
  font-size: 12px;
}

.tpl-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 12px 14px;
  gap: 10px;
}

.tpl-head {
  display: flex;
  align-items: flex-end;
  gap: 12px;

  .tpl-name-input {
    display: flex;
    flex-direction: column;
    gap: 4px;

    label {
      font-size: 11.5px;
      color: var(--text-2);
    }
  }

  .tpl-actions {
    margin-left: auto;
    display: flex;
    gap: 8px;
  }
}

.tpl-split {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.tpl-editor,
.tpl-preview {
  display: flex;
  flex-direction: column;
  min-height: 0;
  border: 1px solid var(--border);
  border-radius: var(--radius-m);
  background: var(--bg-panel);
  overflow: hidden;
}

.pane-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 7px 12px;
  border-bottom: 1px solid var(--border);
  font-size: 11.5px;
  color: var(--text-2);
  flex-shrink: 0;

  code {
    font-family: var(--font-mono);
    color: var(--primary-text);
    background: var(--primary-weak);
    border-radius: 3px;
    padding: 0 4px;
  }
}

.preview-head {
  gap: 8px;
}

.tpl-textarea {
  flex: 1;
  border: none;
  outline: none;
  resize: none;
  padding: 12px 14px;
  background: var(--code-bg);
  color: var(--code-text);
  font-size: 12px;
  line-height: 1.6;
  font-family: var(--font-mono);
}

.preview-file {
  padding: 5px 12px;
  font-size: 10.5px;
  color: var(--text-3);
  border-bottom: 1px dashed var(--border);
  background: var(--bg-2);
  flex-shrink: 0;
}

.preview-error {
  padding: 6px 12px;
  font-size: 11px;
  color: var(--danger);
  background: var(--danger-weak);
  border-bottom: 1px dashed var(--danger);
  flex-shrink: 0;
}

.code-view {
  flex: 1;
  margin: 0;
  overflow: auto;
  background: var(--code-bg);
  padding: 12px 14px;
  font-size: 12px;
  line-height: 1.55;

  code {
    font-family: var(--font-mono);
    white-space: pre;
  }
}

.tpl-help {
  flex-shrink: 0;
  border: 1px solid var(--border);
  border-radius: var(--radius-m);
  background: var(--bg-2);
  padding: 8px 12px;

  .help-title {
    font-size: 11.5px;
    font-weight: 600;
    color: var(--text-1);
    margin-bottom: 4px;
  }

  .help-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 2px 20px;
  }

  p {
    margin: 1.5px 0;
    font-size: 11px;
    color: var(--text-3);

    code {
      font-family: var(--font-mono);
      color: var(--primary-text);
      background: var(--primary-weak);
      border-radius: 3px;
      padding: 0 3px;
    }
  }
}
</style>
