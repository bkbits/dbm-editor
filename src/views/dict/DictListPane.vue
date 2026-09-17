<script setup lang="ts">
/**
 * 字典页 · 左侧列表面板
 *
 * 从原 DictView.vue 单文件拆出。职责：
 * - 搜索框（键 / 标签 / 注释 / 值过滤，命中文本高亮 mark）
 * - 按字典分类分组展示（可折叠；「未分类」独立分组不参与字典代码生成）
 * - 字典分类管理：新增 / 编辑（名称 / 基础包路径 / 类名称——大驼峰失焦自动
 *   转换）、删除（分类下仍有字典时不可删，由 store 校验提示）
 * - 点击字典项向上冒泡 select 事件（选中态由页面级持有）；「新增」冒泡 new
 */
import { computed, reactive, ref } from "vue";
import { message, Modal } from "antdv-next";
import {
  BookText,
  ChevronDown,
  ChevronRight,
  FolderPlus,
  Pencil,
  Plus,
  Search,
  Trash2,
} from "@lucide/vue";
import type { DictCategory } from "@/types/model";
import { useDictStore } from "@/stores/dict";
import { toCamelCase } from "@/utils/string";

const props = defineProps<{ selectedId: string }>();
const emit = defineEmits<{ select: [id: string]; new: [] }>();

const dictStore = useDictStore();

const keyword = computed({
  get: () => dictStore.keyword,
  set: (v: string) => {
    dictStore.keyword = v;
  },
});

/* ==================== 搜索命中高亮 ==================== */

/** HTML 转义（高亮注入前防注入） */
function escapeHtml(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** 关键词安全高亮（先转义再包围 mark，正则元字符已转义） */
function hl(text: string): string {
  const safe = escapeHtml(text);
  const kw = keyword.value.trim();
  if (!kw) return safe;
  const k = escapeHtml(kw).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return safe.replace(new RegExp(`(${k})`, "gi"), '<mark class="search-hit">$1</mark>');
}

/* ==================== 分类折叠 ==================== */

/** 折叠的分组（分类 id；「未分类」用 __uncat） */
const collapsedCats = reactive(new Set<string>());

/** 折叠 / 展开分类分组 */
function toggleCat(key: string) {
  if (collapsedCats.has(key)) collapsedCats.delete(key);
  else collapsedCats.add(key);
}

/* ==================== 分类管理（新增 / 编辑 / 删除） ==================== */

/** 分类编辑弹窗（新增/编辑共用；仅一个字典分类模板，分类不涉模板） */
const catModal = reactive({
  open: false,
  saving: false,
});
const catDraft = ref<DictCategory>({ id: "", name: "", basePackage: "", className: "" });

/** 打开新增字典分类弹窗 */
function newCategory() {
  catDraft.value = { id: "", name: "", basePackage: "", className: "" };
  catModal.open = true;
}

/** 打开编辑字典分类弹窗（载入既有值） */
function editCategory(category: DictCategory) {
  catDraft.value = {
    id: category.id,
    name: category.name,
    basePackage: category.basePackage || "",
    className: category.className || "",
  };
  catModal.open = true;
}

/** 类名称失活时归一为大驼峰（小驼峰/下划线/中划线自动转换，如 sys_dict → SysDict） */
function normalizeClassNameDraft() {
  const raw = (catDraft.value.className || "").trim();
  catDraft.value.className = raw ? toCamelCase(raw) : "";
}

/** 分类分组头悬停提示：字典代码默认产物路径 */
function catFileHint(c: DictCategory): string {
  const pkg = (c.basePackage || "").trim();
  const cls = (c.className || "").trim() || `${toCamelCase(c.name)}DictConstants`;
  const pkgPath = pkg ? pkg.replace(/\./g, "/") : "";
  return `字典代码默认产物：${(pkgPath ? `src/main/java/${pkgPath}/` : "") + cls}.java`;
}

/** 保存分类（名称非空 + 类名大驼峰校验） */
async function saveCategory() {
  if (!catDraft.value.name.trim()) {
    message.warning("分类名称不能为空");
    return;
  }
  const cls = (catDraft.value.className || "").trim();
  if (cls && !/^[A-Z][A-Za-z0-9]*$/.test(cls)) {
    message.warning("类名称必须为大驼峰结构（如 SysDictConstants）");
    return;
  }
  catModal.saving = true;
  try {
    await dictStore.saveDictCategory({ ...catDraft.value });
    catModal.open = false;
    message.success(catDraft.value.id ? "字典分类已更新" : "字典分类已创建");
  } catch {
    /* store 已提示 */
  } finally {
    catModal.saving = false;
  }
}

/** 删除分类（分类下仍有字典时由 store 拒绝） */
function removeCategory(category: DictCategory) {
  Modal.confirm({
    title: `删除字典分类「${category.name}」？`,
    content: "分类下仍有字典时将无法删除（请先移动或删除其下字典）。",
    okText: "删除",
    okType: "danger",
    cancelText: "取消",
    onOk: async () => {
      try {
        await dictStore.removeDictCategory(category.id);
        message.success("字典分类已删除");
      } catch {
        /* store 已提示失败原因；吞掉拒绝避免 unhandled rejection */
      }
    },
  });
}
</script>

<template>
  <aside class="dict-list">
    <div class="list-head">
      <span class="list-title">
        <BookText :size="14" />
        数据字典
      </span>
      <div class="head-actions">
        <a-tooltip title="新增字典分类">
          <a-button size="small" @click="newCategory">
            <template #icon><FolderPlus :size="12" /></template>
          </a-button>
        </a-tooltip>
        <a-button size="small" type="primary" @click="emit('new')">
          <template #icon><Plus :size="12" /></template>
          新增
        </a-button>
      </div>
    </div>
    <div class="list-search">
      <Search :size="13" class="search-icon" />
      <input
        v-model="keyword"
        type="text"
        placeholder="搜索键/标签/注释/值..."
        spellcheck="false"
      />
    </div>
    <div class="list-body">
      <template v-for="group in dictStore.grouped" :key="group.category?.id || '__uncat'">
        <div class="cat-head">
          <button
            class="cat-toggle"
            type="button"
            :title="collapsedCats.has(group.category?.id || '__uncat') ? '展开' : '折叠'"
            @click="toggleCat(group.category?.id || '__uncat')"
          >
            <ChevronRight v-if="collapsedCats.has(group.category?.id || '__uncat')" :size="12" />
            <ChevronDown v-else :size="12" />
          </button>
          <span
            class="cat-name"
            :title="group.category ? catFileHint(group.category) : '未分类字典不参与字典代码生成'"
          >
            {{ group.category?.name || "未分类" }}
          </span>
          <span class="cat-count">{{ group.dicts.length }}</span>
          <template v-if="group.category">
            <button
              class="cat-btn"
              type="button"
              title="编辑分类（名称 / 基础包路径 / 类名称）"
              @click="editCategory(group.category)"
            >
              <Pencil :size="11" />
            </button>
            <button
              class="cat-btn"
              type="button"
              title="删除分类（分类下仍有字典时不可删除）"
              @click="removeCategory(group.category)"
            >
              <Trash2 :size="11" />
            </button>
          </template>
        </div>
        <template v-if="!collapsedCats.has(group.category?.id || '__uncat')">
          <div
            v-for="d in group.dicts"
            :key="d.id"
            class="dict-item"
            :class="{ selected: props.selectedId === d.id }"
            @click="emit('select', d.id)"
          >
            <div class="item-key mono" v-html="hl(d.dictKey)" />
            <div class="item-label">
              <span class="item-label-text" v-html="hl(d.label)" />
              <span class="item-count">{{ d.values.length }} 值</span>
            </div>
            <div v-if="d.comment" class="item-comment" v-html="hl(d.comment)" />
          </div>
        </template>
      </template>
      <div v-if="!dictStore.filteredDicts.length" class="list-empty">
        {{ keyword ? "无匹配字典" : "暂无字典，点击右上角新增" }}
      </div>
    </div>
    <div class="list-foot">
      {{ dictStore.categories.length }} 个分类 · {{ dictStore.dicts.length }} 个字典
    </div>

    <!-- 字典分类编辑（新增 / 编辑；属性：分类名称、基础包路径、类名称——大驼峰，
      字典代码生成的包名/类名依据） -->
    <a-modal
      v-model:open="catModal.open"
      :title="catDraft.id ? '编辑字典分类' : '新增字典分类'"
      width="min(460px, 94vw)"
      wrap-class-name="dbm-modal-wrap"
      :mask-closable="false"
      @cancel="catModal.open = false"
    >
      <template #footer>
        <a-button @click="catModal.open = false">取消</a-button>
        <a-button type="primary" :loading="catModal.saving" @click="saveCategory">
          保存分类
        </a-button>
      </template>
      <div class="cat-form">
        <div class="cat-form-item">
          <label>分类名称<span class="req">*</span></label>
          <a-input v-model:value="catDraft.name" size="small" placeholder="如 系统字典" />
        </div>
        <div class="cat-form-item">
          <label>基础包路径（basePackage）</label>
          <a-input
            v-model:value="catDraft.basePackage"
            size="small"
            class="mono"
            placeholder="如 com.example.constants.dict"
          />
          <p class="cat-form-tip">字典常量类的 Java 包名与产物目录依据（留空则产物不带目录）</p>
        </div>
        <div class="cat-form-item">
          <label>类名称（className）</label>
          <a-input
            v-model:value="catDraft.className"
            size="small"
            class="mono"
            placeholder="如 SysDictConstants"
            @blur="normalizeClassNameDraft"
          />
          <p class="cat-form-tip">
            必须为大驼峰结构；输入小驼峰/下划线风格将在失焦时自动转换（如 sys_dict → SysDict）
          </p>
        </div>
      </div>
    </a-modal>
  </aside>
</template>

<style lang="scss" scoped>
.dict-list {
  width: 288px;
  min-width: 288px;
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

    .head-actions {
      display: flex;
      align-items: center;
      gap: 6px;
    }
  }

  .list-search {
    position: relative;
    margin: 0 12px 8px;

    .search-icon {
      position: absolute;
      left: 8px;
      top: 50%;
      transform: translateY(-50%);
      color: var(--dbm-text-3);
    }

    input {
      width: 100%;
      height: 28px;
      border: 1px solid var(--dbm-border);
      border-radius: var(--dbm-radius-m);
      background: var(--dbm-bg-2);
      color: var(--dbm-text-1);
      padding: 0 8px 0 28px;
      font-size: 12px;
      outline: none;

      &:focus {
        border-color: var(--dbm-primary);
      }
    }
  }

  .list-body {
    flex: 1;
    overflow-y: auto;
    padding: 0 8px 8px;
  }

  .list-foot {
    padding: 7px 12px;
    border-top: 1px solid var(--dbm-border);
    font-size: 10.5px;
    color: var(--dbm-text-3);
    font-family: var(--dbm-font-mono);
  }
}

.cat-head {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 6px 6px 4px;
  margin-bottom: 2px;
  user-select: none;

  .cat-toggle {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    border: none;
    border-radius: 4px;
    background: transparent;
    color: var(--dbm-text-3);
    cursor: pointer;

    &:hover {
      background: var(--dbm-bg-hover);
      color: var(--dbm-text-2);
    }
  }

  .cat-name {
    font-size: 11.5px;
    font-weight: 600;
    color: var(--dbm-text-2);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .cat-count {
    font-size: 10px;
    color: var(--dbm-text-3);
    font-family: var(--dbm-font-mono);
  }

  .cat-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    border: none;
    border-radius: 4px;
    background: transparent;
    color: var(--dbm-text-3);
    cursor: pointer;
    opacity: 0;
    transition: opacity 0.12s ease;

    &:hover {
      background: var(--dbm-bg-hover);
      color: var(--dbm-text-1);
    }
  }

  &:hover .cat-btn {
    opacity: 1;
  }
}

.dict-item {
  padding: 7px 10px;
  border-radius: var(--dbm-radius-m);
  cursor: pointer;
  margin-bottom: 2px;
  border: 1px solid transparent;

  &:hover {
    background: var(--dbm-bg-hover);
  }

  &.selected {
    background: var(--dbm-primary-weak);
    border-color: color-mix(in srgb, var(--dbm-primary) 35%, transparent);
  }

  .item-key {
    font-size: 12.5px;
    font-weight: 600;
    color: var(--dbm-text-1);
  }

  .item-label {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 1px;

    .item-label-text {
      font-size: 11.5px;
      color: var(--dbm-text-2);
    }

    .item-count {
      margin-left: auto;
      font-size: 10px;
      color: var(--dbm-text-3);
      font-family: var(--dbm-font-mono);
    }
  }

  .item-comment {
    margin-top: 1px;
    font-size: 10.5px;
    color: var(--dbm-text-3);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}

.list-empty {
  padding: 30px 10px;
  text-align: center;
  color: var(--dbm-text-3);
  font-size: 12px;
}

/* ===== 字典分类编辑弹窗表单 ===== */
.cat-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding-top: 4px;

  .cat-form-item {
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

    .cat-form-tip {
      margin: 0;
      font-size: 10.5px;
      color: var(--dbm-text-3);
      line-height: 1.6;
    }
  }
}

/* 移动端：列表置顶限高 */
@media (max-width: 768px) {
  .dict-list {
    width: 100%;
    min-width: 0;
    max-height: 32vh;
    border-right: none;
    border-bottom: 1px solid var(--dbm-border);
  }
}
</style>
