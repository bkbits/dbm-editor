<script setup lang="ts">
/**
 * 同步滚动表格（表头 / 左固定列 / 中间列 / 右固定列分表渲染 + 专用滚动条同步）
 *
 * 架构（多 table 同步滚动，替代「单滚动容器 + sticky」方案）：
 * - 表头一张表；表体左固定列 / 中间列 / 右固定列各一张表（无固定列时对应壳为空表）。
 *   固定列与滚动内容分属不同 DOM 树，从结构上杜绝 sticky 方案的缝隙透出 /
 *   半透明底色透底 / 高度不齐等问题。
 * - .st-scrollbar-h / .st-scrollbar-v 为专用滚动条：不承载任何表格内容，
 *   仅以 sizer 撑出可滚动尺寸并接收滚动事件。sizer 宽 = 左+中+右总列宽，
 *   sizer 高 = 表体实际内容高（含表体上下内边距，与壳的滚动范围严格一致）。
 *   之所以拆成两条定向滚动条而非单块全覆盖叠加层：全覆盖层要么挡住表格
 *   内容的全部交互（输入框 / 复选框 / 拖拽手柄），要么 pointer-events:none
 *   后原生滑块不可拖拽；两条通栏 / 通列滚动条既不遮挡内容又保留原生拖拽。
 * - 滚动同步函数：滚动事件中把两条滚动条的 scrollLeft / scrollTop 一次写入
 *   所有壳元素（表头壳只同步横向，表体壳横纵皆同步）。壳为 overflow: hidden，
 *   程序化赋值 scrollLeft / scrollTop 即平移内容。
 * - 列宽分配（ResizeObserver 触发重算）：
 *   1) 显式宽度列直接采用（低于自身 minWidth 时抬升到 minWidth），不参与分配；
 *   2) 未指定宽度列以自身 minWidth（缺省 80px）为下限；
 *   3) 列宽总和不足可用宽（rootWidth 扣除纵向滚动条占位）时，剩余空间平均分给
 *      未指定宽度的列，除不尽时前几列各多 1px；无剩余时保持 minWidth，
 *      总宽超出可视区即产生横向滚动。
 * - 横向滚动条与纵向滚动条互相挤占空间（是否出现影响对方可用宽 / 高），
 *   以迭代收敛布局标志；尺寸或列宽变更后重算并重新下发一次滚动量，
 *   避免残留越界 scrollLeft。
 * - 壳内容上的滚轮事件转发给两条滚动条（壳自身 overflow: hidden 不滚），
 *   边界处（滚不动时）不拦截，保持冒泡链与原生滚动容器一致。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";

export interface StColumn {
  /** 列标识（单元格插槽按此分发渲染） */
  key: string;
  /** 表头文案（缺省空） */
  title?: string;
  /** 显式列宽（px）；设定后不参与剩余空间分配 */
  width?: number;
  /** 最低列宽（px，缺省 80） */
  minWidth?: number;
  /** 固定列：左 / 右 */
  fixed?: "left" | "right";
  /** 居中对齐（表头与单元格） */
  align?: "center";
  /** 表头 title 提示 */
  thTitle?: string;
  /** 表头附加类名 */
  thClass?: string;
}

const props = defineProps<{
  columns: StColumn[];
  /** 行数（行数据由父级持有，经单元格插槽按 col/idx 取用） */
  rowCount: number;
  rowKey: (idx: number) => string | number;
  /** 行附加类（拖拽指示 / 主键行等领域状态） */
  rowClass?: (idx: number) => unknown;
  /** 行是否可拖拽（拖拽排序手柄按下的瞬间为真） */
  draggable?: (idx: number) => boolean;
}>();

const emit = defineEmits<{
  (e: "row-dragstart", idx: number, ev: DragEvent): void;
  (e: "row-dragend"): void;
  (e: "row-dragover", idx: number, ev: DragEvent): void;
  (e: "row-drop"): void;
}>();

/* ---------- 模板引用 ---------- */
const rootRef = ref<HTMLElement>();
const headerRef = ref<HTMLElement>();
const headLeftRef = ref<HTMLElement>();
const headCenterRef = ref<HTMLElement>();
const headRightRef = ref<HTMLElement>();
const bodyLeftRef = ref<HTMLElement>();
const bodyCenterRef = ref<HTMLElement>();
const bodyRightRef = ref<HTMLElement>();
const barHRef = ref<HTMLElement>();
const barVRef = ref<HTMLElement>();

/** 滚动条带宽（挂载时实测，与全局 ::-webkit-scrollbar 一致） */
let sbW = 9;

/** 最终列宽（key → px）与布局汇总（响应式驱动 colgroup 与 sizer） */
const colWidths = reactive<Record<string, number>>({});
const layout = reactive({
  vBar: false,
  hBar: false,
  leftW: 0,
  centerW: 0,
  rightW: 0,
  tableW: 0,
});
const sizerH = ref(0);
const sizerV = ref(0);

/** 跨三表同步的悬停行索引（三张表体表各自触发 mouseenter/leave） */
const hoverIdx = ref(-1);

const leftCols = computed(() => props.columns.filter((c) => c.fixed === "left"));
const rightCols = computed(() => props.columns.filter((c) => c.fixed === "right"));
const centerCols = computed(() => props.columns.filter((c) => !c.fixed));
const rowIdxs = computed(() => Array.from({ length: props.rowCount }, (_, i) => i));

/** 列宽兜底（首帧 recalc 前 colgroup 也有非零宽度，避免闪空） */
function widthOf(c: StColumn): number {
  return colWidths[c.key] ?? Math.max(Math.round(c.width ?? 0), Math.round(c.minWidth ?? 80));
}

function regionStyle(cols: StColumn[]) {
  return { width: cols.reduce((s, c) => s + widthOf(c), 0) + "px" };
}

function thClass(c: StColumn) {
  return [c.align === "center" ? "st-c" : "", c.thClass ?? ""];
}

function tdClass(c: StColumn) {
  return [`st-c-${c.key}`, c.align === "center" ? "st-c" : ""];
}

function onRowEnter(idx: number) {
  hoverIdx.value = idx;
}
function onRowLeave(idx: number) {
  if (hoverIdx.value === idx) hoverIdx.value = -1;
}

/* ---------- 列宽分配（用户流程第 4/5 步） ---------- */

function distribute(availW: number) {
  const flexKeys: string[] = [];
  let total = 0;
  for (const c of props.columns) {
    const min = Math.max(0, Math.round(c.minWidth ?? 80));
    if (c.width != null) {
      // 显式宽度直接采用（不参与分配）；低于自身 minWidth 时抬升
      colWidths[c.key] = Math.max(Math.round(c.width), min);
    } else {
      colWidths[c.key] = min;
      flexKeys.push(c.key);
    }
    total += colWidths[c.key];
  }
  // 剩余空间平均分给未指定宽度的列，除不尽时前几列各多 1px（总和精确）
  const leftover = availW - total;
  if (leftover > 0 && flexKeys.length) {
    const share = Math.floor(leftover / flexKeys.length);
    const rem = leftover - share * flexKeys.length;
    flexKeys.forEach((k, i) => (colWidths[k] += share + (i < rem ? 1 : 0)));
  }
  layout.leftW = leftCols.value.reduce((s, c) => s + widthOf(c), 0);
  layout.centerW = centerCols.value.reduce((s, c) => s + widthOf(c), 0);
  layout.rightW = rightCols.value.reduce((s, c) => s + widthOf(c), 0);
  layout.tableW = layout.leftW + layout.centerW + layout.rightW;
}

/* ---------- 滚动同步（用户流程第 7/8/9 步） ---------- */

/** 滚动事件统一入口：两条滚动条的 scrollLeft / scrollTop 一次写入所有壳 */
function syncScroll() {
  const sl = barHRef.value ? barHRef.value.scrollLeft : 0;
  const st = barVRef.value ? barVRef.value.scrollTop : 0;
  // 表头三壳只同步横向（表头无纵向溢出；左右壳无横向溢出，赋值即无操作）
  for (const el of [headLeftRef.value, headCenterRef.value, headRightRef.value]) {
    if (el) el.scrollLeft = sl;
  }
  // 表体三壳横纵皆同步（左右壳横向无溢出，仅纵向生效）
  for (const el of [bodyLeftRef.value, bodyCenterRef.value, bodyRightRef.value]) {
    if (!el) continue;
    el.scrollLeft = sl;
    el.scrollTop = st;
  }
  // 通知弹层类组件重新对位（antd 弹层不感知 overflow:hidden 壳的程序化滚动）
  window.dispatchEvent(new Event("scroll"));
}

/** 壳内容滚轮转发给两条滚动条；边界处（滚不动）不拦截，保持事件冒泡链 */
function onWheel(e: WheelEvent) {
  let handled = false;
  if (e.deltaX && barHRef.value) {
    const before = barHRef.value.scrollLeft;
    barHRef.value.scrollLeft = before + e.deltaX;
    if (barHRef.value.scrollLeft !== before) handled = true;
  }
  if (e.deltaY && barVRef.value) {
    const before = barVRef.value.scrollTop;
    barVRef.value.scrollTop = before + e.deltaY;
    if (barVRef.value.scrollTop !== before) handled = true;
  }
  if (handled) e.preventDefault();
}

/* ---------- 布局重算（用户流程第 1~6 步 + 第 9 步重发滚动量） ---------- */

function recalc() {
  const root = rootRef.value;
  const body = root?.querySelector<HTMLElement>(".st-body");
  const bodyC = bodyCenterRef.value;
  if (!root || !body || !bodyC || root.clientWidth < 50) return;
  const rootW = root.clientWidth;
  // 根元素高度上限（桌面 348px；父级可用 --st-max-h 覆盖，如移动端 calc）
  const rootMaxH = parseFloat(getComputedStyle(root).maxHeight) || 348;
  const headerH = headerRef.value?.offsetHeight ?? 28;
  // 表体实际内容高与上下内边距（sizer 高含内边距，与壳滚动范围严格一致）
  const contentH = bodyC.scrollHeight;
  const bs = getComputedStyle(body);
  const padY = (parseFloat(bs.paddingTop) || 0) + (parseFloat(bs.paddingBottom) || 0);
  // 横纵滚动条互相挤占空间（横向条占高 → 表体变矮 → 纵向条可能出现；
  // 纵向条占宽 → 可用宽变窄 → 横向条可能出现），迭代至收敛
  let hBar = false;
  let vBar = false;
  for (let i = 0; i < 3; i++) {
    const bodyClientH = Math.max(
      0,
      Math.min(rootMaxH, root.clientHeight) - headerH - (hBar ? sbW : 0),
    );
    vBar = contentH + padY > bodyClientH + 0.5;
    const availW = rootW - (vBar ? sbW : 0);
    distribute(availW);
    const next = layout.tableW > availW + 0.5;
    if (next === hBar) break;
    hBar = next;
  }
  layout.vBar = vBar;
  layout.hBar = hBar;
  sizerH.value = Math.round(layout.tableW);
  sizerV.value = Math.round(contentH + padY);
  // 尺寸 / 列宽变更后重新下发一次滚动量，清理越界 scrollLeft（浏览器对
  // sizer 收缩会自动钳制滚动条，这里把钳制后的值同步到各壳）
  nextTick(syncScroll);
}

/** 实测当前环境滚动条带宽（全局 ::-webkit-scrollbar 定制后与默认值可能不同） */
function measureScrollbarWidth(): number {
  const el = document.createElement("div");
  el.style.cssText = "position:absolute;top:-9999px;width:100px;height:100px;overflow:scroll";
  document.body.appendChild(el);
  const w = el.offsetWidth - el.clientWidth;
  el.remove();
  return w > 0 && w < 40 ? w : 9;
}

let ro: ResizeObserver | undefined;

onMounted(() => {
  sbW = measureScrollbarWidth();
  const root = rootRef.value;
  if (root) {
    ro = new ResizeObserver(() => recalc());
    ro.observe(root);
    root.addEventListener("wheel", onWheel, { passive: false });
  }
  barHRef.value?.addEventListener("scroll", syncScroll);
  barVRef.value?.addEventListener("scroll", syncScroll);
  nextTick(recalc);
});

onBeforeUnmount(() => {
  ro?.disconnect();
  rootRef.value?.removeEventListener("wheel", onWheel);
  barHRef.value?.removeEventListener("scroll", syncScroll);
  barVRef.value?.removeEventListener("scroll", syncScroll);
});

watch(
  () => props.columns,
  () => nextTick(recalc),
);
watch(
  () => props.rowCount,
  () => nextTick(recalc),
);

defineExpose({ recalc, layout });
</script>

<template>
  <div
    ref="rootRef"
    class="sync-table"
    :class="{ 'st-has-vbar': layout.vBar, 'st-has-hbar': layout.hBar }"
    :style="{ '--st-sbw': `${sbW}px` }"
  >
    <!-- 表头：左固定 / 中间 / 右固定三壳（纵向恒定，横向随滚动条同步） -->
    <div ref="headerRef" class="st-header">
      <div ref="headLeftRef" class="st-shell st-head-left">
        <table :style="regionStyle(leftCols)">
          <colgroup>
            <col v-for="c in leftCols" :key="c.key" :style="{ width: widthOf(c) + 'px' }" />
          </colgroup>
          <thead>
            <tr>
              <th
                v-for="c in leftCols"
                :key="c.key"
                scope="col"
                :class="thClass(c)"
                :title="c.thTitle"
              >
                <slot name="head" :col="c">{{ c.title ?? "" }}</slot>
              </th>
            </tr>
          </thead>
        </table>
      </div>
      <div ref="headCenterRef" class="st-shell st-head-center">
        <table :style="regionStyle(centerCols)">
          <colgroup>
            <col v-for="c in centerCols" :key="c.key" :style="{ width: widthOf(c) + 'px' }" />
          </colgroup>
          <thead>
            <tr>
              <th
                v-for="c in centerCols"
                :key="c.key"
                scope="col"
                :class="thClass(c)"
                :title="c.thTitle"
              >
                <slot name="head" :col="c">{{ c.title ?? "" }}</slot>
              </th>
            </tr>
          </thead>
        </table>
      </div>
      <div ref="headRightRef" class="st-shell st-head-right">
        <table :style="regionStyle(rightCols)">
          <colgroup>
            <col v-for="c in rightCols" :key="c.key" :style="{ width: widthOf(c) + 'px' }" />
          </colgroup>
          <thead>
            <tr>
              <th
                v-for="c in rightCols"
                :key="c.key"
                scope="col"
                :class="thClass(c)"
                :title="c.thTitle"
              >
                <slot name="head" :col="c">{{ c.title ?? "" }}</slot>
              </th>
            </tr>
          </thead>
        </table>
      </div>
    </div>

    <!-- 表体：三壳 + 纵向滚动条（绝对定位于右侧预留带） -->
    <div class="st-body">
      <div ref="bodyLeftRef" class="st-shell st-body-left">
        <table :style="regionStyle(leftCols)">
          <colgroup>
            <col v-for="c in leftCols" :key="c.key" :style="{ width: widthOf(c) + 'px' }" />
          </colgroup>
          <tbody>
            <tr
              v-for="idx in rowIdxs"
              :key="rowKey(idx)"
              class="st-row column-row"
              :class="[rowClass ? rowClass(idx) : [], { 'st-hover': hoverIdx === idx }]"
              :data-idx="idx"
              :draggable="draggable ? draggable(idx) : false"
              @dragstart="emit('row-dragstart', idx, $event)"
              @dragend="emit('row-dragend')"
              @dragover.prevent="emit('row-dragover', idx, $event)"
              @drop.prevent="emit('row-drop')"
              @mouseenter="onRowEnter(idx)"
              @mouseleave="onRowLeave(idx)"
            >
              <td v-for="c in leftCols" :key="c.key" :class="tdClass(c)">
                <slot name="cell" :col="c" :idx="idx" />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div ref="bodyCenterRef" class="st-shell st-body-center">
        <table :style="regionStyle(centerCols)">
          <colgroup>
            <col v-for="c in centerCols" :key="c.key" :style="{ width: widthOf(c) + 'px' }" />
          </colgroup>
          <tbody>
            <tr
              v-for="idx in rowIdxs"
              :key="rowKey(idx)"
              class="st-row column-row"
              :class="[rowClass ? rowClass(idx) : [], { 'st-hover': hoverIdx === idx }]"
              :data-idx="idx"
              :draggable="draggable ? draggable(idx) : false"
              @dragstart="emit('row-dragstart', idx, $event)"
              @dragend="emit('row-dragend')"
              @dragover.prevent="emit('row-dragover', idx, $event)"
              @drop.prevent="emit('row-drop')"
              @mouseenter="onRowEnter(idx)"
              @mouseleave="onRowLeave(idx)"
            >
              <td v-for="c in centerCols" :key="c.key" :class="tdClass(c)">
                <slot name="cell" :col="c" :idx="idx" />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div ref="bodyRightRef" class="st-shell st-body-right">
        <table :style="regionStyle(rightCols)">
          <colgroup>
            <col v-for="c in rightCols" :key="c.key" :style="{ width: widthOf(c) + 'px' }" />
          </colgroup>
          <tbody>
            <tr
              v-for="idx in rowIdxs"
              :key="rowKey(idx)"
              class="st-row column-row"
              :class="[rowClass ? rowClass(idx) : [], { 'st-hover': hoverIdx === idx }]"
              :data-idx="idx"
              :draggable="draggable ? draggable(idx) : false"
              @dragstart="emit('row-dragstart', idx, $event)"
              @dragend="emit('row-dragend')"
              @dragover.prevent="emit('row-dragover', idx, $event)"
              @drop.prevent="emit('row-drop')"
              @mouseenter="onRowEnter(idx)"
              @mouseleave="onRowLeave(idx)"
            >
              <td v-for="c in rightCols" :key="c.key" :class="tdClass(c)">
                <slot name="cell" :col="c" :idx="idx" />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <!-- 纵向滚动条：唯一纵向滚动源（不承载内容，sizer 撑高） -->
      <div ref="barVRef" class="st-scrollbar-v">
        <div class="st-sizer-v" :style="{ height: sizerV + 'px' }"></div>
      </div>
    </div>

    <!-- 横向滚动条：唯一横向滚动源（不承载内容，sizer 撑宽） -->
    <div ref="barHRef" class="st-scrollbar-h">
      <div class="st-sizer-h" :style="{ width: sizerH + 'px' }"></div>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.sync-table {
  /* 根高度上限：内容不足时收缩贴合、超出时封顶滚动（父级可用 --st-max-h 覆盖） */
  --st-max-h: 348px;
  position: relative;
  display: flex;
  flex-direction: column;
  max-height: var(--st-max-h);
  overflow: hidden;
}

/* ---------- 表头 / 表体壳 ---------- */
.st-header {
  display: flex;
  flex-shrink: 0;
}

.st-has-vbar .st-header {
  /* 纵向滚动条占位（表头右侧让出同宽，保证三壳与表体三壳横向对齐） */
  padding-right: var(--st-sbw);
}

.st-body {
  position: relative;
  display: flex;
  flex: 1;
  min-height: 0;
  padding: 5px 0 3px;
}

.st-has-vbar .st-body {
  padding-right: var(--st-sbw);
}

.st-shell {
  overflow: hidden;
}

.st-head-center,
.st-body-center {
  flex: 1;
  min-width: 0;
}

.st-head-left,
.st-head-right,
.st-body-left,
.st-body-right {
  flex-shrink: 0;
}

/* ---------- 表格解剖 ---------- */
table {
  table-layout: fixed;
  border-collapse: separate;
  border-spacing: 0;
}

th {
  height: 27px;
  padding: 0 4px;
  font-size: 11px;
  font-weight: 400;
  color: var(--dbm-text-3);
  text-align: left;
  border-bottom: 1px solid var(--dbm-border);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

th.st-c,
td.st-c {
  text-align: center;
}

td {
  height: 32px;
  padding: 0 4px;
  vertical-align: middle;
}

/* 壳内表单控件铺满单元格（antd 输入类默认 100%，此处兜底） */
td :deep(.ant-input),
td :deep(.ant-input-affix-wrapper),
td :deep(.ant-select) {
  width: 100%;
}

/* ---------- 行状态（悬停 / 拖拽指示跨三表同步，类由行级状态统一驱动） ---------- */
tr.st-hover > td {
  background: var(--dbm-bg-hover);
}

tr.dragging {
  opacity: 0.45;
}

tr.drop-above > td {
  box-shadow: 0 -2px 0 0 var(--dbm-primary);
}

tr.drop-below > td {
  box-shadow: 0 2px 0 0 var(--dbm-primary);
}

/* 行背景首尾圆角（整行横跨三表，仅左壳首格与右壳末格收角） */
.st-body-left tr > td:first-child {
  border-radius: 4px 0 0 4px;
}

.st-body-right tr > td:last-child {
  border-radius: 0 4px 4px 0;
}

/* ---------- 专用滚动条（唯一滚动源，不承载内容） ---------- */
.st-scrollbar-v {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  width: var(--st-sbw);
  overflow-y: auto;
  overflow-x: hidden;
  z-index: 3;
}

.sync-table:not(.st-has-vbar) .st-scrollbar-v {
  display: none;
}

.st-scrollbar-h {
  flex-shrink: 0;
  height: var(--st-sbw);
  overflow-x: auto;
  overflow-y: hidden;
}

.st-has-vbar .st-scrollbar-h {
  /* 右下角让位纵向滚动条（与原生滚动条角落一致），同时保证滚动比例
     与中间壳严格一致（可视宽同减一条带宽） */
  margin-right: var(--st-sbw);
}

.sync-table:not(.st-has-hbar) .st-scrollbar-h {
  display: none;
}

.st-sizer-v {
  width: 1px;
}

.st-sizer-h {
  height: 1px;
}
</style>
