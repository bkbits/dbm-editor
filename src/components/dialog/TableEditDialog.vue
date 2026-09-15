<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { message } from 'antdv-next'
import { Plus, Trash2, GripVertical, Lock, ShieldCheck } from '@lucide/vue'
import type { AuditFieldRole, OptionSetting, TableColumn, TableIndex } from '@/types/model'
import { useUiStore } from '@/stores/ui'
import { useModelStore } from '@/stores/model'
import { useDictStore } from '@/stores/dict'
import { useCanvasStore } from '@/stores/canvas'
import { useSettingsStore } from '@/stores/settings'
import { useTemplateStore } from '@/stores/template'
import { toCamelCase } from '@/utils/string'
import { getJavaTypeByType, COMMON_DB_TYPES, COMMON_JAVA_TYPES } from '@/utils/javaType'
import { uid } from '@/utils/id'
import { NAVIGATE_TYPE_LABEL, CASCADE_LABEL, flipNavigateType } from '@/utils/navigate'
import { useDragSort } from '@/composables/useDragSort'
import {
  AUDIT_FIELD_LABELS,
  AUDIT_FIELD_NOT_NULL,
  AUDIT_FIELD_ROLES,
} from '@/utils/fieldConvention'

const ui = useUiStore()
const model = useModelStore()
const dictStore = useDictStore()
const canvas = useCanvasStore()
const settingsStore = useSettingsStore()
const templateStore = useTemplateStore()

type DraftColumn = TableColumn & {
  _propTouched?: boolean
  _javaTouched?: boolean
  /** 列选项扁平值（UI 编辑态；保存时转换为 TableColumn.options） */
  _optVals: Record<string, boolean | string>
}
type DraftIndex = TableIndex

/* ==================== 选项工具（表/列选项扁平值 ⇄ options 记录） ==================== */

/** 已存 options 记录 → 扁平值（不含定义色限，按存值展开） */
function flattenRawOptions(
  options?: Record<string, { value?: boolean | string | number }>,
): Record<string, any> {
  const out: Record<string, any> = {}
  for (const [name, entry] of Object.entries(options || {})) {
    out[name] =
      entry?.value === undefined || entry?.value === null ? true : (entry.value as boolean)
  }
  return out
}

/** 补齐缺失定义的默认值（不动已有值；boolean 默认 true，其余空串） */
function fillOptionDefaults(vals: Record<string, boolean | string>, defs: OptionSetting[]): void {
  for (const def of defs) {
    if (vals[def.name] === undefined) vals[def.name] = def.type === 'boolean' ? true : ''
  }
}

/** 扁平值 → options 记录：boolean 仅存 false（true=默认缺省即启用），非 boolean 存非空值 */
function buildOptionRecord<T extends { name: string; value?: boolean | string | number }>(
  vals: Record<string, boolean | string>,
  defs: OptionSetting[],
  makeEntry: (name: string, value: boolean | string | number) => T,
): Record<string, T> | undefined {
  const out: Record<string, T> = {}
  for (const def of defs) {
    const v = vals[def.name]
    if (def.type === 'boolean') {
      if (v === false) out[def.name] = makeEntry(def.name, false)
    } else {
      const s = String(v ?? '').trim()
      if (s) {
        const numeric = def.type === 'int' || def.type === 'long' || def.type === 'double'
        out[def.name] = makeEntry(def.name, numeric ? Number(s) : s)
      }
    }
  }
  return Object.keys(out).length ? out : undefined
}

const isEdit = computed(() => Boolean(ui.tableEdit.tableId))

const draft = reactive({
  id: '',
  categoryId: '',
  tableName: '',
  className: '',
  comment: '',
  parentIdColumn: '', // 树形表父ID字段，空代表非树形表
  x: 0,
  y: 0,
  columns: [] as DraftColumn[],
  indexes: [] as DraftIndex[],
  activeTab: 'columns',
  /** 启用的模板（显式选择；空 = 启用全部，配合 templatesExplicit/templatesTouched 语义） */
  templates: [] as string[],
  /** 表选项扁平值（UI 编辑态；boolean 定义存 boolean，其余存 string） */
  optionVals: {} as Record<string, any>,
})

/** 表模板选择：未显式配置且未手动改动时展示全部（响应式跟随模板加载） */
const templatesExplicit = ref(false)
const templatesTouched = ref(false)
const templatesSelected = computed<string[]>({
  get: () =>
    templatesExplicit.value || templatesTouched.value
      ? draft.templates
      : [...templateStore.templateNames],
  set: (vals) => {
    templatesTouched.value = true
    draft.templates = vals
  },
})
const templateCheckOptions = computed(() =>
  templateStore.templates.map((t) => ({ value: t.name, label: t.name })),
)

/** 表选项定义（来自应用设置） */
const tableOptionDefs = computed(() => settingsStore.tableOptions)
/** 列选项定义（来自应用设置，驱动字段表格动态选项列） */
const columnOptionDefs = computed(() => settingsStore.columnOptions)

/** 字段表格网格模板：基础列 + 列选项动态列（boolean=勾选列，其余=输入列） */
const colsGridStyle = computed(() => {
  const defs = settingsStore.columnOptions
  if (!defs.length) return undefined
  const extra = defs.map((d) => (d.type === 'boolean' ? '42px' : '96px')).join(' ')
  return {
    gridTemplateColumns: `28px minmax(96px, 1fr) minmax(84px, 1fr) 132px 118px 44px 44px 108px minmax(72px, 1fr) ${extra} 26px`,
  }
})

/** 树形表开关：开启时父ID字段默认 parent_id，关闭时清空 */
const treeEnabled = computed({
  get: () => Boolean(draft.parentIdColumn.trim()),
  set: (v: boolean) => {
    draft.parentIdColumn = v ? draft.parentIdColumn.trim() || 'parent_id' : ''
  },
})

const dialogOpen = computed(() => ui.tableEdit.open)

watch(dialogOpen, (open) => {
  if (!open) return
  dictStore.init()
  // 索引类型选项来自应用设置（首次打开时预载）
  settingsStore.init()
  // 模板列表用于「启用模板」多选
  templateStore.init()
  templatesTouched.value = false
  const state = ui.tableEdit
  if (state.tableId) {
    const t = model.tableById(state.tableId)
    if (!t) return
    draft.id = t.id
    draft.categoryId = t.categoryId
    draft.tableName = t.tableName
    draft.className = t.className || ''
    draft.comment = t.comment || ''
    draft.parentIdColumn = t.parentIdColumn || ''
    draft.x = t.x ?? 0
    draft.y = t.y ?? 0
    const rawTpl = (t.templates ?? '').trim()
    templatesExplicit.value = Boolean(rawTpl)
    draft.templates = rawTpl
      ? rawTpl
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : []
    draft.optionVals = flattenRawOptions(t.options)
    draft.columns = normalizePkColumn(
      model.columnsOf(t.id).map((c) => ({
        ...c,
        _optVals: flattenRawOptions(c.options),
      })),
    )
    draft.indexes = model.indexesOf(t.id).map((i) => ({ ...i, columns: [...i.columns] }))
    fillOptionDefaults(draft.optionVals, settingsStore.tableOptions)
    for (const col of draft.columns)
      fillOptionDefaults((col._optVals ||= {}), settingsStore.columnOptions)
  } else {
    const world =
      state.position ?? canvas.screenToWorld({ x: canvas.viewportW / 2, y: canvas.viewportH / 2 })
    draft.id = ''
    draft.categoryId = state.defaultCategoryId || model.categories[0]?.id || ''
    draft.tableName = ''
    draft.className = ''
    draft.comment = ''
    draft.parentIdColumn = ''
    draft.x = world.x - 130
    draft.y = world.y - 60
    templatesExplicit.value = false
    draft.templates = []
    draft.optionVals = {}
    // 新建表：首字段固定为设置约定的主键字段
    draft.columns = [makePkColumn()]
    draft.indexes = []
  }
  draft.activeTab = 'columns'
})

/** 选项定义异步加载后补齐缺失默认值（不动已加载的显式值） */
watch(
  () => settingsStore.tableOptions,
  (defs) => fillOptionDefaults(draft.optionVals, defs),
)
watch(
  () => settingsStore.columnOptions,
  (defs) => {
    for (const col of draft.columns) fillOptionDefaults((col._optVals ||= {}), defs)
  },
)

/* ==================== 字段编辑 ==================== */

const categoryOptions = computed(() =>
  model.categories.map((c) => ({ value: c.id, label: `${c.name}（${c.basePackage}）` })),
)
const dictOptions = computed(() => [
  { value: '', label: '（无字典）' },
  ...dictStore.dicts.map((d) => ({ value: d.dictKey, label: `${d.dictKey} · ${d.label}` })),
])

const dbTypeOptions = COMMON_DB_TYPES.map((t) => ({ value: t, label: t }))
const javaTypeOptions = COMMON_JAVA_TYPES.map((t) => ({ value: t, label: t }))

/* ==================== 主键与审计字段约定（来自应用设置） ==================== */

const conventions = computed(() => settingsStore.fieldConventions)

/** 主键行 = 首行（固定不可修改、不可排序） */
function isPkRow(idx: number): boolean {
  return idx === 0
}

/** 依约定构造主键字段草稿 */
function makePkColumn(): DraftColumn {
  const pk = conventions.value.primaryKey
  const col: DraftColumn = {
    id: uid('c-'),
    tableId: '',
    columnName: pk.name,
    propertyName: toCamelCase(pk.name, true),
    sort: 0,
    type: pk.type,
    javaType: getJavaTypeByType(pk.type),
    comment: '主键',
    notNull: true,
    primaryKey: true,
    dict: '',
    _optVals: {},
  }
  // 列选项默认值在创建时即补齐（设置未加载时为空列表，加载后 watch 兜底）
  fillOptionDefaults(col._optVals, settingsStore.columnOptions)
  return col
}

/** 依约定构造审计字段草稿（非空约束随角色固定语义；Java 类型显式设定优先，空则按类型映射规则推导） */
function makeAuditColumn(role: AuditFieldRole): DraftColumn {
  const conv = conventions.value.auditFields[role]
  const col: DraftColumn = {
    id: uid('c-'),
    tableId: '',
    columnName: conv.name,
    propertyName: toCamelCase(conv.name, true),
    sort: draft.columns.length,
    type: conv.type,
    javaType:
      conv.javaType || (settingsStore.matchJavaType(conv.type) ?? getJavaTypeByType(conv.type)),
    comment: AUDIT_FIELD_LABELS[role],
    notNull: AUDIT_FIELD_NOT_NULL[role],
    primaryKey: false,
    dict: '',
    _optVals: {},
  }
  fillOptionDefaults(col._optVals, settingsStore.columnOptions)
  return col
}

/**
 * 打开既有表时归一：主键字段强制存在且固定为首行——
 * 已有同名列则上移到首位并对齐约定属性（名称/类型/主键/非空），
 * 没有则依约定补建；其余列一律清除主键标记（单一主键语义，与模板渲染假定一致）
 */
function normalizePkColumn(cols: DraftColumn[]): DraftColumn[] {
  const pk = conventions.value.primaryKey
  const pkName = pk.name.trim()
  const out = [...cols]
  const idx = out.findIndex((c) => c.columnName.trim() === pkName)
  let pkCol: DraftColumn
  if (idx >= 0) {
    ;[pkCol] = out.splice(idx, 1)
    pkCol.columnName = pkName
    pkCol.type = pk.type
    pkCol.javaType = getJavaTypeByType(pk.type)
    pkCol.notNull = true
    pkCol.primaryKey = true
    pkCol.propertyName = toCamelCase(pkName, true)
  } else {
    pkCol = makePkColumn()
  }
  for (const c of out) c.primaryKey = false
  const result = [pkCol, ...out]
  result.forEach((c, i) => (c.sort = i))
  return result
}

/** 当前表中是否已存在指定名称的字段 */
function hasColumnName(name: string): boolean {
  const n = name.trim()
  return Boolean(n) && draft.columns.some((c) => c.columnName.trim() === n)
}

/** 审计字段约定名列表（按当前设置） */
const auditNames = computed(() =>
  AUDIT_FIELD_ROLES.map((role) => conventions.value.auditFields[role].name.trim()).filter(Boolean),
)
const allAuditPresent = computed(() => auditNames.value.every((n) => hasColumnName(n)))
const anyAuditPresent = computed(() => auditNames.value.some((n) => hasColumnName(n)))
const auditNamesLabel = computed(() => auditNames.value.join(' · '))

/** 一键补齐审计字段（已存在的同名字段跳过，不动用户数据） */
function addAuditFields() {
  let added = 0
  for (const role of AUDIT_FIELD_ROLES) {
    const name = conventions.value.auditFields[role].name.trim()
    if (!name || hasColumnName(name)) continue
    draft.columns.push(makeAuditColumn(role))
    added++
  }
  renumber()
  if (added) message.success(`已按设置约定添加 ${added} 个审计字段`)
  else message.info('审计字段均已存在，无需添加')
}

/** 一键移除审计字段（仅删约定名称匹配的列，主键首行不受影响） */
function removeAuditFields() {
  const names = new Set(auditNames.value)
  const before = draft.columns.length
  draft.columns = draft.columns.filter((c, i) => i === 0 || !names.has(c.columnName.trim()))
  renumber()
  const removed = before - draft.columns.length
  if (removed) message.success(`已移除 ${removed} 个审计字段`)
  else message.info('当前表没有约定名称的审计字段')
}

function addColumn() {
  const col: DraftColumn = {
    id: uid('c-'),
    tableId: '',
    columnName: '',
    propertyName: '',
    sort: draft.columns.length,
    type: 'VARCHAR(50)',
    javaType: 'String',
    comment: '',
    notNull: false,
    primaryKey: false,
    dict: '',
    _optVals: {},
  }
  // 新建字段即补齐列选项默认值（修复：选项复选框缺省应显示为启用）
  fillOptionDefaults(col._optVals, settingsStore.columnOptions)
  draft.columns.push(col)
}
function removeColumn(idx: number) {
  if (isPkRow(idx)) return // 主键首行不可删除
  draft.columns.splice(idx, 1)
  renumber()
}

/* 字段拖拽排序（手柄触发，替代上移/下移按钮；主键首行锁定不可拖、不可插入其上方） */
const columnDrag = useDragSort(() => draft.columns, renumber, { lockCount: 1 })
function renumber() {
  draft.columns.forEach((c, i) => (c.sort = i))
}
function onColumnName(col: DraftColumn) {
  if (!col._propTouched) col.propertyName = toCamelCase(col.columnName, true)
}
function onTypeChange(col: DraftColumn) {
  if (!col._javaTouched) col.javaType = getJavaTypeByType(col.type)
}
function onTableNameBlur() {
  if (!isEdit.value && !draft.className.trim() && draft.tableName.trim()) {
    draft.className = toCamelCase(draft.tableName)
  }
}

/* ==================== 索引编辑 ==================== */

function addIndex() {
  draft.indexes.push({
    id: uid('i-'),
    tableId: '',
    indexName: '',
    type: 'NORMAL',
    columns: [],
    comment: '',
  })
}
function removeIndex(idx: number) {
  draft.indexes.splice(idx, 1)
}
const indexTypeOptions = computed(() =>
  settingsStore.indexTypeOptions.map((v) => ({ value: v, label: v })),
)
const columnSelectOptions = computed(() =>
  draft.columns
    .filter((c) => c.columnName.trim())
    .map((c) => ({ value: c.columnName, label: c.columnName })),
)

/* ==================== 导航列表（实时来自 store） ==================== */

const tableNavs = computed(() => (draft.id ? model.navigatesOf(draft.id) : []))

function navView(nav: (typeof tableNavs.value)[number]) {
  const isSelf = nav.self === draft.id
  const type = isSelf ? nav.type : flipNavigateType(nav.type)
  return {
    id: nav.id,
    type,
    typeLabel: NAVIGATE_TYPE_LABEL[type],
    selfName: model.tableById(nav.self)?.tableName ?? '?',
    targetName: model.tableById(nav.target)?.tableName ?? '?',
    selfProp: nav.selfPropertyName,
    targetProp: nav.targetPropertyName,
    cascadeAB: CASCADE_LABEL[nav.selfToTargetCascade],
    cascadeBA: CASCADE_LABEL[nav.targetToSelfCascade],
  }
}

async function deleteNavigate(id: string) {
  await model.removeNavigate(id)
  message.success('导航已删除')
}

/* 父ID字段候选：当前字段列表 */
const parentColumnOptions = computed(() =>
  draft.columns
    .filter((c) => c.columnName.trim())
    .map((c) => ({ value: c.columnName, label: c.columnName })),
)

/* ==================== 校验与保存 ==================== */

const saving = reactive({ loading: false })

function validate(): string | null {
  if (!draft.categoryId) return '请选择所属分类'
  if (!draft.tableName.trim()) return '表名不能为空'
  const dupName = model.tables.find(
    (t) => t.tableName === draft.tableName.trim() && t.id !== draft.id,
  )
  if (dupName) return `表名已存在：${draft.tableName}`
  // 主键不变量：首字段固定为设置约定的主键字段（正常交互下构造保证，此为兑底校验）
  const pkName = conventions.value.primaryKey.name.trim()
  if (!draft.columns.length || draft.columns[0].columnName.trim() !== pkName) {
    return `首字段必须为主键字段「${pkName}」（可在系统设置中调整约定）`
  }
  const names = new Set<string>()
  for (const c of draft.columns) {
    if (!c.columnName.trim()) return '存在空字段名'
    if (names.has(c.columnName)) return `字段名重复：${c.columnName}`
    names.add(c.columnName)
  }
  const idxNames = new Set<string>()
  for (const i of draft.indexes) {
    if (!i.indexName.trim()) return '存在空索引名'
    if (idxNames.has(i.indexName)) return `索引名重复：${i.indexName}`
    idxNames.add(i.indexName)
    if (!i.columns.length) return `索引 ${i.indexName} 未选择字段`
    for (const col of i.columns) {
      if (!names.has(col)) return `索引 ${i.indexName} 引用了不存在的字段：${col}`
    }
  }
  if (treeEnabled.value) {
    const parentCol = draft.parentIdColumn.trim()
    if (!parentCol) return '树形表需填写父ID字段'
    if (!names.has(parentCol)) return `树形父ID字段「${parentCol}」不存在，请先在字段列表中添加`
  }
  // 启用模板：空字符串语义为「启用全部」，无法表达「一个都不启用」——手动取消全部时拦截
  if (templateStore.templates.length && templatesSelected.value.length === 0) {
    return '启用模板不能为空（全选即启用全部模板）'
  }
  return null
}

async function save() {
  const err = validate()
  if (err) {
    message.warning(err)
    return
  }
  saving.loading = true
  try {
    // 全选（或模板列表为空）→ 存 undefined（启用全部）；否则存逗号分割的显式列表
    const templatesStr =
      templateStore.templates.length &&
      templatesSelected.value.length !== templateStore.templateNames.length
        ? templatesSelected.value.join(',')
        : undefined
    const tableOptions = buildOptionRecord(
      draft.optionVals,
      settingsStore.tableOptions,
      (name, value) => ({ tableId: draft.id, name, value }),
    )
    const columns = draft.columns.map((c) => ({
      id: c.id,
      tableId: draft.id,
      columnName: c.columnName.trim(),
      propertyName: (c.propertyName || toCamelCase(c.columnName, true)).trim(),
      sort: c.sort,
      type: c.type,
      javaType: c.javaType || getJavaTypeByType(c.type),
      comment: c.comment || '',
      notNull: c.notNull,
      primaryKey: c.primaryKey,
      dict: c.dict || '',
      options: buildOptionRecord(c._optVals || {}, settingsStore.columnOptions, (name, value) => ({
        columnId: c.id,
        name,
        value,
      })),
    }))
    const indexes = draft.indexes.map((i) => ({
      id: i.id,
      tableId: draft.id,
      indexName: i.indexName.trim(),
      type: i.type,
      columns: [...i.columns],
      comment: i.comment || '',
    }))
    if (isEdit.value) {
      await model.saveTable({
        id: draft.id,
        categoryId: draft.categoryId,
        tableName: draft.tableName.trim(),
        className: draft.className.trim() || toCamelCase(draft.tableName),
        comment: draft.comment.trim(),
        parentIdColumn: treeEnabled.value ? draft.parentIdColumn.trim() : undefined,
        x: draft.x,
        y: draft.y,
        templates: templatesStr,
        options: tableOptions,
        columns,
        indexes,
      })
      message.success(`表「${draft.tableName}」已更新`)
    } else {
      const newId = await model.createTable({
        categoryId: draft.categoryId,
        tableName: draft.tableName.trim(),
        className: draft.className.trim() || toCamelCase(draft.tableName),
        comment: draft.comment.trim(),
        parentIdColumn: treeEnabled.value ? draft.parentIdColumn.trim() : undefined,
        x: draft.x,
        y: draft.y,
        templates: templatesStr,
        options: tableOptions,
        columns,
        indexes,
      })
      canvas.setSelection([newId])
      canvas.centerOnTable(newId)
      message.success(`表「${draft.tableName}」已创建`)
    }
    ui.closeTableEdit()
  } catch (e: unknown) {
    message.error((e as Error)?.message || '保存失败')
  } finally {
    saving.loading = false
  }
}
</script>

<template>
  <a-modal
    :open="dialogOpen"
    :title="isEdit ? `编辑表 · ${draft.tableName || ''}` : '新增表'"
    width="min(980px, 94vw)"
    wrap-class-name="dbm-modal-wrap"
    :mask-closable="false"
    @cancel="ui.closeTableEdit()"
  >
    <template #footer>
      <a-button @click="ui.closeTableEdit()">取消</a-button>
      <a-button type="primary" :loading="saving.loading" @click="save">保存</a-button>
    </template>

    <div class="form-grid">
      <div class="form-item">
        <label>所属分类<span class="req">*</span></label>
        <a-select
          v-model:value="draft.categoryId"
          :options="categoryOptions"
          placeholder="选择分类"
          size="small"
        />
      </div>
      <div class="form-item">
        <label>表名<span class="req">*</span></label>
        <a-input
          v-model:value="draft.tableName"
          placeholder="如 sys_user"
          size="small"
          @blur="onTableNameBlur"
        />
      </div>
      <div class="form-item">
        <label>实体类名</label>
        <a-input v-model:value="draft.className" placeholder="默认表名大驼峰" size="small" />
      </div>
      <div class="form-item grow">
        <label>表注释</label>
        <a-input v-model:value="draft.comment" placeholder="选填" size="small" />
      </div>
      <div class="form-item tree-item">
        <label>树形表</label>
        <div class="tree-row">
          <a-checkbox v-model:checked="treeEnabled">启用（父ID字段）</a-checkbox>
          <a-auto-complete
            v-model:value="draft.parentIdColumn"
            :options="parentColumnOptions"
            :disabled="!treeEnabled"
            size="small"
            class="mono tree-input"
            placeholder="parent_id"
            :filter-option="
              (input: string, option: any) =>
                String(option.value).toLowerCase().includes(input.toLowerCase())
            "
          />
        </div>
      </div>

      <div class="form-item full-item">
        <label>启用模板</label>
        <div class="tpl-check-row">
          <a-checkbox-group
            v-model:value="templatesSelected"
            :options="templateCheckOptions"
            class="tpl-check-group"
          />
          <span class="field-tip">全选或不配置 = 启用全部模板，代码生成仅包含所选模板</span>
        </div>
      </div>

      <div v-if="tableOptionDefs.length" class="form-item full-item">
        <label>表选项</label>
        <div class="opt-row">
          <template v-for="def in tableOptionDefs" :key="def.name">
            <a-checkbox
              v-if="def.type === 'boolean'"
              v-model:checked="draft.optionVals[def.name]"
              :title="def.remark || def.label"
            >
              {{ def.label }}
            </a-checkbox>
            <span v-else class="opt-input-wrap" :title="def.remark || def.label">
              <span class="opt-label">{{ def.label }}</span>
              <a-input
                v-model:value="draft.optionVals[def.name]"
                size="small"
                class="mono opt-input"
                :placeholder="def.name"
              />
            </span>
          </template>
        </div>
      </div>
    </div>

    <a-tabs v-model:active-key="draft.activeTab" size="small" class="edit-tabs">
      <!-- ========== 字段（窄屏整体横向滚动：表头与行同滚） ========== -->
      <a-tab-pane key="columns" :tab="`字段（${draft.columns.length}）`">
        <div class="grid-scroll">
          <div class="columns-head cols-grid" :style="colsGridStyle">
            <span class="h-sort">排序</span>
            <span>字段名</span>
            <span>Java属性名</span>
            <span>数据库类型</span>
            <span>Java类型</span>
            <span class="h-center">非空</span>
            <span class="h-center">主键</span>
            <span>字典</span>
            <span>注释</span>
            <span
              v-for="def in columnOptionDefs"
              :key="def.name"
              class="h-center opt-head"
              :title="`${def.label}：${def.remark || def.name}`"
            >
              {{ def.label }}
            </span>
            <span></span>
          </div>
          <div class="columns-body">
            <div
              v-for="(col, idx) in draft.columns"
              :key="col.id"
              class="column-row cols-grid"
              :class="[columnDrag.rowClass(idx), { 'pk-row': isPkRow(idx) }]"
              :data-idx="idx"
              :style="colsGridStyle"
              :draggable="columnDrag.state.from === idx"
              @dragstart="columnDrag.onDragStart(idx, $event)"
              @dragend="columnDrag.onDragEnd()"
              @dragover.prevent="columnDrag.onDragOver(idx, $event)"
              @drop.prevent="columnDrag.onDrop()"
            >
              <!-- 主键首行：锁定图标（不可拖拽排序）；其余行：拖拽手柄 -->
              <span
                v-if="isPkRow(idx)"
                class="drag-handle pk-lock"
                title="主键字段（依设置约定固定为第一个字段，不可修改、不可排序）"
              >
                <Lock :size="12" />
              </span>
              <span
                v-else
                class="drag-handle"
                title="拖拽排序"
                @pointerdown="columnDrag.handleDown(idx)"
              >
                <GripVertical :size="13" />
              </span>
              <a-input
                v-model:value="col.columnName"
                size="small"
                class="mono"
                placeholder="字段名"
                :disabled="isPkRow(idx)"
                @change="onColumnName(col)"
              />
              <a-input
                v-model:value="col.propertyName"
                size="small"
                class="mono"
                placeholder="小驼峰"
                :disabled="isPkRow(idx)"
                @change="col._propTouched = true"
              />
              <a-auto-complete
                v-model:value="col.type"
                :options="dbTypeOptions"
                size="small"
                class="mono"
                placeholder="如 VARCHAR(50)"
                :disabled="isPkRow(idx)"
                :filter-option="
                  (input: string, option: any) =>
                    String(option.value).toUpperCase().includes(input.toUpperCase())
                "
                @change="onTypeChange(col)"
              />
              <a-auto-complete
                v-model:value="col.javaType"
                :options="javaTypeOptions"
                size="small"
                class="mono"
                placeholder="如 String"
                :disabled="isPkRow(idx)"
                :filter-option="
                  (input: string, option: any) =>
                    String(option.value).toLowerCase().includes(input.toLowerCase())
                "
                @change="col._javaTouched = true"
              />
              <div class="center-cell">
                <a-checkbox v-model:checked="col.notNull" :disabled="isPkRow(idx)" />
              </div>
              <div class="center-cell" title="主键标记锁定：首字段固定为主键（依设置约定）">
                <a-checkbox v-model:checked="col.primaryKey" disabled />
              </div>
              <a-select
                v-model:value="col.dict"
                :options="dictOptions"
                size="small"
                placeholder="无"
                allow-clear
                show-search
                option-filter-prop="label"
                :disabled="isPkRow(idx)"
              />
              <a-input
                v-model:value="col.comment"
                size="small"
                placeholder="选填"
                :disabled="isPkRow(idx)"
              />
              <template v-for="def in columnOptionDefs" :key="def.name">
                <div
                  v-if="def.type === 'boolean'"
                  class="center-cell"
                  :title="def.remark || def.label"
                >
                  <a-checkbox v-model:checked="col._optVals[def.name]" :disabled="isPkRow(idx)" />
                </div>
                <a-input
                  v-else
                  v-model:value="col._optVals[def.name]"
                  size="small"
                  class="mono opt-col-input"
                  :placeholder="def.name"
                  :title="def.remark || def.label"
                  :disabled="isPkRow(idx)"
                />
              </template>
              <button
                v-if="!isPkRow(idx)"
                class="row-del"
                type="button"
                title="删除字段"
                @click="removeColumn(idx)"
              >
                <Trash2 :size="12" />
              </button>
              <span v-else class="row-del-placeholder" title="主键字段不可删除"></span>
            </div>
          </div>
        </div>
        <a-button size="small" type="dashed" block class="add-btn" @click="addColumn">
          <template #icon><Plus :size="12" /></template>
          添加字段
        </a-button>
        <!-- 审计字段一键增删（依设置约定） -->
        <div class="audit-actions">
          <a-button
            v-if="!allAuditPresent"
            size="small"
            class="audit-add-btn"
            @click="addAuditFields"
          >
            <template #icon><ShieldCheck :size="12" /></template>
            添加审计字段
          </a-button>
          <a-button
            v-if="anyAuditPresent"
            size="small"
            danger
            class="audit-del-btn"
            @click="removeAuditFields"
          >
            <template #icon><Trash2 :size="12" /></template>
            删除审计字段
          </a-button>
          <span class="audit-tip" :title="auditNamesLabel">审计字段：{{ auditNamesLabel }}</span>
        </div>
      </a-tab-pane>

      <!-- ========== 索引（窄屏整体横向滚动） ========== -->
      <a-tab-pane key="indexes" :tab="`索引（${draft.indexes.length}）`">
        <div class="grid-scroll">
          <div class="columns-head idx-grid">
            <span>索引名</span>
            <span>索引类型</span>
            <span>索引字段</span>
            <span>注释</span>
            <span></span>
          </div>
          <div class="columns-body">
            <div v-for="(idx, i) in draft.indexes" :key="idx.id" class="column-row idx-grid">
              <a-input
                v-model:value="idx.indexName"
                size="small"
                class="mono"
                placeholder="如 uk_username"
              />
              <a-select v-model:value="idx.type" :options="indexTypeOptions" size="small" />
              <a-select
                v-model:value="idx.columns"
                :options="columnSelectOptions"
                mode="multiple"
                size="small"
                placeholder="选择字段（可多选）"
                :max-tag-count="3"
                class="mono"
              />
              <a-input v-model:value="idx.comment" size="small" placeholder="选填" />
              <button class="row-del" type="button" title="删除索引" @click="removeIndex(i)">
                <Trash2 :size="12" />
              </button>
            </div>
            <a-empty
              v-if="!draft.indexes.length"
              description="暂无索引"
              :image-style="{ height: '40px' }"
            />
          </div>
        </div>
        <a-button size="small" type="dashed" block class="add-btn" @click="addIndex">
          <template #icon><Plus :size="12" /></template>
          添加索引
        </a-button>
      </a-tab-pane>

      <!-- ========== 导航 ========== -->
      <a-tab-pane key="navigates" :tab="`导航（${tableNavs.length}）`">
        <div v-if="!isEdit" class="nav-tip">
          <a-alert message="保存表后即可为其创建导航关系" type="info" show-icon />
        </div>
        <template v-else>
          <div class="columns-body nav-body">
            <div v-for="nv in tableNavs.map(navView)" :key="nv.id" class="nav-row">
              <span class="nav-type" :class="`t-${nv.type.toLowerCase()}`">{{ nv.typeLabel }}</span>
              <span class="nav-tables mono">
                {{ nv.selfName }}
                <span class="nav-arrow"
                  >-&nbsp;{{ nv.type[0] }}&nbsp;-&nbsp;{{ nv.type[1] }}&nbsp;-</span
                >
                {{ nv.targetName }}
              </span>
              <span class="nav-props mono" :title="`${nv.selfProp} / ${nv.targetProp}`">
                {{ nv.selfProp }} ⇄ {{ nv.targetProp }}
              </span>
              <span class="nav-cascade">级联：{{ nv.cascadeAB }} / {{ nv.cascadeBA }}</span>
              <span class="nav-actions">
                <a-button size="small" @click="ui.openNavigateEdit(nv.id)">编辑</a-button>
                <a-popconfirm
                  title="删除该导航关系？"
                  ok-text="删除"
                  cancel-text="取消"
                  @confirm="deleteNavigate(nv.id)"
                >
                  <a-button size="small" danger>删除</a-button>
                </a-popconfirm>
              </span>
            </div>
            <a-empty
              v-if="!tableNavs.length"
              description="该表暂未参与任何导航关系"
              :image-style="{ height: '40px' }"
            />
          </div>
          <a-button
            v-if="isEdit"
            size="small"
            type="dashed"
            block
            class="add-btn"
            @click="ui.openNavigateEdit(null, { self: draft.id })"
          >
            <template #icon><Plus :size="12" /></template>
            新增导航
          </a-button>
        </template>
      </a-tab-pane>
    </a-tabs>
  </a-modal>
</template>

<style lang="scss" scoped>
.form-grid {
  display: grid;
  grid-template-columns: 220px 200px 180px 1fr;
  gap: 10px 12px;
  margin-bottom: 12px;

  .form-item {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;

    &.grow {
      min-width: 140px;
    }

    &.tree-item {
      grid-column: span 2;
    }

    /* 整行表单项（启用模板 / 表选项） */
    &.full-item {
      grid-column: 1 / -1;
    }

    label {
      font-size: 11.5px;
      color: var(--dbm-text-2);

      .req {
        color: var(--dbm-danger);
        margin-left: 2px;
      }
    }
  }
}

/* 启用模板：复选组 + 提示 */
.tpl-check-row {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  min-height: 24px;

  .tpl-check-group {
    display: inline-flex;
    flex-wrap: wrap;
    gap: 2px 10px;
  }

  .field-tip {
    font-size: 11px;
    color: var(--dbm-text-3);
  }
}

/* 表选项：勾选/输入混排 */
.opt-row {
  display: flex;
  align-items: center;
  gap: 6px 14px;
  flex-wrap: wrap;
  min-height: 24px;

  .opt-input-wrap {
    display: inline-flex;
    align-items: center;
    gap: 5px;

    .opt-label {
      font-size: 12px;
      color: var(--dbm-text-2);
      white-space: nowrap;
    }

    .opt-input {
      width: 110px;
    }
  }
}

/* 字段表格选项列（表头与单元格） */
.opt-head {
  font-size: 10.5px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.opt-col-input {
  width: 100%;
  min-width: 0;
}

.tree-row {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 24px;

  .tree-input {
    flex: 1;
    min-width: 120px;
    max-width: 240px;
  }
}

.edit-tabs {
  :deep(.ant-tabs-content) {
    padding-top: 4px;
  }
}

.cols-grid {
  display: grid;
  grid-template-columns:
    28px minmax(96px, 1fr) minmax(84px, 1fr)
    132px 118px 44px 44px 108px minmax(72px, 1fr) 26px;
  /*
   * 盒宽下限 = 轨道最小宽之和（min-content）：列选项等动态列使轨道总最小宽超出容器时，
   * 盒子随轨道加宽而非仅轨道溢出盒子——否则表头 border-bottom / 行悬停背景 /
   * 拖拽指示线只画到盒子宽（=容器宽），滚动后新露出的表头段下边框缺失一截。
   */
  min-width: min-content;
  gap: 4px 6px;
  align-items: center;
}

.idx-grid {
  display: grid;
  grid-template-columns: minmax(120px, 1fr) 128px minmax(200px, 1.6fr) minmax(80px, 1fr) 26px;
  /* 同 .cols-grid：盒宽跟随轨道最小宽，表头下边框覆盖全部列 */
  min-width: min-content;
  gap: 4px 6px;
  align-items: center;
}

/*
 * 字段/索引表唯一滚动容器（横向 + 纵向都在此滚动）。
 * 表头 sticky 吸顶（随纵向滚动悬浮、随横向滚动平移），列对齐不漂移；
 * 列选项等动态列使网格最小宽度超出弹窗时仅此容器出现横向滚动条。
 * 纵向限高原在 .columns-body（320px），随滚动容器归一上移至此（320px + 26px 表头）。
 */
.grid-scroll {
  overflow: auto;
  max-height: 348px;
  -webkit-overflow-scrolling: touch;
}

/* ===== 移动端适配 ===== */
@media (max-width: 768px) {
  /* 基本信息四列 → 双列 */
  .form-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px 10px;
  }

  /* 字段/索引表盒宽下限已由 .cols-grid/.idx-grid 的 min-width: min-content 按轨道最小宽
     动态保证（含列选项动态列，随设置增减自适应），无需再按断点硬编码 780/560 */
  /* 纵向限高上移至 .grid-scroll（44vh 表体 + 28px 表头） */
  .grid-scroll {
    max-height: calc(44vh + 28px);
  }
}

.columns-head {
  /* sticky 吸顶：纵向滚动时悬浮于滚动区顶端，行从其不透明背景下方穿过被遮挡 */
  position: sticky;
  top: 0;
  z-index: 2;
  /* 不透明背景与弹窗表面同色（--dbm-bg-raise = antd colorBgElevated，亮暗两态均匹配） */
  background: var(--dbm-bg-raise);
  padding: 2px 4px 6px;
  font-size: 11px;
  color: var(--dbm-text-3);
  border-bottom: 1px solid var(--dbm-border);

  .h-sort,
  .h-center {
    text-align: center;
  }
}

.columns-body {
  /*
   * 不再自建滚动容器：overflow-y:auto 会把 overflow-x 按规范连带计算为 auto，
   * 形成表体自己的第二个横向滚动容器（与外层 .grid-scroll 各滚各的）——
   * 表头表体双滚动条、滚动整体滚动条后表体右侧被表体盒子裁剪遮挡。
   * 溢出（横向与纵向）统一交给外层 .grid-scroll 唯一滚动容器。
   */
  padding: 6px 2px;

  .column-row {
    padding: 2px 2px;
    border-radius: var(--dbm-radius-s);

    &:hover {
      background: var(--dbm-bg-hover);
    }

    &.dragging {
      opacity: 0.45;
    }

    &.drop-above {
      box-shadow: 0 -2px 0 0 var(--dbm-primary);
    }

    &.drop-below {
      box-shadow: 0 2px 0 0 var(--dbm-primary);
    }

    /* 主键首行：轻微底色区分锁定态（与悬停同色系，亮暗两态均可见） */
    &.pk-row {
      background: var(--dbm-bg-hover);
    }
  }
}

/* 主键行锁定手柄：无拖拽语义，主色提示 */
.pk-lock {
  color: var(--dbm-primary);
  cursor: default;

  &:hover {
    color: var(--dbm-primary);
    background: transparent;
  }
}

/* 主键行末列占位（删除按钮位置，保持网格列数一致） */
.row-del-placeholder {
  display: inline-block;
  width: 22px;
  height: 22px;
}

/* 审计字段一键增删按钮行 */
.audit-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 6px;
  flex-wrap: wrap;

  .audit-tip {
    font-size: 11px;
    color: var(--dbm-text-3);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }
}

.drag-handle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 22px;
  border-radius: 4px;
  color: var(--dbm-text-3);
  cursor: grab;
  touch-action: none;
  transition:
    color 0.15s ease,
    background 0.15s ease;

  &:hover {
    color: var(--dbm-text-1);
    background: var(--dbm-bg-hover);
  }

  &:active {
    cursor: grabbing;
  }
}

.center-cell {
  text-align: center;
}

.row-del {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border: none;
  border-radius: 3px;
  background: transparent;
  color: var(--dbm-text-3);
  cursor: pointer;

  &:hover {
    background: var(--dbm-danger-weak);
    color: var(--dbm-danger);
  }
}

.add-btn {
  margin-top: 6px;
}

/* 导航 tab */
.nav-tip {
  margin-bottom: 8px;
}

.nav-body {
  max-height: 300px;
}

.nav-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 8px;
  border: 1px solid var(--dbm-border);
  border-radius: var(--dbm-radius-m);
  margin-bottom: 6px;
  font-size: 12px;

  .nav-type {
    flex-shrink: 0;
    font-size: 10.5px;
    border-radius: 3px;
    padding: 0 6px;
    line-height: 18px;

    &.t-11 {
      color: var(--dbm-info);
      background: var(--dbm-info-weak);
    }
    &.t-1n {
      color: var(--dbm-success);
      background: var(--dbm-success-weak);
    }
    &.t-n1 {
      color: var(--dbm-warning);
      background: var(--dbm-warning-weak);
    }
    &.t-nn {
      color: var(--dbm-primary-text);
      background: var(--dbm-primary-weak);
    }
  }

  .nav-tables {
    font-weight: 600;
    color: var(--dbm-text-1);

    .nav-arrow {
      color: var(--dbm-text-3);
      font-weight: 400;
    }
  }

  .nav-props {
    color: var(--dbm-text-2);
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .nav-cascade {
    color: var(--dbm-text-3);
    font-size: 11px;
    flex-shrink: 0;
  }

  .nav-actions {
    display: flex;
    gap: 6px;
    flex-shrink: 0;
  }
}
</style>
