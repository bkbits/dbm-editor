/**
 * 画布仓库：类型与契约
 * （从 stores/canvas.ts 拆分而来：本文件只放类型定义与 CanvasStore 显式接口，
 *   无运行逻辑。CanvasStore 由 stores/canvas/store.ts 的组装结果 `satisfies` 校验，
 *   各 part 文件以 `ThisType<CanvasStore>` 取得一致的 this 上下文）
 */
import type { TableAddPayload } from "@/types/model";
import type { Point, Rect, Side } from "@/utils/geometry";
import type { ModelStore } from "../model";
import type { UiStore } from "../ui";
import type { HistoryStore } from "../history";

export type ContextMenuKind = "canvas" | "card" | "edge";

/** 对齐/分布模式 */
export type AlignMode =
  | "left"
  | "hcenter"
  | "right"
  | "top"
  | "vcenter"
  | "bottom"
  | "hdistribute"
  | "vdistribute";

export interface ContextMenuState {
  kind: ContextMenuKind;
  x: number; // 屏幕坐标（相对画布根元素）
  y: number;
  world: Point;
  tableId?: string;
  navigateId?: string;
}

export type Mode = "pan" | "select" | "dragCards" | "connect" | "pinch" | null;

/** 工厂依赖（惰性取用，与原先 action 内 useXxxStore() 的运行时语义一致） */
export interface CanvasDeps {
  getModel: () => ModelStore;
  getUi: () => UiStore;
  getHistory: () => HistoryStore;
}

/** 平移手势草稿 */
export interface PanDraft {
  sx: number;
  sy: number;
  lastX: number;
  lastY: number;
  moved: boolean;
  touch: boolean;
}

/** 框选草稿（世界坐标对角） */
export interface SelectDraft {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** 卡片拖拽草稿 */
export interface DragDraft {
  startWorld: Point;
  ids: string[];
  origPositions: Record<string, Point>;
  moved: boolean;
}

/** 连线草稿 */
export interface ConnectDraft {
  fromTableId: string;
  fromSide: Side;
  world: Point;
  hoverTableId: string | null;
}

/** 画布仓库对外形态（状态字段 + 派生 getter + 各域动作） */
export interface CanvasStore {
  rootEl: HTMLElement | null;
  zoom: number;
  panX: number;
  panY: number;
  viewportW: number;
  viewportH: number;
  selectedIds: string[];
  selectedCategoryIds: string[];
  selectedNavigateId: string;
  hoveredNavigateId: string;
  hoveredTableId: string;
  expandedTableIds: string[];
  showIndexIds: string[];
  cardSizes: Record<string, { w: number; h: number }>;
  mode: Mode;
  spacePressed: boolean;
  additiveSelect: boolean;
  pointerCaptured: boolean;
  panDraft: PanDraft | null;
  selectDraft: SelectDraft | null;
  dragDraft: DragDraft | null;
  connectDraft: ConnectDraft | null;
  clipboard: Array<Omit<TableAddPayload, "id">>;
  menu: ContextMenuState | null;
  animating: boolean;
  layoutAnimating: boolean;
  _everFit: boolean;

  readonly zoomPercent: number;
  readonly worldStyle: Record<string, string>;
  readonly viewportWorldRect: Rect;
  readonly visibleTableIds: string[];
  readonly hiddenTableIds: string[];

  /* 初始化与坐标换算 */
  init(rootEl: HTMLElement): void;
  measure(): void;
  localPoint(e: { clientX: number; clientY: number }): Point;
  screenToWorld(p: Point): Point;
  worldToScreen(p: Point): Point;

  /* 视口（缩放 / 平移 / 适配 / 动画） */
  zoomAt(localX: number, localY: number, factor: number): void;
  zoomStep(factor: number): void;
  resetZoom(): void;
  cardRectOf(id: string): Rect | null;
  cardRectsOf(ids: string[]): Rect[];
  fitAll(instant?: boolean): void;
  centerOnTable(tableId: string): void;
  ensureTableVisible(tableId: string): void;
  animateTo(target: { zoom?: number; panX?: number; panY?: number }, duration?: number): void;
  jumpTo(worldX: number, worldY: number): void;
  onWheel(e: WheelEvent): void;

  /* 选择与悬停 */
  setSelection(ids: string[]): void;
  selectCategory(id: string, additive?: boolean): void;
  selectTable(id: string, additive?: boolean): void;
  clearSelection(): void;
  setHoveredTable(id: string): void;
  setHoveredNavigate(id: string): void;
  setSelectedNavigate(id: string): void;

  /* 指针交互状态机 */
  capturePointer(e: PointerEvent): void;
  captureOnce(e: PointerEvent): void;
  resetPointerCapture(): void;
  onCanvasPointerDown(e: PointerEvent): void;
  beginPan(e: PointerEvent): void;
  beginSelect(e: PointerEvent): void;
  beginCardDrag(tableId: string, e: PointerEvent): void;
  startConnect(tableId: string, side: Side, e: PointerEvent): void;
  onPointerMove(e: PointerEvent): void;
  onPointerUp(_e: PointerEvent): void;
  hitTableAt(e: { clientX: number; clientY: number }): string | null;
  finishConnect(fromTableId: string, hoverTableId: string | null): void;

  /* 触屏手势 */
  onTouchPointerDown(e: PointerEvent): void;
  onTouchPointerMove(e: PointerEvent): void;
  onTouchPointerEnd(e: PointerEvent): void;
  scheduleLongPress(pointerId: number): void;
  cancelLongPress(): void;
  touchMenuGuard(): boolean;
  abortActiveGesture(): void;
  buildPinchBase(): { dist: number; zoom: number; worldMid: Point } | null;
  applyPinch(): void;

  /* 卡片状态 */
  setCardSize(tableId: string, w: number, h: number): void;
  toggleExpand(tableId: string): void;
  isExpanded(tableId: string): boolean;
  toggleShowIndexes(tableId: string): void;
  showIndexes(tableId: string): boolean;
  toggleHiddenTable(tableId: string): void;
  hideTable(tableId: string): void;
  showTable(tableId: string): void;

  /* 布局 */
  autoLayout(): Promise<void>;
  alignSelection(mode: AlignMode): Promise<void>;

  /* 菜单与剪贴板 */
  openMenu(menu: ContextMenuState): void;
  closeMenu(): void;
  copySelection(): number;
  pasteAt(world: Point): Promise<void>;
  hasClipboard(): boolean;
}
