<!--VITE PLUS START-->

# Using Vite+, the Unified Toolchain for the Web

This project is using Vite+, a unified toolchain built on top of Vite, Rolldown, Vitest, tsdown, Oxlint, Oxfmt, and Vite Task. Vite+ wraps runtime management, package management, and frontend tooling in a single global CLI called `vp`. Vite+ is distinct from Vite, and it invokes Vite through `vp dev` and `vp build`. Run `vp help` to print a list of commands and `vp <command> --help` for information about a specific command.

Docs are local at `node_modules/vite-plus/docs` or online at https://viteplus.dev/guide/.

## Built-in Commands vs Scripts

`vp <name>` runs a built-in command. `vp run <name>` runs a `package.json` script or a `vite.config.ts` task. Scripts cannot overwrite built-ins, so `vp dev` and `vp run dev` may do different things. Check `package.json` and `vite.config.ts` first, and run `vp run <name>` when the project defines a script or task with that name.

## Tool Versions

Run `vp toolchain` to show versions and relationships in the active Vite+
release. Add a tool name to select part of the graph. For example, run
`vp toolchain vite`. Use `--global` to ignore the local `vite-plus` package. Use
`vp why <package>` to show the package-manager dependency graph.

## Review Checklist

- [ ] Run `vp install` after pulling remote changes and before getting started.
- [ ] Run `vp check` and `vp test` to format, lint, type check and test changes.
- [ ] Check if there are `vite.config.ts` tasks or `package.json` scripts necessary for validation, run via `vp run <script>`.
- [ ] If setup, runtime, or package-manager behavior looks wrong, run `vp env doctor` and include its output when asking for help.

<!--VITE PLUS END-->

# DBManager（图形数据库模型编辑工具）协作规范

面向所有在本仓库工作的智能体与开发者。先读本文件，再读 `README.md`（完整项目手册）与 `skills/DBManager/SKILL.md`（使用方法技能文档）；历史任务全记录见 `worklog.md`。

## 项目概览

- **定位**：Vue 3 组件库 + 演示应用。构建产物为单文件库 `dist/DBManager.js`（ES 模块）与 `dist/DBManager.d.ts`，导出 `DBManagerView` 组件与 `ManagerApi` 契约类型；`vue`、`antdv-next`、`@lucide/vue` 为 peerDependencies（external，宿主项目提供）。
- **能力**：可视化设计表结构（字段/索引/分类）、表间导航关系连线、数据字典、模板代码生成（Eta）、导入数据库结构、亮暗双主题、AI 工具（openai compatible AGENT 对话式操作）。
- **技术栈**：Vue 3.5 `<script setup>` + TypeScript + antdv-next + Vite Plus（vp CLI）+ Sass；包管理器 **bun**（`bun install` / `bun run xxx`）。
- **仓库**：GitHub `bkbits/dbm-editor`（main 分支）。远程 token 已写入本地 `.git/config`，**严禁入库或外泄**。

## 常用命令

| 命令 | 作用 |
| --- | --- |
| `./node_modules/.bin/vp dev` | 启动开发服务器（localhost:3000） |
| `bun run typecheck` | vue-tsc 类型检查（每次改动后必跑） |
| `./node_modules/.bin/vp check` | oxfmt 格式化 + oxlint 检查（每次改动后必跑；可加 `--fix` 自动修复） |
| `bun run build` | 库构建（vp build + CSS 内联 → `dist/DBManager.js` + `.d.ts`） |
| `python3 scripts/check-readme.py` | README 链接/锚点/表格自检（改 README 后必跑） |
| `bash scripts/package.sh` | 打包源码交付 ZIP 到 `download/` |

## 架构关键约定

### 状态管理（无 Pinia）

- 全部状态为组件实例级：`DBManagerView.vue` 调 `createDBManagerState()` 创建整套仓库（theme/ui/model/canvas/dict/template/settings/history/ai），经 `provide/inject` 注入子树；子组件用 `useXxxStore()` 取用（`src/stores/context.ts` 汇总）。
- **禁止**引入 Pinia 等应用级全局单例，禁止在模块顶层创建跨实例共享状态（`sharedDemoApi` 演示单例除外）。

### ManagerApi 数据契约

- 契约定义在 `src/types/model.ts`：全部方法返回 **Promise**（校验失败 reject 中文业务提示）；UI 侧 `await` 消费，「本地先行 → await api → 失败回滚」事务模式。
- 演示实现 `src/api/demo-manager-api.ts`（内存 + localStorage），带 `withCallLogging` 调用日志 Proxy。
- `updateTablePos` 为批量 DTO（`{ tables: [{ tableId, pos }] }`），多表拖拽仅一次调用。
- 修改契约时同步更新 README 的 ManagerApi 清单与 DemoManagerApi 章节。

### 主题系统（CSS 变量三层）

1. `src/styles/variables.scss` — **静态基线**：全部设计令牌统一 `--dbm-` 前缀（防止与宿主变量冲突），亮暗双套（`[data-theme]` 切换）。
2. `src/styles/antd-theme.scss` — **antd 同步层**：把可映射的 `--dbm-*` 令牌重定义为 antdv-next 的 `--ant-*` CSS 变量；作用域 `.app-provider` + `[class*='css-var-']`（后者覆盖传送门弹层）。前提是 `DBManagerView` 的 a-config-provider 已开 `theme.cssVar`。
3. 无 antd 对应物的令牌（画布网格线、代码高亮配色、分类色板 `--dbm-cat-*`、布局尺寸）沿用静态基线。
- 新增 UI 令牌时：先在 variables.scss 定义（亮暗两套），再评估是否在 antd-theme.scss 补映射；**所有变量名必须带 `--dbm-` 前缀**。

### 构建与外部依赖

- vite 库模式：entry `src/index.ts`，产物仅 `DBManager.js`/`DBManager.d.ts`；`EXTERNAL_RE`（vue/antdv-next/@lucide/vue）不得打包进产物。
- 新增依赖时区分 `dependencies`（随产物打包，如 eta/jszip/highlight.js）与 `peerDependencies`/external（宿主提供）。
- `vite-plugin-dts` 滚动合并单一 `.d.ts`；`lib-inject-css` 将 CSS 内联进 JS。

### 环境目录边界（.gitignore 约束）

- 不入库：`node_modules`、`dist`、`tool-results/`、`download/`、`upload/`、`agent-ctx/`、`.env*`、`/skills/*`（白名单例外 `skills/DBManager/`）。
- 不打包进交付 ZIP：见 `scripts/package.sh` 的 rsync 排除列表。
- 一次性维护脚本（codemod 等）不入仓库，如需本地忽略可登记 `.git/info/exclude`。
- **严禁**将任何 token、密钥、`.env`、会话产物提交入库。

## 代码风格

- 单引号、无分号、2 空格缩进（oxfmt 自动保证，`vp check --fix` 会修）。
- 注释、commit message、worklog 全部使用**中文**；文件头用块注释说明模块职责与关键决策（含「为什么」）。
- Vue 组件：`<script setup lang="ts">` + `<template>` + `<style lang="scss">`（非 scoped 全局类名需带组件前缀避免冲突）。
- 样式只使用 `var(--dbm-*)` 令牌，不写死颜色值（画布 ctx 绘制可用 getComputedStyle 读取令牌）。

## 任务工作流（每个任务必须完整走完）

1. **开发**：修改源码，遵循上述架构约定。
2. **验证**（顺序执行，全部通过才算完成）：
   - `bun run typecheck`
   - `./node_modules/.bin/vp check`（有格式问题用 `--fix` 修完重跑）
   - 涉及构建/依赖变更时 `bun run build`
   - 改 README 后 `python3 scripts/check-readme.py`
   - UI 改动用真实浏览器（localhost:3000）验证交互与亮暗双主题，截图存 `docs/screenshots/`
3. **留档**：向 `worklog.md` **追加**一节（不得改写历史条目）：`Task ID: <下一个编号>` + Agent + Task + Work Log（具体步骤）+ Stage Summary（关键决策/交付物）。
4. **提交**：conventional commit（**中文**，`feat:`/`fix:`/`docs:`/`refactor:`/`chore:` 前缀，一行式正文概括改动），`git add` 相关文件后 `git commit`。
5. **推送**：`git push`（远程已配置；失败先看 `git status` 与远程 URL，不要重建远程）。

## 目录导读

```
src/
├─ index.ts              # 库导出入口（DBManagerView + 契约类型）
├─ types/model.ts        # ManagerApi 契约（异步签名）
├─ api/                  # DemoManagerApi 演示实现 + 注入工具
├─ stores/               # 全套仓库（context.ts 汇总 provide/inject，含 ai 仓库）
├─ views/                # DBManagerView + 编辑器/字典/模板/AI 工具/设置五页
├─ components/           # 画布/对话框/大纲/顶栏组件
├─ styles/               # variables.scss(基线) / antd-theme.scss(同步) / global / hljs
├─ log/                  # Logger 统一日志器
├─ utils/ mock/          # 工具与演示种子数据
scripts/                 # check-readme / eta-smoke / inline-lib-css / package
skills/DBManager/        # 本仓库使用方法技能文档（随仓库发布）
docs/screenshots/        # 验证截图
```
