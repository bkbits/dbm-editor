<script setup lang="ts">
/**
 * 表编辑对话框 · 「字段」分区（SyncTable 多表同步滚动 + 约定字段一键操作）
 *
 * 从原 TableEditDialog.vue 单文件拆出。职责：
 * - 字段表格：表头 / 左右固定列（排序手柄、字段名 / 删除按钮）/ 中间滚动列
 *   经 SyncTable 六表结构同步滚动；列选项动态列（boolean=勾选，其余=输入）
 * - 主键首行锁定：不可修改、不可排序、不可删除（依设置约定固定为第一个字段）
 * - 字段拖拽排序（手柄触发，主键首行锁定不可拖、不可插入其上方）
 * - 审计字段与逻辑删除字段一键增删（依设置约定；逻辑删除每表至多一个，
 *   勾选互斥自动转移标记）
 *
 * 草稿经 props.draft 传入（对话框持有，reactive 对象就地编辑——跨组件
 * 共享同一份草稿状态，保存与校验仍由对话框统一承担）。
 */
import { computed } from "vue";
import { message } from "antdv-next";
import { Eraser, GripVertical, Lock, Plus, ShieldCheck, Trash2 } from "@lucide/vue";
import type { AuditFieldRole } from "@/types/model";
import SyncTable, { type StColumn } from "@/components/common/SyncTable.vue";
import { useUiStore } from "@/stores/ui";
import { useDictStore } from "@/stores/dict";
import { useSettingsStore } from "@/stores/settings";
import { toCamelCase } from "@/utils/string";
import { getJavaTypeByType, COMMON_DB_TYPES, COMMON_JAVA_TYPES } from "@/utils/javaType";
import { AUDIT_FIELD_ROLES } from "@/utils/fieldConvention";
import { useDragSort } from "@/composables/useDragSort";
import {
  makeAuditColumn,
  makeLogicDeleteColumn,
  newColumnDraft,
  type DraftColumn,
  type TableEditDraft,
} from "./columns";

const props = defineProps<{ draft: TableEditDraft }>();

const ui = useUiStore();
const dictStore = useDictStore();
const settingsStore = useSettingsStore();

/* ==================== 表格列定义 ==================== */

/**
 * 字段表格列定义（SyncTable 多表同步滚动结构）：
 * - 排序手柄 / 字段名固定左侧，删除按钮固定右侧，其余为中间滚动列
 * - 窄固定列（手柄 / 复选 / 删除）显式声明 minWidth，避免默认 80px 下限抬升
 * - 字段名 / Java属性名 / 注释为弹性列（不指定宽度，minWidth 为下限参与剩余分配）
 */
const fieldColumns = computed<StColumn[]>(() => {
  const cols: StColumn[] = [
    { key: "sort", title: "排序", width: 32, minWidth: 32, fixed: "left", align: "center" },
    { key: "name", title: "字段名", minWidth: 100, fixed: "left" },
    { key: "propertyName", title: "Java属性名", minWidth: 88 },
    { key: "type", title: "数据库类型", width: 136, minWidth: 136 },
    { key: "javaType", title: "Java类型", width: 122, minWidth: 122 },
    { key: "notNull", title: "非空", width: 48, minWidth: 48, align: "center" },
    { key: "primaryKey", title: "主键", width: 48, minWidth: 48, align: "center" },
    {
      key: "logicDelete",
      title: "逻辑删",
      width: 48,
      minWidth: 48,
      align: "center",
      thTitle: "逻辑删除字段（软删除标记，每表最多一个）",
    },
    { key: "dict", title: "字典", width: 112, minWidth: 112 },
    { key: "comment", title: "注释", minWidth: 76 },
  ];
  // 列选项动态列（boolean=勾选列，其余=输入列），键以 opt: 前缀避免与基础列冲突
  for (const def of settingsStore.columnOptions) {
    cols.push(
      def.type === "boolean"
        ? {
            key: `opt:${def.name}`,
            title: def.label,
            width: 48,
            minWidth: 48,
            align: "center",
            thTitle: `${def.label}：${def.remark || def.name}`,
            thClass: "opt-head",
          }
        : {
            key: `opt:${def.name}`,
            title: def.label,
            width: 100,
            minWidth: 100,
            thTitle: `${def.label}：${def.remark || def.name}`,
            thClass: "opt-head",
          },
    );
  }
  cols.push({ key: "del", title: "", width: 32, minWidth: 32, fixed: "right" });
  return cols;
});

/** 列选项定义反查（单元格插槽按 opt: 前缀键取回定义） */
function optDefOf(key: string) {
  const name = key.startsWith("opt:") ? key.slice(4) : "";
  return settingsStore.columnOptions.find((d) => d.name === name);
}

/* ==================== 字段行辅助 ==================== */

/** 主键行 = 首行（固定不可修改、不可排序） */
function isPkRow(idx: number): boolean {
  return idx === 0;
}

/** 字段行键（列 id） */
function fieldRowKey(idx: number) {
  return props.draft.columns[idx]?.id ?? idx;
}

/** 字段行附加类：拖拽指示 + 主键行标记（跨三表按 idx 统一驱动） */
function fieldRowClass(idx: number) {
  return [columnDrag.rowClass(idx), { "pk-row": isPkRow(idx) }];
}

/** 行可拖拽：拖拽手柄按下的瞬间（三张表体表同行一并置 draggable，任一处可发起） */
function fieldDraggable(idx: number) {
  return columnDrag.state.from === idx;
}

/* ==================== 字段编辑 ==================== */

const dictOptions = computed(() => [
  { value: "", label: "（无字典）" },
  ...dictStore.dicts.map((d) => ({ value: d.dictKey, label: `${d.dictKey} · ${d.label}` })),
]);

const dbTypeOptions = COMMON_DB_TYPES.map((t) => ({ value: t, label: t }));
const javaTypeOptions = COMMON_JAVA_TYPES.map((t) => ({ value: t, label: t }));

/** 添加空白字段（默认 VARCHAR(50)，选项默认值即补齐） */
function addColumn() {
  props.draft.columns.push(newColumnDraft(settingsStore.columnOptions));
}
/** 删除字段（主键首行不可删） */
function removeColumn(idx: number) {
  if (isPkRow(idx)) return; // 主键首行不可删除
  props.draft.columns.splice(idx, 1);
  renumber();
}

/* 字段拖拽排序（手柄触发，替代上移/下移按钮；主键首行锁定不可拖、不可插入其上方） */
const columnDrag = useDragSort(() => props.draft.columns, renumber, { lockCount: 1 });
/** 按位置重编 sort 字段 */
function renumber() {
  props.draft.columns.forEach((c, i) => (c.sort = i));
}
/** 字段名联动：未手改属性名时自动转小驼峰 */
function onColumnName(col: DraftColumn) {
  if (!col._propTouched) col.propertyName = toCamelCase(col.columnName, true);
}
/** 类型联动：未手改 Java 类型时按映射自动推导 */
function onTypeChange(col: DraftColumn) {
  if (!col._javaTouched) col.javaType = getJavaTypeByType(col.type);
}

/* ==================== 审计字段一键增删（依设置约定） ==================== */

/** 当前表中是否已存在指定名称的字段 */
function hasColumnName(name: string): boolean {
  const n = name.trim();
  return Boolean(n) && props.draft.columns.some((c) => c.columnName.trim() === n);
}

/** 审计字段约定名列表（按当前设置） */
const auditNames = computed(() =>
  AUDIT_FIELD_ROLES.map((role) => conventions.value.auditFields[role].name.trim()).filter(Boolean),
);
const allAuditPresent = computed(() => auditNames.value.every((n) => hasColumnName(n)));
const anyAuditPresent = computed(() => auditNames.value.some((n) => hasColumnName(n)));
const auditNamesLabel = computed(() => auditNames.value.join(" · "));

/** 一键补齐审计字段（已存在的同名字段跳过，不动用户数据） */
function addAuditFields() {
  let added = 0;
  for (const role of AUDIT_FIELD_ROLES) {
    const name = conventions.value.auditFields[role].name.trim();
    if (!name || hasColumnName(name)) continue;
    props.draft.columns.push(
      makeAuditColumn(
        {
          conventions: conventions.value,
          columnOptionDefs: settingsStore.columnOptions,
          matchJavaType: (dbType: string) => settingsStore.matchJavaType(dbType),
        },
        role,
        props.draft.columns.length,
      ),
    );
    added++;
  }
  renumber();
  if (added) message.success(`已按设置约定添加 ${added} 个审计字段`);
  else message.info("审计字段均已存在，无需添加");
}

/** 一键移除审计字段（仅删约定名称匹配的列，主键首行不受影响） */
function removeAuditFields() {
  const names = new Set(auditNames.value);
  const before = props.draft.columns.length;
  props.draft.columns = props.draft.columns.filter(
    (c, i) => i === 0 || !names.has(c.columnName.trim()),
  );
  renumber();
  const removed = before - props.draft.columns.length;
  if (removed) message.success(`已移除 ${removed} 个审计字段`);
  else message.info("当前表没有约定名称的审计字段");
}

/* ==================== 逻辑删除字段（依设置约定，每表至多一个） ==================== */

/** 主键与审计字段约定（来自应用设置） */
const conventions = computed(() => settingsStore.fieldConventions);

/** 当前逻辑删除字段（至多一个；导入/AI 脏数据可能多标，对话框保存校验兜底拦截） */
const logicDeleteColumn = computed(() => props.draft.columns.find((c) => c.logicDelete === true));

/** 约定的逻辑删除字段名 */
const logicDeleteName = computed(() => conventions.value.logicDelete.name.trim());

/** 逻辑删除字段约定描述（按钮行提示） */
const logicDeleteLabel = computed(() => {
  const conv = conventions.value.logicDelete;
  return `${conv.name} · ${conv.type}`;
});

/** 勾选互斥：勾选新的同时清除其他列标记（单表唯一），主键行禁止勾选 */
function onLogicDeleteToggle(col: DraftColumn, e: Event) {
  const checked = (e.target as HTMLInputElement).checked;
  if (!checked) {
    col.logicDelete = false;
    return;
  }
  let transferred = "";
  for (const c of props.draft.columns) {
    if (c !== col && c.logicDelete) {
      c.logicDelete = false;
      transferred = c.columnName;
    }
  }
  col.logicDelete = true;
  if (transferred) message.info(`逻辑删除标记已从「${transferred}」转移至当前字段（每表最多一个）`);
}

/** 一键添加逻辑删除字段：已存在同名列则直接复用打标记，否则依约定新建 */
function addLogicDeleteField() {
  const name = logicDeleteName.value;
  if (!name) {
    message.warning("逻辑删除字段约定名为空，请先在系统设置中配置");
    return;
  }
  const existing = props.draft.columns.find((c) => c.columnName.trim() === name);
  if (existing) {
    if (existing.logicDelete) {
      message.info(`字段「${name}」已是逻辑删除字段`);
      return;
    }
    for (const c of props.draft.columns) if (c !== existing) c.logicDelete = false;
    existing.logicDelete = true;
    message.success(`已将字段「${name}」标记为逻辑删除字段`);
    return;
  }
  props.draft.columns.push(
    makeLogicDeleteColumn(
      {
        conventions: conventions.value,
        columnOptionDefs: settingsStore.columnOptions,
        matchJavaType: (dbType: string) => settingsStore.matchJavaType(dbType),
      },
      props.draft.columns.length,
    ),
  );
  renumber();
  message.success(`已按设置约定添加逻辑删除字段「${name}」`);
}

/** 删除逻辑删除字段（整列移除并重排序号；主键首行防御性仅清标记） */
function removeLogicDeleteField() {
  const col = logicDeleteColumn.value;
  if (!col) {
    message.info("当前表没有逻辑删除字段");
    return;
  }
  const name = col.columnName.trim() || col.propertyName || "未命名字段";
  const idx = props.draft.columns.indexOf(col);
  if (idx > 0) {
    props.draft.columns.splice(idx, 1);
    renumber();
    message.success(`已删除逻辑删除字段「${name}」`);
  } else {
    // 防御：主键首行不可删（正常情况下主键行不会带逻辑删除标记）
    col.logicDelete = false;
    message.warning("主键行不可删除，已仅清除其逻辑删除标记");
  }
}
</script>

<template>
  <SyncTable
    class="fields-table"
    :columns="fieldColumns"
    :row-count="draft.columns.length"
    :row-key="fieldRowKey"
    :row-class="fieldRowClass"
    :draggable="fieldDraggable"
    @row-dragstart="columnDrag.onDragStart"
    @row-dragend="columnDrag.onDragEnd"
    @row-dragover="columnDrag.onDragOver"
    @row-drop="columnDrag.onDrop"
  >
    <template #cell="{ col, idx }">
      <!-- 左固定列：排序手柄（主键首行锁定图标） -->
      <span
        v-if="col.key === 'sort' && isPkRow(idx)"
        class="drag-handle pk-lock"
        title="主键字段（依设置约定固定为第一个字段，不可修改、不可排序）"
      >
        <Lock :size="12" />
      </span>
      <span
        v-else-if="col.key === 'sort'"
        class="drag-handle"
        title="拖拽排序"
        @pointerdown="columnDrag.handleDown(idx)"
      >
        <GripVertical :size="13" />
      </span>
      <!-- 左固定列：字段名 -->
      <a-input
        v-else-if="col.key === 'name'"
        v-model:value="draft.columns[idx].columnName"
        size="small"
        class="mono"
        placeholder="字段名"
        :disabled="isPkRow(idx)"
        @change="onColumnName(draft.columns[idx])"
      />
      <!-- 中间列 -->
      <a-input
        v-else-if="col.key === 'propertyName'"
        v-model:value="draft.columns[idx].propertyName"
        size="small"
        class="mono"
        placeholder="小驼峰"
        :disabled="isPkRow(idx)"
        @change="draft.columns[idx]._propTouched = true"
      />
      <a-auto-complete
        v-else-if="col.key === 'type'"
        v-model:value="draft.columns[idx].type"
        :options="dbTypeOptions"
        size="small"
        class="mono"
        placeholder="如 VARCHAR(50)"
        :disabled="isPkRow(idx)"
        :filter-option="
          (input: string, option: any) =>
            String(option.value).toUpperCase().includes(input.toUpperCase())
        "
        @change="onTypeChange(draft.columns[idx])"
      />
      <a-auto-complete
        v-else-if="col.key === 'javaType'"
        v-model:value="draft.columns[idx].javaType"
        :options="javaTypeOptions"
        size="small"
        class="mono"
        placeholder="如 String"
        :disabled="isPkRow(idx)"
        :filter-option="
          (input: string, option: any) =>
            String(option.value).toLowerCase().includes(input.toLowerCase())
        "
        @change="draft.columns[idx]._javaTouched = true"
      />
      <a-checkbox
        v-else-if="col.key === 'notNull'"
        v-model:checked="draft.columns[idx].notNull"
        :disabled="isPkRow(idx)"
      />
      <span
        v-else-if="col.key === 'primaryKey'"
        title="主键标记锁定：首字段固定为主键（依设置约定）"
      >
        <a-checkbox v-model:checked="draft.columns[idx].primaryKey" disabled />
      </span>
      <a-checkbox
        v-else-if="col.key === 'logicDelete'"
        :checked="draft.columns[idx].logicDelete === true"
        :disabled="isPkRow(idx)"
        @change="onLogicDeleteToggle(draft.columns[idx], $event)"
      />
      <a-select
        v-else-if="col.key === 'dict'"
        v-model:value="draft.columns[idx].dict"
        :options="dictOptions"
        size="small"
        placeholder="无"
        allow-clear
        show-search
        option-filter-prop="label"
        :disabled="isPkRow(idx)"
      />
      <a-input
        v-else-if="col.key === 'comment'"
        v-model:value="draft.columns[idx].comment"
        size="small"
        placeholder="选填"
        :disabled="isPkRow(idx)"
      />
      <!-- 列选项动态列（boolean=勾选，其余=输入） -->
      <template v-else-if="col.key.startsWith('opt:')">
        <a-checkbox
          v-if="optDefOf(col.key)?.type === 'boolean'"
          v-model:checked="draft.columns[idx]._optVals[optDefOf(col.key)!.name]"
          :disabled="isPkRow(idx)"
        />
        <a-input
          v-else
          v-model:value="draft.columns[idx]._optVals[optDefOf(col.key)!.name]"
          size="small"
          class="mono opt-col-input"
          :placeholder="optDefOf(col.key)!.name"
          :title="optDefOf(col.key)!.remark || optDefOf(col.key)!.label"
          :disabled="isPkRow(idx)"
        />
      </template>
      <!-- 右固定列：删除按钮（主键行占位） -->
      <button
        v-else-if="col.key === 'del' && !isPkRow(idx)"
        class="row-del"
        type="button"
        title="删除字段"
        @click="removeColumn(idx)"
      >
        <Trash2 :size="12" />
      </button>
      <span
        v-else-if="col.key === 'del'"
        class="row-del-placeholder"
        title="主键字段不可删除"
      ></span>
    </template>
  </SyncTable>
  <a-button size="small" type="dashed" block class="add-btn" @click="addColumn">
    <template #icon><Plus :size="12" /></template>
    添加字段
  </a-button>
  <!-- 审计字段与逻辑删除字段一键操作（依设置约定） -->
  <div class="audit-actions">
    <a-button v-if="!allAuditPresent" size="small" class="audit-add-btn" @click="addAuditFields">
      <template #icon><ShieldCheck :size="12" /></template>
      添加审计字段
    </a-button>
    <a-button
      v-if="anyAuditPresent"
      size="small"
      danger
      class="audit-del-btn"
      @click="removeAuditFields"
    >
      <template #icon><Trash2 :size="12" /></template>
      删除审计字段
    </a-button>
    <span class="audit-tip" :title="auditNamesLabel">审计字段：{{ auditNamesLabel }}</span>
    <a-button
      v-if="!logicDeleteColumn"
      size="small"
      class="logic-add-btn"
      @click="addLogicDeleteField"
    >
      <template #icon><Eraser :size="12" /></template>
      添加逻辑删除字段
    </a-button>
    <a-button
      v-else
      size="small"
      danger
      class="logic-del-btn"
      title="删除当前逻辑删除字段（整列移除）"
      @click="removeLogicDeleteField"
    >
      <template #icon><Trash2 :size="12" /></template>
      删除逻辑字段
    </a-button>
    <span class="audit-tip" :title="`逻辑删除字段：${logicDeleteLabel}`">
      逻辑删除：{{ logicDeleteLabel }}
    </span>
  </div>
</template>

<style lang="scss" scoped>
/*
 * 字段表格（SyncTable 多表同步滚动结构）的领域样式：
 * 行悬停 / 拖拽指示 / 行圆角 / 行高由组件内通用规则承担（按行级状态跨三表统一驱动），
 * 这里仅补充主键首行的领域底色（跨三表同行同步着色）。
 */
.fields-table {
  :deep(tr.pk-row > td) {
    background: var(--dbm-bg-hover);
  }

  /* 列选项表头（动态列）窄字号省略号 */
  :deep(th.opt-head) {
    font-size: 10.5px;
  }
}

/* 字段表格选项列（表头与单元格） */
.opt-head {
  font-size: 10.5px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.opt-col-input {
  width: 100%;
  min-width: 0;
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

/* 主键行锁定手柄：无拖拽语义，主色提示 */
.pk-lock {
  color: var(--dbm-primary);
  cursor: default;

  &:hover {
    color: var(--dbm-primary);
    background: transparent;
  }
}

/* 主键行末列占位（删除按钮位置，保持网格列数一致） */
.row-del-placeholder {
  display: inline-block;
  width: 22px;
  height: 22px;
}

/* 行删除按钮 */
.row-del {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border: none;
  border-radius: 3px;
  background: transparent;
  color: var(--dbm-text-3);
  cursor: pointer;

  &:hover {
    background: var(--dbm-danger-weak);
    color: var(--dbm-danger);
  }
}

/* 虚线整宽添加按钮 */
.add-btn {
  margin-top: 6px;
}

/* 审计字段一键增删按钮行 */
.audit-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 6px;
  flex-wrap: wrap;

  .audit-tip {
    font-size: 11px;
    color: var(--dbm-text-3);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }
}

/* 移动端：字段表高度上限经 --st-max-h 传入 SyncTable */
@media (max-width: 768px) {
  .fields-table {
    --st-max-h: calc(44vh + 36px);
  }
}
</style>
