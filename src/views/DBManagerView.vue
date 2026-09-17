<script setup lang="ts">
/**
 * DBManagerView：数据库模型管理页面封装（库导出入口组件）
 *
 * - 属性 api?: ManagerApi —— 注入自定义数据能力实现；缺省使用内置
 *   DemoManagerApi（内存 + localStorage 演示实现）
 * - 属性 aiApi?: AIApi —— 注入自定义 AI 能力实现（AI 设置 / 三协议对话 /
 *   fetch）；缺省使用内置 DemoAIApi
 * - 通过 provide/inject 向子组件分发 ManagerApi（useManagerApi()）、AIApi
 *   （useAIApi()）与整套全局状态（createDBManagerState：theme/ui/model/
 *   canvas/dict/template/settings/history/ai，子组件经各 useXxxStore() 取用）
 *   ——状态为组件实例级，不依赖 Pinia 等应用级全局单例
 * - 页面切换仍使用 v-if（不使用 vue-router）
 * - 全局样式（CSS 变量/基础样式/高亮主题）随组件包内引入，
 *   宿主项目无需额外导入即可获得与演示一致的外观
 */
import { computed, provide, watch } from "vue";
import { theme as antdTheme } from "antdv-next";
import type { AIApi } from "@/types/ai";
import type { ManagerApi } from "@/types/manager";
import "@/styles/index.scss";
import { MANAGER_API_KEY, sharedDemoApi } from "@/api/manager-api";
import { AI_API_KEY, sharedDemoAIApi } from "@/api/ai-api";
import { createDBManagerState, DBMANAGER_STATE_KEY } from "@/stores/context";
import AppHeader from "@/components/layout/AppHeader.vue";
import EditorView from "@/views/EditorView.vue";
import DictView from "@/views/DictView.vue";
import TemplateView from "@/views/TemplateView.vue";
import SettingsView from "@/views/SettingsView.vue";
import AiView from "@/views/AiView.vue";

const props = defineProps<{ api?: ManagerApi; aiApi?: AIApi }>();

/** 当前生效的 api（响应式：随 prop 切换更新，缺省共享 demo 单例） */
const apiRef = computed<ManagerApi>(() => props.api ?? sharedDemoApi);
provide(MANAGER_API_KEY, apiRef);

/** 当前生效的 AIApi（响应式：随 prop 切换更新，缺省共享 demo AI 单例） */
const aiApiRef = computed<AIApi>(() => props.aiApi ?? sharedDemoAIApi);
provide(AI_API_KEY, aiApiRef);

// 创建整套全局状态并注入子树（每实例一套；api / AIApi 惰性读取，prop 切换后自动走新实例）
const state = createDBManagerState(
  () => apiRef.value,
  () => aiApiRef.value,
);
provide(DBMANAGER_STATE_KEY, state);

// 应用主题（setup 同步执行，早于子树首次渲染，避免闪烁；原先由 main.ts 预挂载初始化）
state.theme.init();

const antdThemeConfig = computed(() => ({
  algorithm: state.theme.isDark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
  // 启用 antd CSS 变量模式：antd 令牌以 --ant-* 变量挂载到 css-var-* 类元素上，
  // antd-theme.scss 据此把 --dbm-* 设计令牌映射为 antd 令牌，实现主题联动
  cssVar: true,
}));

// api 切换时全量重载各仓库数据（不重置 UI 页面）；隐藏态随模型数据（Table.hidden）恢复
watch([apiRef, aiApiRef], ([api, ai], [oldApi, oldAi]) => {
  if ((oldApi && api !== oldApi) || (oldAi && ai !== oldAi)) {
    const stores = [state.model, state.dict, state.template, state.settings] as Array<{
      loaded: boolean;
      loading: boolean;
      init: () => Promise<void>;
    }>;
    for (const s of stores) {
      s.loaded = false;
      s.loading = false;
    }
    state.ai.resetForApiSwitch();
    state.ai.resetForApiSwitch();
    state.history.clear();
    state.canvas.setSelection([]);
    initPage(state.ui.page);
  }
});

// 页面切换使用 v-if（不使用 vue-router），进入页面时按需加载数据
watch(
  () => state.ui.page,
  (page) => initPage(page),
  { immediate: true },
);

/** api 切换 / 首挂时的初始化（init 全套仓库） */
function initPage(page: string) {
  // 设置（索引类型列表 + 列类型映射）是编辑器/导入能力共用的全局配置：
  // 视图启动即预载（init 幂等）。此前仅惰性触发（打开表编辑/导入对话框、
  // 进入设置页时才调 getSettings），应用启动阶段契约方法从未被调用。
  state.settings.init();
  if (page === "editor") state.model.init();
  else if (page === "dict") state.dict.init();
  else if (page === "template") state.template.init();
  // AI 设置供 AI 工具页与设置页 AI 区块共用（幂等预载）
  else if (page === "ai" || page === "settings") state.ai.init();
}
</script>

<template>
  <a-config-provider :theme="antdThemeConfig">
    <a-app class="app-provider">
      <div class="app-shell">
        <AppHeader />
        <main class="app-main">
          <EditorView v-if="state.ui.page === 'editor'" />
          <DictView v-else-if="state.ui.page === 'dict'" />
          <TemplateView v-else-if="state.ui.page === 'template'" />
          <AiView v-else-if="state.ui.page === 'ai'" />
          <SettingsView v-else-if="state.ui.page === 'settings'" />
        </main>
      </div>
    </a-app>
  </a-config-provider>
</template>

<style lang="scss">
.app-provider {
  height: 100%;
}
</style>
