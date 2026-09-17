<script setup lang="ts">
/**
 * 设置页 · 分区四：代码生成（javadoc 作者 + 表/列选项元定义）
 *
 * 从原 SettingsView.vue 单文件拆出。作者写入生成代码的 @author；表选项与
 * 列选项定义控制「编辑表」对话框中的选项编辑项，模板按选项值选择性生成
 * 代码（选项值缺省视为启用）。
 *
 * 分区契约（defineExpose）：dirty / tip / warning / collect / resetDraft，
 * 语义同 TypeMappingSection。
 */
import { computed, ref, watch } from "vue";
import { Code2, Plus, SlidersHorizontal, Trash2 } from "@lucide/vue";
import type { OptionSetting } from "@/types/model";
import { useSettingsStore } from "@/stores/settings";
import { uid } from "@/utils/id";

const props = defineProps<{ id?: string }>();

const settingsStore = useSettingsStore();

const author = ref("");

watch(
  () => settingsStore.author,
  (v) => {
    author.value = String(v ?? "");
  },
  { immediate: true },
);

interface OptionDefDraft extends OptionSetting {
  key: string; // 客户端稳定 key（保存时剥离）
}

/** 选项定义 → 带稳定 key 的草稿行 */
function toDefDrafts(raw: OptionSetting[]): OptionDefDraft[] {
  return (raw || []).map((o) => ({
    name: o.name,
    type: o.type,
    label: o.label,
    remark: o.remark || "",
    dict: o.dict || "",
    key: uid("opt-"),
  }));
}

const tableOptions = ref<OptionDefDraft[]>([]);
const columnOptions = ref<OptionDefDraft[]>([]);

watch(
  () => settingsStore.tableOptions,
  (v) => {
    tableOptions.value = toDefDrafts(v);
  },
  { immediate: true },
);
watch(
  () => settingsStore.columnOptions,
  (v) => {
    columnOptions.value = toDefDrafts(v);
  },
  { immediate: true },
);

/** 选项类型预设（OptionType 允许任意自定义字符串，auto-complete 可自由输入） */
const optionTypeOptions = ["boolean", "string", "int", "long", "double"].map((t) => ({
  value: t,
  label: t,
}));

/** 添加空白表选项定义 */
function addTableOption() {
  tableOptions.value.push({
    key: uid("opt-"),
    name: "",
    type: "boolean",
    label: "",
    remark: "",
    dict: "",
  });
}

/** 删除表选项定义行 */
function removeTableOption(idx: number) {
  tableOptions.value.splice(idx, 1);
}

/** 添加空白列选项定义 */
function addColumnOption() {
  columnOptions.value.push({
    key: uid("opt-"),
    name: "",
    type: "boolean",
    label: "",
    remark: "",
    dict: "",
  });
}

/** 删除列选项定义行 */
function removeColumnOption(idx: number) {
  columnOptions.value.splice(idx, 1);
}

/** 选项定义校验：名称非空、合法标识符、列表内唯一 */
function optionDefError(def: OptionSetting): string | null {
  const name = String(def.name ?? "").trim();
  if (!name) return "名称不能为空";
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return "名称需为合法标识符（字母/数字/下划线）";
  return null;
}

/** 选项定义校验：名称合法标识符且列表内唯一 */
function optionDefsInvalid(defs: OptionDefDraft[]): string | null {
  const names = new Set<string>();
  for (const d of defs) {
    const err = optionDefError(d);
    if (err) return `「${d.name || "未命名"}」${err}`;
    const name = d.name.trim();
    if (names.has(name)) return `名称重复：${name}`;
    names.add(name);
  }
  return null;
}

const tableOptionsInvalid = computed(() => optionDefsInvalid(tableOptions.value));
const columnOptionsInvalid = computed(() => optionDefsInvalid(columnOptions.value));

const optionsInvalid = computed(() => tableOptionsInvalid.value || columnOptionsInvalid.value);

/* ==================== 分区契约 ==================== */

const dirty = computed(
  () =>
    author.value.trim() !== String(settingsStore.author ?? "").trim() ||
    JSON.stringify(tableOptions.value.map(({ key: _k, ...o }) => o)) !==
      JSON.stringify(settingsStore.tableOptions) ||
    JSON.stringify(columnOptions.value.map(({ key: _k, ...o }) => o)) !==
      JSON.stringify(settingsStore.columnOptions),
);

const tip = computed(() => (optionsInvalid.value ? `选项定义无效：${optionsInvalid.value}` : null));

const warning = computed(() =>
  optionsInvalid.value ? `选项定义无效：${optionsInvalid.value}` : null,
);

/** 载荷：名称/标签等去空白，类型缺省补 boolean，标签缺省回退名称 */
function collect() {
  return {
    author: author.value.trim(),
    tableOptions: tableOptions.value.map(({ key: _k, ...o }) => ({
      ...o,
      name: o.name.trim(),
      type: o.type.trim() || "boolean",
      label: o.label.trim() || o.name.trim(),
      remark: o.remark?.trim(),
      dict: o.dict?.trim(),
    })),
    columnOptions: columnOptions.value.map(({ key: _k, ...o }) => ({
      ...o,
      name: o.name.trim(),
      type: o.type.trim() || "boolean",
      label: o.label.trim() || o.name.trim(),
      remark: o.remark?.trim(),
      dict: o.dict?.trim(),
    })),
  };
}

/** 放弃修改：从 store 重建草稿 */
function resetDraft() {
  author.value = String(settingsStore.author ?? "");
  tableOptions.value = toDefDrafts(settingsStore.tableOptions);
  columnOptions.value = toDefDrafts(settingsStore.columnOptions);
}

defineExpose({ dirty, tip, warning, collect, resetDraft });
</script>

<template>
  <section :id="props.id" class="settings-card">
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
        列选项（默认：显示 / 查询 / 添加 / 更新 / 删除，驱动 controller 查询条件与 vue 列表/表单）
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
</template>

<style lang="scss" scoped>
@use "./card.scss";

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
</style>
