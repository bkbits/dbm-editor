# 工作日志

---
Task ID: 15
Agent: main (Super Z)
Task: 去除 Pinia（改为 DBManagerView 注入全局状态）+ vite 构建改为库模式（仅产出 DBManager.js / DBManager.d.ts，vue/antdv-next/@lucide/vue 外部化）+ 提交推送

Work Log:
- 改前快照：snapshot/20260911161316.zip（133 文件）
- **状态注入体系（替代 Pinia）**：src/stores/context.ts 新增——DBManagerState（theme/ui/settings/dict/template/history/model/canvas 八仓库）+ DBMANAGER_STATE_KEY 注入键 + createDBManagerState(getApi) 工厂（template/history/model 相互引用经「先声明后回填 + 惰性取值函数」解耦）+ useDBManagerContext()（子树外调用抛中文错误）
- 八个仓库全部由 defineStore 改写为 createXxxStore(deps) 工厂返回 reactive 对象：state 字段直置、getter 改访问器（get x()，getter 函数返回闭包）、action 为方法（this=proxy 语义保持）、跨仓库引用改 deps.getXxx()（与原先 action 内 useXxxStore() 运行时取用等价）、getManagerApi() 全部改 deps.getApi()；useXxxStore() 函数名保持不变（子组件调用面零改动，仅注入来源从 Pinia 换成 context）；settings 的 initInFlight 在途 Promise 移入工厂闭包（实例级）；model.resetDemoData 的动态 import 解环改依赖直取
- api/manager-api.ts：删除全局激活实例机制（setActiveApi/getManagerApi/activeApiRef）——store 经工厂 getApi() 读 api；useManagerApi 兜底改 sharedDemoApi
- DBManagerView.vue：setup 中 createDBManagerState(() => apiRef.value) + provide(DBMANAGER_STATE_KEY)；theme.init() 移入（同步早于首帧渲染，无闪烁）；api 切换重载逻辑改用 state.* ；新增 import '@/styles/index.scss'（库样式自包含）；main.ts 移除 createPinia 与 useThemeStore 预初始化
- package.json：删除 pinia 依赖；vue/antdv-next/@lucide/vue 移至 peerDependencies（devDependencies 保留供演示工作区）；新增 main/module/types/exports/files 库字段；build 脚本改「vp build && node scripts/inline-lib-css.mjs」
- **库模式构建**（vite.config.ts）：build.lib（entry=src/index.ts、formats=['es']、fileName=()=>'DBManager.js'）+ rollupOptions.external 正则（vue|antdv-next|@lucide/vue 及其子路径）+ copyPublicDir:false（favicon 不入产物）；插件：vite-plugin-dts 5.1.0（entryRoot:'src'、outDirs:['dist']、bundleTypes:true——v5 选项名 rollupTypes→bundleTypes、outDir→outDirs，@microsoft/api-extractor 需显式安装）+ vite-plugin-lib-inject-css
- src/index.ts 新建库入口：export default DBManagerView + export type * from types/model
- **rolldown 坑**：vite-plus-core 底座为 rolldown，libInjectCss 未生效（CSS 独立成 dist/index.css 且 JS 中保留 import './index.css'）→ 新建 scripts/inline-lib-css.mjs 后处理：读 index.css → JSON.stringify 转义 → 替换 import 语句为运行时 <style data-dbmanager> 注入代码 → 删除 css 文件 → dist 白名单清理（仅保留 DBManager.js/.d.ts）；d.ts 的 api-extractor 滚动合并正常后产物收敛为单一文件
- 验证：
  * bun run typecheck 通过；vp check --fix 通过（51 文件 0 告警）；check-readme.py 通过（30 标题）
  * vp build：dist 仅 DBManager.js（422.8KB，CSS 内联后 474KB）+ DBManager.d.ts（10.4KB，导出 DBManagerView DefineComponent + ManagerApi + 全部 DTO 类型）；JS 外部引用仅 vue/antdv-next/@lucide/vue 三项（grep 验证）；无 vue 运行时内联
  * Node 直连加载 dist/DBManager.js 因 antdv-next 的 dayjs 子路径无扩展名导入失败——属 Node ESM 严格解析限制，宿主打包器（vite/webpack）环境无此问题，改用真实浏览器验证
  * **宿主冒烟**（test/host-smoke.html + host-smoke-main.ts，test/ 已 gitignore）：宿主页 createApp(h(DBManagerView)).use(Antd) 直连 dist/DBManager.js——10 卡片渲染、theme=light、<style data-dbmanager> 内联样式存在、Ctrl+A 全选 10 张、0 页面错误；截图 docs/screenshots/host-smoke-lib.png
  * **演示应用全量回归**（agent-browser 1920×1080）：启动 getSettings/load 日志成对、10 卡片/10 导航线；Ctrl+A→10 选中、Ctrl+D→0；多选拖拽 updateTablePos 仅 1 次（批量契约保持）；Ctrl+Z 撤销（updateTable diff 同步）、Ctrl+S save+「所有修改已保存」；主题切换 dark/light；字典页（getDicts 5 字典）/模板页（getTemplates 4 模板）/设置页渲染；双击卡片表编辑对话框打开；全程 0 页面错误
- README 同步：技术栈表（状态管理=reactive+provide/inject 无 Pinia）、命令速查（build=库构建两文件）、新增「库构建与宿主接入」章节（产物表/构建配置要点/宿主接入示例/peer 依赖说明）、注入链路重写、项目结构（src/index.ts、stores/context、styles 内联说明）、目录锚点、截图表新增宿主冒烟行（自检脚本表格串块特性需文字行隔离单列表格）
- 留档：patch/20260911163351.patch（17 文件 76K）；download/graph-db-model-editor.zip（122 文件 5.6M）

Stage Summary:
- Pinia 完全移除（依赖、注册、全部 8 仓库）——状态为 DBManagerView 实例级注入（reactive 工厂 + provide/inject），useXxxStore() 调用面零改动；库组件可在同一宿主页面多实例共存且状态互不串扰
- vite 构建改为库模式：产物仅 dist/DBManager.js（ES 单文件、样式内联、三个 UI 框架依赖外部化）+ dist/DBManager.d.ts（单一滚动声明）；宿主冒烟页验证外部解析与样式注入可用
- 关键决策：① rolldown 底座 libInjectCss 失效 → 自写 inline-lib-css.mjs 等效内联 + 白名单清理；② vite-plugin-dts v5 选项更名（bundleTypes/outDirs）+ api-extractor 显式安装；③ CSS 随库内联（含 body 级基础样式）换取宿主零配置外观一致
- 交付物：dist/DBManager.js + dist/DBManager.d.ts、patch/20260911163351.patch、download/graph-db-model-editor.zip、截图 docs/screenshots/host-smoke-lib.png
- 本次修改已提交并推送 GitHub（bkbits/dbm-editor main）

---
Task ID: 14
Agent: main (Super Z)
Task: 配置 GitHub 远程仓库（bkbits/dbm-editor）+ 历史规整 + 建立任务完成即提交推送的约定

Work Log:
- 用户提供 GitHub PAT 与仓库地址 → `git remote add origin`（凭据嵌入远程 URL，仅存 .git/config，未写入任何被跟踪文件；worklog/README 均不含 token）
- 推送前审计：远程仓库为空（ls-remote 无 refs，可安全重写本地历史）；tracked 文件中发现会话产物（tool-results/ 8 个文件、download/README.md）与初始提交遗留 .env（仅本地路径 DATABASE_URL，无凭据）——均不应出现在公开仓库
- 历史规整（scripts/rewrite-git-history.sh，一次性脚本，已入 .git/info/exclude 本地忽略）：git filter-branch 三合一——① 15 个提交信息由 UUID 改写为 conventional commits 中文任务描述（映射自 worklog 各 Task 标题：feat 需求全量实现 / fix 交互缺陷 / feat 自动美化与对齐分布 / refactor DBManagerView 封装 / feat 细粒度契约 + vite-plus 迁移 / feat Logger / docs README / feat 批量 updateTablePos + 快捷键 / refactor 全异步化等）；② index-filter 从全部历史移除 tool-results/、download/README.md、.env（download/README.md 由 package.sh 每次打包重新生成，无损失）；③ env-filter 作者/提交者统一 dbm-editor-agent \<agent@dbm-editor.dev\>；refs/original 清理 + reflog expire + gc --prune=now
- .gitignore 末尾新增 tool-results/（与 snapshot/、patch/、download/ 同类会话产物）；git config user.name/email 设置为 dbm-editor-agent（本地 config，后续提交沿用）
- AGENTS.md 新增「Git 提交与推送约定」章节：每个任务完成并通过校验（bun run typecheck + vp check）后必须提交并推送、conventional commits 中文信息格式、会话产物不入库、凭据安全约束
- 提交 20051f7「chore: GitHub 远程发布准备（忽略会话产物 tool-results/）」（pre-commit vp staged 检查通过）→ `git push -u origin main` 成功（新分支 main，15+1=16 提交全量推送）；ls-remote 复核远程 HEAD=20051f7 与本地一致、main 已跟踪 origin/main
- 历史规整后快速回归：git status 干净、git ls-files 无 tool-results/download/.env 残留、工作区源码未受影响（zip 等未跟踪产物保留）

Stage Summary:
- 项目已发布至 GitHub：https://github.com/bkbits/dbm-editor（main 分支，16 提交，提交历史可读——每任务一条 conventional commit）
- 关键决策：① 远程为空时本地历史可安全重写（UUID 信息对公开仓库不可读，按 worklog 任务映射改写）；② 会话产物（tool-results/download//.env）从历史彻底移除而非仅停止跟踪，保证公开仓库整洁；③ 推送约定写入 AGENTS.md 使后续会话自动遵循
- 约定落地：此后每个任务完成 → 校验（typecheck + vp check）→ conventional commit → git push（含本条 worklog 与 AGENTS.md 更新的提交）

---
Task ID: 9
Agent: main (Super Z)
Task: ManagerApi 对齐用户原型（细粒度 CRUD 契约）+ Table.hidden 数据化 + vite-plus 迁移（vp dev）+ 依赖全量升级

Work Log:
- 修改前快照：snapshot/20260911035806.zip（113 文件）
- web-search 调研 vite-plus：Vite+（viteplus.dev，VoidZero）统一工具链 = 全局 `vp` CLI + 项目本地 `vite-plus` 包；curl -fsSL https://vite.plus | bash 安装 vp v0.3.1（VP_NODE_MANAGER=no 跳过接管）；研读 migrate.md / migrate-rules.md 掌握迁移规则
- types/model.ts 对齐用户原型：Table 增加 `hidden?: boolean`；ManagerApi 重写为细粒度契约——save() 无参（仅在「点击保存所有」时调用）、load()（初次进入 + 点击刷新）、新增分类组（getCategories/addCategory/updateCategory/removeCategory）、表组（getTables/addTable/updateTable/removeTable 级联删字段索引导航/updateTablePos 拖拽结束保存）、导航组（getNavigates/addNavigate/updateNavigate/removeNavigate）；其余类型逐字段比对与原型一致
- DemoManagerApi 重写实现新契约：细粒度方法即时写库 + persistDB；save() 无参 = persistDB（内存即真相）；校验逻辑从原全量 save 迁移到各方法（表名/字段名/索引名唯一、分类存在、导航 self/target/mappingTable 引用与 type 枚举、分类下有表时 removeCategory 拒绝）；normalizeColumns/normalizeIndexes/normalizeNavigate 归一辅助 + assembleTables 私有装配
- model store 改造：persist() 全量保存退役 → 每动作「本地先行 → 对应细粒度 api → 失败回滚快照」（saveCategory=add/updateCategory、createTable/pasteTable/importFromDB=addTable、saveTable=updateTable、removeTables=removeTable×n、导航三动作对应、setTableHidden=updateTable）；persistTables(ids) 改走 updateTablePos（拖拽/对齐/自动美化）；新增 saveAll()（api.save）与 refresh()（api.load 重载）；新增 syncToApi() diff 同步（分类补齐 → 表删/加/全量更 → 导航基于最新持久层 diff → 分类删除收尾）供撤销/重做 restore 使用；managerTableOf() 组装完整表
- hidden 数据化（Table.hidden）：seed.ts 三张中间表加 hidden: true + SEED_HIDDEN_TABLES 退役为 SEED_HIDDEN_TABLE_NAMES（名字集合）；db.ts loadDB 对旧数据补 hidden（优先读旧 gdbme:hidden 键迁移并清除，否则按种子表名补齐，随即归一落盘）；canvas store 的 hiddenTableIds 从 state+localStorage 改为 getter（model.tables 派生），hideTable/showTable/toggleHiddenTable 调 model.setTableHidden（fire-and-forget + catch 提示），persistHidden/resetHidden/loadHidden/HIDDEN_KEY 全部删除；DBManagerView api 切换与 OutlinePanel 重置演示的 resetHidden 调用移除（hidden 随模型数据恢复）
- AppHeader：编辑器页新增「保存所有」（SaveAll 图标，走 api.save() + toast）与「刷新」（RefreshCw 图标，走 api.load() 重载 + history.clear + toast，加载中禁用 + 旋转动画）两个按钮
- vite-plus 迁移：vp migrate --no-interactive（自动安装依赖 + 重写 vite.config.ts 导入为 vite-plus/lazyPlugins + scripts 改 vp 命令面 + git hooks + AGENTS.md）；package.json 最终形态：vite → npm:@voidzero-dev/vite-plus-core@0.3.1 + vite-plus 0.3.1 + overrides + devEngines(bun 1.4.2)；scripts 精简（dev=vp dev、build=vp build、preview=vp preview、prepare=vp config，删除无意义 vp 别名）
- vite.config.ts：server.allowedHosts: true（Host 头实测 custom-domain.test / preview-*.space-z.ai 均 200）；optimizeDeps.entries=['index.html'] 消除 skills/ 目录 html 参考文件卷入依赖扫描的 three 报错；fmt 块 singleQuote+semi:false（保持项目既有风格）+ ignorePatterns 排除非源码目录；lint 关闭 typeAware（受限环境 oxc 分配器 panic）且不挂 vite-plus/oxlint-plugin（jsPlugins 装载即崩，纯 oxlint 规则正常）
- 依赖升级：vp update --latest → @lucide/vue 1.44.0、antdv-next 1.5.4、jszip 3.10.2（+31 个传递依赖）；typescript --latest 到 7.0.2 与 vue-tsc 3.3.11 不兼容（ERR_PACKAGE_PATH_NOT_EXPORTED ./lib/tsc，TS7 为原生实现移除 JS API）回退 ~5.9.3（5.x 最新）
- oxfmt 全量格式化（51 文件）+ 4 个 lint 警告清零（canvas.ts onPointerUp e→_e、db.ts 移除未用 SEED_DB_TABLES 导入、seed.ts 移除未用 TableIndex 导入、NavigateEdge isRelatedSelected 去掉冗余 sel.length>0 前置）；**oxfmt 重大坑**：格式化把两处 Vue 模板内联多语句 `@click="a(); b()"` 折行删分号 → Vue 编译报错页面白屏（TableCard 隐藏导航行 / OutlinePanel 眼睛按钮），修复为组件方法 revealHiddenNav(otherId)/revealTable(tableId) 单语句调用（根本解决，fmt 幂等稳定）
- package.sh 修复两处：新增排除 tool-results/.vite-hooks/.env(.*)；zip 增量更新模式导致已删除文件残留（.env 曾留包内）→ 打包前 rm -f OUT 重建
- 验证（agent-browser 1920×1080 真实输入 + vp dev dev server）：
  * vp dev 3000 端口干净启动（无依赖扫描警告）、allowedHosts 自定义 Host 200、HMR 正常（hot updated: index.scss）
  * 初始：10 卡片/10 导航线/3 NN 胶囊/顶栏三个按钮（保存所有/刷新/主题）、控制台 0 错误
  * 拖拽 sys_user（真实 mouse down/move/up）→ updateTablePos 持久化（世界坐标 208.35/228.35 与 zoom≈0.74 换算吻合）→ Ctrl+Z 回 60/80 → Ctrl+Y 恢复 208/228（diff 同步双向）
  * NN 胶囊点击 → sys_user_role 显示 + Table.hidden=false 持久化；大纲眼睛真实点击 → 同链路
  * 保存所有 → toast「所有修改已保存」；刷新 → 11 卡片（sys_user_role 可见态从 db 恢复）+ toast「模型已刷新」+ 位置保持
  * 表编辑（合成 dblclick 打开）改注释保存 → db comment 更新 + toast；右键新增表 t_fine_grained_verify → addTable 持久化（id 客户端生成/hidden:false/默认 id 字段/14 张表）→ 真实点击选中 + Delete 确认删除 → 13 张表 → Ctrl+Z 撤销删除 → 表+字段完整恢复（syncToApi add 分支）
  * 重置演示数据 → 13 表/hidden 三张中间表/注释与位置全部还原种子/10 导航/14 规则
  * 数据库导入（真实点击 checkbox + 导入所选）→ t_blog 创建（5 字段 1 索引）
  * 双击导航线（合成 dblclick → .edge-hit）→ 编辑导航改注释保存 → n-user-role comment 更新 + toast
  * 字典页 27 值行、模板页 1387 字符预览正常；格式化修复后全量回归（拖拽/撤销/双击编辑）通过；亮暗双主题截图
- vp check 全绿（55 文件格式正确 + 47 文件 0 lint 警告）；vue-tsc 通过；vp build 通过（2.67s）
- patch 留档：patch/20260911042229.patch（38 文件 160K）；打包 download/graph-db-model-editor.zip（110 文件 5.0M，无 .env/tool-results/.vite-hooks/skills 泄漏）
- README 更新：技术栈表 Vite+（vp CLI）；快速开始改 vp 全局安装 + vp dev/vp build/vp check；ManagerApi 接口清单表重写（细粒度契约 + load/save 语义注释）；注入链路描述改细粒度 + syncToApi；保存所有/刷新按钮说明；hidden 随模型持久化说明；非功能说明改 diff 同步

Stage Summary:
- 五项需求全部完成并经真实浏览器验证：ManagerApi 对齐用户原型（24 方法细粒度契约，save 无参 + load/save 语义落地）、Table.hidden 数据化（画布/大纲/胶囊/持久化/迁移全链路）、vite.config.ts allowedHosts:true、依赖全量升级（typescript 因 vue-tsc 兼容性保持 5.9.3 最新 5.x）、项目迁移 vite-plus（vp dev 可启动且全链路验证）
- 关键决策：撤销/重做的恢复同步走 syncToApi diff（先分类补齐→表删加改→导航最新态 diff→分类删除收尾，表不做内容比较防漏同步）而非无参 save（持久层无从感知本地状态）；oxfmt semi:false 与 Vue 模板多语句内联冲突 → 改组件方法单语句（不用 ignore hack）；vp lint 的 jsPlugins/typeAware 在受限环境触发 oxc 分配器 panic → 退纯 oxlint 规则 + vue-tsc 承担类型检查；TS7 原生化不兼容 vue-tsc 暂留 5.9.x
- 交付物：snapshot/20260911035806.zip（改前快照）、patch/20260911042229.patch（本次改动）、download/graph-db-model-editor.zip（110 文件）+ download/README.md
- 截图：docs/screenshots/vp-dev-fine-grained(.|-dark).png

---
Task ID: 5
Agent: main (Super Z)
Task: 快照/patch 留档 + TemplateContext.language + 字典页签切换修复 + 框选完全包含 + 导航线悬停单行提示 + 自动美化布局 + 右键对齐分布菜单

Work Log:
- 修改前快照：scripts/snapshot.sh → snapshot/20260909083424.zip（94 文件）；.gitignore 新增 snapshot/、patch/
- TemplateContext.language：types 增 language?: string；render.ts 初始化空串并在渲染后随 fileName/filePath 一并回读（模板内 `<% context.language = 'java' %>` 赋值）；highlight.ts 新增 resolveLanguage(fileName, language?)（显式优先、回退后缀识别）；CodePreviewModal/TemplateView 预览高亮全部改用 resolveLanguage 并新增语言徽标 chip；模板帮助面板补充 context.language 文档
- 字典页签切换修复：DictView 的 watch(selectedId) 加 immediate —— 页面 v-if 卸载重挂后 selectedId 来自 store 不变、普通 watch 不触发，draft 停留空草稿导致「暂无字典值」；挂载即同步恢复
- 框选完全包含：geometry 新增 rectContains(outer, inner)；canvas.onPointerUp select 分支由 rectsIntersect 改为 rectContains(worldRect, card)（整卡完全被框住才选中）；顺带修复 cardRectsOf 与 id 序号错位隐患（新增 cardRectOf(id) 单卡查询）
- beginSelect 即刻捕获指针：修复框选拖拽首个 move 出画布时选框卡在起点的问题（延迟捕获对 select 不必要——空白画布无 click/dblclick 目标语义；卡片/连线的延迟捕获保留不动）
- 导航线悬停提示改单行：去掉第一行（表名+基数线型），仅保留 `属性 ⇄ 属性（关系说明）`，关系说明（如（多对多））置于末尾；提示框 38px→26px、宽度按单行计算；清理无用的 selfTable/targetTable
- 自动美化（src/utils/layout.ts 新增）：FR 力导向（点对斥力 k²/d + 2.2k 截断、边弹簧 FR 二次引力 d²/k 钳 5k、质心重力 0.08、温度冷却至 2%）+ 初值过大时等比缩入虚拟画布 + 按卡片实际尺寸去重叠（30 轮沿小穿透轴推开至最小间距）+ 20px 网格对齐归一化到 (40,40)；NN 且中间表可见时布局边拆为 self↔中间表↔target 两段；调参两轮（初版重力 0.03/线性弹簧导致整体膨胀至 9000px+，改截断+FR 二次引力后 10 表收敛 2828×3141、0 可见重叠、关联表间距 ~650-860）
- canvas store：autoLayout()/alignSelection(mode) 动作（AlignMode 8 种；历史快照捕获 + persistTables 持久化 + layoutAnimating 标记 500ms）；布局中开始拖拽立即终止过渡
- 对齐/分布右键菜单：CanvasContextMenu 增 MenuItem.header 分组小标题渲染分支 + 8 个 lucide 图标（AlignStartHorizontal/CenterHorizontal/EndHorizontal/StartVertical/CenterVertical/EndVertical/HorizontalDistributeCenter/VerticalDistributeCenter）；选中 ≥2 张时卡片菜单与空白菜单均追加「对齐与分布」分组（均匀分布需 ≥3，不足禁用 + title 提示）；菜单垂直裁剪改按 items 估算高度动态计算；空白菜单新增「自动美化布局」(WandSparkles)，工具栏缩放组同步新增魔法棒按钮
- 位置过渡动画：TableCard 增 layout-animating 类（left/top 0.46s cubic-bezier 过渡），ModelCanvas 视口裁剪在动画期间放宽 margin 400→2400 防止滑动途中被卸载
- patch 留档：scripts/patch.sh（git add -N src/ 与新脚本后 git diff）→ patch/20260909085822.patch（19 文件 52K）；package.sh 排除 snapshot/patch 后重新打包（102 文件 3.3M）
- 验证（agent-browser 真实输入事件）：
  * 框选：部分交叉 sys_user 角落 → 0 选中；完全包含 → 选中；含出画布终点的快速框选（捕获修复后）→ 3 张正确选中
  * 自动美化：10 可见表布局后 0 可见重叠（唯一重叠对为隐藏中间表与 sys_role，不可见无影响）、关联表间距合理、位置持久化 localStorage、卡片 layout-animating 过渡类出现并于 500ms 后移除
  * 对齐：选中 3 张 → 左对齐 x 全等 1000；垂直均匀分布中间卡 y=787（等间距 486 精确符合公式）；卡片右键与空白右键均出现 8 项分组；Ctrl+Z 两次还原布局
  * 导航线悬停（亮/暗双主题）：tooltip 单行「user ⇄ articles（多对一）」、rect 高 26、仅 1 个 text
  * 字典：选 user_type（3 值）→ 切模板页 → 切回：选中与 3 值全部恢复、无「暂无字典值」空态
  * language：sql 模板徽标 sql（后缀自动）；注入 `<% context.language = 'javascript' %>` 后徽标 javascript 且产物按 JS grammar 着色（72 token，文件名仍 .sql 证明显式优先）；代码预览弹窗徽标 java（后缀自动）
  * 回归：双击 sys_user → 编辑表对话框、右键菜单项可点击、控制台 0 错误
- vue-tsc 通过；vite build 通过（2.49s）

Stage Summary:
- 八项需求全部完成并经真实浏览器验证；交付物：snapshot/20260909083424.zip（改前快照）、patch/20260909085822.patch（本次全部改动）、download/graph-db-model-editor.zip（102 文件）
- 关键决策：框选语义改「完全包含」并同步修复指针捕获出界卡死；力导向三段式（模拟→去重叠→网格对齐）保证无重叠且贴网格；对齐/分布以 selection 为作用域同时挂在卡片与空白两种右键菜单；TemplateContext.language 走模板内赋值回读（与 fileName/filePath 同机制），展示层统一 resolveLanguage 兜底
- 截图：docs/screenshots/auto-layout(.|-dark).png、align-context-menu.png

---
Task ID: 2
Agent: main (Super Z)
Task: 交互缺陷修复（右键菜单/双击卡片/双击导航线/NN 胶囊点击均无效）+ 新功能（卡片隐藏按钮、树形表选项）

Work Log:
- 根因诊断（四缺陷同源于事件系统）：
  1) 右键菜单：菜单项 pointerdown 冒泡到画布根触发 closeMenu()，菜单被 v-if 卸载，click 落空 → 菜单项永不执行
  2) 双击卡片/线段：beginCardDrag/beginSelect 在 pointerdown 立即 setPointerCapture(rootEl)，浏览器将 click/dblclick 派发到捕获元素（画布根）而非实际点击目标
  3) NN 胶囊：pointer-events 为可继承属性，.edge 设 none 后 .nn-pill 及子元素继承 none 完全无法命中（.edge-hit 因显式 stroke 覆盖不受影响）
- canvas.ts：重构为延迟指针捕获 —— pointerdown 不再立即捕获；onPointerMove 中 pan/connect 首次移动捕获、select/dragCards 超过 3px 阈值才捕获（captureOnce/resetPointerCapture）；无位移单击的 click/dblclick 正常派发到原目标
- ModelCanvas.vue：window 级 pointerup/pointercancel 兜底监听（无捕获时指针在画布外释放不会卡死模式；onPointerUp 幂等早退设计重复调用安全）
- CanvasContextMenu.vue：.ctx-menu 根元素加 @pointerdown.stop（菜单内点击不再冒泡触发画布根 closeMenu/beginSelect）+ @contextmenu.stop.prevent
- NavigateEdge.vue：.nn-pill 加 pointer-events: all 覆盖继承
- TableCard.vue：表头新增隐藏按钮（hover 显示、点击 canvas.hideTable、@pointerdown/.click.stop）；新增树形表标识 GitBranch 图标（title 显示父ID字段）
- 树形表功能贯通：Table 接口加 parentIdColumn?: string（空=非树形）；TableEditDialog 加树形开关（开启自动填 parent_id）+ a-auto-complete 父ID字段（候选为当前字段列表）+ 校验（非空且必须存在于字段列表）；mock add/update 持久化；seed 为 sys_menu/cms_category 标记 parent_id；buildCopyDraft 复制保留；localStorage key 升级 v2（回退种子并清理 v1）
- vue-tsc 类型检查通过；vite build 通过（2.32s）
- agent-browser 真实输入事件端到端验证全部通过：
  * 真实 click 派发目标为卡片内部元素（修复前被捕获偷走到画布根，用事件监听器断言验证）
  * 双击 sys_user → 「编辑表」对话框打开；双击导航线 → 「编辑导航」对话框打开；真实单击线段 → 线段选中
  * 真实右键 → 菜单打开 → 真实点击「编辑表」菜单项 → 菜单关闭且对话框打开（修复前菜单项点击失效）
  * 真实点击 NN 胶囊 → 中间表 sys_user_role 显示、胶囊消失、剩余胶囊数量正确
  * 隐藏按钮真实点击 → 卡片消失且写入 localStorage（隐藏计数与胶囊展开操作一致）
  * 树形开关 → 默认 parent_id 填入 → 校验拦截（无该字段时）→ 补字段后保存成功 → 卡片树形标识出现 → localStorage v2 中 sys_user/sys_menu 均为 parent_id
  * 回归：卡片拖拽（+100/+80 且持久化）、空白框选（选中 2 卡）、大纲眼睛按钮恢复显示、控制台 0 错误 0 警告
- 重新打包 download/graph-db-model-editor.zip（130KB）

Stage Summary:
- 四项交互缺陷全部修复且经真实输入事件验证；两项新功能（隐藏按钮/树形表）完整落地并持久化
- 关键设计决策：延迟指针捕获（位移阈值后才捕获）既保留拖拽/框选的画布外跟踪能力，又保证单击/双击事件派发到真实目标
- 截图存于 docs/screenshots/fixes-verified.png
- 遗留说明：CDP 驱动的合成双击无法触发浏览器 dblclick 合成（clickCount 限制），dblclick 已通过"真实 click 派发目标验证 + 合成 dblclick 处理器链路验证"双重佐证

---
Task ID: 1
Agent: main (Super Z)
Task: 图形数据库模型编辑工具 —— 需求规格说明书全量实现（Vue 3 + Vite + Bun + antdv-next）

Work Log:
- 加载 fullstack-dev 技能；因用户明确指定 Vue3+Vite+bun 技术栈，按用户规格覆盖默认 Next.js 栈
- 运行 fullstack 初始化脚本获得 .zscripts dev-server 基础设施与 Caddyfile 网关（81→3000）
- 验证依赖可用性：antdv-next@1.5.3、@lucide/vue@1.42.0、eta@4.6、pinia@4.0.3、vite@8.2.2、vue@3.5.42、sass、jszip、highlight.js、axios（全部最新版）
- Eta v4 冒烟测试通过：renderString + useWith + 副作用赋值 + autoEscape=false + <%# %> 注释正则剥离；autoTrim 会破坏代码换行，改用 autoTrim:false + 输出后处理
- 清退 Next.js 脚手架，建立 Vue3 工程（package.json 含 vp 启动脚本别名）
- 实现类型层（src/types/model.ts，与规格数据模型一致 + mock 扩展字段 rawNavigates）
- 实现工具层：字符串驼峰/蛇形、quote/wrap/isEmpty/isBlank、Java 类型映射、导航类型翻转/反转/单向视图构建、画布几何（贝塞尔/锚点/矩形求交/自环）
- 实现 Mock 层：13 表种子数据（系统/内容/商城三分类、NN 中间表、字典、4 个 Eta 模板、模拟真实库 5 表）；内存 DB + localStorage 持久化；规格 9 个接口 + 字典/模板扩展接口；axios 自定义 adapter
- 实现 Pinia 七仓库：model（CRUD/导航替换语义/复制粘贴/DB导入/快照恢复）、canvas（平移缩放/交互状态机/框选/连线/剪贴板/小地图）、dict、template（渲染/zip/替换）、theme、ui（v-if 页面与对话框）、history（快照撤销重做 + API 差量同步）
- 实现主题系统：CSS 变量亮暗双套（--cat-0..7 分类配色）、data-theme 切换、antdv-next darkAlgorithm
- 实现画布组件：ModelCanvas（网格 canvas 2D 绘制、滚轮缩放、键盘）、TableCard（字段折叠 6 个/索引/隐藏导航摘要/四向连接点）、NavigateEdge（四种线型标记、NN 中间表胶囊、悬停提示、路径经由可见中间表）、Minimap（点击拖拽定位）、右键菜单（卡/线/空白三态）、连接草稿线、工具栏
- 实现左侧大纲：分类树（高亮/折叠/增删改）、表名联动选中并平滑居中、隐藏表眼睛切换
- 实现六对话框：表编辑（字段/索引/导航三页签）、导航编辑（类型/级联/中间表自动创建/反转）、分类编辑、数据库导入、代码预览（模板标签页+hljs）、代码替换确认
- 实现 DictView（值类型颜色/自定义颜色/值级模糊搜索+自动跳转高亮）、TemplateView（列表+实时编辑预览+语法帮助）
- vue-tsc 类型检查修复 4 类错误；vite build 修复数字开头类名 SCSS 错误

Stage Summary:
- 构建与类型检查全绿；dev server 运行于 3000 端口（.zscripts/dev.sh 已适配 Vue 工程，移除 prisma 步骤）
- Agent Browser 端到端验证通过：三页面切换零错误、大纲↔卡片双向联动、双击编辑对话框、代码预览（entity/dao/service/sql 四模板渲染正确）、框选、右键菜单、NN 胶囊展开、删除+Ctrl+Z 撤销/重做、数据库导入、字典搜索、暗色主题
- 修复的运行时缺陷：模板页 immediate watch TDZ（previewTimer 声明顺序）、代码预览模板异步加载后未自动选中、字典搜索自动跳转、重置演示数据未重置 mock 内存（resetDB 静态导入）、antd destroyOnClose 弃用警告
- 最终状态：亮色主题、10 可见表+3 隐藏中间表、10 导航、0 控制台错误
- 截图存于 docs/screenshots/（编辑器亮/暗、表编辑对话框、模板视图）
- 交付物：README.md（vp 启动说明）+ 源码 ZIP

---
Task ID: 3
Agent: main (Super Z)
Task: Eta 模板代码高亮（highlights-eta 插件）+ 导航线悬停样式修正（实线且与选中可区分）+ 画布元素悬停/选中全面过渡

Work Log:
- 依赖：bun add highlightjs-eta@0.1.0（eta-dev 官方插件）；发现其 package.json browser 字段指向 dist/eta.min.js（依赖全局 hljs 的浏览器脚本，无 ESM 导出，构建报 MISSING_EXPORT），改为深路径导入 ESM 源码 highlightjs-eta/src/languages/eta.js（类型声明补在 src/env.d.ts，LanguageFn）
- highlight.ts：注册 eta 语言；官方 grammar 未区分 <%# %> 注释，在其 contains 头部增补 hljs.COMMENT('<%#','%>')（需置于标签模式之前以优先命中）；languageOfFileName 增加 .eta/.ejs 映射；新增 highlightTemplateSource()
- TemplateView.vue：模板编辑器从裸 textarea 升级为「高亮覆盖层编辑器」——pre.code-overlay（v-html 高亮结果）置于透明 textarea 之下，两层字体/字号/行高/内边距/white-space: pre/tab-size 完全一致逐字符对齐；textarea 文字透明 + caret-color 可见 + ::placeholder/::selection 独立配色；@scroll 同步 scrollTop/scrollLeft 到覆盖层；尾行补偿（内容以 \n 结尾时补 \n 保证滚动高度一致）；wrap="off" 关闭软换行
- NavigateEdge.vue 样式重构：
  * 悬停（含 related 联动）：实线（移除虚线可能性）、--edge-hover 主色、2.8px、stroke-opacity 0.85、无光晕
  * 选中：实线（移除 stroke-dasharray: 7 4）、--primary 全不透明、3.4px、drop-shadow 光晕（新增 --edge-select-glow 亮/暗变量）、基数标记描边 + NN 胶囊描边强调
  * 区分度：线宽 2.8↔3.4、透明度 0.85↔1、光晕无↔有、标记文本色↔文本+描边（克制但可辨）
- 过渡效果全覆盖：.edge-line（stroke/stroke-width/stroke-opacity/filter 0.18s）、edge-mark rect/text、nn-pill rect/label/plus、edge-tip 淡入动画（edge-tip-in）、table-card 阴影/边框、.connector 由 display 切换改为 opacity+scale 淡入缩放（translate/scale 独立变换属性避免与四向定位冲突，pointer-events 联动）、head-hide-btn 同规则（常驻占位布局稳定）、col-row 背景行悬停、cols-toggle/索引切换三属性、nav-target 颜色、右键菜单项颜色 + ctx-menu-in 弹出动画（淡入+上移）
- 变量：variables.scss 亮暗两套各新增 --edge-select-glow
- 验证（agent-browser 实测）：
  * 悬停导航线：class=hovered、主色 2.8px、dasharray=none（实线）、opacity 0.85、无光晕、tooltip 出现、transition 已注册 —— 亮/暗双主题均通过
  * 单击选中：3.4px、dasharray=none、opacity 1、drop-shadow(主色 4px) 光晕、标记描边主色 —— 亮/暗双主题均通过
  * 卡片悬停：连接点 opacity/scale=1 + pointer-events auto + 过渡注册；隐藏按钮 opacity 1
  * Eta 编辑器：覆盖层与 textarea 长度逐字符一致（1387=1387）；标签内 JS 令牌（keyword/string/property/function）正确着色；<%# %> 注释令牌即时高亮；输入实时同步；滚动同步（scrollTop 120=120）；亮暗双主题截图
  * 回归：双击卡片（合成 dblclick 处理器链路）→ 编辑表对话框打开；右键菜单打开且弹出动画生效（ctx-menu-in）；实时预览照常渲染；控制台 0 错误
  * 注：CDP 合成双击无 clickCount 无法触发浏览器原生 dblclick（上轮已知限制，非回归）
- vue-tsc 类型检查通过；vite build 通过（2.54s）
- 重新打包 download/graph-db-model-editor.zip（2.3MB / 84 文件，含顶层目录；清理首次打包误入的 zip-stage 残留）；download/README.md 同步为最新项目 README
- README.md 更新：技术栈表加 highlights-eta；画布功能加悬停/选中样式与过渡说明；模板管理加 Eta 语法高亮编辑器说明

Stage Summary:
- 三项需求全部完成并经真实浏览器验证：eta 高亮编辑器（插件 + 注释扩展 + 覆盖层同步）、导航线悬停实线且与选中可区分、画布元素全面过渡
- 关键决策：插件 dist 版不可 ESM 导入故深路径引源码；<%# %> 注释模式为官方 grammar 的本地增补；连接点/隐藏按钮用 opacity+scale+pointer-events 替代 display 切换实现平滑过渡
- 截图：docs/screenshots/template-eta-highlight(.|-dark).png、edge-selected-solid.png、edge-dark-hover-select.png
- 交付物：download/graph-db-model-editor.zip + download/README.md

---
Task ID: 4
Agent: main (Super Z)
Task: 字段排序改为拖拽手柄 + 新增设置模块（列默认类型：DB 导入时正则依序匹配取第一条命中的 Java 类型）

Work Log:
- 上下文恢复：通读 worklog（Task 1-3 全部完成）+ 重读 TableEditDialog/ui/AppHeader/App/javaType/db/seed/modules/types/model/ImportDBDialog/DictView，确认代码风格与接口约定
- 新增 src/composables/useDragSort.ts：HTML5 DnD 手柄拖拽排序组合式函数——手柄 pointerdown 瞬间置行 draggable（避免常驻 draggable 破坏输入框文本选择）、一次性 window pointerup 复位未成拖拽的按下、dragstart 校验 from、dragover 上/下半区定位、drop 以 splice 语义换算插入位、rowClass() 输出 dragging/drop-above/drop-below
- TableEditDialog：删除 ArrowUp/ArrowDown 与 moveColumn，字段行首改为 GripVertical 手柄（touch-action:none、grab 光标、hover 过渡），挂接拖拽事件与落点指示线（box-shadow 2px 主色不占布局），cols-grid 首列 42px→28px；onSorted=renumber 保持 sort 重排
- 设置模块数据层：types 新增 ColumnTypeRule/AppSettings；seed 新增 SEED_SETTINGS（14 条有序规则，bigint 先于 int、datetime/timestamp 先于 time/date、char(1) 先于 char 防前缀抢匹配）；MockDB 增 settings 字段，loadDB 对旧 v2 存量补种子（不升版本避免清用户数据），handlers 增 GET/POST /codegen/settings/query|update（正则合法性校验）
- settingsApi + settings Pinia（init/save/matchJavaType/compiledRules 跳过非法正则；SETTINGS_JAVA_TYPES=规格 11 种：Character/String/Long/Integer/Float/Double/BigDecimal/LocalDateTime/LocalDate/LocalTime/Timestamp）
- model.importFromDB：懒加载 settings 后 javaType=matchJavaType ?? getJavaTypeByType（设置第一条命中优先，未命中回退内置映射）
- 页面接线：PageName 增 'settings'，AppHeader 增「系统设置」导航（Settings 图标），App.vue v-if 分支 + 进页 init
- SettingsView.vue：规则表（手柄拖拽/序号/正则输入/Java 类型选择/测试标记/删除）+ 拖拽落点指示线 + 非法正则即时标红（红边框+行内错误+禁用保存）+ 规则测试面板（输入任意类型实时预览，区分「生效」与「命中被抢先」，回退显示内置映射结果）+ 脏状态提示/放弃修改/保存
- ImportDBDialog：打开时预取设置；导入提示说明规则推导；字段数悬停 title 展示各字段「列名 类型 → Java 类型」预览
- 验证（agent-browser 真实浏览器）：
  * 设置页：14 条种子规则加载；测试面板 VARCHAR(255)→String(#2)、Decimal(6, 4)→BigDecimal(#7)、UUID→未命中回退 String；无效正则"("→标红+保存禁用+提示；修改 int→Long 保存→localStorage 持久化
  * 拖拽（合成分发完整 DragEvent 序列：pointerdown→dragstart→dragover→drop→dragend）：规则行 14→0（above）、1→3（below）、拖拽中 drop-below/dragging/draggable=true 类名实测、无 drop 的 dragend 不重排且状态复位
  * 表编辑对话框：4 字段行均含手柄且无上移下移；id 拖至 pv 下方→[stat_date,pv,id,uv]→保存→localStorage sort 0-3 持久化→画布卡片顺序同步
  * 设置驱动导入：int→Long 保存后导入 t_stat_daily→pv/uv INT→Long（设置规则覆盖内置 Integer），预览 tooltip 一致
  * 重置演示数据→13 表/14 规则/int→Integer 全部还原；控制台 0 错误；亮暗双主题截图
  * 注：agent-browser drag 命令（Playwright 合成拖拽）会将 dragstart 派发到固定行（工具怪癖），改用直接派发忠实 DragEvent 序列验证，逻辑全部正确
- vue-tsc 通过；vite build 通过（2.62s）；scripts/package.sh 固化打包流程（排除 node_modules/dist/.git/skills），重新打包 download/graph-db-model-editor.zip（2.7MB/95 文件，含顶层目录）
- README 更新：表编辑改「拖拽手柄排序」、新增「系统设置」章节、Mock API 增 settings 说明、项目结构增 composables/SettingsView/settings、截图表格更新

Stage Summary:
- 两项需求全部完成并经真实浏览器验证：字段拖拽排序（共用组合式函数，含落点指示线/状态复位/持久化）、设置模块（列默认类型正则依序匹配，第一条命中优先，未命中回退内置映射，含校验/测试/持久化）
- 关键决策：手柄按下瞬间才置 draggable（保输入框文本交互）；localStorage v2 不升版本、存量数据补默认设置；设置仅作用于 DB 导入默认值（按规格严格限定），编辑器内 onTypeChange 仍走内置映射
- 交付物：download/graph-db-model-editor.zip + download/README.md；截图 docs/screenshots/settings-column-rules(.|-dark).png、settings-view.png、table-columns-drag-handle.png

---
Task ID: 6
Agent: main (Super Z)
Task: 修复导航线双击编辑失效 + 修复导航线单击选中失效 + 卡片悬停/选中时关联导航线联动切换对应样式

Work Log:
- 修改前快照：scripts/snapshot.sh → snapshot/20260909094359.zip（101 文件）
- 根因诊断（两项失效同源）：Task 5 为修复框选出画布卡死将 beginSelect 改为 pointerdown 立即捕获指针，并假设「beginSelect 只来自空白画布」；但导航线（含 NN 胶囊）的 pointerdown 会冒泡到画布根（不同于卡片的 @pointerdown.stop），在线段上按下同样触发 beginSelect → 立即捕获 → click/dblclick 被派发到捕获元素（画布根）而非线段本身 → 单击选中、双击编辑、NN 胶囊点击全部失效；且 pointerup 时 clearSelection 还会清掉已有线段选中
- canvas.ts beginSelect 修复：按 pointerdown 命中目标区分捕获时机——target 不在 [data-navigate-id] 内（真空白画布）才立即捕获（保留 Task 5 的出画布跟踪修复）；线段/胶囊上按下走延迟捕获（位移 > 3px 才捕获），无位移单击/双击正常派发到线段
- 单一焦点语义：setSelection / selectTable（含 Ctrl/Shift 多选）/ 框选 onPointerUp 选中分支均清除 selectedNavigateId（setSelectedNavigate 原有反向清除保留）——表选中与线段选中互斥，画布同一时刻只有一种选中焦点，避免两种高亮叠加混淆
- 卡片 ⇄ 导航线联动（NavigateEdge.vue）：isRelated 拆分为 isRelatedHover（hoveredTableId 命中关联端点 → related-hover 类 → 悬停风格 2.8px/0.85）与 isRelatedSelected（selectedIds 命中关联端点 → related-selected 类 → 选中风格 3.4px/主色/光晕/标记描边）；isEndpoint 覆盖 self/target/mappingTable（NN 经由的中间表同样视为关联端点）；选中规则写在悬停规则之后，两类叠加时选中风格优先；提示 tooltip 仍仅在线段自身悬停/选中时出现
- 状态残留清理：TableCard 卸载时若 hoveredTableId 指向自身则清除（卡片因隐藏/删除/视口裁剪卸载时 mouseleave 不保证触发，否则关联线会一直保持联动高亮）；NavigateEdge 卸载时同理清理 hoveredNavigateId/selectedNavigateId
- README 画布章节新增「卡片 ⇄ 导航线联动」条目
- 验证（agent-browser 真实鼠标输入，1920×1080 视口）：
  * 单击线段（getPointAtLength + elementFromPoint 实测可点击点后真实 mouse down/up）：edge 获得 hovered+selected 类、3.4px、主色、opacity 1、tooltip 出现 —— 修复前 click 被捕获偷走永远无法选中
  * 双击线段：真实两次点击（CDP clickCount 限制无法合成原生 dblclick，已知限制）+ 合成 dblclick 派发到 .edge-hit → 「编辑导航」对话框打开 —— 与既往方法论一致的双重佐证
  * 卡片悬停（真实 mouse move）：cms_article 的 4 条关联线全部 related-hover + 2.8px + 0.85
  * 卡片单击选中（真实 down/up）：4 条关联线 related-hover+related-selected、3.4px、opacity 1、drop-shadow 光晕；无关 6 条线保持默认 2px 无光晕；选中前线段的 selected 被 setSelection 清除（单一焦点生效）
  * NN 胶囊真实点击 → 中间表 cms_article_tag 显示、对应胶囊消失（残留胶囊属 n-user-role/n-role-menu，正确）
  * 空白框选回归：真实拖拽选框实时更新、释放后按完全包含语义选中 sys_role（Task 5 修复保留）
  * 卡片双击回归：dispatchEvent dblclick → 「编辑表 · sys_role」对话框打开
  * 亮/暗双主题截图（edge-related-light/dark.png）：暗色下 4 条关联线 3.4px + 暗色主色 rgb(45,212,191)
  * 控制台 0 错误（仅 vite HMR 日志）
- vue-tsc 通过；vite build 通过（2.81s）
- patch 留档：patch/20260909095132.patch（4 文件 12K）
- 重新打包 download/graph-db-model-editor.zip（106 文件 3.8M，无 snapshot/patch 泄漏，含新截图）

Stage Summary:
- 三项需求全部完成并经真实浏览器输入验证：线段单击选中与双击编辑恢复（根因是 Task 5 立即捕获偷走 click/dblclick——按命中目标区分捕获时机后，空白立即捕获与线段延迟捕获两全）、卡片悬停/选中时关联导航线（含 NN 中间表）联动切换到对应悬停/选中风格
- 关键决策：不在线段模板上 stop pointerdown（保留从线段上起拖的框选能力），改为 beginSelect 内按 target.closest('[data-navigate-id]') 判定空白与否；表选中与线段选中互斥的单一焦点语义；卡片/线段卸载时主动清理悬停态防联动残留
- 交付物：snapshot/20260909094359.zip（改前快照）、patch/20260909095132.patch（本轮改动）、download/graph-db-model-editor.zip（106 文件）
- 截图：docs/screenshots/edge-related-light.png、edge-related-dark.png

---
Task ID: 7
Agent: main (Super Z)
Task: 修复点击多对多导航线胶囊无法显示隐藏中间表的问题

Work Log:
- 复现诊断：真实浏览器逐个点击 3 个 NN 胶囊（elementFromPoint 命中验证 + 真实 mouse down/up），点击链路本身全部有效（表解除隐藏、胶囊消失）——Task 6 的延迟捕获修复未被破坏
- 真正根因：中间表虽已解除隐藏，但可能落在当前视口之外——种子布局中 cms_article_tag 位于 (968,1169)，在 1080 高视口下方 89px；用户视口更小（笔记本/内嵌预览）时更甚。点击胶囊后屏幕上没有任何可见变化，用户感知即"点击无效"
- canvas.ts 新增 ensureTableVisible(tableId)：卡片完整在视口内（含 60px 边距）则完全不动视口；否则按最小偏移计算平移量（四向出界分别判定，不平移多余距离、不强行居中、不改缩放），经 animateTo 平滑滚动；首版 dx/dy 与 pan 换算正负号写反（pan 是世界内容的屏幕偏移，视口扩展方向 = 内容反向移动），实测表被越推越远后修正为 pan -= 偏移×缩放
- 接线两处「显示隐藏表」入口：NavigateEdge.showMappingTable（NN 胶囊展开中间表，主修复点）、OutlinePanel 眼睛「在画布中显示」按钮（同根因隐患顺带修复）；TableCard 隐藏导航摘要的 nav-target 点击本就跟随 centerOnTable 强制居中，无需改动
- cardRectOf 对未挂载卡片用 268x140 兜底尺寸（实际 268x160），20px 误差由 60px 边距吸收，验证无碍
- README「多对多中间表」条目补充视野保障说明
- 验证（agent-browser 真实鼠标输入，1920×1080）：
  * 屏幕外场景：默认视口点击 cms_article_tag 胶囊 → 表出现且完整可见（top=880/bottom=1040 ≤1080）、视口平滑滚动（world-layer transform (0,0)→(0,-289)）、胶囊消失
  * 视口内场景：点击 sys_user_role 胶囊（表在 (568,509)）→ 表显示、transform 纹丝不动（(0,0,1) 不变）—— 已可见时零干扰
  * 大纲眼睛：中键平移视口至空白区域（translate(-364,214)）后从大纲恢复 cms_article_tag → 平滑滚回（panY 214→-289）、表完整可见、x 方向不动（x 本就在视口内）
  * 回归：线段单击选中（n-article-user selected 类）、合成 dblclick → 编辑导航对话框、控制台 0 错误
- vue-tsc 通过；vite build 通过（2.58s）
- patch 留档：patch/20260909103653.patch（4 文件 8K）；重新打包 download/graph-db-model-editor.zip（107 文件 4.1M）

Stage Summary:
- 根因并非点击失效而是"显示在屏幕外"：点击胶囊链路（延迟捕获修复）一直有效，表确实解除隐藏，但种子布局的 cms_article_tag 在视口外导致用户看不到任何变化
- 关键决策：ensureTableVisible 采用最小偏移平移而非 centerOnTable 强制居中——表已可见时零干扰、仅在出界方向滚动刚好够的距离、保持用户缩放；顺带修复大纲眼睛的同源隐患
- 交付物：patch/20260909103653.patch、download/graph-db-model-editor.zip（107 文件）；截图 docs/screenshots/pill-show-mapping.png

---
Task ID: 8
Agent: main (Super Z)
Task: 页面封装为 DBManagerView.vue（api?: ManagerApi 属性 + provide/inject 注入）+ 当前 demo 逻辑实现为 DemoManagerApi + 设置新增索引类型列表管理

Work Log:
- 修改前快照：snapshot/20260909151406.zip（104 文件）
- 类型层（src/types/model.ts）：按规格新增 DBColumn（notNull 为 demo 扩展可选字段）/DBIndex/DBTable/Template/TypeMapping/Settings/LoadResultVO/ManagerTable（规格 Table 完整语义 = Table + columns + indexes）/ManagerApi（14 方法 + resetDemo? 可选扩展）；移除 DBTableDef/AppSettings/ColumnTypeRule/ReplaceResult/IndexType；TableIndex.type 放宽为 string（可选列表由设置驱动）
- manager-api.ts：MANAGER_API_KEY（InjectionKey<ComputedRef<ManagerApi>>，响应式引用保证 prop 切换可传导）+ sharedDemoApi 共享单例 + setActiveApi/getManagerApi（store 桥接，activeApiRef 为 shallowRef）+ useManagerApi()（inject 工厂回退 getManagerApi，第三参 treatDefaultAsFactory）+ errorMessageOf（替代原 axios 错误提取）
- demo-manager-api.ts：DemoManagerApi 类（原 axios mock handler 逻辑同步化迁移）——getSettings/saveSettings（正则校验 + 索引类型去重归一 + sort 重编号）、importFromDB（SEED_DB_TABLES 克隆）、load/save（全量装配/校验写入：表名/字段名/索引名唯一、分类存在、导航 self/target/mappingTable 引用完整、类型枚举）、字典与模板 CRUD（Template.templateName ↔ CodeTemplate.name 适配、id 由调用方生成）、replace（void 契约 + JSZip 异步内部解析 + message 自反馈）、resetDemo 扩展
- db.ts 瘦身：移除 handlers/mockDispatch/MockError/组装 TableVO 逻辑，仅保留 MockDB 状态 + loadDB（旧 columnTypeRules 形态读取时迁移为 typeMappings+indexTypes 并立即归一落盘）+ getDB/persistDB/resetDB；let db 声明与赋值分离修复 TDZ
- seed.ts：SEED_SETTINGS 新形态（indexTypes: UNIQUE/NORMAL/FULLTEXT + typeMappings 14 条 sort 0-13）；SEED_DB_TABLES 改 DBTable（5 表新增 6 个索引种子：uk_tag_name/uk_blog_tag/idx_publish_time/uk_stat_date/idx_uv 等）
- stores 全部改经 getManagerApi()：
  * model：init 走 load() + applyTables 展平；persist() 全量 save；全部变更动作改为「先改本地 → persist 失败回滚快照并抛错」（createTable/saveTable/removeTables/add-update-removeNavigate/saveCategory/removeCategory/importFromDB/pasteTable 统一模式）；createTable 客户端生成表 id（NavigateEditDialog 中间表创建依赖返回值）；importFromDB 适配 DBTable（notNull ?? false + 索引映射：类型不在设置列表归一为列表首项 + 空索引名过滤）；persistTables 签名保留（canvas 三处调用不变）改全量语义；resetDemoData 调 api.resetDemo?.() 并重置全部四仓库 loaded 后重载（dict/template 动态 import 避免模块环）
  * history：resync 差量同步（120 行）删除，restore 简化为 applySnapshot + persist（失败回滚）
  * dict：getDicts/addDict/updateDict/removeDict；新增字典 id 客户端生成
  * template：getTemplates 适配映射；saveTemplate 新增走 addTemplate（id 客户端生成）；replaceWithGenerated 调 api.replace（反馈由实现自理）
  * settings：state 改 indexTypes + typeMappings；compiledRules 按 sort 升序；save(settings) 走 saveSettings；新增 indexTypeOptions getter（空时兜底三常规类型）
- DBManagerView.vue（src/views/）：a-config-provider + a-app + 页面壳 + 页面 watch 全部自 App.vue 迁入；apiRef = computed(props.api ?? sharedDemoApi)；provide(MANAGER_API_KEY, apiRef) + setActiveApi immediate；api 切换时清空四仓库 loaded + history.clear + canvas 复位 + 重载当前页；App.vue 瘦身为单组件渲染（含自定义 api 用法注释）
- SettingsView 重写：列默认类型卡片（TypeMappingDraft 带 uid key 保拖拽/输入焦点稳定，拖拽后 sort 重编号，测试面板保留）+ 索引类型卡片（chip 列表 + 回车/按钮添加、自动转大写、去重校验、可删除）+ 统一保存条（脏状态合并计算、正则/空类型校验禁用保存）
- 对话框接线：TableEditDialog 索引类型选项改 computed(settingsStore.indexTypeOptions) + 打开时 settingsStore.init() 预载 + 错误提示简化；ImportDBDialog 用 useManagerApi() 调 api.importFromDB()（inject 路径）+ 行显示"N 字段 / M 索引" + 悬停预览索引归一化；ReplaceConfirmModal 用 useManagerApi() 调 api.replace(zip)（inject 路径）+ 文案更新
- 删除 src/api/http.ts + src/api/modules.ts，bun remove axios
- README：新增「页面封装与数据能力注入」章节（注入链路说明 + ManagerApi 接口清单 + DemoManagerApi 说明 + 自定义 api 示例）；技术栈表 axios → ManagerApi 体系；Mock API 章节移除；设置/编辑对话框/导入/替换章节同步更新；项目结构与截图表格更新
- 验证（agent-browser 真实浏览器，1920×1080）：
  * 初始加载：10 卡片/10 导航线/0 控制台错误
  * 旧数据迁移：注入 columnTypeRules 旧形态 → 刷新 → settings 迁移为 typeMappings(sort 0/1) + 默认 indexTypes 且立即归一落盘
  * 真实拖拽卡片 → 全量 save 持久化（localStorage 9 键结构完整）
  * 设置页：2 条迁移规则 + 3 索引 chip；添加 "spatial" → 自动转大写 SPATIAL + dirty 提示 → 保存 → localStorage 持久化 + "全部更改已保存"
  * 表编辑对话框索引下拉：UNIQUE/NORMAL/FULLTEXT/SPATIAL 四选项（动态列表生效）；合成 dblclick 打开「编辑表 · sys_user」验证
  * 数据库导入：api.importFromDB() 5 表（含索引计数显示）；导入 t_blog+t_stat_daily → 12 卡片；索引持久化（uk_stat_date UNIQUE/idx_uv NORMAL/idx_publish_time NORMAL）
  * 代码替换：确认弹窗（ManagerApi.replace 文案）→ 确认 → 关闭 + "已接收 zip 并替换 8 个代码文件（demo 行为）"
  * 撤销/重做：Ctrl+Z 15→13 表、Ctrl+Y 13→15 表、localStorage 同步
  * 自定义 api 注入：App.vue 临时传原型链包装 api（getSettings→HASH/BTREE、importFromDB→t_custom_marker）→ 设置页显示 HASH/BTREE chip + 1 规则、导入对话框显示 t_custom_marker（provide/inject 与 setActiveApi 双通道均生效）→ 还原正式 App.vue
  * 重置演示数据：13 表/14 规则/3 索引类型/5 字典/4 模板全部还原种子
  * 增/改/删表：新增 t_verify_create（默认 id 字段）→ 编辑注释保存（"验证编辑"持久化）→ 选中+Delete 确认删除（14→13 表）
  * 字典页 5 字典加载、模板页 4 模板 + 1387 字符预览正常
  * 亮暗双主题截图：dbmanager-light/dark.png、settings-index-types-dark.png；0 控制台错误
- vue-tsc 通过；vite build 通过（2.46s）
- patch 留档：patch/20260909153429.patch（18 文件 120K）；重新打包 download/graph-db-model-editor.zip（110 文件 4.5M）

Stage Summary:
- 三项需求全部完成并经真实浏览器验证：页面封装为 DBManagerView（api 属性 + provide/inject + store 桥接 + api 热切换重载）、demo 逻辑迁移为同步 DemoManagerApi（原 axios mock 层整体退役删除）、设置新增索引类型列表管理（驱动表编辑下拉与导入归一化）
- 关键决策：提供 ComputedRef 注入（api prop 切换可传导）；store 经全局激活实例桥接（inject 与 getManagerApi 双通道）；模型变更统一「本地先行 + persist 失败回滚」事务模式；全量 save 语义取代原 13 个细粒度 REST 端点；localStorage v2 不升版本、旧设置读取时迁移并归一落盘；DBColumn.notNull 作为 demo 扩展可选字段保持导入体验
- 交付物：snapshot/20260909151406.zip（改前快照）、patch/20260909153429.patch（本次改动）、download/graph-db-model-editor.zip（110 文件）+ download/README.md
- 截图：docs/screenshots/dbmanager-light.png、dbmanager-dark.png、settings-index-types-dark.png

---
Task ID: 9
Agent: main (Super Z)
Task: DemoManagerApi 全部方法添加 console.log（入参/结果）+ 确认并修复 ManagerApi 设置 API 未在合适时机调用的问题

Work Log:
- 修改前快照：scripts/snapshot.sh → snapshot/20260911065109.zip（135 文件）
- 问题确认（调用链路分析）：getSettings() 仅经 settingsStore.init() 惰性触发——打开表编辑对话框（TableEditDialog watch）、打开数据库导入对话框（ImportDBDialog watch）、用户切到设置页（initPage 'settings' 分支）、model.importFromDB 前置 ensure、resetDemoData 重载；应用默认页为 editor（ui store），启动时 initPage('editor') 只调 model.init() → api.load()，**getSettings() 在整个启动阶段从未被调用**；加载前索引类型下拉走硬编码兜底 ['UNIQUE','NORMAL','FULLTEXT']、导入类型推导回退内置映射。saveSettings() 调用链正常（SettingsView.save → settingsStore.save）
- demo-manager-api.ts：新增 withCallLogging(instance, label) Proxy 包装，构造函数 return withCallLogging(this, 'DemoManagerApi')——所有契约方法（含 resetDemo 扩展）自动覆盖，无需逐方法插桩；每次外部调用输出「入参 args 数组 + 返回结果」两条日志，抛错时 console.error 后原样抛出；包装函数以原始实例为 this 执行（内部 this.assembleTables 等辅助互调不经过代理、不打日志）；同名方法包装结果缓存于 Map（方法引用稳定）
- DBManagerView.vue：initPage() 无条件调用 settingsStore.init()（幂等，loaded 守卫）——视图启动（ui.page watch immediate）、任意页面切换、api 热切换重载均触发设置预载；移除原 'settings' 分支的专属调用
- settings.ts：init() 并发竞态加固——原「loading 时直接早退」会让后续 await init() 的调用方（如 model.importFromDB）在加载完成前拿到空规则（自定义异步 api 实现场景）；改为模块级 initInFlight Promise 共享：并发调用方 await 同一次在途加载，finally 清空（失败可重试、重置后可重载）
- README：DemoManagerApi 章节补充调用日志说明（[DemoManagerApi] 前缀过滤、启动即触发 getSettings/load）
- 验证（agent-browser 真实浏览器，localhost:3000，vp dev）：
  * 启动日志：[DemoManagerApi] getSettings() 入参 [] / 返回 {indexTypes: 3, typeMappings: 14} + load() 入参/返回 —— 修复前启动阶段无 getSettings
  * 幂等：切到设置页、打开表编辑对话框均无重复 getSettings 调用（对话框仅触发 getDicts）
  * saveSettings：设置页添加 SPATIAL 索引类型 → 保存 → 入参/返回日志 + localStorage 持久化确认
  * importFromDB：打开导入对话框 → 入参/返回（5 表）日志
  * updateTablePos：真实拖拽 sys_user 卡片 → 入参/返回日志
  * resetDemo：动态 import 调用 → 日志 + 种子还原（SPATIAL 测试数据清理）
  * 错误路径：eval 调用 updateTablePos('t-nonexistent') → console.error 抛错日志 + 原样重抛（caught: 表不存在）
  * 内部辅助不打日志：load() 仅 2 条日志（内部 assembleTables 无输出）
  * 页面 0 错误、0 控制台异常；截图 docs/screenshots/api-call-logs.png
- vue-tsc 通过；vp build 通过（2.85s）
- patch 留档：patch/20260911065517.patch（4 文件 8.0K：demo-manager-api.ts / DBManagerView.vue / settings.ts / README.md）；重新打包 download/graph-db-model-editor.zip（111 文件 5.1M）

Stage Summary:
- 两项需求完成：(1) DemoManagerApi 所有方法（含 resetDemo）控制台打印入参与结果，Proxy 包装实现零逐方法插桩、内部互调不打扰、方法引用稳定；(2) 设置 API 调用时机问题确认并修复——根因是设置完全惰性加载导致启动阶段 getSettings() 从未调用，改为视图启动即幂等预载（任意页面、api 热切换、页面切换全覆盖），并加固 init() 并发等待语义
- 关键决策：日志用 Proxy 统一包装而非逐方法插桩（新增契约方法自动覆盖）；包装函数绑定原始实例为 this 避免内部辅助方法重复打日志；settings init 用在途 Promise 替代 loading 早退（异步 api 实现下 await 语义正确）
- 交付物：snapshot/20260911065109.zip（改前快照）、patch/20260911065517.patch、download/graph-db-model-editor.zip（111 文件）；截图 docs/screenshots/api-call-logs.png

---
Task ID: 10
Agent: main (Super Z)
Task: 实现 src/log/Logger.ts 统一日志器 + DemoManagerApi 调用日志切换到 Logger

Work Log:
- 新建 src/log/Logger.ts：导出 Logger 单例对象——log/info/debug/warn/error/fatal 六个输出方法；级别 DEBUG/INFO/WARN/ERROR/FATAL/DISABLED，setLevel()/getLevel()/level getter-setter 三种控制形态；权重过滤只输出当前级别及以上，DISABLED 屏蔽一切（含 log 与 fatal）
- 设计决策：log() 为无级别方法（用户级别清单中无 LOG 级——未禁用即输出，定位等同 console.log）；debug/log 映射 console.log 而非 console.debug（Chrome DevTools 默认过滤级隐藏 Verbose，debug 会看不到）；fatal 无控制台对应通道，按 console.error + [FATAL] 标签输出；输出格式 [HH:mm:ss.SSS] [级别] 前缀 + 参数原样透传（对象保持可展开）；默认级别 DEV=DEBUG / PROD=INFO（import.meta.env.DEV）；级别存模块闭包变量（方法解构调用不依赖 this）
- demo-manager-api.ts：withCallLogging 的 console.log/error 全部替换为 Logger.debug/Logger.error——入参与返回走 debug 级（默认可见、setLevel('INFO') 可静默追踪噪音），抛错走 error 级（各级别下只要未禁用均透传）；文件头与包装函数注释同步更新
- README：新增「统一日志 Logger（src/log/Logger.ts）」章节（用法示例 + 级别语义 + 通道映射 + 默认级别）；DemoManagerApi 章节日志说明改为 Logger 表述（级别可调）；项目结构补 src/log/ 条目
- 验证（agent-browser 真实浏览器，localhost:3000）：
  * 六方法输出格式与通道：log/debug→log、info→info、warn→warning、error/fatal→error，前缀 [07:15:25.632] [LEVEL] 正确
  * INFO 级：debug 被过滤（info/warn 正常输出）
  * DISABLED 级：log/debug/error/fatal 及 DemoManagerApi 调用链路全部静默
  * WARN 级：DemoManagerApi 抛错路径仍以 [ERROR] 透传（updateTablePos 不存在表）
  * INFO 级下真实 UI 打开导入对话框：importFromDB debug 追踪静默、对话框功能正常
  * 重载回归：启动日志新格式（[DEBUG] [DemoManagerApi] getSettings/load）、10 卡片、0 控制台错误
- vue-tsc 通过；vp build 通过（2.58s）
- patch 留档：patch/20260911071639.patch（3 文件 12K：Logger.ts 新增 / demo-manager-api.ts / README.md）；重新打包 download/graph-db-model-editor.zip（114 文件 5.3M）

Stage Summary:
- Logger 统一日志器落地：六方法 + 六级别（DISABLED 全静默）+ 三种级别控制形态（setLevel/getLevel/level 存取器），时间戳前缀、参数透传保持可展开、通道映射规避 console.debug 的 DevTools 默认隐藏问题；DemoManagerApi 全部契约方法调用日志由 console 直写切换为 Logger（入参/返回 debug 级、抛错 error 级），运行时 setLevel 即可静默或全关
- 关键决策：log() 无级别语义（级别清单无 LOG）；debug 走 console.log 保证默认可见；DEV/PROD 差异化默认级别；闭包变量存级别使解构调用安全
- 交付物：patch/20260911071639.patch、download/graph-db-model-editor.zip（114 文件）；截图 docs/screenshots/logger-levels.png

---
Task ID: 11
Agent: main (Super Z)
Task: 完善 README.md（结构重组 + 新章节 + 自检工具）

Work Log:
- 改前快照：snapshot/20260911074949.zip（140 文件）
- 结构重组：新增「目录」锚点导航（GitHub slug 规则）；「快速开始」从文档中部前置到技术栈之后，拆分为环境要求（bun ≥ 1.4.2 devEngines / vp CLI / 浏览器）+ 安装启动 + 常用命令速查表（11 条命令含三个留档脚本与 eta-smoke）
- 功能总览：新增四页面导语（编辑器/字典/模板/设置）；画布快捷键由单行 bullet 改为 7 行表格；大纲小节补充「重置演示数据」按钮说明
- 新章节「数据模型概览」：基于 src/types/model.ts 逐实体整理 11 行职责/唯一性约束表（TableCategory→ManagerApi 载荷），附实体关系与校验归属说明
- 新章节「开发与调试」：ManagerApi 调用观测（含控制台动态 import 手工验证示例——已核对 updateTablePos 签名为坐标对象、t-sys-user 真实表 ID）、Logger 运行时调级示例、eta-smoke 冒烟、代码风格与提交检查（staged/fmt/lint 约定）
- 新章节「常见问题 FAQ」：6 条（vp 命令缺失、日志静默、数据重置、localStorage key gdbme:db:v2、端口修改、旧数据自动迁移）
- 截图增强：Logger/DemoManagerApi 章节内嵌 logger-levels.png 与 api-call-logs.png；截图表新增字典管理（dict-dark.png）与代码预览（code-preview.png）两行
- 新增 scripts/check-readme.py：README 自检工具（图片/相对引用存在性、内部锚点按 GitHub slug 规则解析、表格列数一致性、代码块闭合），修正自身三处 bug 后通过（29 标题全解析）；已登记进常用命令速查表与项目结构注释
- vp check 发现 README.md 受 fmt 覆盖（手工表格对齐不规范）→ `vp check --fix` 自动修正，复检通过（48 文件 lint 无告警）；vue-tsc 通过
- patch 留档：首次生成缺 scripts/check-readme.py（patch.sh 的 intent-to-add 仅覆盖 src/）→ 手动 `git add -N` 纳入后重打 patch/20260911075402.patch（2 文件 32K）；重新打包 download/graph-db-model-editor.zip（115 文件 5.3M，含新 README 与自检脚本）

Stage Summary:
- README 从 281 行扩至 410 行：目录导航、快速开始前置化、数据模型概览、开发与调试、FAQ 三个新章节 + 命令速查/快捷键/环境要求三张新表，文档从「功能罗列」升级为「可导航的项目手册」；控制台验证示例均经源码核对（updateTablePos 坐标对象签名）
- 关键决策：新增 check-readme.py 把 README 质量纳入可执行校验（锚点/引用/表格/代码块四类规则）；README 受 vp fmt 管束需 `vp check --fix` 保持表格对齐
- 交付物：snapshot/20260911074949.zip、patch/20260911075402.patch（README.md + scripts/check-readme.py）、download/graph-db-model-editor.zip（115 文件）

---
Task ID: 12
Agent: main (Super Z)
Task: updateTablePos 契约改为批量 DTO（UpdateTablePosDTO）+ Ctrl+A 全选 / Ctrl+D 取消选中 / Ctrl+S 保存所有快捷键

Work Log:
- 改前快照：snapshot/20260911081526.zip（141 文件）
- types/model.ts：新增 UpdateTablePosDTO（tables: Array<{ tableId, pos: { x, y } }>）；ManagerApi.updateTablePos 签名改为 updateTablePos(tablePoses: UpdateTablePosDTO): void（多表卡片同动仅一次调用）；save() 注释补充 Ctrl+S 触发
- demo-manager-api.ts：updateTablePos 批量实现——先整体校验（任一 tableId 不存在即抛「表不存在」且不落盘，all-or-nothing），全部命中后统一写库、单次 persistDB；空 tables 短路返回
- stores/model.ts：persistTables(ids) 由逐表循环调用改为收集全部最终坐标后单次 api.updateTablePos({ tables })；头部契约注释同步（拖动/对齐/布局共用此路径，签名不变调用方零改动）
- ModelCanvas.vue onKeyDown：Ctrl+A → canvas.setSelection(visibleTableIds)（全选可见卡片，隐藏表无卡片不参与，preventDefault 阻止浏览器全选）；Ctrl+D → clearSelection + closeMenu（同 Esc 语义，preventDefault 阻止书签快捷键）
- AppHeader.vue：window 级 keydown 监听 Ctrl/Cmd+S → preventDefault + saveAll()（与「保存所有」按钮同一函数，任意页面生效；saveAll 直接委托 api.save() 无副作用）；按钮 title 补充 Ctrl+S 提示
- README 同步：ManagerApi 清单两行说明更新（save 触发条件、updateTablePos 批量语义）、快捷键表新增 Ctrl+A/Ctrl+D/Ctrl+S（全局）三行、保存与刷新 bullet 补批量保存说明、开发与调试控制台示例改 DTO 形态
- 验证（agent-browser 真实浏览器，localhost:3000）：
  * Ctrl+A：10/10 可见卡片选中（13 表 - 3 隐藏中间表）
  * 多选拖拽：全选状态下拖动一张卡片，控制台仅 1 条 updateTablePos 日志（改前逐表 10 条）；拖拽前后 getDB 坐标 diff 证实 10 张表同步位移（+270.49, +189.34）、3 张隐藏表坐标不变
  * Ctrl+D：选中数归零；Ctrl+S：save() 入参/返回日志 + 「所有修改已保存」提示（快照文本确认）
  * 错误路径：eval 调 updateTablePos({ tables: [{ tableId: 't-nonexistent', ... }] }) → 抛「表不存在: t-nonexistent」+ Logger.error 输出
  * resetDemo + 重载回归：10 卡片、0 页面错误
- vue-tsc 通过；vp check --fix 通过（48 文件 lint 无告警）；vp build 通过（2.73s）；check-readme.py 通过
- patch 留档：patch/20260911081939.patch（6 文件 20K）；重新打包 download/graph-db-model-editor.zip（115 文件 5.3M）

Stage Summary:
- 契约演进：updateTablePos 单表签名 → UpdateTablePosDTO 批量签名，多选卡片同动时 UI 仅调用一次 api；Demo 实现保持 all-or-nothing 校验语义（先整体校验再写入，单次落盘）；persistTables 收口单次调用，拖拽/对齐/自动布局三条路径自动受益
- 快捷键：Ctrl+A 全选（仅可见表）、Ctrl+D 取消选中（画布级，均在 ModelCanvas）、Ctrl+S 保存所有（AppHeader 全局监听，与按钮同函数）；均 preventDefault 抵御浏览器默认行为（全选/书签/保存页）
- 交付物：snapshot/20260911081526.zip、patch/20260911081939.patch、download/graph-db-model-editor.zip（115 文件）
---
Task ID: 13
Agent: main (Super Z)
Task: ManagerApi 接口的所有函数全部改为异步函数（Promise 契约）

Work Log:
- 改前快照：snapshot/20260911082250.zip（141 文件）
- types/model.ts：ManagerApi 全部 28 个方法（27 契约 + resetDemo 扩展）签名改 Promise 返回——getSettings(): Promise<Settings>、load(): Promise<LoadResultVO>、getTables(): Promise<ManagerTable[]> 等读方法返回数据 Promise，写方法（saveSettings/add*/update*/remove*/updateTablePos/save/replace）返回 Promise<void>；接口头注释补充异步契约语义（UI 侧 await 消费、对接真实后端无需调整调用链路、校验失败 reject 中文业务提示）
- demo-manager-api.ts：全部方法 async 化（内部逻辑不变，微任务内 resolve；校验失败 reject）；withCallLogging Proxy 异步感知——方法返回 thenable 时 .then 等待落定后打印 resolved 真实值（而非 pending Promise 对象）、reject 时 error 级输出后原样透传拒绝，同步返回路径保留兜底；replace() 由「void 契约 + 内部 catch 自反馈」改为「await JSZip.loadAsync，解析失败 reject 由调用方捕获」（成功 message 反馈保留）；文件头与 withCallLogging 注释同步
- stores/model.ts：全部 api 调用 await 化——init/refresh（load）、saveAll（save）、syncToApi（get 三组 + 全部 diff 写操作逐个 await，顺序语义保持：分类补齐→表删/加/改→导航 diff→分类删除收尾）、saveCategory/removeCategory（update/add/removeCategory）、createTable/saveTable/setTableHidden/pasteTable（add/updateTable）、persistTables（updateTablePos）、removeTables/importFromDB（for 循环逐个 await add/removeTable）、resetDemoData（await api.resetDemo?.()，删除冗余 as ManagerApi & {...} 类型断言与未使用的 ManagerApi type 导入）；「本地先行 → await api → 失败回滚快照」事务模式语义不变（await 位于 try 内，reject 触发回滚）
- stores/settings.ts：init() 的在途 IIFE 内 await getSettings()；save() 改为 await saveSettings 成功后才更新本地状态（失败本地保持旧值）
- stores/dict.ts：init（await getDicts）/saveDict（await update/addDict 后更新本地）/removeDict（await 后再改本地列表）
- stores/template.ts：init（await getTemplates）/saveTemplate（await update/addTemplate）/removeTemplate/replaceWithGenerated（await replace，失败向上传播）
- stores/history.ts：restore 中 await model.syncToApi()（恢复 diff 同步的 reject 仍被捕获并回滚本地）
- AppHeader.vue：saveAll 改 async + await model.saveAll()（reject 进入 catch 提示「保存失败」，Ctrl+S 与按钮共用）
- ImportDBDialog.vue：fetchDefs await api.importFromDB()（reject 捕获提示「查询数据库结构失败」）
- ReplaceConfirmModal.vue：confirmReplace await api.value.replace(zip) + 新增 catch（message.error「代码替换失败」）——承接 replace 错误传播语义从 demo 内部 catch 移至调用方；补充 antdv-next message 导入
- README.md 同步：自定义 api 示例注释改「实现全部异步方法（均返回 Promise）」；注入链路三条改 await 语义描述；ManagerApi 接口清单新增异步契约导语（Promise + reject 中文提示 + await 消费 + 对接后端零调整）与 replace 行补充（真实异步、失败 reject 调用方捕获）；DemoManagerApi 章节改「全部方法返回 Promise（内部同步完成后微任务 resolve）+ 日志等待落定后打印 resolved 值」；check-readme.py 通过
- 验证（agent-browser 真实浏览器，localhost:3000，重启 dev server 后全量回归）：
  * 启动：getSettings/load 入参与返回日志成对出现，返回为 resolved 真实值（{indexTypes: Array(3), typeMappings: Array(14)} / {categories: 3, tables: 13, navigates: 10}），时间戳差 ~84ms 证实 await 落定后打印；0 页面错误
  * 单表拖拽：1 次 updateTablePos（返回 undefined 为 resolved 值）；Ctrl+A 全选 6 卡片 + 拖拽仍 1 次调用（多表 DTO）；Ctrl+D 选中归零；Ctrl+S → save() 日志 +「所有修改已保存」提示
  * 错误路径：eval 调 updateTablePos({tables:[{tableId:'t-nonexistent',...}]}) → reject「表不存在: t-nonexistent」+ [ERROR] 日志（含真实堆栈）
  * Ctrl+Z 撤销（异步 diff）：getCategories/getTables 落定后 13 个 updateTable 顺序 await 执行；导入 2 表后撤销 → removeTable ×2 await、卡片 12→10
  * 页面链路：字典页（getDicts → 5 字典渲染）、模板页（getTemplates → 4 模板）、设置页保存（saveSettings →「设置已保存」，本地状态成功后才更新）、导入对话框（importFromDB → 5 表渲染、导入 2 表 addTable ×2 await）、刷新按钮（load）、重置演示数据（resetDemo → load/getDicts/getTemplates/getSettings 四路并发发起逐个落定、10 卡片）、分类新增/删除（addCategory/removeCategory await + 大纲同步 + 无表分类可删）
  * 全程 agent-browser errors 为空
- vue-tsc 通过；vp check --fix 修正 2 文件格式（demo-manager-api.ts/template.ts 新代码换行）后 48 文件 lint 无告警；vp build 通过（2.71s）；check-readme.py 通过
- 留档：patch/20260911084001.patch（11 文件 44K）；重新打包 download/graph-db-model-editor.zip（115 文件 5.3M）

Stage Summary:
- 契约演进：ManagerApi 27 个契约方法 + resetDemo 扩展全部异步化（Promise 返回、校验失败 reject），UI 调用链路（4 store + 3 组件 + history restore）全量 await 适配，事务模式（本地先行 → await → 失败回滚）与顺序语义（syncToApi 分组 diff、逐表 await）完整保留；对接真实后端（HTTP/IPC）时零调整
- 关键决策：① 日志 Proxy 异步感知——thenable 落定后打印 resolved 值/reject 时 error 级透传，保证可观测性不因异步化降级；② replace 错误处理语义上移——demo 内部 catch 改为 reject 向调用方传播（ReplaceConfirmModal 捕获提示），契约更符合「调用方决定如何反馈失败」；③ settings.save 改「api 成功后才更新本地」，消除异步下本地/持久层短暂不一致
- 交付物：snapshot/20260911082250.zip、patch/20260911084001.patch（11 文件）、download/graph-db-model-editor.zip（115 文件）

---
Task ID: 14 / 15（补录）
Agent: main (Super Z)
Task: 14 GitHub 远程发布（历史规整 + 推送）；15 移除 Pinia（provide/inject 全局状态）+ vite 库模式构建

Work Log:
（补录说明：Task 14 期间的 git 历史规整使 worklog 对应条目散佚，此节按 git 提交记录回填，详细过程见各提交）
- Task 14：filter-branch 规整 15 个 UUID 提交为 conventional commits、从历史移除 tool-results/.env/download/README.md、作者统一 dbm-editor-agent、`.gitignore` 补 tool-results/；推送 main 成功（20051f7、2bc8c81）
- Task 15：DBManagerView 经 createDBManagerState + provide/inject 注入整套 reactive 仓库（theme/ui/model/canvas/dict/template/settings/history），删除 Pinia 依赖；vite 库模式（entry src/index.ts，产物 dist/DBManager.js + DBManager.d.ts，vue/antdv-next/@lucide/vue external，CSS 经 lib-inject-css 内联）；package.json 改库元数据（exports/types/peerDependencies）（0e19411）

Stage Summary:
- 仓库发布至 GitHub bkbits/dbm-editor（main）；库产物形态确立：单文件 ES 模块 + 滚动 d.ts

---
Task ID: 16
Agent: main (Super Z)
Task: ① 删除快照/补丁流程（snapshot/patch 目录与脚本）② 设计令牌 --dbm- 前缀化 + 新建 antd-theme.scss 同步 antd 主题 ③ AGENTS.md 完善为协作规范 ④ 新建 skills/DBManager 技能文档 ⑤ 提交推送

Work Log:
- 移除快照/补丁流程：git rm scripts/snapshot.sh scripts/patch.sh（目录本就不存在）；vite.config.ts fmt.ignorePatterns 与 .gitignore 删除 snapshot/patch 条目；scripts/package.sh 删除对应 rsync 排除项、新增 skills/DBManager 白名单包含规则
- antdv-next cssVar 机制实测（先改 DBManagerView 临时加 cssVar: true 再浏览器验证后固化）：启用后 a-app 根元素与所有 antd 组件携带 `css-var-v-0` 类，`.css-var-v-0{--ant-*:值}` 样式注入运行时；65 个全局令牌可解析（--ant-color-primary/text/bg-container/bg-layout/border/margin 系/font-family-code 等，kebab-case 命名），:root 上为 0（作用域仅在带类元素子树）
- 传送门验证：a-modal 传送到 body 下空 DIV（.app-provider 之外），但 .ant-modal-root 自带 css-var-v-0 类 → antd 变量在其上可解析，这决定了映射选择器需同时覆盖组件树与传送弹层
- codemod（scripts/codemod-dbm-prefix.py，一次性，用后删除）：解析 variables.scss 全部 77 个令牌，按长度降序 + 负向前瞻防 --bg 误伤 --bg-2，五类形态全量替换——var(--x) 引用（467 处）、getPropertyValue('--x')（Minimap 3 处）、cssVar('--x')（ModelCanvas 2 处）、--x: 定义、`--cat-${` 模板字符串（Minimap）；改写 21 个文件；TableCard 局部变量 --cat-color 非 variables.scss 令牌，正确未动
- 手工补漏三处：TableCard.vue:54 与 OutlinePanel.vue:78 的 `var(--cat-${...})`（codemod 模式未覆盖的书写形态）→ var(--dbm-cat-…)；Minimap getComputedStyle(documentElement) → getComputedStyle(cv)（小地图画布元素，antd 映射值才能被 JS 读到，documentElement 上只有静态基线）；Minimap 视口矩形硬编码 rgba(13,148,136,0.08) teal 填充 → 读 --dbm-primary-weak（跟随映射）；ModelCanvas cssVar 保持读 documentElement（网格线为未映射静态令牌，[data-theme] 翻转足够）
- 新建 src/styles/antd-theme.scss：`.app-provider, [class*='css-var-']` 双选择器（前者=组件树根必带 antd css-var 类；后者属性子串匹配覆盖传送弹层根节点），全部可映射令牌重定义为 --ant-* 引用：字体（含 --ant-font-family-code）、圆角（radius-l 用 calc(lg+4px) 相对联动）、间距（对齐 antd margin 档位）、背景/文本/边框、品牌与语义色（weak→antd 对应 bg）、卡片/导航线/代码块底/阴影/蒙层/滚动条；edge-select-glow 用 color-mix(in srgb, --ant-color-primary 40%, transparent)；未映射令牌（网格线/代码高亮配色/分类色板/布局尺寸）沿用 variables.scss 静态基线并在文件头注释说明；index.scss 追加 @use；global.scss .app-shell 补 background: var(--dbm-bg)（整页跟随 antd 布局背景，body 静态色仅作挂载前兜底）
- variables.scss 头注释更新为「--dbm- 命名空间 + 静态基线」定位说明
- 浏览器实测（localhost:3000）：亮色 --dbm-primary=#1677ff/--dbm-bg=#f5f5f5/panel=#ffffff/radius-m=8px/space-4=16px、未映射令牌回落静态基线（grid/cat/code 正确）；暗色翻转 primary=#1668dc/bg=#000000/panel=#141414/text-1=rgba(255,255,255,.85)；传送 modal（body 下）rootPrimary=#1668dc 映射生效；var() 链在 getComputedStyle 下解析为具体值（Minimap JS 读取拿到映射色）；VLM 检查亮暗截图均无样式破损（主题色 teal→antd 蓝切换完整、无残留）
- 构建校验：vp build 通过，dist/DBManager.js 479KB（内联 CSS 56K 字符），含 661 处 --dbm- 令牌、antd-theme 选择器 `app-provider,[class*=css-var-]`、零残留未加前缀老令牌
- AGENTS.md 重写：保留 vp 注入段落，新增项目概览（库定位/远程/GitHub）、常用命令表、架构关键约定（无 Pinia provide/inject、ManagerApi 异步契约、主题三层结构、库构建 external、环境目录边界）、代码风格、任务工作流（校验链→worklog→中文 conventional commit→push）、目录导读
- 新建 skills/DBManager/SKILL.md（frontmatter name/description + 宿主集成三步/ManagerApi 契约全方法示例/主题三层定制指南/快捷键/本地开发/常见排查表）；.gitignore `/skills/` 改为 `/skills/*` + `!/skills/DBManager/` 白名单（目录排除需先改为通配才能再包含）
- README 同步：删除「源码快照与修改补丁」整节（TOC/脚本表两行/目录树三行/文末章节）、脚本表 package.sh 行补 skills 说明、目录树加 skills/DBManager、styles 行改「--dbm- 设计令牌（静态基线）/ antd 主题同步层」、主题章节重写为三层结构说明；check-readme.py 通过（29 标题）
- 验证链全绿：vue-tsc 通过；vp check --fix（README/DictView 格式）后 60 文件格式 + 51 文件 lint 零告警；check-readme.py 通过；vp build 通过；浏览器回归（拖拽/四页切换/modal 开关/控制台零错误）

Stage Summary:
- 主题体系演进为三层：--dbm- 命名空间静态基线（variables.scss，亮暗双套）→ antd 同步层（antd-theme.scss，映射 --ant-*）→ 未映射令牌回落基线；组件外观从此跟随宿主 antd 主题（品牌色/暗色算法/令牌覆盖自动联动），主色由内置 teal 切换为 antd 蓝
- 关键决策：① 映射作用域双选择器 .app-provider + [class*=css-var-]——实测确认 antd 弹层传送到 body 但自带 css-var 类，单靠组件树选择器会漏弹层；② Minimap 改从画布元素读变量（documentElement 读不到映射值）；③ color-mix 用于 antd 无对应物的透明度派生色（select-glow）；④ grid/代码高亮/分类色板保持静态（无 antd 对应物，映射反而降级设计）
- 流程瘦身：删除快照/补丁脚本与全部引用（vite.config/.gitignore/package.sh/README），会话留档统一收敛到 worklog.md + git 提交
- 交付物：skills/DBManager/SKILL.md（随仓库发布的技能文档）、docs/screenshots/theme-antd-{light,dark}.png、dist/DBManager.js + DBManager.d.ts

---
Task ID: 17
Agent: main (Super Z)
Task: Demo 脚本模板升级为 solon3 + easy-query + satoken 七件套（entity/service/serviceImpl/controller/vue/sql/menuSql），创建 devel 分支提交并推送

Work Log:
- SEED_TEMPLATES 重构（src/mock/seed.ts）：旧通用四件套（entity/dao/service/sql）替换为技术栈七件套，删除 dao（easy-query 下 Service 直注 EasyQuery，无 DAO 层）
  - entity：easy-query `@Table`/`@Column` 显式列名 + Lombok `@Data` + Serializable；日期/BigDecimal/List import 按需收集去重；导航关系生成注释形态建议（@Navigate PropType 映射 1N→ONE_TO_MANY、NN→MANY_TO_MANY、11/N1→ONE_TO_ONE，默认注释掉避免生成未配置关系的错误映射）；主键 javadoc 标注（comment 已含「主键」时不重复追加）
  - service / serviceImpl：接口五方法（getById/listAll/create/update/removeById，写操作返回 long 影响行数）；实现类 solon3 `@Component` + `@Inject EasyQuery`，CRUD 用 queryable().whereId().firstOrNull() / toList() / insertable().executeRows() / updatable().executeRows() / deletable().whereId().executeRows()
  - controller：solon3 MVC（`@Controller` + 类级 `@Mapping("/api/<kebab>")` + 方法级 `@Get/@Post` + `@Param`/`@Body`）+ satoken `@SaCheckPermission("<mod>:info|list|add|edit|del")`；权限码与 menuSql 按钮权限一一对应，vue 请求路径与 @Mapping 路由一致（三模板联动约定）
  - vue：antdv-next 标准管理页（a-card/a-table/a-modal/a-form；`import { message } from 'antdv-next'` 与本仓库风格一致）；interface/columns/emptyForm 按列生成，ts 类型按 javaType 映射（数值型→number 其余→string）；表单控件按类型路由（数值→a-input-number、LocalDateTime→a-date-picker+value-format、LONGTEXT→a-textarea、其余→a-input，主键列不进表单）；fetch 调用后端五个路由
  - sql：MySQL 建表增强——单整数主键 AUTO_INCREMENT、PRIMARY KEY 行 + UNIQUE KEY/KEY/FULLTEXT INDEX 随表索引生成、显式 NULL/NOT NULL、COLLATE utf8mb4_general_ci；末项逗号按「列+尾部项」总数计算避免悬空逗号；COMMENT 全部单引号（sq 函数，内嵌单引号双写转义）
  - menuSql：sys_menu 菜单（menu_type C + path kebab + component 指向 vue 产物）+ 5 个按钮权限（F）+ `SET @menuId = LAST_INSERT_ID()` 父子关联 + NOW()
- **Eta 引号陷阱定位与修复**：sq 函数首版用 `.replace(/'/g, "''")`，Eta v4 解析器跟踪标签内引号状态时把正则字面量中的 `'` 误判为字符串开始 → 引号状态错乱 → `%>` 标签边界识别失败（Bad template syntax，26 处渲染失败）；scripts/eta-sq-debug.ts 三用例对比定位（正则含单引号两例均失败、split/join 通过），改为 `String(s).split("'").join("''")` 后全绿。结论：Eta 模板标签内避免使用含引号字符的正则字面量
- db.ts v2 读取迁移：localStorage 旧数据仍为旧种子形态（含 tpl-dao 且无 tpl-controller）时整体替换 templates 为新七件套；templates 非数组亦重置；用户删光或已升级场景不受影响
- README 同步：演示数据描述 4→7 个模板；「内置 4 个模板」改七件套表格（模板/产物/技术栈适配三列）+ 三模板权限码/路由联动说明
- 渲染冒烟（scripts/render-demo.ts，一次性脚本已登记 .git/info/exclude 不入库）：13 种子表 × 7 模板 = 91 次渲染全通过（校验无异常/无 undefined/无 Eta 标签残留/fileName 均设置），产物存 tool-results/render-demo/ 人工抽查（联合索引、AUTO_INCREMENT、vue 模板字符串转义 `${API_BASE}` 原样输出、solon3/satoken 注解形态均正确）
- 验证链：bun run typecheck 通过；vp check --fix（README 表格格式）后 60 文件格式 + 51 文件 lint 零告警；python3 scripts/check-readme.py 通过（29 标题）
- 创建 devel 分支，提交后 `git push -u origin devel`

Stage Summary:
- 内置模板从「通用伪代码」升级为「可直接落地的 solon3 + easy-query + satoken + antdv-next + MySQL 全栈脚手架」：一套数据驱动七层产物（实体→服务→实现→接口→前端→建表→菜单权限），权限码与路由在 controller/menuSql/vue 三模板间自动对齐
- 关键决策：① entity 导航属性以注释形态生成（避免未配置关系的 @Navigate 生成错误 SQL）；② 写操作返回影响行数（贴合 executeRows 返回值，便于 satoken 权限下审计）；③ MySQL 字符串一律单引号且经 sq 转义（utils.quote 双引号不符合 MySQL 惯例）
- Eta 模板编写新增一条避坑经验：标签内正则字面量不得含引号字符（解析器引号状态机不识别正则上下文）
- 工作分支策略变更：本次起功能开发走 devel 分支（main 保持稳定发布线）

---
Task ID: 18
Agent: main (Super Z)
Task: 修复「首次加载 solon3 七件套模板未生效」——模板迁移改 seedTemplatesVersion 版本号驱动 + 首载即落盘种子；提交推送 devel

Work Log:
- 问题定位（agent-browser 1920×1080 实测，隔离 worktree 复跑 devel 代码）：
  * 全新浏览器加载：七件套正常显示（createSeedDB 路径）✓
  * 旧四件套 localStorage（含 tpl-dao）重载：形态嗅探迁移正常触发 ✓
  * 七模板渲染复查：entity/service/serviceImpl/controller/vue/sql/menuSql 对种子表渲染标记全部存在（public class / public interface / EasyQuery / @Controller / template 标签 / CREATE TABLE / INSERT INTO），0 控制台错误 ✓
  * 根因一（环境）：会话沙箱在工具调用间隙会把工作区自动切回 main——上一任务提交 devel 后工作区回落 main，预览/自测实际运行旧四件套代码（无迁移逻辑），表现即「首次加载未生效」
  * 根因二（代码缺口）：Task 17 迁移条件为形态嗅探（含 tpl-dao 且无 tpl-controller）——用户曾删除 tpl-dao（或模板数组残缺）的旧库永远不满足条件，升级静默失效
- 修复（src/mock/db.ts）：
  * 新增 SEED_TEMPLATES_VERSION = 2 常量与 MockDB.seedTemplatesVersion 可选字段；createSeedDB 写入版本号
  * 迁移条件改为 (seedTemplatesVersion ?? 1) < SEED_TEMPLATES_VERSION——旧库一律升级（与用户是否删过某个种子模板无关），升级后回写版本号，此后用户增删改模板不再被种子覆盖；删除形态嗅探分支
  * loadDB 回退种子路径补 db = createSeedDB() + persistDB()——首次加载即落盘（消除「内存已有、存储为空」的首载分歧，宿主侧可直接观测 localStorage）
- 验证（隔离 worktree + agent-browser，5 场景全部通过、0 控制台错误）：
  * 全新加载：localStorage 立即含 7 模板 + 版本标记 2（新增首载落盘行为）
  * 旧四件套（含 dao）重载 → 迁移命中：7 模板 + 版本 2
  * 旧库曾删 dao（旧逻辑漏判场景）重载 → 迁移命中：7 模板 + 版本 2（本次修复核心）
  * 版本已是 2 时删除 vue 模板重载 → 仍 6 个（用户定制不被种子恢复）
  * bun run typecheck 通过；vp check 60 文件格式正确 + 51 文件 lint 零告警
- 提交推送到 devel 分支

Stage Summary:
- 模板种子迁移从「形态嗅探」升级为「seedTemplatesVersion 版本号驱动」：旧库确定性升级（覆盖删过模板的边缘形态）、升级一次性、用户后续定制不受影响；未来种子模板变更只需递增版本常量
- 首次加载（无有效存储）即落盘种子数据，localStorage 与内存态从首载起一致
- 排障经验：会话沙箱在工具调用间隙自动把工作区切回 main——跨分支验证必须用 git worktree 隔离（.wt/devel，已登记 .git/info/exclude），跨分支操作须在单条命令内原子完成

---
Task ID: 19
Agent: main (Super Z)
Task: 全站移动端布局适配（≤768px 断点：顶栏/大纲抽屉/双栏视图堆叠/对话框响应式/多列表格横滚）；提交推送 devel

Work Log:
- 前置：合并 devel → main（fast-forward 0cc4a7a→5b3fba9）并推送 origin/main；此后 main 与 devel 同基，沙箱工具调用间隙的分支自动翻转不再影响未提交工作区内容
- 顶栏（AppHeader.vue）：≤1024px 藏英文副标题；≤768px 藏中文标题（保留品牌图标）、导航改图标态（隐藏文字 span）、按钮/间距缩紧凑；导航按钮补 title + aria-label（图标态下保留可访问名称）
- 大纲抽屉（OutlinePanel.vue + EditorView.vue + ui store）：ui 新增 mobileOutlineOpen / toggleMobileOutline / closeMobileOutline；≤768px 侧边栏转 fixed 滑入抽屉（min(300px, 84vw)、0.22s 过渡、投影），画布左上角悬浮开关（PanelLeft/X 图标切换，桌面 display:none）+ 遮罩层（z-index 30/40 分层）；选中表行后自动收起；matchMedia 监听窄屏→宽屏自动复位；触屏无 hover：分类行内操作按钮与眼睛按钮常显
- 画布（CanvasToolbar / Minimap）：工具栏 ≤768px 紧凑间距、生成范围文字隐藏、toolbar-right 整行换行（原有 flex-wrap 保持）；小地图窄屏隐藏（display:none）
- 字典管理（DictView.vue）：左右分栏改上下堆叠（列表 32vh 限高、边框改下沿）；字典值六列栅格（值键/标签/类型/颜色/注释/删除）改双列卡片——注释独占整行、删除按钮靠右、表头隐藏（输入框自带占位）、v-body 解除内部限高改外层滚动；图例提示换行
- 模板管理（TemplateView.vue）：模板列表转顶部条区（26vh）；tpl-split 左右分屏改单列堆叠（编辑 minmax(180px,42%) / 预览 minmax(160px,1fr)）；tpl-head 允许换行；帮助面板双列改单列
- 系统设置（SettingsView.vue）：内边距 18px 20px→12px；规则六列栅格隐藏 #序号列（:nth-child(2)）并收缩正则/类型列宽；底部操作栏允许换行
- 对话框（6 个）：:width 固定像素改 width="min(设计宽, 94vw)" 字符串（480/620/640/880/980 六档）+ wrapClassName="dbm-modal-wrap"；global.scss 新增 .dbm-modal-wrap 内容体 max-height 滚动（桌面 100vh-200px / 移动 100vh-150px）与移动端水平钳制
- TableEditDialog：字段/索引表格包 .grid-scroll 横滚容器（表头与数据行同滚，列对齐不漂移）；≤768px cols-grid min-width 780px、idx-grid 560px、基本信息四列改双列、columns-body 44vh；NavigateEditDialog 三/二列表单改单列（注意 :has 选择器特异性，媒体查询内并列声明覆盖）
- 触屏细节（global.scss）：弹层/树/列表/代码区 -webkit-overflow-scrolling: touch；字典值删除按钮 24→28px 点按目标
- 验证（agent-browser，390×844 / 768×1024 / 1920×1080 三档）：
  * 顶栏：52px、标题 none、导航 4 图标态、无水平溢出；768 边界抽屉态生效
  * 抽屉：开关点击开合、遮罩 block/z30、transform 全程断言、选表后自动收起、桌面复位
  * 画布：全宽 390、小地图 none、工具栏 95px 换行 2-3 行、范围标签 none
  * 字典：column 堆叠、列表 390×270（=32vh）、值网格 repeat(2, minmax(0,1fr))、表头 none
  * 模板：列表 390×219（=26vh）、split 单列 370px、编辑区横滚（scrollWidth 1073/368）且高亮 overlay 滚动同步（scrollLeft 120/120）
  * 设置：内边距 12px、规则 5 列（22px 120px 118px 44px 26px）、序号列 none
  * 表编辑弹窗：宽 367px（≤94vw）、body max-height 694px、字段表横滚（scrollWidth 780/可视 319）
  * 桌面回归：标题 block、大纲 268px static、小地图 block、悬浮开关 none、工具栏 37px 单行、无溢出
  * 三档全程 0 控制台错误；VLM 四截图审查（编辑器/字典/模板/抽屉）——仅模板编辑区长行无换行一项，经 DOM 断言确认为代码编辑器正常横滚行为（静态截图不显示滚动条），非缺陷
- 校验：bun run typecheck 通过；vp check --fix 60 文件格式 + 51 文件 lint 零告警；check-readme.py 通过（30 标题）
- README：新增「响应式与移动端适配（≤768px）」小节（8 行为区域表）+ 非功能说明补窄屏兼容条目

Stage Summary:
- 全站 768px 断点自适应完成：顶栏图标化、大纲转滑入抽屉（开关/遮罩/自动收起/宽屏复位）、字典与模板视图上下堆叠、设置紧凑化、六对话框响应式宽度与内容体滚动、字段/索引多列表格整体横滚（表头行同滚保列对齐）
- 设计原则：仅媒体查询覆盖 + 少量结构包装（grid-scroll），零业务逻辑改动；桌面布局零回归（1920×1080 全量断言通过）；触屏可用性细节（惯性滚动、去 hover 依赖、点按目标放大）
- 已知边界：画布缩放在触屏上依赖工具栏按钮（双指捏合缩放未实现，列为后续增强项）；模板编辑器长行不自动换行（与桌面一致的代码编辑器横滚语义）
- 本次修改提交推送到 devel 分支（main 已在本任务开头合并至同基 5b3fba9）
---
Task ID: 20
Agent: main (Super Z)
Task: 修复「移动端模板页底部说明文字与代码区重叠」——tpl-split 行轨最小值归零 + 帮助面板可折叠（默认收起/展开限高滚动）；提交推送 devel

Work Log:
- 问题复现（隔离 worktree + agent-browser，390×844）：`.tpl-split` 弹性容器实际仅 63.9px，而移动端行轨 `minmax(180px,42%)/minmax(160px,1fr)` 硬最小值之和（348px+8px gap）远超剩余高度——网格内容溢出容器达 116px；`.tpl-help` 单列堆叠后自然高度 394.6px，紧贴容器盒子（而非容器内容）排版，与编辑器（367.5–547.5）/预览（555.5–715.5）矩形直接相交（DOM 断言 + VLM 截图双重确认）
- 修复（src/views/TemplateView.vue，仅移动端媒体查询 + 少量模板结构，零业务逻辑改动）：
  * 行轨改 `minmax(0, 42fr) minmax(0, 58fr)`：最小值归零后网格永不溢出弹性容器——任意视口、任意帮助面板开合状态下零重叠的不变量；编辑/预览按 42/58 比例分配剩余高度
  * 帮助面板加折叠开关：help-title 右侧 ChevronUp/Down 图标按钮（28px 点按目标，aria-expanded/aria-label/title 齐备）；`helpOpen` ref + matchMedia(768px) 初始化（移动端默认收起、桌面始终展开）+ 窄屏转宽屏自动复位展开（与大纲抽屉同款模式）+ onBeforeUnmount 解绑监听
  * 展开态 `.tpl-help` 限高 40vh + overflow-y 内部滚动 + 触屏惯性滚动（单列自然高度约 400px，不限高会挤占代码区甚至溢出主区）
  * `.help-toggle` 桌面 display:none（桌面面板始终展开，行为与修复前完全一致）
- 验证（agent-browser 四档视口 + VLM 截图审查 + 全量代码检查）：
  * 390×844 折叠态：split 408.5px（编辑 168 / 预览 232）、help 收起 50px、helpOverlapsEditor/Preview 均 false、行轨完全收纳（原 +116px 溢出 → -240px）；展开态：help 337.6px（=40vh 限高）内部可滚、split 121px 按比例收缩、仍零重叠
  * 375×667 小屏：折叠态 split 278px（113/156）、help 50px、零重叠、重载后默认收起 ✓
  * 768×1024 边界：移动布局生效、split 574px（238/328）、零重叠
  * 1920×1080 桌面回归：编辑/预览恢复左右并排（各 832px、同顶）、帮助面板自动复位展开（200px、无限高）、折叠开关 display:none——桌面与修复前零差异
  * 开关交互：真实点击 aria-expanded false→true、help-grid display none→grid、help 高 50→338px；全程控制台 0 错误
  * VLM 三图对比结论：修复前「底部说明文字与代码区明显重叠」→ 修复后折叠/展开两态「均无重叠、层级清晰」
  * bun run typecheck 通过；vp check 60 文件格式正确 + 51 文件 lint 零告警
- README：响应式表格「模板管理」行补「帮助面板可折叠（默认收起，展开限高 40vh 滚动）」
- 提交推送到 devel 分支

Stage Summary:
- 移动端模板页重叠缺陷根治：根因是网格行轨硬最小值之和超出父级弹性容器实际高度（内容可见溢出）叠加帮助面板单列自然高度过高；行轨最小值归零（minmax(0, fr)）从机制上消除溢出可能，折叠开关把约 400px 的说明面板变为按需展开
- 桌面零回归（帮助面板始终展开、开关隐藏、双列分屏原样）；移动端代码区从被遮挡恢复为折叠态约 408px 可用高度
- 经验沉淀：grid 行轨含 px 硬最小值 + 父级 flex 弹性压缩 = 溢出重叠隐患；弹性高度场景行轨一律 minmax(0, fr)
---
Task ID: 21
Agent: main (Super Z)
Task: 模板上下文新增 hasColumn/getColumn 函数 + entity 模板按 easy-query 规范重写（@Table/@Column 命名直转省略、@FieldNameConstants、@Navigate 导航、ICreate/IUpdate/IGenId/IDeptId 审计接口、树形表 parent/children）；提交推送 devel

Work Log:
- 前置：加载 easy-query-orm skill（github.com/wzszsw/easy-query-orm），读取 entity-mapping.md / entity-modeling-navigate.md / interceptor.md——确认 @Column(primaryKey = true) 主键标记、@Navigate 参数形态（RelationTypeEnum/selfProperty/targetProperty/mappingClass + Fields 常量）、lombok @FieldNameConstants 生成 Fields 内部类、审计字段惯例（createTime/createBy/updateTime/updateBy）
- TemplateContext（src/types/model.ts）新增方法签名：hasColumn(columnName): boolean（按数据库列名精确匹配是否存在）、getColumn(columnName): TableColumn | undefined（按列名取列对象）
- 渲染管线（src/utils/render.ts）：renderTemplate 构建 context 时闭包绑定两函数（基于 table.columns 的 some/find）；spread 返回不丢失函数引用，预览与批量生成两条调用链（renderFor/generateFiles）同时生效
- entity 模板重写（src/mock/seed.ts tpl-entity）：
  * @Table 省略：toSnakeCase(类名) === 表名 时省略注解与 import（easy-query 默认驼峰转下划线映射正好命中）；演示库 13 表中 sys_user/cms_* /mall_* 等规范命名表全部省略
  * @Column 省略：toSnakeCase(属性名) === 列名 时省略 value 参数；主键列输出 @Column(primaryKey = true)（easy-query 主键必须标记，serviceImpl 的 whereId 依赖）；两者并存时 @Column(value = "xxx", primaryKey = true)；完全无参数时整个 @Column 省略
  * @FieldNameConstants：lombok 注解 + import lombok.experimental.FieldNameConstants，导航注解的属性引用全部使用 Fields.xxx 常量（本表 Fields.x / 目标表 Target.Fields.x / 中间表 Mapping.Fields.x）
  * @Navigate 真实生成（替换原注释掉的示例）：'11'→OneToOne / '1N'→OneToMany / 'N1'→ManyToOne / 'NN'→ManyToMany（含 mappingClass + selfMappingProperty/targetMappingProperty 四组属性）；selfProperty 等存的是数据库列名，模板内经 propOf() 转属性名再拼 Fields 常量；多列关联自动 { Fields.a, Fields.b } 花括号数组形式
  * 审计接口：hasColumn('create_time')&&hasColumn('create_by')→ICreate；update_time+update_by→IUpdate；id→IGenId；dept_id→IDeptId（接口为项目框架内部接口，包路径由使用者按框架补充 import）
  * 树形导航：table.parentIdColumn 存在时生成 parent（ManyToOne, selfProperty=Fields.parentId, targetProperty=Fields.id）与 children（OneToMany 反向）
  * import 按需精确化：Table/Column/Navigate/RelationTypeEnum/List 均按实际使用输出
- SEED_TEMPLATES_VERSION 2→3（src/mock/db.ts）：旧库（含 v2 七件套）读取时自动升级 entity 模板并回写版本号；v3 后用户增删改模板不再被种子覆盖
- 模板页帮助面板（TemplateView.vue）补 context.hasColumn/getColumn 两行说明
- 验证（agent-browser + 隔离 worktree dev server）：
  * sys_user：@Table 省略 + id 主键 @Column(primaryKey = true) + 规范列零注解 + IGenId + NN roles（mappingClass=SysUserRole + 四组 Fields 属性）+ 反转视角 1N articles/comments/orders
  * cms_category：树形导航 parent/children（Fields.parentId ↔ Fields.id）+ 反转 1N articles
  * cms_article：N1 user/category + 1N comments + NN tags 三类导航混合，Fields 常量全部正确
  * 边缘注入（localStorage 直改 mock 库）：表名 t_sys_user → @Table("t_sys_user") 保留；列名 nickName（与属性 nickname 不互转）→ @Column("nickName") 保留；补 create_time/create_by/update_time/update_by/dept_id 五列 → implements Serializable, ICreate, IUpdate, IGenId, IDeptId 五接口全触发
  * 迁移回归：全新加载 7 模板 v3；伪造 v2 旧库（entity 被篡改）重载 → 自动升级 v3 且模板恢复；v3 后删 sql 改 entity 重载 → 定制保留（6 模板、篡改内容不复活）
  * 全模板×12 表 84 次渲染零错误；输出无 undefined/NaN/连续空行；控制台 0 错误
  * bun run typecheck 通过；vp check 60 文件格式 + 51 文件 lint 零告警
- README：TemplateContext 代码块补两函数签名；内置模板表 entity 行更新为 easy-query 规范化描述
- 提交推送到 devel 分支

Stage Summary:
- 模板上下文具备列查询能力（hasColumn/getColumn），entity 模板从「显式全量映射」升级为「easy-query 规范化智能省略」：命名可直接转换的 @Table/@Column 自动省略、主键正确标记 primaryKey、导航从注释示例变为可直接编译的 @Navigate（Fields 常量风格）、审计/主键/部门/树形接口按列特征自动实现
- 种子版本驱动迁移（v2→v3）：旧库确定性升级，用户后续定制不受影响
- 环境注意：会话沙箱开始清理后台进程（dev server 需在单条命令内启动+验证）；worktree 曾被清理重建（bun install 442ms 恢复）

---
Task ID: 22
Agent: main (Super Z)
Task: 选项体系 + 代码生成配置落地——Settings 扩展（author/表选项/列选项元定义）、Table/TableColumn 挂选项值与启用模板、TemplateContext.settings/aborted、java 模板全面升级（javadoc/@author/@since、@EntityProxy+ProxyEntityAvailable、swagger2、MapStruct mapper 新模板、选项驱动条件生成）、import 后空行格式保证、生成/替换模板选择弹窗；提交推送 devel

Work Log:
- 类型层（src/types/model.ts）：新增 OptionType（内置 5 类型 + 自定义字符串，`(string & {})` 保住字面量提示）/OptionSetting/TableOption/ColumnOption；Settings 增 author?/tableOptions/columnOptions；Table 增 templates?（逗号分割启用模板，缺省=全部）与 options?（TableVO 经继承获得，持久化经 ManagerTable 自然透传）；TableColumn 增 options?；TemplateContext 增 settings + aborted（默认 false，true=丢弃不打包）；Navigate 增 comment 透传（@ApiModelProperty 导航说明用）
- 渲染管线（src/utils/render.ts + string.ts）：renderTemplate 第 5 参 settings（缺省空设置兜底）；context.aborted 初始 false；新增 utils.nowDateTime()（yyyy-MM-dd HH:mm:ss）与 utils.optionEnabled(options, name)（**值缺省视为启用**——单一规则，向后兼容旧数据全量生成行为）；postProcess 保持折叠，追加 ensureBlankLineAfterImports 行级状态机（java `;` / js-ts `from '...'` / 裸模块说明符三种结束形态，多行 import 兼容）——**所有模板**最后一条 import 与后续代码之间恰好空一行（引擎级保证，不依赖模板作者）
- 仓库层：settings store 增 author/tableOptions/columnOptions + snapshot()（渲染管线注入源）；context.ts 给 template store 接 getSettings；template store generateFiles(tableIds, templateNames?) 增三层过滤——会话选择 ∩ 表级 Table.templates ∩ 模板 aborted 跳过，返回值增 aborted 清单；generateAndDownload/replaceWithGenerated 透传选择参数（生成成功提示附丢弃计数）；model store createTable/saveTable 透传 templates/options（新表 options.tableId 落库时归一）
- 种子模板（src/mock/seed.ts，经 scripts/templates/*.eta + scripts/splice-seed.py 拼接注入）：
  * entity：@Table 常驻（命名直转时无参）、@EntityProxy、implements Serializable, ProxyEntityAvailable<Xxx, XxxProxy>（代理 import 自 `<pkg>.entity.proxy`）、swagger2 @ApiModel("表说明") + 全属性（含导航/树形 parent/children）@ApiModelProperty("属性说明")、类 javadoc 带 @author settings.author（空则省略）+ @since 当前时刻
  * mapper（新增，八件套）：MapStruct @Mapper + `INSTANCE = Mappers.getMapper(XxxMapper.class)` 静态单例；toEntity(XxxAddDTO)/toEntity(XxxUpdateDTO) 按 add/update 选项生成；**两者全关 → context.aborted = true 整模板丢弃**（Eta 标签内 `return ""` 提前退出）
  * service/serviceImpl：仅五方法 getById(@Nullable)/add/update/remove/batchRemove(@NotNull)，按表选项选择性生成；**add/update/remove 全关 → 丢弃**（字面规格：query 开也不能免）；实现 @Component + @Inject EasyQuery（whereId/insertable/updatable/deletable/whereByIds）
  * controller：info/list/add/edit/del/batchDel 按表选项生成；list 注入 EasyEntityQuery + 门控谓词（字符串列 like / 其余 eq，`o.x().like(x != null && !x.isEmpty(), x)`）；**列选项 query 启用的非主键列 → list 可选 @Param(value=..., required=false) 查询参数**；service 被丢弃时（写选项全关）info 直查 easyEntityQuery 避免悬空引用、不注入不 import service；四选项全关 → 丢弃
  * vue：列表列按列选项 show、表单字段按 add||update、新增/编辑/删除按钮按表选项生成；menuSql：按钮权限行按表选项生成（与 controller @SaCheckPermission 对齐）；sql 不变（无 import）
  * SEED_SETTINGS：author 'dbm-editor' + SEED_TABLE_OPTIONS（query/add/update/remove）+ SEED_COLUMN_OPTIONS（show/query/add/update/remove）
- 迁移（src/mock/db.ts）：SEED_TEMPLATES_VERSION 3→4（八件套整体替换）；migrateSettings → normalizeSettings——旧库 author/tableOptions/columnOptions 任一缺失即归一补齐（保留已有 indexTypes/typeMappings/author），v3 伪造库实测：模板升级 8 个、设置补齐、表级用户数据（sys_user 的 templates/options）原样保留
- 契约（src/api/demo-manager-api.ts）：getSettings 返回完整形态；saveSettings 增选项定义校验（名称非空唯一、类型/标签兜底）并持久化新字段
- UI：
  * TableEditDialog：基本信息区新增「启用模板」复选组（未配置/未手动改动时展示全部=语义全选；全选保存为 undefined；手动取消至空被校验拦截——空串语义即全部，无法表达"一个不选"）与「表选项」勾选/输入混排行；字段表格追加列选项动态列（boolean=勾选列 42px / 其余=输入列 96px，grid-template-columns 行内绑定，表头带 label+remark 提示）；选项定义异步加载后 watch 补齐缺省值；扁平值⇄options 记录转换（**boolean 仅存 false**，true=缺省即启用，存储紧凑）
  * SettingsView：新增「代码生成」卡片——author 输入 + 表选项/列选项定义编辑表（名称/类型/标签/说明/字典，类型 auto-complete 预置 5 类可自定义）；名称合法标识符 + 列表内唯一校验，dirty/保存/放弃全链路接入
  * TemplateSelectModal（新组件）：生成/替换前弹模板勾选框（默认全选、全选开关带 indeterminate、空选禁用确认）；CanvasToolbar 生成/替换改经该弹窗（模式区分按钮文案与后续流程）
  * TemplateView：帮助面板补 settings/aborted/optionEnabled/nowDateTime/格式保证说明；实时预览增 aborted 黄色警示条（渲染提示丢弃）；**顺手修复存量缺陷：切换预览目标表不触发重渲染**（无 previewTableId watcher，本次补上——aborted 提示依赖按表渲染才可验证）
- 验证（agent-browser + 隔离 worktree dev server，会话沙箱清理后台进程改为单命令内启动+操作）：
  * 首载：v4 种子 8 模板 + author/选项定义落 localStorage，0 控制台错误
  * 表编辑对话框：启用模板 8 项全选、表选项 4 勾选、字段表格 5 选项列齐备；交互后持久化正确（templates='entity,...,menuSql' 去掉 vue；options 仅存 {remove:false}；password 列 options.show=false；notNull 误触已复位）
  * 代码预览：serviceImpl（remove 关）无 remove/batchRemove 且 List import 消失；entity 含 @Table/@EntityProxy/ProxyEntityAvailable/proxy import/@ApiModel("用户表")/13 个 @ApiModelProperty（含导航）/@author/@since/最后一条 import 后空行；mapper 含 INSTANCE 单例与双 toEntity
  * 替换流程：模板选择弹窗默认全选 → 确认后文件清单 103 个 = 12 表×8 + sys_user×7（表级 templates 去掉 vue，交集语义正确）
  * 迁移：伪造 v3 旧库（无 mapper/无 author/无选项定义）重载 → v4 + 设置补齐 + sys_user 表级配置保留
  * aborted：cms_comment 关 add/update → mapper 预览显示「模板已标记丢弃」黄色警示、不显示文件路径
  * 移动端 390px：表编辑对话框复选组换行、字段表格选项列横向滚动（scrollWidth 1018 / 可视 319）、模板选择弹窗与设置代码生成卡片正常
  * 渲染冒烟（scripts/render-smoke.ts，worktree 内不入库）：8 模板 × 13 表 = 104 次渲染零错误，选项驱动 8 场景断言全过（mapper/服务/控制器丢弃、仅 add、仅 query、列 query 开关、author 空、表名非直转、menuSql 按钮裁剪）
  * bun run typecheck 通过；vp check 61 文件格式 + 52 文件 lint 零告警；check-readme.py 通过（30 标题）
- README：演示数据 7→8 模板；代码生成/替换流程补模板选择弹窗说明；TemplateContext 代码块补 settings/aborted；工具表补 nowDateTime/optionEnabled；八件套模板表（mapper 行 + 各模板选项驱动说明）+ import 空行格式保证；系统设置补「代码生成」条目；ManagerApi 表 getSettings 描述与类型速览表（Table/TableColumn/Settings）同步

Stage Summary:
- 代码生成从「固定全量七件套」升级为「选项驱动的条件生成体系」：设置定义选项元数据 → 表/列挂选项值 → 模板经 utils.optionEnabled 分支 → abort 机制丢弃无意义产物 → 生成/替换前用户再按需勾选模板；四个层次正交组合（会话选择 ∩ 表级启用 ∩ 选项分支 ∩ aborted）
- 关键决策：① boolean 选项值缺省视为启用（单一规则向后兼容）；② service 丢弃采用字面规格（add/update/remove 全关即丢，query 不豁免），controller 在 service 缺席时 info 直查 easyEntityQuery 消除悬空引用；③ boolean 仅存 false 值（true=缺省），存储紧凑且语义不变；④ @Table 按新规格常驻（直转时省略参数）；⑤ import 空行为引擎级后处理保证（行级状态机兼容 java/js-ts 多行 import），不依赖模板作者
- 顺手修复存量缺陷：模板页切换预览目标表不重渲染（补 previewTableId watcher）
- 交付物：八件套模板（新增 mapper）、选项体系全链路（类型/存储/UI/渲染）、模板选择弹窗、README 30 节

---
Task ID: 23
Agent: main (Super Z)
Task: 修复表编辑对话框字段表双滚动条与表体右侧遮挡（Task 22 列选项追加后暴露）；定位归属并修复；提交推送 devel

Work Log:
- 问题定位（用户报告：字段表格因新增选项列出现「表头表体整体滚动条 + 表体滚动条」两条横向滚动条，滚动整体滚动条后表体右侧被遮挡）：
  * 归属判定：字段表是手写 CSS 网格（.grid-scroll/.columns-head/.columns-body），非 antdv-next a-table —— 问题在本仓库 CSS，不涉及组件库
  * 根因：`.columns-body` 声明 `overflow-y: auto`（纵向限高 320px），按 CSS Overflow 规范单轴非 visible 会把另一轴的 visible **计算值**改为 auto —— 表体意外成为第二个横向滚动容器；Task 22 给字段表追加 5 个列选项列（+约 240px 硬最小宽）后网格最小宽度 1046px 超出弹窗内容宽 932px（980px 弹窗），横向溢出在桌面端显形，双容器症状随之暴露
  * 症状机理：两个滚动容器各自独立滚动——表头溢出驱动外层 .grid-scroll 滚动条（sw 1018），行溢出驱动表体自身滚动条（sw 1046）；滚外层时表体盒子整体平移但其裁剪边界（盒子右缘）不动，行内容超出盒子的 114px（remove 选项列 + 删除按钮列）永远不可见
  * agent-browser 复现实测（1920×1080）：getComputedStyle 证实现算 overflowX=auto；滚 .grid-scroll 至最右后 deleteBtnVisible=false（右缘 1454 vs 裁剪边界 1340，被裁 114px）
  * 附带发现（存量缺陷，同根因）：旧结构表体出现纵向滚动条时其内容宽缩窄约 15px，1fr 轨道与表头错位（最大约 11px 累积漂移）
- 修复（src/components/dialog/TableEditDialog.vue，字段/索引两页签共用类，一处修复两处生效）：
  * 滚动容器归一：.grid-scroll 改 `overflow: auto` + `max-height: 348px`（原表体 320px + 表头实测 26px）；移动端 44vh → calc(44vh + 28px) 上移至 .grid-scroll
  * .columns-body 撤销 max-height/overflow-y（保留 padding），不再自建滚动容器——横向与纵向溢出统一交给唯一滚动容器
  * .columns-head 吸顶：`position: sticky; top: 0; z-index: 2` + 不透明背景 `var(--dbm-bg-raise)`（= antd colorBgElevated，与弹窗表面同色；浏览器实测亮 #ffffff / 暗 #1f1f1f 两态均与模态表面一致）——纵向滚动时表头悬浮、行从其下方穿过被遮挡；横向滚动时随内容平移，表头行列始终同滚
  * 水平 padding 维持原值（表头 4px = 表体 2px + 行 2px，像素级对齐保留）
- 验证（agent-browser，隔离 worktree dev server 单命令内启动+操作）：
  * 桌面 1920（暗色态顺带覆盖）：表体 computed overflowX=visible；.grid-scroll 单一横向滚动条 sw 1046/cw 932；滚至最右 scrollLeft 114（旧 86）后删除按钮右缘 1426 == 滚动区右缘 1426 完全可达，末位选项复选框可见；表头与首/末行 15 列 x 坐标 maxDiff=0 像素级对齐（连带修复存量 1fr 错位）；补 10 行强制纵向溢出后 scrollTop=120 时表头 top == 滚动区 top（sticky 生效）；VLM 截图复核：右缘无截断、无重叠、无色带
  * 移动端 390×844（亮色）：单横滚 sw 1046/cw 319、滚至最右 scrollLeft 727 后删除按钮右缘 355≈滚动区 354 可达、对齐 maxDiff=0、限高符合 calc(44vh+28px)
  * 索引页签：同样单一滚动容器 + sticky 表头；控制台 0 错误
  * bun run typecheck 通过；vp check 61 文件格式 + 52 文件 lint 零告警；check-readme.py 通过（30 标题，README「表头与行同滚」描述与修复后实际行为一致，无需改文档）
- 提交推送到 devel 分支

Stage Summary:
- 字段/索引表从「外层横滚 + 表体纵滚」双容器结构改为「唯一滚动容器 + 表头 sticky 吸顶」标准表格范式：一条横向滚动条（表头行同滚、右缘完全可达）、一条纵向滚动条（表头悬浮遮挡行内容），双滚动条与右侧裁剪遮挡彻底消除
- 排障结论沉淀：overflow-y: auto 会按规范把 overflow-x 的 visible 计算为 auto——「只想纵向滚」的容器必然同时成为横向滚动容器，凡表头在外、表体自滚的布局都潜藏此坑（SettingsView 规则表/选项定义表为单容器变体，桌面无溢出暂无症状）
- 环境注意：agent-browser 会话的 localStorage 跨脚本运行持久（主题状态会带入后续验证脚本，可善用以覆盖暗色态）

---
Task ID: 24
Agent: main (Super Z)
Task: 修复「表头下边界样式在滚动后少了一截」（Task 23 修复后残留缺陷）；提交推送 devel

Work Log:
- 问题定位（用户报告：滚动后表头下边界横线缺一段）：
  * 复现实测（1920×1080，sys_user 表）：表头盒子宽 932（=滚动容器 clientWidth 填满），而其网格轨道因列选项动态列总最小宽溢出到 1050——CSS 网格轨道最小宽之和超出容器时轨道溢出盒子、盒子不自撑宽
  * border-bottom 只画盒子宽（932）：横向滚动 114px 后新露出的表头段（5 个列选项列 + 删除列，共 114px）完全没有下边框——即「少了一截」；行盒子同样只撑到 928，行悬停背景/拖拽指示线同族隐患
  * 成因归属：上一任务把滚动容器归一后右侧内容可达，此存量视觉缺陷随之显形（修复前右缘被裁剪不可见）；与 antdv-next 无关
- 修复（src/components/dialog/TableEditDialog.vue）：
  * .cols-grid / .idx-grid 增加 `min-width: min-content`——盒宽下限 = 轨道最小宽之和，盒子随轨道加宽而非仅轨道溢出盒子；表头 border-bottom、行悬停背景、拖拽指示线随之覆盖全部列；列选项动态增删自动适应
  * 删除移动端 `min-width: 780px/560px` 硬编码下限（会被 min-content 按轨道实际最小宽取代；保留反而在选项列较多时重新截断表头边框）
- 验证（agent-browser + 隔离 worktree，`bun run dev --port 3000`——沙箱已清理旧 worktree，重建 + bun install 恢复）：
  * 桌面 1920（亮色）：表头盒宽 932→1054（轨道 1050 + padding），borderMissingSpan -4（边框反超轨道 4px 至 padding 区）；滚到最右 headerNoBorderZone 114→0；表头/行 15 列 maxDiff=0 对齐；删除按钮可达；单滚动条回归通过（表体 computed overflow-x=visible）；补 12 行纵向滚动 scrollTop=120 表头 sticky 吸顶正常、盒宽保持 1054；VLM 截图复核边框连贯无中断
  * 移动端 390（亮色）：表头盒宽 1054、滚到最右（scrollLeft 735）无下边框区域 0、删除按钮可达、对齐 maxDiff=0；0 控制台错误
  * bun run typecheck 通过；vp check 61 文件格式 + 52 文件 lint 零告警；check-readme.py 通过（30 标题，README「表头与行同滚」描述无需变更）
- 提交推送到 devel 分支

Stage Summary:
- 字段/索引表网格盒宽语义修正：盒子宽度下限绑定轨道最小宽之和（min-width: min-content），表头下边框/行悬停背景/拖拽指示线全部覆盖到最后一列，横向滚动任意位置表头下边框完整连续；移动端旧硬编码下限（780/560）随之退役，由轨道实际最小宽动态决定
- 排障结论沉淀：CSS 网格「轨道溢出盒子」陷阱——grid-template-columns 各轨最小宽之和超过容器宽时轨道照常布局但盒子维持容器宽，border/背景/box-shadow 等按盒子的装饰全部只画到容器宽；动态列场景必须 min-width: min-content 让盒子跟随轨道
- 环境注意：沙箱会周期性清理 .wt worktree 与 node_modules（bun install 442ms 可恢复）；dev server 启动命令为 `bun run dev --port 3000`（vp CLI），`bun x vite` 在新 worktree 不可用

---
Task ID: 25
Agent: main (Super Z)
Task: 画布交互适配移动端触屏——双指缩放/单指平移/长按菜单/双击编辑 + 触屏命中区与显隐补偿；提交推送 devel

Work Log:
- 触屏手势层（src/stores/canvas.ts）：
  * 闭包私有状态（非响应式）：touchPts（指针→坐标）/touchStart（起点时刻目标）/pinchBase（缩放基线）/longPressTimer/lastTap/lastMenuAt；常量 LONG_PRESS_MS 480 / SLOP 10 / DOUBLE_TAP_MS 350 / RANGE 48
  * 双指缩放：onTouchPointerDown 第二指落下 → abortActiveGesture（无副作用丢弃拖卡/框选/连线/平移草稿，已位移拖卡照常落库）+ mode='pinch'；applyPinch 锚定按下时双指中点的世界点跟随当前中点（缩放+双指拖动平移一体，zoomAt 同款数学直赋值版——到达缩放边界时中点拖动仍可平移）；三指抬其一重建基线、剩一指无缝转单指平移（moved:true 防轻点误清选择）
  * 单指平移：onCanvasPointerDown 对 pointerType==='touch' 的空白按下改走 beginPan（鼠标框选不变）；panDraft 增 sx/sy/moved/touch 字段；onPointerUp 无位移触屏轻点空白 = clearSelection（与鼠标框选轻点语义对齐）
  * 长按菜单：scheduleLongPress 480ms 无位移触发，按 touchStart.target 的 closest 分流 card/edge/canvas 三类菜单（payload 与右键一致）；位移 >10px / 第二指落下 / 抬指即取消；touchMenuGuard()（400ms 窗口）压制 Android 长按后原生 contextmenu 重复开菜单；navigator.vibrate?.(12) 触觉反馈
  * 双击编辑：onTouchPointerEnd 干净轻点（<400ms 且位移 <10px 且非双指簇且未长按）记入 lastTap，同卡片 350ms 内 48px 范围第二击 → openTableEdit（连接点上的轻点排除，避免误开）
  * 防干扰：onTouchPointerDown 排除 .minimap/.ctx-menu 目标；onPointerUp 在 mode==='pinch' 或触屏指针仍在跟踪（touchPts.size>0）时不清理模式（双指抬其一转平移的过渡窗口）
  * Mode 联合类型增 'pinch'；手势生命周期与既有单指状态机（延迟指针捕获等）正交共存
- 绑定（src/components/canvas/ModelCanvas.vue）：window 捕获相位（capture:true）转发 pointerdown/move/up/cancel → 手势层——捕获相位先于卡片/连线冒泡处理（第二指落在卡片上也能进入缩放），window 级监听保证手指滑出画布仍跟踪；iOS Safari gesturestart/gesturechange preventDefault（与 touch-action:none 双保险）；onRootContextMenu 增 touchMenuGuard 短路；状态栏操作提示双文案，@media (pointer: coarse) 切换（鼠标:框选/中键平移/滚轮缩放 ↔ 触屏:单指平移/双指缩放/双击编辑/长按菜单）
- 命中区与显隐补偿：
  * TableCard：连接点 @media (pointer: coarse) ::after inset -6px（视觉 16px 不变、命中区 28×28）；隐藏按钮与连接点的显隐规则增 .table-card.selected 态（触屏无 hover，轻点选中即显示）
  * Minimap：touch-action: none（拖拽定位不再被浏览器接管为页面滚动）
  * CanvasContextMenu：画布菜单新增「全选表（N 张）」（BoxSelect 图标）——触屏框选不可用（单指已改平移），多选入口由菜单承担
- 验证：
  * agent-browser 合成触屏 PointerEvent（pointerType:'touch'）全套：单指平移 (120,80) 且 zoom 不变；轻点卡片选中→轻点空白取消；快速轻扫不开对话框；双击开「编辑表 · sys_user」；长按卡片出卡片菜单（编辑表/复制表/隐藏/删除）；长按空白出画布菜单且「全选表」可点；双指捏合 1→2.3（中点世界锚点误差 [0,0]）→捏回 2.3→1.3 →抬一指继续平移 60px 且 zoom 稳定；鼠标回归全绿（滚轮缩放 1.3→1.495、框选矩形出现、拖卡 80px、dblclick 开编辑）；0 控制台错误
  * Playwright 真触屏环境（hasTouch+isMobile，390×844@3x）：(pointer:coarse)=true 且提示文案正确切换；真 touchscreen.tap 双击开编辑对话框；连接点 ::after content '""' inset -6px（28px 命中区）；CDP Input.dispatchTouchEvent 两指真缩放 1→1.857；0 页面错误
  * 教训沉淀：合成事件断言必须与派发分离（Vue 异步渲染——同 eval 内同步读 DOM 全是旧值，v1 验证脚本的多处「失败」均为该伪象）
  * bun run typecheck 通过；vp check 61 文件格式 + 52 文件 lint 零告警；check-readme.py 通过（30 标题）
- README：移动端表格增「触屏手势」行 + 触屏细节行补选中显隐/全选表说明；非功能说明补完整触屏手势与桌面交互不受影响
- 提交推送到 devel 分支

Stage Summary:
- 画布从「pointer 事件兼容触屏」升级为完整触屏手势体系：单指平移、双指缩放（中点锚定、边界内拖动平移、三指容错、抬一指无缝续平移）、长按 480ms 菜单（三类目标分流 + Android contextmenu 压制 + 触觉反馈）、双击卡片编辑；桌面鼠标路径（框选/中键平移/滚轮缩放/右键菜单）零回归
- 触屏无 hover 的三处补偿：连接点命中区 28px（::after 外扩）、选中态显示连接点与隐藏按钮、长按菜单「全选表」补多选入口
- 架构要点：手势层经 window 捕获相位接入（先于目标元素处理，跨画布边界持续跟踪）；闭包私有状态与响应式状态机正交；'pinch' 模式与既有延迟指针捕获机制共存

---
Task ID: 26
Agent: main (Super Z)
Task: 创建 pages 部署分支（GitHub Pages 专用）——应用模式构建演示应用，产物收录至仅存在于该分支的 pages/ 目录，提交推送该分支

Work Log:
- 基线：origin/devel 22bc289（触屏手势体系）；沙箱已清理 .wt/devel → worktree prune + fetch origin devel:devel（5410e91→22bc289）+ worktree add + bun install 恢复
- 构建形态分析：现行 vite.config.ts 为库模式（产物仅 DBManager.js/.d.ts，无 index.html），GitHub Pages 需完整 SPA → 新建应用模式配置 vite.pages.config.ts（仅 vue 插件 + base './' 相对路径 + outDir dist；不挂 libInjectCss/dts/external）——本地未跟踪文件（.git/info/exclude 登记 /vite.pages.config.ts），源码分支零改动
- 构建：./node_modules/.bin/vp build --config vite.pages.config.ts（vp build 参数透传至 Vite）——dist 产物 index.html(488B) + favicon.svg + assets/index-*.js(2.5MB, gzip 694KB) + index-*.css(67KB)，3.45s；index.html 资源引用全部为相对路径（./assets/...、./favicon.svg）
- 冒烟验证（scripts/verify-pages-build.sh，9/9 全绿）：python http.server 模拟项目页子路径 /dbm-editor/ 托管——标题正确、JS/CSS/favicon 相对路径 200、真浏览器 .table-card 渲染 6 张演示表、0 页面错误、0 控制台 error 级消息；截图 scripts/inspect/pages-build-smoke.png
- pages 分支：worktree add --detach .wt/pages → git switch --orphan pages（无父提交孤儿分支）→ dist 产物移入 pages/ 目录 + pages/.nojekyll（关闭 Jekyll）+ 分支根 README（用途说明）→ 提交并 push -u origin pages；favicon 权限位 755 修正 644 后 amend + force-with-lease，最终 9a49977；ls-remote 复核远端一致，文件树仅 README.md + pages/ 五项
- 复用沉淀：scripts/deploy-pages.sh（同步 devel → 写入应用配置 → 构建 → 更新 pages 分支产物 → 提交推送，本地排除不入库）

Stage Summary:
- origin/pages 已建立：孤儿分支仅含 README.md 与 pages/{.nojekyll, index.html, favicon.svg, assets/}——演示应用构建产物（内置 DemoManagerApi 演示数据，无后端依赖，独立可用）
- 关键决策：① 库模式与 Pages 需求冲突 → 独立应用模式配置而非改动库构建（源码分支零改动）；② base './' 相对路径使产物可托管于任意子路径（项目页 /<仓库名>/ 直接可用）；③ 孤儿分支 + 产物仅存于 pages/ 目录，满足「该目录仅存在于 pages 分支」
- 服务配置提示：GitHub Pages 经典「Deploy from a branch」仅支持分支根目录或 /docs；内容位于 pages/ 子目录时需经 GitHub Actions 部署，或调整目录结构（如改放分支根/docs 后重推）


---
Task ID: 27
Agent: main (Super Z)
Task: 删除 pages 部署分支（本地+远程）改用 GitHub Actions 自动发布；适配官方模板配置发布工作流并完成首次线上发布

Work Log:
- 分支整理：git push origin --delete pages + git branch -D pages（远程 9a49977 确认删除）；主工作区 git switch devel（.wt/devel 沙箱已清理，prune 后直接切换）
- 工作流落地（fc4e5f5 提交至 devel）：vite.pages.config.ts 转为仓库跟踪文件（CI 可复现构建配置）；package.json 新增 build:pages 脚本；.github/workflows/deploy-pages.yml 参考官方静态站点模板两段式 build+deploy——触发 push devel / workflow_dispatch；permissions contents:read+pages:write+id-token:write；concurrency group pages 不取消进行中；build 作业 oven-sh/setup-bun@v2（pin 1.3.14 本地实证版本）→ bun install --frozen-lockfile → bun run build:pages → configure-pages@v5 → upload-pages-artifact@v3（path dist，自动附 .nojekyll）；deploy 作业 deploy-pages@v5；Jekyll 模板不适用（Vite SPA 非 Jekyll 站点）
- 本地预检：devel 源码 bun run build:pages 产物 index-DAPvsDKz.js/index-BmVd9h5S.css 与 CI 产物哈希一致；check-readme 31 标题、typecheck、vp check（63 格式+53 lint）全绿；子路径托管冒烟 9/9（scripts/verify-pages-build.sh）
- 首次发布排障（三次失败→成功，run 34918841900）：用户此前在 UI 以「Deploy from a branch: pages」启用过 Pages → github-pages environment 被自动加上分支部署策略（允许 main/pages，不含 devel）→ deploy 作业 0 步骤启动失败、deployment waiting→failure；修复① DELETE+POST 重建 Pages 站点（build_type=workflow，清掉指向已删分支的 source 残留）；修复② POST deployment-branch-policies 加 devel + DELETE pages 旧策略（允许列表收敛 devel/main；PUT 关闭 custom_branch_policies 因「不能与 protected_branches 同为 false」422 不可行）；attempt 4 全绿上线
- 线上验证：https://bkbits.github.io/dbm-editor/ HTTP 200、标题正确、JS 资源 200；agent-browser 端到端——6 张演示表卡片、0 页面错误、0 控制台 error；截图 scripts/inspect/pages-live.png
- README：命令速查表加 build:pages 行 + 「GitHub Pages 自动发布」小节（触发/站点地址/构建配置/部署来源）；scripts/deploy-pages.sh（pages 分支手动方案）删除废弃
- 沙箱新坑：会话期间沙箱多次把主工作区 HEAD 回滚到 main（磁盘文件修改保留、HEAD 引用回退）→ 「切分支+改文件+校验+提交+推送」必须单次 Bash 调用原子完成（scripts/recover-push-workflow.sh 模式）

Stage Summary:
- 发布链路切换为 GitHub Actions：push devel 即自动构建发布；pages 部署分支及其手动流程移除
- 站点上线：https://bkbits.github.io/dbm-editor/（run https://github.com/bkbits/dbm-editor/actions/runs/34918841900）
- 关键决策：① 触发分支取 devel（当前主线；main 落后 30+ 提交，纳入会发布旧代码）；② 环境分支策略为 legacy 残留，收敛为 devel/main；③ 构建配置入库保证 CI 可复现
- 遗留提示：workflow_dispatch 手动触发需工作流文件存在于默认分支（当前默认 main）——若需 UI 手动触发，可后续将默认分支切为 devel 或把工作流合入 main


---
Task ID: 28
Agent: main (Super Z)
Task: 新增主键与审计字段设置（id/BIGINT 强制首字段；createBy/createTime 强制非空、updateBy/updateTime 可空）+ 表编辑固定主键首字段（不可修改/不可排序）与审计字段一键增删

Work Log:
- 类型与工具：types/model.ts 新增 FieldConventions 体系（AuditFieldRole 四角色 / PrimaryKeyConvention / AuditFieldConvention / Settings.fieldConventions 可选字段）；新建 utils/fieldConvention.ts——DEFAULT_FIELD_CONVENTIONS（id/BIGINT + createBy/createTime/updateBy/updateTime 默认）、AUDIT_FIELD_ROLES 顺序、AUDIT_FIELD_LABELS、AUDIT_FIELD_NOT_NULL（创建人/创建时间 true，更新人/更新时间 false——固定语义不入数据）、normalizeFieldConventions（缺省补默认、去空白）
- 设置链路：stores/settings.ts 增 fieldConventions 状态（init/save/snapshot 全链路）；mock/seed.ts SEED_SETTINGS 带默认约定；mock/db.ts normalizeSettings 补齐 + 迁移条件加 fieldConventions===undefined（旧库读取即补）；api/demo-manager-api.ts getSettings 返回归一约定、saveSettings 校验名称合法标识符 + 五名互不重复
- 设置页 UI（SettingsView）：新增「主键与审计字段」卡片（索引类型与代码生成之间）——六列约定表（角色标签/名称/类型自动补全/Java 类型实时推导（先设置规则后内置映射）/非空徽标/主键徽标），非空约束为固定语义仅展示；恢复默认按钮；即时校验（名称空/非法/重复标红并禁用保存）；dirty/resetDraft/save 全链路接入；移动端六列压两列（隐藏 Java/非空/主键列）
- 表编辑对话框（TableEditDialog）：首字段固定为主键约定字段——新建表 makePkColumn() 生成；打开旧表 normalizePkColumn 归一（同名列上移首位并对齐约定属性，缺失则补建，其余列清除主键标记=单主键语义）；主键行全部控件 disabled + Lock 图标替拖拽手柄 + 无删除按钮 + pk-row 底色；主键复选框全表锁定（title 说明）；validate 兜底校验首字段=约定主键；审计字段一键增删按钮（添加=按角色补齐缺失、跳过同名；删除=按约定名整组移除且不动首行）+ 约定名提示；修复 addColumn/审计字段/主键构造时 _optVals 未填默认值（选项复选框假未勾选，语义应为缺省启用）
- useDragSort 新增 lockCount 选项：头部锁定行不可拖（handleDown 拒绝）、不可插入其上方（onDrop 钳制 insert>=lockCount）、锁定行不显示 drop-above 指示线；SettingsView 等既有调用零改动（默认 0）
- README：系统设置增「主键与审计字段」条目；编辑对话框「表编辑」条目补固定主键与审计字段一键增删说明
- 验证（scripts/verify-field-conventions.sh 29/29 全绿 + 移动端）：设置迁移（旧库补齐）；约定卡片 5 行默认值/类型/Java 推导/徽标；名称重复即时拦截 + 恢复默认；sys_user 打开首字段 id、13/13 输入禁用、Lock 图标、非空/主键复选 1D1D、普通行非空可编辑主键锁定；一键添加 4 审计（createTime DATETIME/1011111、updateBy BIGINT/0011111 含选项默认勾选）；拖拽钳制（拖第 4 行到首行上方→落位第二、id 恒第一）；保存落库（id 首位）；约定改 uid 后打开旧表自动归一补建 uid 首位；新建表 id/lock；0 页面错误/0 控制台 error；移动端 390 约定表两列网格 + 对话框锁定图标与审计按钮正常
- 验证方法论沉淀：① agent-browser eval 返回 JSON 字符串（带引号）需统一剥离；② antd 模态框关闭后保留隐藏 DOM——可见性轮询必须查 wrap 的 computed display；③ 按钮文本「取 消」「保 存」含全角空格——匹配需去空格；④ 对话框已开时再 openTableEdit 不触发 watch（open 布尔未变）——测试序列必须确保真正关闭后再开
- bun run typecheck 通过；vp check 64 文件格式 + 54 文件 lint 零告警；check-readme.py 通过（31 标题）

Stage Summary:
- Settings 新增 fieldConventions（主键 + 四审计字段的名称/类型约定，非空约束随角色固定）；全链路持久化与旧库迁移
- 表编辑不变量：首字段恒为约定主键（不可修改/不可排序/不可删除，打开旧表自动归一）；审计字段按约定一键增删
- 关键决策：① 非空约束为角色固定语义（创建人/创建时间非空，更新人/更新时间可空）不做成可配置；② 单主键语义——其余列主键标记清除并锁定复选框（与模板 columns.find(c=>c.primaryKey) 假定一致）；③ useDragSort 以 lockCount 选项扩展而非复制实现，既有调用零改动
- 交付文件：src/utils/fieldConvention.ts（新）+ types/model.ts + stores/settings.ts + mock/{seed,db}.ts + api/demo-manager-api.ts + composables/useDragSort.ts + views/SettingsView.vue + components/dialog/TableEditDialog.vue + README.md


---
Task ID: 29
Agent: main (Super Z)
Task: 修正审计字段默认命名为数据库蛇形（create_by/create_time/update_by/update_time，Java 属性名自动转小驼峰）

Work Log:
- 默认值改为蛇形：utils/fieldConvention.ts DEFAULT_FIELD_CONVENTIONS 与 mock/seed.ts SEED_SETTINGS.fieldConventions 的审计字段名由 createBy/createTime/updateBy/updateTime 改为 create_by/create_time/update_by/update_time（主键 id 不变）；types/model.ts 注释同步「默认为角色名蛇形」
- 旧库迁移（mock/db.ts）：v5.1——读取时检测约定中四个审计名恰好等于旧驼峰默认名（用户未自定义的特征签名）即升级为新蛇形默认并落盘；用户自定义名称不受影响
- Java 属性名自动转换保持：makeAuditColumn 的 propertyName = toCamelCase(conv.name, true)，create_by → createBy（toCamelCase 支持下划线分隔，无需改动）
- 设置页文案（SettingsView）：约定名输入占位符改用 DEFAULT_FIELD_CONVENTIONS 蛇形默认；卡片说明与底部提示补「字段名采用数据库蛇形命名，Java 属性名自动转小驼峰」
- README：编辑对话框与系统设置两处 createBy 等驼峰表述改为蛇形并注明 Java 属性名自动小驼峰
- 验证（scripts/verify-field-conventions.sh 30/30 全绿）：新增旧驼峰默认名库迁移断言（手工写入 v5.0 旧默认后 reload → 自动升级蛇形）；约定默认名称/恢复默认断言改蛇形；一键添加审计字段断言增 Java 属性名（create_time 行 DATETIME/createTime/1011111、update_by 行 BIGINT/updateBy/0011111——列名蛇形、属性小驼峰、非空约束、选项默认勾选四合一）；落库断言蛇形；拖拽钳制/归一化/新建表等既有断言不变全过
- bun run typecheck 通过；vp check 64 文件格式 + 54 文件 lint 零告警；check-readme.py 通过（31 标题）

Stage Summary:
- 审计字段默认命名对齐数据库列名规范（蛇形）；Java 侧属性名经既有小驼峰转换链路自动得到 createBy 等，模板生成无需感知
- 旧库兼容：恰好存旧驼峰默认名的设置读取时自动升级；用户显式自定义的名称保持不动

---
Task ID: 30
Agent: main (Super Z)
Task: 框选矩形改半透明 + 修复 antdv-next 主题下导航线悬停色与激活色不一致（连带修复选中卡片描边未跟随 antd 主色 + 重置演示数据弹窗卡死回归）

Work Log:
- 根因定位（先实证后动手）：test/var-binding-test.html 复刻「:root 静态基线 + .app-provider antd 重定义」令牌级联，agent-browser 实测 getComputedStyle 四元素——CSS 自定义属性内的 var() 引用在「声明处」完成代换并以计算值继承（早绑定），并不会在使用处重新解析。antd-theme.scss 头注释原「引用型令牌自动跟随本层重定义」认知是错的
- 三个表象、一个根因：① 导航线悬停描边 = 静态青绿 rgb(13,148,136)（--dbm-edge-hover: var(--dbm-primary) 在 :root 早绑定为基线色），激活描边 = antd 蓝 rgb(22,119,255)（--dbm-primary 使用处解析）→ 同一根线悬停/激活色相迥异；② 选中卡片描边同因停留青绿（--dbm-card-border-selected 引用型令牌）；③ 框选矩形背景 --dbm-primary-weak 在 antd 层映射为 colorPrimaryBg 不透明实色（rgb(230,244,255)），完全遮挡框住的卡片与网格
- 修复（src/styles/antd-theme.scss）：显式重映射三个引用型令牌——--dbm-edge-hover: var(--ant-color-primary)（悬停与激活同为 antd 主色相，仅以 stroke-opacity 0.85/线宽 2.8 vs 1.0/3.4+光晕递进，与静态基线设计一致）；--dbm-card-border-selected: var(--ant-color-primary)；新增 --dbm-select-fill: color-mix(in srgb, var(--ant-color-primary) 12%, transparent)（antd 无主色半透明填充令牌，从主色派生）；文件头注释改为「⚠ 引用型令牌必须在本层显式重映射」并记录早绑定结论
- 修复（src/styles/variables.scss）：静态基线新增 --dbm-select-fill（亮 rgba(13,148,136,0.12) / 暗 rgba(45,212,191,0.16)——与原 primary-weak 数值相同，静态主题视觉零回归）
- 修复（src/components/canvas/ModelCanvas.vue）：.selection-rect 背景由 var(--dbm-primary-weak) 改 var(--dbm-select-fill)（附注释说明为何不能用 primary-weak）
- 连带修复（src/components/outline/OutlinePanel.vue 回归）：resetDemo 的 Modal.confirm onOk 回调内调 useHistoryStore() —— context 注入体系下 inject() 脱离 setup 上下文返回 undefined → .clear() 抛错 → onOk 拒绝 → Modal 卡死不关（遮罩拦截后续所有交互）；改为 setup 顶层 const history = useHistoryStore() 捕获（与 model/canvas/ui 同模式）。全库 grep 复查 useXxxStore() 调用点：其余全部在 setup 顶层，仅此一处违规
- 验证（agent-browser 1920×1080，先在真实应用复现三处现状留证再验修复）：
  * 亮色：悬停描边 rgb(22,119,255)@0.85/2.8px；选中描边 rgb(22,119,255)@1.0/3.4px+光晕（同色相平滑递进）；选中卡片描边 rgb(22,119,255)（原青绿）；框选填充 color(srgb 0.086 0.467 1 / 0.12) 半透明（原不透明 rgb(230,244,255)）
  * 暗色：悬停/选中同为 rgb(22,104,220)（antd dark 主色）；框选填充 rgba(22,104,220,0.12) 半透明
  * 重置演示数据全流程：确认弹窗正常自动关闭（原卡死）、10 卡片/10 导航线恢复种子、控制台 inject() 警告消失、0 页面错误
  * 截图留档：docs/screenshots/task30-edge-hover-light/selected-light.png、task30-marquee-light/dark.png、task30-edge-hover-dark.png
  * 命中探测方法论：贝塞尔曲线包围盒中心不在曲线上，取曲线上点用 path.getPointAtLength + getScreenCTM 换算屏幕坐标；NN 边中点被自身胶囊（pointer-events:all）遮挡需避开或选非 NN 边
- bun run typecheck 通过；vp check 64 文件格式 + 54 文件 lint 零告警

Stage Summary:
- 两项 UI 修复完成：框选矩形半透明（透出框住内容，亮暗主题均为 12% 主色填充）；导航线悬停色与激活色同为 antd 主色相、仅透明度/线宽/光晕递进——「差别大」问题消除
- 关键决策：① 早绑定是浏览器实测行为而非猜测——微测试页四元素取证后才动手；② 不改动 --dbm-primary-weak 的 antd 映射（colorPrimaryBg 实色适合按钮/徽标等小面积弱底），框选单建 --dbm-select-fill 令牌；③ 同根因的选中卡片描边一并修复并在 antd-theme.scss 头注释沉淀早绑定结论，防止后续再犯
- 连带交付：重置演示数据 Modal 卡死回归修复（setup 顶层捕获 history store）；worklog 记录 var() 早绑定陷阱与曲线取点方法论
