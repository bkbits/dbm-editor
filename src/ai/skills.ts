/**
 * 内置技能库（AGENT 模式 skill 工具的数据源）
 *
 * 「技能」= 某一领域的操作规范与领域知识文档，按「部分（parts）」组织：
 * 模型通过 skill(skill, parts?) 工具调用按需加载（单独占用一轮工具调用），
 * 文档内容作为工具结果回填给模型，界面以独立样式展示加载了哪个技能的哪些部分。
 *
 * 内容为给模型阅读的操作规范——应具体、可执行、与工具契约（src/stores/ai/tools.ts）
 * 保持一致；新增技能时同步更新 skill 的 description 技能名列表。
 */

/** 技能部分（可独立加载的最小知识单元） */
export interface SkillPart {
  key: string; // 部分标识（skill parts 参数取值）
  title: string; // 展示标题（聊天芯片 / 调用记录）
  content: string; // 知识正文（markdown，回填给模型）
}

/** 技能定义 */
export interface SkillDef {
  name: string; // 技能名（skill skill 参数取值，kebab-case）
  title: string; // 展示名
  description: string; // 一句话说明（工具 description 汇总用）
  parts: SkillPart[];
}

/** 内置技能清单（skill 工具按 name 检索；新增技能同步更新工具 description） */
export const SKILLS: SkillDef[] = [
  {
    name: "table-design",
    title: "表结构设计",
    description: "表/字段/索引设计规范",
    parts: [
      {
        key: "conventions",
        title: "主键与约定字段",
        content: `- 每个表必须以主键 id 字段开头：名称与类型依应用设置的字段约定（先 getSettings 读取 fieldConventions，缺省 id / BIGINT）
- 按需添加审计字段（依设置的审计字段约定，常见 created_at / updated_at 时间对，或含 created_by / updated_by）
- 逻辑删除字段每表至多一个（依设置的逻辑删除约定，常见 deleted，TINYINT，0=正常 1=已删，notNull）
- 修改或新增表前先 getTables 读取现状；约定以设置页配置为准，禁止凭记忆硬编码`,
      },
      {
        key: "fields",
        title: "字段设计规范",
        content: `- 字段名蛇形命名（user_name）；Java 属性名小驼峰可缺省由字段名推导
- 类型选择：主键/外键 BIGINT；短文本 VARCHAR(255)；长文本 TEXT；时间 DATETIME；金额 DECIMAL(20,2)；状态标记 TINYINT
- 字段尽量 NOT NULL：字符串可给空串默认值，数值给 0，时间视语义
- comment 必填中文注释；javaType 与数据库类型匹配（Long / String / LocalDateTime / BigDecimal / Integer）
- 状态、类型等枚举值域字段应关联字典（dict 填字典键 dictKey，而非字典 id）`,
      },
      {
        key: "indexes",
        title: "索引设计规范",
        content: `- 主键自带索引，无需重复创建
- 高频查询条件字段、表间关联字段（外键列）应建索引
- 唯一性约束（如 code、user_name）建 UNIQUE 索引
- 组合索引把区分度高的列放在前面；索引名 snake_case 且全局唯一（前缀 i-）
- 单表索引建议不超过 5 个，避免拖累写入性能`,
      },
    ],
  },
  {
    name: "navigate",
    title: "导航关系配置",
    description: "表间导航关系与级联策略",
    parts: [
      {
        key: "types",
        title: "类型判定",
        content: `- '11' 一对一：如用户-用户详情，一侧持有唯一外键
- '1N' 一对多：如分类-表、部门-员工，多侧持有外键
- 'N1' 多对一：'1N' 的反向视角，通常只在其中一侧建立导航
- 'NN' 多对多：如用户-角色，必须指定中间映射表（mappingTable）
- self 与 target 可调换，但导航类型需同步反转（'1N' 与 'N1' 互换）
- 树形表（配置了 parentIdColumn）禁止再建自关联导航`,
      },
      {
        key: "cascade",
        title: "级联策略选择",
        content: `- NO_ACTION：默认最安全，不做任何级联
- DELETE：级联删除，适合强父子依赖（子记录无独立意义）
- SET_NULL：级联置空，关联字段必须可空
- AUTO：交由框架默认行为
- 删除操作频繁、数据价值高的场景慎用 DELETE；两端级联独立配置`,
      },
      {
        key: "mapping",
        title: "多对多中间表",
        content: `- 'NN' 导航必须提供 mappingTable（中间表 id）；中间表通常为两列外键 + 联合唯一索引
- selfProperty / targetProperty 填关联列名（不是属性名）；属性名 selfPropertyName / targetPropertyName 用小驼峰
- 中间表自身也应作为普通表建模（主键 id + 两个外键字段 + 联合唯一索引）
- 先创建中间表再建 NN 导航（addNavigate 校验两端表与中间表存在）`,
      },
    ],
  },
  {
    name: "dict",
    title: "字典设计",
    description: "字典与字典值约定",
    parts: [
      {
        key: "conventions",
        title: "值键与常量约定",
        content: `- valueKey 禁用纯数字：用代表含义的首字母大写英文（ENABLED / DISABLED / PENDING）
- 同一字典内 valueKey 唯一；出现重复键值时替换为更贴切的大写英文
- propertyName 全大写常量属性名（ENABLED），与 valueKey 对应
- labelType 按语义选色：I 信息 / S 成功 / W 警告 / D 危险
- label 为用户可读中文标签；comment 补充说明`,
      },
      {
        key: "usage",
        title: "字段关联用法",
        content: `- 表字段的 dict 填字典键（dictKey，如 sex / order_status），不是字典 id
- 常用字典：状态（status）、类型（type）、性别（sex）、是否（yes_no）等值域稳定的枚举
- 生成代码时关联字典的字段自动映射为常量类引用（依字典分类模板）
- 新增字典前先 getDicts 查重；字典分类（dictcat-）决定常量类归属`,
      },
    ],
  },
  {
    name: "codegen",
    title: "代码生成与替换",
    description: "生成 zip 产物与写回源码流程",
    parts: [
      {
        key: "generate",
        title: "代码生成流程",
        content: `- genCodeZip 参数：tableNames 目标表名列表（缺省全部表）、templateNames 参与模板（缺省全部启用模板）、dictEnabled 是否生成字典代码（默认 true）
- 产物自动打包 zip 并在右侧调用记录提供下载按钮（用户自行下载），不写回源码
- 返回文件清单（templateName / tableName / fileName / filePath / size）
- includeContent 慎开：会在结果中附带每个文件全文，体积大易撑爆上下文
- genCode 用于单模板单表生成并直接返回内容（查看单个产物 / 校验模板效果）`,
      },
      {
        key: "replace",
        title: "代码替换流程",
        content: `- genCodeReplace 属危险操作：按模板生成后覆盖目标源码文件，仅在用户明确要求时使用
- 执行前向用户弹出将被覆盖的文件清单，用户确认后才写回；用户取消则本次不执行（工具返回失败说明）
- 要求目标表分类已配置 src 源码路径（getTableCategories 检查）
- 生成 / 替换按表名（tableName）指定范围，不使用表 id`,
      },
    ],
  },
  {
    name: "import-db",
    title: "数据库导入",
    description: "从真实数据库导入表结构",
    parts: [
      {
        key: "flow",
        title: "导入流程",
        content: `- importTablesFromDB 参数 categoryId：导入到哪个表分类（先 getTableCategories 查询）
- 读取真实库的表 / 字段 / 索引定义后逐张 addTable 落库（补画布坐标网格排布）
- 与用户确认导入范围（全部或部分表）后再落库，不要静默全量导入
- 已存在同名表时工具会自动加序号避让，完成后应向用户汇报差异
- 完成后按需 saveAll 落盘并汇报导入结果（数量、差异、跳过项）`,
      },
    ],
  },
  {
    name: "canvas-layout",
    title: "画布布局",
    description: "表卡片位置整理与美化",
    parts: [
      {
        key: "layout",
        title: "布局原则",
        content: `- 按分类分区：同分类的表相邻排布，分类之间留出明显间隔
- 方向语义：从左到右按依赖方向排布，被依赖的基础表（字典表 / 主数据）在左，依赖方在右
- 网格对齐：坐标取整到网格（横向间距约 260、纵向间距约 200），卡片宽约 220 需避免横向重叠
- 减少连线交叉：有导航关系的表尽量靠近；孤立表放画布边缘
- 调整完成后用 updateTablePos 一次性批量提交全部移动的表（tables 数组），避免逐表调用`,
      },
    ],
  },
];

/** 按技能名查找（大小写不敏感；未找到返回 undefined） */
export function findSkill(name: string): SkillDef | undefined {
  const key = String(name ?? "")
    .trim()
    .toLowerCase();
  return SKILLS.find((s) => s.name === key);
}

/** 技能名清单（工具 description / 错误提示用） */
export function skillNames(): string[] {
  return SKILLS.map((s) => s.name);
}
