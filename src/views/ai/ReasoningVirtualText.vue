<script setup lang="ts">
/**
 * AI 工具页 · 思考内容虚拟滚动文本（@chenglou/pretext 驱动）
 *
 * 解决问题：思考流式追加超长文本（数十万字符）时，单个文本节点每次追加
 * 都触发整段浏览器重排（O(全文) 高成本），「思考中/思考过程」卡片极其卡顿。
 *
 * 方案：pretext 离屏测量（canvas measureText，绕开 DOM reflow）+ 纯算术
 * 分行，仅把视口附近一个窗口内的行渲染进 DOM，窗口外用上下占位块撑出
 * 真实总高——滚动、贴底跟随、scrollHeight 语义与整段渲染完全一致。
 *
 * - 段落增量：按 \n 切分持有 prepared 句柄；已完结段落不可变、只 prepare
 *   一次；流式期间仅重复 prepare 增长中的尾段（测量缓存按 (文本段, 字体)
 *   命中，重复前缀不重量）
 * - flush 节流：基础 90ms、尾段越大间隔越长（上限 400ms）；完成后
 *   message_end 以 trim() 全文替换会触发一次最终 flush
 * - 贴底保持：flush 前记录距底 <24px，DOM 应用后回写新底部——覆盖「最后
 *   一次 flush 晚于流结束」的时序（与消息级贴底跟随 watcher 互补）
 * - 宽度/字体：宽度变化只重排（layout 是纯算术热路径）；canvas 字体串经
 *   往返校验，系统族名（-apple-system 等）被 canvas 拒收时剔除后重试，
 *   行元素显式使用同一字体族，保证「量什么渲什么」
 * - 隐藏守卫：完成后收起（v-show → display:none，宽度 0）不布局也不销毁，
 *   保留最后窗口（textContent 稳定）；重展开时 ResizeObserver 唤醒补齐
 * - 回退：环境缺 Intl.Segmenter / canvas 2d，或 pretext 运行抛错时，
 *   永久退回整段文本渲染（原行为）
 */
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  clearCache,
  layoutWithLines,
  materializeLineRange,
  measureLineStats,
  prepareWithSegments,
  walkLineRanges,
  type LayoutLine,
  type PreparedTextWithSegments,
} from "@chenglou/pretext";

const props = defineProps<{ text: string }>();

/* ---------- 常量 ---------- */

/** 行高（px）：与 .reasoning-body 的 line-height 一致（整数保证虚拟几何精确） */
const LINE_H = 20;
/** 视口上下各多渲染的行数：全文不超窗口时行为与整段渲染一致（textContent 完整） */
const BUFFER = 300;
/** 窗口边界量化步长（行）：快速滚动时降低窗口重算与重渲染频率 */
const WIN_CHUNK = 50;
/** 测量宽度安全边（px）：吸收 clientWidth 取整与测量舍入的亚像素差 */
const SAFETY = 2;
/** pretext 选项：对齐 .reasoning-body 的 white-space: pre-wrap */
const PRE_OPTS = { whiteSpace: "pre-wrap" } as const;

/** 环境能力：pretext 依赖 Intl.Segmenter（分词）与 canvas 2d（测量） */
const PRETEXT_OK = (() => {
  try {
    if (typeof Intl === "undefined") return false;
    if (typeof (Intl as unknown as { Segmenter?: unknown }).Segmenter !== "function") return false;
    if (typeof document === "undefined") return false;
    return Boolean(document.createElement("canvas").getContext("2d"));
  } catch {
    return false;
  }
})();

/** 空段落占位行（CSS pre-wrap 中空段落占一个空行） */
const BLANK_LINE: LayoutLine[] = [
  {
    text: "",
    width: 0,
    start: { segmentIndex: 0, graphemeIndex: 0 },
    end: { segmentIndex: 0, graphemeIndex: 0 },
  },
];

/* ---------- 渲染状态（reactive） ---------- */

/** 总行数 / 渲染窗口 [winStart, winEnd) / 窗口内行文本 */
const totalLines = ref(0);
const winStart = ref(0);
const winEnd = ref(0);
const rows = ref<string[]>([]);
/** 行元素显式字体族（canvas 校验通过的原栈或净化栈；与测量保持一致） */
const rowFontFamily = ref("");
/** pretext 运行期出错 → 永久回退整段渲染 */
const engineFailed = ref(false);

const flowEl = ref<HTMLElement>();

/* ---------- 布局内部状态（flush 内维护，非响应式） ---------- */

/** 已完结段落（不可变）：原文与 prepared 句柄一一对应 */
let paraTexts: string[] = [];
let paraPrepared: PreparedTextWithSegments[] = [];
/** 各段落在当前宽度下的行数与前缀和（paraPrefix.length === paras + 1） */
let paraCounts: number[] = [];
let paraPrefix: number[] = [0];
/** 各段落物化行缓存（惰性；宽度变化时整体作废） */
let paraLines: (LayoutLine[] | undefined)[] = [];
/** 已完结部分（含末尾 \n）的字符数：追加/收缩判断 */
let settledChars = -1;
/** 增长中的尾段（最后一个 \n 之后） */
let tailPrepared: PreparedTextWithSegments | null = null;
let tailText: string | null = null;
let tailCount = 0;
/** 尾段窗口行缓存（flush 间有效） */
let tailWin: { start: number; end: number; lines: string[] } | null = null;
/** canvas 字体串与行字体族 */
let font = "";
/** 布局宽度（clientWidth，整数）与 RO 上报宽度（独立记录防互扰） */
let width = -1;
let roWidth = -1;
/** 滚动容器上下内边距（视口换算用） */
let padTop = 0;
let padBottom = 0;
/** 节流调度 */
let flushTimer = 0;
let flushDirty = false;
let lastFlushAt = 0;
let scrollRaf = 0;
let resizeOb: ResizeObserver | null = null;

/* ---------- 字体解析（canvas 往返校验 + 系统族名净化） ---------- */

let probeCtx: CanvasRenderingContext2D | null | undefined;

/** canvas 是否接受该字体串（赋值失败会静默保留旧值，以此探测） */
function probeFont(f: string): boolean {
  if (probeCtx === undefined) probeCtx = document.createElement("canvas").getContext("2d");
  if (!probeCtx) return false;
  probeCtx.font = "10px sans-serif";
  probeCtx.font = f;
  return probeCtx.font !== "10px sans-serif";
}

/** canvas 不可用的系统族名（macOS/通用系统字体关键字） */
const SYS_FAMILY_RE =
  /^(-apple-system|blinkmacsystemfont|system-ui|ui-sans-serif|ui-serif|ui-monospace|ui-rounded)$/i;

/** 从滚动容器的计算样式解析 canvas 字体串；行元素同步使用解析出的字体族 */
function resolveFont(el: HTMLElement): { font: string; family: string } {
  const cs = getComputedStyle(el);
  const head = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize}`;
  const fam = cs.fontFamily;
  if (probeFont(`${head} ${fam}`)) return { font: `${head} ${fam}`, family: fam };
  const cleaned = fam
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !SYS_FAMILY_RE.test(s))
    .join(", ");
  if (cleaned && probeFont(`${head} ${cleaned}`))
    return { font: `${head} ${cleaned}`, family: cleaned };
  return { font: `${head} sans-serif`, family: "sans-serif" };
}

/* ---------- 几何与查找 ---------- */

/** 滚动容器：组件根的父元素（.reasoning-body，v-show 保留 DOM） */
function scrollParent(): HTMLElement | null {
  const el = flowEl.value;
  return el && el.parentElement ? el.parentElement : null;
}

/** 上界二分：最后一个 prefix[i] <= v 的 i+1（paraPrefix 单调不减） */
function upperBound(arr: number[], v: number): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid]! <= v) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** 当前测量宽度（扣安全边，不小于 1） */
function availWidth(): number {
  return Math.max(1, width - SAFETY);
}

/** 段落行数（空段落按 CSS pre-wrap 语义占一个空行） */
function countOf(text: string, prepared: PreparedTextWithSegments): number {
  if (text === "") return 1;
  return Math.max(1, measureLineStats(prepared, availWidth()).lineCount);
}

/* ---------- 行物化（段落缓存 + 尾段窗口） ---------- */

function materializePara(pi: number): LayoutLine[] {
  if (paraTexts[pi] === "") return BLANK_LINE;
  let lines = paraLines[pi];
  if (!lines) {
    lines = layoutWithLines(paraPrepared[pi]!, availWidth(), LINE_H).lines;
    paraLines[pi] = lines;
  }
  return lines;
}

/** 尾段仅物化窗口切片（walkLineRanges 纯游标推进，不为窗口外分配字符串） */
function tailWindowSlice(startLocal: number, endLocal: number): string[] {
  if (tailWin && tailWin.start === startLocal && tailWin.end === endLocal) return tailWin.lines;
  const lines: string[] = [];
  const prepared = tailPrepared!;
  let i = 0;
  walkLineRanges(prepared, availWidth(), (range) => {
    if (i >= startLocal && i < endLocal) lines.push(materializeLineRange(prepared, range).text);
    i++;
  });
  tailWin = { start: startLocal, end: endLocal, lines };
  return lines;
}

/** 构建窗口 [s, e) 内的行文本（跨段落拼接，尾段走窗口切片） */
function buildRows(): string[] {
  const total = totalLines.value;
  const s = winStart.value;
  const e = Math.min(winEnd.value, total);
  const out: string[] = [];
  if (s >= e) return out;
  let pi = Math.max(0, upperBound(paraPrefix, s) - 1);
  let local = s - paraPrefix[pi]!;
  let i = s;
  while (i < e) {
    if (pi < paraPrepared.length) {
      const lines = materializePara(pi);
      for (; local < lines.length && i < e; local++, i++) out.push(lines[local]!.text);
      pi++;
      local = 0;
    } else if (tailPrepared) {
      const slice = tailWindowSlice(local, local + (e - i));
      for (const t of slice) out.push(t);
      break;
    } else {
      break;
    }
  }
  return out;
}

/* ---------- 窗口计算 ---------- */

/** 依据滚动位置重算渲染窗口并重建行；rebuild=true 时窗口未变也重建（flush 后内部状态已换） */
function applyWindow(rebuild: boolean): void {
  const sc = scrollParent();
  if (!sc) return;
  const total = totalLines.value;
  let start = 0;
  let end = total;
  if (total > 0) {
    const viewTop = sc.scrollTop - padTop;
    const viewH = Math.max(0, sc.clientHeight - padTop - padBottom);
    const first = Math.floor(viewTop / LINE_H) - BUFFER;
    const last = Math.ceil((viewTop + viewH) / LINE_H) + BUFFER;
    start = Math.max(0, Math.floor(Math.max(0, first) / WIN_CHUNK) * WIN_CHUNK);
    end = Math.min(total, Math.ceil(Math.min(total, last) / WIN_CHUNK) * WIN_CHUNK);
    if (end <= start) end = Math.min(total, start + WIN_CHUNK);
  }
  const changed = start !== winStart.value || end !== winEnd.value;
  winStart.value = start;
  winEnd.value = end;
  if (changed || rebuild) rows.value = buildRows();
}

/** flush 前记录是否贴底；DOM 应用后回写新底部（最后一次 flush 晚于流结束的时序兜底） */
function stickIfWasAtBottom(was: boolean): void {
  if (!was) return;
  nextTick(() => {
    const sc = scrollParent();
    if (sc && sc.scrollHeight > sc.clientHeight) sc.scrollTop = sc.scrollHeight;
  });
}

/* ---------- 核心 flush ---------- */

function flush(): void {
  flushDirty = false;
  lastFlushAt = performance.now();
  const el = flowEl.value;
  if (!el || !PRETEXT_OK || engineFailed.value) return;
  const w = el.clientWidth;
  if (w <= 0) {
    // 隐藏（display:none）：不布局不销毁，保留最后窗口；重展开由 RO 唤醒
    flushDirty = true;
    return;
  }
  const sc = scrollParent();
  if (!sc) return;

  let wasAtBottom = false;
  try {
    const cs = getComputedStyle(sc);
    padTop = parseFloat(cs.paddingTop) || 0;
    padBottom = parseFloat(cs.paddingBottom) || 0;
    wasAtBottom = sc.scrollHeight - sc.scrollTop - sc.clientHeight < 24;

    // 字体解析与变化检测（宿主主题/字体切换 → 重建全部句柄）
    const next = resolveFont(sc);
    const fontChanged = next.font !== font;
    if (fontChanged) {
      font = next.font;
      rowFontFamily.value = next.family;
    }
    const widthChanged = w !== width;
    if (widthChanged) width = w;

    // 文本归一：浏览器文本处理模型把 \r\n / \r 归一为 \n（pre-wrap 同此）
    const text = props.text.replace(/\r\n?/g, "\n");
    const nl = text.lastIndexOf("\n");
    const settled = nl === -1 ? "" : text.slice(0, nl + 1);
    const tail = nl === -1 ? text : text.slice(nl + 1);

    // ---- 已完结段落：追加（流式）或重建（字体变化 / message_end trim 收缩） ----
    if (fontChanged || settled.length < settledChars) {
      const parts = settled === "" ? [] : settled.split("\n").slice(0, -1);
      paraTexts = parts;
      paraPrepared = parts.map((t) => prepareWithSegments(t, font, PRE_OPTS));
      paraLines = parts.map(() => undefined);
      paraCounts = parts.map((t, i) => countOf(t, paraPrepared[i]!));
      settledChars = settled.length;
    } else if (settled.length > settledChars) {
      const parts = settled.split("\n").slice(0, -1);
      for (let i = paraTexts.length; i < parts.length; i++) {
        const t = parts[i]!;
        const prepared = prepareWithSegments(t, font, PRE_OPTS);
        paraTexts.push(t);
        paraPrepared.push(prepared);
        paraLines.push(undefined);
        paraCounts.push(countOf(t, prepared));
      }
      settledChars = settled.length;
    }

    // 宽度变化：全部段落行数重排 + 行缓存作废（纯算术，不重量）
    if (widthChanged) {
      paraCounts = paraPrepared.map((p, i) => countOf(paraTexts[i]!, p));
      paraLines = paraTexts.map(() => undefined);
    }

    // 前缀和重建（O(段落数) 算术）
    paraPrefix = [0];
    for (const c of paraCounts) paraPrefix.push(paraPrefix[paraPrefix.length - 1]! + c);

    // ---- 尾段：文本/字体/宽度任一变化才重 prepare / 重排 ----
    const tailChanged = fontChanged || tail !== tailText;
    if (tailChanged) {
      tailText = tail;
      tailPrepared = tail === "" ? null : prepareWithSegments(tail, font, PRE_OPTS);
    }
    if (tailChanged || widthChanged) {
      tailCount = tailPrepared ? countOf(tail, tailPrepared) : 0;
      tailWin = null;
    }

    // ---- 应用 ----
    totalLines.value = paraPrefix[paraPrefix.length - 1]! + tailCount;
    applyWindow(true);
  } catch (err) {
    // pretext 运行异常：永久回退整段渲染，绝不让思考块崩掉
    console.error("[ReasoningVirtualText] pretext 布局失败，回退整段渲染", err);
    engineFailed.value = true;
    rows.value = [];
    totalLines.value = 0;
    winStart.value = 0;
    winEnd.value = 0;
    return;
  }
  stickIfWasAtBottom(wasAtBottom);
}

/* ---------- 调度（自适应节流：尾段越大间隔越长，上限 400ms） ---------- */

function flushNow(): void {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = 0;
  }
  flush();
}

function scheduleFlush(): void {
  if (!PRETEXT_OK || engineFailed.value) return;
  flushDirty = true;
  if (flushTimer) return;
  const tailLen = tailText?.length ?? 0;
  const interval = Math.min(400, 90 + tailLen / 300);
  const wait = Math.max(0, Math.round(lastFlushAt + interval - performance.now()));
  if (wait === 0) {
    flushNow();
    return;
  }
  flushTimer = window.setTimeout(() => {
    flushTimer = 0;
    if (flushDirty) flush();
  }, wait);
}

/* ---------- 事件 ---------- */

function onScroll(): void {
  if (scrollRaf) return;
  scrollRaf = requestAnimationFrame(() => {
    scrollRaf = 0;
    applyWindow(false);
  });
}

function onResize(entries: ResizeObserverEntry[]): void {
  const w = Math.round(entries[0]?.contentRect.width ?? 0);
  if (w <= 0) return; // 隐藏（display:none）：保留状态，等重展开
  if (w === roWidth && !flushDirty) return; // 高度变化等无关回调
  roWidth = w;
  flushNow();
}

/* ---------- 生命周期 ---------- */

onMounted(() => {
  if (!PRETEXT_OK) return;
  const el = flowEl.value;
  if (!el) return;
  resizeOb = new ResizeObserver(onResize);
  resizeOb.observe(el);
  scrollParent()?.addEventListener("scroll", onScroll, { passive: true });
  // 自定义字体迟到：加载完成后强制重测（font 置空触发全量重建）
  if (typeof document !== "undefined" && document.fonts?.ready) {
    document.fonts.ready.then(() => {
      if (engineFailed.value) return;
      font = "";
      flushNow();
    });
  }
  flushNow();
});

onBeforeUnmount(() => {
  if (flushTimer) clearTimeout(flushTimer);
  if (scrollRaf) cancelAnimationFrame(scrollRaf);
  resizeOb?.disconnect();
  resizeOb = null;
  scrollParent()?.removeEventListener("scroll", onScroll);
  // 释放 pretext 共享测量缓存（prepared 句柄自带宽度，不受影响）
  if (PRETEXT_OK) clearCache();
});

watch(
  () => props.text,
  () => scheduleFlush(),
);
</script>

<template>
  <!-- 回退：环境不支持（无 Intl.Segmenter / canvas 2d）或 pretext 运行出错 → 整段渲染（原行为） -->
  <div v-if="!PRETEXT_OK || engineFailed" ref="flowEl" class="rvt-flow">{{ text }}</div>
  <div
    v-else
    ref="flowEl"
    class="rvt-flow"
    :style="rowFontFamily ? { fontFamily: rowFontFamily } : undefined"
  >
    <!-- 窗口外占位：撑出真实总高，滚动/贴底/scrollHeight 语义与整段渲染一致 -->
    <div class="rvt-pad" :style="{ height: `${winStart * LINE_H}px` }"></div>
    <div v-for="(t, idx) in rows" :key="idx" class="rvt-row">{{ t }}</div>
    <div class="rvt-pad" :style="{ height: `${(totalLines - winEnd) * LINE_H}px` }"></div>
  </div>
</template>

<style lang="scss" scoped>
.rvt-flow {
  /* 回退分支的整段渲染与 .reasoning-body 原行为一致 */
  white-space: pre-wrap;
  word-break: break-word;
}

.rvt-row {
  height: 20px;
  line-height: 20px;
  /* 行文本已由 pretext 按容器宽度预先断行：禁止浏览器再折行，
     测量与渲染的微小偏差由 SAFETY 边吸收，绝不让行高漂移 */
  white-space: pre;
  word-break: normal;
  overflow: hidden;
}

.rvt-pad {
  /* 高度由内联样式给出（窗口外行数 × 行高） */
}
</style>
