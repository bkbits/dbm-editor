<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { message } from 'antdv-next'
import { Plus, Trash2, GripVertical, Settings, FlaskConical } from '@lucide/vue'
import type { ColumnTypeRule } from '@/types/model'
import { useSettingsStore, SETTINGS_JAVA_TYPES } from '@/stores/settings'
import { useDragSort } from '@/composables/useDragSort'
import { getJavaTypeByType, COMMON_DB_TYPES } from '@/utils/javaType'

const settingsStore = useSettingsStore()

/* ==================== 规则草稿（保存前本地编辑） ==================== */

const rules = ref<ColumnTypeRule[]>([])

watch(
  () => settingsStore.columnTypeRules,
  (v) => {
    rules.value = (v || []).map((r) => ({ ...r }))
  },
  { immediate: true },
)

/* 规则顺序即匹配优先级，拖拽手柄排序（复用字段拖拽排序逻辑） */
const drag = useDragSort(() => rules.value)

function addRule() {
  rules.value.push(settingsStore.newRuleDraft())
}
function removeRule(idx: number) {
  rules.value.splice(idx, 1)
}

const javaTypeOptions = SETTINGS_JAVA_TYPES.map((t) => ({ value: t, label: t }))

/* ==================== 正则校验 ==================== */

function regexError(rule: ColumnTypeRule): string | null {
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

/* ==================== 保存 / 放弃 ==================== */

const saving = reactive({ loading: false })

const dirty = computed(() => JSON.stringify(rules.value) !== JSON.stringify(settingsStore.columnTypeRules))

function resetDraft() {
  rules.value = settingsStore.columnTypeRules.map((r) => ({ ...r }))
}

async function save() {
  if (invalidCount.value) {
    message.warning(`存在 ${invalidCount.value} 条空或无效的正则表达式，请修正后再保存`)
    return
  }
  saving.loading = true
  try {
    await settingsStore.save(rules.value.map((r) => ({ ...r, pattern: r.pattern.trim() })))
    message.success('设置已保存')
  } catch (e: unknown) {
    const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message
    message.error(msg || (e as Error)?.message || '保存失败')
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
          <code class="mono">VARCHAR(255)</code>、<code class="mono">Decimal(6, 4)</code>）按下列规则
          <b>自上而下依次</b>进行正则表达式匹配（忽略大小写），取<b>第一条命中</b>规则的 Java
          类型作为该字段的默认 Java 类型；全部未命中时回退内置类型映射表（仍无映射则为
          String）。规则顺序即优先级，可拖拽调整。
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
              :key="rule.id"
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
            :filter-option="(input: string, option: any) => String(option.value).toUpperCase().includes(input.toUpperCase())"
          />
          <div class="test-result">
            <template v-if="firstHit">
              <span class="type-badge hit">{{ firstHit.javaType }}</span>
              <span class="hit-desc">
                命中规则 <b>#{{ firstHit.index + 1 }}</b>：
                <code class="mono">{{ rules[firstHit.index]?.pattern }}</code>
              </span>
            </template>
            <template v-else-if="testRaw">
              <span class="type-badge fallback">{{ fallbackType }}</span>
              <span class="hit-desc">未命中任何规则，导入时回退内置类型映射</span>
            </template>
            <span v-else class="test-placeholder">输入数据库类型后实时预览匹配结果（含未保存修改）</span>
          </div>
        </div>

        <div class="card-foot">
          <span class="dirty-tip" :class="{ dirty }">
            {{ invalidCount ? `存在 ${invalidCount} 条无效规则，保存已禁用` : dirty ? '有未保存的修改' : '全部更改已保存' }}
          </span>
          <div class="foot-actions">
            <a-button size="small" :disabled="!dirty" @click="resetDraft">放弃修改</a-button>
            <a-button
              size="small"
              type="primary"
              :loading="saving.loading"
              :disabled="!dirty || Boolean(invalidCount)"
              @click="save"
            >
              保存设置
            </a-button>
          </div>
        </div>
      </section>
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
    border-radius: var(--radius-m);
    background: var(--primary-weak);
    color: var(--primary);
    flex-shrink: 0;
  }

  .head-text {
    h1 {
      font-size: 16px;
      font-weight: 600;
      color: var(--text-1);
      line-height: 1.2;
    }

    p {
      font-size: 11.5px;
      color: var(--text-3);
      margin-top: 2px;
    }
  }
}

.settings-card {
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: var(--radius-l);
  padding: 14px 16px;
}

.card-head {
  display: flex;
  align-items: baseline;
  gap: 10px;
  margin-bottom: 8px;

  .card-title {
    font-size: 13.5px;
    font-weight: 600;
    color: var(--text-1);
  }

  .card-sub {
    font-size: 11.5px;
    color: var(--text-3);
  }
}

.card-intro {
  font-size: 12px;
  line-height: 1.7;
  color: var(--text-2);
  background: var(--bg-2);
  border: 1px dashed var(--border);
  border-radius: var(--radius-m);
  padding: 8px 12px;
  margin-bottom: 12px;

  code {
    background: var(--bg-hover);
    border-radius: 3px;
    padding: 0 4px;
    font-size: 11px;
  }

  b {
    color: var(--primary-text);
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
    color: var(--text-3);
    border-bottom: 1px solid var(--border);

    .h-sort,
    .h-center {
      text-align: center;
    }
  }

  .r-body {
    max-height: calc(100vh - 420px);
    min-height: 120px;
    overflow-y: auto;
    padding: 6px 2px;
  }

  .r-row {
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

.rule-index {
  text-align: center;
  font-size: 11px;
  color: var(--text-3);
}

.pattern-cell {
  min-width: 0;

  &.invalid :deep(.ant-input) {
    border-color: var(--danger);
  }

  .pattern-err {
    display: block;
    font-size: 10.5px;
    color: var(--danger);
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
  color: var(--text-3);
  border-radius: 3px;
  padding: 1px 0;
  transition: color 0.15s ease, background 0.15s ease;

  &.hit {
    color: var(--warning);
  }

  &.first {
    color: var(--primary-text);
    background: var(--primary-weak);
    font-weight: 600;
  }
}

.r-empty {
  padding: 24px 0;
  text-align: center;
  color: var(--text-3);
  font-size: 12px;
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
  transition: background 0.15s ease, color 0.15s ease;

  &:hover {
    background: var(--danger-weak);
    color: var(--danger);
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
  background: var(--bg-2);
  border: 1px solid var(--border);
  border-radius: var(--radius-m);

  .test-label {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-size: 12px;
    font-weight: 600;
    color: var(--text-2);
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
    color: var(--text-2);
    min-width: 0;
    flex: 1;
  }

  .type-badge {
    flex-shrink: 0;
    font-family: var(--font-mono);
    font-size: 11.5px;
    font-weight: 600;
    border-radius: 4px;
    padding: 1px 8px;

    &.hit {
      color: var(--primary-text);
      background: var(--primary-weak);
    }

    &.fallback {
      color: var(--warning);
      background: var(--warning-weak);
    }
  }

  .hit-desc {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;

    b {
      color: var(--primary-text);
    }

    code {
      background: var(--bg-hover);
      border-radius: 3px;
      padding: 0 4px;
      font-size: 11px;
    }
  }

  .test-placeholder {
    color: var(--text-3);
    font-size: 11.5px;
  }
}

.card-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px solid var(--border);

  .dirty-tip {
    font-size: 11.5px;
    color: var(--text-3);
    transition: color 0.15s ease;

    &.dirty {
      color: var(--warning);
    }
  }

  .foot-actions {
    display: flex;
    gap: 8px;
  }
}
</style>
