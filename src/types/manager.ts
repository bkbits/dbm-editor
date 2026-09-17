/**
 * ManagerApi 数据契约定义
 *
 * 本地管理能力接口（设置 / 数据库导入 / 模型全量加载与保存 / 分类・表・导航
 * 细粒度 CRUD / 字典与模板 / 代码替换 / AI 能力）：全部方法返回 Promise，
 * 校验失败以 reject 抛出中文业务提示。实体与 DTO 类型见 ./model.ts，
 * AI 相关类型见 ./ai.ts。
 */

import type {
  AiSettings,
  ChatCompletionDelta,
  ChatCompletionRequest,
  ChatCompletionResult,
} from "./ai";
import type {
  DBTable,
  Dict,
  DictCategory,
  LoadResultVO,
  ManagerTable,
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
  saveSettings(settings: Settings): Promise<void>;

  /** 从真实数据库读取表结构（用于导入建模） */
  importFromDB(): Promise<DBTable[]>;

  /** 加载完整模型（分类/表/导航），初次进入加载以及点击刷新按钮时使用它 */
  load(): Promise<LoadResultVO>;

  /** 全量保存模型（分类/表/导航），点击「保存所有」按钮或按 `Ctrl+S` 时调用 */
  save(): Promise<void>;

  /* ---------- 分类 ---------- */

  /** 获取全部分类 */
  getCategories(): Promise<TableCategory[]>;

  /** 新增分类 */
  addCategory(category: TableCategory): Promise<void>;

  /** 更新分类 */
  updateCategory(category: TableCategory): Promise<void>;

  /** 删除分类 */
  removeCategory(categoryId: string): Promise<void>;

  /* ---------- 表 ---------- */

  /** 获取全部表（含字段与索引） */
  getTables(): Promise<ManagerTable[]>;

  /** 新增表（含字段与索引） */
  addTable(table: ManagerTable): Promise<void>;

  /** 更新表（含字段与索引） */
  updateTable(table: ManagerTable): Promise<void>;

  /** 删除表（一并删除其字段、索引与关联导航） */
  removeTable(tableId: string): Promise<void>;

  /** 批量更新表位置（拖动一个或多个表卡片结束时使用；多选同动时仅调用一次） */
  updateTablePos(tablePoses: UpdateTablePosDTO): Promise<void>;

  /* ---------- 导航 ---------- */

  /** 获取全部导航关系 */
  getNavigates(): Promise<TableNavigate[]>;

  /** 新增导航关系 */
  addNavigate(navigate: TableNavigate): Promise<void>;

  /** 更新导航关系 */
  updateNavigate(navigate: TableNavigate): Promise<void>;

  /** 删除导航关系 */
  removeNavigate(navigateId: string): Promise<void>;

  /* ---------- 字典分类 ---------- */

  /** 获取全部字典分类 */
  getDictCategories(): Promise<DictCategory[]>;

  /** 新增字典分类 */
  addDictCategory(category: DictCategory): Promise<void>;

  /** 更新字典分类 */
  updateDictCategory(category: DictCategory): Promise<void>;

  /** 删除字典分类（分类下仍有字典时拒绝） */
  removeDictCategory(categoryId: string): Promise<void>;

  /** 获取字典 */
  getDicts(): Promise<Dict[]>;

  /** 新增字典 */
  addDict(dict: Dict): Promise<void>;

  /** 更新字典 */
  updateDict(dict: Dict): Promise<void>;

  /** 删除字典 */
  removeDict(dictId: string): Promise<void>;

  /* ---------- 字典分类模板 ---------- */

  /** 获取字典分类模板（仅一个，用于按分类生成字典代码） */
  getDictCategoryTemplate(): Promise<Template>;

  /** 更新字典分类模板 */
  updateDictCategoryTemplate(template: Template): Promise<void>;

  /** 获取全部表模板 */
  getTemplates(): Promise<Template[]>;

  /** 新增表模板 */
  addTemplate(template: Template): Promise<void>;

  /** 更新表模板 */
  updateTemplate(template: Template): Promise<void>;

  /** 删除表模板 */
  removeTemplate(templateId: string): Promise<void>;

  /** 上传 zip 产物代码，直接替换对应源码文件 */
  replace(zipFile: Blob): Promise<void>;

  /* ---------- AI（openai compatible） ---------- */

  /** 获取 AI 设置（供应商地址 / API Key / 模型列表 / 全局规则） */
  getAiSettings(): Promise<AiSettings>;

  /** 保存 AI 设置（校验失败 reject 中文业务提示） */
  saveAiSettings(settings: AiSettings): Promise<void>;

  /**
   * openai compatible chat completions 标准流式接口：
   * 请求 / 增量 / 结果对齐 openai 规范子集；onDelta 逐片回调流式增量
   * （正文 / 思考 / 工具调用三类），流结束后 resolve 聚合结果；
   * 中止经 request.signal（abort 后以 reject 收尾）。
   */
  chatComplete(
    request: ChatCompletionRequest,
    onDelta?: (delta: ChatCompletionDelta) => void,
  ): Promise<ChatCompletionResult>;

  /**
   * demo 扩展：重置为内置演示数据（仅 DemoManagerApi 提供，
   * 正式实现无需实现该方法）
   */
  resetDemo?(): Promise<void>;
}
