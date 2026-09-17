<script setup lang="ts">
/**
 * 模板管理页（页面级编排）
 *
 * 由原 1010 行单文件拆分为本文件 + src/views/template/ 子组件（行为等价拆分）：
 * - TemplateListPane：左侧列表（表模板 CRUD 条目 + 字典分类模板条目）
 * - EtaEditor：模板脚本编辑器（textarea + Eta 语法高亮覆盖层）
 * - TemplatePreviewPane：实时预览（目标选择 + 错误/丢弃/路径条 + 代码高亮）
 * - TemplateHelpPanel：上下文变量与工具速查（折叠内聚）
 *
 * 本文件持有两份草稿（表模板 draft / 字典分类模板 dictDraft，按 activeKind
 * 切换）与预览调度（350ms 防抖，表模板按目标表渲染、字典模板按目标分类
 * 渲染），承担选择、保存与删除编排。
 */
import { computed, onMounted, reactive, ref, watch } from "vue";
import { message, Modal } from "antdv-next";
import { Save, Trash2 } from "@lucide/vue";
import type { CodeTemplate } from "@/types/model";
import { useTemplateStore } from "@/stores/template";
import { useModelStore } from "@/stores/model";
import { useDictStore } from "@/stores/dict";
import { renderDictCategoryTemplate } from "@/utils/render";
import { highlightCode, resolveLanguage } from "@/utils/highlight";
import TemplateListPane from "./template/TemplateListPane.vue";
import EtaEditor from "./template/EtaEditor.vue";
import TemplatePreviewPane from "./template/TemplatePreviewPane.vue";
import TemplateHelpPanel from "./template/TemplateHelpPanel.vue";

const templateStore = useTemplateStore();
const model = useModelStore();
const dictStore = useDictStore();

onMounted(() => {
  templateStore.init();
  model.init();
  dictStore.init();
});

/* ==================== 列表与编辑状态 ==================== */

/** 编辑区模式：table = 表模板（多模板 CRUD）；dict = 字典分类模板（仅一个） */
const activeKind = ref<"table" | "dict">("table");

const draft = ref<CodeTemplate>({ id: "", name: "", content: "" });
const selectedId = ref("");

/* ==================== 字典分类模板（仅一个，无新增/删除） ==================== */

const dictDraft = ref<CodeTemplate>({ id: "", name: "dict", content: "" });
const dictSaving = reactive({ loading: false });
/** 字典模板预览目标分类 */
const previewCatId = ref("");

/** 切到字典分类模板编辑（加载唯一模板与默认预览分类） */
function selectDictTemplate() {
  activeKind.value = "dict";
  const t = templateStore.dictCategoryTemplate;
  if (t) dictDraft.value = { id: t.id, name: t.name, content: t.content };
  if (!previewCatId.value && dictStore.categories.length) {
    previewCatId.value = dictStore.categories[0].id;
  }
  schedulePreview();
}

const categoryOptions = computed(() =>
  dictStore.categories.map((c) => ({
    value: c.id,
    label: `${c.name}（${dictStore.dicts.filter((d) => d.categoryId === c.id).length} 字典）`,
  })),
);

/** 保存字典分类模板（名称 / 内容非空校验） */
async function saveDictTemplate() {
  if (!dictDraft.value.name.trim()) {
    message.warning("模板名称不能为空");
    return;
  }
  if (!dictDraft.value.content.trim()) {
    message.warning("模板内容不能为空");
    return;
  }
  dictSaving.loading = true;
  try {
    const saved = await templateStore.saveDictCategoryTemplate({ ...dictDraft.value });
    dictDraft.value = { ...saved };
    message.success("字典分类模板已保存");
  } catch {
    /* store 已提示 */
  } finally {
    dictSaving.loading = false;
  }
}

/** 选中表模板并重载草稿与预览 */
function selectTemplate(id: string) {
  const tpl = templateStore.templates.find((t) => t.id === id);
  if (tpl) {
    activeKind.value = "table";
    selectedId.value = id;
    draft.value = { id: tpl.id, name: tpl.name, content: tpl.content };
    schedulePreview();
  }
}

/** 新建表模板草稿（取消选中） */
function newTemplate() {
  activeKind.value = "table";
  const t = templateStore.newTemplateDraft();
  draft.value = { ...t };
  selectedId.value = "";
  schedulePreview();
}

/* ==================== 实时预览（350ms 防抖调度） ==================== */

const previewTableId = computed({
  get: () => templateStore.previewTableId,
  set: (v: string) => {
    templateStore.previewTableId = v;
  },
});

const tableOptions = computed(() =>
  model.tables.map((t) => ({
    value: t.id,
    label: `${t.tableName}${t.comment ? `（${t.comment}）` : ""}`,
  })),
);

const previewState = reactive<{
  output: string;
  fileName: string;
  filePath: string;
  error: string;
  language: string;
  aborted: boolean;
}>({
  output: "",
  fileName: "",
  filePath: "",
  error: "",
  language: "",
  aborted: false,
});

let previewTimer: ReturnType<typeof setTimeout> | null = null;
/** 预览防抖调度（350ms 合并连续输入） */
function schedulePreview() {
  if (previewTimer) clearTimeout(previewTimer);
  previewTimer = setTimeout(runPreview, 350);
}

/** 表模板预览：按目标表渲染（无表 / 渲染目标缺失给出提示文案） */
function runPreview() {
  if (activeKind.value === "dict") return runDictPreview();
  if (!draft.value.name && !draft.value.content) {
    previewState.output = "";
    previewState.error = "";
    previewState.language = "";
    previewState.aborted = false;
    return;
  }
  if (!previewTableId.value) {
    previewState.output = "请先在编辑器中创建表，或从数据库导入表结构。";
    previewState.error = "";
    previewState.language = "";
    previewState.aborted = false;
    return;
  }
  const out = templateStore.renderFor(draft.value, previewTableId.value);
  if (!out) {
    previewState.output = "";
    previewState.error = "渲染目标不存在";
    previewState.language = "";
    previewState.aborted = false;
    return;
  }
  previewState.output = out.result || "";
  previewState.fileName = out.fileName;
  previewState.filePath = out.filePath;
  previewState.error = out.error || "";
  previewState.language = out.language || "";
  previewState.aborted = Boolean(out.aborted);
}

watch(() => draft.value.content, schedulePreview);
watch(() => draft.value.name, schedulePreview);
watch(() => dictDraft.value.content, schedulePreview);
watch(() => dictDraft.value.name, schedulePreview);
watch(previewCatId, schedulePreview);
/* 切换预览目标表也需重渲染（选项驱动分支/aborted 提示按表变化） */
watch(previewTableId, schedulePreview);

/** 模板异步加载完成后选中首个模板（先于本组件挂载时已加载也需处理） */
watch(
  () => templateStore.loaded,
  (loaded) => {
    if (loaded && !draft.value.id && templateStore.templates.length) {
      selectTemplate(templateStore.templates[0].id);
    }
  },
  { immediate: true },
);

/** 模型已加载时设置默认预览表 */
watch(
  () => model.loaded,
  (loaded) => {
    if (loaded && !previewTableId.value && model.tables.length) {
      previewTableId.value = model.tables[0].id;
      schedulePreview();
    }
  },
  { immediate: true },
);

/** 字典分类模板实时预览：按目标分类渲染（含分类下全部字典与值） */
function runDictPreview() {
  if (!dictDraft.value.name && !dictDraft.value.content) {
    previewState.output = "";
    previewState.error = "";
    previewState.language = "";
    previewState.aborted = false;
    return;
  }
  const category = dictStore.categories.find((c) => c.id === previewCatId.value);
  if (!category) {
    previewState.output = "请先在「字典管理」中创建字典分类。";
    previewState.error = "";
    previewState.language = "";
    previewState.aborted = false;
    return;
  }
  const dicts = dictStore.dicts.filter((d) => d.categoryId === category.id);
  if (!dicts.length) {
    previewState.output = `分类「${category.name}」下暂无字典，生成产物将为空壳。`;
    previewState.error = "";
    previewState.language = "";
    previewState.aborted = false;
    return;
  }
  const out = renderDictCategoryTemplate(
    dictDraft.value.name,
    dictDraft.value.content,
    category,
    dicts,
  );
  previewState.output = out.result || "";
  previewState.fileName = out.fileName;
  previewState.filePath = out.filePath;
  previewState.error = out.error || "";
  previewState.language = out.language || "";
  previewState.aborted = Boolean(out.aborted);
}

const highlighted = computed(() =>
  highlightCode(previewState.output, resolveLanguage(previewState.fileName, previewState.language)),
);

/** 实际生效的高亮语言（显式指定优先，否则按后缀自动识别） */
const effectiveLanguage = computed(() =>
  previewState.error ? "" : resolveLanguage(previewState.fileName, previewState.language),
);

/* ==================== 编辑器内容绑定（按模式路由到对应草稿） ==================== */

const tablePlaceholder =
  "<% context.fileName = 'demo.txt' %>&#10;Hello <%= context.table.tableName %>!";
const dictPlaceholder =
  "<%# 每个字典分类渲染一次 %>&#10;// <%= context.category.name %> 共 <%= context.dicts.length %> 个字典";

/** 当前模式的模板内容（可写 computed：按 activeKind 路由读写到对应草稿） */
const activeContent = computed({
  get: () => (activeKind.value === "dict" ? dictDraft.value.content : draft.value.content),
  set: (v: string) => {
    if (activeKind.value === "dict") dictDraft.value.content = v;
    else draft.value.content = v;
  },
});

/* ==================== 保存 / 删除（表模板） ==================== */

const saving = reactive({ loading: false });

/** 表模板校验：名称 / 内容非空 */
function validate(): string | null {
  if (!draft.value.name.trim()) return "模板名称不能为空";
  if (!draft.value.content.trim()) return "模板内容不能为空";
  return null;
}

/** 保存表模板（新建 / 更新分流，保存后选中） */
async function saveTemplate() {
  const err = validate();
  if (err) {
    message.warning(err);
    return;
  }
  saving.loading = true;
  try {
    const saved = await templateStore.saveTemplate({ ...draft.value });
    draft.value = { ...saved };
    selectedId.value = saved.id;
    message.success("模板已保存");
  } catch {
    /* store 已提示 */
  } finally {
    saving.loading = false;
  }
}

/** 删除表模板（确认后选中首个或回到新草稿） */
function deleteTemplate() {
  if (!draft.value.id) {
    newTemplate();
    return;
  }
  Modal.confirm({
    title: `删除模板「${draft.value.name}」？`,
    content: "删除后代码生成将不再包含该模板。",
    okText: "删除",
    okType: "danger",
    cancelText: "取消",
    onOk: async () => {
      try {
        await templateStore.removeTemplate(draft.value.id);
        message.success("模板已删除");
        if (templateStore.templates.length) selectTemplate(templateStore.templates[0].id);
        else newTemplate();
      } catch {
        /* store 已提示失败原因；吞掉拒绝避免 unhandled rejection */
      }
    },
  });
}

const isEdit = computed(() => Boolean(draft.value.id));
</script>

<template>
  <div class="template-view">
    <TemplateListPane
      :active-kind="activeKind"
      :selected-id="selectedId"
      @select="selectTemplate"
      @select-dict="selectDictTemplate"
      @new="newTemplate"
    />

    <section class="tpl-main">
      <div class="tpl-head">
        <!-- 表模板 / 字典分类模板 共用编辑区：按模式绑定不同草稿与保存动作 -->
        <div class="tpl-name-input">
          <label>{{ activeKind === "dict" ? "字典分类模板名称" : "模板名称" }}</label>
          <a-input
            v-if="activeKind === 'dict'"
            v-model:value="dictDraft.name"
            size="small"
            class="mono"
            placeholder="如 dict"
            style="width: 220px"
          />
          <a-input
            v-else
            v-model:value="draft.name"
            size="small"
            class="mono"
            placeholder="如 entity"
            style="width: 220px"
          />
        </div>
        <div class="tpl-actions">
          <template v-if="activeKind === 'dict'">
            <span class="dict-only-tip">仅一个，无新增 / 删除</span>
            <a-button
              size="small"
              type="primary"
              :loading="dictSaving.loading"
              @click="saveDictTemplate"
            >
              <template #icon><Save :size="12" /></template>
              保存模板
            </a-button>
          </template>
          <template v-else>
            <a-popconfirm
              title="删除该模板？"
              ok-text="删除"
              cancel-text="取消"
              @confirm="deleteTemplate"
            >
              <a-button size="small" danger>
                <template #icon><Trash2 :size="12" /></template>
                删除
              </a-button>
            </a-popconfirm>
            <a-button size="small" type="primary" :loading="saving.loading" @click="saveTemplate">
              <template #icon><Save :size="12" /></template>
              保存模板
            </a-button>
          </template>
        </div>
      </div>

      <div class="tpl-split">
        <div class="tpl-editor">
          <div class="pane-head">
            <span>模板脚本（Eta 语法高亮，<code>&lt;%# %&gt;</code> 为注释）</span>
          </div>
          <EtaEditor
            v-model="activeContent"
            :placeholder="activeKind === 'dict' ? dictPlaceholder : tablePlaceholder"
          />
        </div>

        <TemplatePreviewPane
          v-model:preview-table-id="previewTableId"
          v-model:preview-cat-id="previewCatId"
          :active-kind="activeKind"
          :preview-state="previewState"
          :highlighted="highlighted"
          :effective-language="effectiveLanguage"
          :table-options="tableOptions"
          :category-options="categoryOptions"
        />
      </div>

      <TemplateHelpPanel />
    </section>
  </div>
</template>

<style lang="scss" scoped>
.template-view {
  display: flex;
  height: 100%;
  overflow: hidden;
}

.tpl-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 12px 14px;
  gap: 10px;
}

.tpl-head {
  display: flex;
  align-items: flex-end;
  gap: 12px;

  .tpl-name-input {
    display: flex;
    flex-direction: column;
    gap: 4px;

    label {
      font-size: 11.5px;
      color: var(--dbm-text-2);
    }
  }

  .dict-only-tip {
    font-size: 10.5px;
    color: var(--dbm-text-3);
  }

  .tpl-actions {
    margin-left: auto;
    display: flex;
    gap: 8px;
  }
}

.tpl-split {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.tpl-editor {
  display: flex;
  flex-direction: column;
  min-height: 0;
  border: 1px solid var(--dbm-border);
  border-radius: var(--dbm-radius-m);
  background: var(--dbm-bg-panel);
  overflow: hidden;
}

.pane-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 7px 12px;
  border-bottom: 1px solid var(--dbm-border);
  font-size: 11.5px;
  color: var(--dbm-text-2);
  flex-shrink: 0;

  code {
    font-family: var(--dbm-font-mono);
    color: var(--dbm-primary-text);
    background: var(--dbm-primary-weak);
    border-radius: 3px;
    padding: 0 4px;
  }
}

/* ===== 移动端适配：编辑/预览单列堆叠 ===== */
@media (max-width: 768px) {
  .template-view {
    flex-direction: column;
  }

  .tpl-main {
    flex: 1;
    min-height: 0;
    padding: 10px;
    gap: 8px;
  }

  .tpl-head {
    flex-wrap: wrap;
    gap: 8px;

    .tpl-actions {
      margin-left: auto;
    }
  }

  /* 桌面左右分屏 → 上下堆叠（编辑在上、预览在下，各自可滚）。
   * 行轨最小值必须归零：minmax(180px,…)/minmax(160px,…) 硬最小值之和超出弹性
   * 剩余高度时，网格内容会溢出容器与下方帮助面板重叠（本块为该缺陷修复） */
  .tpl-split {
    grid-template-columns: 1fr;
    grid-template-rows: minmax(0, 42fr) minmax(0, 58fr);
    gap: 8px;
  }
}
</style>
