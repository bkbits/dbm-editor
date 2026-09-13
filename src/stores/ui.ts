/**
 * UI 仓库：页面状态切换（不使用 vue-router，使用 v-if 管理）+ 各编辑对话框状态
 * （reactive 对象工厂形态，由 DBManagerView 经上下文注入，不依赖 Pinia）
 */
import { reactive } from 'vue'
import { useDBManagerContext } from './context'
import type { GeneratedFile } from '@/types/model'

export type PageName = 'editor' | 'dict' | 'template' | 'settings'

export interface TableEditDialogState {
  open: boolean
  tableId: string | null // null 表示新增
  position: { x: number; y: number } | null // 新增时的画布落点
  defaultCategoryId: string | null // 新增时的默认分类
}

export interface NavigateEditDialogState {
  open: boolean
  navigateId: string | null // null 表示新增
  preset: { self?: string; target?: string } | null // 拖拽连线预填
}

export interface CategoryEditDialogState {
  open: boolean
  categoryId: string | null
}

export interface ReplaceConfirmDialogState {
  open: boolean
  files: GeneratedFile[]
}

export function createUiStore() {
  return reactive({
    /** 当前页面（v-if 切换） */
    page: 'editor' as PageName,
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

    setPage(page: PageName) {
      this.page = page
    },
    toggleMobileOutline() {
      this.mobileOutlineOpen = !this.mobileOutlineOpen
    },
    closeMobileOutline() {
      this.mobileOutlineOpen = false
    },
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
      }
    },
    closeTableEdit() {
      this.tableEdit.open = false
    },
    openNavigateEdit(
      navigateId?: string | null,
      preset?: { self?: string; target?: string } | null,
    ) {
      this.navigateEdit = { open: true, navigateId: navigateId ?? null, preset: preset ?? null }
    },
    closeNavigateEdit() {
      this.navigateEdit.open = false
    },
    openCategoryEdit(categoryId?: string | null) {
      this.categoryEdit = { open: true, categoryId: categoryId ?? null }
    },
    closeCategoryEdit() {
      this.categoryEdit.open = false
    },
    openImportDB() {
      this.importDB.open = true
    },
    closeImportDB() {
      this.importDB.open = false
    },
    openCodePreview(tableId?: string | null) {
      this.codePreview = { open: true, tableId: tableId ?? null }
    },
    closeCodePreview() {
      this.codePreview.open = false
    },
    openReplaceConfirm(files: GeneratedFile[]) {
      this.replaceConfirm = { open: true, files }
    },
    closeReplaceConfirm() {
      this.replaceConfirm.open = false
    },
  })
}

export type UiStore = ReturnType<typeof createUiStore>

/** 子组件取用 UI 仓库（须处于 DBManagerView 组件树内） */
export function useUiStore(): UiStore {
  return useDBManagerContext().ui
}
