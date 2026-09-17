/**
 * 行拖拽排序组合式函数（HTML5 Drag & Drop，手柄触发）
 *
 * 设计要点：
 * - 仅在手柄 pointerdown 的瞬间将所在行置为 draggable，避免整行常驻
 *   draggable 破坏行内输入框的文本选择/拖选行为
 * - 原生拖拽期间浏览器不派发 pointerup，复位依赖 dragend；
 *   未形成拖拽（按下即松开）时由一次性 window pointerup 监听复位
 * - 落点依据悬停行的上/下半区决定插入位置，插入位置按 splice
 *   语义换算，任意 from/to 组合均正确
 * - 头部锁定行（lockCount）：不可拖动、也不可插入到其之前
 *   （如表编辑字段表固定的主键首行）
 */
import { reactive } from "vue";

export interface DragSortState {
  /** 被拖拽行索引（-1 表示无拖拽） */
  from: number;
  /** 当前悬停行索引 */
  over: number;
  /** 悬停位置：目标行上缘 / 下缘 */
  pos: "above" | "below";
}

export interface DragSortOptions {
  /** 头部锁定行数：这些行不可拖动，也不可插入到其之前（默认 0） */
  lockCount?: number;
}

/**
 * 行拖拽排序组合式函数：管理拖拽状态机并在落下时以 splice 完成排序。
 *
 * @param getList 行数据源访问器（落下时读取并原地 splice 重排；须返回响应式数组）
 * @param onSorted 重排完成回调（常用于按位置重编号 sort 字段）
 * @param opts 锁定行数等选项
 * @returns 拖拽状态（响应式）与六个事件处理器（模板内直接绑定）
 */
export function useDragSort<T>(
  getList: () => T[],
  onSorted?: () => void,
  opts: DragSortOptions = {},
) {
  const lockCount = opts.lockCount ?? 0;
  const state = reactive<DragSortState>({ from: -1, over: -1, pos: "above" });

  /** 手柄按下：锁定行直接忽略；置 draggable 并注册一次性指针复位（未形成拖拽时） */
  function handleDown(idx: number) {
    if (idx < lockCount) return;
    state.from = idx;
    state.over = -1;
    window.addEventListener(
      "pointerup",
      () => {
        state.from = -1;
      },
      { once: true },
    );
  }

  /** 拖拽开始：仅手柄按下形成的行可拖（其余行 preventDefault）；Firefox 需写入数据才会发起 */
  function onDragStart(idx: number, e: DragEvent) {
    if (state.from !== idx) {
      e.preventDefault();
      return;
    }
    if (e.dataTransfer) {
      // Firefox 要求拖拽起始时写入数据，否则拖拽不会发起
      e.dataTransfer.setData("text/plain", String(idx));
      e.dataTransfer.effectAllowed = "move";
    }
  }

  /** 拖拽结束（含取消）：复位全部状态（原生拖拽期间浏览器不派发 pointerup，复位依赖此） */
  function onDragEnd() {
    state.from = -1;
    state.over = -1;
    state.pos = "above";
  }

  /** 悬停行拖拽经过：记录目标行与上/下半区落点位置 */
  function onDragOver(idx: number, e: DragEvent) {
    if (state.from < 0) return;
    const row = e.currentTarget as HTMLElement;
    const rect = row.getBoundingClientRect();
    state.over = idx;
    state.pos = e.clientY - rect.top < rect.height / 2 ? "above" : "below";
    if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
  }

  /** 落下：换算插入位（先移除再插入需回退一位）、锁定区外钳制，splice 重排后回调 */
  function onDrop() {
    const from = state.from;
    const over = state.over;
    const above = state.pos === "above";
    onDragEnd();
    if (from < 0 || over < 0 || from === over) return;
    const list = getList();
    if (!Array.isArray(list) || from >= list.length || over >= list.length) return;
    // 先移除再插入：插入目标大于来源时需要回退一位换算
    const insertRaw = above ? over : over + 1;
    const [item] = list.splice(from, 1);
    let insert = insertRaw > from ? insertRaw - 1 : insertRaw;
    // 头部锁定：插入位置不允许落在锁定区内（最低插到锁定区之后）
    if (insert < lockCount) insert = lockCount;
    list.splice(insert, 0, item);
    onSorted?.();
  }

  /** 行样式类：拖拽中半透明 + 上/下落点指示线（锁定行不显示上落点线——不可能插入其上方） */
  function rowClass(idx: number) {
    const active = state.from >= 0;
    return {
      dragging: state.from === idx,
      "drop-above": active && state.over === idx && state.pos === "above" && idx >= lockCount,
      "drop-below": active && state.over === idx && state.pos === "below",
    };
  }

  return { state, handleDown, onDragStart, onDragEnd, onDragOver, onDrop, rowClass };
}
