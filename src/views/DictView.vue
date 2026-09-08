<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { message, Modal } from 'antdv-next'
import { Plus, Trash2, Search, BookText } from '@lucide/vue'
import type { Dict, DictValue, DictValueLabelType } from '@/types/model'
import { useDictStore } from '@/stores/dict'
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

watch(selectedId, (id) => {
  const dict = dictStore.dicts.find((d) => d.id === id)
  if (dict) {
    draft.value = JSON.parse(JSON.stringify(dict))
  }
})

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
  { value: 'I', label: 'I · Info', color: 'var(--info)' },
  { value: 'S', label: 'S · Success', color: 'var(--success)' },
  { value: 'W', label: 'W · Warning', color: 'var(--warning)' },
  { value: 'D', label: 'D · Danger', color: 'var(--danger)' },
]

const typeColor = (t: DictValueLabelType) =>
  ({ I: 'var(--info)', S: 'var(--success)', W: 'var(--warning)', D: 'var(--danger)' })[t]

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
    label: '',
    labelType: 'I',
    comment: '',
    color: '',
  })
}

function removeValue(idx: number) {
  draft.value.values.splice(idx, 1)
}

function validate(): string | null {
  if (!draft.value.dictKey.trim()) return '字典键不能为空'
  if (!draft.value.label.trim()) return '字典标签不能为空'
  const keys = new Set<string>()
  for (const v of draft.value.values) {
    if (!v.valueKey.trim()) return '存在空值键'
    if (keys.has(v.valueKey)) return `值键重复：${v.valueKey}`
    keys.add(v.valueKey)
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
        <a-button size="small" type="primary" @click="newList">
          <template #icon><Plus :size="12" /></template>
          新增
        </a-button>
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
        <div
          v-for="d in dictStore.filteredDicts"
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
        <div v-if="!dictStore.filteredDicts.length" class="list-empty">
          {{ keyword ? '无匹配字典' : '暂无字典，点击右上角新增' }}
        </div>
      </div>
      <div class="list-foot">{{ dictStore.dicts.length }} 个字典</div>
    </aside>

    <section class="dict-detail">
      <template v-if="draft.label !== undefined || draft.dictKey !== '' || isEdit || draft.values.length">
        <div class="detail-form">
          <div class="form-row">
            <div class="form-item">
              <label>字典键（dictKey）<span class="req">*</span></label>
              <a-input v-model:value="draft.dictKey" size="small" class="mono" placeholder="如 sys_status" />
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
              <a-popconfirm title="删除该字典？" ok-text="删除" cancel-text="取消" @confirm="deleteDict">
                <a-button size="small" danger>
                  <template #icon><Trash2 :size="12" /></template>
                  删除
                </a-button>
              </a-popconfirm>
              <a-button size="small" type="primary" :loading="dirty.saving" @click="saveDict">保存字典</a-button>
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
              <span>值标签<span class="req">*</span></span>
              <span>值类型</span>
              <span>自定义颜色</span>
              <span>值注释</span>
              <span></span>
            </div>
            <div class="v-body">
              <div v-for="(v, i) in draft.values" :key="v.id" class="v-row v-grid" :class="{ hit: isValueHit(v) }">
                <a-input v-model:value="v.valueKey" size="small" class="mono" placeholder="如 1" />
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
                  <input v-model="v.color" type="color" class="color-input" title="自定义颜色（清空则回退类型默认色）" />
                  <button v-if="v.color" class="color-clear" type="button" title="清除自定义颜色" @click="v.color = ''">
                    ×
                  </button>
                </div>
                <a-input v-model:value="v.comment" size="small" placeholder="选填" />
                <button class="v-del" type="button" title="删除值" @click="removeValue(i)">
                  <Trash2 :size="12" />
                </button>
              </div>
              <div v-if="!draft.values.length" class="v-empty">
                暂无字典值，点击「新增值」添加
              </div>
            </div>
          </div>

          <div class="values-legend">
            <span>值类型：</span>
            <span class="lg" :style="{ color: 'var(--info)' }">I=Info</span>
            <span class="lg" :style="{ color: 'var(--success)' }">S=Success</span>
            <span class="lg" :style="{ color: 'var(--warning)' }">W=Warning</span>
            <span class="lg" :style="{ color: 'var(--danger)' }">D=Danger</span>
            <span class="lg-tip">字段编辑时可通过字典标识关联，卡片字段行将显示字典小徽标</span>
          </div>
        </div>
      </template>
      <div v-else class="detail-empty">
        <BookText :size="36" />
        <p>选择左侧字典进行编辑，或新增字典</p>
      </div>
    </section>
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

  .list-search {
    position: relative;
    margin: 0 12px 8px;

    .search-icon {
      position: absolute;
      left: 8px;
      top: 50%;
      transform: translateY(-50%);
      color: var(--text-3);
    }

    input {
      width: 100%;
      height: 28px;
      border: 1px solid var(--border);
      border-radius: var(--radius-m);
      background: var(--bg-2);
      color: var(--text-1);
      padding: 0 8px 0 28px;
      font-size: 12px;
      outline: none;

      &:focus {
        border-color: var(--primary);
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
    border-top: 1px solid var(--border);
    font-size: 10.5px;
    color: var(--text-3);
    font-family: var(--font-mono);
  }
}

.dict-item {
  padding: 7px 10px;
  border-radius: var(--radius-m);
  cursor: pointer;
  margin-bottom: 2px;
  border: 1px solid transparent;

  &:hover {
    background: var(--bg-hover);
  }

  &.selected {
    background: var(--primary-weak);
    border-color: color-mix(in srgb, var(--primary) 35%, transparent);
  }

  .item-key {
    font-size: 12.5px;
    font-weight: 600;
    color: var(--text-1);
  }

  .item-label {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 1px;

    .item-label-text {
      font-size: 11.5px;
      color: var(--text-2);
    }

    .item-count {
      margin-left: auto;
      font-size: 10px;
      color: var(--text-3);
      font-family: var(--font-mono);
    }
  }

  .item-comment {
    margin-top: 1px;
    font-size: 10.5px;
    color: var(--text-3);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}

.list-empty {
  padding: 30px 10px;
  text-align: center;
  color: var(--text-3);
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
    color: var(--text-3);

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
      color: var(--text-2);

      .req {
        color: var(--danger);
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
      color: var(--text-1);
      font-size: 13px;

      .hit-tip {
        margin-left: 8px;
        font-size: 11px;
        color: var(--warning);
        font-style: normal;
        font-weight: 400;
      }
    }
  }
}

.v-grid {
  display: grid;
  grid-template-columns: 140px 200px 130px 130px 1fr 30px;
  gap: 8px;
  align-items: center;
}

.values-table {
  border: 1px solid var(--border);
  border-radius: var(--radius-m);
  background: var(--bg-panel);

  .v-head {
    padding: 8px 12px;
    border-bottom: 1px solid var(--border);
    font-size: 11.5px;
    color: var(--text-2);

    .req {
      color: var(--danger);
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
      background: var(--warning-weak);
      border-radius: var(--radius-s);
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
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--bg-2);
    cursor: pointer;
    padding: 2px;
  }

  .color-clear {
    border: none;
    background: transparent;
    color: var(--text-3);
    cursor: pointer;
    font-size: 14px;
    line-height: 1;

    &:hover {
      color: var(--danger);
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
  color: var(--text-3);
  cursor: pointer;

  &:hover {
    background: var(--danger-weak);
    color: var(--danger);
  }
}

.v-empty {
  padding: 26px 0;
  text-align: center;
  color: var(--text-3);
  font-size: 12px;
}

.values-legend {
  margin-top: 10px;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  font-size: 11px;
  color: var(--text-3);

  .lg {
    font-family: var(--font-mono);
    font-weight: 600;
  }

  .lg-tip {
    margin-left: auto;
  }
}
</style>
