<script setup lang="ts">
/**
 * 系统设置页（页面级编排）
 *
 * 由原 1697 行单文件拆分为本文件 + src/views/settings/ 分区组件（行为等价拆分）：
 * - TypeMappingSection：列默认类型（映射规则 + 实时测试）
 * - IndexTypesSection：索引类型
 * - FieldConventionsSection：主键 / 审计 / 逻辑删除字段约定
 * - CodegenSection：代码生成（作者 + 表/列选项定义）
 * - AiSettingsSection（components/settings/）：AI 设置（服务地址 / 模型 /
 *   全局规则等，既有契约组件）
 *
 * 各分区经 defineExpose 暴露统一契约（dirty / tip / warning / collect /
 * resetDraft）；本文件负责：分区导航（点击平滑滚动 + 滚动高亮）、底部统一
 * 保存条（聚合各分区 dirty 与校验，按分区顺序提示首个错误）与保存/放弃编排。
 */
import { computed, reactive, ref } from "vue";
import { message } from "antdv-next";
import {
  Bot,
  Code2,
  KeyRound,
  Layers,
  Settings as SettingsIcon,
  SlidersHorizontal,
} from "@lucide/vue";
import type { Settings } from "@/types/model";
import { useSettingsStore } from "@/stores/settings";
import { errorMessageOf } from "@/api/manager-api";
import AiSettingsSection from "@/components/settings/AiSettingsSection.vue";
import TypeMappingSection from "./settings/TypeMappingSection.vue";
import IndexTypesSection from "./settings/IndexTypesSection.vue";
import FieldConventionsSection from "./settings/FieldConventionsSection.vue";
import CodegenSection from "./settings/CodegenSection.vue";

const settingsStore = useSettingsStore();

/* ==================== 分区实例引用（统一契约：dirty/tip/warning/collect/resetDraft） ==================== */

const typeMappingRef = ref<InstanceType<typeof TypeMappingSection> | null>(null);
const indexTypesRef = ref<InstanceType<typeof IndexTypesSection> | null>(null);
const fieldConventionsRef = ref<InstanceType<typeof FieldConventionsSection> | null>(null);
const codegenRef = ref<InstanceType<typeof CodegenSection> | null>(null);
/** AI 区块（既有契约组件，经 defineExpose 暴露 dirty / invalid / save / resetDraft） */
const aiSection = ref<InstanceType<typeof AiSettingsSection> | null>(null);

const saving = reactive({ loading: false });

/** 草稿是否变化（任一分区变化即为脏；AI 分区经其 dirty 计算属性聚合） */
const dirty = computed(
  () =>
    Boolean(typeMappingRef.value?.dirty) ||
    Boolean(indexTypesRef.value?.dirty) ||
    Boolean(fieldConventionsRef.value?.dirty) ||
    Boolean(codegenRef.value?.dirty) ||
    Boolean(aiSection.value?.dirty),
);

/** 首个校验提示（按分区顺序：列默认类型 → 索引类型 → 代码生成 → 字段约定 → AI） */
const firstInvalid = computed(() => {
  const tips = [
    typeMappingRef.value?.tip ?? null,
    indexTypesRef.value?.tip ?? null,
    codegenRef.value?.tip ?? null,
    fieldConventionsRef.value?.tip ?? null,
    aiSection.value?.invalid ? `AI 设置无效：${aiSection.value.invalid}` : null,
  ];
  return tips.find((t) => t) ?? null;
});

/** 底部保存条提示文案：首个校验错误 → 脏标记 → 全部已保存 */
const footTip = computed(
  () => firstInvalid.value ?? (dirty.value ? "有未保存的修改" : "全部更改已保存"),
);

/** 保存是否被校验拦截（任一分区无效即禁用） */
const blocked = computed(() => firstInvalid.value != null);

/** 放弃修改：各分区从 store 重建草稿 */
function resetDraft() {
  typeMappingRef.value?.resetDraft();
  indexTypesRef.value?.resetDraft();
  fieldConventionsRef.value?.resetDraft();
  codegenRef.value?.resetDraft();
  aiSection.value?.resetDraft();
}

/** 保存设置：先按分区顺序校验（首个无效分区弹警告中断），再聚合载荷统一提交 */
async function save() {
  const warnings = [
    typeMappingRef.value?.warning ?? null,
    indexTypesRef.value?.warning ?? null,
    codegenRef.value?.warning ?? null,
    fieldConventionsRef.value?.warning ?? null,
    aiSection.value?.invalid ? `AI 设置无效：${aiSection.value.invalid}` : null,
  ];
  const first = warnings.find((w) => w);
  if (first) {
    message.warning(first);
    return;
  }
  saving.loading = true;
  try {
    // 聚合非 AI 分区载荷（与拆分前一次性提交的六字段完全一致；保存按钮
    // 仅在分区组件挂载后可点击，模板引用必然非空）
    const payload: Settings = {
      ...typeMappingRef.value!.collect(),
      ...indexTypesRef.value!.collect(),
      ...codegenRef.value!.collect(),
      ...fieldConventionsRef.value!.collect(),
    };
    await settingsStore.save(payload);
    if (aiSection.value?.dirty) await aiSection.value.save();
    message.success("设置已保存");
  } catch (e: unknown) {
    message.error(errorMessageOf(e, "保存失败"));
  } finally {
    saving.loading = false;
  }
}

/* ==================== 分区导航（点击平滑滚动 + 滚动高亮） ==================== */

const sections = [
  { id: "sec-type-mapping", label: "列默认类型", icon: SlidersHorizontal },
  { id: "sec-index-types", label: "索引类型", icon: Layers },
  { id: "sec-field-conventions", label: "字段约定", icon: KeyRound },
  { id: "sec-codegen", label: "代码生成", icon: Code2 },
  { id: "sec-ai", label: "AI", icon: Bot },
];

const scrollEl = ref<HTMLElement>();
const activeSection = ref(sections[0]!.id);

/** 点击导航项平滑滚动到对应分区 */
function scrollToSection(id: string) {
  activeSection.value = id;
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

/** 滚动监听：当前命中分区高亮（顶部 80px 缓冲带内首个分区） */
function onSettingsScroll() {
  const el = scrollEl.value;
  if (!el) return;
  let current = sections[0]!.id;
  for (const s of sections) {
    const sec = document.getElementById(s.id);
    if (sec && sec.offsetTop <= el.scrollTop + 80) current = s.id;
  }
  activeSection.value = current;
}
</script>

<template>
  <div class="settings-view">
    <div class="settings-body">
      <!-- 分区导航：点击平滑滚动到对应设置项，滚动时自动高亮当前分区 -->
      <nav class="settings-nav">
        <span class="nav-title">设置项</span>
        <button
          v-for="s in sections"
          :key="s.id"
          class="nav-item"
          :class="{ active: activeSection === s.id }"
          type="button"
          @click="scrollToSection(s.id)"
        >
          <component :is="s.icon" :size="13" />
          <span>{{ s.label }}</span>
        </button>
      </nav>

      <div ref="scrollEl" class="settings-scroll" @scroll="onSettingsScroll">
        <div class="settings-inner">
          <header class="page-head">
            <span class="head-icon"><SettingsIcon :size="17" :stroke-width="2" /></span>
            <div class="head-text">
              <h1>系统设置</h1>
              <p>应用偏好配置，保存后立即生效并持久化</p>
            </div>
          </header>

          <TypeMappingSection id="sec-type-mapping" ref="typeMappingRef" />
          <IndexTypesSection id="sec-index-types" ref="indexTypesRef" />
          <FieldConventionsSection id="sec-field-conventions" ref="fieldConventionsRef" />
          <CodegenSection id="sec-codegen" ref="codegenRef" />

          <AiSettingsSection id="sec-ai" ref="aiSection" />
        </div>
      </div>
    </div>

    <!-- 统一保存条：固定页面底部，不随内容滚动 -->
    <div class="settings-foot">
      <div class="foot-inner">
        <span class="dirty-tip" :class="{ dirty }">
          {{ footTip }}
        </span>
        <div class="foot-actions">
          <a-button size="small" :disabled="!dirty" @click="resetDraft">放弃修改</a-button>
          <a-button
            size="small"
            type="primary"
            :loading="saving.loading"
            :disabled="!dirty || blocked"
            @click="save"
          >
            保存设置
          </a-button>
        </div>
      </div>
    </div>
  </div>
</template>

<style lang="scss" scoped>
/* 页面级布局：导航列 + 滚动内容区（上）与固定保存条（下）纵筒式排列，
   保存条不随内容滚动，始终可见 */

.settings-view {
  height: 100%;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.settings-body {
  flex: 1;
  min-height: 0;
  display: flex;
  gap: 18px;
  width: 100%;
  max-width: 1120px;
  margin: 0 auto;
  padding: 18px 20px 0;
  box-sizing: border-box;
}

/* ---------- 分区导航（左列，不随内容滚动） ---------- */
.settings-nav {
  width: 152px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  align-self: flex-start;
  position: sticky;
  top: 0;
  padding-bottom: 18px;

  .nav-title {
    font-size: 11px;
    color: var(--dbm-text-3);
    padding: 0 10px 6px;
  }

  .nav-item {
    display: flex;
    align-items: center;
    gap: 7px;
    border: none;
    background: transparent;
    border-radius: var(--dbm-radius-m);
    padding: 7px 10px;
    font-size: 12.5px;
    color: var(--dbm-text-2);
    cursor: pointer;
    text-align: left;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    transition: all 0.15s ease;

    &:hover {
      color: var(--dbm-text-1);
      background: var(--dbm-bg-hover);
    }

    &.active {
      color: var(--dbm-primary-text);
      background: var(--dbm-primary-weak);
      font-weight: 600;
    }
  }
}

/* ---------- 滚动内容区 ---------- */
.settings-scroll {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  position: relative;
}

.settings-inner {
  max-width: 920px;
  padding: 0 0 30px;
}

.page-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 14px;

  .head-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border-radius: var(--dbm-radius-m);
    background: var(--dbm-primary-weak);
    color: var(--dbm-primary);
    flex-shrink: 0;
  }

  .head-text {
    h1 {
      font-size: 16px;
      font-weight: 600;
      color: var(--dbm-text-1);
      line-height: 1.2;
    }

    p {
      font-size: 11.5px;
      color: var(--dbm-text-3);
      margin-top: 2px;
    }
  }
}

/* ==================== 统一保存条（固定页面底部） ==================== */

.settings-foot {
  flex-shrink: 0;
  border-top: 1px solid var(--dbm-border);
  background: var(--dbm-bg-panel);

  .foot-inner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    max-width: 1120px;
    margin: 0 auto;
    padding: 10px 20px;
    box-sizing: border-box;
  }

  .dirty-tip {
    font-size: 11.5px;
    color: var(--dbm-text-3);
    transition: color 0.15s ease;

    &.dirty {
      color: var(--dbm-warning);
    }
  }

  .foot-actions {
    display: flex;
    gap: 8px;
    flex-shrink: 0;
  }
}

/* ===== 移动端适配：导航改横向滑动条 + 紧凑内边距 ===== */
@media (max-width: 768px) {
  .settings-body {
    flex-direction: column;
    gap: 10px;
    padding: 12px 12px 0;
  }

  .settings-nav {
    width: auto;
    flex-direction: row;
    overflow-x: auto;
    position: static;
    padding-bottom: 0;
    gap: 6px;

    .nav-title {
      display: none;
    }

    .nav-item {
      flex-shrink: 0;
      padding: 5px 10px;
      border: 1px solid var(--dbm-border);
      border-radius: 999px;
      background: var(--dbm-bg-panel);
    }
  }

  .settings-inner {
    padding: 0 0 20px;
  }

  .settings-foot {
    .foot-inner {
      flex-wrap: wrap;
      gap: 6px;
      padding: 8px 12px;
    }

    .foot-actions {
      margin-left: auto;
    }
  }
}
</style>
