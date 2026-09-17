/**
 * 画布仓库：触屏手势
 * （双指缩放 / 长按菜单 / 双击编辑 / 手势打断）
 */
import type { Point } from "@/utils/geometry";
import { MAX_ZOOM, MIN_ZOOM } from "./constants";
import type { CanvasDeps, CanvasStore } from "./types";

/* ==================== 触屏手势内部状态（非响应式，闭包私有） ====================
 * 说明：手势跟踪数据（指针坐标/基线/定时器）不需要驱动渲染，
 * 放闭包避免 reactive 代理开销；渲染相关的 zoom/panX/panY 本身已是响应式字段 */
const LONG_PRESS_MS = 480;
const LONG_PRESS_SLOP = 10;
const DOUBLE_TAP_MS = 350;
const DOUBLE_TAP_RANGE = 48;
/** 当前按下的触屏指针（pointerId → 最新坐标，client 系）；亦供 pointer.ts 判定触摸来源 */
export const touchPts = new Map<number, { x: number; y: number }>();
/** 触屏指针按下时刻的起点/时间/目标（轻点与长按判定用） */
const touchStart = new Map<number, { x: number; y: number; t: number; target: Element | null }>();
/** 双指缩放基线（起始间距/起始缩放/锚点世界坐标）；null = 当前无缩放 */
let pinchBase: { dist: number; zoom: number; worldMid: Point } | null = null;
/** 本次手势簇内是否出现过双指（出现过则整簇的轻点不再参与双击判定） */
let pinchSeen = false;
let longPressTimer = 0;
let longPressFired = false;
let lastTap: { t: number; tableId: string; x: number; y: number } | null = null;
/** 长按打开菜单的时刻（压制 Android 原生 contextmenu 重复开菜单） */
let lastMenuAt = 0;
/**
 * 触屏手势 part：双指缩放、长按菜单、双击编辑与手势打断。
 * 闭包内跟踪数据（touchPts / pinchBase 等）非响应式；this 由 ThisType<CanvasStore> 提供。
 */
export function touchMethods(deps: CanvasDeps) {
  return {
    /** 触屏按下登记：小地图与右键菜单除外；第二指落下转双指缩放并终止单指手势，第三指仅登记生命周期 */
    onTouchPointerDown(e: PointerEvent) {
      if (e.pointerType !== "touch") return;
      if (!this.rootEl?.contains(e.target as Node)) return;
      // 小地图（自有拖拽语义）与右键菜单本身（点按菜单项）不参与画布手势
      const t = e.target as Element | null;
      if (t?.closest?.(".minimap, .ctx-menu")) return;
      touchPts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      touchStart.set(e.pointerId, {
        x: e.clientX,
        y: e.clientY,
        t: Date.now(),
        target: e.target as Element | null,
      });
      longPressFired = false;
      if (touchPts.size === 1) {
        this.scheduleLongPress(e.pointerId);
      } else if (touchPts.size === 2) {
        // 第二指落下：终止单指手势（拖卡/框选/连线/平移/长按），进入双指缩放
        pinchSeen = true;
        this.cancelLongPress();
        this.abortActiveGesture();
        this.mode = "pinch";
        pinchBase = this.buildPinchBase();
      }
      // 第三指及以后仅登记生命周期（缩放始终取前两指）
    },
    /** 触屏指针移动（仅已登记的指针） */
    onTouchPointerMove(e: PointerEvent) {
      if (e.pointerType !== "touch") return;
      if (!touchPts.has(e.pointerId)) return;
      touchPts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.mode === "pinch") {
        if (!pinchBase) pinchBase = this.buildPinchBase(); // 双指过近时推迟到分开后建立基线
        this.applyPinch();
        return;
      }
      // 单指阶段的长按位移守卫：手指挪动超过容差即取消长按定时器
      const st = touchStart.get(e.pointerId);
      if (st && !longPressFired && Math.hypot(e.clientX - st.x, e.clientY - st.y) > LONG_PRESS_SLOP)
        this.cancelLongPress();
    },
    /** 触屏指针抬起/取消 */
    onTouchPointerEnd(e: PointerEvent) {
      if (e.pointerType !== "touch") return;
      const st = touchStart.get(e.pointerId) ?? null;
      touchPts.delete(e.pointerId);
      touchStart.delete(e.pointerId);
      this.cancelLongPress();
      const inPinch = pinchBase !== null || this.mode === "pinch";
      if (inPinch) {
        if (touchPts.size >= 2) {
          // 三指抬其一：以剩余前两指重建缩放基线
          pinchBase = this.buildPinchBase();
        } else if (touchPts.size === 1) {
          // 剩一指：无缝转为单指平移（已移动标记，避免轻点误清选择）
          pinchBase = null;
          const [p] = [...touchPts.values()];
          this.mode = "pan";
          this.panDraft = {
            sx: p.x,
            sy: p.y,
            lastX: p.x,
            lastY: p.y,
            moved: true,
            touch: true,
          };
        } else {
          // 全部抬起：结束手势簇
          pinchBase = null;
          this.mode = null;
          this.panDraft = null;
          pinchSeen = false;
        }
        return;
      }
      const wasPinchCluster = pinchSeen;
      if (touchPts.size === 0) pinchSeen = false;
      if (wasPinchCluster) return;
      // 干净轻点（时长短 + 位移小 + 未触发长按）：双击卡片 = 打开表编辑
      const tapDisplacement = st ? Math.hypot(e.clientX - st.x, e.clientY - st.y) : Infinity;
      if (!longPressFired && st && Date.now() - st.t < 400 && tapDisplacement < LONG_PRESS_SLOP) {
        const target = st.target;
        const onConnector = Boolean(target?.closest?.(".connector"));
        const card = target?.closest?.("[data-table-id]") as HTMLElement | null;
        const tableId = card?.getAttribute("data-table-id");
        if (tableId && !onConnector) {
          if (
            lastTap &&
            Date.now() - lastTap.t < DOUBLE_TAP_MS &&
            lastTap.tableId === tableId &&
            Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < DOUBLE_TAP_RANGE
          ) {
            lastTap = null;
            deps.getUi().openTableEdit(tableId);
          } else {
            lastTap = { t: Date.now(), tableId, x: e.clientX, y: e.clientY };
          }
        } else {
          lastTap = null;
        }
      }
    },
    /** 调度长按菜单（480ms 无位移触发，按按下目标分流卡片/线段/画布菜单） */
    scheduleLongPress(pointerId: number) {
      this.cancelLongPress();
      longPressTimer = window.setTimeout(() => {
        longPressTimer = 0;
        if (touchPts.size !== 1 || this.mode === "pinch" || pinchBase) return;
        const st = touchStart.get(pointerId);
        const cur = touchPts.get(pointerId);
        if (!st || !cur) return;
        if (Math.hypot(cur.x - st.x, cur.y - st.y) > LONG_PRESS_SLOP) return;
        longPressFired = true;
        this.abortActiveGesture();
        const local = this.localPoint({ clientX: st.x, clientY: st.y });
        const world = this.screenToWorld(local);
        const target = st.target;
        const card = target?.closest?.("[data-table-id]") as HTMLElement | null;
        const edge = target?.closest?.("[data-navigate-id]") as HTMLElement | null;
        lastMenuAt = Date.now();
        if (card?.getAttribute("data-table-id")) {
          this.openMenu({
            kind: "card",
            x: local.x,
            y: local.y,
            world,
            tableId: card.getAttribute("data-table-id") as string,
          });
        } else if (edge?.getAttribute("data-navigate-id")) {
          this.openMenu({
            kind: "edge",
            x: local.x,
            y: local.y,
            world,
            navigateId: edge.getAttribute("data-navigate-id") as string,
          });
        } else {
          this.openMenu({ kind: "canvas", x: local.x, y: local.y, world });
        }
        // 轻微触觉反馈（支持的浏览器静默忽略）
        navigator.vibrate?.(12);
      }, LONG_PRESS_MS);
    },
    /** 取消长按定时器（位移超容差 / 第二指落下 / 抬起时调用），幂等 */
    cancelLongPress() {
      if (longPressTimer) {
        clearTimeout(longPressTimer);
        longPressTimer = 0;
      }
    },
    /** 长按刚开过菜单（压制 Android 长按后紧接着派发的原生 contextmenu 重复开菜单） */
    touchMenuGuard(): boolean {
      return Date.now() - lastMenuAt < 400;
    },
    /** 无副作用丢弃当前单指手势（进入双指缩放 / 长按菜单前调用） */
    abortActiveGesture() {
      if (!this.mode || this.mode === "pinch") return;
      const mode = this.mode;
      this.mode = null;
      this.resetPointerCapture();
      if (mode === "dragCards" && this.dragDraft) {
        const ids = this.dragDraft.ids;
        const moved = this.dragDraft.moved;
        this.dragDraft = null;
        // 已发生位移的拖卡：按正常落点语义落库，避免位置更新滞留内存
        if (moved)
          deps
            .getModel()
            .persistTables(ids)
            .catch(() => undefined);
      } else if (mode === "connect") {
        this.connectDraft = null;
      }
      this.selectDraft = null;
      this.panDraft = null;
    },
    /** 建立双指缩放基线（间距过近时不建立，待分开后补建） */
    buildPinchBase(): { dist: number; zoom: number; worldMid: Point } | null {
      const pts = [...touchPts.values()].slice(0, 2);
      if (pts.length < 2) return null;
      const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
      if (dist < 12) return null;
      const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
      const local = this.localPoint({ clientX: mid.x, clientY: mid.y });
      return { dist, zoom: this.zoom, worldMid: this.screenToWorld(local) };
    },
    /** 应用双指缩放：锚定按下时的世界点跟随双指中点（缩放 + 双指平移一体） */
    applyPinch() {
      if (!pinchBase) return;
      const pts = [...touchPts.values()].slice(0, 2);
      if (pts.length < 2) return;
      const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
      if (dist < 12) return;
      const factor = dist / pinchBase.dist;
      const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, pinchBase.zoom * factor));
      const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
      const local = this.localPoint({ clientX: mid.x, clientY: mid.y });
      this.zoom = next;
      this.panX = local.x - pinchBase.worldMid.x * next;
      this.panY = local.y - pinchBase.worldMid.y * next;
    },
  } satisfies ThisType<CanvasStore> & Partial<CanvasStore>;
}
