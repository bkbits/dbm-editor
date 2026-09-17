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
 * - demo/ai/：AIApi 的三协议流式对话客户端（openai-chat / openai-responses /
 *   anthropic-messages，经 DemoAIApi 分派，不再挂在 ManagerApi 上）
 *
 * 契约语义：
 * - 细粒度方法（addXxx/updateXxx/removeXxx/updateTablePos）即时写库并落盘
 * - save(modelElements) 全量替换：整个集合校验通过后一次性写入（不在
 *   列表中的分类/表/导航被删除）；saveDicts / saveTemplates 同为全量替换
 * - removeTable 一并删除其字段、索引与关联导航
 * - 模板集合含字典模板（id 固定 tpl-dict-category）：getTemplates 合并返回，
 *   saveTemplates 拆分存储（演示库内部仍以独立字段保存，对外无感知）
 * - 所有方法经 Proxy 包装，使用统一日志器（src/log/Logger.ts）打印入参与
 *   返回（debug 级，异步方法等落定后打印 resolved 值）、抛错（error 级）；
 *   Logger.setLevel 可运行时调整输出级别
 */
import JSZip from "jszip";
import { message } from "antdv-next";
import type { ManagerApi } from "@/types/manager";
import type {
  DBTable,
  Dict,
  DictCategory,
  ManagerTable,
  ModelElements,
  Settings,
  Table,
  TableCategory,
  TableColumn,
  TableIndex,
  TableNavigate,
  Template,
  TypeMapping,
  UpdateTablePosDTO,
} from "@/types/model";
import { DICT_TEMPLATE_ID } from "@/types/model";
import { getDB, persistDB } from "@/mock/db";
import { SEED_DB_TABLES } from "@/mock/seed";
import { AUDIT_FIELD_ROLES, normalizeFieldConventions } from "@/utils/fieldConvention";
import {
  assertRegex,
  clone,
  normalizeColumns,
  normalizeDict,
  normalizeDictCategory,
  normalizeIndexes,
  normalizeNavigate,
  normalizeOptionSettings,
  requireStr,
  withCallLogging,
} from "./demo/helpers";

/** 内部模板形态（演示库存储形态：name 即 templateName） */
type InternalTemplate = { id: string; name: string; content: string };

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
  async setSettings(settings: Settings): Promise<void> {
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

  /* ==================== 数据库导入 ==================== */

  /** 返回内置模拟真实库表结构（正式实现对接真实数据库） */
  async importFromDB(): Promise<DBTable[]> {
    // 演示实现：返回内置模拟真实库表结构（正式实现对接真实数据库）
    return clone(SEED_DB_TABLES);
  }

  /* ==================== 模型全量加载 / 保存 ==================== */

  /** 全量加载：分类 + 完整表（含字段/索引，深拷贝）+ 导航 */
  async load(): Promise<ModelElements> {
    const db = getDB();
    return {
      categories: clone(db.categories),
      tables: this.assembleTables(db.tables.map((t) => t.id)),
      navigates: clone(db.navigates),
    };
  }

  /**
   * 全量保存（替换语义）：整个集合校验通过后一次性写入——不在入参中的
   * 分类 / 表 / 导航会被删除。校验沿用细粒度方法的同一套归一规则
   * （表名字段索引唯一、表引用分类存在、导航两端表在集合内等），
   * 任一校验失败整体拒绝（不落盘）。
   */
  async save(modelElements: ModelElements): Promise<void> {
    const db = getDB();
    /* ---- 分类：名称唯一、id 唯一、必填项校验 ---- */
    const categories: TableCategory[] = [];
    const catIds = new Set<string>();
    for (const c of modelElements?.categories || []) {
      const name = requireStr(c?.name, "name", "分类名称");
      requireStr(c?.basePackage, "basePackage", "基础包路径");
      if (!c.id) throw new Error("分类必须提供 id");
      if (catIds.has(c.id)) throw new Error(`分类 id 重复: ${c.id}`);
      if (categories.some((x) => x.name === name)) throw new Error(`分类名称已存在: ${name}`);
      catIds.add(c.id);
      categories.push(clone(c));
    }

    /* ---- 表：id / 表名唯一、分类存在、字段与索引归一 ---- */
    const tables: Table[] = [];
    const columns: TableColumn[] = [];
    const indexes: TableIndex[] = [];
    const tableIds = new Set<string>();
    for (const t of modelElements?.tables || []) {
      const name = requireStr(t?.tableName, "tableName", "表名");
      if (tables.some((x) => x.tableName === name)) throw new Error(`表名已存在: ${name}`);
      if (!t.id) throw new Error("表必须提供 id");
      if (tableIds.has(t.id)) throw new Error(`表 id 重复: ${t.id}`);
      if (!catIds.has(t.categoryId)) throw new Error(`表 ${name} 的所属分类不存在`);
      tableIds.add(t.id);
      const normColumns = normalizeColumns(t, name);
      const normIndexes = normalizeIndexes(t, name, normColumns);
      const { columns: _c, indexes: _i, ...meta } = t;
      tables.push({ ...clone(meta), id: t.id });
      columns.push(...normColumns);
      indexes.push(...normIndexes);
    }

    /* ---- 导航：两端表（含中间映射表）须在集合内、类型合法 ---- */
    const navigates: TableNavigate[] = [];
    for (const rawNav of modelElements?.navigates || []) {
      const nav = clone(rawNav);
      if (!nav.id) throw new Error("导航必须提供 id");
      requireStr(nav.selfPropertyName, "selfPropertyName", "self 属性名");
      requireStr(nav.targetPropertyName, "targetPropertyName", "target 属性名");
      if (!tableIds.has(nav.self) || !tableIds.has(nav.target)) {
        throw new Error(`导航 ${nav.id} 的两端表不在集合内（self/target 需为集合中的表 id）`);
      }
      if (nav.mappingTable && !tableIds.has(nav.mappingTable)) {
        throw new Error(`导航 ${nav.id} 的中间映射表不在集合内`);
      }
      if (!["11", "1N", "N1", "NN"].includes(nav.type)) {
        throw new Error(`导航 ${nav.id} 的类型无效: ${nav.type}`);
      }
      if (navigates.some((n) => n.id === nav.id)) throw new Error(`导航 id 重复: ${nav.id}`);
      navigates.push(nav);
    }

    db.categories = categories;
    db.tables = tables;
    db.columns = columns;
    db.indexes = indexes;
    db.navigates = navigates;
    persistDB();
  }

  /* ==================== 表分类 ==================== */

  /** 表分类列表 */
  async getTableCategories(): Promise<TableCategory[]> {
    return clone(getDB().categories);
  }

  /** 新增表分类：名称唯一、必填项校验后写库落盘 */
  async addTableCategory(category: TableCategory): Promise<void> {
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

  /** 更新表分类：存在性与名称唯一校验后整体覆盖 */
  async updateTableCategory(category: TableCategory): Promise<void> {
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

  /** 删除表分类：分类下仍有表时拒绝 */
  async removeTableCategory(categoryId: string): Promise<void> {
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

  /**
   * 替换保存字典：字典键全集合唯一、值列表归一后整体写入——
   * 不在入参中的字典会被删除（入参须为完整快照）。
   */
  async saveDicts(dicts: Dict[]): Promise<void> {
    const db = getDB();
    const list: Dict[] = [];
    const seenKeys = new Set<string>();
    for (const d of Array.isArray(dicts) ? dicts : []) {
      const dictKey = requireStr(d?.dictKey, "dictKey", "字典键");
      if (seenKeys.has(dictKey)) throw new Error(`字典键已存在: ${dictKey}`);
      seenKeys.add(dictKey);
      if (!d.id) throw new Error("字典必须提供 id");
      if (list.some((x) => x.id === d.id)) throw new Error(`字典 id 重复: ${d.id}`);
      const normalized = normalizeDict(d, dictKey);
      // 值的 dictId 归一为所属字典 id（快照内自洽）
      for (const v of normalized.values) v.dictId = d.id;
      list.push({ ...normalized, id: d.id });
    }
    db.dicts = list;
    persistDB();
  }

  /** 新增字典：字典键唯一，值列表归一后写库 */
  async addDict(dict: Dict): Promise<void> {
    const db = getDB();
    const dictKey = requireStr(dict?.dictKey, "dictKey", "字典键");
    if (db.dicts.some((d) => d.dictKey === dictKey)) throw new Error(`字典键已存在: ${dictKey}`);
    const normalized = normalizeDict(dict, dictKey);
    if (!normalized.id) throw new Error("新增字典必须提供 id");
    db.dicts.push({ ...clone(normalized), id: dict.id });
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

  /* ==================== 模板（集合含字典模板） ==================== */

  /** 演示库内部模板集合 → 契约 Template 形态（name → templateName） */
  private toTemplateDto(t: InternalTemplate): Template {
    return { id: t.id, templateName: t.name, content: t.content };
  }

  /** 模板列表（合并表模板与字典模板，字典模板排在末尾） */
  async getTemplates(): Promise<Template[]> {
    const db = getDB();
    return [...db.templates, db.dictCategoryTemplate].map((t) => this.toTemplateDto(t));
  }

  /**
   * 替换保存模板：名称全集合唯一校验后整体写入——不在列表中的模板会被删除。
   * 入参须为完整快照且必须包含字典模板（id 固定 tpl-dict-category），
   * 漏带字典模板视为不完整快照直接拒绝（防误删固定模板）。
   */
  async saveTemplates(templates: Template[]): Promise<void> {
    const db = getDB();
    const list: Template[] = Array.isArray(templates) ? templates : [];
    if (!list.some((t) => t?.id === DICT_TEMPLATE_ID)) {
      throw new Error("模板快照必须包含字典模板（id 为 tpl-dict-category）");
    }
    const seenIds = new Set<string>();
    const seenNames = new Set<string>();
    const tableTemplates: InternalTemplate[] = [];
    let dictTemplate: InternalTemplate | null = null;
    for (const t of list) {
      const name = requireStr(t?.templateName, "templateName", "模板名称");
      if (!t.id) throw new Error("模板必须提供 id");
      if (seenIds.has(t.id)) throw new Error(`模板 id 重复: ${t.id}`);
      if (seenNames.has(name)) throw new Error(`模板名称已存在: ${name}`);
      seenIds.add(t.id);
      seenNames.add(name);
      if (t.id === DICT_TEMPLATE_ID) {
        dictTemplate = { id: DICT_TEMPLATE_ID, name, content: String(t.content || "") };
      } else {
        tableTemplates.push({ id: t.id, name, content: String(t.content || "") });
      }
    }
    db.templates = tableTemplates;
    db.dictCategoryTemplate = dictTemplate!;
    persistDB();
  }

  /** 获取指定 id 的模板（在合并集合中查找） */
  async getTemplate(templateId: string): Promise<Template> {
    const db = getDB();
    const all: InternalTemplate[] = [...db.templates, db.dictCategoryTemplate];
    const found = all.find((t) => t.id === templateId);
    if (!found) throw new Error(`模板不存在: ${templateId}`);
    return this.toTemplateDto(found);
  }

  /** 获取字典模板（id 固定 tpl-dict-category，用于按分类生成字典代码） */
  async getDictTemplate(): Promise<Template> {
    const t = getDB().dictCategoryTemplate;
    if (!t || t.id !== DICT_TEMPLATE_ID) {
      throw new Error("字典模板缺失（id 应为 tpl-dict-category），请重置演示数据恢复");
    }
    return this.toTemplateDto(t);
  }

  /** 新增模板：名称唯一校验后写库 */
  async addTemplate(template: Template): Promise<void> {
    const db = getDB();
    const name = requireStr(template?.templateName, "templateName", "模板名称");
    const all: InternalTemplate[] = [...db.templates, db.dictCategoryTemplate];
    if (all.some((t) => t.name === name)) throw new Error(`模板名称已存在: ${name}`);
    if (!template.id) throw new Error("新增模板必须提供 id");
    if (all.some((t) => t.id === template.id)) throw new Error(`模板 id 已存在: ${template.id}`);
    if (template.id === DICT_TEMPLATE_ID) {
      // 字典模板 id 固定且始终存在：走更新语义
      db.dictCategoryTemplate = {
        id: DICT_TEMPLATE_ID,
        name,
        content: String(template.content || ""),
      };
    } else {
      db.templates.push({ id: template.id, name, content: String(template.content || "") });
    }
    persistDB();
  }

  /** 更新模板：存在性 / 名称唯一校验后覆盖 */
  async updateTemplate(template: Template): Promise<void> {
    const db = getDB();
    const id = requireStr(template?.id, "id", "模板ID");
    const name = requireStr(template?.templateName, "templateName", "模板名称");
    if (id === DICT_TEMPLATE_ID) {
      const target = db.dictCategoryTemplate;
      if (!target || target.id !== id) throw new Error(`字典模板不存在: ${id}`);
      if (db.templates.some((t) => t.name === name)) throw new Error(`模板名称已存在: ${name}`);
      target.name = name;
      target.content = String(template.content || "");
      persistDB();
      return;
    }
    const target = db.templates.find((t) => t.id === id);
    if (!target) throw new Error(`模板不存在: ${id}`);
    if (
      db.templates.some((t) => t.name === name && t.id !== id) ||
      db.dictCategoryTemplate.name === name
    )
      throw new Error(`模板名称已存在: ${name}`);
    target.name = name;
    target.content = String(template.content || "");
    persistDB();
  }

  /** 删除模板（字典模板固定存在不可删除） */
  async removeTemplate(templateId: string): Promise<void> {
    const db = getDB();
    if (templateId === DICT_TEMPLATE_ID) {
      throw new Error("字典模板为固定模板（id 为 tpl-dict-category），不可删除");
    }
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
