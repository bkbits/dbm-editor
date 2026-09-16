import { fileURLToPath, URL } from 'node:url'
import { defineConfig, lazyPlugins } from 'vite-plus'
import vue from '@vitejs/plugin-vue'
import dts from 'vite-plugin-dts'
import { libInjectCss } from 'vite-plugin-lib-inject-css'

// 库模式外部依赖：宿主项目通过自身依赖提供（vue / antdv-next / @lucide/vue）
const EXTERNAL_RE = /^(vue|antdv-next|@lucide\/vue)(\/|$)/

// https://vite.dev/config/
export default defineConfig({
  staged: {
    '*': 'vp check --fix',
  },
  // 代码风格与项目既有约定一致：单引号、无分号
  fmt: {
    singleQuote: true,
    semi: false,
    ignorePatterns: [
      'dist/**',
      'tool-results/**',
      'skills/**',
      'docs/**',
      'download/**',
      'upload/**',
      'worklog.md',
      'AGENTS.md',
    ],
  },
  lint: {
    // 受限环境下 vite-plus 的 jsPlugins 装载会触发 oxc 分配器 panic，
    // 故不挂载 vite-plus/oxlint-plugin，退回纯 oxlint 规则；
    // 类型检查由 vue-tsc 承担（bun run typecheck）
    options: { typeAware: false, typeCheck: false },
  },
  plugins: lazyPlugins(() => [
    vue(),
    // 库模式：把构建产物中的 CSS 内联进 JS（运行时注入 <style>），
    // 最终仅产出 DBManager.js 一个样式自包含文件
    libInjectCss(),
    // 类型声明：由入口 src/index.ts 滚动生成单一 dist/DBManager.d.ts
    dts({
      entryRoot: 'src',
      outDirs: ['dist'],
      // 滚动合并为单一声明文件（dist/DBManager.d.ts，名称取 package.json types 字段）
      bundleTypes: true,
    }),
  ]),
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  // 限定依赖扫描入口，避免把 skills/ 等非源码目录中的 html 参考文件卷入预打包
  optimizeDeps: {
    entries: ['index.html'],
  },
  server: {
    port: 3000,
    host: '0.0.0.0',
    allowedHosts: true,
    // E2E 专用（AI_MOCK_PROXY=1 时生效）：把 openai compatible 模拟服务挂到同源路径，
    // 规避浏览器跨域/跨命名空间限制；正常开发不设置该环境变量，不产生任何影响
    ...(process.env.AI_MOCK_PROXY
      ? {
          proxy: {
            '/__ai-mock': {
              target: 'http://localhost:4833',
              rewrite: (path) => path.replace(/^\/__ai-mock/, ''),
            },
          },
        }
      : {}),
  },
  build: {
    // 库模式：入口仅导出 DBManagerView 组件 + ManagerApi 契约类型，
    // 产物为 dist/DBManager.js（ES 单文件）与 dist/DBManager.d.ts
    lib: {
      entry: fileURLToPath(new URL('./src/index.ts', import.meta.url)),
      name: 'DBManager',
      formats: ['es'],
      fileName: () => 'DBManager.js',
    },
    rollupOptions: {
      external: (id: string) => EXTERNAL_RE.test(id),
      // 动态 import 一并内联进单文件产物：markstream-vue 的可选能力
      // （katex / mermaid / mhchem / d2）经 defineAsyncComponent 懒加载，
      // 不内联会被拆成额外 chunk，与「仅 DBManager.js + .d.ts 两个交付文件」
      // 的库契约冲突（白名单清理会误删被引用 chunk 导致产物损坏）
      output: {
        inlineDynamicImports: true,
      },
    },
    chunkSizeWarningLimit: 1500,
    // 库产物不拷贝 public 目录（favicon 等属于演示应用资源）
    copyPublicDir: false,
  },
})
