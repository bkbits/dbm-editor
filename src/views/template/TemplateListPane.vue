<script setup lang="ts">
/**
 * 模板页 · 左侧列表面板
 *
 * 从原 TemplateView.vue 单文件拆出。两组条目：
 * - 表模板（每表渲染一次，多模板 CRUD）：点击冒泡 select 事件
 * - 字典分类模板（每分类渲染一次，仅一个，无新增/删除）：点击冒泡
 *   select-dict 事件
 * 头部「新增」冒泡 new 事件；选中态经 props 比较（activeKind + selectedId）。
 */
import { BookText, FileCode, Plus } from "@lucide/vue";
import { useTemplateStore } from "@/stores/template";

const props = defineProps<{ activeKind: "table" | "dict"; selectedId: string }>();
const emit = defineEmits<{ select: [id: string]; selectDict: []; new: [] }>();

const templateStore = useTemplateStore();
</script>

<template>
  <aside class="tpl-list">
    <div class="list-head">
      <span class="list-title">
        <FileCode :size="14" />
        模板管理
      </span>
      <a-button size="small" type="primary" @click="emit('new')">
        <template #icon><Plus :size="12" /></template>
        新增
      </a-button>
    </div>
    <div class="list-body">
      <div class="list-group-title">表模板（每表渲染一次）</div>
      <div
        v-for="t in templateStore.templates"
        :key="t.id"
        class="tpl-item"
        :class="{ selected: props.activeKind === 'table' && props.selectedId === t.id }"
        @click="emit('select', t.id)"
      >
        <span class="tpl-name mono">{{ t.name }}</span>
        <span class="tpl-size">{{ (t.content.length / 1024).toFixed(1) }}k</span>
      </div>
      <div v-if="!templateStore.templates.length" class="list-empty">暂无表模板</div>
      <div class="list-group-title">字典分类模板（每分类渲染一次）</div>
      <div
        class="tpl-item"
        :class="{ selected: props.activeKind === 'dict' }"
        @click="emit('selectDict')"
      >
        <span class="tpl-name mono">
          <BookText :size="12" class="tpl-icon" />
          {{ templateStore.dictCategoryTemplate?.name || "dict" }}
        </span>
        <span class="tpl-size">
          {{ ((templateStore.dictCategoryTemplate?.content.length || 0) / 1024).toFixed(1) }}k
        </span>
      </div>
    </div>
    <div class="list-foot">{{ templateStore.templates.length }} 个表模板 · 1 个字典分类模板</div>
  </aside>
</template>

<style lang="scss" scoped>
.tpl-list {
  width: 216px;
  min-width: 216px;
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
  }

  .list-body {
    .list-group-title {
      padding: 8px 10px 4px;
      font-size: 10.5px;
      font-weight: 600;
      color: var(--dbm-text-3);
      letter-spacing: 0.02em;
    }
    flex: 1;
    overflow-y: auto;
    padding: 0 8px;
  }

  .list-foot {
    padding: 7px 12px;
    border-top: 1px solid var(--dbm-border);
    font-size: 10.5px;
    color: var(--dbm-text-3);
    font-family: var(--dbm-font-mono);
  }
}

.tpl-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  border-radius: var(--dbm-radius-m);
  cursor: pointer;
  margin-bottom: 2px;

  &:hover {
    background: var(--dbm-bg-hover);
  }

  &.selected {
    background: var(--dbm-primary-weak);
  }

  .tpl-icon {
    vertical-align: -1.5px;
    margin-right: 2px;
    color: var(--dbm-text-3);
  }

  .tpl-name {
    flex: 1;
    font-size: 12.5px;
    font-weight: 600;
    color: var(--dbm-text-1);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tpl-size {
    font-size: 10px;
    color: var(--dbm-text-3);
    font-family: var(--dbm-font-mono);
  }
}

.list-empty {
  padding: 30px 10px;
  text-align: center;
  color: var(--dbm-text-3);
  font-size: 12px;
}

/* 移动端：列表转顶部条区 */
@media (max-width: 768px) {
  .tpl-list {
    width: 100%;
    min-width: 0;
    max-height: 26vh;
    border-right: none;
    border-bottom: 1px solid var(--dbm-border);
  }
}
</style>
