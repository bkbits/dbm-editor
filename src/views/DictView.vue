<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { message, Modal } from 'antdv-next'
import {
  Plus,
  Trash2,
  Search,
  BookText,
  FolderPlus,
  Pencil,
  ChevronRight,
  ChevronDown,
} from '@lucide/vue'
import type { Dict, DictCategory, DictValue, DictValueLabelType } from '@/types/model'
import { useDictStore } from '@/stores/dict'
import { toCamelCase } from '@/utils/string'
import { uid } from '@/utils/id'

const dictStore = useDictStore()

/* ==================== 列表侧 ==================== */

const keyword = computed({
  get: () => dictStore.keyword,
  set: (v: string) => {
    dictStore.keyword = v
  },
})

const selectedId = computed({
  get: () => dictStore.selectedDictId,
  set: (v: string) => {
    dictStore.selectedDictId = v
  },
})

function newList() {
  draft.value = {
    id: '',
    categoryId: '',
    dictKey: '',
    label: '',
    comment: '',
    values: [],
  }
  selectedId.value = ''
}

/* ==================== 编辑侧 ==================== */

const draft = ref<Dict>({ id: '', dictKey: '', label: '', comment: '', values: [] })
const dirty = reactive({ saving: false })

watch(
  selectedId,
  (id) => {
    const dict = dictStore.dicts.find((d) => d.id === id)
    if (dict) {
      draft.value = JSON.parse(JSON.stringify(dict))
    }
  },
  // immediate：页面以 v-if 切换时组件会重新挂载，selectedId 来自 store 不会变化，
  // 普通 watch 不会触发，导致编辑区停留在空白草稿（显示「暂无字典值」）——挂载时立即同步一次
  { immediate: true },
)

watch(
  () => dictStore.loaded,
  (loaded) => {
    if (loaded) {
      const dict = dictStore.dicts.find((d) => d.id === selectedId.value)
      if (dict) draft.value = JSON.parse(JSON.stringify(dict))
    }
  },
)

const isEdit = computed(() => Boolean(draft.value.id))

const labelTypeOptions: Array<{ value: DictValueLabelType; label: string; color: string }> = [
  { value: 'I', label: 'I · Info', color: 'var(--dbm-info)' },
  { value: 'S', label: 'S · Success', color: 'var(--dbm-success)' },
  { value: 'W', label: 'W · Warning', color: 'var(--dbm-warning)' },
  { value: 'D', label: 'D · Danger', color: 'var(--dbm-danger)' },
]

const typeColor = (t: DictValueLabelType) =>
  ({
    I: 'var(--dbm-info)',
    S: 'var(--dbm-success)',
    W: 'var(--dbm-warning)',
    D: 'var(--dbm-danger)',
  })[t]

function typeStyle(v: DictValue) {
  return {
    background: v.color || `color-mix(in srgb, ${typeColor(v.labelType)} 15%, transparent)`,
    color: v.color || typeColor(v.labelType),
  }
}

function addValue() {
  draft.value.values.push({
    id: uid('dv-'),
    dictId: draft.value.id,
    valueKey: '',
    propertyName: '',
    label: '',
    labelType: 'I',
    comment: '',
    color: '',
  })
}

/** 常量属性名输入即转大写（仅允许全大写，小写输入自动变为大写） */
function onPropertyNameInput(v: DictValue, val: string) {
  v.propertyName = String(val || '').toUpperCase()
}

function removeValue(idx: number) {
  draft.value.values.splice(idx, 1)
}

function validate(): string | null {
  if (!draft.value.dictKey.trim()) return '字典键不能为空'
  if (!draft.value.label.trim()) return '字典标签不能为空'
  const keys = new Set<string>()
  const propNames = new Set<string>()
  for (const v of draft.value.values) {
    if (!v.valueKey.trim()) return '存在空值键'
    if (keys.has(v.valueKey)) return `值键重复：${v.valueKey}`
    keys.add(v.valueKey)
    // 常量属性名非空时查重（同名常量在生成代码中会冲突）
    const pn = (v.propertyName || '').trim()
    if (pn) {
      if (propNames.has(pn)) return `常量属性名重复：${pn}`
      propNames.add(pn)
    }
  }
  return null
}

async function saveDict() {
  const err = validate()
  if (err) {
    message.warning(err)
    return
  }
  dirty.saving = true
  try {
    const saved = await dictStore.saveDict(JSON.parse(JSON.stringify(draft.value)))
    draft.value = JSON.parse(JSON.stringify(saved))
    message.success(isEdit.value ? '字典已更新' : '字典已创建')
  } catch {
    /* store 已提示 */
  } finally {
    dirty.saving = false
  }
}

function deleteDict() {
  if (!draft.value.id) {
    newList()
    return
  }
  Modal.confirm({
    title: `删除字典「${draft.value.label}」？`,
    content: '已关联该字典的字段将失去参照（关联键保留，不再解析）。',
    okText: '删除',
    okType: 'danger',
    cancelText: '取消',
    onOk: async () => {
      await dictStore.removeDict(draft.value.id)
      message.success('字典已删除')
      newList()
    },
  })
}

/* ==================== 分类管理 ==================== */

/** 分类编辑弹窗（新增/编辑共用；仅一个字典分类模板，分类不涉模板） */
const catModal = reactive({
  open: false,
  saving: false,
})
const catDraft = ref<DictCategory>({ id: '', name: '', basePackage: '', className: '' })

function newCategory() {
  catDraft.value = { id: '', name: '', basePackage: '', className: '' }
  catModal.open = true
}

function editCategory(category: DictCategory) {
  catDraft.value = {
    id: category.id,
    name: category.name,
    basePackage: category.basePackage || '',
    className: category.className || '',
  }
  catModal.open = true
}

/** 类名称失活时归一为大驼峰（小驼峰/下划线/中划线自动转换，如 sys_dict → SysDict） */
function normalizeClassNameDraft() {
  const raw = (catDraft.value.className || '').trim()
  catDraft.value.className = raw ? toCamelCase(raw) : ''
}

/** 分类分组头悬停提示：字典代码默认产物路径 */
function catFileHint(c: DictCategory): string {
  const pkg = (c.basePackage || '').trim()
  const cls = (c.className || '').trim() || `${toCamelCase(c.name)}DictConstants`
  const pkgPath = pkg ? pkg.replace(/\./g, '/') : ''
  return `字典代码默认产物：${(pkgPath ? `src/main/java/${pkgPath}/` : '') + cls}.java`
}

async function saveCategory() {
  if (!catDraft.value.name.trim()) {
    message.warning('分类名称不能为空')
    return
  }
  const cls = (catDraft.value.className || '').trim()
  if (cls && !/^[A-Z][A-Za-z0-9]*$/.test(cls)) {
    message.warning('类名称必须为大驼峰结构（如 SysDictConstants）')
    return
  }
  catModal.saving = true
  try {
    await dictStore.saveDictCategory({ ...catDraft.value })
    catModal.open = false
    message.success(catDraft.value.id ? '字典分类已更新' : '字典分类已创建')
  } catch {
    /* store 已提示 */
  } finally {
    catModal.saving = false
  }
}

function removeCategory(category: DictCategory) {
  Modal.confirm({
    title: `删除字典分类「${category.name}」？`,
    content: '分类下仍有字典时将无法删除（请先移动或删除其下字典）。',
    okText: '删除',
    okType: 'danger',
    cancelText: '取消',
    onOk: async () => {
      await dictStore.removeDictCategory(category.id)
      message.success('字典分类已删除')
    },
  })
}

/** 折叠的分组（分类 id；「未分类」用 __uncat） */
const collapsedCats = reactive(new Set<string>())

function toggleCat(key: string) {
  if (collapsedCats.has(key)) collapsedCats.delete(key)
  else collapsedCats.add(key)
}

/** 字典表单的分类选项 */
const categoryOptions = computed(() =>
  dictStore.categories.map((c) => ({ value: c.id, label: c.name })),
)

/* 搜索命中高亮 */

/** 当前选中字典被过滤掉时，自动选中首个过滤结果 */
watch(
  () => dictStore.filteredDicts,
  (list) => {
    if (list.length && !list.some((d) => d.id === selectedId.value)) {
      selectedId.value = list[0].id
    }
  },
)
function escapeHtml(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function hl(text: string): string {
  const safe = escapeHtml(text)
  const kw = keyword.value.trim()
  if (!kw) return safe
  const k = escapeHtml(kw).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return safe.replace(new RegExp(`(${k})`, 'gi'), '<mark class="search-hit">$1</mark>')
}

const selectedHitCount = computed(() => {
  const kw = keyword.value.trim().toLowerCase()
  if (!kw || !draft.value.id) return 0
  const d = dictStore.dicts.find((x) => x.id === draft.value.id)
  if (!d) return 0
  return d.values.filter(
    (v) =>
      v.valueKey.toLowerCase().includes(kw) ||
      v.label.toLowerCase().includes(kw) ||
      (v.comment || '').toLowerCase().includes(kw),
  ).length
})

const isValueHit = (v: DictValue) => {
  const kw = keyword.value.trim().toLowerCase()
  if (!kw) return false
  return (
    v.valueKey.toLowerCase().includes(kw) ||
    v.label.toLowerCase().includes(kw) ||
    (v.comment || '').toLowerCase().includes(kw)
  )
}
</script>

<template>
  <div class="dict-view">
    <aside class="dict-list">
      <div class="list-head">
        <span class="list-title">
          <BookText :size="14" />
          数据字典
        </span>
        <div class="head-actions">
          <a-tooltip title="新增字典分类">
            <a-button size="small" @click="newCategory">
              <template #icon><FolderPlus :size="12" /></template>
            </a-button>
          </a-tooltip>
          <a-button size="small" type="primary" @click="newList">
            <template #icon><Plus :size="12" /></template>
            新增
          </a-button>
        </div>
      </div>
      <div class="list-search">
        <Search :size="13" class="search-icon" />
        <input
          v-model="keyword"
          type="text"
          placeholder="搜索键/标签/注释/值..."
          spellcheck="false"
        />
      </div>
      <div class="list-body">
        <template v-for="group in dictStore.grouped" :key="group.category?.id || '__uncat'">
          <div class="cat-head">
            <button
              class="cat-toggle"
              type="button"
              :title="collapsedCats.has(group.category?.id || '__uncat') ? '展开' : '折叠'"
              @click="toggleCat(group.category?.id || '__uncat')"
            >
              <ChevronRight v-if="collapsedCats.has(group.category?.id || '__uncat')" :size="12" />
              <ChevronDown v-else :size="12" />
            </button>
            <span
              class="cat-name"
              :title="group.category ? catFileHint(group.category) : '未分类字典不参与字典代码生成'"
            >
              {{ group.category?.name || '未分类' }}
            </span>
            <span class="cat-count">{{ group.dicts.length }}</span>
            <template v-if="group.category">
              <button
                class="cat-btn"
                type="button"
                title="编辑分类（名称 / 基础包路径 / 类名称）"
                @click="editCategory(group.category)"
              >
                <Pencil :size="11" />
              </button>
              <button
                class="cat-btn"
                type="button"
                title="删除分类（分类下仍有字典时不可删除）"
                @click="removeCategory(group.category)"
              >
                <Trash2 :size="11" />
              </button>
            </template>
          </div>
          <template v-if="!collapsedCats.has(group.category?.id || '__uncat')">
            <div
              v-for="d in group.dicts"
              :key="d.id"
              class="dict-item"
              :class="{ selected: selectedId === d.id }"
              @click="selectedId = d.id"
            >
              <div class="item-key mono" v-html="hl(d.dictKey)" />
              <div class="item-label">
                <span class="item-label-text" v-html="hl(d.label)" />
                <span class="item-count">{{ d.values.length }} 值</span>
              </div>
              <div v-if="d.comment" class="item-comment" v-html="hl(d.comment)" />
            </div>
          </template>
        </template>
        <div v-if="!dictStore.filteredDicts.length" class="list-empty">
          {{ keyword ? '无匹配字典' : '暂无字典，点击右上角新增' }}
        </div>
      </div>
      <div class="list-foot">
        {{ dictStore.categories.length }} 个分类 · {{ dictStore.dicts.length }} 个字典
      </div>
    </aside>

    <section class="dict-detail">
      <template
        v-if="draft.label !== undefined || draft.dictKey !== '' || isEdit || draft.values.length"
      >
        <div class="detail-form">
          <div class="form-row">
            <div class="form-item">
              <label>所属分类</label>
              <a-select
                v-model:value="draft.categoryId"
                size="small"
                :options="categoryOptions"
                placeholder="未分类"
                allow-clear
                style="width: 100%"
              />
            </div>
            <div class="form-item">
              <label>字典键（dictKey）<span class="req">*</span></label>
              <a-input
                v-model:value="draft.dictKey"
                size="small"
                class="mono"
                placeholder="如 sys_status"
              />
            </div>
            <div class="form-item">
              <label>字典标签（label）<span class="req">*</span></label>
              <a-input v-model:value="draft.label" size="small" placeholder="如 系统状态" />
            </div>
            <div class="form-item grow">
              <label>字典注释（comment）</label>
              <a-input v-model:value="draft.comment" size="small" placeholder="说明信息" />
            </div>
            <div class="form-actions">
              <a-popconfirm
                title="删除该字典？"
                ok-text="删除"
                cancel-text="取消"
                @confirm="deleteDict"
              >
                <a-button size="small" danger>
                  <template #icon><Trash2 :size="12" /></template>
                  删除
                </a-button>
              </a-popconfirm>
              <a-button size="small" type="primary" :loading="dirty.saving" @click="saveDict"
                >保存字典</a-button
              >
            </div>
          </div>
        </div>

        <div class="values-panel">
          <div class="values-head">
            <span class="values-title">
              字典值（{{ draft.values.length }}）
              <em v-if="selectedHitCount" class="hit-tip">搜索命中 {{ selectedHitCount }} 项</em>
            </span>
            <a-button size="small" @click="addValue">
              <template #icon><Plus :size="12" /></template>
              新增值
            </a-button>
          </div>

          <div class="values-table">
            <div class="v-head v-grid">
              <span>值键<span class="req">*</span></span>
              <span>常量属性名</span>
              <span>值标签<span class="req">*</span></span>
              <span>值类型</span>
              <span>自定义颜色</span>
              <span>值注释</span>
              <span></span>
            </div>
            <div class="v-body">
              <div
                v-for="(v, i) in draft.values"
                :key="v.id"
                class="v-row v-grid"
                :class="{ hit: isValueHit(v) }"
              >
                <a-input v-model:value="v.valueKey" size="small" class="mono" placeholder="如 1" />
                <a-input
                  :value="v.propertyName"
                  size="small"
                  class="mono"
                  placeholder="如 ENABLED"
                  title="字典代码生成的常量名（仅全大写，小写自动转大写；留空则由值键推导）"
                  @update:value="onPropertyNameInput(v, $event)"
                />
                <div class="v-label-cell">
                  <span class="v-label-dot" :style="typeStyle(v)" />
                  <a-input v-model:value="v.label" size="small" placeholder="如 启用" />
                </div>
                <a-select
                  v-model:value="v.labelType"
                  size="small"
                  :options="labelTypeOptions.map((o) => ({ value: o.value, label: o.label }))"
                />
                <div class="v-color-cell">
                  <input
                    v-model="v.color"
                    type="color"
                    class="color-input"
                    title="自定义颜色（清空则回退类型默认色）"
                  />
                  <button
                    v-if="v.color"
                    class="color-clear"
                    type="button"
                    title="清除自定义颜色"
                    @click="v.color = ''"
                  >
                    ×
                  </button>
                </div>
                <a-input v-model:value="v.comment" size="small" placeholder="选填" />
                <button class="v-del" type="button" title="删除值" @click="removeValue(i)">
                  <Trash2 :size="12" />
                </button>
              </div>
              <div v-if="!draft.values.length" class="v-empty">暂无字典值，点击「新增值」添加</div>
            </div>
          </div>

          <div class="values-legend">
            <span>值类型：</span>
            <span class="lg" :style="{ color: 'var(--dbm-info)' }">I=Info</span>
            <span class="lg" :style="{ color: 'var(--dbm-success)' }">S=Success</span>
            <span class="lg" :style="{ color: 'var(--dbm-warning)' }">W=Warning</span>
            <span class="lg" :style="{ color: 'var(--dbm-danger)' }">D=Danger</span>
            <span class="lg-tip">字段编辑时可通过字典标识关联，卡片字段行将显示字典小徽标</span>
          </div>
        </div>
      </template>
      <div v-else class="detail-empty">
        <BookText :size="36" />
        <p>选择左侧字典进行编辑，或新增字典</p>
      </div>
    </section>

    <!-- 字典分类编辑（新增 / 编辑；属性：分类名称、基础包路径、类名称——大驼峰，
      字典代码生成的包名/类名依据） -->
    <a-modal
      v-model:open="catModal.open"
      :title="catDraft.id ? '编辑字典分类' : '新增字典分类'"
      width="min(460px, 94vw)"
      wrap-class-name="dbm-modal-wrap"
      :mask-closable="false"
      @cancel="catModal.open = false"
    >
      <template #footer>
        <a-button @click="catModal.open = false">取消</a-button>
        <a-button type="primary" :loading="catModal.saving" @click="saveCategory">
          保存分类
        </a-button>
      </template>
      <div class="cat-form">
        <div class="cat-form-item">
          <label>分类名称<span class="req">*</span></label>
          <a-input v-model:value="catDraft.name" size="small" placeholder="如 系统字典" />
        </div>
        <div class="cat-form-item">
          <label>基础包路径（basePackage）</label>
          <a-input
            v-model:value="catDraft.basePackage"
            size="small"
            class="mono"
            placeholder="如 com.example.constants.dict"
          />
          <p class="cat-form-tip">字典常量类的 Java 包名与产物目录依据（留空则产物不带目录）</p>
        </div>
        <div class="cat-form-item">
          <label>类名称（className）</label>
          <a-input
            v-model:value="catDraft.className"
            size="small"
            class="mono"
            placeholder="如 SysDictConstants"
            @blur="normalizeClassNameDraft"
          />
          <p class="cat-form-tip">
            必须为大驼峰结构；输入小驼峰/下划线风格将在失焦时自动转换（如 sys_dict → SysDict）
          </p>
        </div>
      </div>
    </a-modal>
  </div>
</template>

<style lang="scss" scoped>
.dict-view {
  display: flex;
  height: 100%;
  overflow: hidden;
}

.dict-list {
  width: 288px;
  min-width: 288px;
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

    .head-actions {
      display: flex;
      align-items: center;
      gap: 6px;
    }
  }

  .list-search {
    position: relative;
    margin: 0 12px 8px;

    .search-icon {
      position: absolute;
      left: 8px;
      top: 50%;
      transform: translateY(-50%);
      color: var(--dbm-text-3);
    }

    input {
      width: 100%;
      height: 28px;
      border: 1px solid var(--dbm-border);
      border-radius: var(--dbm-radius-m);
      background: var(--dbm-bg-2);
      color: var(--dbm-text-1);
      padding: 0 8px 0 28px;
      font-size: 12px;
      outline: none;

      &:focus {
        border-color: var(--dbm-primary);
      }
    }
  }

  .list-body {
    flex: 1;
    overflow-y: auto;
    padding: 0 8px 8px;
  }

  .list-foot {
    padding: 7px 12px;
    border-top: 1px solid var(--dbm-border);
    font-size: 10.5px;
    color: var(--dbm-text-3);
    font-family: var(--dbm-font-mono);
  }
}

.cat-head {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 6px 6px 4px;
  margin-bottom: 2px;
  user-select: none;

  .cat-toggle {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    border: none;
    border-radius: 4px;
    background: transparent;
    color: var(--dbm-text-3);
    cursor: pointer;

    &:hover {
      background: var(--dbm-bg-hover);
      color: var(--dbm-text-2);
    }
  }

  .cat-name {
    font-size: 11.5px;
    font-weight: 600;
    color: var(--dbm-text-2);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .cat-count {
    font-size: 10px;
    color: var(--dbm-text-3);
    font-family: var(--dbm-font-mono);
  }

  .cat-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    border: none;
    border-radius: 4px;
    background: transparent;
    color: var(--dbm-text-3);
    cursor: pointer;
    opacity: 0;
    transition: opacity 0.12s ease;

    &:hover {
      background: var(--dbm-bg-hover);
      color: var(--dbm-text-1);
    }
  }

  &:hover .cat-btn {
    opacity: 1;
  }
}

.dict-item {
  padding: 7px 10px;
  border-radius: var(--dbm-radius-m);
  cursor: pointer;
  margin-bottom: 2px;
  border: 1px solid transparent;

  &:hover {
    background: var(--dbm-bg-hover);
  }

  &.selected {
    background: var(--dbm-primary-weak);
    border-color: color-mix(in srgb, var(--dbm-primary) 35%, transparent);
  }

  .item-key {
    font-size: 12.5px;
    font-weight: 600;
    color: var(--dbm-text-1);
  }

  .item-label {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 1px;

    .item-label-text {
      font-size: 11.5px;
      color: var(--dbm-text-2);
    }

    .item-count {
      margin-left: auto;
      font-size: 10px;
      color: var(--dbm-text-3);
      font-family: var(--dbm-font-mono);
    }
  }

  .item-comment {
    margin-top: 1px;
    font-size: 10.5px;
    color: var(--dbm-text-3);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}

.list-empty {
  padding: 30px 10px;
  text-align: center;
  color: var(--dbm-text-3);
  font-size: 12px;
}

.dict-detail {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  padding: 14px 16px;

  .detail-empty {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    color: var(--dbm-text-3);

    svg {
      opacity: 0.4;
    }
  }
}

.detail-form {
  .form-row {
    display: flex;
    gap: 12px;
    align-items: flex-end;
    flex-wrap: wrap;
  }

  .form-item {
    display: flex;
    flex-direction: column;
    gap: 4px;
    width: 220px;

    &.grow {
      flex: 1;
      min-width: 200px;
    }

    label {
      font-size: 11.5px;
      color: var(--dbm-text-2);

      .req {
        color: var(--dbm-danger);
      }
    }
  }

  .form-actions {
    display: flex;
    gap: 8px;
    margin-left: auto;
  }
}

.values-panel {
  margin-top: 14px;
  flex: 1;

  .values-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 8px;

    .values-title {
      font-weight: 600;
      color: var(--dbm-text-1);
      font-size: 13px;

      .hit-tip {
        margin-left: 8px;
        font-size: 11px;
        color: var(--dbm-warning);
        font-style: normal;
        font-weight: 400;
      }
    }
  }
}

.v-grid {
  display: grid;
  grid-template-columns: 90px 130px 180px 110px 120px 1fr 30px;
  gap: 8px;
  align-items: center;
}

.values-table {
  border: 1px solid var(--dbm-border);
  border-radius: var(--dbm-radius-m);
  background: var(--dbm-bg-panel);

  .v-head {
    padding: 8px 12px;
    border-bottom: 1px solid var(--dbm-border);
    font-size: 11.5px;
    color: var(--dbm-text-2);

    .req {
      color: var(--dbm-danger);
    }
  }

  .v-body {
    padding: 8px 12px;
    max-height: calc(100vh - 320px);
    min-height: 120px;
    overflow-y: auto;
  }

  .v-row {
    padding: 4px 0;

    &.hit {
      background: var(--dbm-warning-weak);
      border-radius: var(--dbm-radius-s);
      padding: 4px 6px;
      margin: 0 -6px;
    }
  }
}

.v-label-cell {
  display: flex;
  align-items: center;
  gap: 6px;

  .v-label-dot {
    width: 10px;
    height: 10px;
    border-radius: 3px;
    flex-shrink: 0;
  }
}

.v-color-cell {
  display: flex;
  align-items: center;
  gap: 4px;

  .color-input {
    width: 26px;
    height: 24px;
    border: 1px solid var(--dbm-border);
    border-radius: 4px;
    background: var(--dbm-bg-2);
    cursor: pointer;
    padding: 2px;
  }

  .color-clear {
    border: none;
    background: transparent;
    color: var(--dbm-text-3);
    cursor: pointer;
    font-size: 14px;
    line-height: 1;

    &:hover {
      color: var(--dbm-danger);
    }
  }
}

.v-del {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--dbm-text-3);
  cursor: pointer;

  &:hover {
    background: var(--dbm-danger-weak);
    color: var(--dbm-danger);
  }
}

.v-empty {
  padding: 26px 0;
  text-align: center;
  color: var(--dbm-text-3);
  font-size: 12px;
}

.values-legend {
  margin-top: 10px;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  font-size: 11px;
  color: var(--dbm-text-3);

  .lg {
    font-family: var(--dbm-font-mono);
    font-weight: 600;
  }

  .lg-tip {
    margin-left: auto;
  }
}

/* ===== 字典分类编辑弹窗表单 ===== */
.cat-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding-top: 4px;

  .cat-form-item {
    display: flex;
    flex-direction: column;
    gap: 4px;

    label {
      font-size: 11.5px;
      color: var(--dbm-text-2);

      .req {
        color: var(--dbm-danger);
      }
    }

    .cat-form-tip {
      margin: 0;
      font-size: 10.5px;
      color: var(--dbm-text-3);
      line-height: 1.6;
    }
  }
}

/* ===== 移动端适配：左右分栏改为上下堆叠，字典值六列栅格改双列卡片 ===== */
@media (max-width: 768px) {
  .dict-view {
    flex-direction: column;
  }

  .dict-list {
    width: 100%;
    min-width: 0;
    max-height: 32vh;
    border-right: none;
    border-bottom: 1px solid var(--dbm-border);
  }

  .dict-detail {
    flex: 1;
    min-height: 0;
    padding: 12px 12px 20px;
  }

  /* 七列（值键/常量属性名/标签/类型/颜色/注释/删除）→ 双列卡片：注释独占一行，删除按钮靠右 */
  .v-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 6px 8px;
  }

  .v-head {
    display: none; /* 卡片化后表头语义不再成立，输入框自带占位提示 */
  }

  .v-grid > :nth-child(6) {
    grid-column: 1 / -1; /* 值注释整行 */
  }

  .v-grid > :nth-child(7) {
    justify-self: end; /* 删除按钮靠右 */
  }

  .values-table .v-body {
    max-height: none;
  }

  .values-legend .lg-tip {
    margin-left: 0;
    flex-basis: 100%;
  }
}
</style>
