/**
 * 画布仓库：状态字段、派生 getter 与各域方法组装
 * （reactive 对象工厂形态，由 DBManagerView 经上下文注入，不依赖 Pinia；
 *   各域动作见 viewport / pointer / touch / selection / cards / layout / clipboard，
 *   组装结果经 `satisfies CanvasStore` 校验成员完整性）
 */
import { reactive } from "vue";
import { useDBManagerContext } from "../context";
import type { TableAddPayload } from "@/types/model";
import type { Point, Rect, Side } from "@/utils/geometry";
import { cardMethods } from "./cards";
import { clipboardMethods } from "./clipboard";
import { layoutMethods } from "./layout";
import { pointerMethods } from "./pointer";
import { selectionMethods } from "./selection";
import { touchMethods } from "./touch";
import { viewportMethods } from "./viewport";
import type { CanvasDeps, CanvasStore, ContextMenuState, Mode } from "./types";

/**
 * 创建画布仓库：组装状态字段、派生 getter 与各域 part，返回 reactive 代理，
 * 并经 `satisfies CanvasStore` 校验成员完整性；各 part 以 ThisType 共享同一 this。
 */
export function createCanvasStore(deps: CanvasDeps): CanvasStore {
  return reactive({
    rootEl: null as HTMLElement | null,
    zoom: 1,
    panX: 0,
    panY: 0,
    viewportW: 0,
    viewportH: 0,
    selectedIds: [] as string[],
    selectedCategoryIds: [] as string[],
    selectedNavigateId: "",
    hoveredNavigateId: "",
    hoveredTableId: "",
    expandedTableIds: [] as string[],
    showIndexIds: [] as string[],
    cardSizes: {} as Record<string, { w: number; h: number }>,
    mode: null as Mode,
    spacePressed: false,
    additiveSelect: false,
    /** 当前手势是否已捕获指针（延迟捕获：超过位移阈值才捕获，避免偷走 click/dblclick） */
    pointerCaptured: false,
    panDraft: null as {
      sx: number;
      sy: number;
      lastX: number;
      lastY: number;
      /** 累计位移是否超过阈值（触屏轻点空白 = 取消选择，需区分轻点与拖动） */
      moved: boolean;
      /** 是否触屏发起（触屏轻点语义：无位移时清空选择） */
      touch: boolean;
    } | null,
    selectDraft: null as { x0: number; y0: number; x1: number; y1: number } | null,
    dragDraft: null as {
      startWorld: Point;
      ids: string[];
      origPositions: Record<string, Point>;
      moved: boolean;
    } | null,
    connectDraft: null as {
      fromTableId: string;
      fromSide: Side;
      world: Point;
      hoverTableId: string | null;
    } | null,
    clipboard: [] as Array<Omit<TableAddPayload, "id">>,
    menu: null as ContextMenuState | null,
    animating: false,
    /** 自动美化/对齐后卡片位置过渡动画进行中（卡片渲染层启用 left/top 过渡） */
    layoutAnimating: false,
    _everFit: false,

    /** 缩放百分比（四舍五入，供工具栏显示） */
    get zoomPercent(): number {
      return Math.round(this.zoom * 100);
    },
    /** 世界层变换样式 */
    get worldStyle(): Record<string, string> {
      return {
        transform: `translate(${this.panX}px, ${this.panY}px) scale(${this.zoom})`,
        transformOrigin: "0 0",
      };
    },
    /** 当前视口对应的世界矩形 */
    get viewportWorldRect(): Rect {
      return {
        x: (0 - this.panX) / this.zoom,
        y: (0 - this.panY) / this.zoom,
        w: this.viewportW / this.zoom,
        h: this.viewportH / this.zoom,
      };
    },
    /** 可见（未隐藏）表 id 列表，由 Table.hidden 派生 */
    get visibleTableIds(): string[] {
      const model = deps.getModel();
      return model.tables.filter((t) => !t.hidden).map((t) => t.id);
    },
    /** 隐藏表 id 列表（由 Table.hidden 派生，不再单独持久化） */
    get hiddenTableIds(): string[] {
      const model = deps.getModel();
      return model.tables.filter((t) => t.hidden).map((t) => t.id);
    },
    ...viewportMethods(deps),
    ...selectionMethods(),
    ...pointerMethods(deps),
    ...touchMethods(deps),
    ...cardMethods(deps),
    ...layoutMethods(deps),
    ...clipboardMethods(deps),
  }) satisfies CanvasStore;
}

/** 子组件取用画布仓库（须处于 DBManagerView 组件树内） */
export function useCanvasStore(): CanvasStore {
  return useDBManagerContext().canvas;
}
