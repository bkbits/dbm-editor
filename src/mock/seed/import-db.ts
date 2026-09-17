/**
 * 种子数据 · 模拟真实数据库表结构（importFromDB 演示数据）
 *
 * 从原 mock/seed.ts 单文件按域拆出：DemoManagerApi.importFromDB 返回的
 * 内置模拟库表（DBTable 形态，区别于应用内模型），供「从数据库导入」
 * 对话框演示真实接入场景。
 */
import type { DBTable } from "@/types/model";

/* ============ 模拟真实数据库（importFromDB 用） ============ */
/** 模拟真实数据库表结构（importFromDB 演示数据，DBTable 形态） */
export const SEED_DB_TABLES: DBTable[] = [
  {
    tableName: "t_blog",
    comment: "博客主表",
    columns: [
      { columnName: "id", type: "BIGINT", notNull: true, primaryKey: true, comment: "主键" },
      {
        columnName: "title",
        type: "VARCHAR(200)",
        notNull: true,
        primaryKey: false,
        comment: "标题",
      },
      {
        columnName: "author",
        type: "VARCHAR(50)",
        notNull: true,
        primaryKey: false,
        comment: "作者",
      },
      {
        columnName: "content",
        type: "LONGTEXT",
        notNull: false,
        primaryKey: false,
        comment: "正文",
      },
      {
        columnName: "publish_time",
        type: "DATETIME",
        notNull: false,
        primaryKey: false,
        comment: "发布时间",
      },
    ],
    indexes: [
      {
        indexName: "idx_publish_time",
        type: "NORMAL",
        columns: ["publish_time"],
        comment: "发布时间检索",
      },
    ],
  },
  {
    tableName: "t_blog_tag",
    comment: "博客标签",
    columns: [
      { columnName: "id", type: "BIGINT", notNull: true, primaryKey: true, comment: "主键" },
      {
        columnName: "tag_name",
        type: "VARCHAR(50)",
        notNull: true,
        primaryKey: false,
        comment: "标签名",
      },
    ],
    indexes: [
      { indexName: "uk_tag_name", type: "UNIQUE", columns: ["tag_name"], comment: "标签名唯一" },
    ],
  },
  {
    tableName: "t_blog_tag_rel",
    comment: "博客标签关联",
    columns: [
      { columnName: "id", type: "BIGINT", notNull: true, primaryKey: true, comment: "主键" },
      {
        columnName: "blog_id",
        type: "BIGINT",
        notNull: true,
        primaryKey: false,
        comment: "博客ID",
      },
      { columnName: "tag_id", type: "BIGINT", notNull: true, primaryKey: false, comment: "标签ID" },
    ],
    indexes: [
      {
        indexName: "uk_blog_tag",
        type: "UNIQUE",
        columns: ["blog_id", "tag_id"],
        comment: "联合唯一",
      },
    ],
  },
  {
    tableName: "t_guestbook",
    comment: "留言板",
    columns: [
      { columnName: "id", type: "BIGINT", notNull: true, primaryKey: true, comment: "主键" },
      {
        columnName: "nickname",
        type: "VARCHAR(50)",
        notNull: true,
        primaryKey: false,
        comment: "昵称",
      },
      {
        columnName: "message",
        type: "VARCHAR(500)",
        notNull: true,
        primaryKey: false,
        comment: "留言内容",
      },
      {
        columnName: "reply",
        type: "VARCHAR(500)",
        notNull: false,
        primaryKey: false,
        comment: "管理员回复",
      },
      {
        columnName: "created_at",
        type: "DATETIME",
        notNull: true,
        primaryKey: false,
        comment: "留言时间",
      },
    ],
    indexes: [],
  },
  {
    tableName: "t_stat_daily",
    comment: "每日统计",
    columns: [
      { columnName: "id", type: "BIGINT", notNull: true, primaryKey: true, comment: "主键" },
      {
        columnName: "stat_date",
        type: "DATE",
        notNull: true,
        primaryKey: false,
        comment: "统计日期",
      },
      { columnName: "pv", type: "INT", notNull: true, primaryKey: false, comment: "访问量" },
      { columnName: "uv", type: "INT", notNull: true, primaryKey: false, comment: "独立访客" },
    ],
    indexes: [
      { indexName: "uk_stat_date", type: "UNIQUE", columns: ["stat_date"], comment: "日期唯一" },
      { indexName: "idx_uv", type: "NORMAL", columns: ["uv"], comment: "" },
    ],
  },
];
