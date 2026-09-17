---
name: DBManager
description: 图形数据库模型编辑工具（bkbits/dbm-editor）的使用方法：在 Vue 3 + antdv-next 宿主项目中集成 DBManagerView 组件库、实现 ManagerApi 异步数据契约对接真实后端、主题令牌（--dbm-* / antd 同步）定制，以及本仓库的本地开发与贡献流程。当用户需要在项目中引入可视化表结构/导航关系/数据字典/模板代码生成编辑器，或需要开发/调试 dbm-editor 仓库本身时使用本技能。
---

# DBManager 使用方法

Vue 3 组件库 + 演示应用：以单文件库形式提供「数据库模型编辑器」页面（可视化表结构、字段/索引、表间导航连线、数据字典、模板代码生成）。仓库 `bkbits/dbm-editor`，构建产物 `dist/DBManager.js`（ES 模块，样式自包含）+ `dist/DBManager.d.ts`。

## 宿主项目集成

### 1. 安装依赖

`vue`、`antdv-next`、`@lucide/vue` 为 peerDependencies，由宿主提供（不打进产物）：

```bash
bun add bkbits/dbm-editor vue@^3.5 antdv-next @lucide/vue
# 或从源码构建安装：
git clone https://github.com/bkbits/dbm-editor && cd dbm-editor
bun install && bun run build   # 产出 dist/DBManager.js + DBManager.d.ts
```

### 2. 实现 ManagerApi 数据契约与 AIApi（可选）

契约在包类型导出中定义（源码 `src/types/` 三文件：`manager.ts` = ManagerApi 接口，`model.ts` = 实体与 DTO，`ai.ts` = 多供应商 AI 设置 / 三协议归一对话契约与 AIApi 接口），**全部方法返回 Promise**（对接 HTTP/IPC/文件 IO 零调整），校验失败以 `reject` 抛出中文业务提示，UI 侧 `await` 消费并自带失败回滚：

```ts
import type { ManagerApi, AIApi, Settings, ModelElements, ManagerTable,
  TableCategory, TableNavigate, Dict, Template, UpdateTablePosDTO } from 'bkbits/dbm-editor'

const myApi: ManagerApi = {
  // —— 读（返回数据 Promise）——
  async getSettings(): Promise<Settings> { /* GET /settings */ },
  async load(): Promise<ModelElements> { /* 一次性返回 categories/tables/navigates */ },
  async getTables(): Promise<ManagerTable[]> { /* … */ },
  async getTableCategories(): Promise<TableCategory[]> { /* … */ },
  async getNavigates(): Promise<TableNavigate[]> { /* … */ },
  async getDicts(): Promise<Dict[]> { /* … */ },
  async getTemplates(): Promise<Template[]> { /* 含字典模板（id 固定 tpl-dict-category） */ },
  async importFromDB(): Promise<DBTable[]> { /* 连库读表结构，供导入对话框选择 */ },

  // —— 写（Promise<void>；全量替换语义的三个 save 需传完整快照）——
  async setSettings(s: Settings) { /* … */ },
  async save(m: ModelElements) { /* Ctrl+S /「保存所有」触发；不在快照中的元素会被删除 */ },
  async saveDicts(dicts: Dict[]) { /* 替换保存：入参为完整快照 */ },
  async saveTemplates(templates: Template[]) { /* 替换保存：入参须含字典模板 */ },
  async addTableCategory(c: TableCategory) { /* … */ },
  async updateTableCategory(c: TableCategory) { /* … */ },
  async removeTableCategory(id: string) { /* … */ },
  async addTable(t: ManagerTable) { /* … */ },
  async updateTable(t: ManagerTable) { /* … */ },
  async removeTable(id: string) { /* … */ },
  async updateTablePos(dto: UpdateTablePosDTO) { /* { tables: [{ tableId, pos }] }，多表拖拽仅此一次调用 */ },
  async addNavigate(n: TableNavigate) { /* … */ },
  async updateNavigate(n: TableNavigate) { /* … */ },
  async removeNavigate(id: string) { /* … */ },
  async addDict(d: Dict) { /* … */ },
  async updateDict(d: Dict) { /* … */ },
  async removeDict(id: string) { /* … */ },
  async addTemplate(t: Template) { /* … */ },
  async updateTemplate(t: Template) { /* … */ },
  async removeTemplate(id: string) { /* … */ },
  async replace(zip: Blob) { /* 代码替换：接收生成结果 zip */ },
}

// —— AI 专属能力（可选注入：缺省使用内置 DemoAIApi）——
const myAIApi: AIApi = {
  async getAISettings(): Promise<AiSettings> { /* 多供应商列表（协议/地址/密钥/模型）+ 默认模型 + 全局规则 + 轮数上限 */ },
  async setAISettings(s: AiSettings) { /* … */ },
  async chat(req: ChatCompletionRequest, onDelta?: (d: ChatCompletionDelta) => void): Promise<ChatCompletionResult> { /* 统一对话（流式）：按 req.provider.protocol 分派到 OpenAI Chat Completions / OpenAI Responses / Anthropic Messages，三协议增量归一为 onDelta 回调（正文/思考/工具调用/用量），流结束 resolve 聚合结果；中止经 req.signal */ },
  async fetch(req: AIFetchRequest): Promise<AIFetchResult> { /* AI 的 fetch 工具经此发起网络请求 */ },
}
```

对接真实后端时把每个方法映射到 HTTP/IPC 即可；UI 调用链路（组件树、事务回滚、撤销全量落盘）无需改动。内置演示实现 `DemoManagerApi` + `DemoAIApi`（内存 + localStorage，`src/api/demo-manager-api.ts` / `src/api/demo-ai-api.ts`，带调用日志 Proxy，控制台可观测全部契约调用）。

### 3. 挂载组件

```ts
// main.ts
import { createApp } from 'vue'
import Antd from 'antdv-next'
import 'antdv-next/dist/reset.css'
import App from './App.vue'

createApp(App).use(Antd).mount('#app')
```

```vue
<!-- App.vue：不传 api 时使用内置演示实现；自定义实现经 prop 注入 -->
<script setup lang="ts">
import { DBManagerView } from 'bkbits/dbm-editor'
import { myApi, myAIApi } from './api'
</script>
<template>
  <DBManagerView :api="myApi" :ai-api="myAIApi" style="height: 100vh" />
</template>
```

组件自带全部样式与内部状态（provide/inject 组件树内自管理，**不依赖 Pinia**，不污染宿主全局）。页面切换在组件内部完成（不引入 vue-router）。

## 主题与样式定制

三层结构，令牌统一 `--dbm-` 前缀（与宿主变量隔离）：

1. **静态基线** `variables.scss`：全部颜色/间距/圆角/阴影令牌，亮暗双套（`[data-theme='light'|'dark']` 切换，偏好持久化 localStorage `gdbme:theme`）。直接覆盖 `--dbm-*` 变量即可深度定制。
2. **antd 同步层** `antd-theme.scss`：把可映射令牌重定义为 antdv-next 的 `--ant-*` CSS 变量，组件外观跟随宿主 antd 主题（品牌色、令牌覆盖、暗色算法）自动联动。前提：组件内部 a-config-provider 已开 `theme.cssVar`，宿主自定义 antd 主题即可传导进组件。
3. 无 antd 对应物的令牌（画布网格线、代码高亮配色、分类色板 `--dbm-cat-0..7`、布局尺寸）沿用静态基线。

覆盖示例（宿主任意样式，在组件挂载前生效）：

```css
:root {
  --dbm-cat-0: #7c3aed; /* 首分类色改紫色（未走 antd 映射的令牌） */
}
```

走 antd 联动的令牌（主色、背景、文本、边框、圆角、间距、阴影等）请直接配置宿主 antd 主题（ConfigProvider token），不要覆盖 `--dbm-*`。

## 快捷键

- 画布：`Ctrl+A` 全选可见表卡片、`Ctrl+D` 取消选中、`Esc` 关闭菜单、右键对齐/自动布局、框选/多选拖拽（批量保存）
- 全局：`Ctrl+S` 保存所有（与「保存所有」按钮同函数）
- 撤销/重做：`Ctrl+Z` / `Ctrl+Shift+Z`（上限 50 步，恢复后自动 diff 同步持久层）

## 本地开发（仓库本身）

```bash
bun install                              # 安装依赖（包管理器：bun；vp CLI 在 node_modules/.bin）
./node_modules/.bin/vp dev               # 开发服务器 localhost:3000（演示应用）
bun run typecheck                        # vue-tsc 类型检查
./node_modules/.bin/vp check             # oxfmt + oxlint（--fix 自动修复）
bun run build                            # 库构建 + CSS 内联 → dist/DBManager.js/.d.ts
python3 scripts/check-readme.py          # README 自检（改 README 后必跑）
bash scripts/package.sh                  # 打包源码 ZIP 到 download/
```

仓库贡献规范（提交前校验链、conventional commit 中文规范、worklog 留档协议、目录导读）见仓库根 `AGENTS.md`；完整项目手册见 `README.md`。

## 常见排查

| 现象 | 原因与处置 |
| --- | --- |
| 组件主色/背景与宿主 antd 不一致 | 宿主 antd 主题 token 修改未生效：确认宿主与组件共用同一 antdv-next 实例（peer 依赖去重）；组件已内置 `theme.cssVar`，无需手动开启 |
| 弹窗内样式与页面不一致 | 弹层传送至 body 但携带 `css-var-*` 类，映射自动覆盖；若宿主自行套了 ConfigProvider 且关闭 cssVar，会破坏同步层，需保持默认 |
| 类型报错「表不存在」等中文异常 | 契约方法校验失败的 reject 语义，属预期行为；调用方 catch 后向用户反馈 |
| 持久化数据位置 | DemoManagerApi 落 localStorage（key 前缀 `gdbme:`）；生产请实现 ManagerApi 对接后端 |
