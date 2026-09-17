/**
 * 主题仓库：亮色/暗色切换，切换时同步根元素 data-theme，CSS 变量自动切换
 * （reactive 对象工厂形态，由 DBManagerView 经上下文注入，不依赖 Pinia）
 */
import { reactive } from "vue";
import { useDBManagerContext } from "./context";

export type ThemeMode = "light" | "dark";

const THEME_KEY = "gdbme:theme";

function loadTheme(): ThemeMode {
  const saved = localStorage.getItem(THEME_KEY);
  return saved === "dark" || saved === "light" ? saved : "light";
}

function applyTheme(mode: ThemeMode) {
  const root = document.documentElement;
  root.dataset.theme = mode;
  root.style.colorScheme = mode;
}

export function createThemeStore() {
  return reactive({
    theme: loadTheme(),

    get isDark(): boolean {
      return this.theme === "dark";
    },

    /** DBManagerView 挂载时调用（首次渲染前应用，避免闪烁） */
    init() {
      applyTheme(this.theme);
    },

    setTheme(mode: ThemeMode) {
      this.theme = mode;
      applyTheme(mode);
      localStorage.setItem(THEME_KEY, mode);
    },

    toggle() {
      this.setTheme(this.theme === "dark" ? "light" : "dark");
    },
  });
}

export type ThemeStore = ReturnType<typeof createThemeStore>;

/** 子组件取用主题仓库（须处于 DBManagerView 组件树内） */
export function useThemeStore(): ThemeStore {
  return useDBManagerContext().theme;
}
