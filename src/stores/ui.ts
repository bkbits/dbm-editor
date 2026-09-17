/**
 * UI 仓库：页面状态切换（不使用 vue-router，使用 v-if 管理）+ 各编辑对话框状态
 * （reactive 对象工厂形态，由 DBManagerView 经上下文注入，不依赖 Pinia）
 */
import { reactive } from "vue";
import { useDBManagerContext } from "./context";
import type { GeneratedFile } from "@/types/model";

export type PageName = "editor" | "dict" | "template" | "settings" | "ai";

export interface TableEditDialogState {
  open: boolean;
  tableId: string | null; // null 表示新增
  position: { x: number; y: number } | null; // 新增时的画布落点
  defaultCategoryId: string | null; // 新增时的默认分类
}

export interface NavigateEditDialogState {
  open: boolean;
  navigateId: string | null; // null 表示新增
  preset: { self?: string; target?: string } | null; // 拖拽连线预填
}

export interface CategoryEditDialogState {
  open: boolean;
  categoryId: string | null;
}

export interface ReplaceConfirmDialogState {
  open: boolean;
  files: GeneratedFile[];
}

/**
 * 创建 UI 仓库（reactive 对象工厂，不依赖 Pinia；由 createDBManagerState 注入组件树）
 * 只承载界面态：所有开关都不落 ManagerApi 契约，关闭对话框不改模型、不入撤销栈。
 */
export function createUiStore() {
  return reactive({
    /** 当前页面（v-if 切换） */
    page: "editor" as PageName,
    tableEdit: {
      open: false,
      tableId: null,
      position: null,
      defaultCategoryId: null,
    } as TableEditDialogState,
    navigateEdit: { open: false, navigateId: null, preset: null } as NavigateEditDialogState,
    categoryEdit: { open: false, categoryId: null } as CategoryEditDialogState,
    importDB: { open: false },
    codePreview: { open: false, tableId: null as string | null },
    replaceConfirm: { open: false, files: [] as GeneratedFile[] } as ReplaceConfirmDialogState,

    /** 移动端（≤768px）大纲抽屉开关：桌面侧边栏不受影响，抽屉样式由 OutlinePanel 媒体查询接管 */
    mobileOutlineOpen: false,

    /** 切页（五页共用同一实例，v-if 卸载旧页，故页面内部状态随之丢失） */
    setPage(page: PageName) {
      this.page = page;
    },
    /** 切换移动端（≤768px）大纲抽屉；桌面侧边栏不读此标志，互不影响 */
    toggleMobileOutline() {
      this.mobileOutlineOpen = !this.mobileOutlineOpen;
    },
    /** 关闭移动端大纲抽屉（点遮罩与跳转后调用；幂等） */
    closeMobileOutline() {
      this.mobileOutlineOpen = false;
    },
    /**
     * 打开表编辑对话框：tableId 为空表示新增（position 为画布落点、
     * defaultCategoryId 为默认分类，两者仅新增时有意义）。
     * 每次调用整体覆盖四个字段，不残留上次入参。
     */
    openTableEdit(
      tableId?: string | null,
      position?: { x: number; y: number } | null,
      defaultCategoryId?: string | null,
    ) {
      this.tableEdit = {
        open: true,
        tableId: tableId ?? null,
        position: position ?? null,
        defaultCategoryId: defaultCategoryId ?? null,
      };
    },
    /** 关闭表编辑对话框（只置 open=false，其余入参保留到下次打开时被整体覆盖） */
    closeTableEdit() {
      this.tableEdit.open = false;
    },
    /** 打开关系编辑对话框：navigateId 为空表示新增；preset 为拖拽连线时的起点/终点预填 */
    openNavigateEdit(
      navigateId?: string | null,
      preset?: { self?: string; target?: string } | null,
    ) {
      this.navigateEdit = { open: true, navigateId: navigateId ?? null, preset: preset ?? null };
    },
    /** 关闭关系编辑对话框（只置 open=false，preset 保留到下次打开时被整体覆盖） */
    closeNavigateEdit() {
      this.navigateEdit.open = false;
    },
    /** 打开分类编辑对话框（categoryId 为空表示新增） */
    openCategoryEdit(categoryId?: string | null) {
      this.categoryEdit = { open: true, categoryId: categoryId ?? null };
    },
    /** 关闭分类编辑对话框（只置 open=false） */
    closeCategoryEdit() {
      this.categoryEdit.open = false;
    },
    /** 打开「从数据库导入」对话框（导入动作本身由 ImportDBDialog 经模型仓库执行） */
    openImportDB() {
      this.importDB.open = true;
    },
    /** 关闭导入对话框（取消或导入成功后调用；只切可见性，不触碰模型） */
    closeImportDB() {
      this.importDB.open = false;
    },
    /** 打开代码预览对话框（tableId 为空表示未指定，弹窗自行回退到第一张表） */
    openCodePreview(tableId?: string | null) {
      this.codePreview = { open: true, tableId: tableId ?? null };
    },
    /** 关闭代码预览对话框（只置 open=false；已生成的预览内容由弹窗自行丢弃） */
    closeCodePreview() {
      this.codePreview.open = false;
    },
    /** 打开「代码替换」确认弹窗并携带待上传文件（替换会改动磁盘，必须先经用户确认） */
    openReplaceConfirm(files: GeneratedFile[]) {
      this.replaceConfirm = { open: true, files };
    },
    /** 关闭替换确认弹窗（取消替换；确认后实际 zip 上传由模板仓库 replaceWithGenerated 执行） */
    closeReplaceConfirm() {
      this.replaceConfirm.open = false;
    },
  });
}

export type UiStore = ReturnType<typeof createUiStore>;

/** 子组件取用 UI 仓库（须处于 DBManagerView 组件树内） */
export function useUiStore(): UiStore {
  return useDBManagerContext().ui;
}
