/**
 * 画布仓库：自动美化布局与对齐分布
 * （力导向自动布局 + 八种对齐 / 分布模式；批量位置改动经批量契约一次提交）
 */
import { message } from "antdv-next";
import { computeAutoLayout } from "@/utils/layout";
import type { Rect } from "@/utils/geometry";
import type { AlignMode, CanvasDeps, CanvasStore } from "./types";

/**
 * 布局 part：力导向自动美化 + 八种对齐 / 分布模式。
 * 批量位置改动先抓撤销快照，再经批量契约一次提交（persistTables），失败静默；
 * this 上下文由 ThisType<CanvasStore> 提供。
 */
export function layoutMethods(deps: CanvasDeps) {
  return {
    /**
     * 自动美化：以导航关系为边做力导向布局，自动规划每个表卡片的位置。
     * 相关联的表彼此靠近、孤立表散开不重叠，结果按 20px 网格对齐。
     */
    async autoLayout() {
      const model = deps.getModel();
      const ids = [...this.visibleTableIds];
      if (!ids.length) {
        message.warning("画布上没有可见的表卡片");
        return;
      }
      const visibleSet = new Set(ids);
      const nodes = ids
        .map((id) => ({ id, rect: this.cardRectOf(id) }))
        .filter((x): x is { id: string; rect: Rect } => Boolean(x.rect));
      // 布局边：两端均可见的导航；NN 且中间表可见时拆为两段（self↔中间表↔target）
      const edges: Array<{ source: string; target: string }> = [];
      for (const nav of model.navigates) {
        if (!visibleSet.has(nav.self) || !visibleSet.has(nav.target)) continue;
        if (nav.type === "NN" && nav.mappingTable && visibleSet.has(nav.mappingTable)) {
          edges.push({ source: nav.self, target: nav.mappingTable });
          edges.push({ source: nav.mappingTable, target: nav.target });
        } else {
          edges.push({ source: nav.self, target: nav.target });
        }
      }
      const positions = computeAutoLayout(nodes, edges);
      const history = deps.getHistory();
      history.capture(model.takeSnapshot());
      this.layoutAnimating = true;
      for (const [id, p] of Object.entries(positions)) {
        const t = model.tableById(id);
        if (t) {
          t.x = p.x;
          t.y = p.y;
        }
      }
      await model.persistTables(ids).catch(() => undefined);
      // 卡片位置过渡 460ms，结束后收起动画标记；期间开始拖拽会提前终止
      setTimeout(() => {
        this.layoutAnimating = false;
      }, 500);
      this.fitAll();
      message.success(`已自动排列 ${ids.length} 张表卡片`);
    },

    /**
     * 对齐/分布当前选中的表卡片：
     * 左/右/顶/底对齐边缘，水平/垂直对齐居中（中心线对齐），
     * 水平/垂直均匀分布（首尾不动，等间距分布中间卡片）
     */
    async alignSelection(mode: AlignMode) {
      const model = deps.getModel();
      const ids = this.selectedIds.filter((id) => this.visibleTableIds.includes(id));
      const isDistribute = mode === "hdistribute" || mode === "vdistribute";
      const need = isDistribute ? 3 : 2;
      if (ids.length < need) {
        message.warning(isDistribute ? "均匀分布至少需要选中 3 张表" : "对齐至少需要选中 2 张表");
        return;
      }
      const items = ids
        .map((id) => ({ id, rect: this.cardRectOf(id) }))
        .filter((x): x is { id: string; rect: Rect } => Boolean(x.rect));
      if (items.length < need) return;

      const moves: Array<{ id: string; x: number; y: number }> = items.map((it) => ({
        id: it.id,
        x: it.rect.x,
        y: it.rect.y,
      }));

      switch (mode) {
        case "left": {
          const v = Math.min(...items.map((it) => it.rect.x));
          moves.forEach((m) => (m.x = v));
          break;
        }
        case "right": {
          const v = Math.max(...items.map((it) => it.rect.x + it.rect.w));
          moves.forEach((m) => (m.x = v - (this.cardRectOf(m.id)?.w ?? 0)));
          break;
        }
        case "top": {
          const v = Math.min(...items.map((it) => it.rect.y));
          moves.forEach((m) => (m.y = v));
          break;
        }
        case "bottom": {
          const v = Math.max(...items.map((it) => it.rect.y + it.rect.h));
          moves.forEach((m) => (m.y = v - (this.cardRectOf(m.id)?.h ?? 0)));
          break;
        }
        case "hcenter": {
          // 水平对齐：各卡片垂直中心对齐到平均中心线（同一水平线）
          const mean = items.reduce((s, it) => s + it.rect.y + it.rect.h / 2, 0) / items.length;
          moves.forEach((m) => (m.y = mean - (this.cardRectOf(m.id)?.h ?? 0) / 2));
          break;
        }
        case "vcenter": {
          // 垂直对齐：各卡片水平中心对齐到平均中心线（同一垂直线）
          const mean = items.reduce((s, it) => s + it.rect.x + it.rect.w / 2, 0) / items.length;
          moves.forEach((m) => (m.x = mean - (this.cardRectOf(m.id)?.w ?? 0) / 2));
          break;
        }
        case "hdistribute": {
          // 水平均匀分布：按 x 排序，首尾卡片保持不动，中间卡片等间距
          const sorted = [...items].sort((a, b) => a.rect.x - b.rect.x);
          const first = sorted[0].rect;
          const last = sorted[sorted.length - 1].rect;
          const sumW = sorted.reduce((s, it) => s + it.rect.w, 0);
          const span = last.x + last.w - first.x;
          const gap = (span - sumW) / (sorted.length - 1);
          let cursor = first.x;
          for (const it of sorted) {
            const m = moves.find((mv) => mv.id === it.id);
            if (m) m.x = cursor;
            cursor += it.rect.w + gap;
          }
          break;
        }
        case "vdistribute": {
          // 垂直均匀分布：按 y 排序，首尾卡片保持不动，中间卡片等间距
          const sorted = [...items].sort((a, b) => a.rect.y - b.rect.y);
          const first = sorted[0].rect;
          const last = sorted[sorted.length - 1].rect;
          const sumH = sorted.reduce((s, it) => s + it.rect.h, 0);
          const span = last.y + last.h - first.y;
          const gap = (span - sumH) / (sorted.length - 1);
          let cursor = first.y;
          for (const it of sorted) {
            const m = moves.find((mv) => mv.id === it.id);
            if (m) m.y = cursor;
            cursor += it.rect.h + gap;
          }
          break;
        }
      }

      const history = deps.getHistory();
      history.capture(model.takeSnapshot());
      this.layoutAnimating = true;
      for (const mv of moves) {
        const t = model.tableById(mv.id);
        if (t) {
          t.x = Math.round(mv.x);
          t.y = Math.round(mv.y);
        }
      }
      await model.persistTables(moves.map((m) => m.id)).catch(() => undefined);
      setTimeout(() => {
        this.layoutAnimating = false;
      }, 500);
    },
  } satisfies ThisType<CanvasStore> & Partial<CanvasStore>;
}
