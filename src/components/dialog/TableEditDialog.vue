<script setup lang="ts">
/**
 * 表编辑对话框（新增 / 编辑表）
 *
 * 由原 1520 行单文件拆分为本文件 + src/components/dialog/table-edit/ 子模块
 * （行为等价拆分）：
 * - columns.ts：字段草稿类型 + 选项工具 + 依「字段约定」构造 / 归一化字段
 *   的纯函数工厂（对话框与字段分区共享）
 * - FieldsSection：「字段」分区（SyncTable 多表同步滚动 + 主键首行锁定 +
 *   审计 / 逻辑删除字段一键操作）
 * - IndexesSection：「索引」分区（简单网格 + 窄屏横向滚动）
 * - NavigatesSection：「导航」分区（实时导航列表 + 编辑 / 删除）
 *
 * 本文件持有表草稿（reactive，经 props 分发给各分区就地编辑），承担：
 * 基本信息（分类 / 表名 / 类名 / 注释 / 树形开关）、启用模板与表选项、
 * 打开时的草稿初始化（新建依约定建主键字段；编辑归一化主键首行）、
 * 校验与保存（新建 / 更新走模型仓库，失败提示中文业务信息）。
 */
import { computed, reactive, ref, watch } from "vue";
import { message } from "antdv-next";
import type { AuditFieldRole } from "@/types/model";
import { useUiStore } from "@/stores/ui";
import { useModelStore } from "@/stores/model";
import { useDictStore } from "@/stores/dict";
import { useCanvasStore } from "@/stores/canvas";
import { useSettingsStore } from "@/stores/settings";
import { useTemplateStore } from "@/stores/template";
import { toCamelCase } from "@/utils/string";
import { getJavaTypeByType } from "@/utils/javaType";
import FieldsSection from "./table-edit/FieldsSection.vue";
import IndexesSection from "./table-edit/IndexesSection.vue";
import NavigatesSection from "./table-edit/NavigatesSection.vue";
import {
  buildOptionRecord,
  flattenRawOptions,
  fillOptionDefaults,
  makePkColumn,
  normalizePkColumn,
  type TableEditDraft,
  type ColumnFactoryDeps,
} from "./table-edit/columns";

const ui = useUiStore();
const model = useModelStore();
const dictStore = useDictStore();
const canvas = useCanvasStore();
const settingsStore = useSettingsStore();
const templateStore = useTemplateStore();

const isEdit = computed(() => Boolean(ui.tableEdit.tableId));

const draft = reactive<TableEditDraft>({
  id: "",
  categoryId: "",
  tableName: "",
  className: "",
  comment: "",
  parentIdColumn: "",
  x: 0,
  y: 0,
  columns: [],
  indexes: [],
  activeTab: "columns",
  templates: [],
  optionVals: {},
});

/** 字段工厂依赖快照（约定 + 列选项定义 + 类型规则匹配器，调用时点取值；
 *  matchJavaType 用箭头包装以保持 store 方法的 this 绑定） */
const columnDeps = computed<ColumnFactoryDeps>(() => ({
  conventions: settingsStore.fieldConventions,
  columnOptionDefs: settingsStore.columnOptions,
  matchJavaType: (dbType: string) => settingsStore.matchJavaType(dbType),
}));

/** 表模板选择：未显式配置且未手动改动时展示全部（响应式跟随模板加载） */
const templatesExplicit = ref(false);
const templatesTouched = ref(false);
const templatesSelected = computed<string[]>({
  get: () =>
    templatesExplicit.value || templatesTouched.value
      ? draft.templates
      : [...templateStore.templateNames],
  set: (vals) => {
    templatesTouched.value = true;
    draft.templates = vals;
  },
});
const templateCheckOptions = computed(() =>
  templateStore.templates.map((t) => ({ value: t.name, label: t.name })),
);

/** 表选项定义（来自应用设置） */
const tableOptionDefs = computed(() => settingsStore.tableOptions);

/** 树形表开关：开启时父ID字段默认 parent_id，关闭时清空 */
const treeEnabled = computed({
  get: () => Boolean(draft.parentIdColumn.trim()),
  set: (v: boolean) => {
    draft.parentIdColumn = v ? draft.parentIdColumn.trim() || "parent_id" : "";
  },
});

const dialogOpen = computed(() => ui.tableEdit.open);

/** 对话框打开：依「编辑既有表 / 新建表」初始化草稿 */
watch(dialogOpen, (open) => {
  if (!open) return;
  dictStore.init();
  // 索引类型选项来自应用设置（首次打开时预载）
  settingsStore.init();
  // 模板列表用于「启用模板」多选
  templateStore.init();
  templatesTouched.value = false;
  const state = ui.tableEdit;
  if (state.tableId) {
    const t = model.tableById(state.tableId);
    if (!t) return;
    draft.id = t.id;
    draft.categoryId = t.categoryId;
    draft.tableName = t.tableName;
    draft.className = t.className || "";
    draft.comment = t.comment || "";
    draft.parentIdColumn = t.parentIdColumn || "";
    draft.x = t.x ?? 0;
    draft.y = t.y ?? 0;
    const rawTpl = (t.templates ?? "").trim();
    templatesExplicit.value = Boolean(rawTpl);
    draft.templates = rawTpl
      ? rawTpl
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : [];
    draft.optionVals = flattenRawOptions(t.options);
    draft.columns = normalizePkColumn(
      columnDeps.value,
      model.columnsOf(t.id).map((c) => ({
        ...c,
        _optVals: flattenRawOptions(c.options),
      })),
    );
    draft.indexes = model.indexesOf(t.id).map((i) => ({ ...i, columns: [...i.columns] }));
    fillOptionDefaults(draft.optionVals, settingsStore.tableOptions);
    for (const col of draft.columns)
      fillOptionDefaults((col._optVals ||= {}), settingsStore.columnOptions);
  } else {
    const world =
      state.position ?? canvas.screenToWorld({ x: canvas.viewportW / 2, y: canvas.viewportH / 2 });
    draft.id = "";
    draft.categoryId = state.defaultCategoryId || model.categories[0]?.id || "";
    draft.tableName = "";
    draft.className = "";
    draft.comment = "";
    draft.parentIdColumn = "";
    draft.x = world.x - 130;
    draft.y = world.y - 60;
    templatesExplicit.value = false;
    draft.templates = [];
    draft.optionVals = {};
    // 新建表：首字段固定为设置约定的主键字段
    draft.columns = [makePkColumn(columnDeps.value)];
    draft.indexes = [];
  }
  draft.activeTab = "columns";
});

/** 选项定义异步加载后补齐缺失默认值（不动已加载的显式值） */
watch(
  () => settingsStore.tableOptions,
  (defs) => fillOptionDefaults(draft.optionVals, defs),
);
watch(
  () => settingsStore.columnOptions,
  (defs) => {
    for (const col of draft.columns) fillOptionDefaults((col._optVals ||= {}), defs);
  },
);

/* ==================== 基本信息选项 ==================== */

const categoryOptions = computed(() =>
  model.categories.map((c) => ({ value: c.id, label: `${c.name}（${c.basePackage}）` })),
);

/* 父ID字段候选：当前字段列表 */
const parentColumnOptions = computed(() =>
  draft.columns
    .filter((c) => c.columnName.trim())
    .map((c) => ({ value: c.columnName, label: c.columnName })),
);

/** 表名失焦：新建态自动推导实体类名（大驼峰） */
function onTableNameBlur() {
  if (!isEdit.value && !draft.className.trim() && draft.tableName.trim()) {
    draft.className = toCamelCase(draft.tableName);
  }
}

/* ==================== 校验与保存 ==================== */

const saving = reactive({ loading: false });

/** 主键与审计字段约定（校验用） */
const conventions = computed(() => settingsStore.fieldConventions);

/** 保存前校验：分类 / 表名唯一 / 主键首行 / 字段唯一 / 逻辑删除唯一 / 索引引用 / 树形父ID / 模板非空 */
function validate(): string | null {
  if (!draft.categoryId) return "请选择所属分类";
  if (!draft.tableName.trim()) return "表名不能为空";
  const dupName = model.tables.find(
    (t) => t.tableName === draft.tableName.trim() && t.id !== draft.id,
  );
  if (dupName) return `表名已存在：${draft.tableName}`;
  // 主键不变量：首字段固定为设置约定的主键字段（正常交互下构造保证，此为兜底校验）
  const pkName = conventions.value.primaryKey.name.trim();
  if (!draft.columns.length || draft.columns[0].columnName.trim() !== pkName) {
    return `首字段必须为主键字段「${pkName}」（可在系统设置中调整约定）`;
  }
  const names = new Set<string>();
  for (const c of draft.columns) {
    if (!c.columnName.trim()) return "存在空字段名";
    if (names.has(c.columnName)) return `字段名重复：${c.columnName}`;
    names.add(c.columnName);
  }
  // 逻辑删除字段唯一性兜底（交互勾选已互斥；拦截导入/AI 构造的多标数据）
  if (draft.columns.filter((c) => c.logicDelete === true).length > 1)
    return "逻辑删除字段最多只能有一个，请取消多余的标记";
  const idxNames = new Set<string>();
  for (const i of draft.indexes) {
    if (!i.indexName.trim()) return "存在空索引名";
    if (idxNames.has(i.indexName)) return `索引名重复：${i.indexName}`;
    idxNames.add(i.indexName);
    if (!i.columns.length) return `索引 ${i.indexName} 未选择字段`;
    for (const col of i.columns) {
      if (!names.has(col)) return `索引 ${i.indexName} 引用了不存在的字段：${col}`;
    }
  }
  if (treeEnabled.value) {
    const parentCol = draft.parentIdColumn.trim();
    if (!parentCol) return "树形表需填写父ID字段";
    if (!names.has(parentCol)) return `树形父ID字段「${parentCol}」不存在，请先在字段列表中添加`;
  }
  // 启用模板：空字符串语义为「启用全部」，无法表达「一个都不启用」——手动取消全部时拦截
  if (templateStore.templates.length && templatesSelected.value.length === 0) {
    return "启用模板不能为空（全选即启用全部模板）";
  }
  return null;
}

/** 保存表：草稿转载荷（选项记录化 / 模板序列化），新建 / 更新分流走模型仓库 */
async function save() {
  const err = validate();
  if (err) {
    message.warning(err);
    return;
  }
  saving.loading = true;
  try {
    // 全选（或模板列表为空）→ 存 undefined（启用全部）；否则存逗号分割的显式列表
    const templatesStr =
      templateStore.templates.length &&
      templatesSelected.value.length !== templateStore.templateNames.length
        ? templatesSelected.value.join(",")
        : undefined;
    const tableOptions = buildOptionRecord(
      draft.optionVals,
      settingsStore.tableOptions,
      (name, value) => ({ tableId: draft.id, name, value }),
    );
    const columns = draft.columns.map((c) => ({
      id: c.id,
      tableId: draft.id,
      columnName: c.columnName.trim(),
      propertyName: (c.propertyName || toCamelCase(c.columnName, true)).trim(),
      sort: c.sort,
      type: c.type,
      javaType: c.javaType || getJavaTypeByType(c.type),
      comment: c.comment || "",
      notNull: c.notNull,
      primaryKey: c.primaryKey,
      logicDelete: c.logicDelete === true ? true : undefined,
      dict: c.dict || "",
      options: buildOptionRecord(c._optVals || {}, settingsStore.columnOptions, (name, value) => ({
        columnId: c.id,
        name,
        value,
      })),
    }));
    const indexes = draft.indexes.map((i) => ({
      id: i.id,
      tableId: draft.id,
      indexName: i.indexName.trim(),
      type: i.type,
      columns: [...i.columns],
      comment: i.comment || "",
    }));
    if (isEdit.value) {
      await model.saveTable({
        id: draft.id,
        categoryId: draft.categoryId,
        tableName: draft.tableName.trim(),
        className: draft.className.trim() || toCamelCase(draft.tableName),
        comment: draft.comment.trim(),
        parentIdColumn: treeEnabled.value ? draft.parentIdColumn.trim() : undefined,
        x: draft.x,
        y: draft.y,
        templates: templatesStr,
        options: tableOptions,
        columns,
        indexes,
      });
      message.success(`表「${draft.tableName}」已更新`);
    } else {
      const newId = await model.createTable({
        categoryId: draft.categoryId,
        tableName: draft.tableName.trim(),
        className: draft.className.trim() || toCamelCase(draft.tableName),
        comment: draft.comment.trim(),
        parentIdColumn: treeEnabled.value ? draft.parentIdColumn.trim() : undefined,
        x: draft.x,
        y: draft.y,
        templates: templatesStr,
        options: tableOptions,
        columns,
        indexes,
      });
      canvas.setSelection([newId]);
      canvas.centerOnTable(newId);
      message.success(`表「${draft.tableName}」已创建`);
    }
    ui.closeTableEdit();
  } catch (e: unknown) {
    message.error((e as Error)?.message || "保存失败");
  } finally {
    saving.loading = false;
  }
}
</script>

<template>
  <a-modal
    :open="dialogOpen"
    :title="isEdit ? `编辑表 · ${draft.tableName || ''}` : '新增表'"
    width="min(980px, 94vw)"
    wrap-class-name="dbm-modal-wrap"
    :mask-closable="false"
    @cancel="ui.closeTableEdit()"
  >
    <template #footer>
      <a-button @click="ui.closeTableEdit()">取消</a-button>
      <a-button type="primary" :loading="saving.loading" @click="save">保存</a-button>
    </template>

    <div class="form-grid">
      <div class="form-item">
        <label>所属分类<span class="req">*</span></label>
        <a-select
          v-model:value="draft.categoryId"
          :options="categoryOptions"
          placeholder="选择分类"
          size="small"
        />
      </div>
      <div class="form-item">
        <label>表名<span class="req">*</span></label>
        <a-input
          v-model:value="draft.tableName"
          placeholder="如 sys_user"
          size="small"
          @blur="onTableNameBlur"
        />
      </div>
      <div class="form-item">
        <label>实体类名</label>
        <a-input v-model:value="draft.className" placeholder="默认表名大驼峰" size="small" />
      </div>
      <div class="form-item grow">
        <label>表注释</label>
        <a-input v-model:value="draft.comment" placeholder="选填" size="small" />
      </div>
      <div class="form-item tree-item">
        <label>树形表</label>
        <div class="tree-row">
          <a-checkbox v-model:checked="treeEnabled">启用（父ID字段）</a-checkbox>
          <a-auto-complete
            v-model:value="draft.parentIdColumn"
            :options="parentColumnOptions"
            :disabled="!treeEnabled"
            size="small"
            class="mono tree-input"
            placeholder="parent_id"
            :filter-option="
              (input: string, option: any) =>
                String(option.value).toLowerCase().includes(input.toLowerCase())
            "
          />
        </div>
      </div>

      <div class="form-item full-item">
        <label>启用模板</label>
        <div class="tpl-check-row">
          <a-checkbox-group
            v-model:value="templatesSelected"
            :options="templateCheckOptions"
            class="tpl-check-group"
          />
          <span class="field-tip">全选或不配置 = 启用全部模板，代码生成仅包含所选模板</span>
        </div>
      </div>

      <div v-if="tableOptionDefs.length" class="form-item full-item">
        <label>表选项</label>
        <div class="opt-row">
          <template v-for="def in tableOptionDefs" :key="def.name">
            <a-checkbox
              v-if="def.type === 'boolean'"
              v-model:checked="draft.optionVals[def.name]"
              :title="def.remark || def.label"
            >
              {{ def.label }}
            </a-checkbox>
            <span v-else class="opt-input-wrap" :title="def.remark || def.label">
              <span class="opt-label">{{ def.label }}</span>
              <a-input
                v-model:value="draft.optionVals[def.name]"
                size="small"
                class="mono opt-input"
                :placeholder="def.name"
              />
            </span>
          </template>
        </div>
      </div>
    </div>

    <a-tabs v-model:active-key="draft.activeTab" size="small" class="edit-tabs">
      <!-- 字段（多表同步滚动 + 约定字段一键操作） -->
      <a-tab-pane key="columns" :tab="`字段（${draft.columns.length}）`">
        <FieldsSection :draft="draft" />
      </a-tab-pane>

      <!-- 索引（窄屏整体横向滚动） -->
      <a-tab-pane key="indexes" :tab="`索引（${draft.indexes.length}）`">
        <IndexesSection :draft="draft" />
      </a-tab-pane>

      <!-- 导航 -->
      <a-tab-pane
        key="navigates"
        :tab="`导航（${draft.id ? model.navigatesOf(draft.id).length : 0}）`"
      >
        <NavigatesSection :draft="draft" />
      </a-tab-pane>
    </a-tabs>
  </a-modal>
</template>

<style lang="scss" scoped>
.form-grid {
  display: grid;
  grid-template-columns: 220px 200px 180px 1fr;
  gap: 10px 12px;
  margin-bottom: 12px;

  .form-item {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;

    &.grow {
      min-width: 140px;
    }

    &.tree-item {
      grid-column: span 2;
    }

    /* 整行表单项（启用模板 / 表选项） */
    &.full-item {
      grid-column: 1 / -1;
    }

    label {
      font-size: 11.5px;
      color: var(--dbm-text-2);

      .req {
        color: var(--dbm-danger);
        margin-left: 2px;
      }
    }
  }
}

/* 启用模板：复选组 + 提示 */
.tpl-check-row {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  min-height: 24px;

  .tpl-check-group {
    display: inline-flex;
    flex-wrap: wrap;
    gap: 2px 10px;
  }

  .field-tip {
    font-size: 11px;
    color: var(--dbm-text-3);
  }
}

/* 表选项：勾选/输入混排 */
.opt-row {
  display: flex;
  align-items: center;
  gap: 6px 14px;
  flex-wrap: wrap;
  min-height: 24px;

  .opt-input-wrap {
    display: inline-flex;
    align-items: center;
    gap: 5px;

    .opt-label {
      font-size: 12px;
      color: var(--dbm-text-2);
      white-space: nowrap;
    }

    .opt-input {
      width: 110px;
    }
  }
}

.tree-row {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 24px;

  .tree-input {
    flex: 1;
    min-width: 120px;
    max-width: 240px;
  }
}

.edit-tabs {
  :deep(.ant-tabs-content) {
    padding-top: 4px;
  }
}

/* 移动端适配：基本信息四列 → 双列 */
@media (max-width: 768px) {
  .form-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px 10px;
  }
}
</style>
