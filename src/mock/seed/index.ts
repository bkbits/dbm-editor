/**
 * 种子数据统一出口（barrel）
 *
 * 原 mock/seed.ts 单文件按域拆分为五个模块，此处显式再导出全部种子
 * 常量：消费方（mock/db.ts 的 createSeedDB / loadDB 兜底、demo-manager-api
 * 的 importFromDB）仍经 "@/mock/seed" 或 "./seed" 导入，调用面零改动。
 *
 * 另提供三份「重置演示数据」快照构造函数（模型元素 / 字典 / 模板），
 * 供大纲面板的重置按钮与 AI 的 resetDemo 工具共用——经 ManagerApi 的
 * 全量替换契约（save / saveDicts / saveTemplates）落盘。
 */
import type { Dict, ModelElements, Template } from "@/types/model";
import { SEED_CATEGORIES, SEED_NAVIGATES, SEED_TABLES } from "./tables";
import { SEED_DICTS } from "./dicts";
import { SEED_DICT_CATEGORY_TEMPLATE, SEED_TEMPLATES } from "./templates";

export { SEED_CATEGORIES, SEED_HIDDEN_TABLE_NAMES, SEED_NAVIGATES, SEED_TABLES } from "./tables";
export { SEED_DICT_CATEGORIES, SEED_DICTS } from "./dicts";
export { SEED_DICT_CATEGORY_TEMPLATE, SEED_TEMPLATES } from "./templates";
export { SEED_DB_TABLES } from "./import-db";
export { SEED_COLUMN_OPTIONS, SEED_SETTINGS, SEED_TABLE_OPTIONS } from "./settings";

/** 深拷贝（JSON 往返；种子均为纯数据形态，防运行时修改污染种子） */
function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

/** 种子模型元素快照（分类 / 表含字段与索引 / 导航）：重置演示数据用 */
export function seedModelElements(): ModelElements {
  return {
    categories: clone(SEED_CATEGORIES),
    tables: clone(SEED_TABLES),
    navigates: clone(SEED_NAVIGATES),
  };
}

/** 种子字典快照（含字典分类归属）：重置演示数据用 */
export function seedDicts(): Dict[] {
  return clone(SEED_DICTS);
}

/** 种子模板快照（表模板 + 字典模板，契约 Template 形态）：重置演示数据用 */
export function seedTemplates(): Template[] {
  return [
    ...clone(SEED_TEMPLATES).map((t) => {
      const spec: Template = { id: t.id, templateName: t.name, content: t.content };
      return spec;
    }),
    {
      id: SEED_DICT_CATEGORY_TEMPLATE.id,
      templateName: SEED_DICT_CATEGORY_TEMPLATE.name,
      content: SEED_DICT_CATEGORY_TEMPLATE.content,
    },
  ];
}
