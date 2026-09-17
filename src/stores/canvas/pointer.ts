/**
 * 画布仓库：指针交互状态机（鼠标 / 笔）
 * （按下 → 平移 / 框选 / 拖卡 / 连线 → 移动 → 抬起；含命中测试与连线收尾）
 */
import { message } from "antdv-next";
import { rectContains } from "@/utils/geometry";
import type { Point, Rect, Side } from "@/utils/geometry";
import { touchPts } from "./touch";
import type { CanvasDeps, CanvasStore } from "./types";

/**
 * 指针状态机 part：按下分流（平移 / 框选 / 拖卡 / 连线）、移动推进、抬起收尾与命中测试。
 * this 上下文由 ThisType<CanvasStore> 提供。
 */
export function pointerMethods(deps: CanvasDeps) {
  return {
    /** 把指针捕获到画布根（元素已卸载等异常场景静默忽略，不打断手势） */
    capturePointer(e: PointerEvent) {
      try {
        this.rootEl?.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    },
    /**
     * 延迟捕获：仅在手势真正开始移动后捕获指针。
     * 若在 pointerdown 时立即捕获，浏览器会把后续 click/dblclick 派发到
     * 捕获元素（画布根）而非实际点击目标，导致双击卡片/双击线段/
     * 点击 NN 胶囊等全部失效。因此仅在位移超过阈值后才捕获。
     */
    captureOnce(e: PointerEvent) {
      if (this.pointerCaptured) return;
      this.pointerCaptured = true;
      this.capturePointer(e);
    },
    /** 复位捕获标记（手势结束时调用）；不主动 release，浏览器在抬起后自行释放 */
    resetPointerCapture() {
      this.pointerCaptured = false;
    },
    /** 画布根按下（左键=框选，中键/空格+左键=平移；触屏单指=平移）。
     *  注意：卡片会 stop 掉 pointerdown 冒泡，但导航线（含 NN 胶囊）不会 ——
     *  在线段上按下时事件同样会冒泡到根走到这里 */
    onCanvasPointerDown(e: PointerEvent) {
      if (this.mode) return;
      if (e.button === 1 || (e.button === 0 && this.spacePressed)) {
        this.beginPan(e);
      } else if (e.button === 0) {
        // 触屏：空白处单指拖动 = 平移（框选无鼠标不可用，多选改由右键菜单「全选表」覆盖）；
        // 轻点空白取消选择见 onPointerUp 的 pan 分支
        if (e.pointerType === "touch") this.beginPan(e);
        else this.beginSelect(e);
      }
    },
    /** 开始平移手势：记录起点与拖动标记（触屏轻点空白清选择判定用），位移在移动阶段累计 */
    beginPan(e: PointerEvent) {
      this.mode = "pan";
      this.panDraft = {
        sx: e.clientX,
        sy: e.clientY,
        lastX: e.clientX,
        lastY: e.clientY,
        moved: false,
        touch: e.pointerType === "touch",
      };
    },
    /**
     * 开始框选：记录对角起点（局部坐标，抬起时换算回世界坐标）。
     * 空白起手立即捕获指针；导航线 / NN 胶囊上起手须延迟捕获，否则会偷走后续 click/dblclick。
     */
    beginSelect(e: PointerEvent) {
      const local = this.localPoint(e);
      this.mode = "select";
      this.additiveSelect = e.ctrlKey || e.shiftKey;
      this.selectDraft = { x0: local.x, y0: local.y, x1: local.x, y1: local.y };
      // 按下目标为空白画布：立即捕获指针 —— 框选没有 click/dblclick 目标语义，无需延迟；
      // 且立即捕获后指针移出画布（首个 move 即出界）仍能持续更新选框，
      // 否则快速拖拽时选框会卡在起点（move 事件派发到画布外的元素）。
      // 按下目标为导航线/NN 胶囊（pointerdown 会冒泡到根）：必须延迟捕获（位移>3px 才捕获），
      // 否则立即捕获会把后续 click/dblclick 派发到捕获元素（画布根）而非线段本身，
      // 导致线段单击选中、双击编辑、胶囊点击展开中间表全部失效
      const target = e.target as Element | null;
      const fromBlank = !target?.closest?.("[data-navigate-id]");
      if (fromBlank) this.captureOnce(e);
    },
    /** 表卡片按下（卡片组件转发） */
    beginCardDrag(tableId: string, e: PointerEvent) {
      if (this.mode || e.button !== 0) return;
      // 布局过渡动画中开始拖拽：立即终止过渡，避免拖拽跟手性被 CSS 过渡拖慢
      if (this.layoutAnimating) this.layoutAnimating = false;
      const model = deps.getModel();
      const additive = e.ctrlKey || e.shiftKey;
      if (additive) {
        this.selectTable(tableId, true);
      } else if (!this.selectedIds.includes(tableId)) {
        this.setSelection([tableId]);
      }
      const ids = this.selectedIds.length ? [...this.selectedIds] : [tableId];
      const origPositions: Record<string, Point> = {};
      for (const id of ids) {
        const t = model.tableById(id);
        if (t) origPositions[id] = { x: t.x ?? 0, y: t.y ?? 0 };
      }
      this.mode = "dragCards";
      this.dragDraft = {
        startWorld: this.screenToWorld(this.localPoint(e)),
        ids,
        origPositions,
        moved: false,
      };
    },
    /** 连接点按下（卡片组件转发） */
    startConnect(tableId: string, side: Side, e: PointerEvent) {
      if (this.mode || e.button !== 0) return;
      this.mode = "connect";
      this.connectDraft = {
        fromTableId: tableId,
        fromSide: side,
        world: this.screenToWorld(this.localPoint(e)),
        hoverTableId: null,
      };
    },
    /**
     * 移动推进状态机：平移累计与拖动标记、框选更新对角、拖卡按世界位移写表坐标
     * （首次越过阈值抓撤销快照）、连线更新悬停目标；无手势时直接返回。
     */
    onPointerMove(e: PointerEvent) {
      if (!this.mode) return;
      if (this.mode === "pan" && this.panDraft) {
        // 平移：首次移动即捕获（无点击语义依赖）
        this.captureOnce(e);
        this.panX += e.clientX - this.panDraft.lastX;
        this.panY += e.clientY - this.panDraft.lastY;
        this.panDraft.lastX = e.clientX;
        this.panDraft.lastY = e.clientY;
        // 累计位移超过阈值：标记为拖动（触屏轻点空白=取消选择的长按/轻点判定用）
        if (
          !this.panDraft.moved &&
          Math.hypot(e.clientX - this.panDraft.sx, e.clientY - this.panDraft.sy) > 3
        )
          this.panDraft.moved = true;
      } else if (this.mode === "select" && this.selectDraft) {
        const local = this.localPoint(e);
        this.selectDraft.x1 = local.x;
        this.selectDraft.y1 = local.y;
        // 位移超过阈值才捕获：无位移的单击/双击仍指向原目标（卡片/线段/胶囊）
        if (Math.hypot(local.x - this.selectDraft.x0, local.y - this.selectDraft.y0) > 3)
          this.captureOnce(e);
      } else if (this.mode === "dragCards" && this.dragDraft) {
        const model = deps.getModel();
        const world = this.screenToWorld(this.localPoint(e));
        const dx = world.x - this.dragDraft.startWorld.x;
        const dy = world.y - this.dragDraft.startWorld.y;
        if (!this.dragDraft.moved && Math.hypot(dx, dy) * this.zoom < 3) return;
        if (!this.dragDraft.moved) {
          this.dragDraft.moved = true;
          deps.getHistory().capture(model.takeSnapshot());
        }
        // 拖拽阈值已过，此时捕获指针（拖出画布也能持续跟踪）
        this.captureOnce(e);
        for (const id of this.dragDraft.ids) {
          const orig = this.dragDraft.origPositions[id];
          const t = model.tableById(id);
          if (orig && t) {
            t.x = orig.x + dx;
            t.y = orig.y + dy;
          }
        }
      } else if (this.mode === "connect" && this.connectDraft) {
        // 连线：首次移动即捕获（连接点无点击语义依赖）
        this.captureOnce(e);
        this.connectDraft.world = this.screenToWorld(this.localPoint(e));
        this.connectDraft.hoverTableId = this.hitTableAt(e);
      }
    },
    /**
     * 抬起收尾：框选应用选择集、拖卡落库、连线收尾，并清空各手势草稿；
     * 触屏手势层仍在跟踪指针时不清理，避免与双指手势抢生命周期。
     */
    onPointerUp(_e: PointerEvent) {
      this.resetPointerCapture();
      if (!this.mode) return;
      // 双指缩放的生命周期由触屏手势层（onTouchPointerEnd）管理
      if (this.mode === "pinch") return;
      // 触屏手势层仍在跟踪的指针抬起（如双指抬其一转单指平移）：不清理其模式
      if (_e.pointerType === "touch" && touchPts.size > 0) return;
      const mode = this.mode;
      this.mode = null;
      // 触屏轻点空白（无位移的平移按下）：取消选择（与鼠标框选轻点语义一致）
      if (mode === "pan" && this.panDraft && this.panDraft.touch && !this.panDraft.moved) {
        this.clearSelection();
      }
      if (mode === "select" && this.selectDraft) {
        const draft = this.selectDraft;
        this.selectDraft = null;
        const moved = Math.hypot(draft.x1 - draft.x0, draft.y1 - draft.y0) > 3;
        if (!moved) {
          if (!this.additiveSelect) this.clearSelection();
          return;
        }
        const rect: Rect = {
          x: Math.min(draft.x0, draft.x1),
          y: Math.min(draft.y0, draft.y1),
          w: Math.abs(draft.x1 - draft.x0),
          h: Math.abs(draft.y1 - draft.y0),
        };
        const worldRect: Rect = {
          x: (rect.x - this.panX) / this.zoom,
          y: (rect.y - this.panY) / this.zoom,
          w: rect.w / this.zoom,
          h: rect.h / this.zoom,
        };
        const hits = this.visibleTableIds
          .map((id) => ({ id, r: this.cardRectOf(id) }))
          .filter(({ r }) => r && rectContains(worldRect, r))
          .map(({ id }) => id);
        this.selectedIds = this.additiveSelect
          ? [...new Set([...this.selectedIds, ...hits])]
          : hits;
        // 框选切换为表焦点：清除导航线选中态
        this.selectedNavigateId = "";
      } else if (mode === "dragCards" && this.dragDraft) {
        const ids = this.dragDraft.ids;
        const moved = this.dragDraft.moved;
        this.dragDraft = null;
        if (moved) {
          const model = deps.getModel();
          model.persistTables(ids).catch(() => undefined);
        }
      } else if (mode === "connect" && this.connectDraft) {
        const draft = this.connectDraft;
        this.connectDraft = null;
        this.finishConnect(draft.fromTableId, draft.hoverTableId);
      }
      this.panDraft = null;
    },
    /** 命中测试：取屏幕点下最近的 [data-table-id] 元素，返回表 id（连线悬停判定用） */
    hitTableAt(e: { clientX: number; clientY: number }): string | null {
      const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
      const card = el?.closest("[data-table-id]") as HTMLElement | null;
      return card?.getAttribute("data-table-id") ?? null;
    },
    /** 完成连线：校验重复后打开新增导航对话框 */
    finishConnect(fromTableId: string, hoverTableId: string | null) {
      const ui = deps.getUi();
      const model = deps.getModel();
      if (!hoverTableId || hoverTableId === fromTableId) return;
      if (model.hasNavigateBetween(fromTableId, hoverTableId)) {
        message.warning("两个表之间已存在导航关系，不能重复创建");
        return;
      }
      ui.openNavigateEdit(null, { self: fromTableId, target: hoverTableId });
    },
  } satisfies ThisType<CanvasStore> & Partial<CanvasStore>;
}
