/**
 * 画布自动布局（自动美化）：力导向模拟 + 矩形去重叠 + 网格对齐
 *
 * 思路：
 * 1. 以卡片当前中心点为初值，以导航关系为边运行 Fruchterman-Reingold 风格的
 *    力导向模拟（点对斥力 + 边弹簧引力 + 质心弱重力 + 温度冷却），
 *    有关系的表彼此靠近，无关系的彼此散开；
 * 2. 力导向解为质点解，需按卡片实际尺寸做矩形去重叠迭代（沿穿透较小的轴推开）；
 * 3. 20px 网格对齐后平移归一化到起点 (40, 40)，保证布局整洁可复现。
 */
import type { Point, Rect } from "./geometry";
import { rectCenter } from "./geometry";

export interface LayoutNodeInput {
  id: string;
  rect: Rect;
}

export interface LayoutEdgeInput {
  source: string;
  target: string;
}

export interface AutoLayoutOptions {
  /** 去重叠后相邻卡片的最小间距（世界坐标） */
  gap?: number;
  /** 网格对齐步长 */
  grid?: number;
}

const ANIM_ORIGIN = 40;

/** 计算自动布局结果：id → 新的左上角坐标 */
export function computeAutoLayout(
  nodes: LayoutNodeInput[],
  edges: LayoutEdgeInput[],
  options: AutoLayoutOptions = {},
): Record<string, Point> {
  const gap = options.gap ?? 60;
  const grid = options.grid ?? 20;
  const n = nodes.length;
  const result: Record<string, Point> = {};
  if (!n) return result;

  // 以中心点参与模拟
  const centers: Point[] = nodes.map((nd) => ({ ...rectCenter(nd.rect) }));
  const sizes = nodes.map((nd) => ({ w: nd.rect.w, h: nd.rect.h }));
  const idxOf = new Map(nodes.map((nd, i) => [nd.id, i]));

  if (n === 1) {
    result[nodes[0].id] = { x: ANIM_ORIGIN, y: ANIM_ORIGIN };
    return result;
  }

  /* ==================== 1. 力导向模拟 ==================== */
  // 虚拟画布尺寸随节点数量与平均卡片尺寸伸缩
  const avgW = sizes.reduce((s, x) => s + x.w, 0) / n;
  const avgH = sizes.reduce((s, x) => s + x.h, 0) / n;
  const W = Math.min(6000, Math.max(1600, Math.sqrt(n) * (avgW + gap) * 2.2));
  const H = Math.min(4000, Math.max(1000, Math.sqrt(n) * (avgH + gap) * 2.2));
  const k = Math.sqrt((W * H) / n);
  // 斥力截断距离：超出该距离的点对不再互斥，防止整体无限膨胀
  const CUTOFF = k * 2.2;
  // 重力系数：向质心收缩，与截断后的斥力平衡，保证布局有界紧凑
  const GRAVITY = 0.08;

  // 初值归一：当前分布过大时等比缩入虚拟画布（分布过小/堆叠则保持，由斥力散开）
  {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of centers) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
    const bw = Math.max(1, maxX - minX);
    const bh = Math.max(1, maxY - minY);
    const fit = Math.min(W / bw, H / bh, 1);
    if (fit < 1) {
      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2;
      for (const p of centers) {
        p.x = cx + (p.x - cx) * fit;
        p.y = cy + (p.y - cy) * fit;
      }
    }
  }

  const ITER = n <= 40 ? 320 : 180;
  let temp = Math.min(W, H) / 8;
  const cooling = Math.pow(0.02, 1 / ITER); // 末轮温度衰减到初始的 2%

  const disp: Array<{ x: number; y: number }> = centers.map(() => ({ x: 0, y: 0 }));

  for (let it = 0; it < ITER; it++) {
    for (let i = 0; i < n; i++) {
      disp[i].x = 0;
      disp[i].y = 0;
    }

    // 斥力：近距点对（距离极近时给确定性扰动避免零向量；超出截断距离跳过）
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let dx = centers[j].x - centers[i].x;
        let dy = centers[j].y - centers[i].y;
        let dist = Math.hypot(dx, dy);
        if (dist > CUTOFF) continue;
        if (dist < 1) {
          dx = (i % 2 === 0 ? 1 : -1) * 0.6 + 0.01 * (i + 1);
          dy = (j % 2 === 0 ? 1 : -1) * 0.5 + 0.01 * (j + 1);
          dist = Math.hypot(dx, dy);
        }
        const f = (k * k) / dist;
        const ux = (dx / dist) * f;
        const uy = (dy / dist) * f;
        disp[i].x -= ux;
        disp[i].y -= uy;
        disp[j].x += ux;
        disp[j].y += uy;
      }
    }

    // 引力：导航边弹簧（FR 经典二次引力 f = d²/k，上防爆炸钳制；
    // 与点对斥力 k²/d 平衡后，成对连接的表趋于 k 距离附近）
    for (const e of edges) {
      const i = idxOf.get(e.source);
      const j = idxOf.get(e.target);
      if (i === undefined || j === undefined || i === j) continue;
      const dx = centers[j].x - centers[i].x;
      const dy = centers[j].y - centers[i].y;
      const dist = Math.max(1, Math.hypot(dx, dy));
      const f = Math.min((dist * dist) / k, k * 5);
      const ux = (dx / dist) * f;
      const uy = (dy / dist) * f;
      disp[i].x += ux;
      disp[i].y += uy;
      disp[j].x -= ux;
      disp[j].y -= uy;
    }

    // 重力：向质心收缩，防止整体飘散（孤立表也能聚拢）
    let cx = 0;
    let cy = 0;
    for (const p of centers) {
      cx += p.x;
      cy += p.y;
    }
    cx /= n;
    cy /= n;
    for (let i = 0; i < n; i++) {
      disp[i].x += (cx - centers[i].x) * GRAVITY;
      disp[i].y += (cy - centers[i].y) * GRAVITY;
    }

    // 温度限幅位移
    for (let i = 0; i < n; i++) {
      const dl = Math.hypot(disp[i].x, disp[i].y);
      if (dl > 0.01) {
        const step = Math.min(dl, temp);
        centers[i].x += (disp[i].x / dl) * step;
        centers[i].y += (disp[i].y / dl) * step;
      }
    }
    temp *= cooling;
  }

  /* ==================== 2. 矩形去重叠 ==================== */
  const rectAt = (i: number): Rect => ({
    x: centers[i].x - sizes[i].w / 2,
    y: centers[i].y - sizes[i].h / 2,
    w: sizes[i].w,
    h: sizes[i].h,
  });
  const MAX_PASS = 30;
  for (let pass = 0; pass < MAX_PASS; pass++) {
    let moved = false;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const a = rectAt(i);
        const b = rectAt(j);
        const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
        const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
        if (ox > 0.5 && oy > 0.5) {
          moved = true;
          if (ox <= oy) {
            // 沿 x 推开：位置靠左的向左推
            const dir = a.x + a.w / 2 <= b.x + b.w / 2 ? 1 : -1;
            const push = (ox + gap) / 2;
            centers[i].x -= dir * push;
            centers[j].x += dir * push;
          } else {
            const dir = a.y + a.h / 2 <= b.y + b.h / 2 ? 1 : -1;
            const push = (oy + gap) / 2;
            centers[i].y -= dir * push;
            centers[j].y += dir * push;
          }
        }
      }
    }
    if (!moved) break;
  }

  /* ==================== 3. 网格对齐 + 归一化 ==================== */
  const snap = (v: number) => Math.round(v / grid) * grid;
  const lefts = centers.map((p, i) => snap(p.x - sizes[i].w / 2));
  const tops = centers.map((p, i) => snap(p.y - sizes[i].h / 2));
  const minX = Math.min(...lefts);
  const minY = Math.min(...tops);
  for (let i = 0; i < n; i++) {
    result[nodes[i].id] = {
      x: lefts[i] - minX + ANIM_ORIGIN,
      y: tops[i] - minY + ANIM_ORIGIN,
    };
  }
  return result;
}
