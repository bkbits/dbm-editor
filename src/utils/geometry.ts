/**
 * 画布几何工具
 */

export interface Point {
  x: number
  y: number
}

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export type Side = 'n' | 'e' | 's' | 'w'

/** 表卡片固定宽度（世界坐标） */
export const CARD_WIDTH = 268

/** 取矩形中心点 */
export function rectCenter(r: Rect): Point {
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 }
}

/** 取矩形某边中点（连接锚点） */
export function anchorOf(r: Rect, side: Side): Point {
  switch (side) {
    case 'n':
      return { x: r.x + r.w / 2, y: r.y }
    case 's':
      return { x: r.x + r.w / 2, y: r.y + r.h }
    case 'e':
      return { x: r.x + r.w, y: r.y + r.h / 2 }
    case 'w':
    default:
      return { x: r.x, y: r.y + r.h / 2 }
  }
}

/** 根据两矩形相对位置选择连接边（返回 [selfSide, targetSide]） */
export function chooseSides(a: Rect, b: Rect): [Side, Side] {
  const ca = rectCenter(a)
  const cb = rectCenter(b)
  const dx = cb.x - ca.x
  const dy = cb.y - ca.y
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0 ? ['e', 'w'] : ['w', 'e']
  }
  return dy >= 0 ? ['s', 'n'] : ['n', 's']
}

/** 矩形求并集边界 */
export function unionRects(rects: Rect[], padding = 0): Rect | null {
  if (!rects.length) return null
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const r of rects) {
    minX = Math.min(minX, r.x)
    minY = Math.min(minY, r.y)
    maxX = Math.max(maxX, r.x + r.w)
    maxY = Math.max(maxY, r.y + r.h)
  }
  return {
    x: minX - padding,
    y: minY - padding,
    w: maxX - minX + padding * 2,
    h: maxY - minY + padding * 2,
  }
}

/** 两矩形是否相交（用于框选） */
export function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
}

/** 点是否在矩形内 */
export function pointInRect(p: Point, r: Rect): boolean {
  return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h
}

/**
 * 构建三次贝塞尔曲线路径（连接两个锚点，控制点沿边的法向延伸）
 */
export function bezierPath(p0: Point, s0: Side, p1: Point, s1: Side): string {
  const dist = Math.hypot(p1.x - p0.x, p1.y - p0.y)
  const k = Math.max(40, dist * 0.25)
  const c0 = offsetBySide(p0, s0, k)
  const c1 = offsetBySide(p1, s1, k)
  return `M ${p0.x} ${p0.y} C ${c0.x} ${c0.y}, ${c1.x} ${c1.y}, ${p1.x} ${p1.y}`
}

/** 沿边方向偏移点 */
function offsetBySide(p: Point, side: Side, k: number): Point {
  switch (side) {
    case 'n':
      return { x: p.x, y: p.y - k }
    case 's':
      return { x: p.x, y: p.y + k }
    case 'e':
      return { x: p.x + k, y: p.y }
    case 'w':
    default:
      return { x: p.x - k, y: p.y }
  }
}

/** 计算三次贝塞尔曲线在 t 处的点（t=0.5 即中点） */
export function pointOnBezier(p0: Point, s0: Side, p1: Point, s1: Side, t = 0.5): Point {
  const dist = Math.hypot(p1.x - p0.x, p1.y - p0.y)
  const k = Math.max(40, dist * 0.25)
  const c0 = offsetBySide(p0, s0, k)
  const c1 = offsetBySide(p1, s1, k)
  const mt = 1 - t
  const x = mt * mt * mt * p0.x + 3 * mt * mt * t * c0.x + 3 * mt * t * t * c1.x + t * t * t * p1.x
  const y = mt * mt * mt * p0.y + 3 * mt * mt * t * c0.y + 3 * mt * t * t * c1.y + t * t * t * p1.y
  return { x, y }
}

/** 自环路径（表指向自身时，从北边绕到东边） */
export function selfLoopPath(r: Rect): { d: string; mid: Point } {
  const n = anchorOf(r, 'n')
  const e = anchorOf(r, 'e')
  const d = `M ${n.x} ${n.y} C ${n.x + 40} ${n.y - 110}, ${e.x + 130} ${e.y - 60}, ${e.x} ${e.y}`
  return {
    d,
    mid: { x: (n.x + e.x) / 2 + 65, y: Math.min(n.y - 70, e.y - 50) },
  }
}
