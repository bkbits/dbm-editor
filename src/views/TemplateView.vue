<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { message, Modal } from 'antdv-next'
import { Plus, Trash2, FileCode, Save, ChevronDown, ChevronUp } from '@lucide/vue'
import type { CodeTemplate } from '@/types/model'
import { useTemplateStore } from '@/stores/template'
import { useModelStore } from '@/stores/model'
import { highlightCode, resolveLanguage, highlightTemplateSource } from '@/utils/highlight'

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
  model.tables.map((t) => ({
    value: t.id,
    label: `${t.tableName}${t.comment ? `（${t.comment}）` : ''}`,
  })),
)

const previewState = reactive<{
  output: string
  fileName: string
  filePath: string
  error: string
  language: string
}>({
  output: '',
  fileName: '',
  filePath: '',
  error: '',
  language: '',
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
    previewState.language = ''
    return
  }
  if (!previewTableId.value) {
    previewState.output = '请先在编辑器中创建表，或从数据库导入表结构。'
    previewState.error = ''
    previewState.language = ''
    return
  }
  const out = templateStore.renderFor(draft.value, previewTableId.value)
  if (!out) {
    previewState.output = ''
    previewState.error = '渲染目标不存在'
    previewState.language = ''
    return
  }
  previewState.output = out.result || ''
  previewState.fileName = out.fileName
  previewState.filePath = out.filePath
  previewState.error = out.error || ''
  previewState.language = out.language || ''
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
  highlightCode(previewState.output, resolveLanguage(previewState.fileName, previewState.language)),
)

/** 实际生效的高亮语言（显式指定优先，否则按后缀自动识别） */
const effectiveLanguage = computed(() =>
  previewState.error ? '' : resolveLanguage(previewState.fileName, previewState.language),
)

/* ==================== 模板编辑器：Eta 语法高亮覆盖层 ==================== */

const editorRef = ref<HTMLTextAreaElement>()
const overlayRef = ref<HTMLElement>()

/** 编辑器源码高亮（highlights-eta 插件：<% %> 逻辑 / <%= %> 输出 / <%# %> 注释区分着色）
 *  尾行补偿：内容以换行结尾时补一个换行，保证覆盖层与 textarea 的滚动高度一致 */
const highlightedSource = computed(() => {
  const html = highlightTemplateSource(draft.value.content)
  return draft.value.content.endsWith('\n') ? `${html}\n` : html
})

/** 覆盖层滚动位置与 textarea 同步（输入/滚动时保持逐行对齐） */
function syncScroll() {
  const ta = editorRef.value
  const pre = overlayRef.value
  if (!ta || !pre) return
  pre.scrollTop = ta.scrollTop
  pre.scrollLeft = ta.scrollLeft
}

/* ==================== 帮助面板折叠（移动端默认折叠，转宽屏复位展开） ==================== */

const helpOpen = ref(true)
let helpMq: MediaQueryList | null = null

function onHelpViewportChange(e: MediaQueryListEvent) {
  /* 窄屏转宽屏：复位展开（桌面帮助面板始终可见）；反向切换保留用户当前状态 */
  if (!e.matches) helpOpen.value = true
}

onMounted(() => {
  helpMq = window.matchMedia('(max-width: 768px)')
  helpOpen.value = !helpMq.matches
  helpMq.addEventListener('change', onHelpViewportChange)
})

onBeforeUnmount(() => {
  helpMq?.removeEventListener('change', onHelpViewportChange)
})

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
          <a-input
            v-model:value="draft.name"
            size="small"
            class="mono"
            placeholder="如 entity"
            style="width: 220px"
          />
        </div>
        <div class="tpl-actions">
          <a-popconfirm
            title="删除该模板？"
            ok-text="删除"
            cancel-text="取消"
            @confirm="deleteTemplate"
          >
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
            <span>模板脚本（Eta 语法高亮，<code>&lt;%# %&gt;</code> 为注释）</span>
          </div>
          <div class="editor-code-wrap">
            <!-- 高亮覆盖层：与 textarea 完全同构的排版，位于其下方，不可交互 -->
            <pre
              ref="overlayRef"
              class="code-overlay mono"
              aria-hidden="true"
            ><code class="hljs" v-html="highlightedSource"></code></pre>
            <textarea
              ref="editorRef"
              v-model="draft.content"
              class="tpl-textarea mono"
              spellcheck="false"
              wrap="off"
              placeholder="<% context.fileName = 'demo.txt' %>&#10;Hello <%= context.table.tableName %>!"
              @scroll="syncScroll"
            ></textarea>
          </div>
        </div>

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
          <div v-else-if="previewState.filePath" class="preview-file mono">
            {{ previewState.filePath }}
          </div>
          <pre class="code-view"><code class="hljs mono" v-html="highlighted"></code></pre>
        </div>
      </div>

      <div class="tpl-help">
        <div class="help-title">
          <span>模板上下文变量（context）与工具（utils）</span>
          <button
            class="help-toggle"
            type="button"
            :aria-expanded="helpOpen"
            aria-label="展开 / 收起帮助面板"
            title="展开 / 收起帮助面板"
            @click="helpOpen = !helpOpen"
          >
            <ChevronUp v-if="helpOpen" :size="14" />
            <ChevronDown v-else :size="14" />
          </button>
        </div>
        <div v-show="helpOpen" class="help-grid">
          <div class="help-col">
            <p><code>context.templateName</code> 模板名称</p>
            <p><code>context.basePackage</code> 基础包名（表所属分类）</p>
            <p><code>context.fileName / filePath</code> 产物文件名/路径（模板内赋值）</p>
            <p>
              <code>context.language</code> 显式指定预览高亮语言，如
              <code>&lt;% context.language = 'java' %&gt;</code>（未设置时按文件后缀自动识别）
            </p>
            <p><code>context.table.tableName / className / comment</code> 表信息</p>
            <p>
              <code>context.table.columns</code>
              字段数组（columnName/propertyName/type/javaType/comment/notNull/primaryKey/dict）
            </p>
            <p><code>context.table.indexes</code> 索引数组（indexName/type/columns/comment）</p>
            <p>
              <code>context.table.navigates</code>
              单向导航（propertyName/type/self/target/cascade/...）
            </p>
          </div>
          <div class="help-col">
            <p><code>utils.toCamelCase(str, firstLower?)</code> 转驼峰</p>
            <p><code>utils.toSnakeCase(str)</code> 转蛇形</p>
            <p><code>utils.getJavaType(column)</code> 数据库类型映射 Java 类型</p>
            <p><code>utils.quote(content, cond?)</code> 引号包裹</p>
            <p><code>utils.wrap(content, cond?)</code> 括号包裹</p>
            <p><code>utils.isEmpty(str) / utils.isBlank(str)</code> 判空 / 判空白</p>
            <p>
              <code>&lt;% ... %&gt;</code> 逻辑 <code>&lt;%= ... %&gt;</code> 输出
              <code>&lt;%# ... %&gt;</code> 注释
            </p>
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
  background: var(--dbm-bg-panel);
  border-right: 1px solid var(--dbm-border);

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
      color: var(--dbm-text-1);
    }
  }

  .list-body {
    flex: 1;
    overflow-y: auto;
    padding: 0 8px;
  }

  .list-foot {
    padding: 7px 12px;
    border-top: 1px solid var(--dbm-border);
    font-size: 10.5px;
    color: var(--dbm-text-3);
    font-family: var(--dbm-font-mono);
  }
}

.tpl-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  border-radius: var(--dbm-radius-m);
  cursor: pointer;
  margin-bottom: 2px;

  &:hover {
    background: var(--dbm-bg-hover);
  }

  &.selected {
    background: var(--dbm-primary-weak);
  }

  .tpl-name {
    flex: 1;
    font-size: 12.5px;
    font-weight: 600;
    color: var(--dbm-text-1);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tpl-size {
    font-size: 10px;
    color: var(--dbm-text-3);
    font-family: var(--dbm-font-mono);
  }
}

.list-empty {
  padding: 30px 10px;
  text-align: center;
  color: var(--dbm-text-3);
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
      color: var(--dbm-text-2);
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

/* ============ 高亮覆盖层编辑器 ============
 * textarea 置于高亮 pre 之上：文字透明、光标可见，背景透出下方高亮层；
 * 两层使用完全一致的字体/字号/行高/内边距/换行策略，逐字符对齐。 */
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
    background: var(--dbm-primary-weak);
  }
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

.tpl-help {
  flex-shrink: 0;
  border: 1px solid var(--dbm-border);
  border-radius: var(--dbm-radius-m);
  background: var(--dbm-bg-2);
  padding: 8px 12px;

  .help-title {
    font-size: 11.5px;
    font-weight: 600;
    color: var(--dbm-text-1);
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
    color: var(--dbm-text-3);

    code {
      font-family: var(--dbm-font-mono);
      color: var(--dbm-primary-text);
      background: var(--dbm-primary-weak);
      border-radius: 3px;
      padding: 0 3px;
    }
  }
}

/* 帮助面板折叠开关：桌面隐藏（面板始终展开），移动端样式见下方媒体查询 */
.help-toggle {
  display: none;
}

/* ===== 移动端适配：模板列表转顶部条区，编辑/预览单列堆叠；帮助面板可折叠 ===== */
@media (max-width: 768px) {
  .template-view {
    flex-direction: column;
  }

  .tpl-list {
    width: 100%;
    min-width: 0;
    max-height: 26vh;
    border-right: none;
    border-bottom: 1px solid var(--dbm-border);
  }

  .tpl-main {
    flex: 1;
    min-height: 0;
    padding: 10px;
    gap: 8px;
  }

  .tpl-head {
    flex-wrap: wrap;
    gap: 8px;

    .tpl-actions {
      margin-left: auto;
    }
  }

  /* 桌面左右分屏 → 上下堆叠（编辑在上、预览在下，各自可滚）。
   * 行轨最小值必须归零：minmax(180px,…)/minmax(160px,…) 硬最小值之和超出弹性
   * 剩余高度时，网格内容会溢出容器与下方帮助面板重叠（本块为该缺陷修复） */
  .tpl-split {
    grid-template-columns: 1fr;
    grid-template-rows: minmax(0, 42fr) minmax(0, 58fr);
    gap: 8px;
  }

  .help-title {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  .help-toggle {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    width: 28px;
    height: 28px;
    border: none;
    border-radius: var(--dbm-radius-s);
    background: transparent;
    color: var(--dbm-text-3);
    cursor: pointer;

    &:active {
      background: var(--dbm-bg-hover);
    }
  }

  /* 展开时限高内部滚动：单列自然高度约 400px，不限高会挤占代码区甚至溢出主区 */
  .tpl-help {
    max-height: 40vh;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;

    .help-grid {
      grid-template-columns: 1fr;
    }
  }
}
</style>
