/**
 * API 模块：按需求规格说明书 api 清单组织
 */
import type {
  AppSettings,
  CodeTemplate,
  DBTableDef,
  Dict,
  ReplaceResult,
  TableAddPayload,
  TableCategory,
  TableUpdatePayload,
  TableVO,
} from '@/types/model'
import { http } from './http'

async function get<T>(url: string, params?: Record<string, unknown>): Promise<T> {
  const res = await http.get<T>(url, { params })
  return res.data
}

async function post<T>(url: string, data?: unknown): Promise<T> {
  const res = await http.post<T>(url, data)
  return res.data
}

/* ---------- 分类 ---------- */
export const categoryApi = {
  /** 查询当前所有分类 */
  query: () => get<TableCategory[]>('/codegen/category/query'),
  /** 添加分类 */
  add: (data: Partial<TableCategory>) => post<TableCategory>('/codegen/category/add', data),
  /** 更新分类 */
  update: (data: TableCategory) => post<TableCategory>('/codegen/category/update', data),
  /** 删除分类 */
  remove: (id: string) => post<boolean>('/codegen/category/remove', { id }),
}

/* ---------- 表 ---------- */
export const tableApi = {
  /** 从真实数据库查询数据（mock 返回模拟库表结构） */
  queryFromDB: () => get<DBTableDef[]>('/codegen/table/queryFromDB'),
  /**
   * 查询当前所有表信息，返回 TableVO 列表
   * @param params.categoryId 分类id, 精确查询, 可选
   * @param params.tableName 表名, 模糊查询, 可选
   */
  query: (params?: { categoryId?: string; tableName?: string }) => get<TableVO[]>('/codegen/table/query', params),
  /** 添加表信息 */
  add: (data: TableAddPayload) => post<TableVO>('/codegen/table/add', data),
  /** 更新表信息（rawNavigates 为该表参与的原始导航，替换语义） */
  update: (data: TableUpdatePayload) => post<TableVO>('/codegen/table/update', data),
  /** 删除表信息 */
  remove: (id: string) => post<boolean>('/codegen/table/remove', { id }),
}

/* ---------- 代码替换 ---------- */
export const codegenApi = {
  /** 上传 zip 生成代码直接替换对应文件（谨慎使用） */
  replace: (zip: Blob) => {
    const form = new FormData()
    form.append('zip', zip, 'codegen.zip')
    return post<ReplaceResult>('/codegen/replace', form)
  },
}

/* ---------- 字典（mock 扩展接口） ---------- */
export const dictApi = {
  query: () => get<Dict[]>('/codegen/dict/query'),
  add: (data: Partial<Dict>) => post<Dict>('/codegen/dict/add', data),
  update: (data: Dict) => post<Dict>('/codegen/dict/update', data),
  remove: (id: string) => post<boolean>('/codegen/dict/remove', { id }),
}

/* ---------- 模板（mock 扩展接口） ---------- */
export const templateApi = {
  query: () => get<CodeTemplate[]>('/codegen/template/query'),
  add: (data: Partial<CodeTemplate>) => post<CodeTemplate>('/codegen/template/add', data),
  update: (data: CodeTemplate) => post<CodeTemplate>('/codegen/template/update', data),
  remove: (id: string) => post<boolean>('/codegen/template/remove', { id }),
}

/* ---------- 设置（mock 扩展接口） ---------- */
export const settingsApi = {
  /** 查询应用设置（列默认类型规则等） */
  query: () => get<AppSettings>('/codegen/settings/query'),
  /** 更新应用设置 */
  update: (data: AppSettings) => post<AppSettings>('/codegen/settings/update', data),
}
