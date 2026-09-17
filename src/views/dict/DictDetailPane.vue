<script setup lang="ts">
/**
 * 字典页 · 右侧编辑面板
 *
 * 从原 DictView.vue 单文件拆出。职责：
 * - 字典基本信息表单（分类 / 键 / 标签 / 注释）与保存 / 删除
 * - 字典值表格：值键 / 常量属性名（全大写自动转换）/ 标签（类型色点）/
 *   值类型（I/S/W/D）/ 自定义颜色 / 注释 / 删除；搜索命中行高亮
 * - 校验：键与标签非空、值键唯一、常量属性名唯一
 * - 草稿跟随选中字典（props.selectedId 变化即重载；页面 v-if 重挂时经
 *   immediate 立即同步一次——否则编辑区停留空白草稿）；store 异步加载
 *   完成后重载当前选中
 * - 经 defineExpose 暴露 newDraft()（页面级「新增字典」入口）
 */
import { computed, reactive, ref, watch } from "vue";
import { message, Modal } from "antdv-next";
import { BookText, Plus, Trash2 } from "@lucide/vue";
import type { Dict, DictValue, DictValueLabelType } from "@/types/model";
import { useDictStore } from "@/stores/dict";
import { uid } from "@/utils/id";

const props = defineProps<{ selectedId: string }>();
const emit = defineEmits<{ deleted: [] }>();

const dictStore = useDictStore();

/* ==================== 草稿 ==================== */

const draft = ref<Dict>({ id: "", dictKey: "", label: "", comment: "", values: [] });
const dirty = reactive({ saving: false });

watch(
  () => props.selectedId,
  (id) => {
    const dict = dictStore.dicts.find((d) => d.id === id);
    if (dict) {
      draft.value = JSON.parse(JSON.stringify(dict));
    }
  },
  // immediate：页面以 v-if 切换时组件会重新挂载，selectedId 来自 store 不会变化，
  // 普通 watch 不会触发，导致编辑区停留在空白草稿（显示「暂无字典值」）——挂载时立即同步一次
  { immediate: true },
);

watch(
  () => dictStore.loaded,
  (loaded) => {
    if (loaded) {
      const dict = dictStore.dicts.find((d) => d.id === props.selectedId);
      if (dict) draft.value = JSON.parse(JSON.stringify(dict));
    }
  },
);

const isEdit = computed(() => Boolean(draft.value.id));

/** 重置为空白新字典草稿（页面级「新增」入口；选中态清理由页面负责） */
function newDraft() {
  draft.value = {
    id: "",
    categoryId: "",
    dictKey: "",
    label: "",
    comment: "",
    values: [],
  };
}

/* ==================== 表单选项与展示 ==================== */

/** 字典表单的分类选项 */
const categoryOptions = computed(() =>
  dictStore.categories.map((c) => ({ value: c.id, label: c.name })),
);

const labelTypeOptions: Array<{ value: DictValueLabelType; label: string; color: string }> = [
  { value: "I", label: "I · Info", color: "var(--dbm-info)" },
  { value: "S", label: "S · Success", color: "var(--dbm-success)" },
  { value: "W", label: "W · Warning", color: "var(--dbm-warning)" },
  { value: "D", label: "D · Danger", color: "var(--dbm-danger)" },
];

const typeColor = (t: DictValueLabelType) =>
  ({
    I: "var(--dbm-info)",
    S: "var(--dbm-success)",
    W: "var(--dbm-warning)",
    D: "var(--dbm-danger)",
  })[t];

/** 值类型色点样式（自定义色优先） */
function typeStyle(v: DictValue) {
  return {
    background: v.color || `color-mix(in srgb, ${typeColor(v.labelType)} 15%, transparent)`,
    color: v.color || typeColor(v.labelType),
  };
}

/* ==================== 字典值编辑 ==================== */

/** 新增字典值行 */
function addValue() {
  draft.value.values.push({
    id: uid("dv-"),
    dictId: draft.value.id,
    valueKey: "",
    propertyName: "",
    label: "",
    labelType: "I",
    comment: "",
    color: "",
  });
}

/** 常量属性名输入即转大写（仅允许全大写，小写输入自动变为大写） */
function onPropertyNameInput(v: DictValue, val: string) {
  v.propertyName = String(val || "").toUpperCase();
}

/** 删除字典值行 */
function removeValue(idx: number) {
  draft.value.values.splice(idx, 1);
}

/* ==================== 校验 / 保存 / 删除 ==================== */

/** 字典校验：键 / 标签非空，值键唯一，常量属性名唯一 */
function validate(): string | null {
  if (!draft.value.dictKey.trim()) return "字典键不能为空";
  if (!draft.value.label.trim()) return "字典标签不能为空";
  const keys = new Set<string>();
  const propNames = new Set<string>();
  for (const v of draft.value.values) {
    if (!v.valueKey.trim()) return "存在空值键";
    if (keys.has(v.valueKey)) return `值键重复：${v.valueKey}`;
    keys.add(v.valueKey);
    // 常量属性名非空时查重（同名常量在生成代码中会冲突）
    const pn = (v.propertyName || "").trim();
    if (pn) {
      if (propNames.has(pn)) return `常量属性名重复：${pn}`;
      propNames.add(pn);
    }
  }
  return null;
}

/** 保存字典（新建 / 更新分流，成功后草稿收口为已保存值） */
async function saveDict() {
  const err = validate();
  if (err) {
    message.warning(err);
    return;
  }
  // 提示文案按「保存前是否为编辑态」判定——须在草稿替换为已保存值（携带 id）
  // 之前捕获，否则新建保存也会被判为编辑态提示「已更新」
  const wasEdit = isEdit.value;
  dirty.saving = true;
  try {
    const saved = await dictStore.saveDict(JSON.parse(JSON.stringify(draft.value)));
    draft.value = JSON.parse(JSON.stringify(saved));
    message.success(wasEdit ? "字典已更新" : "字典已创建");
  } catch {
    /* store 已提示 */
  } finally {
    dirty.saving = false;
  }
}

/** 删除字典（确认后向上冒泡 deleted 事件回到新草稿） */
function deleteDict() {
  if (!draft.value.id) {
    emit("deleted");
    return;
  }
  Modal.confirm({
    title: `删除字典「${draft.value.label}」？`,
    content: "已关联该字典的字段将失去参照（关联键保留，不再解析）。",
    okText: "删除",
    okType: "danger",
    cancelText: "取消",
    onOk: async () => {
      try {
        await dictStore.removeDict(draft.value.id);
        message.success("字典已删除");
        emit("deleted");
      } catch {
        /* store 已提示失败原因；吞掉拒绝避免 unhandled rejection */
      }
    },
  });
}

/* ==================== 搜索命中（行高亮与计数） ==================== */

const selectedHitCount = computed(() => {
  const kw = dictStore.keyword.trim().toLowerCase();
  if (!kw || !draft.value.id) return 0;
  const d = dictStore.dicts.find((x) => x.id === draft.value.id);
  if (!d) return 0;
  return d.values.filter(
    (v) =>
      v.valueKey.toLowerCase().includes(kw) ||
      v.label.toLowerCase().includes(kw) ||
      (v.comment || "").toLowerCase().includes(kw),
  ).length;
});

/** 字典值是否命中当前搜索关键词（值键 / 标签 / 注释） */
const isValueHit = (v: DictValue) => {
  const kw = dictStore.keyword.trim().toLowerCase();
  if (!kw) return false;
  return (
    v.valueKey.toLowerCase().includes(kw) ||
    v.label.toLowerCase().includes(kw) ||
    (v.comment || "").toLowerCase().includes(kw)
  );
};

defineExpose({ newDraft });
</script>

<template>
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
</template>

<style lang="scss" scoped>
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

/* ===== 移动端适配：七列栅格改双列卡片（注释独占一行，删除按钮靠右） ===== */
@media (max-width: 768px) {
  .dict-detail {
    flex: 1;
    min-height: 0;
    padding: 12px 12px 20px;
  }

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
