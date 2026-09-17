/**
 * 模型仓库模块出口（barrel）
 * 保持与拆分前 src/stores/model.ts 相同的公开导出，外部导入路径与用法不变。
 *
 * 内部结构：
 * - types.ts       类型与 ModelStore 契约（含 ModelSnapshot / ModelDeps）
 * - helpers.ts     深拷贝与实体比较
 * - loader.ts      加载与全量动作（init / refresh / saveAll / modelElementsOf）
 * - vo.ts          字段索引装配与 VO 投影
 * - categories.ts  表分类增删改
 * - tables.ts      表增删改与位置持久化
 * - navigates.ts   导航关系增删改与反向反转
 * - clipboard.ts   表复制 / 粘贴
 * - import.ts      从真实数据库导入
 * - snapshot.ts    快照与恢复
 * - store.ts       状态字段、getter 与组装
 */
export type { ModelDeps, ModelSnapshot, ModelStore } from "./types";
export { createModelStore, useModelStore } from "./store";
