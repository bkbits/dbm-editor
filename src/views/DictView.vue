<script setup lang="ts">
/**
 * 数据字典页（页面级编排）
 *
 * 由原 1094 行单文件拆分为本文件 + src/views/dict/ 两个面板（行为等价拆分）：
 * - DictListPane：左侧列表（搜索高亮 / 分类分组折叠 / 分类管理弹窗）
 * - DictDetailPane：右侧编辑（基本信息表单 + 字典值表格 + 校验保存删除）
 *
 * 本文件持有选中态（store 持久）并协调跨面板联动：
 * - 列表点击 / 搜索过滤后的自动选中（选中项被过滤掉时自动选首个结果）
 * - 「新增字典」与删除后回到新草稿（newList：清空草稿 + 取消选中）
 */
import { computed, ref, watch } from "vue";
import { useDictStore } from "@/stores/dict";
import DictListPane from "./dict/DictListPane.vue";
import DictDetailPane from "./dict/DictDetailPane.vue";

const dictStore = useDictStore();

/** 当前选中字典（store 持久，页面 v-if 重挂后保持） */
const selectedId = computed({
  get: () => dictStore.selectedDictId,
  set: (v: string) => {
    dictStore.selectedDictId = v;
  },
});

/** 编辑面板引用：新增 / 删除流程需要重置其草稿 */
const detailPane = ref<InstanceType<typeof DictDetailPane> | null>(null);

/** 新增字典：清空编辑草稿并取消选中（列表高亮清除） */
function newList() {
  detailPane.value?.newDraft();
  selectedId.value = "";
}

/** 当前选中字典被过滤掉时，自动选中首个过滤结果 */
watch(
  () => dictStore.filteredDicts,
  (list) => {
    if (list.length && !list.some((d) => d.id === selectedId.value)) {
      selectedId.value = list[0].id;
    }
  },
);
</script>

<template>
  <div class="dict-view">
    <DictListPane :selected-id="selectedId" @select="(id) => (selectedId = id)" @new="newList" />
    <DictDetailPane ref="detailPane" :selected-id="selectedId" @deleted="newList" />
  </div>
</template>

<style lang="scss" scoped>
.dict-view {
  display: flex;
  height: 100%;
  overflow: hidden;
}

/* 移动端：左右分栏改为上下堆叠 */
@media (max-width: 768px) {
  .dict-view {
    flex-direction: column;
  }
}
</style>
