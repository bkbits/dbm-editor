<script setup lang="ts">
/**
 * 设置页 · 分区一：列默认类型（数据库类型 → Java 类型映射规则）
 *
 * 从原 SettingsView.vue 单文件拆出。规则自上而下依序正则匹配（忽略大小写），
 * 取第一条命中；顺序即优先级（可拖拽调整）；含实时规则测试面板（输入数据库
 * 类型即时预览命中结果，测试含未保存的草稿修改）。
 *
 * 分区契约（经 defineExpose 暴露，供页面级统一保存条编排）：
 * - dirty / tip / warning：草稿是否变化 / 底部保存条提示文案 / 保存拦截警告
 * - collect()：返回本分区的 Settings 保存载荷片段
 * - resetDraft()：放弃修改，从 store 重建草稿
 */
import { computed, ref, watch } from "vue";
import { FlaskConical, GripVertical, Plus, Trash2 } from "@lucide/vue";
import type { TypeMapping } from "@/types/model";
import { useSettingsStore, SETTINGS_JAVA_TYPES } from "@/stores/settings";
import { useDragSort } from "@/composables/useDragSort";
import { uid } from "@/utils/id";
import { getJavaTypeByType, COMMON_DB_TYPES } from "@/utils/javaType";

const props = defineProps<{ id?: string }>();

const settingsStore = useSettingsStore();

/* ==================== 规则草稿（保存前本地编辑，带稳定 key） ==================== */

interface TypeMappingDraft extends TypeMapping {
  key: string; // 客户端稳定 key（拖拽/编辑期间保持 DOM 复用，保存时剥离）
}

const rules = ref<TypeMappingDraft[]>([]);

watch(
  () => settingsStore.typeMappings,
  (v) => {
    rules.value = (v || []).map((m) => ({ ...m, key: uid("mapping-") }));
  },
  { immediate: true },
);

/* 规则顺序即匹配优先级（sort 升序），拖拽手柄排序后按位置重编号 */
const drag = useDragSort(
  () => rules.value,
  () => {
    rules.value.forEach((m, i) => (m.sort = i));
  },
);

/** 添加映射规则行（store 提供新草稿模板） */
function addRule() {
  rules.value.push({ ...settingsStore.newMappingDraft(), key: uid("mapping-") });
}
/** 删除规则行并重编 sort */
function removeRule(idx: number) {
  rules.value.splice(idx, 1);
  rules.value.forEach((m, i) => (m.sort = i));
}

const javaTypeOptions = SETTINGS_JAVA_TYPES.map((t) => ({ value: t, label: t }));

/* ==================== 正则校验 ==================== */

/** 单条规则正则校验（空 / 非法返回错误文案） */
function regexError(rule: TypeMapping): string | null {
  const pattern = String(rule.pattern ?? "").trim();
  if (!pattern) return "正则不能为空";
  try {
    new RegExp(pattern, "i");
    return null;
  } catch {
    return "无效的正则表达式";
  }
}

const invalidCount = computed(() => rules.value.filter((r) => regexError(r)).length);

/* ==================== 规则测试（实时，含未保存修改） ==================== */

const testType = ref("VARCHAR(255)");
const testTypeOptions = COMMON_DB_TYPES.map((t) => ({ value: t }));

/** 编译草稿规则（跳过非法），返回 [index, regex, javaType] */
const compiled = computed(() => {
  const out: Array<{ index: number; re: RegExp; javaType: string }> = [];
  rules.value.forEach((r, index) => {
    if (regexError(r)) return;
    out.push({ index, re: new RegExp(r.pattern, "i"), javaType: r.javaType });
  });
  return out;
});

const testRaw = computed(() => testType.value.trim());

/** 第一条命中（依序匹配语义） */
const firstHit = computed(() => {
  if (!testRaw.value) return null;
  for (const c of compiled.value) {
    if (c.re.test(testRaw.value)) return c;
  }
  return null;
});

/** 某行规则是否也命中测试输入（用于区分"生效/被抢先"） */
function rowMatch(idx: number): boolean {
  if (!testRaw.value) return false;
  const c = compiled.value.find((x) => x.index === idx);
  return Boolean(c && c.re.test(testRaw.value));
}

/** 回退结果（无任何命中时导入将使用内置映射） */
const fallbackType = computed(() => (testRaw.value ? getJavaTypeByType(testRaw.value) : ""));

/* ==================== 分区契约（dirty / 校验 / 载荷 / 重置） ==================== */

const dirty = computed(
  () =>
    JSON.stringify(rules.value.map(({ key: _key, ...m }) => m)) !==
    JSON.stringify(settingsStore.typeMappings),
);

const tip = computed(() =>
  invalidCount.value ? `存在 ${invalidCount.value} 条无效规则，保存已禁用` : null,
);

const warning = computed(() =>
  invalidCount.value ? `存在 ${invalidCount.value} 条空或无效的正则表达式，请修正后再保存` : null,
);

/** 分区保存载荷：排序重编 + pattern 去空白后的映射规则 */
function collect() {
  return {
    typeMappings: rules.value.map(({ key: _key, ...m }) => ({ ...m, pattern: m.pattern.trim() })),
  };
}

/** 放弃修改：从 store 重建草稿 */
function resetDraft() {
  rules.value = settingsStore.typeMappings.map((m) => ({ ...m, key: uid("mapping-") }));
}

defineExpose({ dirty, tip, warning, collect, resetDraft });
</script>

<template>
  <section :id="props.id" class="settings-card">
    <div class="card-head">
      <span class="card-title">列默认类型</span>
      <span class="card-sub">从数据库导入时 Java 类型的默认映射</span>
    </div>

    <div class="card-intro">
      从数据库导入表时，对每个字段的数据库类型（如
      <code class="mono">VARCHAR(255)</code>、<code class="mono">Decimal(6, 4)</code>）按下列规则
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
          <span class="drag-handle" title="拖拽调整规则优先级" @pointerdown="drag.handleDown(idx)">
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
            {{ firstHit && firstHit.index === idx ? "生效" : rowMatch(idx) ? "命中" : "—" }}
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
</template>

<style lang="scss" scoped>
@use "./card.scss";

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

/* 移动端：规则网格压缩（隐藏 # 序号列，排序语义由拖拽手柄承担） */
@media (max-width: 768px) {
  .r-grid {
    grid-template-columns: 22px minmax(120px, 1fr) 118px 44px 26px;
    gap: 4px 6px;

    > :nth-child(2) {
      display: none;
    }
  }
}
</style>
