import { fileURLToPath, URL } from 'node:url'
import { defineConfig, lazyPlugins } from 'vite-plus'
import vue from '@vitejs/plugin-vue'

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
      'snapshot/**',
      'patch/**',
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
  plugins: lazyPlugins(() => [vue()]),
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
    chunkSizeWarningLimit: 1500,
  },
})
