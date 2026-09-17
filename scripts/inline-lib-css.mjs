#!/usr/bin/env node
/**
 * 库构建后处理（vp build 之后自动执行）：
 * 1. 把 dist/index.css 内联进 dist/DBManager.js（替换 import './index.css'
 *    为运行时 <style> 注入代码）——rolldown 底座下 vite-plugin-lib-inject-css
 *    不生效，故由本脚本完成等效内联，保证最终仅产出两个文件
 * 2. dist 产物白名单清理：仅保留 DBManager.js / DBManager.d.ts，
 *    其余（favicon、散落 d.ts、index.css 等）全部移除
 */
import { readFileSync, writeFileSync, readdirSync, rmSync, existsSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const distDir = join(dirname(fileURLToPath(import.meta.url)), "..", "dist");
const jsPath = join(distDir, "DBManager.js");
const cssPath = join(distDir, "index.css");
const KEEP = new Set(["DBManager.js", "DBManager.d.ts"]);

if (!existsSync(jsPath)) {
  console.error("[inline-lib-css] dist/DBManager.js 不存在，请先执行 vp build");
  process.exit(1);
}

let js = readFileSync(jsPath, "utf8");

if (existsSync(cssPath)) {
  const css = readFileSync(cssPath, "utf8").trim();
  const cssImport = `import './index.css';`;
  const injection = `;(function(){var css=${JSON.stringify(css)};if(typeof document!=='undefined'){var s=document.createElement('style');s.setAttribute('data-dbmanager','');s.appendChild(document.createTextNode(css));(document.head||document.documentElement).appendChild(s);}})();`;
  if (!js.includes(cssImport)) {
    console.warn("[inline-lib-css] 未在 DBManager.js 中找到 \"import './index.css';\"，跳过内联");
  } else {
    js = js.replace(cssImport, injection);
    writeFileSync(jsPath, js);
    rmSync(cssPath);
    console.log(`[inline-lib-css] 已内联 CSS（${css.length} 字符）并移除 index.css`);
  }
}

// 白名单清理：递归删除 dist 中除两个交付文件之外的所有内容
function sweep(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      rmSync(full, { recursive: true, force: true });
      continue;
    }
    if (!KEEP.has(name)) rmSync(full, { force: true });
  }
}
sweep(distDir);

const rest = readdirSync(distDir).sort();
console.log(`[inline-lib-css] dist 最终产物: ${rest.join(", ")}`);
if (rest.some((n) => !KEEP.has(n))) {
  console.error("[inline-lib-css] 存在白名单之外的产物文件，请检查");
  process.exit(1);
}
