# 图形数据库模型编辑工具

基于 Web 的图形数据库模型编辑工具，支持可视化设计表结构、字段、索引及表间导航关系。提供直观的画布交互、结构化的大纲导航、便捷的编辑功能、数据字典管理与基于模板的代码生成，并支持 CSS 变量自定义主题与亮暗切换。

![编辑器-亮色](docs/screenshots/editor-final-light.png)

## 目录

- [快速开始](#快速开始)
- [功能总览](#功能总览)
- [页面封装与数据能力注入（DBManagerView / ManagerApi）](#页面封装与数据能力注入dbmanagerview--managerapi)
- [数据模型概览](#数据模型概览)
- [项目结构](#项目结构)
- [非功能说明](#非功能说明)
- [开发与调试](#开发与调试)
- [常见问题（FAQ）](#常见问题faq)
- [界面截图](#界面截图)
- [源码快照与修改补丁](#源码快照与修改补丁)

## 技术栈

| 分类      | 选型                                                                                                                               |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| 包管理器  | [bun](https://bun.sh)                                                                                                              |
| 工具链    | [Vite+](https://viteplus.dev)（`vp` 统一 CLI：dev / build / lint / fmt，`vite-plus` 本地包 + `@voidzero-dev/vite-plus-core` 别名） |
| 前端框架  | Vue 3（Composition API + `<script setup>`）                                                                                        |
| UI 组件库 | antdv-next                                                                                                                         |
| 图标库    | @lucide/vue                                                                                                                        |
| 状态管理  | Pinia                                                                                                                              |
| 模板引擎  | Eta（代码生成）                                                                                                                    |
| 样式      | Sass（scss 标准）                                                                                                                  |
| 数据能力  | ManagerApi 接口体系（内置 DemoManagerApi 演示实现，可注入自定义实现）                                                              |
| 代码高亮  | highlight.js + highlights-eta（Eta 模板语法）                                                                                      |
| 打包下载  | JSZip                                                                                                                              |

> 页面切换不使用 `vue-router`，通过 `v-if` 状态管理（见 `src/stores/ui.ts`）。

## 快速开始

### 环境要求

| 依赖              | 版本 / 说明                                                                                    |
| ----------------- | ---------------------------------------------------------------------------------------------- |
| bun               | ≥ 1.4.2（`package.json` 的 `devEngines` 约定；检测不满足时按 `onFail: download` 自动引导下载） |
| Vite+ CLI（`vp`） | 全局安装一次即可，安装命令见下                                                                 |
| 浏览器            | 最新版 Chrome / Edge / Firefox                                                                 |

### 安装与启动

前置：全局安装 Vite+ CLI（一次即可）

```bash
# macOS / Linux
curl -fsSL https://vite.plus | bash
# Windows（PowerShell）
irm https://vite.plus/ps1 | iex
```

```bash
# 安装依赖（vp install / bun install 均可）
vp install

# 启动开发服务器（Vite+ 内置命令，读取 vite.config.ts 的 server 配置）
vp dev
# 或经 package.json scripts
bun run dev
```

启动后访问 <http://localhost:3000>（`server.host: 0.0.0.0`、`server.allowedHosts: true` 允许任意 Host / 内网 IP / 预览域名访问）。首次打开会自动加载内置演示数据（3 个分类 / 13 张表 / 10 条导航 / 5 个字典 / 4 个代码模板）。

### 常用命令速查

| 命令                              | 说明                                                                      |
| --------------------------------- | ------------------------------------------------------------------------- |
| `bun run dev`（= `vp dev`）       | 启动开发服务器（localhost:3000，热更新）                                  |
| `bun run build`（= `vp build`）   | 生产构建，产物输出到 `dist/`                                              |
| `bun run preview`                 | 本地预览生产构建                                                          |
| `bun run typecheck`               | 全量类型检查（`vue-tsc --noEmit`）                                        |
| `vp check`                        | Vite+ 内置：格式 + lint + 类型检查（staged 提交时自动执行）               |
| `vp install`                      | 安装依赖                                                                  |
| `bun scripts/eta-smoke.mjs`       | Eta 模板引擎 API 冒烟测试（模板功能改动前的快速回归）                     |
| `python3 scripts/check-readme.py` | README 链接 / 锚点 / 表格自检                                             |
| `bash scripts/snapshot.sh`        | 快照当前源码到 `snapshot/`（见[源码快照与修改补丁](#源码快照与修改补丁)） |
| `bash scripts/patch.sh`           | 保存当前修改的 patch 到 `patch/`                                          |
| `bash scripts/package.sh`         | 打包源码为交付 zip（`download/graph-db-model-editor.zip`）                |

## 功能总览

应用由顶栏切换的四个页面组成：**模型编辑器**（画布 + 左侧大纲）、**字典管理**、**模板管理**（代码生成）与**系统设置**。以下按功能域逐一说明。

### 画布（模型编辑器）

- **无限画布**：左键拖拽空白处框选（整卡完全被框住才选中，仅交叉不选中；`Ctrl/Shift` 追加）、中键或 `空格+左键` 拖拽平移、滚轮以光标为中心缩放（25% ~ 500%）
- **网格**：间距随缩放联动，线宽恒定 1px 不随缩放变化
- **小地图**：右下角缩略图，点击/拖拽快速定位视口
- **表卡片**：表名/注释/中间表图标 + 字段列表（默认折叠 6 个）+ 索引（默认隐藏）+ 隐藏导航摘要
- **导航线段**：一对一 `-1----1-`、一对多 `-1----N-`、多对一 `-N----1-`、多对多 `-N----N-`；悬停/选中均为实线（悬停较细且半透明，选中加粗 + 光晕，二者可区分）、悬停提示单行展示「属性 ⇄ 属性（关系说明）」、双击编辑、右键菜单
- **卡片 ⇄ 导航线联动**：悬停卡片时其关联导航线（含 NN 经由的中间表）联动切换到悬停风格；选中卡片（单选/多选/框选）时关联线联动切换到选中风格（加粗 + 光晕）；表选中与线段选中互斥，画布同一时刻只有一种选中焦点
- **悬停/选中过渡**：卡片阴影、连接点淡入缩放、隐藏按钮淡入、导航线颜色/粗细/光晕、标记描边、NN 胶囊、右键菜单弹出等全部带平滑过渡动画
- **多对多中间表**：默认完全隐藏（`Table.hidden` 随模型数据持久化，刷新/重开后保持），线上显示 `中间表名 +` 胶囊，点击展开（若中间表落在当前视口外，画布会平滑滚动将其带入视野，保证展开后一定看得见）；左侧大纲眼睛恢复显示同样带视野保障；对中间表执行隐藏则彻底隐藏（非透明）
- **任一端表隐藏**：导航线不渲染，改为在可见端卡片底部显示「隐藏导航摘要」（类型 + 关联表名）
- **自动美化**：工具栏「魔法棒」按钮 / 空白右键菜单「自动美化布局」，以导航关系为边做力导向布局自动规划每个表卡片的位置（相关联的表彼此靠近、孤立表散开不重叠，结果按 20px 网格对齐），卡片平滑滑动到新位置并自动适应画布
- **对齐与分布**：选中 ≥ 2 张表后，卡片右键 / 空白右键菜单出现「对齐与分布」分组——左对齐/右对齐/顶部对齐/底部对齐（边缘对齐）、水平对齐/垂直对齐（中心线对齐）、水平/垂直均匀分布（首尾不动等间距，需 ≥ 3 张）
- **拖拽创建导航**：卡片上下左右四个连接点拖至目标表；两表间已有导航时丢弃并提示
- **右键菜单**：卡片（编辑/复制/隐藏/对齐分布/删除）、线段（编辑/删除）、空白（新增表/粘贴/自动美化/适应画布/重置缩放/对齐分布）
- **保存与刷新**：顶栏「保存所有」按钮（走 `ManagerApi.save()` 全量保存契约，全局快捷键 `Ctrl+S` 同效）与「刷新」按钮（走 `ManagerApi.load()` 重新加载模型，放弃本地未保存状态并清空撤销栈）；多选表卡片拖动结束时仅调用一次 `updateTablePos` 批量保存位置

**画布快捷键**（`Ctrl+S` 为全局快捷键，任意页面生效）：

| 快捷键                    | 作用                            |
| ------------------------- | ------------------------------- |
| `Ctrl+Z`                  | 撤销                            |
| `Ctrl+Shift+Z` / `Ctrl+Y` | 重做                            |
| `Ctrl+C` / `Ctrl+V`       | 复制 / 粘贴选中表               |
| `Ctrl+A`                  | 全选所有表卡片（不含隐藏表）    |
| `Ctrl+D`                  | 取消选中                        |
| `Ctrl+S`（全局）          | 保存所有（`ManagerApi.save()`） |
| `Delete`                  | 删除选中表                      |
| `Esc`                     | 取消选择                        |
| 中键拖拽 / `空格 + 左键`  | 平移画布                        |
| 滚轮                      | 以光标为中心缩放                |

### 左侧表格大纲

- 分类树（名称 / 包路径 / 表数量），选中高亮、可折叠、支持增删改
- 表名点击 → 画布卡片联动高亮并平滑居中；画布卡片点击 → 大纲联动高亮
- 隐藏表在大纲中以闭眼图标标识，可一键显示/隐藏
- 面板底部「重置演示数据」按钮：恢复内置演示数据（`resetDemo()`，DemoManagerApi 扩展方法）

### 编辑对话框

- **表编辑**：双击卡片/大纲表名或右键菜单触发；字段（增删改/拖拽手柄排序/类型自动映射 Java 类型/字典关联）、索引（类型下拉选项来自「系统设置 → 索引类型」）、导航列表（跳转编辑/删除）
- **导航编辑**：四种类型、两端关联属性、属性名、级联操作（自动/无动作/删除/设为Null，双向独立配置）、NN 中间表（自动创建或选择已有表）、一键反转方向
- **从数据库导入**：经 `ManagerApi.importFromDB()` 读取库表结构（含索引），勾选导入；字段 Java 类型默认值由「系统设置 → 列默认类型」规则依序正则匹配推导（悬停可预览各字段与索引归一化结果），未命中回退内置类型映射；导入的索引类型不在设置列表时归一为列表首项

### 字典管理

- 字典（键/标签/注释）与字典值（值键/标签/类型/注释/自定义颜色）完整 CRUD
- 值类型 `I/S/W/D` 对应 Info/Success/Warning/Danger 风格色，自定义颜色优先
- 模糊搜索覆盖字典键、标签、注释及值的键、标签、注释，命中自动跳转并高亮
- 切换页面后返回时保留选中字典与编辑内容（页面 v-if 卸载重挂后自动恢复）
- 字段编辑时可关联字典键，卡片字段行显示字典小徽标

### 模板管理与代码生成

- 模板列表 + 实时编辑预览：左侧模板脚本（Eta 语法高亮编辑器，`<% %> / <%= %> / <%~ %>` 标签与 `<%# %>` 注释区分着色，输入实时同步）、右侧选择目标表实时渲染
- **代码预览**：选中单表 → 切换模板标签页查看生成代码（highlight.js 高亮、可复制）
- **代码生成**：选中分类 / 选中表 / 不选中（全部）→ 触发下载 zip（JSZip 按模板内 `filePath` 建目录）
- **代码替换**：同上范围 → 弹出确认（含文件清单）→ 经 `ManagerApi.replace(zip)` 上传 zip（结果反馈由 api 实现自行处理）

模板内置变量与工具：

```ts
interface TemplateContext {
  templateName: string // 模板名称
  templateContent: string // 模板内容
  result?: string // 生成结果
  basePackage: string // 基础包名（表所属分类）
  fileName: string // 文件名（模板内赋值）
  filePath: string // 文件路径（模板内赋值）
  language?: string // 显式指定预览高亮语言（模板内赋值，如 <% context.language = 'java' %>）
  table: TableVO // 当前表（columns/indexes/navigates）
}
```

> 预览/代码生成结果的高亮语言：`context.language` 显式指定优先（如 `java` / `sql` / `xml` / `javascript`），未设置时按产物文件名后缀自动识别，工具栏语言徽标实时显示实际生效语言。

| 工具                                            | 说明                     |
| ----------------------------------------------- | ------------------------ |
| `utils.toCamelCase(str, firstLetterLowerCase?)` | 转驼峰                   |
| `utils.toSnakeCase(str)`                        | 转蛇形                   |
| `utils.getJavaType(column)`                     | 数据库类型映射 Java 类型 |
| `utils.quote(content, condition?)`              | 引号包裹                 |
| `utils.wrap(content, condition?)`               | 括号包裹                 |
| `utils.isEmpty(str)` / `utils.isBlank(str)`     | 判空 / 判空白            |

Eta 语法：`<% %>` 逻辑、`<%= %>` 输出、`<%# %>` 自定义注释标签（渲染前剥离）。模板内可直接访问 `context` 与 `utils` 顶层标识（`useWith` 模式）。

内置 4 个模板：`entity`（Java 实体）、`dao`、`service`、`sql`（建表 DDL），可在「模板管理」中自由修改与新增。

### 系统设置

- **列默认类型**：从数据库导入时的 Java 类型默认映射。对字段的数据库类型（如 `VARCHAR(255)`、`Decimal(6, 4)`）按规则列表**自上而下依次**（`sort` 升序，越小越优先）进行正则表达式匹配（忽略大小写），取**第一条命中**规则的 Java 类型作为默认值；全部未命中时回退内置类型映射表
- 可选 Java 类型：`Character` / `String` / `Long` / `Integer` / `Float` / `Double` / `BigDecimal` / `LocalDateTime` / `LocalDate` / `LocalTime` / `Timestamp`
- 规则顺序即优先级，拖拽手柄调整（保存时按序重编号 `sort`）；非法正则即时标红并禁用保存；内置「规则测试」输入任意数据库类型实时预览命中结果（含未保存修改，区分「生效/命中被抢先」）
- **索引类型**：索引类型列表管理（增删，自动转大写、去重校验）。「编辑表」对话框的索引类型下拉选项与数据库导入的索引类型归一化均使用该列表；至少保留一个类型
- 设置保存后持久化（DemoManagerApi + localStorage），整页统一保存 / 放弃修改

### 主题

- 全部颜色/间距/圆角/阴影通过 CSS 变量定义（`src/styles/variables.scss`），可在外部覆盖定制主题
- 顶栏按钮切换亮色/暗色，同步根元素 `data-theme`，CSS 变量与 antdv-next 主题算法自动切换，偏好持久化

## 页面封装与数据能力注入（DBManagerView / ManagerApi）

整个应用页面封装为 `src/views/DBManagerView.vue`，可通过属性注入自定义数据能力实现：

```ts
import DBManagerView from '@/views/DBManagerView.vue'
import type { ManagerApi } from '@/types/model'

const myApi: ManagerApi = {
  // 实现全部方法：设置读写 / 数据库导入 / 模型加载与全量保存 /
  // 分类・表・导航细粒度 CRUD / 字典与模板 CRUD / 代码替换
  // （详见 src/types/model.ts 的 ManagerApi 接口）
  ...
}
```

```vue
<DBManagerView :api="myApi" />
<!-- 不传 api 时使用内置 DemoManagerApi 演示实现（内存 + localStorage） -->
```

注入链路：

- **DBManagerView** 解析 `api` 属性（缺省共享 `sharedDemoApi` 单例），`provide` 注入子组件并 `setActiveApi` 写入全局激活实例；切换 api 时自动全量重载各仓库数据
- **子组件**（如数据库导入 / 代码替换对话框）通过 `useManagerApi()`（`src/api/manager-api.ts`）注入响应式引用，在合适位置直接调用 `api.importFromDB()` / `api.replace(zip)` 等方法
- **Pinia store** 无法使用 inject，统一经 `getManagerApi()` 读取全局激活实例；模型变更遵循细粒度契约——每次操作先改本地状态，再调用对应 api 方法（`addTable` / `updateTable` / `removeTable` / `updateTablePos` / `addNavigate` …）即时持久化，持久化失败自动回滚快照；撤销/重做恢复后通过 diff 同步（`syncToApi`）把持久层对齐到本地状态

### ManagerApi 接口清单

| 方法                                                                  | 说明                                                                                                                                                     |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `getSettings() / saveSettings(settings)`                              | 应用设置读写（索引类型列表 + 列类型映射规则）                                                                                                            |
| `importFromDB()`                                                      | 从真实数据库读取表结构（含字段与索引，用于导入建模）                                                                                                     |
| `load()`                                                              | 加载完整模型（分类/表/导航），初次进入与点击「刷新」按钮时使用                                                                                           |
| `save()`                                                              | 全量保存模型，点击「保存所有」按钮或按 `Ctrl+S` 时调用                                                                                                   |
| `getCategories() / addCategory / updateCategory / removeCategory`     | 分类 CRUD                                                                                                                                                |
| `getTables() / addTable / updateTable / removeTable / updateTablePos` | 表 CRUD（含字段与索引；删除表一并删除其字段、索引与关联导航；拖动表卡片结束时用 `updateTablePos` 批量保存位置——`UpdateTablePosDTO`，多表同动仅一次调用） |
| `getNavigates() / addNavigate / updateNavigate / removeNavigate`      | 导航关系 CRUD                                                                                                                                            |
| `getDicts() / addDict / updateDict / removeDict`                      | 字典 CRUD                                                                                                                                                |
| `getTemplates() / addTemplate / updateTemplate / removeTemplate`      | 代码模板 CRUD                                                                                                                                            |
| `replace(zipFile)`                                                    | 上传 zip 产物代码，直接替换对应源码文件                                                                                                                  |

> 调用时机约定：应用视图启动即幂等预载 `getSettings()`（设置是编辑器/导入共用的全局配置）与 `load()`；此后各操作按细粒度契约即时调用对应方法。`DBColumn.notNull` 为 demo 扩展字段（真实实现可不提供，缺省视为可空）；`Table.hidden` 随模型数据持久化（隐藏态在刷新/重开后保持）；`resetDemo()` 为 DemoManagerApi 的扩展方法（重置为内置演示数据），正式实现无需提供。

### 统一日志 Logger（src/log/Logger.ts）

导出全局单例 `Logger`，提供 `log / info / debug / warn / error / fatal` 六个输出方法与级别控制：

```ts
import { Logger } from '@/log/Logger'

Logger.debug('入参', args) // [09:30:12.405] [DEBUG] 入参 [args...]
Logger.error('失败', err) // [09:30:12.405] [ERROR] 失败 Error: ...
Logger.setLevel('INFO') // 或 Logger.level = 'INFO' / Logger.getLevel()
```

- 级别：`DEBUG < INFO < WARN < ERROR < FATAL`，只输出当前级别及以上的日志；`DISABLED` 屏蔽一切输出（含 `log` 与 `fatal`）
- `log()` 为无级别方法：未禁用即输出（等同 `console.log` 的定位，不参与级别过滤）
- 通道映射：`debug/log → console.log`（不用 `console.debug`，避免被 DevTools 默认 Verbose 过滤隐藏）、`info → console.info`、`warn → console.warn`、`error/fatal → console.error`（fatal 以 `[FATAL]` 标签区分）
- 输出带 `[HH:mm:ss.SSS] [级别]` 前缀，参数原样透传（对象在 DevTools 中保持可展开）
- 默认级别：开发构建 `DEBUG`（全量），生产构建 `INFO`；运行时可随时 `setLevel` 调整

![Logger 六方法与级别过滤](docs/screenshots/logger-levels.png)

### DemoManagerApi（内置演示实现）

`src/api/demo-manager-api.ts`：数据存于内存（`src/mock/db.ts`）并持久化到 `localStorage`（`gdbme:db:v2`）；除 `replace` 的 zip 解析外全部同步完成，校验失败抛出含中文业务提示的 `Error`。数据重置：左下大纲面板「重置演示数据」按钮。

所有方法经 Proxy 包装打印调用日志：每次契约调用输出 `[DemoManagerApi] <方法>() 入参` 与 `返回`（debug 级），抛错时以 error 级输出后原样抛出；内部辅助方法互调不打日志。联调时可在控制台按 `DemoManagerApi` 过滤，直接观测各契约方法的实际调用时机与参数（如应用启动即触发 `getSettings` / `load`）；`Logger.setLevel('INFO')` 可静默追踪噪音，`DISABLED` 可完全关闭。

![DemoManagerApi 调用日志](docs/screenshots/api-call-logs.png)

## 数据模型概览

核心类型定义于 `src/types/model.ts`（与《图形数据库模型编辑工具需求规格说明书》保持一致），各实体职责速览：

| 实体                                      | 职责与关键约束                                                                                                                              |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `TableCategory`                           | 表分类：`name` 唯一；携带 `basePackage`（代码生成基础包名）与 `src`（源码替换路径）                                                         |
| `Table`                                   | 表元信息：`tableName` 唯一、所属分类、实体类名、树形表父列 `parentIdColumn`、隐藏态 `hidden`、画布坐标 `x/y`                                |
| `TableColumn`                             | 字段：表内 `columnName` 唯一、`sort` 排序、数据库类型与 Java 类型映射、主键/非空、`dict` 关联字典键                                         |
| `TableIndex`                              | 索引：`indexName` 唯一、`type` 取值来自「系统设置 → 索引类型」列表、`columns` 字段名列表                                                    |
| `TableNavigate`                           | 原始导航（双向语义）：`self` / `target` 两端表与关联/映射属性、NN 经 `mappingTable` 中间表、双向独立级联；两端可反转（type 需同步调换）     |
| `Navigate`                                | 单向导航视图：由 `TableNavigate` 派生，供模板上下文 `table.navigates` 使用                                                                  |
| `Dict` / `DictValue`                      | 字典与字典值：`dictKey` / `valueKey` 唯一，值标签类型 `I/S/W/D`，支持自定义颜色                                                             |
| `Template`                                | 代码模板：`templateName` 唯一 + Eta 脚本内容                                                                                                |
| `Settings` / `TypeMapping`                | 应用设置：索引类型列表 + 列类型正则映射规则（`sort` 升序依次匹配，取首条命中）                                                              |
| `DBTable` / `DBColumn` / `DBIndex`        | 数据库导入契约形态（`importFromDB()` 返回）                                                                                                 |
| `ManagerTable` / `LoadResultVO` / Payload | ManagerApi 读写载荷：`ManagerTable`（表 + 字段 + 索引）、`LoadResultVO`（全量模型）、`TableAdd/UpdatePayload`（含 `rawNavigates` 替换语义） |

实体关系：分类 1—N 表，表 1—N 字段/索引；导航两端经表名互相引用（NN 再经中间表名）；字段的 `dict` 键关联字典。唯一性校验（表名/字段名/索引名/字典键/值键/模板名）由 ManagerApi 实现层负责，DemoManagerApi 违例时抛出含中文提示的 `Error`。

## 项目结构

```
├─ index.html
├─ vite.config.ts          # Vite+ 配置（@ 别名 / 端口 3000 / allowedHosts / lint / fmt / staged）
├─ tsconfig.json
├─ docs/screenshots/       # 界面截图
├─ scripts/                # 开发辅助脚本（Eta 冒烟测试 / README 自检 / 快照 / patch / 打包）
├─ snapshot/               # 源码快照存档（scripts/snapshot.sh 生成，gitignore）
├─ patch/                  # 修改补丁存档（scripts/patch.sh 生成，gitignore）
└─ src/
   ├─ main.ts              # 入口（注册 Pinia / antdv-next / 主题）
   ├─ App.vue              # 根组件（渲染 DBManagerView，可传入自定义 api）
   ├─ api/                 # ManagerApi 注入体系（manager-api）+ DemoManagerApi 演示实现
   ├─ composables/         # useDragSort 行拖拽排序（字段/设置规则共用）
   ├─ log/                 # 统一日志器 Logger（级别过滤：DEBUG/INFO/WARN/ERROR/FATAL/DISABLED）
   ├─ mock/                # 种子数据 + demo 内存数据库（localStorage 持久化）
   ├─ stores/              # Pinia：model / canvas / dict / template / theme / ui / history / settings
   ├─ types/               # 数据模型类型（含 ManagerApi 契约，与规格说明书一致）
   ├─ utils/               # 字符串 / Java 类型映射 / 导航推导 / 几何 / 力导向布局 / Eta 渲染 / 高亮
   ├─ styles/              # CSS 变量（亮暗双主题）/ 全局样式 / hljs 配色
   ├─ views/               # DBManagerView（页面封装）/ EditorView / DictView / TemplateView / SettingsView
   └─ components/
      ├─ layout/           # AppHeader
      ├─ outline/          # 左侧表格大纲
      ├─ canvas/           # ModelCanvas / TableCard / NavigateEdge / Minimap / 菜单 / 工具栏
      └─ dialog/           # 表/导航/分类/导入/代码预览/替换确认 对话框
```

## 非功能说明

- 画布渲染带视口裁剪（仅渲染可视区附近卡片），支持 100+ 表卡片流畅操作
- 兼容最新版 Chrome / Edge / Firefox
- 撤销/重做基于模型快照（上限 50 步），恢复后经 diff 同步（`syncToApi`）将持久层对齐到本地状态

## 开发与调试

### 观测 ManagerApi 调用

开发服务器下打开浏览器控制台，按 `DemoManagerApi` 过滤即可观测全部契约方法的实际调用时机、入参与返回（应用启动即触发 `getSettings` / `load`，此后每个编辑动作对应一条细粒度调用）。也可以在控制台直接动态导入模块手工验证契约行为（vite dev server 直接服务 TS 模块，无需构建）：

```js
// 控制台执行：直接调用 demo api 验证契约行为
const { sharedDemoApi } = await import('/src/api/manager-api.ts')
await sharedDemoApi.getTables() // 返回全部表（含字段与索引）
await sharedDemoApi.updateTablePos({
  tables: [{ tableId: 't-sys-user', pos: { x: 300, y: 200 } }],
}) // 体验批量契约与抛错路径
```

### 运行时调整日志级别

```js
// 控制台执行：Logger 经动态导入获取
const { Logger } = await import('/src/log/Logger.ts')
Logger.setLevel('INFO') // 静默 debug 级调用追踪（info 及以上保留）
Logger.setLevel('DISABLED') // 完全关闭所有输出
Logger.getLevel() // 查看当前级别
```

### Eta 模板冒烟测试

```bash
bun scripts/eta-smoke.mjs
```

验证 Eta v4 的 `useWith` 渲染、`<%# %>` 注释剥离、模板内赋值副作用等关键行为，是模板功能改动前的快速回归手段。

### 代码风格与提交检查

`vite.config.ts` 的 `staged` 配置在提交时自动执行 `vp check --fix`（格式 + lint）；`bun run prepare`（`vp config`）负责安装钩子。fmt 规则与项目既有约定一致：单引号、无分号。类型检查由 `vue-tsc` 承担（`bun run typecheck`），lint 关闭类型感知规则（详见 `vite.config.ts` 内注释）。

## 常见问题（FAQ）

**`vp: command not found`？**
`vp` 是全局 CLI，需先执行[快速开始](#快速开始)中的安装命令；或直接使用等价的 `bun run dev` / `bun run build`（package.json scripts 经项目本地 `vite-plus` 依赖调用，无需全局 CLI）。

**控制台日志太多？**
DemoManagerApi 的调用追踪为 debug 级：控制台执行 `Logger.setLevel('INFO')` 即静默，`'DISABLED'` 完全关闭（见[开发与调试](#开发与调试)）。

**演示数据想恢复初始状态？**
左侧大纲面板底部「重置演示数据」按钮（`resetDemo()`）。

**数据存在哪里？**
DemoManagerApi 将模型持久化到浏览器 `localStorage`（key 为 `gdbme:db:v2`）；清除站点数据即回到首次打开状态。

**想换端口？**
修改 `vite.config.ts` 的 `server.port`（默认 3000）。

**旧版本的 localStorage 数据会不兼容吗？**
`loadDB` 会自动归一迁移：旧 `gdbme:hidden` 隐藏键迁移为 `Table.hidden` 字段并清除，其余缺失字段按种子补齐后落盘，无需手动处理。

## 界面截图

| 亮色编辑器                                       | 暗色编辑器                                |
| ------------------------------------------------ | ----------------------------------------- |
| ![亮色](docs/screenshots/editor-final-light.png) | ![暗色](docs/screenshots/editor-dark.png) |

| 自动美化布局（力导向）                        | 对齐与分布右键菜单                                   |
| --------------------------------------------- | ---------------------------------------------------- |
| ![自动美化](docs/screenshots/auto-layout.png) | ![对齐菜单](docs/screenshots/align-context-menu.png) |

| 表编辑对话框（拖拽手柄排序）                              | 系统设置 · 列默认类型                               |
| --------------------------------------------------------- | --------------------------------------------------- |
| ![表编辑](docs/screenshots/table-columns-drag-handle.png) | ![设置](docs/screenshots/settings-column-rules.png) |

| 模板管理（实时预览）                              | 字典管理（暗色）                        |
| ------------------------------------------------- | --------------------------------------- |
| ![模板](docs/screenshots/template-view-fixed.png) | ![字典](docs/screenshots/dict-dark.png) |

| 代码预览（高亮 / 可复制）                      | 系统设置 · 索引类型（暗色）                                 |
| ---------------------------------------------- | ----------------------------------------------------------- |
| ![代码预览](docs/screenshots/code-preview.png) | ![索引类型](docs/screenshots/settings-index-types-dark.png) |

| 页面封装 · DBManagerView（亮色）                      | 页面封装 · DBManagerView（暗色）                     |
| ----------------------------------------------------- | ---------------------------------------------------- |
| ![DBManager 亮](docs/screenshots/dbmanager-light.png) | ![DBManager 暗](docs/screenshots/dbmanager-dark.png) |

## 源码快照与修改补丁

开发过程中可在任意时点留档：

```bash
bash scripts/snapshot.sh   # 快照当前源码到 snapshot/[年月日时分秒].zip
bash scripts/patch.sh      # 保存当前修改的 patch 到 patch/[年月日时分秒].patch
bash scripts/package.sh    # 打包源码为交付 zip（download/graph-db-model-editor.zip，含 README）
```

`patch/` 中的补丁为 git 工作区相对最近一次提交的源码 diff（新增源文件以 intent-to-add 纳入），可用 `git apply patch/xxx.patch` 复现改动。`snapshot/` 与 `patch/` 已加入 `.gitignore`，不会影响版本管理与源码打包。
