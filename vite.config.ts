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
    },
    chunkSizeWarningLimit: 1500,
    // 库产物不拷贝 public 目录（favicon 等属于演示应用资源）
    copyPublicDir: false,
  },
})
