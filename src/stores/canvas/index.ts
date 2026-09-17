/**
 * 画布仓库模块出口（barrel）
 * 保持与拆分前 src/stores/canvas.ts 相同的公开导出，外部导入路径与用法不变。
 *
 * 内部结构：
 * - types.ts       类型与 CanvasStore 契约
 * - constants.ts   缩放上下限
 * - viewport.ts    视口与坐标换算
 * - pointer.ts     指针交互状态机（鼠标 / 笔）
 * - touch.ts       触屏手势（双指 / 长按 / 双击）
 * - selection.ts   选择集、悬停与菜单开关
 * - cards.ts       卡片状态（尺寸 / 展开 / 索引 / 隐藏）
 * - layout.ts      自动美化与对齐分布
 * - clipboard.ts   复制 / 粘贴
 * - store.ts       状态字段、getter 与组装
 */
export { MAX_ZOOM, MIN_ZOOM } from "./constants";
export type {
  AlignMode,
  CanvasDeps,
  CanvasStore,
  ContextMenuKind,
  ContextMenuState,
} from "./types";
export { createCanvasStore, useCanvasStore } from "./store";
