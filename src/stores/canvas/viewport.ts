/**
 * 画布仓库：视口与坐标换算
 * （缩放 / 平移 / 适配全览 / 居中 / 视口动画，以及屏幕 ↔ 世界坐标换算与卡片矩形查询）
 */
import { CARD_WIDTH, rectCenter } from "@/utils/geometry";
import type { Point, Rect } from "@/utils/geometry";
import { MAX_ZOOM, MIN_ZOOM } from "./constants";
import type { CanvasDeps, CanvasStore } from "./types";

/**
 * 视口 part：缩放 / 平移 / 适配全览 / 居中 / 视口动画，以及屏幕 ↔ 世界坐标换算与卡片矩形查询。
 * this 上下文由 ThisType<CanvasStore> 提供。
 */
export function viewportMethods(deps: CanvasDeps) {
  return {
    /** 挂载画布根元素并测量尺寸；首次拿到有效尺寸时立即适配全览（跳过开局动画） */
    init(rootEl: HTMLElement) {
      this.rootEl = rootEl;
      this.measure();
      if (this.viewportW > 0 && !this._everFit) {
        this._everFit = true;
        this.fitAll(true);
      }
    },
    /** 测量画布根元素尺寸写入 viewportW / viewportH（根元素未挂载时不动） */
    measure() {
      if (!this.rootEl) return;
      const rect = this.rootEl.getBoundingClientRect();
      this.viewportW = rect.width;
      this.viewportH = rect.height;
    },

    /* ==================== 坐标换算 ==================== */
    /** 客户端坐标换算为相对画布根元素的局部坐标（各指针事件统一入口） */
    localPoint(e: { clientX: number; clientY: number }): Point {
      const rect = this.rootEl?.getBoundingClientRect();
      return { x: e.clientX - (rect?.left ?? 0), y: e.clientY - (rect?.top ?? 0) };
    },
    /** 局部坐标换算为世界坐标（减去平移后除以缩放） */
    screenToWorld(p: Point): Point {
      return { x: (p.x - this.panX) / this.zoom, y: (p.y - this.panY) / this.zoom };
    },
    /** 世界坐标换算为局部坐标（乘缩放后加平移） */
    worldToScreen(p: Point): Point {
      return { x: p.x * this.zoom + this.panX, y: p.y * this.zoom + this.panY };
    },

    /* ==================== 视口 ==================== */
    /** 以局部点为锚缩放 factor 倍（结果夹在 MIN_ZOOM ~ MAX_ZOOM；保持锚点下世界点不动） */
    zoomAt(localX: number, localY: number, factor: number) {
      const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, this.zoom * factor));
      if (next === this.zoom) return;
      // 保持鼠标下的世界点不动
      const wx = (localX - this.panX) / this.zoom;
      const wy = (localY - this.panY) / this.zoom;
      this.zoom = next;
      this.panX = localX - wx * next;
      this.panY = localY - wy * next;
    },
    /** 以视口中心为锚按 factor 缩放（工具栏放大 / 缩小按钮用） */
    zoomStep(factor: number) {
      this.zoomAt(this.viewportW / 2, this.viewportH / 2, factor);
    },
    /** 平滑恢复 100% 缩放（不改平移量，锚点为视口左上角） */
    resetZoom() {
      this.animateTo({ zoom: 1 });
    },
    /** 查表卡片世界矩形：尺寸取上报值，未上报按 CARD_WIDTH × 140 兜底；表不存在返回 null */
    cardRectOf(id: string): Rect | null {
      const t = deps.getModel().tableById(id);
      if (!t) return null;
      const size = this.cardSizes[id] || { w: CARD_WIDTH, h: 140 };
      return { x: t.x ?? 0, y: t.y ?? 0, w: size.w, h: size.h };
    },
    /** 批量查卡片世界矩形：跳过不存在的表 */
    cardRectsOf(ids: string[]): Rect[] {
      return ids.map((id) => this.cardRectOf(id)).filter((r): r is Rect => Boolean(r));
    },
    /** 适配全览可见表卡片：四周留 60px 边距、缩放上限 1.25；instant 为真立即生效，否则平滑动画 */
    fitAll(instant = false) {
      const rects = this.cardRectsOf(this.visibleTableIds);
      if (!rects.length) {
        if (instant) {
          this.panX = 0;
          this.panY = 0;
        }
        return;
      }
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const r of rects) {
        minX = Math.min(minX, r.x);
        minY = Math.min(minY, r.y);
        maxX = Math.max(maxX, r.x + r.w);
        maxY = Math.max(maxY, r.y + r.h);
      }
      const pad = 60;
      const w = maxX - minX + pad * 2;
      const h = maxY - minY + pad * 2;
      const zoom = Math.min(
        Math.max(Math.min(this.viewportW / w, this.viewportH / h), MIN_ZOOM),
        1.25,
      );
      const target = {
        zoom,
        panX: this.viewportW / 2 - ((minX + maxX) / 2) * zoom,
        panY: this.viewportH / 2 - ((minY + maxY) / 2) * zoom,
      };
      if (instant) {
        this.zoom = target.zoom;
        this.panX = target.panX;
        this.panY = target.panY;
      } else {
        this.animateTo(target);
      }
    },
    /** 把表卡片中心平移到视口中心：极小 / 极大缩放下顺带收敛到 0.85 / 1.25，其余保持当前缩放 */
    centerOnTable(tableId: string) {
      const rects = this.cardRectsOf([tableId]);
      if (!rects.length) return;
      const c = rectCenter(rects[0]);
      const zoom = this.zoom < 0.6 ? 0.85 : this.zoom > 1.8 ? 1.25 : this.zoom;
      this.animateTo({
        zoom,
        panX: this.viewportW / 2 - c.x * zoom,
        panY: this.viewportH / 2 - c.y * zoom,
      });
    },
    /**
     * 确保指定表卡片完整进入视口（含 60px 边距）：
     * 已可见则完全不动视口；否则按最小偏移平滑平移（保持当前缩放，不强行居中）。
     * 用于「显示隐藏表」类操作（NN 胶囊展开中间表 / 大纲眼睛恢复显示），
     * 避免表虽已解除隐藏但落在屏幕外 —— 用户以为点击无效
     */
    ensureTableVisible(tableId: string) {
      const r = this.cardRectOf(tableId);
      if (!r) return;
      const view = this.viewportWorldRect;
      const pad = 60;
      let dx = 0;
      let dy = 0;
      if (r.x < view.x + pad) dx = r.x - pad - view.x;
      else if (r.x + r.w > view.x + view.w - pad) dx = r.x + r.w + pad - (view.x + view.w);
      if (r.y < view.y + pad) dy = r.y - pad - view.y;
      else if (r.y + r.h > view.y + view.h - pad) dy = r.y + r.h + pad - (view.y + view.h);
      if (!dx && !dy) return;
      // dx/dy 为视口需要扩展的世界坐标量 → 世界内容需反向移动：屏幕平移 = -偏移 × 缩放
      this.animateTo({ panX: this.panX - dx * this.zoom, panY: this.panY - dy * this.zoom });
    },
    /** 平滑动画到目标视图 */
    animateTo(target: { zoom?: number; panX?: number; panY?: number }, duration = 220) {
      const from = { zoom: this.zoom, panX: this.panX, panY: this.panY };
      const to = {
        zoom: target.zoom ?? this.zoom,
        panX: target.panX ?? this.panX,
        panY: target.panY ?? this.panY,
      };
      if (
        duration <= 0 ||
        (from.zoom === to.zoom && from.panX === to.panX && from.panY === to.panY)
      ) {
        this.zoom = to.zoom;
        this.panX = to.panX;
        this.panY = to.panY;
        return;
      }
      this.animating = true;
      const start = performance.now();
      /** 动画帧推进：三次缓出插值 zoom / pan，跑满后复位 animating */
      const tick = (now: number) => {
        const t = Math.min(1, (now - start) / duration);
        const ease = 1 - Math.pow(1 - t, 3);
        this.zoom = from.zoom + (to.zoom - from.zoom) * ease;
        this.panX = from.panX + (to.panX - from.panX) * ease;
        this.panY = from.panY + (to.panY - from.panY) * ease;
        if (t < 1) requestAnimationFrame(tick);
        else this.animating = false;
      };
      requestAnimationFrame(tick);
    },
    /** 立即把世界点移到视口中心（duration 传 0 跳过动画；大纲 / 跳转定位用） */
    jumpTo(worldX: number, worldY: number) {
      this.animateTo(
        {
          zoom: this.zoom,
          panX: this.viewportW / 2 - worldX * this.zoom,
          panY: this.viewportH / 2 - worldY * this.zoom,
        },
        0,
      );
    },
    /** 滚轮缩放：以指针位置为锚，上滚放大 1.15 倍、下滚缩小 */
    onWheel(e: WheelEvent) {
      const local = this.localPoint(e);
      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      this.zoomAt(local.x, local.y, factor);
    },
  } satisfies ThisType<CanvasStore> & Partial<CanvasStore>;
}
