/**
 * Mock 种子数据：内置一套完整的演示模型
 * （系统管理 / 内容管理 / 商城 三个分类，含一对一、一对多、多对多及中间表）
 */
import type {
  AppSettings,
  CodeTemplate,
  DBTableDef,
  Dict,
  TableColumn,
  TableCategory,
  TableIndex,
  TableNavigate,
} from '@/types/model'
import { toCamelCase } from '@/utils/string'
import { getJavaTypeByType } from '@/utils/javaType'

/* ============ 分类 ============ */
export const SEED_CATEGORIES: TableCategory[] = [
  { id: 'cat-system', name: '系统管理', basePackage: 'com.example.system', src: 'src/main/java/com/example/system' },
  { id: 'cat-content', name: '内容管理', basePackage: 'com.example.cms', src: 'src/main/java/com/example/cms' },
  { id: 'cat-mall', name: '商城模块', basePackage: 'com.example.mall', src: 'src/main/java/com/example/mall' },
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
      { id: 'i-sys-user-username', tableId: 't-sys-user', indexName: 'uk_username', type: 'UNIQUE' as const, columns: ['username'], comment: '登录名唯一' },
      { id: 'i-sys-user-email', tableId: 't-sys-user', indexName: 'idx_email', type: 'NORMAL' as const, columns: ['email'], comment: '邮箱查询' },
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
      { id: 'i-sys-role-code', tableId: 't-sys-role', indexName: 'uk_role_code', type: 'UNIQUE' as const, columns: ['role_code'], comment: '' },
    ],
  },
  {
    id: 't-sys-user-role',
    categoryId: 'cat-system',
    tableName: 'sys_user_role',
    className: 'SysUserRole',
    comment: '用户角色中间表',
    x: 300,
    y: 420,
    columns: buildColumns('t-sys-user-role', [
      ['id', 'BIGINT', { primaryKey: true, notNull: true, comment: '主键' }],
      ['user_id', 'BIGINT', { notNull: true, comment: '用户ID' }],
      ['role_id', 'BIGINT', { notNull: true, comment: '角色ID' }],
    ]),
    indexes: [
      { id: 'i-sur-uk', tableId: 't-sys-user-role', indexName: 'uk_user_role', type: 'UNIQUE' as const, columns: ['user_id', 'role_id'], comment: '联合唯一' },
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
      { id: 'i-article-category', tableId: 't-cms-article', indexName: 'idx_category', type: 'NORMAL' as const, columns: ['category_id'], comment: '分类检索' },
      { id: 'i-article-fulltext', tableId: 't-cms-article', indexName: 'ft_title_content', type: 'FULLTEXT' as const, columns: ['title', 'content'], comment: '全文检索' },
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
      { id: 'i-comment-article', tableId: 't-cms-comment', indexName: 'idx_article', type: 'NORMAL' as const, columns: ['article_id'], comment: '' },
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
      { id: 'i-order-no', tableId: 't-mall-order', indexName: 'uk_order_no', type: 'UNIQUE' as const, columns: ['order_no'], comment: '订单号唯一' },
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

/** 默认隐藏的表（中间表默认不显示在画布上） */
export const SEED_HIDDEN_TABLES = ['t-sys-user-role', 't-sys-role-menu', 't-cms-article-tag']

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
export const SEED_DICTS: Dict[] = [
  {
    id: 'dict-sys-status',
    dictKey: 'sys_status',
    label: '系统状态',
    comment: '通用的启用/禁用状态',
    values: [
      { id: 'dv-ss-0', dictId: 'dict-sys-status', valueKey: '0', label: '禁用', labelType: 'D', comment: '不可用' },
      { id: 'dv-ss-1', dictId: 'dict-sys-status', valueKey: '1', label: '启用', labelType: 'S', comment: '正常' },
      { id: 'dv-ss-2', dictId: 'dict-sys-status', valueKey: '2', label: '锁定', labelType: 'W', comment: '临时锁定' },
    ],
  },
  {
    id: 'dict-user-type',
    dictKey: 'user_type',
    label: '用户类型',
    comment: '用户账号类型',
    values: [
      { id: 'dv-ut-0', dictId: 'dict-user-type', valueKey: '0', label: '普通用户', labelType: 'I' },
      { id: 'dv-ut-1', dictId: 'dict-user-type', valueKey: '1', label: '会员', labelType: 'S' },
      { id: 'dv-ut-9', dictId: 'dict-user-type', valueKey: '9', label: '管理员', labelType: 'W', comment: '后台管理员' },
    ],
  },
  {
    id: 'dict-article-status',
    dictKey: 'article_status',
    label: '文章状态',
    values: [
      { id: 'dv-as-0', dictId: 'dict-article-status', valueKey: '0', label: '草稿', labelType: 'I' },
      { id: 'dv-as-1', dictId: 'dict-article-status', valueKey: '1', label: '已发布', labelType: 'S' },
      { id: 'dv-as-2', dictId: 'dict-article-status', valueKey: '2', label: '审核中', labelType: 'W' },
      { id: 'dv-as-3', dictId: 'dict-article-status', valueKey: '3', label: '已下架', labelType: 'D' },
    ],
  },
  {
    id: 'dict-order-status',
    dictKey: 'order_status',
    label: '订单状态',
    values: [
      { id: 'dv-os-0', dictId: 'dict-order-status', valueKey: '0', label: '待支付', labelType: 'I' },
      { id: 'dv-os-1', dictId: 'dict-order-status', valueKey: '1', label: '已支付', labelType: 'S' },
      { id: 'dv-os-2', dictId: 'dict-order-status', valueKey: '2', label: '已发货', labelType: 'W' },
      { id: 'dv-os-3', dictId: 'dict-order-status', valueKey: '3', label: '已完成', labelType: 'S' },
      { id: 'dv-os-4', dictId: 'dict-order-status', valueKey: '4', label: '已取消', labelType: 'D', comment: '自定义颜色示例', color: '#9333ea' },
    ],
  },
  {
    id: 'dict-mall-status',
    dictKey: 'mall_status',
    label: '商品状态',
    values: [
      { id: 'dv-ms-0', dictId: 'dict-mall-status', valueKey: '0', label: '下架', labelType: 'D' },
      { id: 'dv-ms-1', dictId: 'dict-mall-status', valueKey: '1', label: '上架', labelType: 'S' },
    ],
  },
]

/* ============ 模板 ============ */
export const SEED_TEMPLATES: CodeTemplate[] = [
  {
    id: 'tpl-entity',
    name: 'entity',
    content: `<%
  context.fileName = utils.toCamelCase(context.table.className, true) + ".java";
  context.filePath = (context.basePackage ? context.basePackage.replace(/\\./g, "/") + "/" : "") + "entity/" + context.fileName;
%>
package <%= utils.isEmpty(context.basePackage) ? "" : context.basePackage + "." %>entity;
import java.io.Serializable;
<% const needDate = context.table.columns.some(c => /LocalDate|LocalDateTime|LocalTime/.test(utils.getJavaType(c))); %>
<% const needList = context.table.navigates.some(n => n.type === "1N" || n.type === "NN"); %>
<% if (needDate) { %>
import java.time.LocalDateTime;
<% } %>
<% if (needList) { %>
import java.util.List;
<% } %>
<%# ===== 实体类 ===== %>
<% if (!utils.isBlank(context.table.comment)) { %>
/**
 * <%= context.table.comment %>
 */
<% } %>
public class <%= context.table.className %> implements Serializable {
  private static final long serialVersionUID = 1L;
<% for (const column of context.table.columns) { %>
  <% if (!utils.isBlank(column.comment)) { %>
  /** <%= column.comment %> */
  <% } %>
  private <%= utils.getJavaType(column) %> <%= column.propertyName %>;
<% } %>
<% for (const nav of context.table.navigates) { %>
  /** 导航(<%= nav.type %>): <%= nav.target.tableName %> */
  private <%= (nav.type === "1N" || nav.type === "NN") ? "List<" + nav.target.className + ">" : nav.target.className %> <%= nav.propertyName %>;
<% } %>
}`,
  },
  {
    id: 'tpl-dao',
    name: 'dao',
    content: `<%
  context.fileName = utils.toCamelCase(context.table.className, true) + "Dao.java";
  context.filePath = (context.basePackage ? context.basePackage.replace(/\\./g, "/") + "/" : "") + "dao/" + context.fileName;
%>
package <%= utils.isEmpty(context.basePackage) ? "" : context.basePackage + "." %>dao;
<% const pk = context.table.columns.find(c => c.primaryKey); %>
<% const pkJava = pk ? utils.getJavaType(pk) : "Long"; %>
<% const pkProp = pk ? utils.toCamelCase(pk.columnName, true) : "id"; %>
<%# ===== 数据访问接口 ===== %>
public interface <%= context.table.className %>Dao {
  /** 根据主键查询 */
  <%= context.table.className %> getBy<%= utils.toCamelCase(pk ? pk.columnName : "id") %>(<%= pkJava %> <%= pkProp %>);
  /** 查询全部 */
  java.util.List<<%= context.table.className %>> listAll();
  /** 新增，返回影响行数 */
  int insert(<%= context.table.className %> entity);
  /** 更新，返回影响行数 */
  int update(<%= context.table.className %> entity);
  /** 删除，返回影响行数 */
  int deleteBy<%= utils.toCamelCase(pk ? pk.columnName : "id") %>(<%= pkJava %> <%= pkProp %>);
}`,
  },
  {
    id: 'tpl-service',
    name: 'service',
    content: `<%
  context.fileName = utils.toCamelCase(context.table.className, true) + "Service.java";
  context.filePath = (context.basePackage ? context.basePackage.replace(/\\./g, "/") + "/" : "") + "service/" + context.fileName;
%>
package <%= utils.isEmpty(context.basePackage) ? "" : context.basePackage + "." %>service;
<% const pk = context.table.columns.find(c => c.primaryKey); %>
<% const pkJava = pk ? utils.getJavaType(pk) : "Long"; %>
<% const pkProp = pk ? utils.toCamelCase(pk.columnName, true) : "id"; %>
<%# ===== 服务接口 ===== %>
public interface <%= context.table.className %>Service {
  /** 根据主键查询 */
  <%= context.table.className %> getById(<%= pkJava %> <%= pkProp %>);
  /** 新增 */
  void create(<%= context.table.className %> entity);
  /** 更新 */
  void update(<%= context.table.className %> entity);
  /** 删除 */
  void remove(<%= pkJava %> <%= pkProp %>);
}`,
  },
  {
    id: 'tpl-sql',
    name: 'sql',
    content: `<%
  context.fileName = context.table.tableName + ".sql";
  context.filePath = "sql/" + context.fileName;
%>
<%# ===== 建表语句 ===== %>
DROP TABLE IF EXISTS \`<%= context.table.tableName %>\`;
CREATE TABLE \`<%= context.table.tableName %>\` (
<% for (let i = 0; i < context.table.columns.length; i++) { %>
<% const column = context.table.columns[i]; %>
  \`<%= column.columnName %>\` <%= column.type %><% if (column.notNull) { %> NOT NULL<% } %><% if (column.primaryKey) { %> PRIMARY KEY<% } %><% if (!utils.isBlank(column.comment)) { %> COMMENT <%= utils.quote(column.comment) %><% } %><% if (i < context.table.columns.length - 1) { %>,<% } %>
<% } %>
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT=<%= utils.quote(context.table.comment || context.table.tableName) %>;`,
  },
]

/* ============ 模拟真实数据库（queryFromDB 用） ============ */
export const SEED_DB_TABLES: DBTableDef[] = [
  {
    tableName: 't_blog',
    comment: '博客主表',
    columns: [
      { columnName: 'id', type: 'BIGINT', notNull: true, primaryKey: true, comment: '主键' },
      { columnName: 'title', type: 'VARCHAR(200)', notNull: true, primaryKey: false, comment: '标题' },
      { columnName: 'author', type: 'VARCHAR(50)', notNull: true, primaryKey: false, comment: '作者' },
      { columnName: 'content', type: 'LONGTEXT', notNull: false, primaryKey: false, comment: '正文' },
      { columnName: 'publish_time', type: 'DATETIME', notNull: false, primaryKey: false, comment: '发布时间' },
    ],
  },
  {
    tableName: 't_blog_tag',
    comment: '博客标签',
    columns: [
      { columnName: 'id', type: 'BIGINT', notNull: true, primaryKey: true, comment: '主键' },
      { columnName: 'tag_name', type: 'VARCHAR(50)', notNull: true, primaryKey: false, comment: '标签名' },
    ],
  },
  {
    tableName: 't_blog_tag_rel',
    comment: '博客标签关联',
    columns: [
      { columnName: 'id', type: 'BIGINT', notNull: true, primaryKey: true, comment: '主键' },
      { columnName: 'blog_id', type: 'BIGINT', notNull: true, primaryKey: false, comment: '博客ID' },
      { columnName: 'tag_id', type: 'BIGINT', notNull: true, primaryKey: false, comment: '标签ID' },
    ],
  },
  {
    tableName: 't_guestbook',
    comment: '留言板',
    columns: [
      { columnName: 'id', type: 'BIGINT', notNull: true, primaryKey: true, comment: '主键' },
      { columnName: 'nickname', type: 'VARCHAR(50)', notNull: true, primaryKey: false, comment: '昵称' },
      { columnName: 'message', type: 'VARCHAR(500)', notNull: true, primaryKey: false, comment: '留言内容' },
      { columnName: 'reply', type: 'VARCHAR(500)', notNull: false, primaryKey: false, comment: '管理员回复' },
      { columnName: 'created_at', type: 'DATETIME', notNull: true, primaryKey: false, comment: '留言时间' },
    ],
  },
  {
    tableName: 't_stat_daily',
    comment: '每日统计',
    columns: [
      { columnName: 'id', type: 'BIGINT', notNull: true, primaryKey: true, comment: '主键' },
      { columnName: 'stat_date', type: 'DATE', notNull: true, primaryKey: false, comment: '统计日期' },
      { columnName: 'pv', type: 'INT', notNull: true, primaryKey: false, comment: '访问量' },
      { columnName: 'uv', type: 'INT', notNull: true, primaryKey: false, comment: '独立访客' },
    ],
  },
]

/* ============ 设置 ============ */
/**
 * 种子设置：列默认类型规则（有序，导入时依序正则匹配，取第一条命中）
 * 注意顺序依赖：bigint 先于 int、datetime/timestamp 先于 time/date、
 * char(1) 先于 char，否则前缀类类型会被宽泛规则抢先命中
 */
export const SEED_SETTINGS: AppSettings = {
  columnTypeRules: [
    { id: 'rule-char-1', pattern: '^\\s*char\\s*\\(\\s*1\\s*\\)', javaType: 'Character' },
    { id: 'rule-char', pattern: 'char', javaType: 'String' },
    { id: 'rule-text', pattern: 'text', javaType: 'String' },
    { id: 'rule-json-enum-set', pattern: 'json|enum|set', javaType: 'String' },
    { id: 'rule-bigint', pattern: 'bigint', javaType: 'Long' },
    { id: 'rule-int', pattern: 'int', javaType: 'Integer' },
    { id: 'rule-decimal', pattern: 'decimal|numeric', javaType: 'BigDecimal' },
    { id: 'rule-float', pattern: 'float', javaType: 'Float' },
    { id: 'rule-double', pattern: 'double|real', javaType: 'Double' },
    { id: 'rule-datetime', pattern: 'datetime', javaType: 'LocalDateTime' },
    { id: 'rule-timestamp', pattern: 'timestamp', javaType: 'Timestamp' },
    { id: 'rule-time', pattern: '^\\s*time', javaType: 'LocalTime' },
    { id: 'rule-date', pattern: 'date', javaType: 'LocalDate' },
    { id: 'rule-year', pattern: 'year', javaType: 'Integer' },
  ],
}
