/**
 * 种子数据统一出口（barrel）
 *
 * 原 mock/seed.ts 单文件按域拆分为五个模块，此处显式再导出全部种子
 * 常量：消费方（mock/db.ts 的 createSeedDB / loadDB 兜底、demo-manager-api
 * 的 importFromDB）仍经 "@/mock/seed" 或 "./seed" 导入，调用面零改动。
 */
export { SEED_CATEGORIES, SEED_HIDDEN_TABLE_NAMES, SEED_NAVIGATES, SEED_TABLES } from "./tables";
export { SEED_DICT_CATEGORIES, SEED_DICTS } from "./dicts";
export { SEED_DICT_CATEGORY_TEMPLATE, SEED_TEMPLATES } from "./templates";
export { SEED_DB_TABLES } from "./import-db";
export { SEED_COLUMN_OPTIONS, SEED_SETTINGS, SEED_TABLE_OPTIONS } from "./settings";
