import { fileURLToPath, URL } from "node:url";
import { defineConfig, lazyPlugins } from "vite-plus";
import vue from "@vitejs/plugin-vue";

// GitHub Pages 演示应用构建配置（区别于库模式 npm run build）：
// 产物为完整 SPA（index.html + assets + favicon），base 采用相对路径 './'，
// 使资源引用随 index.html 所在路径解析，兼容 GitHub Pages 项目页子路径托管。
// 使用方式：bun run build:pages（GitHub Actions 工作流 .github/workflows/deploy-pages.yml）
export default defineConfig({
  base: "./",
  plugins: lazyPlugins(() => [vue()]),
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  build: {
    outDir: "dist",
    chunkSizeWarningLimit: 1500,
  },
});
