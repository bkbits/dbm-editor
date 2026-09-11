<script setup lang="ts">
/**
 * DBManagerView：数据库模型管理页面封装
 *
 * - 属性 api?: ManagerApi —— 注入自定义数据能力实现；缺省使用内置
 *   DemoManagerApi（内存 + localStorage 演示实现）
 * - 通过 provide/inject 向子组件分发（子组件 useManagerApi()），
 *   并写入全局激活实例（setActiveApi）供 Pinia store 经 getManagerApi() 读取
 * - 页面切换仍使用 v-if（不使用 vue-router）
 */
import { computed, provide, watch } from 'vue'
import { theme as antdTheme } from 'antdv-next'
import type { ManagerApi } from '@/types/model'
import { MANAGER_API_KEY, setActiveApi, sharedDemoApi } from '@/api/manager-api'
import { useThemeStore } from '@/stores/theme'
import { useUiStore } from '@/stores/ui'
import { useModelStore } from '@/stores/model'
import { useDictStore } from '@/stores/dict'
import { useTemplateStore } from '@/stores/template'
import { useSettingsStore } from '@/stores/settings'
import { useHistoryStore } from '@/stores/history'
import { useCanvasStore } from '@/stores/canvas'
import AppHeader from '@/components/layout/AppHeader.vue'
import EditorView from '@/views/EditorView.vue'
import DictView from '@/views/DictView.vue'
import TemplateView from '@/views/TemplateView.vue'
import SettingsView from '@/views/SettingsView.vue'

const props = defineProps<{ api?: ManagerApi }>()

const themeStore = useThemeStore()
const ui = useUiStore()
const model = useModelStore()
const dict = useDictStore()
const templateStore = useTemplateStore()
const settingsStore = useSettingsStore()

const antdThemeConfig = computed(() => ({
  algorithm: themeStore.isDark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
}))

/** 当前生效的 api（响应式：随 prop 切换更新，缺省共享 demo 单例） */
const apiRef = computed<ManagerApi>(() => props.api ?? sharedDemoApi)
provide(MANAGER_API_KEY, apiRef)

// 同步全局激活实例（store 侧 getManagerApi 读取）；首个 api 生效时无需重载（页面 watch 会完成初始加载）
watch(
  apiRef,
  (api) => {
    setActiveApi(api)
  },
  { immediate: true },
)

// api 切换时全量重载各仓库数据（不重置 UI 页面）；隐藏态随模型数据（Table.hidden）恢复
watch(apiRef, (api, old) => {
  if (old && api !== old) {
    const stores = [model, dict, templateStore, settingsStore] as Array<{
      loaded: boolean
      loading: boolean
      init: () => Promise<void>
    }>
    for (const s of stores) {
      s.loaded = false
      s.loading = false
    }
    useHistoryStore().clear()
    const canvas = useCanvasStore()
    canvas.setSelection([])
    initPage(ui.page)
  }
})

// 页面切换使用 v-if（不使用 vue-router），进入页面时按需加载数据
watch(
  () => ui.page,
  (page) => initPage(page),
  { immediate: true },
)

function initPage(page: string) {
  if (page === 'editor') model.init()
  else if (page === 'dict') dict.init()
  else if (page === 'template') templateStore.init()
  else if (page === 'settings') settingsStore.init()
}
</script>

<template>
  <a-config-provider :theme="antdThemeConfig">
    <a-app class="app-provider">
      <div class="app-shell">
        <AppHeader />
        <main class="app-main">
          <EditorView v-if="ui.page === 'editor'" />
          <DictView v-else-if="ui.page === 'dict'" />
          <TemplateView v-else-if="ui.page === 'template'" />
          <SettingsView v-else-if="ui.page === 'settings'" />
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
