# 图形数据库模型编辑工具

基于 Web 的图形数据库模型编辑工具，支持可视化设计表结构、字段、索引及表间导航关系。提供直观的画布交互、结构化的大纲导航、便捷的编辑功能、数据字典管理与基于模板的代码生成，并支持 CSS 变量自定义主题与亮暗切换。

![编辑器-亮色](docs/screenshots/editor-final-light.png)

## 技术栈

| 分类 | 选型 |
| --- | --- |
| 包管理器 | [bun](https://bun.sh) |
| 构建工具 | Vite 8（`vp` 启动脚本） |
| 前端框架 | Vue 3（Composition API + `<script setup>`） |
| UI 组件库 | antdv-next |
| 图标库 | @lucide/vue |
| 状态管理 | Pinia |
| 模板引擎 | Eta（代码生成） |
| 样式 | Sass（scss 标准） |
| 网络请求 | Axios（自定义 adapter 转发至 Mock） |
| 代码高亮 | highlight.js + highlights-eta（Eta 模板语法） |
| 打包下载 | JSZip |

> 页面切换不使用 `vue-router`，通过 `v-if` 状态管理（见 `src/stores/ui.ts`）。

## 快速开始

```bash
# 安装依赖
bun install

# 启动开发服务器（vp 为 vite 别名脚本，见 package.json scripts）
bun run vp
# 或
bun run dev

# 生产构建 / 预览
bun run build
bun run preview

# 类型检查
bun run typecheck
```

启动后访问 <http://localhost:3000>。首次打开会自动加载内置演示数据（3 个分类 / 13 张表 / 10 条导航 / 5 个字典 / 4 个代码模板）。

## 功能总览

### 画布（模型编辑器）

- **无限画布**：左键拖拽空白处框选（整卡完全被框住才选中，仅交叉不选中；`Ctrl/Shift` 追加）、中键或 `空格+左键` 拖拽平移、滚轮以光标为中心缩放（25% ~ 500%）
- **网格**：间距随缩放联动，线宽恒定 1px 不随缩放变化
- **小地图**：右下角缩略图，点击/拖拽快速定位视口
- **表卡片**：表名/注释/中间表图标 + 字段列表（默认折叠 6 个）+ 索引（默认隐藏）+ 隐藏导航摘要
- **导航线段**：一对一 `-1----1-`、一对多 `-1----N-`、多对一 `-N----1-`、多对多 `-N----N-`；悬停/选中均为实线（悬停较细且半透明，选中加粗 + 光晕，二者可区分）、悬停提示单行展示「属性 ⇄ 属性（关系说明）」、双击编辑、右键菜单
- **卡片 ⇄ 导航线联动**：悬停卡片时其关联导航线（含 NN 经由的中间表）联动切换到悬停风格；选中卡片（单选/多选/框选）时关联线联动切换到选中风格（加粗 + 光晕）；表选中与线段选中互斥，画布同一时刻只有一种选中焦点
- **悬停/选中过渡**：卡片阴影、连接点淡入缩放、隐藏按钮淡入、导航线颜色/粗细/光晕、标记描边、NN 胶囊、右键菜单弹出等全部带平滑过渡动画
- **多对多中间表**：默认完全隐藏，线上显示 `中间表名 +` 胶囊，点击展开（若中间表落在当前视口外，画布会平滑滚动将其带入视野，保证展开后一定看得见）；左侧大纲眼睛恢复显示同样带视野保障；对中间表执行隐藏则彻底隐藏（非透明）
- **任一端表隐藏**：导航线不渲染，改为在可见端卡片底部显示「隐藏导航摘要」（类型 + 关联表名）
- **自动美化**：工具栏「魔法棒」按钮 / 空白右键菜单「自动美化布局」，以导航关系为边做力导向布局自动规划每个表卡片的位置（相关联的表彼此靠近、孤立表散开不重叠，结果按 20px 网格对齐），卡片平滑滑动到新位置并自动适应画布
- **对齐与分布**：选中 ≥ 2 张表后，卡片右键 / 空白右键菜单出现「对齐与分布」分组——左对齐/右对齐/顶部对齐/底部对齐（边缘对齐）、水平对齐/垂直对齐（中心线对齐）、水平/垂直均匀分布（首尾不动等间距，需 ≥ 3 张）
- **拖拽创建导航**：卡片上下左右四个连接点拖至目标表；两表间已有导航时丢弃并提示
- **右键菜单**：卡片（编辑/复制/隐藏/对齐分布/删除）、线段（编辑/删除）、空白（新增表/粘贴/自动美化/适应画布/重置缩放/对齐分布）
- **快捷键**：`Ctrl+Z` 撤销、`Ctrl+Shift+Z` / `Ctrl+Y` 重做、`Ctrl+C` 复制、`Ctrl+V` 粘贴、`Delete` 删除选中表、`Esc` 取消选择

### 左侧表格大纲

- 分类树（名称 / 包路径 / 表数量），选中高亮、可折叠、支持增删改
- 表名点击 → 画布卡片联动高亮并平滑居中；画布卡片点击 → 大纲联动高亮
- 隐藏表在大纲中以闭眼图标标识，可一键显示/隐藏

### 编辑对话框

- **表编辑**：双击卡片/大纲表名或右键菜单触发；字段（增删改/拖拽手柄排序/类型自动映射 Java 类型/字典关联）、索引（UNIQUE/NORMAL/FULLTEXT）、导航列表（跳转编辑/删除）
- **导航编辑**：四种类型、两端关联属性、属性名、级联操作（自动/无动作/删除/设为Null，双向独立配置）、NN 中间表（自动创建或选择已有表）、一键反转方向
- **从数据库导入**：`GET /api/codegen/table/queryFromDB` 模拟真实库表结构，勾选导入；字段 Java 类型默认值由「系统设置 → 列默认类型」规则依序正则匹配推导（悬停可预览各字段推导结果），未命中回退内置类型映射

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
- **代码替换**：同上范围 → 弹出确认（含文件清单）→ 调用 `multipart/form-data /api/codegen/replace` 上传 zip

模板内置变量与工具：

```ts
interface TemplateContext {
  templateName: string    // 模板名称
  templateContent: string // 模板内容
  result?: string         // 生成结果
  basePackage: string     // 基础包名（表所属分类）
  fileName: string        // 文件名（模板内赋值）
  filePath: string        // 文件路径（模板内赋值）
  language?: string       // 显式指定预览高亮语言（模板内赋值，如 <% context.language = 'java' %>）
  table: TableVO          // 当前表（columns/indexes/navigates）
}
```

> 预览/代码生成结果的高亮语言：`context.language` 显式指定优先（如 `java` / `sql` / `xml` / `javascript`），未设置时按产物文件名后缀自动识别，工具栏语言徽标实时显示实际生效语言。

| 工具 | 说明 |
| --- | --- |
| `utils.toCamelCase(str, firstLetterLowerCase?)` | 转驼峰 |
| `utils.toSnakeCase(str)` | 转蛇形 |
| `utils.getJavaType(column)` | 数据库类型映射 Java 类型 |
| `utils.quote(content, condition?)` | 引号包裹 |
| `utils.wrap(content, condition?)` | 括号包裹 |
| `utils.isEmpty(str)` / `utils.isBlank(str)` | 判空 / 判空白 |

Eta 语法：`<% %>` 逻辑、`<%= %>` 输出、`<%# %>` 自定义注释标签（渲染前剥离）。模板内可直接访问 `context` 与 `utils` 顶层标识（`useWith` 模式）。

内置 4 个模板：`entity`（Java 实体）、`dao`、`service`、`sql`（建表 DDL），可在「模板管理」中自由修改与新增。

### 系统设置

- **列默认类型**：从数据库导入时的 Java 类型默认映射。对字段的数据库类型（如 `VARCHAR(255)`、`Decimal(6, 4)`）按规则列表**自上而下依次**进行正则表达式匹配（忽略大小写），取**第一条命中**规则的 Java 类型作为默认值；全部未命中时回退内置类型映射表
- 可选 Java 类型：`Character` / `String` / `Long` / `Integer` / `Float` / `Double` / `BigDecimal` / `LocalDateTime` / `LocalDate` / `LocalTime` / `Timestamp`
- 规则顺序即优先级，拖拽手柄调整；非法正则即时标红并禁用保存；内置「规则测试」输入任意数据库类型实时预览命中结果（含未保存修改，区分「生效/命中被抢先」）
- 设置保存后持久化（mock 接口 + localStorage）

### 主题

- 全部颜色/间距/圆角/阴影通过 CSS 变量定义（`src/styles/variables.scss`），可在外部覆盖定制主题
- 顶栏按钮切换亮色/暗色，同步根元素 `data-theme`，CSS 变量与 antdv-next 主题算法自动切换，偏好持久化

## Mock API

当前无后端对接，全部接口通过 Axios 自定义 adapter 转发至内存 Mock 并持久化到 `localStorage`（对接真实后端时删除 `src/api/http.ts` 中的 `adapter` 即可）：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/codegen/category/query` | 查询所有分类 |
| POST | `/api/codegen/category/add` | 添加分类 |
| POST | `/api/codegen/category/update` | 更新分类 |
| POST | `/api/codegen/category/remove` | 删除分类 |
| GET | `/api/codegen/table/queryFromDB` | 从真实数据库查询数据（mock 模拟） |
| GET | `/api/codegen/table/query` | 查询表信息（`categoryId` 精确 / `tableName` 模糊，可选），返回 `TableVO` 列表 |
| POST | `/api/codegen/table/add` | 添加表 |
| POST | `/api/codegen/table/update` | 更新表（载荷附 `rawNavigates`：该表参与的原始导航，替换语义） |
| POST | `/api/codegen/table/remove` | 删除表（级联清理字段/索引/导航） |
| POST (multipart) | `/api/codegen/replace` | 上传 zip 替换代码文件（需确认后调用） |

> 规范未定义字典/模板/设置接口，Mock 按相同 REST 风格扩展了 `/api/codegen/dict/*`、`/api/codegen/template/*` 与 `/api/codegen/settings/*`（`src/mock/db.ts` 有注明）。数据重置：左下大纲面板「重置演示数据」按钮。

```bash
GET  /api/codegen/settings/query    # 查询应用设置
POST /api/codegen/settings/update   # 更新设置（列默认类型规则，正则合法性校验）
```

## 项目结构

```
├─ index.html
├─ vite.config.ts          # Vite 8 配置（@ 别名 / 端口 3000）
├─ tsconfig.json
├─ docs/screenshots/       # 界面截图
├─ scripts/                # 开发辅助脚本（Eta 冒烟测试 / 快照 / patch / 打包）
├─ snapshot/               # 源码快照存档（scripts/snapshot.sh 生成，gitignore）
├─ patch/                  # 修改补丁存档（scripts/patch.sh 生成，gitignore）
└─ src/
   ├─ main.ts              # 入口（注册 Pinia / antdv-next / 主题）
   ├─ App.vue              # v-if 页面切换 + ConfigProvider 暗色算法
   ├─ api/                 # axios 实例（mock adapter）+ 接口模块
   ├─ composables/         # useDragSort 行拖拽排序（字段/设置规则共用）
   ├─ mock/                # 种子数据 + Mock 数据库（localStorage 持久化）
   ├─ stores/              # Pinia：model / canvas / dict / template / theme / ui / history / settings
   ├─ types/               # 数据模型类型（与规格说明书一致）
   ├─ utils/               # 字符串 / Java 类型映射 / 导航推导 / 几何 / 力导向布局 / Eta 渲染 / 高亮
   ├─ styles/              # CSS 变量（亮暗双主题）/ 全局样式 / hljs 配色
   ├─ views/               # EditorView / DictView / TemplateView / SettingsView
   └─ components/
      ├─ layout/           # AppHeader
      ├─ outline/          # 左侧表格大纲
      ├─ canvas/           # ModelCanvas / TableCard / NavigateEdge / Minimap / 菜单 / 工具栏
      └─ dialog/           # 表/导航/分类/导入/代码预览/替换确认 对话框
```

## 非功能说明

- 画布渲染带视口裁剪（仅渲染可视区附近卡片），支持 100+ 表卡片流畅操作
- 兼容最新版 Chrome / Edge / Firefox
- 撤销/重做基于模型快照（上限 50 步），恢复后经 API 差量同步 Mock

## 界面截图

| 亮色编辑器 | 暗色编辑器 |
| --- | --- |
| ![亮色](docs/screenshots/editor-final-light.png) | ![暗色](docs/screenshots/editor-dark.png) |

| 自动美化布局（力导向） | 对齐与分布右键菜单 |
| --- | --- |
| ![自动美化](docs/screenshots/auto-layout.png) | ![对齐菜单](docs/screenshots/align-context-menu.png) |

| 表编辑对话框（拖拽手柄排序） | 系统设置 · 列默认类型 |
| --- | --- |
| ![表编辑](docs/screenshots/table-columns-drag-handle.png) | ![设置](docs/screenshots/settings-column-rules.png) |

| 模板管理（实时预览） |
| --- |
| ![模板](docs/screenshots/template-view-fixed.png) |

## 源码快照与修改补丁

开发过程中可在任意时点留档：

```bash
bash scripts/snapshot.sh   # 快照当前源码到 snapshot/[年月日时分秒].zip
bash scripts/patch.sh      # 保存当前修改的 patch 到 patch/[年月日时分秒].patch
```

`patch/` 中的补丁为 git 工作区相对最近一次提交的源码 diff（新增源文件以 intent-to-add 纳入），可用 `git apply patch/xxx.patch` 复现改动。`snapshot/` 与 `patch/` 已加入 `.gitignore`，不会影响版本管理与源码打包。
