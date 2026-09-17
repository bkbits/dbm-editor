/**
 * 画布仓库：复制 / 粘贴
 * （复制选中表为草稿，粘贴时经契约新建并选中）
 */
import type { TableAddPayload } from "@/types/model";
import type { Point } from "@/utils/geometry";
import type { CanvasDeps, CanvasStore } from "./types";

/**
 * 复制粘贴 part：先把选中表复制为「新增表草稿」暂存，粘贴时逐张经契约新建并选中。
 * 草稿不含 id，落点按 24px 递推错开；this 上下文由 ThisType<CanvasStore> 提供。
 */
export function clipboardMethods(deps: CanvasDeps) {
  return {
    /** 复制选中表为草稿存入剪贴板，返回张数；无选中时清空剪贴板并返回 0 */
    copySelection() {
      const model = deps.getModel();
      const ids = this.selectedIds.length ? this.selectedIds : [];
      const drafts = ids
        .map((id) => model.buildCopyDraft(id))
        .filter((d): d is Omit<TableAddPayload, "id"> => Boolean(d));
      this.clipboard = drafts;
      return drafts.length;
    },
    /**
     * 在落点世界坐标处粘贴：先抓撤销快照，再逐张经契约新建（每张偏移 24px 错开），
     * 全部完成后选中新表；剪贴板为空时直接返回，不产生任何改动
     */
    async pasteAt(world: Point) {
      const model = deps.getModel();
      if (!this.clipboard.length) return;
      const history = deps.getHistory();
      history.capture(model.takeSnapshot());
      const created: string[] = [];
      let i = 0;
      for (const draft of this.clipboard) {
        const id = await model.pasteTable(draft, { x: world.x + i * 24, y: world.y + i * 24 });
        created.push(id);
        i += 1;
      }
      this.setSelection(created);
    },
    /** 剪贴板是否有草稿（右键菜单「粘贴」可用性判定） */
    hasClipboard(): boolean {
      return this.clipboard.length > 0;
    },
  } satisfies ThisType<CanvasStore> & Partial<CanvasStore>;
}
