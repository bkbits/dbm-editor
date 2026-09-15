<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { message } from 'antdv-next'
import {
  Plus,
  Trash2,
  GripVertical,
  Settings,
  FlaskConical,
  Layers,
  X,
  Code2,
  SlidersHorizontal,
  KeyRound,
  RotateCcw,
} from '@lucide/vue'
import type { FieldConventions, OptionSetting, TypeMapping } from '@/types/model'
import { useSettingsStore, SETTINGS_JAVA_TYPES } from '@/stores/settings'
import { errorMessageOf } from '@/api/manager-api'
import { useDragSort } from '@/composables/useDragSort'
import { uid } from '@/utils/id'
import { getJavaTypeByType, COMMON_DB_TYPES } from '@/utils/javaType'
import {
  AUDIT_FIELD_LABELS,
  AUDIT_FIELD_NOT_NULL,
  AUDIT_FIELD_ROLES,
  DEFAULT_FIELD_CONVENTIONS,
  normalizeFieldConventions,
} from '@/utils/fieldConvention'

const settingsStore = useSettingsStore()

/* ==================== 规则草稿（保存前本地编辑，带稳定 key） ==================== */

interface TypeMappingDraft extends TypeMapping {
  key: string // 客户端稳定 key（拖拽/编辑期间保持 DOM 复用，保存时剥离）
}

const rules = ref<TypeMappingDraft[]>([])

watch(
  () => settingsStore.typeMappings,
  (v) => {
    rules.value = (v || []).map((m) => ({ ...m, key: uid('mapping-') }))
  },
  { immediate: true },
)

/* 规则顺序即匹配优先级（sort 升序），拖拽手柄排序后按位置重编号 */
const drag = useDragSort(
  () => rules.value,
  () => {
    rules.value.forEach((m, i) => (m.sort = i))
  },
)

function addRule() {
  rules.value.push({ ...settingsStore.newMappingDraft(), key: uid('mapping-') })
}
function removeRule(idx: number) {
  rules.value.splice(idx, 1)
  rules.value.forEach((m, i) => (m.sort = i))
}

const javaTypeOptions = SETTINGS_JAVA_TYPES.map((t) => ({ value: t, label: t }))

/* ==================== 正则校验 ==================== */

function regexError(rule: TypeMapping): string | null {
  const pattern = String(rule.pattern ?? '').trim()
  if (!pattern) return '正则不能为空'
  try {
    new RegExp(pattern, 'i')
    return null
  } catch {
    return '无效的正则表达式'
  }
}

const invalidCount = computed(() => rules.value.filter((r) => regexError(r)).length)

/* ==================== 规则测试（实时，含未保存修改） ==================== */

const testType = ref('VARCHAR(255)')
const testTypeOptions = COMMON_DB_TYPES.map((t) => ({ value: t }))

/** 编译草稿规则（跳过非法），返回 [index, regex, javaType] */
const compiled = computed(() => {
  const out: Array<{ index: number; re: RegExp; javaType: string }> = []
  rules.value.forEach((r, index) => {
    if (regexError(r)) return
    out.push({ index, re: new RegExp(r.pattern, 'i'), javaType: r.javaType })
  })
  return out
})

const testRaw = computed(() => testType.value.trim())

/** 第一条命中（依序匹配语义） */
const firstHit = computed(() => {
  if (!testRaw.value) return null
  for (const c of compiled.value) {
    if (c.re.test(testRaw.value)) return c
  }
  return null
})

/** 某行规则是否也命中测试输入（用于区分"生效/被抢先"） */
function rowMatch(idx: number): boolean {
  if (!testRaw.value) return false
  const c = compiled.value.find((x) => x.index === idx)
  return Boolean(c && c.re.test(testRaw.value))
}

/** 回退结果（无任何命中时导入将使用内置映射） */
const fallbackType = computed(() => (testRaw.value ? getJavaTypeByType(testRaw.value) : ''))

/* ==================== 索引类型草稿 ==================== */

const indexTypes = ref<string[]>([])
const newIndexType = ref('')

watch(
  () => settingsStore.indexTypes,
  (v) => {
    indexTypes.value = (v || []).map(String)
  },
  { immediate: true },
)

function addIndexType() {
  const v = newIndexType.value.trim().toUpperCase()
  if (!v) {
    message.warning('索引类型不能为空')
    return
  }
  if (indexTypes.value.includes(v)) {
    message.warning(`索引类型已存在：${v}`)
    return
  }
  indexTypes.value.push(v)
  newIndexType.value = ''
}

function removeIndexType(idx: number) {
  indexTypes.value.splice(idx, 1)
}

const indexTypeInvalid = computed(() => indexTypes.value.length === 0)

/* ==================== 代码生成（作者 + 表/列选项定义） ==================== */

const author = ref('')

watch(
  () => settingsStore.author,
  (v) => {
    author.value = String(v ?? '')
  },
  { immediate: true },
)

interface OptionDefDraft extends OptionSetting {
  key: string // 客户端稳定 key（保存时剥离）
}

function toDefDrafts(raw: OptionSetting[]): OptionDefDraft[] {
  return (raw || []).map((o) => ({
    name: o.name,
    type: o.type,
    label: o.label,
    remark: o.remark || '',
    dict: o.dict || '',
    key: uid('opt-'),
  }))
}

const tableOptions = ref<OptionDefDraft[]>([])
const columnOptions = ref<OptionDefDraft[]>([])

watch(
  () => settingsStore.tableOptions,
  (v) => {
    tableOptions.value = toDefDrafts(v)
  },
  { immediate: true },
)
watch(
  () => settingsStore.columnOptions,
  (v) => {
    columnOptions.value = toDefDrafts(v)
  },
  { immediate: true },
)

/** 选项类型预设（OptionType 允许任意自定义字符串，auto-complete 可自由输入） */
const optionTypeOptions = ['boolean', 'string', 'int', 'long', 'double'].map((t) => ({
  value: t,
  label: t,
}))

function addTableOption() {
  tableOptions.value.push({
    key: uid('opt-'),
    name: '',
    type: 'boolean',
    label: '',
    remark: '',
    dict: '',
  })
}

function removeTableOption(idx: number) {
  tableOptions.value.splice(idx, 1)
}

function addColumnOption() {
  columnOptions.value.push({
    key: uid('opt-'),
    name: '',
    type: 'boolean',
    label: '',
    remark: '',
    dict: '',
  })
}

function removeColumnOption(idx: number) {
  columnOptions.value.splice(idx, 1)
}

/** 选项定义校验：名称非空、合法标识符、列表内唯一 */
function optionDefError(def: OptionSetting): string | null {
  const name = String(def.name ?? '').trim()
  if (!name) return '名称不能为空'
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return '名称需为合法标识符（字母/数字/下划线）'
  return null
}

function optionDefsInvalid(defs: OptionDefDraft[]): string | null {
  const names = new Set<string>()
  for (const d of defs) {
    const err = optionDefError(d)
    if (err) return `「${d.name || '未命名'}」${err}`
    const name = d.name.trim()
    if (names.has(name)) return `名称重复：${name}`
    names.add(name)
  }
  return null
}

const tableOptionsInvalid = computed(() => optionDefsInvalid(tableOptions.value))
const columnOptionsInvalid = computed(() => optionDefsInvalid(columnOptions.value))

const optionsInvalid = computed(() => tableOptionsInvalid.value || columnOptionsInvalid.value)

/* ==================== 主键与审计字段约定草稿 ==================== */

const fieldConventions = ref<FieldConventions>(normalizeFieldConventions(undefined))

watch(
  () => settingsStore.fieldConventions,
  (v) => {
    fieldConventions.value = normalizeFieldConventions(v)
  },
  { immediate: true },
)

/** 恢复默认约定（仅本卡片草稿，需保存生效） */
function resetFieldConventions() {
  fieldConventions.value = normalizeFieldConventions(DEFAULT_FIELD_CONVENTIONS)
}

/** 约定类型候选项（与表编辑字段类型一致） */
const convTypeOptions = COMMON_DB_TYPES.map((t) => ({ value: t }))

/** 按设置的规则推导 Java 类型（先规则后内置，与导入同语义） */
function javaOf(dbType: string): string {
  return settingsStore.matchJavaType(dbType) || getJavaTypeByType(dbType)
}

/** 字段约定校验：名称非空、合法标识符、五个名称互不重复 */
const fieldConventionsInvalid = computed(() => {
  const fc = fieldConventions.value
  const names = [fc.primaryKey.name, ...AUDIT_FIELD_ROLES.map((role) => fc.auditFields[role].name)]
  for (const raw of names) {
    const n = raw.trim()
    if (!n) return '名称不能为空'
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(n)) return `「${raw}」需为合法标识符（字母/数字/下划线）`
  }
  if (new Set(names.map((n) => n.trim())).size !== names.length)
    return '名称重复：主键与四个审计字段间需互不相同'
  return null
})

/* ==================== 保存 / 放弃（设置整体） ==================== */

const saving = reactive({ loading: false })

const dirty = computed(
  () =>
    JSON.stringify(rules.value.map(({ key: _key, ...m }) => m)) !==
      JSON.stringify(settingsStore.typeMappings) ||
    JSON.stringify(indexTypes.value) !== JSON.stringify(settingsStore.indexTypes) ||
    author.value.trim() !== String(settingsStore.author ?? '').trim() ||
    JSON.stringify(tableOptions.value.map(({ key: _k, ...o }) => o)) !==
      JSON.stringify(settingsStore.tableOptions) ||
    JSON.stringify(columnOptions.value.map(({ key: _k, ...o }) => o)) !==
      JSON.stringify(settingsStore.columnOptions) ||
    JSON.stringify(fieldConventions.value) !== JSON.stringify(settingsStore.fieldConventions),
)

function resetDraft() {
  rules.value = settingsStore.typeMappings.map((m) => ({ ...m, key: uid('mapping-') }))
  indexTypes.value = settingsStore.indexTypes.map(String)
  author.value = String(settingsStore.author ?? '')
  tableOptions.value = toDefDrafts(settingsStore.tableOptions)
  columnOptions.value = toDefDrafts(settingsStore.columnOptions)
  fieldConventions.value = normalizeFieldConventions(settingsStore.fieldConventions)
}

async function save() {
  if (invalidCount.value) {
    message.warning(`存在 ${invalidCount.value} 条空或无效的正则表达式，请修正后再保存`)
    return
  }
  if (indexTypeInvalid.value) {
    message.warning('索引类型列表不能为空，至少保留一个类型')
    return
  }
  if (optionsInvalid.value) {
    message.warning(`选项定义无效：${optionsInvalid.value}`)
    return
  }
  if (fieldConventionsInvalid.value) {
    message.warning(`主键与审计字段约定无效：${fieldConventionsInvalid.value}`)
    return
  }
  saving.loading = true
  try {
    await settingsStore.save({
      indexTypes: indexTypes.value.map(String),
      typeMappings: rules.value.map(({ key: _key, ...m }) => ({ ...m, pattern: m.pattern.trim() })),
      author: author.value.trim(),
      fieldConventions: normalizeFieldConventions(fieldConventions.value),
      tableOptions: tableOptions.value.map(({ key: _k, ...o }) => ({
        ...o,
        name: o.name.trim(),
        type: o.type.trim() || 'boolean',
        label: o.label.trim() || o.name.trim(),
        remark: o.remark?.trim(),
        dict: o.dict?.trim(),
      })),
      columnOptions: columnOptions.value.map(({ key: _k, ...o }) => ({
        ...o,
        name: o.name.trim(),
        type: o.type.trim() || 'boolean',
        label: o.label.trim() || o.name.trim(),
        remark: o.remark?.trim(),
        dict: o.dict?.trim(),
      })),
    })
    message.success('设置已保存')
  } catch (e: unknown) {
    message.error(errorMessageOf(e, '保存失败'))
  } finally {
    saving.loading = false
  }
}
</script>

<template>
  <div class="settings-view">
    <div class="settings-inner">
      <header class="page-head">
        <span class="head-icon"><Settings :size="17" :stroke-width="2" /></span>
        <div class="head-text">
          <h1>系统设置</h1>
          <p>应用偏好配置，保存后立即生效并持久化</p>
        </div>
      </header>

      <section class="settings-card">
        <div class="card-head">
          <span class="card-title">列默认类型</span>
          <span class="card-sub">从数据库导入时 Java 类型的默认映射</span>
        </div>

        <div class="card-intro">
          从数据库导入表时，对每个字段的数据库类型（如
          <code class="mono">VARCHAR(255)</code>、<code class="mono">Decimal(6, 4)</code
          >）按下列规则
          <b>自上而下依次</b>进行正则表达式匹配（忽略大小写），取<b>第一条命中</b>规则的 Java
          类型作为该字段的默认 Java 类型；全部未命中时回退内置类型映射表（仍无映射则为
          String）。规则顺序（sort）即优先级，可拖拽调整。
        </div>

        <div class="rules-table">
          <div class="r-head r-grid">
            <span class="h-sort">排序</span>
            <span class="h-center">#</span>
            <span>列类型正则表达式（忽略大小写）</span>
            <span>Java 类型</span>
            <span class="h-center">测试</span>
            <span></span>
          </div>
          <div class="r-body">
            <div
              v-for="(rule, idx) in rules"
              :key="rule.key"
              class="r-row r-grid"
              :data-idx="idx"
              :class="drag.rowClass(idx)"
              :draggable="drag.state.from === idx"
              @dragstart="drag.onDragStart(idx, $event)"
              @dragend="drag.onDragEnd()"
              @dragover.prevent="drag.onDragOver(idx, $event)"
              @drop.prevent="drag.onDrop()"
            >
              <span
                class="drag-handle"
                title="拖拽调整规则优先级"
                @pointerdown="drag.handleDown(idx)"
              >
                <GripVertical :size="13" />
              </span>
              <span class="rule-index mono">{{ idx + 1 }}</span>
              <div class="pattern-cell" :class="{ invalid: Boolean(regexError(rule)) }">
                <a-input
                  v-model:value="rule.pattern"
                  size="small"
                  class="mono"
                  placeholder="如 ^\s*varchar"
                  spellcheck="false"
                />
                <span v-if="regexError(rule)" class="pattern-err">{{ regexError(rule) }}</span>
              </div>
              <a-select
                v-model:value="rule.javaType"
                :options="javaTypeOptions"
                size="small"
                class="java-select"
              />
              <span
                class="rule-test"
                :class="{ first: firstHit && firstHit.index === idx, hit: rowMatch(idx) }"
                :title="
                  firstHit && firstHit.index === idx
                    ? '当前测试输入命中的第一条规则（生效）'
                    : rowMatch(idx)
                      ? '该规则也匹配，但被上方更靠前的规则抢先命中'
                      : '未命中当前测试输入'
                "
              >
                {{ firstHit && firstHit.index === idx ? '生效' : rowMatch(idx) ? '命中' : '—' }}
              </span>
              <button class="row-del" type="button" title="删除规则" @click="removeRule(idx)">
                <Trash2 :size="12" />
              </button>
            </div>
            <div v-if="!rules.length" class="r-empty">
              暂无规则；未命中任何规则时，导入将回退内置类型映射
            </div>
          </div>
        </div>

        <a-button size="small" type="dashed" block class="add-btn" @click="addRule">
          <template #icon><Plus :size="12" /></template>
          添加规则
        </a-button>

        <div class="test-panel">
          <span class="test-label"><FlaskConical :size="13" /> 规则测试</span>
          <a-auto-complete
            v-model:value="testType"
            :options="testTypeOptions"
            size="small"
            class="mono test-input"
            placeholder="输入数据库类型实时预览，如 VARCHAR(255) / Decimal(6, 4)"
            :filter-option="
              (input: string, option: any) =>
                String(option.value).toUpperCase().includes(input.toUpperCase())
            "
          />
          <div class="test-result">
            <template v-if="firstHit">
              <span class="type-badge hit">{{ firstHit.javaType }}</span>
              <span class="hit-desc">
                命中规则 <b>#{{ firstHit.index + 1 }}</b
                >：
                <code class="mono">{{ rules[firstHit.index]?.pattern }}</code>
              </span>
            </template>
            <template v-else-if="testRaw">
              <span class="type-badge fallback">{{ fallbackType }}</span>
              <span class="hit-desc">未命中任何规则，导入时回退内置类型映射</span>
            </template>
            <span v-else class="test-placeholder"
              >输入数据库类型后实时预览匹配结果（含未保存修改）</span
            >
          </div>
        </div>
      </section>

      <section class="settings-card">
        <div class="card-head">
          <span class="card-title"><Layers :size="13" /> 索引类型</span>
          <span class="card-sub">表编辑与数据库导入中索引类型的可选列表</span>
        </div>

        <div class="card-intro">
          管理索引类型选项（如 <code class="mono">UNIQUE</code> / <code class="mono">NORMAL</code> /
          <code class="mono">FULLTEXT</code
          >）。保存后「编辑表」对话框的索引类型下拉选项将使用该列表；
          从数据库导入表时，不在列表中的索引类型将归一为列表第一项。至少保留一个类型。
        </div>

        <div class="index-types">
          <span v-for="(t, i) in indexTypes" :key="t" class="index-chip mono">
            {{ t }}
            <button class="chip-close" type="button" title="移除类型" @click="removeIndexType(i)">
              <X :size="10" />
            </button>
          </span>
          <span v-if="!indexTypes.length" class="index-empty"
            >索引类型列表为空，保存前请至少添加一个类型</span
          >
        </div>

        <div class="index-add">
          <a-input
            v-model:value="newIndexType"
            size="small"
            class="mono index-input"
            placeholder="如 SPATIAL（回车添加，自动转大写）"
            spellcheck="false"
            @keydown.enter="addIndexType"
          />
          <a-button size="small" @click="addIndexType">
            <template #icon><Plus :size="12" /></template>
            添加
          </a-button>
        </div>
      </section>

      <section class="settings-card">
        <div class="card-head">
          <span class="card-title"><KeyRound :size="13" /> 主键与审计字段</span>
          <span class="card-sub">表结构字段约定：主键固定首字段，审计字段一键增删</span>
        </div>

        <div class="card-intro">
          「编辑表」对话框中，每张表的<b>第一个字段固定为主键</b>（按下方约定生成，不可修改、不可排序，每表强制拥有，Java
          类型按「列默认类型」规则自动推导）；「添加审计字段」按下方约定一键补齐四个审计字段（创建人/创建时间强制非空，更新人/更新时间可空），可整组移除。名称、类型与审计字段
          Java 类型保存后对新加入的约定字段生效；审计字段 Java
          类型留空时按「列默认类型」规则自动推导、随类型联动，设定后固定使用该值；字段名采用数据库蛇形命名，Java
          属性名自动转小驼峰。
        </div>

        <div class="conv-table">
          <div class="conv-grid conv-head">
            <span>字段</span>
            <span>名称</span>
            <span>数据库类型</span>
            <span class="h-center">Java 类型</span>
            <span class="h-center">非空</span>
            <span class="h-center">主键</span>
          </div>
          <div class="conv-row conv-grid conv-pk">
            <span class="conv-label">主键ID</span>
            <a-input
              v-model:value="fieldConventions.primaryKey.name"
              size="small"
              class="mono"
              placeholder="id"
              spellcheck="false"
            />
            <a-auto-complete
              v-model:value="fieldConventions.primaryKey.type"
              :options="convTypeOptions"
              size="small"
              class="mono"
              placeholder="BIGINT"
              :filter-option="
                (input: string, option: any) =>
                  String(option.value).toUpperCase().includes(input.toUpperCase())
              "
            />
            <span
              class="conv-java mono"
              :title="`Java 类型（按「列默认类型」规则自动推导）：${javaOf(fieldConventions.primaryKey.type)}`"
            >
              {{ javaOf(fieldConventions.primaryKey.type) }}
            </span>
            <span class="conv-tag required">非空</span>
            <span class="conv-tag pk">主键</span>
          </div>
          <div v-for="role in AUDIT_FIELD_ROLES" :key="role" class="conv-row conv-grid">
            <span class="conv-label">{{ AUDIT_FIELD_LABELS[role] }}</span>
            <a-input
              v-model:value="fieldConventions.auditFields[role].name"
              size="small"
              class="mono"
              :placeholder="DEFAULT_FIELD_CONVENTIONS.auditFields[role].name"
              spellcheck="false"
            />
            <a-auto-complete
              v-model:value="fieldConventions.auditFields[role].type"
              :options="convTypeOptions"
              size="small"
              class="mono"
              :placeholder="fieldConventions.auditFields[role].type"
              :filter-option="
                (input: string, option: any) =>
                  String(option.value).toUpperCase().includes(input.toUpperCase())
              "
            />
            <a-auto-complete
              v-model:value="fieldConventions.auditFields[role].javaType"
              :options="javaTypeOptions"
              size="small"
              class="mono conv-java-input"
              allow-clear
              :placeholder="javaOf(fieldConventions.auditFields[role].type)"
              :filter-option="
                (input: string, option: any) =>
                  String(option.value).toLowerCase().includes(input.toLowerCase())
              "
            />
            <span class="conv-tag" :class="AUDIT_FIELD_NOT_NULL[role] ? 'required' : 'optional'">
              {{ AUDIT_FIELD_NOT_NULL[role] ? '非空' : '可空' }}
            </span>
            <span class="conv-dash">—</span>
          </div>
        </div>

        <div class="conv-foot">
          <a-button size="small" @click="resetFieldConventions">
            <template #icon><RotateCcw :size="12" /></template>
            恢复默认
          </a-button>
          <span v-if="fieldConventionsInvalid" class="conv-invalid">
            {{ fieldConventionsInvalid }}
          </span>
          <span v-else class="conv-tip">
            默认：id / create_by / create_time / update_by / update_time（Java
            属性名自动转小驼峰；非空约束为固定语义，随字段角色而定；审计字段 Java 类型留空 =
            按类型映射自动推导）
          </span>
        </div>
      </section>

      <section class="settings-card">
        <div class="card-head">
          <span class="card-title"><Code2 :size="13" /> 代码生成</span>
          <span class="card-sub">javadoc 作者与表/列选项元定义</span>
        </div>

        <div class="card-intro">
          生成 java 代码时，类与方法 javadoc 会携带
          <code class="mono">@author 作者</code> 与生成时刻的
          <code class="mono">@since yyyy-MM-dd HH:mm:ss</code>；表选项与列选项定义控制
          「编辑表」对话框中的选项编辑项，模板按选项值选择性生成代码（选项值缺省视为启用）。
        </div>

        <div class="author-row">
          <label>作者（@author）</label>
          <a-input
            v-model:value="author"
            class="author-input"
            placeholder="如 zhangsan（留空则生成代码省略 @author）"
            spellcheck="false"
          />
        </div>

        <div class="opt-defs">
          <div class="defs-title">
            <SlidersHorizontal :size="12" />
            表选项（默认：查询 / 添加 / 更新 / 删除，驱动 mapper / service / controller 分支）
          </div>
          <div class="defs-head defs-grid">
            <span>名称</span>
            <span>类型</span>
            <span>标签</span>
            <span>说明</span>
            <span>字典</span>
            <span></span>
          </div>
          <div class="defs-body">
            <div v-for="(o, i) in tableOptions" :key="o.key" class="defs-row defs-grid">
              <a-input v-model:value="o.name" size="small" class="mono" placeholder="如 query" />
              <a-auto-complete
                v-model:value="o.type"
                :options="optionTypeOptions"
                size="small"
                class="mono"
                placeholder="boolean"
                :filter-option="
                  (input: string, option: any) =>
                    String(option.value).toLowerCase().includes(input.toLowerCase())
                "
              />
              <a-input v-model:value="o.label" size="small" placeholder="如 查询" />
              <a-input v-model:value="o.remark" size="small" placeholder="是否启用查询" />
              <a-input v-model:value="o.dict" size="small" class="mono" placeholder="选填" />
              <button class="row-del" type="button" title="删除选项" @click="removeTableOption(i)">
                <Trash2 :size="12" />
              </button>
            </div>
            <div v-if="!tableOptions.length" class="r-empty">暂无表选项定义</div>
          </div>
          <a-button size="small" type="dashed" block class="add-btn" @click="addTableOption">
            <template #icon><Plus :size="12" /></template>
            添加表选项
          </a-button>
        </div>

        <div class="opt-defs">
          <div class="defs-title">
            <SlidersHorizontal :size="12" />
            列选项（默认：显示 / 查询 / 添加 / 更新 / 删除，驱动 controller 查询条件与 vue
            列表/表单）
          </div>
          <div class="defs-head defs-grid">
            <span>名称</span>
            <span>类型</span>
            <span>标签</span>
            <span>说明</span>
            <span>字典</span>
            <span></span>
          </div>
          <div class="defs-body">
            <div v-for="(o, i) in columnOptions" :key="o.key" class="defs-row defs-grid">
              <a-input v-model:value="o.name" size="small" class="mono" placeholder="如 show" />
              <a-auto-complete
                v-model:value="o.type"
                :options="optionTypeOptions"
                size="small"
                class="mono"
                placeholder="boolean"
                :filter-option="
                  (input: string, option: any) =>
                    String(option.value).toLowerCase().includes(input.toLowerCase())
                "
              />
              <a-input v-model:value="o.label" size="small" placeholder="如 显示" />
              <a-input v-model:value="o.remark" size="small" placeholder="是否启用列表中显示" />
              <a-input v-model:value="o.dict" size="small" class="mono" placeholder="选填" />
              <button class="row-del" type="button" title="删除选项" @click="removeColumnOption(i)">
                <Trash2 :size="12" />
              </button>
            </div>
            <div v-if="!columnOptions.length" class="r-empty">暂无列选项定义</div>
          </div>
          <a-button size="small" type="dashed" block class="add-btn" @click="addColumnOption">
            <template #icon><Plus :size="12" /></template>
            添加列选项
          </a-button>
        </div>
      </section>

      <div class="settings-foot">
        <span class="dirty-tip" :class="{ dirty }">
          {{
            invalidCount
              ? `存在 ${invalidCount} 条无效规则，保存已禁用`
              : indexTypeInvalid
                ? '索引类型列表为空，保存已禁用'
                : optionsInvalid
                  ? `选项定义无效：${optionsInvalid}`
                  : fieldConventionsInvalid
                    ? `字段约定无效：${fieldConventionsInvalid}`
                    : dirty
                      ? '有未保存的修改'
                      : '全部更改已保存'
          }}
        </span>
        <div class="foot-actions">
          <a-button size="small" :disabled="!dirty" @click="resetDraft">放弃修改</a-button>
          <a-button
            size="small"
            type="primary"
            :loading="saving.loading"
            :disabled="
              !dirty ||
              Boolean(invalidCount) ||
              indexTypeInvalid ||
              Boolean(optionsInvalid) ||
              Boolean(fieldConventionsInvalid)
            "
            @click="save"
          >
            保存设置
          </a-button>
        </div>
      </div>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.settings-view {
  height: 100%;
  overflow-y: auto;
}

.settings-inner {
  max-width: 920px;
  margin: 0 auto;
  padding: 18px 20px 30px;
}

.page-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 14px;

  .head-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border-radius: var(--dbm-radius-m);
    background: var(--dbm-primary-weak);
    color: var(--dbm-primary);
    flex-shrink: 0;
  }

  .head-text {
    h1 {
      font-size: 16px;
      font-weight: 600;
      color: var(--dbm-text-1);
      line-height: 1.2;
    }

    p {
      font-size: 11.5px;
      color: var(--dbm-text-3);
      margin-top: 2px;
    }
  }
}

.settings-card {
  background: var(--dbm-bg-panel);
  border: 1px solid var(--dbm-border);
  border-radius: var(--dbm-radius-l);
  padding: 14px 16px;
  margin-bottom: 14px;
}

.card-head {
  display: flex;
  align-items: baseline;
  gap: 10px;
  margin-bottom: 8px;

  .card-title {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-size: 13.5px;
    font-weight: 600;
    color: var(--dbm-text-1);
  }

  .card-sub {
    font-size: 11.5px;
    color: var(--dbm-text-3);
  }
}

.card-intro {
  font-size: 12px;
  line-height: 1.7;
  color: var(--dbm-text-2);
  background: var(--dbm-bg-2);
  border: 1px dashed var(--dbm-border);
  border-radius: var(--dbm-radius-m);
  padding: 8px 12px;
  margin-bottom: 12px;

  code {
    background: var(--dbm-bg-hover);
    border-radius: 3px;
    padding: 0 4px;
    font-size: 11px;
  }

  b {
    color: var(--dbm-primary-text);
  }
}

.r-grid {
  display: grid;
  grid-template-columns: 28px 30px minmax(260px, 1fr) 150px 56px 26px;
  gap: 4px 8px;
  align-items: center;
}

.rules-table {
  .r-head {
    padding: 2px 4px 6px;
    font-size: 11px;
    color: var(--dbm-text-3);
    border-bottom: 1px solid var(--dbm-border);

    .h-sort,
    .h-center {
      text-align: center;
    }
  }

  .r-body {
    max-height: calc(100vh - 460px);
    min-height: 120px;
    overflow-y: auto;
    padding: 6px 2px;
  }

  .r-row {
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
  }
}

.rule-index {
  text-align: center;
  font-size: 11px;
  color: var(--dbm-text-3);
}

.pattern-cell {
  min-width: 0;

  &.invalid :deep(.ant-input) {
    border-color: var(--dbm-danger);
  }

  .pattern-err {
    display: block;
    font-size: 10.5px;
    color: var(--dbm-danger);
    line-height: 1.5;
    padding: 0 2px;
  }
}

.java-select {
  width: 100%;
}

.rule-test {
  text-align: center;
  font-size: 10.5px;
  color: var(--dbm-text-3);
  border-radius: 3px;
  padding: 1px 0;
  transition:
    color 0.15s ease,
    background 0.15s ease;

  &.hit {
    color: var(--dbm-warning);
  }

  &.first {
    color: var(--dbm-primary-text);
    background: var(--dbm-primary-weak);
    font-weight: 600;
  }
}

.r-empty {
  padding: 24px 0;
  text-align: center;
  color: var(--dbm-text-3);
  font-size: 12px;
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
  transition:
    background 0.15s ease,
    color 0.15s ease;

  &:hover {
    background: var(--dbm-danger-weak);
    color: var(--dbm-danger);
  }
}

.add-btn {
  margin-top: 6px;
}

.test-panel {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin-top: 12px;
  padding: 10px 12px;
  background: var(--dbm-bg-2);
  border: 1px solid var(--dbm-border);
  border-radius: var(--dbm-radius-m);

  .test-label {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-size: 12px;
    font-weight: 600;
    color: var(--dbm-text-2);
    flex-shrink: 0;
  }

  .test-input {
    width: 340px;
  }

  .test-result {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    color: var(--dbm-text-2);
    min-width: 0;
    flex: 1;
  }

  .type-badge {
    flex-shrink: 0;
    font-family: var(--dbm-font-mono);
    font-size: 11.5px;
    font-weight: 600;
    border-radius: 4px;
    padding: 1px 8px;

    &.hit {
      color: var(--dbm-primary-text);
      background: var(--dbm-primary-weak);
    }

    &.fallback {
      color: var(--dbm-warning);
      background: var(--dbm-warning-weak);
    }
  }

  .hit-desc {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;

    b {
      color: var(--dbm-primary-text);
    }

    code {
      background: var(--dbm-bg-hover);
      border-radius: 3px;
      padding: 0 4px;
      font-size: 11px;
    }
  }

  .test-placeholder {
    color: var(--dbm-text-3);
    font-size: 11.5px;
  }
}

/* ==================== 索引类型卡片 ==================== */

.index-types {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  min-height: 30px;

  .index-chip {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-size: 11.5px;
    font-weight: 600;
    color: var(--dbm-primary-text);
    background: var(--dbm-primary-weak);
    border: 1px solid transparent;
    border-radius: var(--dbm-radius-m);
    padding: 2px 4px 2px 9px;
    transition:
      border-color 0.15s ease,
      background 0.15s ease;

    &:hover {
      border-color: var(--dbm-primary);
    }

    .chip-close {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 16px;
      height: 16px;
      border: none;
      border-radius: 4px;
      background: transparent;
      color: var(--dbm-text-3);
      cursor: pointer;
      transition:
        background 0.15s ease,
        color 0.15s ease;

      &:hover {
        background: var(--dbm-danger-weak);
        color: var(--dbm-danger);
      }
    }
  }

  .index-empty {
    font-size: 12px;
    color: var(--dbm-warning);
  }
}

.index-add {
  display: flex;
  gap: 8px;
  margin-top: 10px;

  .index-input {
    width: 260px;
  }
}

/* ==================== 主键与审计字段卡片 ==================== */

.conv-table {
  .conv-grid {
    display: grid;
    grid-template-columns: 76px minmax(110px, 1fr) minmax(130px, 1fr) 110px 56px 44px;
    gap: 4px 8px;
    align-items: center;
  }

  .conv-head {
    padding: 2px 4px 6px;
    font-size: 11px;
    color: var(--dbm-text-3);
    border-bottom: 1px solid var(--dbm-border);

    .h-center {
      text-align: center;
    }
  }

  .conv-row {
    padding: 3px 2px;
    border-radius: var(--dbm-radius-s);

    &:hover {
      background: var(--dbm-bg-hover);
    }

    .conv-label {
      font-size: 12px;
      font-weight: 600;
      color: var(--dbm-text-2);
      white-space: nowrap;
    }

    .conv-java {
      font-size: 11.5px;
      color: var(--dbm-text-3);
      text-align: center;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    /* 审计字段 Java 类型输入（可编辑，留空 placeholder 展示推导值） */
    .conv-java-input {
      width: 100%;
      text-align: center;

      :deep(.ant-input) {
        text-align: center;
      }
    }

    .conv-tag {
      display: inline-block;
      width: 100%;
      text-align: center;
      font-size: 10.5px;
      line-height: 18px;
      border-radius: 3px;

      &.required {
        color: var(--dbm-warning);
        background: var(--dbm-warning-weak);
      }

      &.optional {
        color: var(--dbm-text-3);
        background: var(--dbm-bg-hover);
      }

      &.pk {
        color: var(--dbm-primary-text);
        background: var(--dbm-primary-weak);
      }
    }

    .conv-dash {
      text-align: center;
      color: var(--dbm-text-3);
    }

    &.conv-pk .conv-label {
      color: var(--dbm-primary-text);
    }
  }
}

.conv-foot {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 10px;
  flex-wrap: wrap;

  .conv-invalid {
    font-size: 11.5px;
    color: var(--dbm-danger);
  }

  .conv-tip {
    font-size: 11px;
    color: var(--dbm-text-3);
  }
}

/* ==================== 代码生成卡片（作者 + 选项定义） ==================== */

.author-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;

  label {
    font-size: 12px;
    font-weight: 600;
    color: var(--dbm-text-2);
    flex-shrink: 0;
  }

  .author-input {
    width: 300px;
  }
}

.opt-defs {
  margin-bottom: 14px;

  .defs-title {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-size: 12px;
    font-weight: 600;
    color: var(--dbm-text-2);
    margin-bottom: 6px;
  }

  .defs-grid {
    display: grid;
    grid-template-columns:
      minmax(110px, 1fr) 110px minmax(100px, 1fr) minmax(140px, 1.4fr) minmax(90px, 1fr)
      26px;
    gap: 4px 6px;
    align-items: center;
  }

  .defs-head {
    padding: 2px 4px 6px;
    font-size: 11px;
    color: var(--dbm-text-3);
    border-bottom: 1px solid var(--dbm-border);
  }

  .defs-body {
    max-height: 220px;
    overflow-y: auto;
    padding: 6px 2px;

    .defs-row {
      padding: 2px 2px;
      border-radius: var(--dbm-radius-s);

      &:hover {
        background: var(--dbm-bg-hover);
      }
    }
  }
}

/* ==================== 统一保存条 ==================== */

.settings-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 2px;
  padding: 10px 4px 0;
  border-top: 1px solid var(--dbm-border);

  .dirty-tip {
    font-size: 11.5px;
    color: var(--dbm-text-3);
    transition: color 0.15s ease;

    &.dirty {
      color: var(--dbm-warning);
    }
  }

  .foot-actions {
    display: flex;
    gap: 8px;
  }
}

/* ===== 移动端适配：紧凑内边距 + 规则网格压缩（隐藏序号列，正则/类型列收缩） ===== */
@media (max-width: 768px) {
  .settings-inner {
    padding: 12px 12px 24px;
  }

  .settings-card {
    padding: 12px;
  }

  .r-grid {
    grid-template-columns: 22px minmax(120px, 1fr) 118px 44px 26px;
    gap: 4px 6px;

    /* 隐藏 # 序号列（第 2 个子元素），排序语义由拖拽手柄承担 */
    > :nth-child(2) {
      display: none;
    }
  }

  .settings-foot {
    flex-wrap: wrap;
    gap: 6px;

    .foot-actions {
      margin-left: auto;
    }
  }

  /* 主键与审计字段：六列压缩为两列（标签+名称一行，类型自动换行下沉） */
  .conv-table .conv-grid {
    grid-template-columns: minmax(90px, 1fr) minmax(110px, 1fr);
    gap: 4px 8px;

    /* 隐藏表头的 Java 类型 / 非空 / 主键三列（移动端不展示推导与徽标列） */
    .conv-head > :nth-child(4),
    .conv-head > :nth-child(5),
    .conv-head > :nth-child(6) {
      display: none;
    }

    /* 数据行隐藏后三列（Java/非空/主键占位），保留 标签、名称、类型 */
    .conv-row > :nth-child(4),
    .conv-row > :nth-child(5),
    .conv-row > :nth-child(6) {
      display: none;
    }

    .conv-label {
      justify-self: stretch;
    }
  }
}
</style>
