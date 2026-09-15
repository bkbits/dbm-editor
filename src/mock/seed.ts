/**
 * Mock 种子数据：内置一套完整的演示模型
 * （系统管理 / 内容管理 / 商城 三个分类，含一对一、一对多、多对多及中间表）
 */
import type {
  CodeTemplate,
  DBTable,
  Dict,
  DictCategory,
  OptionSetting,
  Settings,
  TableColumn,
  TableCategory,
  TableNavigate,
} from '@/types/model'
import { toCamelCase } from '@/utils/string'
import { getJavaTypeByType } from '@/utils/javaType'

/* ============ 分类 ============ */
export const SEED_CATEGORIES: TableCategory[] = [
  {
    id: 'cat-system',
    name: '系统管理',
    basePackage: 'com.example.system',
    src: 'src/main/java/com/example/system',
  },
  {
    id: 'cat-content',
    name: '内容管理',
    basePackage: 'com.example.cms',
    src: 'src/main/java/com/example/cms',
  },
  {
    id: 'cat-mall',
    name: '商城模块',
    basePackage: 'com.example.mall',
    src: 'src/main/java/com/example/mall',
  },
]

/* ============ 表与字段 ============ */
type ColOpt = Partial<TableColumn>
type ColSpec = [name: string, type: string, opt?: ColOpt]

function buildColumns(tableId: string, specs: ColSpec[]): TableColumn[] {
  return specs.map(([name, type, opt = {}], i) => ({
    id: `c-${tableId}-${name}`,
    tableId,
    columnName: name,
    propertyName: toCamelCase(name, true),
    sort: i,
    type,
    javaType: getJavaTypeByType(type),
    comment: '',
    notNull: false,
    primaryKey: false,
    dict: '',
    ...opt,
  }))
}

export const SEED_TABLES = [
  {
    id: 't-sys-user',
    categoryId: 'cat-system',
    tableName: 'sys_user',
    className: 'SysUser',
    comment: '用户表',
    x: 60,
    y: 80,
    columns: buildColumns('t-sys-user', [
      ['id', 'BIGINT', { primaryKey: true, notNull: true, comment: '主键' }],
      ['username', 'VARCHAR(50)', { notNull: true, comment: '登录名' }],
      ['password', 'VARCHAR(100)', { notNull: true, comment: '密码(加密存储)' }],
      ['nickname', 'VARCHAR(50)', { comment: '昵称' }],
      ['email', 'VARCHAR(100)', { comment: '邮箱' }],
      ['user_type', 'TINYINT', { dict: 'user_type', comment: '用户类型' }],
      ['status', 'TINYINT', { notNull: true, dict: 'sys_status', comment: '状态' }],
      ['created_at', 'DATETIME', { notNull: true, comment: '创建时间' }],
      ['updated_at', 'DATETIME', { comment: '更新时间' }],
    ]),
    indexes: [
      {
        id: 'i-sys-user-username',
        tableId: 't-sys-user',
        indexName: 'uk_username',
        type: 'UNIQUE' as const,
        columns: ['username'],
        comment: '登录名唯一',
      },
      {
        id: 'i-sys-user-email',
        tableId: 't-sys-user',
        indexName: 'idx_email',
        type: 'NORMAL' as const,
        columns: ['email'],
        comment: '邮箱查询',
      },
    ],
  },
  {
    id: 't-sys-role',
    categoryId: 'cat-system',
    tableName: 'sys_role',
    className: 'SysRole',
    comment: '角色表',
    x: 560,
    y: 80,
    columns: buildColumns('t-sys-role', [
      ['id', 'BIGINT', { primaryKey: true, notNull: true, comment: '主键' }],
      ['role_name', 'VARCHAR(50)', { notNull: true, comment: '角色名称' }],
      ['role_code', 'VARCHAR(50)', { notNull: true, comment: '角色编码' }],
      ['status', 'TINYINT', { notNull: true, dict: 'sys_status', comment: '状态' }],
      ['remark', 'VARCHAR(200)', { comment: '备注' }],
    ]),
    indexes: [
      {
        id: 'i-sys-role-code',
        tableId: 't-sys-role',
        indexName: 'uk_role_code',
        type: 'UNIQUE' as const,
        columns: ['role_code'],
        comment: '',
      },
    ],
  },
  {
    id: 't-sys-user-role',
    categoryId: 'cat-system',
    tableName: 'sys_user_role',
    className: 'SysUserRole',
    comment: '用户角色中间表',
    hidden: true,
    x: 300,
    y: 420,
    columns: buildColumns('t-sys-user-role', [
      ['id', 'BIGINT', { primaryKey: true, notNull: true, comment: '主键' }],
      ['user_id', 'BIGINT', { notNull: true, comment: '用户ID' }],
      ['role_id', 'BIGINT', { notNull: true, comment: '角色ID' }],
    ]),
    indexes: [
      {
        id: 'i-sur-uk',
        tableId: 't-sys-user-role',
        indexName: 'uk_user_role',
        type: 'UNIQUE' as const,
        columns: ['user_id', 'role_id'],
        comment: '联合唯一',
      },
    ],
  },
  {
    id: 't-sys-menu',
    categoryId: 'cat-system',
    tableName: 'sys_menu',
    className: 'SysMenu',
    comment: '菜单表',
    parentIdColumn: 'parent_id',
    x: 1060,
    y: 80,
    columns: buildColumns('t-sys-menu', [
      ['id', 'BIGINT', { primaryKey: true, notNull: true, comment: '主键' }],
      ['parent_id', 'BIGINT', { comment: '父菜单ID' }],
      ['menu_name', 'VARCHAR(50)', { notNull: true, comment: '菜单名称' }],
      ['path', 'VARCHAR(200)', { comment: '路由路径' }],
      ['icon', 'VARCHAR(50)', { comment: '图标' }],
      ['sort', 'INT', { comment: '排序' }],
      ['visible', 'TINYINT(1)', { comment: '是否可见' }],
    ]),
    indexes: [],
  },
  {
    id: 't-sys-role-menu',
    categoryId: 'cat-system',
    tableName: 'sys_role_menu',
    className: 'SysRoleMenu',
    comment: '角色菜单中间表',
    hidden: true,
    x: 820,
    y: 420,
    columns: buildColumns('t-sys-role-menu', [
      ['id', 'BIGINT', { primaryKey: true, notNull: true, comment: '主键' }],
      ['role_id', 'BIGINT', { notNull: true, comment: '角色ID' }],
      ['menu_id', 'BIGINT', { notNull: true, comment: '菜单ID' }],
    ]),
    indexes: [],
  },
  {
    id: 't-cms-category',
    categoryId: 'cat-content',
    tableName: 'cms_category',
    className: 'CmsCategory',
    comment: '文章分类表',
    parentIdColumn: 'parent_id',
    x: 60,
    y: 720,
    columns: buildColumns('t-cms-category', [
      ['id', 'BIGINT', { primaryKey: true, notNull: true, comment: '主键' }],
      ['category_name', 'VARCHAR(50)', { notNull: true, comment: '分类名称' }],
      ['parent_id', 'BIGINT', { comment: '父分类ID' }],
      ['sort', 'INT', { comment: '排序' }],
    ]),
    indexes: [],
  },
  {
    id: 't-cms-article',
    categoryId: 'cat-content',
    tableName: 'cms_article',
    className: 'CmsArticle',
    comment: '文章表',
    x: 420,
    y: 700,
    columns: buildColumns('t-cms-article', [
      ['id', 'BIGINT', { primaryKey: true, notNull: true, comment: '主键' }],
      ['category_id', 'BIGINT', { notNull: true, comment: '分类ID' }],
      ['user_id', 'BIGINT', { notNull: true, comment: '作者ID' }],
      ['title', 'VARCHAR(200)', { notNull: true, comment: '标题' }],
      ['summary', 'VARCHAR(500)', { comment: '摘要' }],
      ['content', 'LONGTEXT', { comment: '正文(Markdown)' }],
      ['cover', 'VARCHAR(255)', { comment: '封面图' }],
      ['status', 'TINYINT', { notNull: true, dict: 'article_status', comment: '状态' }],
      ['is_top', 'TINYINT(1)', { comment: '是否置顶' }],
      ['created_at', 'DATETIME', { notNull: true, comment: '发布时间' }],
    ]),
    indexes: [
      {
        id: 'i-article-category',
        tableId: 't-cms-article',
        indexName: 'idx_category',
        type: 'NORMAL' as const,
        columns: ['category_id'],
        comment: '分类检索',
      },
      {
        id: 'i-article-fulltext',
        tableId: 't-cms-article',
        indexName: 'ft_title_content',
        type: 'FULLTEXT' as const,
        columns: ['title', 'content'],
        comment: '全文检索',
      },
    ],
  },
  {
    id: 't-cms-comment',
    categoryId: 'cat-content',
    tableName: 'cms_comment',
    className: 'CmsComment',
    comment: '评论表',
    x: 60,
    y: 1140,
    columns: buildColumns('t-cms-comment', [
      ['id', 'BIGINT', { primaryKey: true, notNull: true, comment: '主键' }],
      ['article_id', 'BIGINT', { notNull: true, comment: '文章ID' }],
      ['user_id', 'BIGINT', { notNull: true, comment: '评论人ID' }],
      ['content', 'VARCHAR(1000)', { notNull: true, comment: '评论内容' }],
      ['status', 'TINYINT', { dict: 'sys_status', comment: '状态' }],
      ['created_at', 'DATETIME', { notNull: true, comment: '评论时间' }],
    ]),
    indexes: [
      {
        id: 'i-comment-article',
        tableId: 't-cms-comment',
        indexName: 'idx_article',
        type: 'NORMAL' as const,
        columns: ['article_id'],
        comment: '',
      },
    ],
  },
  {
    id: 't-cms-tag',
    categoryId: 'cat-content',
    tableName: 'cms_tag',
    className: 'CmsTag',
    comment: '标签表',
    x: 960,
    y: 700,
    columns: buildColumns('t-cms-tag', [
      ['id', 'BIGINT', { primaryKey: true, notNull: true, comment: '主键' }],
      ['tag_name', 'VARCHAR(50)', { notNull: true, comment: '标签名' }],
    ]),
    indexes: [],
  },
  {
    id: 't-cms-article-tag',
    categoryId: 'cat-content',
    tableName: 'cms_article_tag',
    className: 'CmsArticleTag',
    comment: '文章标签中间表',
    hidden: true,
    x: 700,
    y: 1080,
    columns: buildColumns('t-cms-article-tag', [
      ['id', 'BIGINT', { primaryKey: true, notNull: true, comment: '主键' }],
      ['article_id', 'BIGINT', { notNull: true, comment: '文章ID' }],
      ['tag_id', 'BIGINT', { notNull: true, comment: '标签ID' }],
    ]),
    indexes: [],
  },
  {
    id: 't-mall-product',
    categoryId: 'cat-mall',
    tableName: 'mall_product',
    className: 'MallProduct',
    comment: '商品表',
    x: 1500,
    y: 80,
    columns: buildColumns('t-mall-product', [
      ['id', 'BIGINT', { primaryKey: true, notNull: true, comment: '主键' }],
      ['product_name', 'VARCHAR(100)', { notNull: true, comment: '商品名称' }],
      ['price', 'DECIMAL(10,2)', { notNull: true, comment: '售价' }],
      ['stock', 'INT', { notNull: true, comment: '库存' }],
      ['status', 'TINYINT', { notNull: true, dict: 'mall_status', comment: '上下架状态' }],
      ['created_at', 'DATETIME', { notNull: true, comment: '上架时间' }],
    ]),
    indexes: [],
  },
  {
    id: 't-mall-order',
    categoryId: 'cat-mall',
    tableName: 'mall_order',
    className: 'MallOrder',
    comment: '订单表',
    x: 1500,
    y: 560,
    columns: buildColumns('t-mall-order', [
      ['id', 'BIGINT', { primaryKey: true, notNull: true, comment: '主键' }],
      ['order_no', 'VARCHAR(64)', { notNull: true, comment: '订单号' }],
      ['user_id', 'BIGINT', { notNull: true, comment: '下单用户ID' }],
      ['total_amount', 'DECIMAL(20,2)', { notNull: true, comment: '订单总额' }],
      ['status', 'TINYINT', { notNull: true, dict: 'order_status', comment: '订单状态' }],
      ['created_at', 'DATETIME', { notNull: true, comment: '下单时间' }],
    ]),
    indexes: [
      {
        id: 'i-order-no',
        tableId: 't-mall-order',
        indexName: 'uk_order_no',
        type: 'UNIQUE' as const,
        columns: ['order_no'],
        comment: '订单号唯一',
      },
    ],
  },
  {
    id: 't-mall-order-item',
    categoryId: 'cat-mall',
    tableName: 'mall_order_item',
    className: 'MallOrderItem',
    comment: '订单明细表',
    x: 1900,
    y: 560,
    columns: buildColumns('t-mall-order-item', [
      ['id', 'BIGINT', { primaryKey: true, notNull: true, comment: '主键' }],
      ['order_id', 'BIGINT', { notNull: true, comment: '订单ID' }],
      ['product_id', 'BIGINT', { notNull: true, comment: '商品ID' }],
      ['quantity', 'INT', { notNull: true, comment: '数量' }],
      ['price', 'DECIMAL(10,2)', { notNull: true, comment: '成交单价' }],
    ]),
    indexes: [],
  },
]

/** 种子隐藏表名集合：旧版数据（无 hidden 字段）读取时按表名补齐隐藏标记 */
export const SEED_HIDDEN_TABLE_NAMES = new Set([
  'sys_user_role',
  'sys_role_menu',
  'cms_article_tag',
])

/* ============ 导航关系 ============ */
export const SEED_NAVIGATES: TableNavigate[] = [
  {
    id: 'n-user-role',
    type: 'NN',
    comment: '用户-角色 多对多',
    selfPropertyName: 'roles',
    targetPropertyName: 'users',
    self: 't-sys-user',
    selfProperty: ['id'],
    selfMappingProperty: ['user_id'],
    mappingTable: 't-sys-user-role',
    target: 't-sys-role',
    targetProperty: ['id'],
    targetMappingProperty: ['role_id'],
    selfToTargetCascade: 'AUTO',
    targetToSelfCascade: 'AUTO',
  },
  {
    id: 'n-role-menu',
    type: 'NN',
    comment: '角色-菜单 多对多',
    selfPropertyName: 'menus',
    targetPropertyName: 'roles',
    self: 't-sys-role',
    selfProperty: ['id'],
    selfMappingProperty: ['role_id'],
    mappingTable: 't-sys-role-menu',
    target: 't-sys-menu',
    targetProperty: ['id'],
    targetMappingProperty: ['menu_id'],
    selfToTargetCascade: 'AUTO',
    targetToSelfCascade: 'NO_ACTION',
  },
  {
    id: 'n-article-user',
    type: 'N1',
    comment: '文章所属作者',
    selfPropertyName: 'user',
    targetPropertyName: 'articles',
    self: 't-cms-article',
    selfProperty: ['user_id'],
    selfMappingProperty: [],
    mappingTable: '',
    target: 't-sys-user',
    targetProperty: ['id'],
    targetMappingProperty: [],
    selfToTargetCascade: 'AUTO',
    targetToSelfCascade: 'SET_NULL',
  },
  {
    id: 'n-article-category',
    type: 'N1',
    comment: '文章所属分类',
    selfPropertyName: 'category',
    targetPropertyName: 'articles',
    self: 't-cms-article',
    selfProperty: ['category_id'],
    selfMappingProperty: [],
    mappingTable: '',
    target: 't-cms-category',
    targetProperty: ['id'],
    targetMappingProperty: [],
    selfToTargetCascade: 'NO_ACTION',
    targetToSelfCascade: 'NO_ACTION',
  },
  {
    id: 'n-article-comment',
    type: '1N',
    comment: '文章-评论 一对多',
    selfPropertyName: 'comments',
    targetPropertyName: 'article',
    self: 't-cms-article',
    selfProperty: ['id'],
    selfMappingProperty: [],
    mappingTable: '',
    target: 't-cms-comment',
    targetProperty: ['article_id'],
    targetMappingProperty: [],
    selfToTargetCascade: 'DELETE',
    targetToSelfCascade: 'AUTO',
  },
  {
    id: 'n-comment-user',
    type: 'N1',
    comment: '评论人',
    selfPropertyName: 'user',
    targetPropertyName: 'comments',
    self: 't-cms-comment',
    selfProperty: ['user_id'],
    selfMappingProperty: [],
    mappingTable: '',
    target: 't-sys-user',
    targetProperty: ['id'],
    targetMappingProperty: [],
    selfToTargetCascade: 'AUTO',
    targetToSelfCascade: 'SET_NULL',
  },
  {
    id: 'n-article-tag',
    type: 'NN',
    comment: '文章-标签 多对多',
    selfPropertyName: 'tags',
    targetPropertyName: 'articles',
    self: 't-cms-article',
    selfProperty: ['id'],
    selfMappingProperty: ['article_id'],
    mappingTable: 't-cms-article-tag',
    target: 't-cms-tag',
    targetProperty: ['id'],
    targetMappingProperty: ['tag_id'],
    selfToTargetCascade: 'AUTO',
    targetToSelfCascade: 'AUTO',
  },
  {
    id: 'n-order-user',
    type: 'N1',
    comment: '订单所属用户',
    selfPropertyName: 'user',
    targetPropertyName: 'orders',
    self: 't-mall-order',
    selfProperty: ['user_id'],
    selfMappingProperty: [],
    mappingTable: '',
    target: 't-sys-user',
    targetProperty: ['id'],
    targetMappingProperty: [],
    selfToTargetCascade: 'AUTO',
    targetToSelfCascade: 'SET_NULL',
  },
  {
    id: 'n-order-item',
    type: '1N',
    comment: '订单-明细 一对多',
    selfPropertyName: 'items',
    targetPropertyName: 'order',
    self: 't-mall-order',
    selfProperty: ['id'],
    selfMappingProperty: [],
    mappingTable: '',
    target: 't-mall-order-item',
    targetProperty: ['order_id'],
    targetMappingProperty: [],
    selfToTargetCascade: 'DELETE',
    targetToSelfCascade: 'AUTO',
  },
  {
    id: 'n-item-product',
    type: 'N1',
    comment: '明细对应商品',
    selfPropertyName: 'product',
    targetPropertyName: 'orderItems',
    self: 't-mall-order-item',
    selfProperty: ['product_id'],
    selfMappingProperty: [],
    mappingTable: '',
    target: 't-mall-product',
    targetProperty: ['id'],
    targetMappingProperty: [],
    selfToTargetCascade: 'NO_ACTION',
    targetToSelfCascade: 'NO_ACTION',
  },
]

/* ============ 字典 ============ */
/** 字典分类：与表分类同构（分类名称 + 基础包路径 + 大驼峰类名——字典代码生成的包名/类名依据） */
export const SEED_DICT_CATEGORIES: DictCategory[] = [
  {
    id: 'dictcat-system',
    name: '系统字典',
    basePackage: 'com.example.constants.dict',
    className: 'SysDictConstants',
  },
  {
    id: 'dictcat-business',
    name: '业务字典',
    basePackage: 'com.example.constants.dict',
    className: 'BizDictConstants',
  },
]

export const SEED_DICTS: Dict[] = [
  {
    id: 'dict-sys-status',
    categoryId: 'dictcat-system',
    dictKey: 'sys_status',
    label: '系统状态',
    comment: '通用的启用/禁用状态',
    values: [
      {
        id: 'dv-ss-0',
        dictId: 'dict-sys-status',
        valueKey: '0',
        propertyName: 'DISABLED',
        label: '禁用',
        labelType: 'D',
        comment: '不可用',
      },
      {
        id: 'dv-ss-1',
        dictId: 'dict-sys-status',
        valueKey: '1',
        propertyName: 'ENABLED',
        label: '启用',
        labelType: 'S',
        comment: '正常',
      },
      {
        id: 'dv-ss-2',
        dictId: 'dict-sys-status',
        valueKey: '2',
        propertyName: 'LOCKED',
        label: '锁定',
        labelType: 'W',
        comment: '临时锁定',
      },
    ],
  },
  {
    id: 'dict-user-type',
    categoryId: 'dictcat-system',
    dictKey: 'user_type',
    label: '用户类型',
    comment: '用户账号类型',
    values: [
      {
        id: 'dv-ut-0',
        dictId: 'dict-user-type',
        valueKey: '0',
        propertyName: 'NORMAL',
        label: '普通用户',
        labelType: 'I',
      },
      {
        id: 'dv-ut-1',
        dictId: 'dict-user-type',
        valueKey: '1',
        propertyName: 'MEMBER',
        label: '会员',
        labelType: 'S',
      },
      {
        id: 'dv-ut-9',
        dictId: 'dict-user-type',
        valueKey: '9',
        propertyName: 'ADMIN',
        label: '管理员',
        labelType: 'W',
        comment: '后台管理员',
      },
    ],
  },
  {
    id: 'dict-article-status',
    categoryId: 'dictcat-business',
    dictKey: 'article_status',
    label: '文章状态',
    values: [
      {
        id: 'dv-as-0',
        dictId: 'dict-article-status',
        valueKey: '0',
        propertyName: 'DRAFT',
        label: '草稿',
        labelType: 'I',
      },
      {
        id: 'dv-as-1',
        dictId: 'dict-article-status',
        valueKey: '1',
        propertyName: 'PUBLISHED',
        label: '已发布',
        labelType: 'S',
      },
      {
        id: 'dv-as-2',
        dictId: 'dict-article-status',
        valueKey: '2',
        propertyName: 'REVIEWING',
        label: '审核中',
        labelType: 'W',
      },
      {
        id: 'dv-as-3',
        dictId: 'dict-article-status',
        valueKey: '3',
        propertyName: 'OFF_SHELF',
        label: '已下架',
        labelType: 'D',
      },
    ],
  },
  {
    id: 'dict-order-status',
    categoryId: 'dictcat-business',
    dictKey: 'order_status',
    label: '订单状态',
    values: [
      {
        id: 'dv-os-0',
        dictId: 'dict-order-status',
        valueKey: '0',
        propertyName: 'UNPAID',
        label: '待支付',
        labelType: 'I',
      },
      {
        id: 'dv-os-1',
        dictId: 'dict-order-status',
        valueKey: '1',
        propertyName: 'PAID',
        label: '已支付',
        labelType: 'S',
      },
      {
        id: 'dv-os-2',
        dictId: 'dict-order-status',
        valueKey: '2',
        propertyName: 'SHIPPED',
        label: '已发货',
        labelType: 'W',
      },
      {
        id: 'dv-os-3',
        dictId: 'dict-order-status',
        valueKey: '3',
        propertyName: 'COMPLETED',
        label: '已完成',
        labelType: 'S',
      },
      {
        id: 'dv-os-4',
        dictId: 'dict-order-status',
        valueKey: '4',
        propertyName: 'CANCELLED',
        label: '已取消',
        labelType: 'D',
        comment: '自定义颜色示例',
        color: '#9333ea',
      },
    ],
  },
  {
    id: 'dict-mall-status',
    categoryId: 'dictcat-business',
    dictKey: 'mall_status',
    label: '商品状态',
    values: [
      {
        id: 'dv-ms-0',
        dictId: 'dict-mall-status',
        valueKey: '0',
        propertyName: 'OFF_SHELF',
        label: '下架',
        labelType: 'D',
      },
      {
        id: 'dv-ms-1',
        dictId: 'dict-mall-status',
        valueKey: '1',
        propertyName: 'ON_SHELF',
        label: '上架',
        labelType: 'S',
      },
    ],
  },
]

/* ============ 模板 ============ */
export const SEED_TEMPLATES: CodeTemplate[] = [
  {
    id: 'tpl-entity',
    name: 'entity',
    content: `<%
  context.fileName = context.table.className + ".java";
  context.filePath = (context.basePackage ? context.basePackage.replace(/\\./g, "/") + "/" : "") + "entity/" + context.fileName;
  context.language = "java";
  const cls = context.table.className || utils.toCamelCase(context.table.tableName);
  const comment = context.table.comment || context.table.tableName;
  const pkg = utils.isEmpty(context.basePackage) ? "" : context.basePackage + ".";
  const author = (context.settings.author || "").trim();
  const since = utils.nowDateTime();
  const propOf = (colName, vo) => {
    const cols = vo ? vo.columns : context.table.columns;
    const col = cols.find((c) => c.columnName === colName);
    return (col && col.propertyName) || utils.toCamelCase(colName, true);
  };
  const fieldsRef = (colNames, vo) => colNames.map((p) => (vo ? vo.className + ".Fields." : "Fields.") + propOf(p, vo)).join(", ");
  const fieldsArg = (colNames, vo) => { const s = fieldsRef(colNames, vo); return s.includes(",") ? "{ " + s + " }" : s; };
  const relEnum = { "11": "OneToOne", "1N": "OneToMany", "N1": "ManyToOne", "NN": "ManyToMany" };
  const tableDirect = utils.toSnakeCase(cls) === context.table.tableName;
  const propDirect = (column) => utils.toSnakeCase(column.propertyName || utils.toCamelCase(column.columnName, true)) === column.columnName;
  const needColumnAnno = context.table.columns.some((c) => c.primaryKey || !propDirect(c));
  const parentCol = context.table.parentIdColumn ? context.getColumn(context.table.parentIdColumn) : null;
  const hasNav = context.table.navigates.length > 0 || !!parentCol;
  const needList = hasNav && (context.table.navigates.some((n) => n.type === "1N" || n.type === "NN") || !!parentCol);
  const ifaces = [];
  if (context.hasColumn("create_time") && context.hasColumn("create_by")) ifaces.push("ICreate");
  if (context.hasColumn("update_time") && context.hasColumn("update_by")) ifaces.push("IUpdate");
  if (context.hasColumn("id")) ifaces.push("IGenId");
  if (context.hasColumn("dept_id")) ifaces.push("IDeptId");
  const dateTypes = [...new Set(context.table.columns.map(c => utils.getJavaType(c)).filter(t => /^Local(Date|Time|DateTime)$/.test(t)))];
  const needDecimal = context.table.columns.some(c => utils.getJavaType(c) === "BigDecimal");
%>
package <%= pkg %>entity;

<% if (needColumnAnno) { %>import com.easy.query.core.annotation.Column;
<% } %>import com.easy.query.core.annotation.EntityProxy;
<% if (hasNav) { %>import com.easy.query.core.annotation.Navigate;
<% } %>import com.easy.query.core.annotation.Table;
<% if (hasNav) { %>import com.easy.query.core.enums.RelationTypeEnum;
<% } %>import com.easy.query.core.proxy.ProxyEntityAvailable;
import io.swagger.annotations.ApiModel;
import io.swagger.annotations.ApiModelProperty;
import lombok.Data;
import lombok.experimental.FieldNameConstants;
import <%= pkg %>entity.proxy.<%= cls %>Proxy;
import java.io.Serializable;
<% if (needDecimal) { %>import java.math.BigDecimal;
<% } %><% for (const dt of dateTypes) { %>import java.time.<%= dt %>;
<% } %>
<% if (needList) { %>import java.util.List;
<% } %>
<%# ===== easy-query 实体：@Table 常驻（命名直转省略参数）、@EntityProxy 触发代理生成、swagger2 注解、审计接口按列自动实现 ===== %>
/**
 * <%= comment %>
 *
<% if (author) { %> * @author <%= author %>
<% } %> * @since <%= since %>
 */
@Data
@FieldNameConstants
<% if (tableDirect) { %>@Table
<% } else { %>@Table("<%= context.table.tableName %>")
<% } %>@EntityProxy
@ApiModel("<%= comment %>")
public class <%= cls %> implements Serializable, ProxyEntityAvailable<<%= cls %>, <%= cls %>Proxy><% for (const i of ifaces) { %>, <%= i %><% } %> {

  private static final long serialVersionUID = 1L;
<% for (const column of context.table.columns) {
  const prop = column.propertyName || utils.toCamelCase(column.columnName, true);
  const anno = column.primaryKey
    ? (propDirect(column) ? "@Column(primaryKey = true)" : '@Column(value = "' + column.columnName + '", primaryKey = true)')
    : (propDirect(column) ? "" : '@Column("' + column.columnName + '")');
  const doc = column.comment || (column.primaryKey ? "主键" : "");
  const mark = column.primaryKey && doc.indexOf("主键") < 0 ? "（主键）" : "";
  const apiDoc = doc + mark || prop;
%>
<% if (doc) { %>  /** <%= doc + mark %> */
<% } %>  @ApiModelProperty("<%= apiDoc %>")
<% if (anno) { %>  <%= anno %>
<% } %>  private <%= utils.getJavaType(column) %> <%= prop %>;
<% } %>
<% if (parentCol) {
  const parentProp = parentCol.propertyName || utils.toCamelCase(parentCol.columnName, true);
%>
  /* ---- 树形导航（<%= parentCol.columnName %> 自关联） ---- */
  @ApiModelProperty("父节点")
  @Navigate(value = RelationTypeEnum.ManyToOne, selfProperty = Fields.<%= parentProp %>, targetProperty = Fields.id)
  private <%= cls %> parent;

  @ApiModelProperty("子节点")
  @Navigate(value = RelationTypeEnum.OneToMany, selfProperty = Fields.id, targetProperty = Fields.<%= parentProp %>)
  private List<<%= cls %>> children;
<% } %>
<% if (context.table.navigates.length) { %>
  /* ---- 导航关系（easy-query @Navigate） ---- */
<% for (const nav of context.table.navigates) {
    const target = nav.target.className;
    const isMany = nav.type === "1N" || nav.type === "NN";
    const navDoc = nav.comment || nav.propertyName;
%>
  /** 导航(<%= nav.type %>): <%= nav.selfProperty.join(", ") %> -> <%= nav.target.tableName %>.<%= nav.targetProperty.join(", ") %> */
  @ApiModelProperty("<%= navDoc %>")
<% if (nav.type === "NN") { %>  @Navigate(
      value = RelationTypeEnum.ManyToMany,
      mappingClass = <%= nav.mappingTable.className %>.class,
      selfProperty = <%= fieldsArg(nav.selfProperty, null) %>,
      selfMappingProperty = <%= fieldsArg(nav.selfMappingProperty, nav.mappingTable) %>,
      targetMappingProperty = <%= fieldsArg(nav.targetMappingProperty, nav.mappingTable) %>,
      targetProperty = <%= fieldsArg(nav.targetProperty, nav.target) %>
  )
  private List<<%= target %>> <%= nav.propertyName %>;
<% } else { %>  @Navigate(value = RelationTypeEnum.<%= relEnum[nav.type] %>, selfProperty = <%= fieldsArg(nav.selfProperty, null) %>, targetProperty = <%= fieldsArg(nav.targetProperty, nav.target) %>)
  private <%= isMany ? "List<" + target + ">" : target %> <%= nav.propertyName %>;
<% } %>
<% } %>
<% } %>
}
`,
  },
  {
    id: 'tpl-mapper',
    name: 'mapper',
    content: `<%
  context.fileName = context.table.className + "Mapper.java";
  context.filePath = (context.basePackage ? context.basePackage.replace(/\\./g, "/") + "/" : "") + "mapper/" + context.fileName;
  context.language = "java";
  const cls = context.table.className || utils.toCamelCase(context.table.tableName);
  const comment = context.table.comment || context.table.tableName;
  const pkg = utils.isEmpty(context.basePackage) ? "" : context.basePackage + ".";
  const author = (context.settings.author || "").trim();
  const since = utils.nowDateTime();
  const addOn = utils.optionEnabled(context.table.options, "add");
  const updOn = utils.optionEnabled(context.table.options, "update");
  if (!addOn && !updOn) {
    context.aborted = true;
    return "";
  }
%>
package <%= pkg %>mapper;

import org.mapstruct.Mapper;
import org.mapstruct.factory.Mappers;
<% if (addOn) { %>import <%= pkg %>dto.<%= cls %>AddDTO;
<% } %><% if (updOn) { %>import <%= pkg %>dto.<%= cls %>UpdateDTO;
<% } %>import <%= pkg %>entity.<%= cls %>;

<%# ===== MapStruct 对象转换器：静态单例 INSTANCE，方法按表选项（add/update）选择性生成；两者皆关时整模板丢弃 ===== %>
/**
 * <%= comment %> MapStruct 对象转换器
 *
<% if (author) { %> * @author <%= author %>
<% } %> * @since <%= since %>
 */
@Mapper
public interface <%= cls %>Mapper {

  /**
   * 转换器单例（MapStruct 编译期生成实现类，静态单例方式初始化）
   */
  <%= cls %>Mapper INSTANCE = Mappers.getMapper(<%= cls %>Mapper.class);
<% if (addOn) { %>
  /**
   * <%= cls %>AddDTO 转换为 <%= cls %> 实体
   *
   * @param dto 新增参数对象
   * @return 转换后的实体
   */
  <%= cls %> toEntity(<%= cls %>AddDTO dto);
<% } %>
<% if (updOn) { %>
  /**
   * <%= cls %>UpdateDTO 转换为 <%= cls %> 实体
   *
   * @param dto 更新参数对象
   * @return 转换后的实体
   */
  <%= cls %> toEntity(<%= cls %>UpdateDTO dto);
<% } %>
}
`,
  },
  {
    id: 'tpl-service',
    name: 'service',
    content: `<%
  context.fileName = context.table.className + "Service.java";
  context.filePath = (context.basePackage ? context.basePackage.replace(/\\./g, "/") + "/" : "") + "service/" + context.fileName;
  context.language = "java";
  const cls = context.table.className || utils.toCamelCase(context.table.tableName);
  const comment = context.table.comment || context.table.tableName;
  const pkg = utils.isEmpty(context.basePackage) ? "" : context.basePackage + ".";
  const author = (context.settings.author || "").trim();
  const since = utils.nowDateTime();
  const queryOn = utils.optionEnabled(context.table.options, "query");
  const addOn = utils.optionEnabled(context.table.options, "add");
  const updOn = utils.optionEnabled(context.table.options, "update");
  const rmOn = utils.optionEnabled(context.table.options, "remove");
  if (!addOn && !updOn && !rmOn) {
    context.aborted = true;
    return "";
  }
%>
package <%= pkg %>service;

import org.jetbrains.annotations.NotNull;
<% if (queryOn) { %>import org.jetbrains.annotations.Nullable;
<% } %>
<% if (rmOn) { %>import java.util.List;
<% } %>
import <%= pkg %>entity.<%= cls %>;

<%# ===== 服务接口：方法按表选项选择性生成；add/update/remove 全关时整模板丢弃 ===== %>
/**
 * <%= comment %> 服务接口
 *
<% if (author) { %> * @author <%= author %>
<% } %> * @since <%= since %>
 */
public interface <%= cls %>Service {
<% if (queryOn) { %>
  /**
   * 按主键查询实体
   *
   * @param id 主键
   * @return 实体对象；查询不到时返回 null
   */
  @Nullable
  <%= cls %> getById(Long id);
<% } %>
<% if (addOn) { %>
  /**
   * 新增实体
   *
   * @param entity 实体对象
   */
  void add(@NotNull <%= cls %> entity);
<% } %>
<% if (updOn) { %>
  /**
   * 按主键整实体更新
   *
   * @param entity 实体对象
   */
  void update(@NotNull <%= cls %> entity);
<% } %>
<% if (rmOn) { %>
  /**
   * 按主键删除
   *
   * @param id 主键
   */
  void remove(@NotNull Long id);

  /**
   * 按主键批量删除
   *
   * @param ids 主键集合
   */
  void batchRemove(@NotNull List<Long> ids);
<% } %>
}
`,
  },
  {
    id: 'tpl-service-impl',
    name: 'serviceImpl',
    content: `<%
  context.fileName = context.table.className + "ServiceImpl.java";
  context.filePath = (context.basePackage ? context.basePackage.replace(/\\./g, "/") + "/" : "") + "service/impl/" + context.fileName;
  context.language = "java";
  const cls = context.table.className || utils.toCamelCase(context.table.tableName);
  const comment = context.table.comment || context.table.tableName;
  const pkg = utils.isEmpty(context.basePackage) ? "" : context.basePackage + ".";
  const author = (context.settings.author || "").trim();
  const since = utils.nowDateTime();
  const queryOn = utils.optionEnabled(context.table.options, "query");
  const addOn = utils.optionEnabled(context.table.options, "add");
  const updOn = utils.optionEnabled(context.table.options, "update");
  const rmOn = utils.optionEnabled(context.table.options, "remove");
  if (!addOn && !updOn && !rmOn) {
    context.aborted = true;
    return "";
  }
%>
package <%= pkg %>service.impl;

import com.easy.query.core.api.EasyQuery;
import org.jetbrains.annotations.NotNull;
<% if (queryOn) { %>import org.jetbrains.annotations.Nullable;
<% } %>import org.noear.solon.annotation.Component;
import org.noear.solon.annotation.Inject;
<% if (rmOn) { %>import java.util.List;
<% } %>
import <%= pkg %>entity.<%= cls %>;
import <%= pkg %>service.<%= cls %>Service;

<%# ===== 服务实现：solon3 容器组件 + easy-query 门面注入；方法与 service 接口按表选项联动 ===== %>
/**
 * <%= comment %> 服务实现
 *
<% if (author) { %> * @author <%= author %>
<% } %> * @since <%= since %>
 */
@Component
public class <%= cls %>ServiceImpl implements <%= cls %>Service {

  @Inject
  EasyQuery easyQuery;
<% if (queryOn) { %>
  /**
   * 按主键查询实体
   *
   * @param id 主键
   * @return 实体对象；查询不到时返回 null
   */
  @Override
  @Nullable
  public <%= cls %> getById(Long id) {
    return easyQuery.queryable(<%= cls %>.class).whereId(id).firstOrNull();
  }
<% } %>
<% if (addOn) { %>
  /**
   * 新增实体
   *
   * @param entity 实体对象
   */
  @Override
  public void add(@NotNull <%= cls %> entity) {
    easyQuery.insertable(entity).executeRows();
  }
<% } %>
<% if (updOn) { %>
  /**
   * 按主键整实体更新
   *
   * @param entity 实体对象
   */
  @Override
  public void update(@NotNull <%= cls %> entity) {
    easyQuery.updatable(entity).executeRows();
  }
<% } %>
<% if (rmOn) { %>
  /**
   * 按主键删除
   *
   * @param id 主键
   */
  @Override
  public void remove(@NotNull Long id) {
    easyQuery.deletable(<%= cls %>.class).whereId(id).executeRows();
  }

  /**
   * 按主键批量删除
   *
   * @param ids 主键集合
   */
  @Override
  public void batchRemove(@NotNull List<Long> ids) {
    easyQuery.deletable(<%= cls %>.class).whereByIds(ids).executeRows();
  }
<% } %>
}
`,
  },
  {
    id: 'tpl-controller',
    name: 'controller',
    content: `<%
  context.fileName = context.table.className + "Controller.java";
  context.filePath = (context.basePackage ? context.basePackage.replace(/\\./g, "/") + "/" : "") + "controller/" + context.fileName;
  context.language = "java";
  const cls = context.table.className || utils.toCamelCase(context.table.tableName);
  const comment = context.table.comment || context.table.tableName;
  const pkg = utils.isEmpty(context.basePackage) ? "" : context.basePackage + ".";
  const author = (context.settings.author || "").trim();
  const since = utils.nowDateTime();
  const mod = utils.toCamelCase(cls, true);
  const route = mod.replace(/([A-Z])/g, "-$1").toLowerCase();
  // 路径与权限码风格：表名按首下划线拆为「模块/功能」——sys_user → sys/user；
  // 无下划线时模块与功能同段（如 article → article）
  const nameParts = String(context.table.tableName).split("_").filter(Boolean);
  const module = (nameParts[0] || route).toLowerCase();
  const func = (nameParts.length > 1 ? nameParts.slice(1).join("_") : module).toLowerCase();
  // 权限码前缀：模块.功能（操作在后，如 sys.user.add）
  const perms = module + "." + func;
  const queryOn = utils.optionEnabled(context.table.options, "query");
  const addOn = utils.optionEnabled(context.table.options, "add");
  const updOn = utils.optionEnabled(context.table.options, "update");
  const rmOn = utils.optionEnabled(context.table.options, "remove");
  if (!queryOn && !addOn && !updOn && !rmOn) {
    context.aborted = true;
    return "";
  }
  // service 可用性：add/update/remove 全关时 service 模板被丢弃（无法注入），
  // 此时 info 直接经 easyEntityQuery 查询，避免悬空引用
  const svcAvailable = addOn || updOn || rmOn;
  const propOfCol = (column) => column.propertyName || utils.toCamelCase(column.columnName, true);
  const queryCols = queryOn
    ? context.table.columns.filter((c) => !c.primaryKey && utils.optionEnabled(c.options, "query"))
    : [];
  const isStrType = (jt) => jt === "String" || jt === "Character";
  // 时间类型（查询条件默认 rangeClosed 闭区间，拆起止双参数）
  const isTimeType = (jt) => /^(LocalDate|LocalDateTime|LocalTime|Timestamp)$/.test(jt);
  // id 类（外键 _id 结尾）或关联字典的列：eq 精准匹配（主键已被 queryCols 排除）
  const isIdOrDict = (c) => /_id$/.test(String(c.columnName)) || !utils.isBlank(c.dict);
  // 查询参数声明：时间列拆 <prop>Begin/<prop>End 双参数，其余单参数
  const paramDecls = [];
  for (const c of queryCols) {
    const p = propOfCol(c);
    const jt = utils.getJavaType(c);
    if (isTimeType(jt)) {
      paramDecls.push("@Param(value = \\"Begin" + p + "\\"Begin");
      paramDecls.push("@Param(value = \\"End" + p + "\\"End");
    } else {
      paramDecls.push("@Param(value = \\"" + p + "\\"");
    }
  }
  const listSignature = paramDecls.length === 0
    ? "public List<" + cls + "> list() {"
    : paramDecls.length === 1
      ? "public List<" + cls + "> list(" + paramDecls[0] + ") {"
      : "public List<" + cls + "> list(\\n            " + paramDecls.join(",\\n            ") + ") {";
  // 查询条件构建：时间 → rangeClosed（起止双参数）；id/字典 → eq；字符串 → like；其余数值 → eq
  const condLine = (c) => {
    const p = propOfCol(c);
    const jt = utils.getJavaType(c);
    if (isTimeType(jt)) {
      return "o." + p + "().rangeClosed(" + p + "Begin != null && " + p + "End != null, " + p + "Begin, " + p + "End);";
    }
    if (isIdOrDict(c)) {
      return "o." + p + "().eq(" + p + " != null, " + p + ");";
    }
    if (isStrType(jt)) {
      return "o." + p + "().like(" + p + " != null && !" + p + ".isEmpty(), " + p + ");";
    }
    return "o." + p + "().eq(" + p + " != null, " + p + ");";
  };
  // javadoc @param 行：时间列起止双参数，其余单参数
  const docParams = [];
  for (const c of queryCols) {
    const p = propOfCol(c);
    const jt = utils.getJavaType(c);
    if (isTimeType(jt)) {
      docParams.push({ p: p + "Begin", d: (c.comment || p) + "起始（可选）" });
      docParams.push({ p: p + "End", d: (c.comment || p) + "截止（可选，与起始构成闭区间）" });
    } else {
      docParams.push({ p, d: (c.comment || p) + "（可选）" });
    }
  }
%>
package <%= pkg %>controller;

import cn.dev33.satoken.annotation.SaCheckPermission;
<% if (queryOn) { %>import com.easy.query.api.proxy.client.EasyEntityQuery;
<% } %>import org.noear.solon.annotation.Controller;
<% if (addOn || updOn) { %>import org.noear.solon.annotation.Body;
<% } %><% if (queryOn) { %>import org.noear.solon.annotation.Get;
<% } %><% if (addOn || updOn || rmOn) { %>import org.noear.solon.annotation.Post;
<% } %><% if (queryOn || rmOn) { %>import org.noear.solon.annotation.Param;
<% } %>import org.noear.solon.annotation.Inject;
import org.noear.solon.annotation.Mapping;
<% if (queryOn) { %>import java.util.List;
<% } %>
import <%= pkg %>entity.<%= cls %>;
<% if (svcAvailable) { %>import <%= pkg %>service.<%= cls %>Service;
<% } %>

<%# ===== 接口层（solon3 MVC + satoken 注解鉴权）：路径 /api/模块/功能/操作、权限码 模块.功能.操作；端点按表选项生成，查询条件按列选项（时间 rangeClosed / id 与字典 eq / 字符串 like） ===== %>
/**
 * <%= comment %> 管理接口
 *
<% if (author) { %> * @author <%= author %>
<% } %> * @since <%= since %>
 */
@Controller
@Mapping("/api/<%= module %>/<%= func %>")
public class <%= cls %>Controller {

<% if (svcAvailable) { %>  @Inject
  <%= cls %>Service <%= mod %>Service;
<% } %><% if (queryOn) { %>
  @Inject
  EasyEntityQuery easyEntityQuery;
<% } %>
<% if (queryOn) { %>
  /**
   * 按主键查询详情
   *
   * @param id 主键
   * @return 实体详情；不存在时为 null
   */
  @SaCheckPermission("<%= perms %>.info")
  @Get
  @Mapping("info")
  public <%= cls %> info(@Param("id") Long id) {
<% if (svcAvailable) { %>    return <%= mod %>Service.getById(id);
<% } else { %>    return easyEntityQuery.queryable(<%= cls %>.class).whereId(id).firstOrNull();
<% } %>  }

  /**
   * 查询列表<% if (queryCols.length) { %>（支持可选条件过滤：时间区间闭合匹配、id 与字典精准匹配、字符串模糊匹配）<% } %>
   *
<% for (const dp of docParams) { %>   * @param <%= dp.p %> <%= dp.d %>
<% } %>   * @return 实体列表
   */
  @SaCheckPermission("<%= perms %>.list")
  @Get
  @Mapping("list")
  <%= listSignature %>
<% if (queryCols.length) { %>    return easyEntityQuery.queryable(<%= cls %>.class)
        .where(o -> {
<% for (const c of queryCols) { %>          <%= condLine(c) %>
<% } %>        })
        .toList();
<% } else { %>    return easyEntityQuery.queryable(<%= cls %>.class).toList();
<% } %>  }
<% } %>
<% if (addOn) { %>
  /**
   * 新增实体
   *
   * @param entity 实体对象
   */
  @SaCheckPermission("<%= perms %>.add")
  @Post
  @Mapping("add")
  public void add(@Body <%= cls %> entity) {
    <%= mod %>Service.add(entity);
  }
<% } %>
<% if (updOn) { %>
  /**
   * 按主键整实体更新
   *
   * @param entity 实体对象
   */
  @SaCheckPermission("<%= perms %>.edit")
  @Post
  @Mapping("edit")
  public void edit(@Body <%= cls %> entity) {
    <%= mod %>Service.update(entity);
  }
<% } %>
<% if (rmOn) { %>
  /**
   * 按主键删除
   *
   * @param id 主键
   */
  @SaCheckPermission("<%= perms %>.del")
  @Post
  @Mapping("del")
  public void del(@Param("id") Long id) {
    <%= mod %>Service.remove(id);
  }

  /**
   * 按主键批量删除
   *
   * @param ids 主键集合
   */
  @SaCheckPermission("<%= perms %>.del")
  @Post
  @Mapping("batchDel")
  public void batchDel(@Param("ids") List<Long> ids) {
    <%= mod %>Service.batchRemove(ids);
  }
<% } %>
}
`,
  },
  {
    id: 'tpl-vue',
    name: 'vue',
    content: `<%
  context.fileName = context.table.className + ".vue";
  context.filePath = "views/" + utils.toCamelCase(context.table.className, true).replace(/([A-Z])/g, "-$1").toLowerCase() + "/" + context.fileName;
  context.language = "javascript";
  const cls = context.table.className;
  const pk = context.table.columns.find(c => c.primaryKey);
  const pkProp = pk ? (pk.propertyName || utils.toCamelCase(pk.columnName, true)) : "id";
  const mod = utils.toCamelCase(cls, true);
  const route = mod.replace(/([A-Z])/g, "-$1").toLowerCase();
  // 接口前缀与 Controller 模板对齐：/api/模块/功能（表名按首下划线拆分）
  const nameParts = String(context.table.tableName).split("_").filter(Boolean);
  const module = (nameParts[0] || route).toLowerCase();
  const func = (nameParts.length > 1 ? nameParts.slice(1).join("_") : module).toLowerCase();
  const addOn = utils.optionEnabled(context.table.options, "add");
  const updOn = utils.optionEnabled(context.table.options, "update");
  const rmOn = utils.optionEnabled(context.table.options, "remove");
  const colShow = (column) => utils.optionEnabled(column.options, "show");
  const colForm = (column) => utils.optionEnabled(column.options, "add") || utils.optionEnabled(column.options, "update");
  const numTypes = ["Long", "Integer", "Short", "Double", "Float", "BigDecimal"];
  const tsType = (jt) => numTypes.includes(jt) ? "number" : "string";
  const defaultValue = (jt) => numTypes.includes(jt) ? "0" : "\\\\'\\\\'";
%>
<template>
  <div class="page">
    <a-card>
      <div class="table-toolbar">
        <a-space>
<% if (addOn) { %>          <a-button type="primary" @click="openCreate">新增</a-button>
<% } %>          <a-button :loading="loading" @click="fetchList">刷新</a-button>
        </a-space>
      </div>
      <a-table
        :columns="columns"
        :data-source="list"
        :loading="loading"
        :pagination="pagination"
        row-key="<%= pkProp %>"
      >
<% if (updOn || rmOn) { %>        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'action'">
            <a-space>
<% if (updOn) { %>              <a-button size="small" @click="openEdit(record as <%= cls %>)">编辑</a-button>
<% } %><% if (rmOn) { %>              <a-popconfirm title="确定删除该记录？" @confirm="handleRemove(record as <%= cls %>)">
                <a-button size="small" danger>删除</a-button>
              </a-popconfirm>
<% } %>            </a-space>
          </template>
        </template>
<% } %>      </a-table>
    </a-card>

    <a-modal
      v-model:open="modalOpen"
      :title="isEdit ? '编辑' : '新增'"
      :confirm-loading="saving"
      @ok="handleSave"
    >
      <a-form :model="form" layout="vertical">
<% for (const column of context.table.columns) { %>
<% if (column.primaryKey || !colForm(column)) { continue; } %>
<% const jt = utils.getJavaType(column); %>
<% const label = column.comment || column.propertyName; %>
<% const isNum = numTypes.includes(jt); %>
<% const isDate = /^Local(Date|Time|DateTime)$/.test(jt); %>
<% const dfmt = jt === "LocalDateTime" ? "YYYY-MM-DD HH:mm:ss" : "YYYY-MM-DD"; %>
<% const isText = /text/i.test(column.type); %>
        <a-form-item label="<%= label %>" name="<%= column.propertyName %>">
<% if (isNum) { %>          <a-input-number v-model:value="form.<%= column.propertyName %>" style="width: 100%" />
<% } else if (isDate) { %>          <a-date-picker v-model:value="form.<%= column.propertyName %>" value-format="<%= dfmt %>" style="width: 100%" />
<% } else if (isText) { %>          <a-textarea v-model:value="form.<%= column.propertyName %>" :rows="3" />
<% } else { %>          <a-input v-model:value="form.<%= column.propertyName %>" allow-clear />
<% } %>        </a-form-item>
<% } %>      </a-form>
    </a-modal>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { message } from 'antdv-next'
import type { TableColumnsType } from 'antdv-next'

/**
 * <%= context.table.comment || context.table.tableName %> 实体（字段与后端 easy-query Entity 对齐）
 */
interface <%= cls %> {
<% for (const column of context.table.columns) { %>  /** <%= column.comment || column.propertyName %> */
  <%= column.propertyName %>: <%= tsType(utils.getJavaType(column)) %>
<% } %>}

/** 后端接口前缀（solon Controller @Mapping） */
const API_BASE = '/api/<%= module %>/<%= func %>'

const loading = ref(false)
const saving = ref(false)
const list = ref<<%= cls %>[]>([])
const modalOpen = ref(false)
const isEdit = ref(false)
const form = reactive<<%= cls %>>(emptyForm())

const pagination = { pageSize: 10, showSizeChanger: true }

const columns: TableColumnsType = [
<% for (const column of context.table.columns) { %>
<% if (!colShow(column)) { continue; } %>  { title: '<%= column.comment || column.propertyName %>', dataIndex: '<%= column.propertyName %>' },
<% } %><% if (updOn || rmOn) { %>  { title: '操作', key: 'action', width: 140 },
<% } %>]

function emptyForm(): <%= cls %> {
  return {
<% for (const column of context.table.columns) { %>    <%= column.propertyName %>: <%= defaultValue(utils.getJavaType(column)) %>,
<% } %>  }
}

async function fetchList() {
  loading.value = true
  try {
    const res = await fetch(\`\${API_BASE}/list\`)
    if (!res.ok) throw new Error(\`HTTP \${res.status}\`)
    list.value = (await res.json()) as <%= cls %>[]
  } catch (e) {
    message.error(\`加载列表失败: \${(e as Error).message}\`)
  } finally {
    loading.value = false
  }
}

function openCreate() {
  isEdit.value = false
  Object.assign(form, emptyForm())
  modalOpen.value = true
}

function openEdit(record: <%= cls %>) {
  isEdit.value = true
  Object.assign(form, record)
  modalOpen.value = true
}

async function handleSave() {
  saving.value = true
  try {
    const action = isEdit.value ? 'edit' : 'add'
    const res = await fetch(\`\${API_BASE}/\${action}\`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
    if (!res.ok) throw new Error(\`HTTP \${res.status}\`)
    message.success(isEdit.value ? '保存成功' : '新增成功')
    modalOpen.value = false
    await fetchList()
  } catch (e) {
    message.error(\`保存失败: \${(e as Error).message}\`)
  } finally {
    saving.value = false
  }
}

async function handleRemove(record: <%= cls %>) {
  try {
    const res = await fetch(\`\${API_BASE}/del?id=\${record.<%= pkProp %>}\`, { method: 'POST' })
    if (!res.ok) throw new Error(\`HTTP \${res.status}\`)
    message.success('删除成功')
    await fetchList()
  } catch (e) {
    message.error(\`删除失败: \${(e as Error).message}\`)
  }
}

onMounted(fetchList)
</script>

<style scoped>
.table-toolbar {
  margin-bottom: 16px;
}
</style>
`,
  },
  {
    id: 'tpl-sql',
    name: 'sql',
    content: `<%
  context.fileName = context.table.tableName + ".sql";
  context.filePath = "sql/" + context.fileName;
%>
<% const pks = context.table.columns.filter(c => c.primaryKey); %>
<% const singleIntPk = pks.length === 1 && /^(tinyint|smallint|mediumint|int|integer|bigint)/i.test(pks[0].type); %>
<% const keyType = (t) => t === "UNIQUE" ? "UNIQUE KEY" : (t === "FULLTEXT" ? "FULLTEXT INDEX" : "KEY"); %>
<% const sq = (s) => "'" + String(s).split("'").join("''") + "'"; %>
<% const tail = []; %>
<% if (pks.length) { tail.push("  PRIMARY KEY (" + pks.map(c => "\`" + c.columnName + "\`").join(", ") + ")"); } %>
<% for (const idx of context.table.indexes) { %>
<% const idxBody = "  " + keyType(idx.type) + " \`" + idx.indexName + "\` (" + idx.columns.map(c => "\`" + c + "\`").join(", ") + ")" + (utils.isBlank(idx.comment) ? "" : " COMMENT " + sq(idx.comment)); %>
<% tail.push(idxBody); %>
<% } %>
<% const total = context.table.columns.length + tail.length; %>
<%# ===== MySQL 建表语句（utf8mb4 + 索引与主键随表结构生成） ===== %>
DROP TABLE IF EXISTS \`<%= context.table.tableName %>\`;
CREATE TABLE \`<%= context.table.tableName %>\` (
<% for (let i = 0; i < context.table.columns.length; i++) { %>
<% const column = context.table.columns[i]; %>
  \`<%= column.columnName %>\` <%= column.type %><% if (column.notNull) { %> NOT NULL<% } else { %> NULL<% } %><% if (column.primaryKey && singleIntPk) { %> AUTO_INCREMENT<% } %><% if (!utils.isBlank(column.comment)) { %> COMMENT <%= sq(column.comment) %><% } %><% if (i < total - 1) { %>,<% } %>
<% } %>
<% for (let j = 0; j < tail.length; j++) { %>
<%= tail[j] %><% if (j < tail.length - 1) { %>,<% } %>
<% } %>
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_general_ci COMMENT = <%= sq(context.table.comment || context.table.tableName) %>;`,
  },
  {
    id: 'tpl-menu-sql',
    name: 'menuSql',
    content: `<%
  context.fileName = context.table.tableName + "_menu.sql";
  context.filePath = "sql/" + context.fileName;
  const mod = utils.toCamelCase(context.table.className, true);
  const route = mod.replace(/([A-Z])/g, "-$1").toLowerCase();
  // 权限码与 Controller 模板一一对应：模块.功能.操作（表名按首下划线拆分）
  const nameParts = String(context.table.tableName).split("_").filter(Boolean);
  const module = (nameParts[0] || route).toLowerCase();
  const func = (nameParts.length > 1 ? nameParts.slice(1).join("_") : module).toLowerCase();
  const perms = module + "." + func;
  const sq = (s) => "'" + String(s).split("'").join("''") + "'";
  const menuName = context.table.comment || context.table.className;
  const queryOn = utils.optionEnabled(context.table.options, "query");
  const addOn = utils.optionEnabled(context.table.options, "add");
  const updOn = utils.optionEnabled(context.table.options, "update");
  const rmOn = utils.optionEnabled(context.table.options, "remove");
  const btns = [];
  if (queryOn) btns.push({ name: "查询", perms: perms + ".info" });
  if (queryOn) btns.push({ name: "列表", perms: perms + ".list" });
  if (addOn) btns.push({ name: "新增", perms: perms + ".add" });
  if (updOn) btns.push({ name: "编辑", perms: perms + ".edit" });
  if (rmOn) btns.push({ name: "删除", perms: perms + ".del" });
%>
<%# ===== MySQL 菜单与按钮权限初始化（sys_menu 为常见 RBAC 结构；按钮权限与 Controller 模板 @SaCheckPermission 按表选项一一对应） ===== %>
-- 一级菜单（parent_id = 0 为根目录，挂载位置按实际系统调整）
INSERT INTO sys_menu (menu_name, parent_id, order_num, path, component, menu_type, visible, status, perms, icon, create_time)
VALUES (<%= sq(menuName) %>, 0, 1, '<%= route %>', 'views/<%= route %>/<%= context.table.className %>', 'C', '0', '0', '<%= perms %>.list', 'list', NOW());
<% if (btns.length) { %>
-- 按钮权限（父菜单取上面新插入的记录；权限码与 Controller 模板的 @SaCheckPermission 一一对应，按表选项选择性生成）
SET @menuId = LAST_INSERT_ID();
INSERT INTO sys_menu (menu_name, parent_id, order_num, path, component, menu_type, visible, status, perms, icon, create_time) VALUES
<% for (let i = 0; i < btns.length; i++) { %>('<%= btns[i].name %>', @menuId, <%= i + 1 %>, '', '', 'F', '0', '0', '<%= btns[i].perms %>', '#', NOW())<% if (i < btns.length - 1) { %>,<% } else { %>;<% } %>
<% } %><% } %>
`,
  },
]

/** 字典分类模板种子（仅一个）：按分类生成 Java 字典常量类（每分类一个文件，含分类下全部字典与值） */
export const SEED_DICT_CATEGORY_TEMPLATE: CodeTemplate = {
  id: 'tpl-dict-category',
  name: 'dict',
  content: `<%
  // 分类属性推导产物路径与 Java 包名/类名：basePackage 基础包路径 + className 大驼峰类名；模板内可对 fileName/filePath 赋值覆盖
  const pkg = String(context.category.basePackage || "").trim();
  const cls = String(context.category.className || "").trim() || utils.toCamelCase(context.category.name) + "DictConstants";
  const pkgPath = pkg ? pkg.split(".").filter(Boolean).join("/") : "";
  context.fileName = cls + ".java";
  context.filePath = (pkgPath ? "src/main/java/" + pkgPath + "/" : "") + context.fileName;
  context.language = "java";
  const author = (context.settings.author || "").trim();
  const since = utils.nowDateTime();
  const pascal = (s) => utils.toCamelCase(s);
  // 常量名：字典值的常量属性名（propertyName，全大写）优先；缺省时由值键推导大写蛇形（数字键加 VALUE_ 前缀）。常量值统一为 String 类型
  const constName = (k) => /^[0-9]+$/.test(String(k)) ? "VALUE_" + k : String(k).replace(/([a-z0-9])([A-Z])/g, "$1_$2").replace(/[^A-Za-z0-9_]/g, "_").toUpperCase();
  const nameOf = (v) => String(v.propertyName || "").trim() || constName(v.valueKey);
%>
<% if (pkg) { %>package <%= pkg %>;
<% } %>
<%# ===== 字典分类常量类（每个字典分类生成一份，含分类下全部字典与值） ===== %>
/**
 * <%= context.category.name %> 字典常量
 *
<% if (author) { %> * @author <%= author %>
<% } %> * @since <%= since %>
 */
public final class <%= cls %> {

  private <%= cls %>() {
  }
<% for (const dict of context.dicts) { %>

  /**
   * <%= dict.label %><% if (dict.comment) { %>：<%= dict.comment %><% } %>
   * 字典键：<%= dict.dictKey %>
   */
  public static final class <%= pascal(dict.dictKey) %> {

    /** 字典键 */
    public static final String KEY = "<%= dict.dictKey %>";
<% for (const v of dict.values) { %>
    /** <%= v.label %><% if (v.comment) { %>：<%= v.comment %><% } %> */
    public static final String <%= nameOf(v) %> = "<%= v.valueKey %>";
<% } %>
  }
<% } %>
}
`,
}

/* ============ 模拟真实数据库（importFromDB 用） ============ */
export const SEED_DB_TABLES: DBTable[] = [
  {
    tableName: 't_blog',
    comment: '博客主表',
    columns: [
      { columnName: 'id', type: 'BIGINT', notNull: true, primaryKey: true, comment: '主键' },
      {
        columnName: 'title',
        type: 'VARCHAR(200)',
        notNull: true,
        primaryKey: false,
        comment: '标题',
      },
      {
        columnName: 'author',
        type: 'VARCHAR(50)',
        notNull: true,
        primaryKey: false,
        comment: '作者',
      },
      {
        columnName: 'content',
        type: 'LONGTEXT',
        notNull: false,
        primaryKey: false,
        comment: '正文',
      },
      {
        columnName: 'publish_time',
        type: 'DATETIME',
        notNull: false,
        primaryKey: false,
        comment: '发布时间',
      },
    ],
    indexes: [
      {
        indexName: 'idx_publish_time',
        type: 'NORMAL',
        columns: ['publish_time'],
        comment: '发布时间检索',
      },
    ],
  },
  {
    tableName: 't_blog_tag',
    comment: '博客标签',
    columns: [
      { columnName: 'id', type: 'BIGINT', notNull: true, primaryKey: true, comment: '主键' },
      {
        columnName: 'tag_name',
        type: 'VARCHAR(50)',
        notNull: true,
        primaryKey: false,
        comment: '标签名',
      },
    ],
    indexes: [
      { indexName: 'uk_tag_name', type: 'UNIQUE', columns: ['tag_name'], comment: '标签名唯一' },
    ],
  },
  {
    tableName: 't_blog_tag_rel',
    comment: '博客标签关联',
    columns: [
      { columnName: 'id', type: 'BIGINT', notNull: true, primaryKey: true, comment: '主键' },
      {
        columnName: 'blog_id',
        type: 'BIGINT',
        notNull: true,
        primaryKey: false,
        comment: '博客ID',
      },
      { columnName: 'tag_id', type: 'BIGINT', notNull: true, primaryKey: false, comment: '标签ID' },
    ],
    indexes: [
      {
        indexName: 'uk_blog_tag',
        type: 'UNIQUE',
        columns: ['blog_id', 'tag_id'],
        comment: '联合唯一',
      },
    ],
  },
  {
    tableName: 't_guestbook',
    comment: '留言板',
    columns: [
      { columnName: 'id', type: 'BIGINT', notNull: true, primaryKey: true, comment: '主键' },
      {
        columnName: 'nickname',
        type: 'VARCHAR(50)',
        notNull: true,
        primaryKey: false,
        comment: '昵称',
      },
      {
        columnName: 'message',
        type: 'VARCHAR(500)',
        notNull: true,
        primaryKey: false,
        comment: '留言内容',
      },
      {
        columnName: 'reply',
        type: 'VARCHAR(500)',
        notNull: false,
        primaryKey: false,
        comment: '管理员回复',
      },
      {
        columnName: 'created_at',
        type: 'DATETIME',
        notNull: true,
        primaryKey: false,
        comment: '留言时间',
      },
    ],
    indexes: [],
  },
  {
    tableName: 't_stat_daily',
    comment: '每日统计',
    columns: [
      { columnName: 'id', type: 'BIGINT', notNull: true, primaryKey: true, comment: '主键' },
      {
        columnName: 'stat_date',
        type: 'DATE',
        notNull: true,
        primaryKey: false,
        comment: '统计日期',
      },
      { columnName: 'pv', type: 'INT', notNull: true, primaryKey: false, comment: '访问量' },
      { columnName: 'uv', type: 'INT', notNull: true, primaryKey: false, comment: '独立访客' },
    ],
    indexes: [
      { indexName: 'uk_stat_date', type: 'UNIQUE', columns: ['stat_date'], comment: '日期唯一' },
      { indexName: 'idx_uv', type: 'NORMAL', columns: ['uv'], comment: '' },
    ],
  },
]

/* ============ 设置 ============ */
/**
 * 默认表选项定义：表编辑对话框据此渲染表选项编辑项，模板按表选项分支生成代码。
 * 值缺省（未设置）时一律视为启用（true）。
 */
export const SEED_TABLE_OPTIONS: OptionSetting[] = [
  { name: 'query', type: 'boolean', label: '查询', remark: '是否启用查询' },
  { name: 'add', type: 'boolean', label: '添加', remark: '是否启用添加' },
  { name: 'update', type: 'boolean', label: '更新', remark: '是否启用更新' },
  { name: 'remove', type: 'boolean', label: '删除', remark: '是否启用删除' },
]

/**
 * 默认列选项定义：表编辑对话框据此渲染列选项编辑项（字段表格中的动态选项列）。
 * 值缺省（未设置）时一律视为启用（true）。
 */
export const SEED_COLUMN_OPTIONS: OptionSetting[] = [
  { name: 'show', type: 'boolean', label: '显示', remark: '是否启用列表中显示' },
  { name: 'query', type: 'boolean', label: '查询', remark: '是否作为查询条件' },
  { name: 'add', type: 'boolean', label: '添加', remark: '是否启用添加' },
  { name: 'update', type: 'boolean', label: '更新', remark: '是否启用更新' },
  { name: 'remove', type: 'boolean', label: '删除', remark: '是否启用删除' },
]

/**
 * 种子设置：索引类型列表 + 列类型映射规则（按 sort 升序，导入时依序正则匹配，取第一条命中）
 * + 代码生成配置（作者 javadoc @author / 表选项 / 列选项元定义）
 * + 主键与审计字段约定（表编辑固定首字段与审计字段一键增删）。
 * 注意顺序依赖：bigint 先于 int、datetime/timestamp 先于 time/date、
 * char(1) 先于 char，否则前缀类类型会被宽泛规则抢先命中
 */
export const SEED_SETTINGS: Settings = {
  indexTypes: ['UNIQUE', 'NORMAL', 'FULLTEXT'],
  typeMappings: [
    { sort: 0, pattern: '^\\s*char\\s*\\(\\s*1\\s*\\)', javaType: 'Character' },
    { sort: 1, pattern: 'char', javaType: 'String' },
    { sort: 2, pattern: 'text', javaType: 'String' },
    { sort: 3, pattern: 'json|enum|set', javaType: 'String' },
    { sort: 4, pattern: 'bigint', javaType: 'Long' },
    { sort: 5, pattern: 'int', javaType: 'Integer' },
    { sort: 6, pattern: 'decimal|numeric', javaType: 'BigDecimal' },
    { sort: 7, pattern: 'float', javaType: 'Float' },
    { sort: 8, pattern: 'double|real', javaType: 'Double' },
    { sort: 9, pattern: 'datetime', javaType: 'LocalDateTime' },
    { sort: 10, pattern: 'timestamp', javaType: 'Timestamp' },
    { sort: 11, pattern: '^\\s*time', javaType: 'LocalTime' },
    { sort: 12, pattern: 'date', javaType: 'LocalDate' },
    { sort: 13, pattern: 'year', javaType: 'Integer' },
  ],
  author: 'dbm-editor',
  tableOptions: SEED_TABLE_OPTIONS.map((o) => ({ ...o })),
  columnOptions: SEED_COLUMN_OPTIONS.map((o) => ({ ...o })),
  /** 主键与审计字段约定（默认值，与 utils/fieldConvention.ts 的 DEFAULT_FIELD_CONVENTIONS 一致；审计字段蛇形命名，Java 属性名自动转小驼峰） */
  fieldConventions: {
    primaryKey: { name: 'id', type: 'BIGINT' },
    auditFields: {
      createBy: { name: 'create_by', type: 'BIGINT' },
      createTime: { name: 'create_time', type: 'DATETIME' },
      updateBy: { name: 'update_by', type: 'BIGINT' },
      updateTime: { name: 'update_time', type: 'DATETIME' },
    },
  },
}
