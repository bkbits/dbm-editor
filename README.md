# 图形数据库模型编辑工具

基于 Web 的图形数据库模型编辑工具，支持可视化设计表结构、字段、索引及表间导航关系。提供直观的画布交互、结构化的大纲导航、便捷的编辑功能、数据字典管理与基于模板的代码生成，并支持 CSS 变量自定义主题与亮暗切换。

![编辑器-亮色](docs/screenshots/editor-final-light.png)

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

| 方法                                                                  | 说明                                                                                                        |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `getSettings() / saveSettings(settings)`                              | 应用设置读写（索引类型列表 + 列类型映射规则）                                                               |
| `importFromDB()`                                                      | 从真实数据库读取表结构（含字段与索引，用于导入建模）                                                        |
| `load()`                                                              | 加载完整模型（分类/表/导航），初次进入与点击「刷新」按钮时使用                                              |
| `save()`                                                              | 全量保存模型，仅在点击「保存所有」按钮时调用                                                                |
| `getCategories() / addCategory / updateCategory / removeCategory`     | 分类 CRUD                                                                                                   |
| `getTables() / addTable / updateTable / removeTable / updateTablePos` | 表 CRUD（含字段与索引；删除表一并删除其字段、索引与关联导航；拖动表卡片结束时用 `updateTablePos` 保存位置） |
| `getNavigates() / addNavigate / updateNavigate / removeNavigate`      | 导航关系 CRUD                                                                                               |
| `getDicts() / addDict / updateDict / removeDict`                      | 字典 CRUD                                                                                                   |
| `getTemplates() / addTemplate / updateTemplate / removeTemplate`      | 代码模板 CRUD                                                                                               |
| `replace(zipFile)`                                                    | 上传 zip 产物代码，直接替换对应源码文件                                                                     |

> `DBColumn.notNull` 为 demo 扩展字段（真实实现可不提供，缺省视为可空）；`Table.hidden` 随模型数据持久化（隐藏态在刷新/重开后保持）；`resetDemo()` 为 DemoManagerApi 的扩展方法（重置为内置演示数据），正式实现无需提供。

### DemoManagerApi（内置演示实现）

`src/api/demo-manager-api.ts`：数据存于内存（`src/mock/db.ts`）并持久化到 `localStorage`（`gdbme:db:v2`）；除 `replace` 的 zip 解析外全部同步完成，校验失败抛出含中文业务提示的 `Error`。数据重置：左下大纲面板「重置演示数据」按钮。

所有方法经 Proxy 包装打印调用日志：每次契约调用在控制台输出 `[DemoManagerApi] <方法>() 入参` 与 `返回`（抛错时 `console.error` 后原样抛出），内部辅助方法互调不打日志——联调时可在控制台按 `[DemoManagerApi]` 过滤，直接观测各契约方法的实际调用时机与参数（如应用启动即触发 `getSettings` / `load`）。

## 快速开始

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

# 生产构建 / 预览
vp build
vp preview

# 类型检查 / 代码检查
bun run typecheck   # vue-tsc --noEmit
vp check            # 格式 + lint + 类型检查（Vite+ 内置）
```

启动后访问 <http://localhost:3000>（`server.host: 0.0.0.0`、`server.allowedHosts: true` 允许任意 Host / 内网 IP / 预览域名访问）。首次打开会自动加载内置演示数据（3 个分类 / 13 张表 / 10 条导航 / 5 个字典 / 4 个代码模板）。

## 功能总览

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
- **快捷键**：`Ctrl+Z` 撤销、`Ctrl+Shift+Z` / `Ctrl+Y` 重做、`Ctrl+C` 复制、`Ctrl+V` 粘贴、`Delete` 删除选中表、`Esc` 取消选择
- **保存与刷新**：顶栏「保存所有」按钮（走 `ManagerApi.save()` 全量保存契约）与「刷新」按钮（走 `ManagerApi.load()` 重新加载模型，放弃本地未保存状态并清空撤销栈）

### 左侧表格大纲

- 分类树（名称 / 包路径 / 表数量），选中高亮、可折叠、支持增删改
- 表名点击 → 画布卡片联动高亮并平滑居中；画布卡片点击 → 大纲联动高亮
- 隐藏表在大纲中以闭眼图标标识，可一键显示/隐藏

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

## 项目结构

```
├─ index.html
├─ vite.config.ts          # Vite+ 配置（@ 别名 / 端口 3000 / allowedHosts / lint / fmt / staged）
├─ tsconfig.json
├─ docs/screenshots/       # 界面截图
├─ scripts/                # 开发辅助脚本（Eta 冒烟测试 / 快照 / patch / 打包）
├─ snapshot/               # 源码快照存档（scripts/snapshot.sh 生成，gitignore）
├─ patch/                  # 修改补丁存档（scripts/patch.sh 生成，gitignore）
└─ src/
   ├─ main.ts              # 入口（注册 Pinia / antdv-next / 主题）
   ├─ App.vue              # 根组件（渲染 DBManagerView，可传入自定义 api）
   ├─ api/                 # ManagerApi 注入体系（manager-api）+ DemoManagerApi 演示实现
   ├─ composables/         # useDragSort 行拖拽排序（字段/设置规则共用）
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

| 模板管理（实时预览）                              | 系统设置 · 索引类型（暗色）                                 |
| ------------------------------------------------- | ----------------------------------------------------------- |
| ![模板](docs/screenshots/template-view-fixed.png) | ![索引类型](docs/screenshots/settings-index-types-dark.png) |

| 页面封装 · DBManagerView（亮色）                      | 页面封装 · DBManagerView（暗色）                     |
| ----------------------------------------------------- | ---------------------------------------------------- |
| ![DBManager 亮](docs/screenshots/dbmanager-light.png) | ![DBManager 暗](docs/screenshots/dbmanager-dark.png) |

## 源码快照与修改补丁

开发过程中可在任意时点留档：

```bash
bash scripts/snapshot.sh   # 快照当前源码到 snapshot/[年月日时分秒].zip
bash scripts/patch.sh      # 保存当前修改的 patch 到 patch/[年月日时分秒].patch
```

`patch/` 中的补丁为 git 工作区相对最近一次提交的源码 diff（新增源文件以 intent-to-add 纳入），可用 `git apply patch/xxx.patch` 复现改动。`snapshot/` 与 `patch/` 已加入 `.gitignore`，不会影响版本管理与源码打包。
