<script setup lang="ts">
import { computed, watch } from 'vue'
import { theme as antdTheme } from 'antdv-next'
import { useThemeStore } from '@/stores/theme'
import { useUiStore } from '@/stores/ui'
import { useModelStore } from '@/stores/model'
import { useDictStore } from '@/stores/dict'
import { useTemplateStore } from '@/stores/template'
import AppHeader from '@/components/layout/AppHeader.vue'
import EditorView from '@/views/EditorView.vue'
import DictView from '@/views/DictView.vue'
import TemplateView from '@/views/TemplateView.vue'

const themeStore = useThemeStore()
const ui = useUiStore()
const model = useModelStore()
const dict = useDictStore()
const templateStore = useTemplateStore()

const antdThemeConfig = computed(() => ({
  algorithm: themeStore.isDark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
}))

// 页面切换使用 v-if（不使用 vue-router），进入页面时按需加载数据
watch(
  () => ui.page,
  (page) => {
    if (page === 'editor') model.init()
    else if (page === 'dict') dict.init()
    else if (page === 'template') templateStore.init()
  },
  { immediate: true },
)
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
