/**
 * 画布仓库：选择集、悬停与右键菜单开关
 * （选中态读写（表 / 分类 / 连线）、悬停高亮、菜单开关）
 */
import type { CanvasStore, ContextMenuState } from "./types";

/**
 * 选择 part：选中态读写（表 / 分类 / 连线）、悬停高亮与右键菜单开关。
 * 只改本地状态、不落库；this 上下文由 ThisType<CanvasStore> 提供。
 */
export function selectionMethods() {
  return {
    /** 整批设置选中表，并清除导航线选中（单一焦点语义，避免两种高亮叠加混淆） */
    setSelection(ids: string[]) {
      this.selectedIds = ids;
      // 单一焦点语义：选中表时清除导航线选中态，避免表选中与线段选中两种高亮叠加混淆
      this.selectedNavigateId = "";
    },
    /** 选择分类：additive 为真按 Ctrl 语义切换；否则单选（再次点击同一项即取消） */
    selectCategory(id: string, additive = false) {
      if (additive) {
        this.selectedCategoryIds = this.selectedCategoryIds.includes(id)
          ? this.selectedCategoryIds.filter((x) => x !== id)
          : [...this.selectedCategoryIds, id];
      } else {
        this.selectedCategoryIds =
          this.selectedCategoryIds.includes(id) && this.selectedCategoryIds.length === 1
            ? []
            : [id];
      }
    },
    /** 选择表：additive 为真按 Ctrl 语义切换；否则单选，并清除导航线选中 */
    selectTable(id: string, additive = false) {
      if (additive) {
        this.selectedIds = this.selectedIds.includes(id)
          ? this.selectedIds.filter((x) => x !== id)
          : [...this.selectedIds, id];
      } else {
        this.selectedIds = [id];
      }
      // 单一焦点语义（含 Ctrl/Shift 多选卡片路径）
      this.selectedNavigateId = "";
    },
    /** 清空表选中与导航线选中（触屏轻点空白 / Escape 等入口共用） */
    clearSelection() {
      this.selectedIds = [];
      this.selectedNavigateId = "";
    },
    /** 打开右键菜单：记录种类、屏幕位置与世界坐标（菜单项动作依赖 world） */
    openMenu(menu: ContextMenuState) {
      this.menu = menu;
    },
    /** 关闭右键菜单（置空后菜单组件卸载） */
    closeMenu() {
      this.menu = null;
    },
    /** 设置悬停表 id（空串 = 取消悬停），驱动卡片高亮 */
    setHoveredTable(id: string) {
      this.hoveredTableId = id;
    },
    /** 设置悬停导航线 id（空串 = 取消悬停），驱动连线高亮 */
    setHoveredNavigate(id: string) {
      this.hoveredNavigateId = id;
    },
    /** 切换导航线选中：相同 id 再次调用即取消；选中时清空表选中（单一焦点） */
    setSelectedNavigate(id: string) {
      this.selectedNavigateId = this.selectedNavigateId === id ? "" : id;
      if (id) this.selectedIds = [];
    },
  } satisfies ThisType<CanvasStore> & Partial<CanvasStore>;
}
