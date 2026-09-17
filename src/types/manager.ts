/**
 * ManagerApi 数据契约定义
 *
 * 本地管理能力接口（设置 / 数据库导入 / 模型全量加载与保存 / 分类・表・导航
 * 细粒度 CRUD / 字典与模板 / 代码替换）：全部方法返回 Promise，
 * 校验失败以 reject 抛出中文业务提示。实体与 DTO 类型见 ./model.ts，
 * AI 专属能力（设置 / 对话 / fetch）见 ./ai.ts 的 AIApi。
 */

import type {
  DBTable,
  Dict,
  DictCategory,
  ManagerTable,
  ModelElements,
  Settings,
  TableCategory,
  TableNavigate,
  Template,
  UpdateTablePosDTO,
} from "./model";

/**
 * 本地管理能力接口：设置、数据库导入、模型全量加载/保存、字典与模板管理、代码替换。
 *
 * 全部方法均为异步契约（返回 Promise）：UI 侧 await 消费，对接真实后端
 * （HTTP / IPC / 文件 IO）时无需再调整调用链路；校验失败以 reject 抛出
 * （Error.message 为中文业务提示）。
 */
export interface ManagerApi {
  /** 获取应用设置 */
  getSettings(): Promise<Settings>;

  /** 保存应用设置 */
  setSettings(settings: Settings): Promise<void>;

  /** 从真实数据库读取表结构（用于导入建模） */
  importFromDB(): Promise<DBTable[]>;

  /** 加载完整模型元素（分类/表/导航），初次进入加载以及点击刷新按钮时使用它 */
  load(): Promise<ModelElements>;

  /**
   * 全量保存模型（分类/表/导航），点击「保存所有」按钮或按 `Ctrl+S` 时调用；
   * 全量替换语义：不在列表中的分类/表/导航会被删除，入参须为当前运行时状态的完整快照。
   */
  save(modelElements: ModelElements): Promise<void>;

  /* ---------- 表分类 ---------- */

  /** 获取表分类 */
  getTableCategories(): Promise<TableCategory[]>;

  /** 新增表分类 */
  addTableCategory(category: TableCategory): Promise<void>;

  /** 更新表分类 */
  updateTableCategory(category: TableCategory): Promise<void>;

  /** 删除表分类（分类下仍有表时拒绝） */
  removeTableCategory(categoryId: string): Promise<void>;

  /* ---------- 表 ---------- */

  /** 获取表（含字段与索引） */
  getTables(): Promise<ManagerTable[]>;

  /** 新增表（含字段与索引） */
  addTable(table: ManagerTable): Promise<void>;

  /** 更新表（含字段与索引） */
  updateTable(table: ManagerTable): Promise<void>;

  /** 删除表（一并删除其字段、索引与关联导航） */
  removeTable(tableId: string): Promise<void>;

  /* ---------- 导航关系 ---------- */

  /** 获取导航关系 */
  getNavigates(): Promise<TableNavigate[]>;

  /** 新增导航关系 */
  addNavigate(navigate: TableNavigate): Promise<void>;

  /** 更新导航关系 */
  updateNavigate(navigate: TableNavigate): Promise<void>;

  /** 删除导航关系 */
  removeNavigate(navigateId: string): Promise<void>;

  /* ---------- 表布局 ---------- */

  /** 批量更新表位置（拖动一张或多张表卡片结束时调用一次） */
  updateTablePos(tablePoses: UpdateTablePosDTO): Promise<void>;

  /** 获取字典分类 */
  getDictCategories(): Promise<DictCategory[]>;

  /** 新增字典分类 */
  addDictCategory(dictCategory: DictCategory): Promise<void>;

  /** 更新字典分类 */
  updateDictCategory(dictCategory: DictCategory): Promise<void>;

  /** 删除字典分类（分类下仍有字典时拒绝） */
  removeDictCategory(dictCategoryId: string): Promise<void>;

  /** 获取字典 */
  getDicts(): Promise<Dict[]>;

  /** 替换保存字典（不在 dicts 列表中的字典会被删除，入参须为完整快照） */
  saveDicts(dicts: Dict[]): Promise<void>;

  /** 新增字典 */
  addDict(dict: Dict): Promise<void>;

  /** 更新字典 */
  updateDict(dict: Dict): Promise<void>;

  /** 删除字典 */
  removeDict(dictId: string): Promise<void>;

  /** 获取模板 */
  getTemplates(): Promise<Template[]>;

  /** 替换保存模板（不在 templates 列表中的模板会被删除，字典模板也在其中；入参须为完整快照） */
  saveTemplates(templates: Template[]): Promise<void>;

  /** 获取指定 id 的模板 */
  getTemplate(templateId: string): Promise<Template>;

  /** 获取字典模板（模板集合中 id 固定为 `tpl-dict-category` 的一条，用于按分类生成字典代码） */
  getDictTemplate(): Promise<Template>;

  /** 新增模板 */
  addTemplate(template: Template): Promise<void>;

  /** 更新模板 */
  updateTemplate(template: Template): Promise<void>;

  /** 删除模板（按 id） */
  removeTemplate(templateId: string): Promise<void>;

  /** 上传 zip 产物代码，直接替换对应源码文件 */
  replace(zipFile: Blob): Promise<void>;
}
