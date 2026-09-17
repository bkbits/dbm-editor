/**
 * 种子数据 · 字典与字典分类
 *
 * 从原 mock/seed.ts 单文件按域拆出：内置字典分类与各业务字典
 * （状态 / 类型标记，含值类型色标与常量属性名）。
 */
import type { Dict, DictCategory } from "@/types/model";

/* ============ 字典 ============ */
/** 字典分类：与表分类同构（分类名称 + 基础包路径 + 大驼峰类名——字典代码生成的包名/类名依据） */
export const SEED_DICT_CATEGORIES: DictCategory[] = [
  {
    id: "dictcat-system",
    name: "系统字典",
    basePackage: "com.example.constants.dict",
    className: "SysDictConstants",
  },
  {
    id: "dictcat-business",
    name: "业务字典",
    basePackage: "com.example.constants.dict",
    className: "BizDictConstants",
  },
];

/** 内置字典（状态 / 类型标记等业务字典，含值类型色标） */
export const SEED_DICTS: Dict[] = [
  {
    id: "dict-sys-status",
    categoryId: "dictcat-system",
    dictKey: "sys_status",
    label: "系统状态",
    comment: "通用的启用/禁用状态",
    values: [
      {
        id: "dv-ss-0",
        dictId: "dict-sys-status",
        valueKey: "0",
        propertyName: "DISABLED",
        label: "禁用",
        labelType: "D",
        comment: "不可用",
      },
      {
        id: "dv-ss-1",
        dictId: "dict-sys-status",
        valueKey: "1",
        propertyName: "ENABLED",
        label: "启用",
        labelType: "S",
        comment: "正常",
      },
      {
        id: "dv-ss-2",
        dictId: "dict-sys-status",
        valueKey: "2",
        propertyName: "LOCKED",
        label: "锁定",
        labelType: "W",
        comment: "临时锁定",
      },
    ],
  },
  {
    id: "dict-user-type",
    categoryId: "dictcat-system",
    dictKey: "user_type",
    label: "用户类型",
    comment: "用户账号类型",
    values: [
      {
        id: "dv-ut-0",
        dictId: "dict-user-type",
        valueKey: "0",
        propertyName: "NORMAL",
        label: "普通用户",
        labelType: "I",
      },
      {
        id: "dv-ut-1",
        dictId: "dict-user-type",
        valueKey: "1",
        propertyName: "MEMBER",
        label: "会员",
        labelType: "S",
      },
      {
        id: "dv-ut-9",
        dictId: "dict-user-type",
        valueKey: "9",
        propertyName: "ADMIN",
        label: "管理员",
        labelType: "W",
        comment: "后台管理员",
      },
    ],
  },
  {
    id: "dict-article-status",
    categoryId: "dictcat-business",
    dictKey: "article_status",
    label: "文章状态",
    values: [
      {
        id: "dv-as-0",
        dictId: "dict-article-status",
        valueKey: "0",
        propertyName: "DRAFT",
        label: "草稿",
        labelType: "I",
      },
      {
        id: "dv-as-1",
        dictId: "dict-article-status",
        valueKey: "1",
        propertyName: "PUBLISHED",
        label: "已发布",
        labelType: "S",
      },
      {
        id: "dv-as-2",
        dictId: "dict-article-status",
        valueKey: "2",
        propertyName: "REVIEWING",
        label: "审核中",
        labelType: "W",
      },
      {
        id: "dv-as-3",
        dictId: "dict-article-status",
        valueKey: "3",
        propertyName: "OFF_SHELF",
        label: "已下架",
        labelType: "D",
      },
    ],
  },
  {
    id: "dict-order-status",
    categoryId: "dictcat-business",
    dictKey: "order_status",
    label: "订单状态",
    values: [
      {
        id: "dv-os-0",
        dictId: "dict-order-status",
        valueKey: "0",
        propertyName: "UNPAID",
        label: "待支付",
        labelType: "I",
      },
      {
        id: "dv-os-1",
        dictId: "dict-order-status",
        valueKey: "1",
        propertyName: "PAID",
        label: "已支付",
        labelType: "S",
      },
      {
        id: "dv-os-2",
        dictId: "dict-order-status",
        valueKey: "2",
        propertyName: "SHIPPED",
        label: "已发货",
        labelType: "W",
      },
      {
        id: "dv-os-3",
        dictId: "dict-order-status",
        valueKey: "3",
        propertyName: "COMPLETED",
        label: "已完成",
        labelType: "S",
      },
      {
        id: "dv-os-4",
        dictId: "dict-order-status",
        valueKey: "4",
        propertyName: "CANCELLED",
        label: "已取消",
        labelType: "D",
        comment: "自定义颜色示例",
        color: "#9333ea",
      },
    ],
  },
  {
    id: "dict-mall-status",
    categoryId: "dictcat-business",
    dictKey: "mall_status",
    label: "商品状态",
    values: [
      {
        id: "dv-ms-0",
        dictId: "dict-mall-status",
        valueKey: "0",
        propertyName: "OFF_SHELF",
        label: "下架",
        labelType: "D",
      },
      {
        id: "dv-ms-1",
        dictId: "dict-mall-status",
        valueKey: "1",
        propertyName: "ON_SHELF",
        label: "上架",
        labelType: "S",
      },
    ],
  },
];
