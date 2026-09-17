<script setup lang="ts">
/**
 * 设置页 · 分区二：索引类型（表编辑与数据库导入的可选索引类型列表）
 *
 * 从原 SettingsView.vue 单文件拆出。管理索引类型选项（如 UNIQUE /
 * NORMAL / FULLTEXT）：保存后「编辑表」索引类型下拉使用该列表；数据库导入
 * 时不在列表中的索引类型归一为列表第一项；至少保留一个类型。
 *
 * 分区契约（defineExpose）：dirty / tip / warning / collect / resetDraft，
 * 语义同 TypeMappingSection。
 */
import { computed, ref, watch } from "vue";
import { message } from "antdv-next";
import { Layers, Plus, X } from "@lucide/vue";
import { useSettingsStore } from "@/stores/settings";

const props = defineProps<{ id?: string }>();

const settingsStore = useSettingsStore();

const indexTypes = ref<string[]>([]);
const newIndexType = ref("");

watch(
  () => settingsStore.indexTypes,
  (v) => {
    indexTypes.value = (v || []).map(String);
  },
  { immediate: true },
);

/** 添加索引类型（自动大写，空 / 重复拦截） */
function addIndexType() {
  const v = newIndexType.value.trim().toUpperCase();
  if (!v) {
    message.warning("索引类型不能为空");
    return;
  }
  if (indexTypes.value.includes(v)) {
    message.warning(`索引类型已存在：${v}`);
    return;
  }
  indexTypes.value.push(v);
  newIndexType.value = "";
}

/** 移除索引类型芯片 */
function removeIndexType(idx: number) {
  indexTypes.value.splice(idx, 1);
}

const indexTypeInvalid = computed(() => indexTypes.value.length === 0);

/* ==================== 分区契约 ==================== */

const dirty = computed(
  () => JSON.stringify(indexTypes.value) !== JSON.stringify(settingsStore.indexTypes),
);

const tip = computed(() => (indexTypeInvalid.value ? "索引类型列表为空，保存已禁用" : null));

const warning = computed(() =>
  indexTypeInvalid.value ? "索引类型列表不能为空，至少保留一个类型" : null,
);

/** 分区保存载荷：索引类型列表 */
function collect() {
  return { indexTypes: indexTypes.value.map(String) };
}

/** 放弃修改：从 store 重建草稿 */
function resetDraft() {
  indexTypes.value = settingsStore.indexTypes.map(String);
}

defineExpose({ dirty, tip, warning, collect, resetDraft });
</script>

<template>
  <section :id="props.id" class="settings-card">
    <div class="card-head">
      <span class="card-title"><Layers :size="13" /> 索引类型</span>
      <span class="card-sub">表编辑与数据库导入中索引类型的可选列表</span>
    </div>

    <div class="card-intro">
      管理索引类型选项（如 <code class="mono">UNIQUE</code> / <code class="mono">NORMAL</code> /
      <code class="mono">FULLTEXT</code>）。保存后「编辑表」对话框的索引类型下拉选项将使用该列表；
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
</template>

<style lang="scss" scoped>
@use "./card.scss";

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
</style>
