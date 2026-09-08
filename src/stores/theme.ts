/**
 * 主题仓库：亮色/暗色切换，切换时同步根元素 data-theme，CSS 变量自动切换
 */
import { defineStore } from 'pinia'

export type ThemeMode = 'light' | 'dark'

const THEME_KEY = 'gdbme:theme'

function loadTheme(): ThemeMode {
  const saved = localStorage.getItem(THEME_KEY)
  return saved === 'dark' || saved === 'light' ? saved : 'light'
}

function applyTheme(mode: ThemeMode) {
  const root = document.documentElement
  root.dataset.theme = mode
  root.style.colorScheme = mode
}

export const useThemeStore = defineStore('theme', {
  state: () => ({
    theme: loadTheme(),
  }),
  getters: {
    isDark: (state): boolean => state.theme === 'dark',
  },
  actions: {
    /** 应用启动时调用 */
    init() {
      applyTheme(this.theme)
    },
    setTheme(mode: ThemeMode) {
      this.theme = mode
      applyTheme(mode)
      localStorage.setItem(THEME_KEY, mode)
    },
    toggle() {
      this.setTheme(this.theme === 'dark' ? 'light' : 'dark')
    },
  },
})
