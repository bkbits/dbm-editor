/**
 * 主题仓库：亮色/暗色切换，切换时同步根元素 data-theme，CSS 变量自动切换
 * （reactive 对象工厂形态，由 DBManagerView 经上下文注入，不依赖 Pinia）
 */
import { reactive } from "vue";
import { useDBManagerContext } from "./context";

export type ThemeMode = "light" | "dark";

const THEME_KEY = "gdbme:theme";

/** 读取上次主题（localStorage 无记录或值非法时回退 light；不写回） */
function loadTheme(): ThemeMode {
  const saved = localStorage.getItem(THEME_KEY);
  return saved === "dark" || saved === "light" ? saved : "light";
}

/** 应用主题到根元素：data-theme 驱动 CSS 变量切换，color-scheme 兼顾原生控件与滚动条 */
function applyTheme(mode: ThemeMode) {
  const root = document.documentElement;
  root.dataset.theme = mode;
  root.style.colorScheme = mode;
}

/**
 * 创建主题仓库（reactive 对象工厂，不依赖 Pinia；由 createDBManagerState 注入组件树）
 * theme 字段为唯一来源，根元素 data-theme 由 applyTheme 派生同步，仓库不持有 DOM 引用。
 */
export function createThemeStore() {
  return reactive({
    theme: loadTheme(),

    /** 是否暗色（供 antd 算法、画布绘制、Markdown 渲染等无法用 CSS 变量分流之处） */
    get isDark(): boolean {
      return this.theme === "dark";
    },

    /** DBManagerView 挂载时调用（首次渲染前应用，避免闪烁） */
    init() {
      applyTheme(this.theme);
    },

    /** 切换主题：更新字段 + 同步根元素 + 写入 localStorage（刷新后由 loadTheme 读回） */
    setTheme(mode: ThemeMode) {
      this.theme = mode;
      applyTheme(mode);
      localStorage.setItem(THEME_KEY, mode);
    },

    /** 亮暗互换（复用 setTheme，故同样同步根元素并落盘） */
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
