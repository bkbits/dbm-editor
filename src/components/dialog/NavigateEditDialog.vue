<script setup lang="ts">
import { computed, reactive, watch } from 'vue'
import { message } from 'antdv-next'
import { ArrowLeftRight } from '@lucide/vue'
import type { NavigateCascade, NavigateType, TableNavigate } from '@/types/model'
import { useUiStore } from '@/stores/ui'
import { useModelStore } from '@/stores/model'
import { useCanvasStore } from '@/stores/canvas'
import { toCamelCase } from '@/utils/string'
import { uid } from '@/utils/id'
import {
  CASCADE_LABEL,
  NAVIGATE_TYPE_LABEL,
  flipNavigateType,
  suggestPropertyName,
} from '@/utils/navigate'

const ui = useUiStore()
const model = useModelStore()
const canvas = useCanvasStore()

const dialogOpen = computed(() => ui.navigateEdit.open)
const isEdit = computed(() => Boolean(ui.navigateEdit.navigateId))

const draft = reactive({
  id: '',
  type: '1N' as NavigateType,
  comment: '',
  self: '',
  target: '',
  selfProperty: [] as string[],
  targetProperty: [] as string[],
  selfPropertyName: '',
  targetPropertyName: '',
  selfMappingProperty: [] as string[],
  targetMappingProperty: [] as string[],
  mappingMode: 'auto' as 'auto' | 'existing',
  mappingTable: '',
  mappingNewName: '',
  selfToTargetCascade: 'AUTO' as NavigateCascade,
  targetToSelfCascade: 'AUTO' as NavigateCascade,
})

function shortName(tableName: string): string {
  const parts = tableName.split('_')
  return parts.length > 1 ? parts[parts.length - 1] : tableName
}

function suggestMappingName(): string {
  const s = model.tableById(draft.self)
  const t = model.tableById(draft.target)
  if (!s || !t) return ''
  return `${s.tableName}_${shortName(t.tableName)}`
}

watch(dialogOpen, (open) => {
  if (!open) return
  const state = ui.navigateEdit
  if (state.navigateId) {
    const nav = model.navigates.find((n) => n.id === state.navigateId)
    if (!nav) return
    draft.id = nav.id
    draft.type = nav.type
    draft.comment = nav.comment || ''
    draft.self = nav.self
    draft.target = nav.target
    draft.selfProperty = [...nav.selfProperty]
    draft.targetProperty = [...nav.targetProperty]
    draft.selfPropertyName = nav.selfPropertyName
    draft.targetPropertyName = nav.targetPropertyName
    draft.selfMappingProperty = [...nav.selfMappingProperty]
    draft.targetMappingProperty = [...nav.targetMappingProperty]
    draft.mappingTable = nav.mappingTable || ''
    draft.mappingMode = nav.mappingTable ? 'existing' : 'auto'
    draft.mappingNewName = ''
    draft.selfToTargetCascade = nav.selfToTargetCascade
    draft.targetToSelfCascade = nav.targetToSelfCascade
  } else {
    draft.id = ''
    draft.type = '1N'
    draft.comment = ''
    draft.self = state.preset?.self || model.tables[0]?.id || ''
    draft.target = state.preset?.target || model.tables[1]?.id || ''
    draft.selfProperty = []
    draft.targetProperty = []
    draft.selfPropertyName = ''
    draft.targetPropertyName = ''
    draft.selfMappingProperty = []
    draft.targetMappingProperty = []
    draft.mappingMode = 'auto'
    draft.mappingTable = ''
    draft.selfToTargetCascade = 'AUTO'
    draft.targetToSelfCascade = 'AUTO'
    autoSuggest()
  }
  draft.mappingNewName = suggestMappingName()
})

/** 自动建议属性名 */
function autoSuggest() {
  const s = model.tableById(draft.self)
  const t = model.tableById(draft.target)
  if (s) draft.targetPropertyName = suggestPropertyName(s.tableName) || 'self'
  if (t) draft.selfPropertyName = suggestPropertyName(t.tableName) || 'target'
}

function onSelfChange() {
  if (!isEdit.value) {
    autoSuggest()
    draft.selfProperty = []
  }
  draft.mappingNewName = suggestMappingName()
}
function onTargetChange() {
  if (!isEdit.value) {
    autoSuggest()
    draft.targetProperty = []
  }
  draft.mappingNewName = suggestMappingName()
}

const tableOptions = computed(() =>
  model.tables.map((t) => ({
    value: t.id,
    label: `${t.tableName}${t.comment ? `（${t.comment}）` : ''}`,
  })),
)
const typeOptions = (Object.keys(NAVIGATE_TYPE_LABEL) as NavigateType[]).map((t) => ({
  value: t,
  label: `${NAVIGATE_TYPE_LABEL[t]}（${t}）`,
}))
const cascadeOptions = (Object.keys(CASCADE_LABEL) as Array<NavigateCascade>).map((c) => ({
  value: c,
  label: CASCADE_LABEL[c],
}))

function columnsOf(tableId: string) {
  return model.columnsOf(tableId).map((c) => ({ value: c.columnName, label: c.columnName }))
}
const selfColumnOptions = computed(() => columnsOf(draft.self))
const targetColumnOptions = computed(() => columnsOf(draft.target))

const isNN = computed(() => draft.type === 'NN')
const mappingLocked = computed(() => isEdit.value && Boolean(draft.mappingTable))

const mappingTableOptions = computed(() =>
  model.tables
    .filter((t) => t.id !== draft.self && t.id !== draft.target)
    .map((t) => ({ value: t.id, label: t.tableName })),
)
const mappingColumnOptions = computed(() =>
  draft.mappingTable ? columnsOf(draft.mappingTable) : [],
)

/** 反转 self 与 target（类型同步调换） */
function reverse() {
  const flipped: NavigateType = flipNavigateType(draft.type)
  draft.type = flipped
  const {
    self,
    target,
    selfProperty,
    targetProperty,
    selfPropertyName,
    targetPropertyName,
    selfMappingProperty,
    targetMappingProperty,
    selfToTargetCascade,
    targetToSelfCascade,
  } = draft
  draft.self = target
  draft.target = self
  draft.selfProperty = targetProperty
  draft.targetProperty = selfProperty
  draft.selfPropertyName = targetPropertyName
  draft.targetPropertyName = selfPropertyName
  draft.selfMappingProperty = targetMappingProperty
  draft.targetMappingProperty = selfMappingProperty
  draft.selfToTargetCascade = targetToSelfCascade
  draft.targetToSelfCascade = selfToTargetCascade
}

const saving = reactive({ loading: false })

function validate(): string | null {
  if (!draft.self) return '请选择本表'
  if (!draft.target) return '请选择目标表'
  if (draft.self === draft.target) return '暂不支持表自关联，请选择不同的两张表'
  if (model.hasNavigateBetween(draft.self, draft.target, draft.id || undefined)) {
    const s = model.tableById(draft.self)?.tableName
    const t = model.tableById(draft.target)?.tableName
    return `「${s}」与「${t}」之间已存在导航关系，不能重复创建`
  }
  if (!draft.selfPropertyName.trim()) return '本表属性名不能为空'
  if (!draft.targetPropertyName.trim()) return '目标表属性名不能为空'
  if (isNN.value && draft.mappingMode === 'auto' && !isEdit.value) {
    if (!draft.mappingNewName.trim()) return '请填写中间表名'
    if (model.tableNames.has(draft.mappingNewName.trim()))
      return `中间表名已存在：${draft.mappingNewName}`
  }
  if (isNN.value && draft.mappingMode === 'existing' && !draft.mappingTable)
    return '请选择中间映射表'
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
    let mappingTable = draft.mappingTable
    if (isNN.value && draft.mappingMode === 'auto' && !isEdit.value) {
      // 自动创建中间表（默认隐藏）
      const selfTable = model.tableById(draft.self)
      const sShort = shortName(selfTable?.tableName || 'self')
      const tShort = shortName(model.tableById(draft.target)?.tableName || 'target')
      const columns = [
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
        {
          id: uid('c-'),
          tableId: '',
          columnName: `${sShort}_id`,
          propertyName: `${sShort}Id`,
          sort: 1,
          type: 'BIGINT',
          javaType: 'Long',
          comment: `${selfTable?.tableName ?? ''} 关联ID`,
          notNull: true,
          primaryKey: false,
          dict: '',
        },
        {
          id: uid('c-'),
          tableId: '',
          columnName: `${tShort}_id`,
          propertyName: `${tShort}Id`,
          sort: 2,
          type: 'BIGINT',
          javaType: 'Long',
          comment: `${model.tableById(draft.target)?.tableName ?? ''} 关联ID`,
          notNull: true,
          primaryKey: false,
          dict: '',
        },
      ]
      mappingTable = await model.createTable({
        categoryId: selfTable?.categoryId || model.categories[0]?.id || '',
        tableName: draft.mappingNewName.trim(),
        className: toCamelCase(draft.mappingNewName.trim()),
        comment: draft.comment.trim() || '中间映射表',
        x: (selfTable?.x ?? 0) + 120,
        y: (selfTable?.y ?? 0) + 320,
        columns,
        indexes: [],
      })
      canvas.hideTable(mappingTable)
      if (!draft.selfMappingProperty.length) draft.selfMappingProperty = [`${sShort}_id`]
      if (!draft.targetMappingProperty.length) draft.targetMappingProperty = [`${tShort}_id`]
    }

    const nav: TableNavigate = {
      id: draft.id || uid('n-'),
      type: draft.type,
      comment: draft.comment.trim(),
      self: draft.self,
      selfProperty: [...draft.selfProperty],
      selfPropertyName: draft.selfPropertyName.trim(),
      selfMappingProperty: isNN.value ? [...draft.selfMappingProperty] : [],
      mappingTable: isNN.value ? mappingTable : '',
      target: draft.target,
      targetProperty: [...draft.targetProperty],
      targetPropertyName: draft.targetPropertyName.trim(),
      targetMappingProperty: isNN.value ? [...draft.targetMappingProperty] : [],
      selfToTargetCascade: draft.selfToTargetCascade,
      targetToSelfCascade: draft.targetToSelfCascade,
    }
    if (isEdit.value) {
      await model.updateNavigate(nav)
      message.success('导航关系已更新')
    } else {
      await model.addNavigate(nav)
      message.success('导航关系已创建')
    }
    ui.closeNavigateEdit()
  } catch (e: unknown) {
    const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message
    message.error(msg || (e as Error)?.message || '保存失败')
  } finally {
    saving.loading = false
  }
}
</script>

<template>
  <a-modal
    :open="dialogOpen"
    :title="isEdit ? `编辑导航${draft.id ? '' : ''}` : '新增导航'"
    :width="640"
    :mask-closable="false"
    @cancel="ui.closeNavigateEdit()"
  >
    <template #footer>
      <a-button v-if="isEdit" @click="reverse">
        <template #icon><ArrowLeftRight :size="13" /></template>
        反转方向
      </a-button>
      <a-button @click="ui.closeNavigateEdit()">取消</a-button>
      <a-button type="primary" :loading="saving.loading" @click="save">保存</a-button>
    </template>

    <div class="nav-form">
      <div class="row">
        <div class="item">
          <label>本表（self）<span class="req">*</span></label>
          <a-select
            v-model:value="draft.self"
            :options="tableOptions"
            show-search
            option-filter-prop="label"
            size="small"
            @change="onSelfChange"
          />
        </div>
        <div class="item">
          <label>目标表（target）<span class="req">*</span></label>
          <a-select
            v-model:value="draft.target"
            :options="tableOptions"
            show-search
            option-filter-prop="label"
            size="small"
            @change="onTargetChange"
          />
        </div>
        <div class="item">
          <label>导航类型<span class="req">*</span></label>
          <a-select v-model:value="draft.type" :options="typeOptions" size="small" />
        </div>
      </div>

      <div class="row">
        <div class="item">
          <label>本表属性名<span class="req">*</span></label>
          <a-input
            v-model:value="draft.selfPropertyName"
            size="small"
            class="mono"
            placeholder="self 的 Java 属性名"
          />
        </div>
        <div class="item">
          <label>目标表属性名<span class="req">*</span></label>
          <a-input
            v-model:value="draft.targetPropertyName"
            size="small"
            class="mono"
            placeholder="target 的 Java 属性名"
          />
        </div>
        <div class="item">
          <label>注释</label>
          <a-input v-model:value="draft.comment" size="small" placeholder="选填" />
        </div>
      </div>

      <div class="row">
        <div class="item">
          <label>本表关联属性</label>
          <a-select
            v-model:value="draft.selfProperty"
            :options="selfColumnOptions"
            mode="multiple"
            size="small"
            class="mono"
            placeholder="选择本表字段"
            allow-clear
            :max-tag-count="3"
          />
        </div>
        <div class="item">
          <label>目标表关联属性</label>
          <a-select
            v-model:value="draft.targetProperty"
            :options="targetColumnOptions"
            mode="multiple"
            size="small"
            class="mono"
            placeholder="选择目标表字段"
            allow-clear
            :max-tag-count="3"
          />
        </div>
      </div>

      <!-- 中间映射表（NN） -->
      <template v-if="isNN">
        <div class="section-title">中间映射表</div>
        <div class="row">
          <div class="item">
            <label>映射方式</label>
            <a-radio-group v-model:value="draft.mappingMode" size="small" :disabled="mappingLocked">
              <a-radio value="auto">自动创建</a-radio>
              <a-radio value="existing">选择已有表</a-radio>
            </a-radio-group>
          </div>
          <div v-if="draft.mappingMode === 'auto'" class="item">
            <label>中间表名<span v-if="!isEdit" class="req">*</span></label>
            <a-input
              v-model:value="draft.mappingNewName"
              size="small"
              class="mono"
              :disabled="isEdit"
              :placeholder="`如 ${draft.mappingNewName || 'a_b'}`"
            />
          </div>
          <div v-else class="item">
            <label>映射表<span class="req">*</span></label>
            <a-select
              v-model:value="draft.mappingTable"
              :options="mappingTableOptions"
              show-search
              option-filter-prop="label"
              size="small"
              placeholder="选择作为中间表的表"
            />
          </div>
        </div>
        <div v-if="draft.mappingMode === 'existing' && draft.mappingTable" class="row">
          <div class="item">
            <label>本表映射属性</label>
            <a-select
              v-model:value="draft.selfMappingProperty"
              :options="mappingColumnOptions"
              mode="multiple"
              size="small"
              class="mono"
              placeholder="中间表中指向本表的字段"
              allow-clear
              :max-tag-count="3"
            />
          </div>
          <div class="item">
            <label>目标表映射属性</label>
            <a-select
              v-model:value="draft.targetMappingProperty"
              :options="mappingColumnOptions"
              mode="multiple"
              size="small"
              class="mono"
              placeholder="中间表中指向目标表的字段"
              allow-clear
              :max-tag-count="3"
            />
          </div>
        </div>
        <div v-if="draft.mappingMode === 'auto' && !isEdit" class="mapping-hint">
          自动创建的中间表默认隐藏，含 id / 本表ID / 目标表ID 三个字段，可在导航线上点击「表名
          +」展开。
        </div>
      </template>

      <div class="section-title">级联操作</div>
      <div class="row">
        <div class="item">
          <label>
            {{ model.tableById(draft.self)?.tableName || '本表' }} →
            {{ model.tableById(draft.target)?.tableName || '目标表' }}
          </label>
          <a-select
            v-model:value="draft.selfToTargetCascade"
            :options="cascadeOptions"
            size="small"
          />
        </div>
        <div class="item">
          <label>
            {{ model.tableById(draft.target)?.tableName || '目标表' }} →
            {{ model.tableById(draft.self)?.tableName || '本表' }}
          </label>
          <a-select
            v-model:value="draft.targetToSelfCascade"
            :options="cascadeOptions"
            size="small"
          />
        </div>
      </div>

      <div class="cascade-legend">
        <span>自动：自行处理（默认）</span>
        <span>无动作：不做任何操作</span>
        <span>删除：删除时级联删除关联数据</span>
        <span>设为Null：删除时将关联数据设为 Null</span>
      </div>
    </div>
  </a-modal>
</template>

<style lang="scss" scoped>
.nav-form {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.row {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px 12px;

  &:has(.ant-select-multiple) {
    grid-template-columns: repeat(2, 1fr);
  }
}

.item {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;

  label {
    font-size: 11.5px;
    color: var(--dbm-text-2);

    .req {
      color: var(--dbm-danger);
    }
  }
}

.section-title {
  margin-top: 4px;
  padding-top: 8px;
  border-top: 1px dashed var(--dbm-border);
  font-size: 12px;
  font-weight: 600;
  color: var(--dbm-text-1);
}

.mapping-hint {
  font-size: 11px;
  color: var(--dbm-text-3);
  background: var(--dbm-bg-2);
  border-radius: var(--dbm-radius-s);
  padding: 6px 10px;
}

.cascade-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 14px;
  font-size: 11px;
  color: var(--dbm-text-3);
  background: var(--dbm-bg-2);
  border-radius: var(--dbm-radius-s);
  padding: 6px 10px;
}
</style>
