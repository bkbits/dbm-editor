/**
 * DemoManagerApi：ManagerApi 的内置演示实现
 *
 * 由原 axios mock 分发层迁移而来：数据存于内存（src/mock/db.ts）并
 * 持久化到 localStorage（gdbme:db:v2）。按契约全部方法返回 Promise：
 * 除 replace 的 zip 解析为真实异步外，其余方法内部同步完成后异步
 * resolve（微任务内落定）；校验失败 reject（Error message 为中文业务提示）。
 *
 * 结构（按逻辑拆分，见 src/api/demo/）：
 * - demo/helpers.ts：归一 / 校验纯函数 + 调用日志 Proxy 包装
 * - demo/chat-complete.ts：openai compatible SSE 流式对话客户端
 *
 * 契约语义：
 * - 细粒度方法（addXxx/updateXxx/removeXxx/updateTablePos）即时写库并落盘
 * - save() 无参全量保存：demo 的内存即真相，等价于确认落盘
 * - removeTable 一并删除其字段、索引与关联导航
 * - 所有方法经 Proxy 包装，使用统一日志器（src/log/Logger.ts）打印入参与
 *   返回（debug 级，异步方法等落定后打印 resolved 值）、抛错（error 级）；
 *   Logger.setLevel 可运行时调整输出级别
 */
import JSZip from "jszip";
import { message } from "antdv-next";
import type {
  AiModelConfig,
  AiSettings,
  ChatCompletionDelta,
  ChatCompletionRequest,
  ChatCompletionResult,
  ThinkingIntensity,
} from "@/types/ai";
import type { ManagerApi } from "@/types/manager";
import type {
  DBTable,
  Dict,
  DictCategory,
  LoadResultVO,
  ManagerTable,
  Settings,
  Table,
  TableCategory,
  TableNavigate,
  Template,
  TypeMapping,
  UpdateTablePosDTO,
} from "@/types/model";
import { getDB, persistDB, resetDB } from "@/mock/db";
import { SEED_DB_TABLES } from "@/mock/seed";
import { AUDIT_FIELD_ROLES, normalizeFieldConventions } from "@/utils/fieldConvention";
import {
  assertRegex,
  clone,
  DEFAULT_MAX_TOOL_ROUNDS,
  normalizeColumns,
  normalizeDict,
  normalizeDictCategory,
  normalizeIndexes,
  normalizeMaxToolRounds,
  normalizeNavigate,
  normalizeOptionSettings,
  requireStr,
  THINKING_INTENSITIES,
  withCallLogging,
} from "./demo/helpers";
import { chatCompleteViaSse } from "./demo/chat-complete";

export { DEFAULT_MAX_TOOL_ROUNDS };

export class DemoManagerApi implements ManagerApi {
  constructor() {
    // 演示实现的调用可观测性：所有方法经统一日志器打印入参与结果，
    // 便于联调核对契约调用时机（级别可由 Logger.setLevel 调整）
    return withCallLogging(this, "DemoManagerApi");
  }

  /* ==================== 设置 ==================== */

  /** 读取设置（旧库字段缺失时兜底归一；映射规则按 sort 排序） */
  async getSettings(): Promise<Settings> {
    const db = getDB();
    const s =
      db.settings ||
      ({ indexTypes: [], typeMappings: [], tableOptions: [], columnOptions: [] } as Settings);
    const typeMappings = (Array.isArray(s.typeMappings) ? s.typeMappings : [])
      .slice()
      .sort((a, b) => a.sort - b.sort)
      .map((m) => ({
        sort: Number(m.sort) || 0,
        pattern: String(m.pattern ?? ""),
        javaType: String(m.javaType || "String"),
      }));
    const indexTypes = (Array.isArray(s.indexTypes) ? s.indexTypes : [])
      .map((t) => String(t).trim().toUpperCase())
      .filter(Boolean);
    return {
      indexTypes,
      typeMappings,
      author: String(s.author ?? "").trim() || undefined,
      tableOptions: normalizeOptionSettings(s.tableOptions),
      columnOptions: normalizeOptionSettings(s.columnOptions),
      fieldConventions: normalizeFieldConventions(s.fieldConventions),
    };
  }

  /** 保存设置：正则 / 索引类型 / 选项名 / 字段约定全部校验后写库落盘 */
  async saveSettings(settings: Settings): Promise<void> {
    // 规则校验：非空 pattern + 合法正则；索引类型去重归一；选项名称非空唯一
    const typeMappings: TypeMapping[] = (settings.typeMappings || []).map((m, i) => {
      const pattern = String(m.pattern ?? "").trim();
      if (!pattern) throw new Error("存在空的列类型正则表达式");
      assertRegex(pattern);
      return { sort: i, pattern, javaType: String(m.javaType || "String") };
    });
    const seen = new Set<string>();
    const indexTypes: string[] = [];
    for (const raw of settings.indexTypes || []) {
      const t = String(raw ?? "")
        .trim()
        .toUpperCase();
      if (!t) throw new Error("索引类型不能为空");
      if (seen.has(t)) throw new Error(`索引类型重复：${t}`);
      seen.add(t);
      indexTypes.push(t);
    }
    if (!indexTypes.length) throw new Error("至少保留一个索引类型");
    const tableOptions = normalizeOptionSettings(settings.tableOptions, "表选项");
    const columnOptions = normalizeOptionSettings(settings.columnOptions, "列选项");
    // 主键、审计与逻辑删除字段约定：归一后校验名称合法且互不重复
    const fieldConventions = normalizeFieldConventions(settings.fieldConventions);
    const convNames = [
      fieldConventions.primaryKey.name,
      ...AUDIT_FIELD_ROLES.map((role) => fieldConventions.auditFields[role].name),
      fieldConventions.logicDelete.name,
    ];
    for (const n of convNames) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(n))
        throw new Error(`字段约定名称需为合法标识符（字母/数字/下划线）：${n}`);
    }
    if (new Set(convNames).size !== convNames.length)
      throw new Error("主键、审计与逻辑删除字段的名称需互不重复");
    getDB().settings = {
      indexTypes,
      typeMappings,
      author: String(settings.author ?? "").trim() || undefined,
      tableOptions,
      columnOptions,
      fieldConventions,
    };
    persistDB();
  }

  /* ==================== AI 设置 ==================== */

  /** 读取 AI 设置（旧库字段缺失时兜底归一，不落盘） */
  async getAiSettings(): Promise<AiSettings> {
    const raw = getDB().aiSettings;
    // 读取时兜底归一（旧库缺字段 / 形态漂移防御），不落盘
    const models: AiModelConfig[] = [];
    const seen = new Set<string>();
    for (const m of raw?.models || []) {
      const id = String(m?.id ?? "").trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const supportsThinking = Boolean(m?.supportsThinking);
      models.push({
        id,
        name: String(m?.name ?? "").trim() || id,
        supportsThinking,
        thinkingIntensity: supportsThinking
          ? THINKING_INTENSITIES.includes(m?.thinkingIntensity as ThinkingIntensity)
            ? (m?.thinkingIntensity as ThinkingIntensity)
            : "medium"
          : undefined,
        inputContextLength:
          Math.max(0, Math.floor(Number(m?.inputContextLength) || 0)) || undefined,
        outputContextLength:
          Math.max(0, Math.floor(Number(m?.outputContextLength) || 0)) || undefined,
      });
    }
    return {
      baseUrl: String(raw?.baseUrl ?? "").trim(),
      apiKey: String(raw?.apiKey ?? ""),
      models,
      globalRules: String(raw?.globalRules ?? ""),
      maxToolRounds: normalizeMaxToolRounds(raw?.maxToolRounds),
    };
  }

  /** 保存 AI 设置：地址 /v1 形态、模型 id 唯一、思考强度档位校验后写库落盘 */
  async saveAiSettings(settings: AiSettings): Promise<void> {
    const baseUrl = String(settings?.baseUrl ?? "").trim();
    const apiKey = String(settings?.apiKey ?? "");
    if (baseUrl) {
      if (!/^https?:\/\//i.test(baseUrl))
        throw new Error("AI 服务地址必须以 http:// 或 https:// 开头");
      if (!/\/v1\/?$/i.test(baseUrl))
        throw new Error("AI 服务地址必须以 /v1 结尾（如 https://api.example.com/v1）");
    }
    const models: AiModelConfig[] = [];
    const seen = new Set<string>();
    for (const m of settings?.models || []) {
      const id = String(m?.id ?? "").trim();
      if (!id) throw new Error("模型 id 不能为空");
      if (seen.has(id)) throw new Error(`模型 id 重复：${id}`);
      seen.add(id);
      const supportsThinking = Boolean(m?.supportsThinking);
      let thinkingIntensity: ThinkingIntensity | undefined;
      if (supportsThinking) {
        thinkingIntensity = THINKING_INTENSITIES.includes(m?.thinkingIntensity as ThinkingIntensity)
          ? (m?.thinkingIntensity as ThinkingIntensity)
          : "medium";
      }
      models.push({
        id,
        name: String(m?.name ?? "").trim() || id,
        supportsThinking,
        thinkingIntensity,
        inputContextLength:
          Math.max(0, Math.floor(Number(m?.inputContextLength) || 0)) || undefined,
        outputContextLength:
          Math.max(0, Math.floor(Number(m?.outputContextLength) || 0)) || undefined,
      });
    }
    if (models.length && !baseUrl) throw new Error("已配置模型列表时必须填写 AI 服务地址");
    getDB().aiSettings = {
      baseUrl,
      apiKey,
      models,
      globalRules: String(settings?.globalRules ?? ""),
      maxToolRounds: normalizeMaxToolRounds(settings?.maxToolRounds),
    };
    persistDB();
  }

  /* ==================== AI 对话（openai compatible 流式，实现体见 demo/chat-complete.ts） ==================== */

  /** openai compatible 流式对话（实现体见 demo/chat-complete.ts） */
  async chatComplete(
    request: ChatCompletionRequest,
    onDelta?: (delta: ChatCompletionDelta) => void,
  ): Promise<ChatCompletionResult> {
    return chatCompleteViaSse(request, onDelta);
  }

  /* ==================== 数据库导入 ==================== */

  /** 返回内置模拟真实库表结构（正式实现对接真实数据库） */
  async importFromDB(): Promise<DBTable[]> {
    // 演示实现：返回内置模拟真实库表结构（正式实现对接真实数据库）
    return clone(SEED_DB_TABLES);
  }

  /* ==================== 模型全量加载 / 保存 ==================== */

  /** 全量加载：分类 + 完整表（含字段/索引，深拷贝）+ 导航 */
  async load(): Promise<LoadResultVO> {
    const db = getDB();
    return {
      categories: clone(db.categories),
      tables: this.assembleTables(db.tables.map((t) => t.id)),
      navigates: clone(db.navigates),
    };
  }

  /** 全量保存（无参契约）：demo 的每次细粒度操作已即时写库，此处确认整体落盘 */
  async save(): Promise<void> {
    persistDB();
  }

  /* ==================== 分类 ==================== */

  /** 分类列表 */
  async getCategories(): Promise<TableCategory[]> {
    return clone(getDB().categories);
  }

  /** 新增分类：名称唯一、必填项校验后写库落盘 */
  async addCategory(category: TableCategory): Promise<void> {
    const db = getDB();
    const name = requireStr(category?.name, "name", "分类名称");
    requireStr(category?.basePackage, "basePackage", "基础包路径");
    if (db.categories.some((c) => c.name === name)) throw new Error(`分类名称已存在: ${name}`);
    if (!category.id) throw new Error("新增分类必须提供 id");
    if (db.categories.some((c) => c.id === category.id))
      throw new Error(`分类 id 已存在: ${category.id}`);
    db.categories.push(clone(category));
    persistDB();
  }

  /** 更新分类：存在性与名称唯一校验后整体覆盖 */
  async updateCategory(category: TableCategory): Promise<void> {
    const db = getDB();
    const id = requireStr(category?.id, "id", "分类ID");
    const target = db.categories.find((c) => c.id === id);
    if (!target) throw new Error(`分类不存在: ${id}`);
    const name = requireStr(category?.name, "name", "分类名称");
    requireStr(category?.basePackage, "basePackage", "基础包路径");
    if (db.categories.some((c) => c.name === name && c.id !== id))
      throw new Error(`分类名称已存在: ${name}`);
    Object.assign(target, clone(category));
    persistDB();
  }

  /** 删除分类：分类下仍有表时拒绝 */
  async removeCategory(categoryId: string): Promise<void> {
    const db = getDB();
    if (!db.categories.some((c) => c.id === categoryId)) return;
    const held = db.tables.filter((t) => t.categoryId === categoryId);
    if (held.length) {
      throw new Error(
        `分类下仍有 ${held.length} 张表（${held[0].tableName} 等），请先删除或迁移这些表`,
      );
    }
    db.categories = db.categories.filter((c) => c.id !== categoryId);
    persistDB();
  }

  /* ==================== 表 ==================== */

  /** 完整表列表（含字段/索引，深拷贝） */
  async getTables(): Promise<ManagerTable[]> {
    return this.assembleTables(getDB().tables.map((t) => t.id));
  }

  /** 新增表：表名唯一、分类存在，字段/索引归一校验后拆集合写库 */
  async addTable(table: ManagerTable): Promise<void> {
    const db = getDB();
    const name = requireStr(table?.tableName, "tableName", "表名");
    if (db.tables.some((t) => t.tableName === name)) throw new Error(`表名已存在: ${name}`);
    if (!table.id) throw new Error("新增表必须提供 id");
    if (db.tables.some((t) => t.id === table.id)) throw new Error(`表 id 已存在: ${table.id}`);
    if (!db.categories.some((c) => c.id === table.categoryId)) {
      throw new Error(`表 ${name} 的所属分类不存在`);
    }
    const columns = normalizeColumns(table, name);
    const indexes = normalizeIndexes(table, name, columns);
    const { columns: _c, indexes: _i, ...meta } = table;
    db.tables.push({ ...clone(meta), id: table.id });
    for (const c of columns) db.columns.push({ ...c, tableId: table.id });
    for (const i of indexes) db.indexes.push({ ...i, tableId: table.id });
    persistDB();
  }

  /** 更新表：存在性 / 唯一性 / 归一校验后整体替换（字段与索引先清后写） */
  async updateTable(table: ManagerTable): Promise<void> {
    const db = getDB();
    const id = requireStr(table?.id, "id", "表ID");
    const target = db.tables.find((t) => t.id === id);
    if (!target) throw new Error(`表不存在: ${id}`);
    const name = requireStr(table?.tableName, "tableName", "表名");
    if (db.tables.some((t) => t.tableName === name && t.id !== id))
      throw new Error(`表名已存在: ${name}`);
    if (!db.categories.some((c) => c.id === table.categoryId)) {
      throw new Error(`表 ${name} 的所属分类不存在`);
    }
    const columns = normalizeColumns(table, name);
    const indexes = normalizeIndexes(table, name, columns);
    Object.assign(target, { ...clone(table), id });
    db.columns = db.columns.filter((c) => c.tableId !== id);
    db.indexes = db.indexes.filter((i) => i.tableId !== id);
    for (const c of columns) db.columns.push({ ...c, tableId: id });
    for (const i of indexes) db.indexes.push({ ...i, tableId: id });
    persistDB();
  }

  /** 删除表（一并删除其字段、索引与关联导航） */
  async removeTable(tableId: string): Promise<void> {
    const db = getDB();
    if (!db.tables.some((t) => t.id === tableId)) return;
    db.tables = db.tables.filter((t) => t.id !== tableId);
    db.columns = db.columns.filter((c) => c.tableId !== tableId);
    db.indexes = db.indexes.filter((i) => i.tableId !== tableId);
    db.navigates = db.navigates.filter(
      (n) => n.self !== tableId && n.target !== tableId && n.mappingTable !== tableId,
    );
    persistDB();
  }

  /**
   * 批量更新表位置（拖动一个或多个表卡片结束时使用；多选同动仅一次调用）
   * 先整体校验再写入：任一表不存在则抛错且不落盘（all-or-nothing），
   * 全部命中后统一写库并单次落盘。
   */
  async updateTablePos(tablePoses: UpdateTablePosDTO): Promise<void> {
    const db = getDB();
    const list = tablePoses?.tables ?? [];
    if (!list.length) return;
    for (const item of list) {
      if (!db.tables.some((t) => t.id === item.tableId)) {
        throw new Error(`表不存在: ${item.tableId}`);
      }
    }
    for (const item of list) {
      const target = db.tables.find((t) => t.id === item.tableId);
      if (!target) continue;
      target.x = Number(item.pos?.x) || 0;
      target.y = Number(item.pos?.y) || 0;
    }
    persistDB();
  }

  /* ==================== 导航 ==================== */

  /** 导航列表 */
  async getNavigates(): Promise<TableNavigate[]> {
    return clone(getDB().navigates);
  }

  /** 新增导航：两端表存在 / 类型枚举 / 属性名非空校验后写库 */
  async addNavigate(navigate: TableNavigate): Promise<void> {
    const db = getDB();
    const nav = normalizeNavigate(navigate);
    if (db.navigates.some((n) => n.id === nav.id)) throw new Error(`导航 id 已存在: ${nav.id}`);
    db.navigates.push(clone(nav));
    persistDB();
  }

  /** 更新导航：存在性 + 归一校验后整体替换 */
  async updateNavigate(navigate: TableNavigate): Promise<void> {
    const db = getDB();
    const nav = normalizeNavigate(navigate);
    const idx = db.navigates.findIndex((n) => n.id === nav.id);
    if (idx < 0) throw new Error(`导航不存在: ${nav.id}`);
    db.navigates[idx] = clone(nav);
    persistDB();
  }

  /** 删除导航（不存在时静默成功） */
  async removeNavigate(navigateId: string): Promise<void> {
    const db = getDB();
    if (!db.navigates.some((n) => n.id === navigateId)) return;
    db.navigates = db.navigates.filter((n) => n.id !== navigateId);
    persistDB();
  }

  /* ==================== 字典分类 ==================== */

  /** 字典分类列表 */
  async getDictCategories(): Promise<DictCategory[]> {
    return clone(getDB().dictCategories);
  }

  /** 新增字典分类：名称唯一，包路径 / 类名大驼峰归一后写库 */
  async addDictCategory(category: DictCategory): Promise<void> {
    const db = getDB();
    const name = requireStr(category?.name, "name", "分类名称");
    if (db.dictCategories.some((c) => c.name === name))
      throw new Error(`字典分类名称已存在: ${name}`);
    if (!category.id) throw new Error("新增字典分类必须提供 id");
    const { basePackage, className } = normalizeDictCategory(category);
    db.dictCategories.push({
      id: category.id,
      name,
      basePackage,
      className,
    });
    persistDB();
  }

  /** 更新字典分类：存在性 / 唯一性校验后逐字段覆盖 */
  async updateDictCategory(category: DictCategory): Promise<void> {
    const db = getDB();
    const id = requireStr(category?.id, "id", "字典分类ID");
    const target = db.dictCategories.find((c) => c.id === id);
    if (!target) throw new Error(`字典分类不存在: ${id}`);
    const name = requireStr(category?.name, "name", "分类名称");
    if (db.dictCategories.some((c) => c.name === name && c.id !== id))
      throw new Error(`字典分类名称已存在: ${name}`);
    const { basePackage, className } = normalizeDictCategory(category);
    target.name = name;
    target.basePackage = basePackage;
    target.className = className;
    persistDB();
  }

  /** 删除字典分类：分类下仍有字典时拒绝 */
  async removeDictCategory(categoryId: string): Promise<void> {
    const db = getDB();
    if (db.dicts.some((d) => d.categoryId === categoryId))
      throw new Error("该分类下仍有字典，无法删除（请先移动或删除其下字典）");
    db.dictCategories = db.dictCategories.filter((c) => c.id !== categoryId);
    persistDB();
  }

  /* ==================== 字典 ==================== */

  /** 字典列表 */
  async getDicts(): Promise<Dict[]> {
    return clone(getDB().dicts);
  }

  /** 新增字典：字典键唯一，值列表归一后写库 */
  async addDict(dict: Dict): Promise<void> {
    const db = getDB();
    const dictKey = requireStr(dict?.dictKey, "dictKey", "字典键");
    if (db.dicts.some((d) => d.dictKey === dictKey)) throw new Error(`字典键已存在: ${dictKey}`);
    const normalized = normalizeDict(dict, dictKey);
    if (!normalized.id) throw new Error("新增字典必须提供 id");
    db.dicts.push(clone(normalized));
    persistDB();
  }

  /** 更新字典：存在性 / 键唯一校验后整体替换 */
  async updateDict(dict: Dict): Promise<void> {
    const db = getDB();
    const id = requireStr(dict?.id, "id", "字典ID");
    const target = db.dicts.find((d) => d.id === id);
    if (!target) throw new Error(`字典不存在: ${id}`);
    const dictKey = requireStr(dict?.dictKey, "dictKey", "字典键");
    if (db.dicts.some((d) => d.dictKey === dictKey && d.id !== id))
      throw new Error(`字典键已存在: ${dictKey}`);
    Object.assign(target, clone(normalizeDict(dict, dictKey)));
    persistDB();
  }

  /** 删除字典 */
  async removeDict(dictId: string): Promise<void> {
    const db = getDB();
    db.dicts = db.dicts.filter((d) => d.id !== dictId);
    persistDB();
  }

  /* ==================== 字典分类模板 ==================== */

  /** 字典分类模板（仅一个；Template DTO 形态转换） */
  async getDictCategoryTemplate(): Promise<Template> {
    const t = getDB().dictCategoryTemplate;
    return { id: t.id, templateName: t.name, content: t.content };
  }

  /** 更新字典分类模板：id 匹配校验后覆盖名称与内容 */
  async updateDictCategoryTemplate(template: Template): Promise<void> {
    const db = getDB();
    const target = db.dictCategoryTemplate;
    if (!target || target.id !== template?.id)
      throw new Error(`字典分类模板不存在: ${template?.id}`);
    const name = requireStr(template?.templateName, "templateName", "模板名称");
    target.name = name;
    target.content = String(template.content || "");
    persistDB();
  }

  /* ==================== 表模板 ==================== */

  /** 表模板列表（Template DTO 形态转换） */
  async getTemplates(): Promise<Template[]> {
    return getDB().templates.map((t) => ({ id: t.id, templateName: t.name, content: t.content }));
  }

  /** 新增表模板：名称唯一校验后写库 */
  async addTemplate(template: Template): Promise<void> {
    const db = getDB();
    const name = requireStr(template?.templateName, "templateName", "模板名称");
    if (db.templates.some((t) => t.name === name)) throw new Error(`模板名称已存在: ${name}`);
    if (!template.id) throw new Error("新增模板必须提供 id");
    db.templates.push({ id: template.id, name, content: String(template.content || "") });
    persistDB();
  }

  /** 更新表模板：存在性 / 名称唯一校验后覆盖 */
  async updateTemplate(template: Template): Promise<void> {
    const db = getDB();
    const id = requireStr(template?.id, "id", "模板ID");
    const target = db.templates.find((t) => t.id === id);
    if (!target) throw new Error(`模板不存在: ${id}`);
    const name = requireStr(template?.templateName, "templateName", "模板名称");
    if (db.templates.some((t) => t.name === name && t.id !== id))
      throw new Error(`模板名称已存在: ${name}`);
    target.name = name;
    target.content = String(template.content || "");
    persistDB();
  }

  /** 删除表模板 */
  async removeTemplate(templateId: string): Promise<void> {
    const db = getDB();
    db.templates = db.templates.filter((t) => t.id !== templateId);
    persistDB();
  }

  /* ==================== 代码替换 ==================== */

  /** 代码替换：接收 zip 并解析计数（demo 行为，不发生真实写入） */
  async replace(zipFile: Blob): Promise<void> {
    // 异步契约：zip 解析完成后 resolve；解析失败 reject 由调用方捕获处理
    const archive = await JSZip.loadAsync(zipFile);
    const files = Object.keys(archive.files).filter((name) => !archive.files[name].dir);
    message.success(`已接收 zip 并"替换" ${files.length} 个代码文件（demo 行为，未发生真实写入）`);
  }

  /* ==================== demo 扩展 ==================== */

  /** 重置为内置演示数据（ManagerApi 契约之外，仅 demo 实现提供） */
  async resetDemo(): Promise<void> {
    resetDB();
  }

  /* ==================== 内部辅助 ==================== */

  /** 按 id 列表组装完整表（含字段与索引），返回深拷贝 */
  private assembleTables(ids: string[]): ManagerTable[] {
    const db = getDB();
    return ids
      .map((id) => db.tables.find((t) => t.id === id))
      .filter((t): t is Table => Boolean(t))
      .map((t) => ({
        ...clone(t),
        columns: db.columns
          .filter((c) => c.tableId === t.id)
          .sort((a, b) => a.sort - b.sort)
          .map((c) => ({ ...c })),
        indexes: db.indexes
          .filter((i) => i.tableId === t.id)
          .map((i) => ({ ...i, columns: [...i.columns] })),
      }));
  }
}
