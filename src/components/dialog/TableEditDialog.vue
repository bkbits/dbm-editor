<script setup lang="ts">
import { computed, reactive, watch } from 'vue'
import { message } from 'antdv-next'
import { Plus, Trash2, GripVertical } from '@lucide/vue'
import type { TableColumn, TableIndex } from '@/types/model'
import { useUiStore } from '@/stores/ui'
import { useModelStore } from '@/stores/model'
import { useDictStore } from '@/stores/dict'
import { useCanvasStore } from '@/stores/canvas'
import { useSettingsStore } from '@/stores/settings'
import { toCamelCase } from '@/utils/string'
import { getJavaTypeByType, COMMON_DB_TYPES, COMMON_JAVA_TYPES } from '@/utils/javaType'
import { uid } from '@/utils/id'
import { NAVIGATE_TYPE_LABEL, CASCADE_LABEL, flipNavigateType } from '@/utils/navigate'
import { useDragSort } from '@/composables/useDragSort'

const ui = useUiStore()
const model = useModelStore()
const dictStore = useDictStore()
const canvas = useCanvasStore()
const settingsStore = useSettingsStore()

type DraftColumn = TableColumn & { _propTouched?: boolean; _javaTouched?: boolean }
type DraftIndex = TableIndex

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
    draft.columns = model.columnsOf(t.id).map((c) => ({ ...c }))
    draft.indexes = model.indexesOf(t.id).map((i) => ({ ...i, columns: [...i.columns] }))
  } else {
    const world = state.position ?? canvas.screenToWorld({ x: canvas.viewportW / 2, y: canvas.viewportH / 2 })
    draft.id = ''
    draft.categoryId = state.defaultCategoryId || model.categories[0]?.id || ''
    draft.tableName = ''
    draft.className = ''
    draft.comment = ''
    draft.parentIdColumn = ''
    draft.x = world.x - 130
    draft.y = world.y - 60
    draft.columns = [
      {
        id: uid('c-'),
        tableId: '',
        columnName: 'id',
        propertyName: 'id',
        sort: 0,
        type: 'BIGINT',
        javaType: 'Long',
        comment: '主键',
        notNull: true,
        primaryKey: true,
        dict: '',
      },
    ]
    draft.indexes = []
  }
  draft.activeTab = 'columns'
})

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

function addColumn() {
  draft.columns.push({
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
  })
}
function removeColumn(idx: number) {
  draft.columns.splice(idx, 1)
  renumber()
}

/* 字段拖拽排序（手柄触发，替代上移/下移按钮） */
const columnDrag = useDragSort(() => draft.columns, renumber)
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
const indexTypeOptions = computed(() => settingsStore.indexTypeOptions.map((v) => ({ value: v, label: v })))
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
  const dupName = model.tables.find((t) => t.tableName === draft.tableName.trim() && t.id !== draft.id)
  if (dupName) return `表名已存在：${draft.tableName}`
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
    :width="980"
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
        <a-select v-model:value="draft.categoryId" :options="categoryOptions" placeholder="选择分类" size="small" />
      </div>
      <div class="form-item">
        <label>表名<span class="req">*</span></label>
        <a-input v-model:value="draft.tableName" placeholder="如 sys_user" size="small" @blur="onTableNameBlur" />
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
            :filter-option="(input: string, option: any) => String(option.value).toLowerCase().includes(input.toLowerCase())"
          />
        </div>
      </div>
    </div>

    <a-tabs v-model:active-key="draft.activeTab" size="small" class="edit-tabs">
      <!-- ========== 字段 ========== -->
      <a-tab-pane key="columns" :tab="`字段（${draft.columns.length}）`">
        <div class="columns-head cols-grid">
          <span class="h-sort">排序</span>
          <span>字段名</span>
          <span>Java属性名</span>
          <span>数据库类型</span>
          <span>Java类型</span>
          <span class="h-center">非空</span>
          <span class="h-center">主键</span>
          <span>字典</span>
          <span>注释</span>
          <span></span>
        </div>
        <div class="columns-body">
          <div
            v-for="(col, idx) in draft.columns"
            :key="col.id"
            class="column-row cols-grid"
            :data-idx="idx"
            :class="columnDrag.rowClass(idx)"
            :draggable="columnDrag.state.from === idx"
            @dragstart="columnDrag.onDragStart(idx, $event)"
            @dragend="columnDrag.onDragEnd()"
            @dragover.prevent="columnDrag.onDragOver(idx, $event)"
            @drop.prevent="columnDrag.onDrop()"
          >
            <span
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
              @change="onColumnName(col)"
            />
            <a-input
              v-model:value="col.propertyName"
              size="small"
              class="mono"
              placeholder="小驼峰"
              @change="col._propTouched = true"
            />
            <a-auto-complete
              v-model:value="col.type"
              :options="dbTypeOptions"
              size="small"
              class="mono"
              placeholder="如 VARCHAR(50)"
              :filter-option="(input: string, option: any) => String(option.value).toUpperCase().includes(input.toUpperCase())"
              @change="onTypeChange(col)"
            />
            <a-auto-complete
              v-model:value="col.javaType"
              :options="javaTypeOptions"
              size="small"
              class="mono"
              placeholder="如 String"
              :filter-option="(input: string, option: any) => String(option.value).toLowerCase().includes(input.toLowerCase())"
              @change="col._javaTouched = true"
            />
            <div class="center-cell">
              <a-checkbox v-model:checked="col.notNull" />
            </div>
            <div class="center-cell">
              <a-checkbox v-model:checked="col.primaryKey" />
            </div>
            <a-select
              v-model:value="col.dict"
              :options="dictOptions"
              size="small"
              placeholder="无"
              allow-clear
              show-search
              option-filter-prop="label"
            />
            <a-input v-model:value="col.comment" size="small" placeholder="选填" />
            <button class="row-del" type="button" title="删除字段" @click="removeColumn(idx)">
              <Trash2 :size="12" />
            </button>
          </div>
        </div>
        <a-button size="small" type="dashed" block class="add-btn" @click="addColumn">
          <template #icon><Plus :size="12" /></template>
          添加字段
        </a-button>
      </a-tab-pane>

      <!-- ========== 索引 ========== -->
      <a-tab-pane key="indexes" :tab="`索引（${draft.indexes.length}）`">
        <div class="columns-head idx-grid">
          <span>索引名</span>
          <span>索引类型</span>
          <span>索引字段</span>
          <span>注释</span>
          <span></span>
        </div>
        <div class="columns-body">
          <div v-for="(idx, i) in draft.indexes" :key="idx.id" class="column-row idx-grid">
            <a-input v-model:value="idx.indexName" size="small" class="mono" placeholder="如 uk_username" />
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
          <a-empty v-if="!draft.indexes.length" description="暂无索引" :image-style="{ height: '40px' }" />
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
                <span class="nav-arrow">-&nbsp;{{ nv.type[0] }}&nbsp;-&nbsp;{{ nv.type[1] }}&nbsp;-</span>
                {{ nv.targetName }}
              </span>
              <span class="nav-props mono" :title="`${nv.selfProp} / ${nv.targetProp}`">
                {{ nv.selfProp }} ⇄ {{ nv.targetProp }}
              </span>
              <span class="nav-cascade">级联：{{ nv.cascadeAB }} / {{ nv.cascadeBA }}</span>
              <span class="nav-actions">
                <a-button size="small" @click="ui.openNavigateEdit(nv.id)">编辑</a-button>
                <a-popconfirm title="删除该导航关系？" ok-text="删除" cancel-text="取消" @confirm="deleteNavigate(nv.id)">
                  <a-button size="small" danger>删除</a-button>
                </a-popconfirm>
              </span>
            </div>
            <a-empty v-if="!tableNavs.length" description="该表暂未参与任何导航关系" :image-style="{ height: '40px' }" />
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

    label {
      font-size: 11.5px;
      color: var(--text-2);

      .req {
        color: var(--danger);
        margin-left: 2px;
      }
    }
  }
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
  grid-template-columns: 28px minmax(96px, 1fr) minmax(84px, 1fr) 132px 118px 44px 44px 108px minmax(72px, 1fr) 26px;
  gap: 4px 6px;
  align-items: center;
}

.idx-grid {
  display: grid;
  grid-template-columns: minmax(120px, 1fr) 128px minmax(200px, 1.6fr) minmax(80px, 1fr) 26px;
  gap: 4px 6px;
  align-items: center;
}

.columns-head {
  padding: 2px 4px 6px;
  font-size: 11px;
  color: var(--text-3);
  border-bottom: 1px solid var(--border);

  .h-sort,
  .h-center {
    text-align: center;
  }
}

.columns-body {
  max-height: 320px;
  overflow-y: auto;
  padding: 6px 2px;

  .column-row {
    padding: 2px 2px;
    border-radius: var(--radius-s);

    &:hover {
      background: var(--bg-hover);
    }

    &.dragging {
      opacity: 0.45;
    }

    &.drop-above {
      box-shadow: 0 -2px 0 0 var(--primary);
    }

    &.drop-below {
      box-shadow: 0 2px 0 0 var(--primary);
    }
  }
}

.drag-handle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 22px;
  border-radius: 4px;
  color: var(--text-3);
  cursor: grab;
  touch-action: none;
  transition: color 0.15s ease, background 0.15s ease;

  &:hover {
    color: var(--text-1);
    background: var(--bg-hover);
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
  color: var(--text-3);
  cursor: pointer;

  &:hover {
    background: var(--danger-weak);
    color: var(--danger);
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
  border: 1px solid var(--border);
  border-radius: var(--radius-m);
  margin-bottom: 6px;
  font-size: 12px;

  .nav-type {
    flex-shrink: 0;
    font-size: 10.5px;
    border-radius: 3px;
    padding: 0 6px;
    line-height: 18px;

    &.t-11 {
      color: var(--info);
      background: var(--info-weak);
    }
    &.t-1n {
      color: var(--success);
      background: var(--success-weak);
    }
    &.t-n1 {
      color: var(--warning);
      background: var(--warning-weak);
    }
    &.t-nn {
      color: var(--primary-text);
      background: var(--primary-weak);
    }
  }

  .nav-tables {
    font-weight: 600;
    color: var(--text-1);

    .nav-arrow {
      color: var(--text-3);
      font-weight: 400;
    }
  }

  .nav-props {
    color: var(--text-2);
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .nav-cascade {
    color: var(--text-3);
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
