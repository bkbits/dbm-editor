/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<object, object, unknown>
  export default component
}

/** highlights-eta 插件：ESM 源码入口（dist 版为依赖全局 hljs 的浏览器脚本，故深路径导入源码） */
declare module 'highlightjs-eta/src/languages/eta.js' {
  import type { LanguageFn } from 'highlight.js'
  const eta: LanguageFn
  export default eta
}
