<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { message, Modal } from 'antdv-next'
import { Plus, Trash2, FileCode, Save, ChevronDown, ChevronUp, BookText } from '@lucide/vue'
import type { CodeTemplate } from '@/types/model'
import { useTemplateStore } from '@/stores/template'
import { useModelStore } from '@/stores/model'
import { useDictStore } from '@/stores/dict'
import { renderDictCategoryTemplate } from '@/utils/render'
import { highlightCode, resolveLanguage, highlightTemplateSource } from '@/utils/highlight'

const templateStore = useTemplateStore()
const model = useModelStore()
const dictStore = useDictStore()

onMounted(() => {
  templateStore.init()
  model.init()
  dictStore.init()
})

/* ==================== 列表与编辑状态 ==================== */

/** 编辑区模式：table = 表模板（多模板 CRUD）；dict = 字典分类模板（仅一个） */
const activeKind = ref<'table' | 'dict'>('table')

const draft = ref<CodeTemplate>({ id: '', name: '', content: '' })
const selectedId = ref('')

/* ==================== 字典分类模板（仅一个，无新增/删除） ==================== */

const dictDraft = ref<CodeTemplate>({ id: '', name: 'dict', content: '' })
const dictSaving = reactive({ loading: false })
/** 字典模板预览目标分类 */
const previewCatId = ref('')

function selectDictTemplate() {
  activeKind.value = 'dict'
  const t = templateStore.dictCategoryTemplate
  if (t) dictDraft.value = { id: t.id, name: t.name, content: t.content }
  if (!previewCatId.value && dictStore.categories.length) {
    previewCatId.value = dictStore.categories[0].id
  }
  schedulePreview()
}

const categoryOptions = computed(() =>
  dictStore.categories.map((c) => ({
    value: c.id,
    label: `${c.name}（${dictStore.dicts.filter((d) => d.categoryId === c.id).length} 字典）`,
  })),
)

async function saveDictTemplate() {
  if (!dictDraft.value.name.trim()) {
    message.warning('模板名称不能为空')
    return
  }
  if (!dictDraft.value.content.trim()) {
    message.warning('模板内容不能为空')
    return
  }
  dictSaving.loading = true
  try {
    const saved = await templateStore.saveDictCategoryTemplate({ ...dictDraft.value })
    dictDraft.value = { ...saved }
    message.success('字典分类模板已保存')
  } catch {
    /* store 已提示 */
  } finally {
    dictSaving.loading = false
  }
}

function selectTemplate(id: string) {
  const tpl = templateStore.templates.find((t) => t.id === id)
  if (tpl) {
    activeKind.value = 'table'
    selectedId.value = id
    draft.value = { id: tpl.id, name: tpl.name, content: tpl.content }
    schedulePreview()
  }
}

function newTemplate() {
  activeKind.value = 'table'
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
  aborted: boolean
}>({
  output: '',
  fileName: '',
  filePath: '',
  error: '',
  language: '',
  aborted: false,
})

let previewTimer: ReturnType<typeof setTimeout> | null = null
function schedulePreview() {
  if (previewTimer) clearTimeout(previewTimer)
  previewTimer = setTimeout(runPreview, 350)
}

function runPreview() {
  if (activeKind.value === 'dict') return runDictPreview()
  if (!draft.value.name && !draft.value.content) {
    previewState.output = ''
    previewState.error = ''
    previewState.language = ''
    previewState.aborted = false
    return
  }
  if (!previewTableId.value) {
    previewState.output = '请先在编辑器中创建表，或从数据库导入表结构。'
    previewState.error = ''
    previewState.language = ''
    previewState.aborted = false
    return
  }
  const out = templateStore.renderFor(draft.value, previewTableId.value)
  if (!out) {
    previewState.output = ''
    previewState.error = '渲染目标不存在'
    previewState.language = ''
    previewState.aborted = false
    return
  }
  previewState.output = out.result || ''
  previewState.fileName = out.fileName
  previewState.filePath = out.filePath
  previewState.error = out.error || ''
  previewState.language = out.language || ''
  previewState.aborted = Boolean(out.aborted)
}

watch(() => draft.value.content, schedulePreview)
watch(() => draft.value.name, schedulePreview)
watch(() => dictDraft.value.content, schedulePreview)
watch(() => dictDraft.value.name, schedulePreview)
watch(previewCatId, schedulePreview)
/* 切换预览目标表也需重渲染（选项驱动分支/aborted 提示按表变化） */
watch(previewTableId, schedulePreview)

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

/** 字典分类模板实时预览：按目标分类渲染（含分类下全部字典与值） */
function runDictPreview() {
  if (!dictDraft.value.name && !dictDraft.value.content) {
    previewState.output = ''
    previewState.error = ''
    previewState.language = ''
    previewState.aborted = false
    return
  }
  const category = dictStore.categories.find((c) => c.id === previewCatId.value)
  if (!category) {
    previewState.output = '请先在「字典管理」中创建字典分类。'
    previewState.error = ''
    previewState.language = ''
    previewState.aborted = false
    return
  }
  const dicts = dictStore.dicts.filter((d) => d.categoryId === category.id)
  if (!dicts.length) {
    previewState.output = `分类「${category.name}」下暂无字典，生成产物将为空壳。`
    previewState.error = ''
    previewState.language = ''
    previewState.aborted = false
    return
  }
  const out = renderDictCategoryTemplate(
    dictDraft.value.name,
    dictDraft.value.content,
    category,
    dicts,
  )
  previewState.output = out.result || ''
  previewState.fileName = out.fileName
  previewState.filePath = out.filePath
  previewState.error = out.error || ''
  previewState.language = out.language || ''
  previewState.aborted = Boolean(out.aborted)
}

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
/** 当前模式的内容（编辑器与高亮层共用） */
const activeContent = computed(() =>
  activeKind.value === 'dict' ? dictDraft.value.content : draft.value.content,
)

function onEditorInput(e: Event) {
  const v = (e.target as HTMLTextAreaElement).value
  if (activeKind.value === 'dict') dictDraft.value.content = v
  else draft.value.content = v
}

const tablePlaceholder =
  "<% context.fileName = 'demo.txt' %>&#10;Hello <%= context.table.tableName %>!"
const dictPlaceholder =
  '<%# 每个字典分类渲染一次 %>&#10;// <%= context.category.name %> 共 <%= context.dicts.length %> 个字典'

const highlightedSource = computed(() => {
  const html = highlightTemplateSource(activeContent.value)
  return activeContent.value.endsWith('\n') ? `${html}\n` : html
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
          模板管理
        </span>
        <a-button size="small" type="primary" @click="newTemplate">
          <template #icon><Plus :size="12" /></template>
          新增
        </a-button>
      </div>
      <div class="list-body">
        <div class="list-group-title">表模板（每表渲染一次）</div>
        <div
          v-for="t in templateStore.templates"
          :key="t.id"
          class="tpl-item"
          :class="{ selected: activeKind === 'table' && selectedId === t.id }"
          @click="selectTemplate(t.id)"
        >
          <span class="tpl-name mono">{{ t.name }}</span>
          <span class="tpl-size">{{ (t.content.length / 1024).toFixed(1) }}k</span>
        </div>
        <div v-if="!templateStore.templates.length" class="list-empty">暂无表模板</div>
        <div class="list-group-title">字典分类模板（每分类渲染一次）</div>
        <div
          class="tpl-item"
          :class="{ selected: activeKind === 'dict' }"
          @click="selectDictTemplate"
        >
          <span class="tpl-name mono">
            <BookText :size="12" class="tpl-icon" />
            {{ templateStore.dictCategoryTemplate?.name || 'dict' }}
          </span>
          <span class="tpl-size">
            {{ ((templateStore.dictCategoryTemplate?.content.length || 0) / 1024).toFixed(1) }}k
          </span>
        </div>
      </div>
      <div class="list-foot">{{ templateStore.templates.length }} 个表模板 · 1 个字典分类模板</div>
    </aside>

    <section class="tpl-main">
      <div class="tpl-head">
        <!-- 表模板 / 字典分类模板 共用编辑区：按模式绑定不同草稿与保存动作 -->
        <div class="tpl-name-input">
          <label>{{ activeKind === 'dict' ? '字典分类模板名称' : '模板名称' }}</label>
          <a-input
            v-if="activeKind === 'dict'"
            v-model:value="dictDraft.name"
            size="small"
            class="mono"
            placeholder="如 dict"
            style="width: 220px"
          />
          <a-input
            v-else
            v-model:value="draft.name"
            size="small"
            class="mono"
            placeholder="如 entity"
            style="width: 220px"
          />
        </div>
        <div class="tpl-actions">
          <template v-if="activeKind === 'dict'">
            <span class="dict-only-tip">仅一个，无新增 / 删除</span>
            <a-button
              size="small"
              type="primary"
              :loading="dictSaving.loading"
              @click="saveDictTemplate"
            >
              <template #icon><Save :size="12" /></template>
              保存模板
            </a-button>
          </template>
          <template v-else>
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
          </template>
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
              :value="activeKind === 'dict' ? dictDraft.content : draft.content"
              class="tpl-textarea mono"
              spellcheck="false"
              wrap="off"
              :placeholder="activeKind === 'dict' ? dictPlaceholder : tablePlaceholder"
              @input="onEditorInput"
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
      </div>

      <div class="tpl-help">
        <div class="help-title">
          <span>模板上下文变量（context）与工具（utils）</span>
          <!-- 字典分类模板：category / dicts 上下文 -->
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
            <p><code>context.table.tableName / className / comment</code> 表信息（表模板）</p>
            <p>
              <code>context.category.name / basePackage / className</code>
              字典分类信息（字典分类模板；basePackage 基础包路径、className 大驼峰类名——
              产物路径推导依据）
            </p>
            <p>
              <code>context.dicts</code>
              该分类下全部字典（dictKey/label/comment/values：valueKey/propertyName/label/labelType，propertyName
              为常量属性名）（字典分类模板）
            </p>
            <p>
              <code>context.table.columns</code>
              字段数组（columnName/propertyName/type/javaType/comment/notNull/primaryKey/dict）
            </p>
            <p><code>context.table.indexes</code> 索引数组（indexName/type/columns/comment）</p>
            <p>
              <code>context.table.navigates</code>
              单向导航（propertyName/type/comment/self/target/cascade/...）
            </p>
            <p><code>context.hasColumn(name)</code> 按列名判断列是否存在</p>
            <p><code>context.getColumn(name)</code> 按列名获取列（无则 undefined）</p>
            <p><code>context.settings.author</code> 代码作者（生成 javadoc @author）</p>
            <p>
              <code>context.aborted</code> 丢弃本次生成（默认 false；置 true 则该产物不打包进
              zip），例：<code>&lt;% context.aborted = true; return ""; %&gt;</code>
            </p>
          </div>
          <div class="help-col">
            <p><code>utils.toCamelCase(str, firstLower?)</code> 转驼峰</p>
            <p><code>utils.toSnakeCase(str)</code> 转蛇形</p>
            <p><code>utils.getJavaType(column)</code> 数据库类型映射 Java 类型</p>
            <p><code>utils.quote(content, cond?)</code> 引号包裹</p>
            <p><code>utils.wrap(content, cond?)</code> 括号包裹</p>
            <p><code>utils.isEmpty(str) / utils.isBlank(str)</code> 判空 / 判空白</p>
            <p><code>utils.nowDateTime()</code> 当前时间（yyyy-MM-dd HH:mm:ss，javadoc @since）</p>
            <p>
              <code>utils.optionEnabled(options, name)</code>
              读表/列选项是否启用（缺省视为启用），如
              <code>utils.optionEnabled(context.table.options, "add")</code>
            </p>
            <p>
              <code>&lt;% ... %&gt;</code> 逻辑 <code>&lt;%= ... %&gt;</code> 输出
              <code>&lt;%# ... %&gt;</code> 注释
            </p>
            <p>
              输出格式保证：最后一条 <code>import</code> 与后续代码之间自动空一行；
              <code>table.options / column.options</code>
              为表/列选项值（键为选项名称，见系统设置）
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
    .list-group-title {
      padding: 8px 10px 4px;
      font-size: 10.5px;
      font-weight: 600;
      color: var(--dbm-text-3);
      letter-spacing: 0.02em;
    }
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

  .tpl-icon {
    vertical-align: -1.5px;
    margin-right: 2px;
    color: var(--dbm-text-3);
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

  .dict-only-tip {
    font-size: 10.5px;
    color: var(--dbm-text-3);
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
    background: var(--dbm-primary);
    color: var(--dbm-on-primary);
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
