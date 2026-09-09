<script setup lang="ts">
import { Database, BookText, FileCode, Sun, Moon, Settings } from '@lucide/vue'
import { useThemeStore } from '@/stores/theme'
import { useUiStore, type PageName } from '@/stores/ui'

const themeStore = useThemeStore()
const ui = useUiStore()

const pages: Array<{ key: PageName; label: string; icon: unknown }> = [
  { key: 'editor', label: '模型编辑器', icon: Database },
  { key: 'dict', label: '字典管理', icon: BookText },
  { key: 'template', label: '模板管理', icon: FileCode },
  { key: 'settings', label: '系统设置', icon: Settings },
]

function switchPage(key: PageName) {
  ui.setPage(key)
}
</script>

<template>
  <header class="app-header">
    <div class="brand">
      <span class="brand-icon"><Database :size="18" :stroke-width="2" /></span>
      <span class="brand-title">图形数据库模型编辑工具</span>
      <span class="brand-sub">Graph DB Model Editor</span>
    </div>

    <nav class="page-nav">
      <button
        v-for="p in pages"
        :key="p.key"
        class="nav-btn"
        :class="{ active: ui.page === p.key }"
        type="button"
        @click="switchPage(p.key)"
      >
        <component :is="p.icon" :size="14" :stroke-width="2" />
        <span>{{ p.label }}</span>
      </button>
    </nav>

    <div class="header-right">
      <button
        class="icon-btn"
        type="button"
        :title="themeStore.isDark ? '切换为亮色主题' : '切换为暗色主题'"
        @click="themeStore.toggle()"
      >
        <Sun v-if="themeStore.isDark" :size="16" />
        <Moon v-else :size="16" />
      </button>
    </div>
  </header>
</template>

<style lang="scss" scoped>
.app-header {
  display: flex;
  align-items: center;
  gap: 16px;
  height: var(--header-height);
  padding: 0 var(--space-4);
  background: var(--bg-panel);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
  z-index: 20;
}

.brand {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;

  .brand-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border-radius: var(--radius-m);
    background: var(--primary-weak);
    color: var(--primary);
    flex-shrink: 0;
  }

  .brand-title {
    font-weight: 600;
    font-size: 14px;
    color: var(--text-1);
    white-space: nowrap;
  }

  .brand-sub {
    font-size: 11px;
    color: var(--text-3);
    white-space: nowrap;
    letter-spacing: 0.4px;
  }
}

.page-nav {
  display: flex;
  gap: 4px;
  margin-left: auto;
  padding: 3px;
  background: var(--bg-2);
  border-radius: var(--radius-m);

  .nav-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    border: none;
    background: transparent;
    color: var(--text-2);
    font-size: 13px;
    padding: 5px 12px;
    border-radius: 6px;
    cursor: pointer;
    transition: all 0.15s ease;
    white-space: nowrap;

    &:hover {
      color: var(--text-1);
      background: var(--bg-hover);
    }

    &.active {
      background: var(--bg-panel);
      color: var(--primary-text);
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);
    }
  }
}

.header-right {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: 8px;
}

.icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border: 1px solid var(--border);
  border-radius: var(--radius-m);
  background: var(--bg-panel);
  color: var(--text-2);
  cursor: pointer;
  transition: all 0.15s ease;

  &:hover {
    color: var(--primary-text);
    border-color: var(--primary);
    background: var(--primary-weak);
  }
}
</style>
