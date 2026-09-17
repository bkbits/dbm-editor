<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useCanvasStore } from "@/stores/canvas";
import { useModelStore } from "@/stores/model";
import { useThemeStore } from "@/stores/theme";

const canvas = useCanvasStore();
const model = useModelStore();
const theme = useThemeStore();

const MAP_W = 200;
const MAP_H = 140;
const elRef = ref<HTMLCanvasElement>();

let frame = 0;

/** 防抖重绘（视口 / 模型变化后合并刷新） */
function schedule() {
  if (frame) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    draw();
  });
}

/** 分类色（读取 CSS 令牌，画布 ctx 绘制用） */
function catColorOf(categoryId: string): string {
  return (
    getComputedStyle(document.documentElement)
      .getPropertyValue(
        `--dbm-cat-${model.categories.findIndex((c) => c.id === categoryId) % 8 >= 0 ? model.categories.findIndex((c) => c.id === categoryId) % 8 : 0}`,
      )
      .trim() || "#888"
  );
}

/** 绘制小地图：全量卡片缩略 + 当前视口框 */
function draw() {
  const cv = elRef.value;
  if (!cv) return;
  const dpr = window.devicePixelRatio || 1;
  if (cv.width !== MAP_W * dpr) {
    cv.width = MAP_W * dpr;
    cv.height = MAP_H * dpr;
    cv.style.width = `${MAP_W}px`;
    cv.style.height = `${MAP_H}px`;
  }
  const ctx = cv.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  // 从小地图画布元素读取 CSS 变量（而非 documentElement）：
  // antd-theme 映射作用于 .app-provider / css-var 作用域内，documentElement 上只有静态基线值
  const styles = getComputedStyle(cv);
  const bg = styles.getPropertyValue("--dbm-bg-panel").trim();
  const border = styles.getPropertyValue("--dbm-border").trim();
  ctx.clearRect(0, 0, MAP_W, MAP_H);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, MAP_W, MAP_H);

  const ids = canvas.visibleTableIds;
  if (!ids.length) return;

  // 内容边界
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const id of ids) {
    const t = model.tableById(id);
    if (!t) continue;
    const size = canvas.cardSizes[id] || { w: 268, h: 120 };
    minX = Math.min(minX, t.x ?? 0);
    minY = Math.min(minY, t.y ?? 0);
    maxX = Math.max(maxX, (t.x ?? 0) + size.w);
    maxY = Math.max(maxY, (t.y ?? 0) + size.h);
  }
  const pad = 30;
  const bw = maxX - minX + pad * 2;
  const bh = maxY - minY + pad * 2;
  const scale = Math.min(MAP_W / bw, MAP_H / bh);
  const offX = (MAP_W - bw * scale) / 2 - (minX - pad) * scale;
  const offY = (MAP_H - bh * scale) / 2 - (minY - pad) * scale;

  // 表矩形（分类配色）
  for (const id of ids) {
    const t = model.tableById(id);
    if (!t) continue;
    const size = canvas.cardSizes[id] || { w: 268, h: 120 };
    ctx.fillStyle = catColorOf(t.categoryId);
    ctx.globalAlpha = canvas.selectedIds.includes(id) ? 1 : 0.7;
    ctx.fillRect(
      (t.x ?? 0) * scale + offX,
      (t.y ?? 0) * scale + offY,
      Math.max(2, size.w * scale),
      Math.max(2, size.h * scale),
    );
  }
  ctx.globalAlpha = 1;

  // 视口矩形：填充必须用半透明令牌（--dbm-select-fill，Task 30 引入，antd 层为
  // color-mix 12% 透明主色）——不可用 --dbm-primary-weak（antd 层映射为不透明实色，
  // 会完全遮住视口内的表矩形）；先填充后描边，保证描边不被填充覆盖
  const vr = canvas.viewportWorldRect;
  ctx.fillStyle = styles.getPropertyValue("--dbm-select-fill").trim();
  ctx.fillRect(vr.x * scale + offX, vr.y * scale + offY, vr.w * scale, vr.h * scale);
  ctx.strokeStyle = styles.getPropertyValue("--dbm-primary").trim();
  ctx.lineWidth = 1.5;
  ctx.strokeRect(vr.x * scale + offX, vr.y * scale + offY, vr.w * scale, vr.h * scale);

  ctx.strokeStyle = border;
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, MAP_W - 1, MAP_H - 1);

  // 缓存换算供交互使用
  scaleInfo.scale = scale;
  scaleInfo.offX = offX;
  scaleInfo.offY = offY;
}

const scaleInfo = { scale: 1, offX: 0, offY: 0 };

/** 小地图坐标 → 世界坐标换算 */
function mapToWorld(e: PointerEvent | MouseEvent) {
  const rect = elRef.value?.getBoundingClientRect();
  if (!rect) return null;
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;
  return {
    x: (mx - scaleInfo.offX) / scaleInfo.scale,
    y: (my - scaleInfo.offY) / scaleInfo.scale,
  };
}

let dragging = false;
/** 小地图按下：定位视口并进入拖拽 */
function onPointerDown(e: PointerEvent) {
  dragging = true;
  const w = mapToWorld(e);
  if (w) canvas.jumpTo(w.x, w.y);
  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
}
/** 小地图拖拽中：视口跟随 */
function onPointerMove(e: PointerEvent) {
  if (!dragging) return;
  const w = mapToWorld(e);
  if (w) canvas.jumpTo(w.x, w.y);
}
/** 小地图抬起：结束拖拽 */
function onPointerUp() {
  dragging = false;
}

watch(
  () => [
    model.tables,
    model.categories,
    canvas.hiddenTableIds,
    canvas.selectedIds,
    canvas.cardSizes,
    canvas.zoom,
    canvas.panX,
    canvas.panY,
    canvas.viewportW,
    canvas.viewportH,
    theme.theme,
  ],
  schedule,
  { deep: true, immediate: true },
);

onMounted(schedule);
onBeforeUnmount(() => {
  if (frame) cancelAnimationFrame(frame);
});
</script>

<template>
  <div class="minimap" title="小地图：点击/拖拽快速定位">
    <canvas
      ref="elRef"
      @pointerdown.stop.prevent="onPointerDown"
      @pointermove.stop="onPointerMove"
      @pointerup.stop="onPointerUp"
      @pointercancel="onPointerUp"
    />
  </div>
</template>

<style lang="scss" scoped>
.minimap {
  position: absolute;
  right: 14px;
  bottom: 14px;
  z-index: 6;
  border-radius: var(--dbm-radius-m);
  overflow: hidden;
  border: 1px solid var(--dbm-border);
  box-shadow: var(--dbm-card-shadow);
  background: var(--dbm-bg-panel);
  /* 触屏拖拽定位：阻止浏览器把拖动接管为页面滚动，指针事件才能连续跟踪 */
  touch-action: none;

  canvas {
    display: block;
    cursor: crosshair;
  }
}

/* ===== 移动端适配：小屏画布空间有限，隐藏小地图 ===== */
@media (max-width: 768px) {
  .minimap {
    display: none;
  }
}
</style>
