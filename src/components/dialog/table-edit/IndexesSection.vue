<script setup lang="ts">
/**
 * 表编辑对话框 · 「索引」分区
 *
 * 从原 TableEditDialog.vue 单文件拆出。简单网格表（索引名 / 索引类型 /
 * 索引字段多选 / 注释 / 删除），窄屏整体横向滚动；索引类型选项来自应用
 * 设置，索引字段候选为当前字段列表中已命名的字段。
 *
 * 草稿经 props.draft 传入（对话框持有，reactive 对象就地编辑）。
 */
import { computed } from "vue";
import { Plus, Trash2 } from "@lucide/vue";
import { useSettingsStore } from "@/stores/settings";
import { uid } from "@/utils/id";
import type { TableEditDraft } from "./columns";

const props = defineProps<{ draft: TableEditDraft }>();

const settingsStore = useSettingsStore();

/** 添加空白索引（默认 NORMAL） */
function addIndex() {
  props.draft.indexes.push({
    id: uid("i-"),
    tableId: "",
    indexName: "",
    type: "NORMAL",
    columns: [],
    comment: "",
  });
}
/** 删除索引 */
function removeIndex(idx: number) {
  props.draft.indexes.splice(idx, 1);
}

/** 索引类型选项（来自应用设置的索引类型列表） */
const indexTypeOptions = computed(() =>
  settingsStore.indexTypeOptions.map((v) => ({ value: v, label: v })),
);

/** 索引字段候选：当前字段列表中已命名的字段 */
const columnSelectOptions = computed(() =>
  props.draft.columns
    .filter((c) => c.columnName.trim())
    .map((c) => ({ value: c.columnName, label: c.columnName })),
);
</script>

<template>
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
</template>

<style lang="scss" scoped>
@use "./shared.scss";

.idx-grid {
  display: grid;
  grid-template-columns: minmax(120px, 1fr) 128px minmax(200px, 1.6fr) minmax(80px, 1fr) 26px;
  /* 盒宽跟随轨道最小宽，表头下边框覆盖全部列 */
  min-width: min-content;
  gap: 4px 6px;
  align-items: center;
}

/*
 * 索引表唯一滚动容器（横向 + 纵向都在此滚动，表头 sticky 吸顶）。
 * 字段表已改为 SyncTable 多表同步滚动结构，不再使用本容器。
 */
.grid-scroll {
  overflow: auto;
  max-height: 348px;
  -webkit-overflow-scrolling: touch;
}

/* 移动端：索引表纵向限高（44vh 表体 + 28px 表头） */
@media (max-width: 768px) {
  .grid-scroll {
    max-height: calc(44vh + 28px);
  }
}
</style>
