<script setup lang="ts">
import { computed, reactive, watch } from "vue";
import { message } from "antdv-next";
import { useUiStore } from "@/stores/ui";
import { useModelStore } from "@/stores/model";

const ui = useUiStore();
const model = useModelStore();

const dialogOpen = computed(() => ui.categoryEdit.open);
const isEdit = computed(() => Boolean(ui.categoryEdit.categoryId));

const draft = reactive({
  id: "",
  name: "",
  basePackage: "",
  src: "",
});

watch(dialogOpen, (open) => {
  if (!open) return;
  if (ui.categoryEdit.categoryId) {
    const cat = model.categoryById(ui.categoryEdit.categoryId);
    if (!cat) return;
    draft.id = cat.id;
    draft.name = cat.name;
    draft.basePackage = cat.basePackage;
    draft.src = cat.src || "";
  } else {
    draft.id = "";
    draft.name = "";
    draft.basePackage = "";
    draft.src = "";
  }
});

const saving = reactive({ loading: false });

/** 表单校验：返回首个错误文案（null 为通过） */
function validate(): string | null {
  if (!draft.name.trim()) return "分类名称不能为空";
  if (model.categories.some((c) => c.name === draft.name.trim() && c.id !== draft.id)) {
    return `分类名称已存在：${draft.name}`;
  }
  if (!draft.basePackage.trim()) return "基础包路径不能为空";
  return null;
}

/** 保存分类（新增 / 更新分流，失败提示） */
async function save() {
  const err = validate();
  if (err) {
    message.warning(err);
    return;
  }
  saving.loading = true;
  try {
    await model.saveCategory({
      id: draft.id || undefined,
      name: draft.name.trim(),
      basePackage: draft.basePackage.trim(),
      src: draft.src.trim(),
    });
    message.success(isEdit.value ? "分类已更新" : "分类已创建");
    ui.closeCategoryEdit();
  } catch (e: unknown) {
    const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message;
    message.error(msg || (e as Error)?.message || "保存失败");
  } finally {
    saving.loading = false;
  }
}
</script>

<template>
  <a-modal
    :open="dialogOpen"
    :title="isEdit ? `编辑分类 · ${draft.name}` : '新增分类'"
    width="min(480px, 94vw)"
    wrap-class-name="dbm-modal-wrap"
    :mask-closable="false"
    @cancel="ui.closeCategoryEdit()"
  >
    <template #footer>
      <a-button @click="ui.closeCategoryEdit()">取消</a-button>
      <a-button type="primary" :loading="saving.loading" @click="save">保存</a-button>
    </template>

    <div class="cat-form">
      <div class="item">
        <label>分类名称<span class="req">*</span></label>
        <a-input v-model:value="draft.name" size="small" placeholder="如 系统管理" />
      </div>
      <div class="item">
        <label>基础包路径<span class="req">*</span></label>
        <a-input
          v-model:value="draft.basePackage"
          size="small"
          class="mono"
          placeholder="如 com.example.system"
        />
      </div>
      <div class="item">
        <label>源码路径（用于替换）</label>
        <a-input
          v-model:value="draft.src"
          size="small"
          class="mono"
          placeholder="如 src/main/java/com/example/system"
        />
      </div>
    </div>
  </a-modal>
</template>

<style lang="scss" scoped>
.cat-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.item {
  display: flex;
  flex-direction: column;
  gap: 4px;

  label {
    font-size: 11.5px;
    color: var(--dbm-text-2);

    .req {
      color: var(--dbm-danger);
    }
  }
}
</style>
