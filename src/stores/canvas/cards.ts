/**
 * 画布仓库：卡片状态
 * （卡片尺寸上报、展开 / 收起、索引区显示、隐藏表）
 */
import { message } from "antdv-next";
import type { CanvasDeps, CanvasStore } from "./types";

/**
 * 卡片状态 part：卡片尺寸上报、展开 / 收起、索引区显示与隐藏表。
 * 隐藏 / 显示经契约落库，失败弹提示；this 上下文由 ThisType<CanvasStore> 提供。
 */
export function cardMethods(deps: CanvasDeps) {
  return {
    /** 上报卡片实测尺寸；与上次差异不足 1px 时忽略，避免测量与渲染互相触发的抖动 */
    setCardSize(tableId: string, w: number, h: number) {
      const prev = this.cardSizes[tableId];
      if (prev && Math.abs(prev.w - w) < 1 && Math.abs(prev.h - h) < 1) return;
      this.cardSizes[tableId] = { w, h };
    },
    /** 切换卡片展开 / 收起（长表字段区完整展示）；仅改本地状态，不落库 */
    toggleExpand(tableId: string) {
      this.expandedTableIds = this.expandedTableIds.includes(tableId)
        ? this.expandedTableIds.filter((x) => x !== tableId)
        : [...this.expandedTableIds, tableId];
    },
    /** 卡片是否处于展开态（expandedTableIds 命中即真） */
    isExpanded(tableId: string): boolean {
      return this.expandedTableIds.includes(tableId);
    },
    /** 切换卡片索引区显示（展示各索引的字段行）；仅改本地状态，不落库 */
    toggleShowIndexes(tableId: string) {
      this.showIndexIds = this.showIndexIds.includes(tableId)
        ? this.showIndexIds.filter((x) => x !== tableId)
        : [...this.showIndexIds, tableId];
    },
    /** 卡片索引区是否展开（showIndexIds 命中即真） */
    showIndexes(tableId: string): boolean {
      return this.showIndexIds.includes(tableId);
    },
    /** 切换表隐藏状态；转为隐藏时同步移出选中集，落库经契约（失败弹提示、不回滚） */
    toggleHiddenTable(tableId: string) {
      const model = deps.getModel();
      const next = !this.hiddenTableIds.includes(tableId);
      if (next) this.selectedIds = this.selectedIds.filter((x) => x !== tableId);
      model.setTableHidden(tableId, next).catch((e: unknown) => {
        message.error((e as Error)?.message || "切换隐藏状态失败");
      });
    },
    /** 隐藏表（已隐藏则不动）：移出选中集并经契约落库 */
    hideTable(tableId: string) {
      const model = deps.getModel();
      if (!this.hiddenTableIds.includes(tableId)) {
        this.selectedIds = this.selectedIds.filter((x) => x !== tableId);
        model.setTableHidden(tableId, true).catch((e: unknown) => {
          message.error((e as Error)?.message || "隐藏表失败");
        });
      }
    },
    /** 显示表（未隐藏则不动）：仅解除隐藏，不改变选中集 */
    showTable(tableId: string) {
      const model = deps.getModel();
      if (this.hiddenTableIds.includes(tableId)) {
        model.setTableHidden(tableId, false).catch((e: unknown) => {
          message.error((e as Error)?.message || "显示表失败");
        });
      }
    },
  } satisfies ThisType<CanvasStore> & Partial<CanvasStore>;
}
