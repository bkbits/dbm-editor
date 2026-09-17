/**
 * AI 仓库：AGENT 工具注册表构建
 *
 * 工具分层原则（除非明确说明，都仅操作 stores 下的运行时状态）：
 * - 读类工具：直接读各仓库的运行时状态（不调接口）
 * - 写类工具（新增/更新/删除/保存）：一律「本地先行 + 契约落盘 + 同步运行
 *   时状态」——复用各仓库既有的「本地先行 → await api → 失败回滚」事务方法，
 *   界面与 AI 走同一条路径，状态天然一致，无需会话末按域刷新
 * - 刷新职责只落在 reload / reloadDicts / reloadTemplates / reloadSettings
 *   四个读类工具上（重新拉取持久层并替换运行时状态）
 * - 危险操作（resetDemo / removeAll / genCodeReplace）先经前端弹窗确认
 *
 * AI 专属能力（AI 设置读写 / 对话 / fetch）经 AIApi，与 ManagerApi 分离。
 * 每次 send 重建注册表，捕获当次 deps 与 hooks。
 */
import { SKILLS, findSkill, skillNames } from "@/ai/skills";
import type { AiSettings } from "@/types/ai";
import type {
  Dict,
  Settings,
  TableAddPayload,
  TableNavigate,
  TableUpdatePayload,
  UpdateTablePosDTO,
} from "@/types/model";
import { DICT_TEMPLATE_ID } from "@/types/model";
import { FILE_CONTENT_CAP, generateFilesOf } from "./codegen";
import {
  NO_ARGS,
  aiSettingsSchema,
  bool,
  categorySchema,
  dictSchema,
  int,
  navigateSchema,
  obj,
  plainTool,
  settingsSchema,
  str,
  strArr,
  tableSchema,
  templateSchema,
} from "./tool-schema";
import type { AgentHooks, AgentTool, AiDeps } from "./types";

/** 深拷贝（JSON 往返）：读类工具返回运行时状态时切断 reactive 代理引用 */
function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

/** 字符串数组参数归一（非数组返回 undefined） */
function strList(v: unknown): string[] | undefined {
  return Array.isArray(v) ? v.map(String) : undefined;
}

/**
 * 构建 AGENT 工具注册表：模型元素（reload 系列 / 撤销重做 / 分类 / 表 /
 * 导航）+ 字典 + 模板（含代码生成三件套）+ 设置 + AI 设置 + fetch + 技能。
 * 每次 send 重建（捕获当次 deps 与 hooks；api prop 切换后取到新实例）。
 */
export function buildAgentTools(deps: AiDeps, hooks: AgentHooks): AgentTool[] {
  const tools: AgentTool[] = [];

  /* ==================== 模型元素基础操作 ==================== */

  tools.push(
    plainTool(
      "reload",
      "重新加载模型元素：调用 load 接口拉取最新数据，完全替换当前运行时状态（画布 / 分类 / 表 / 导航；界面数据可能已过期、或需要以最新数据为准重新执行任务时使用）",
      NO_ARGS,
      async () => {
        const model = deps.getModel();
        await model.refresh();
        return {
          reloaded: true,
          note: "模型元素已重新加载为最新数据",
          counts: {
            categories: model.categoryCount,
            tables: model.tableCount,
            navigates: model.navigateCount,
          },
        };
      },
    ),
  );
  tools.push(
    plainTool(
      "resetDemo",
      "重置为内置演示数据（危险操作：当前模型元素、字典与模板将被库内嵌样例数据覆盖写入，仅在用户明确要求时使用；执行前需经用户在界面确认）",
      NO_ARGS,
      async () => {
        const confirmed = await hooks.requestDangerConfirm(
          "重置为演示数据",
          "当前全部模型元素（分类 / 表 / 导航）、字典与模板将被内置演示数据覆盖，该操作不可撤销（设置与 AI 设置不受影响），确认继续？",
          "确认重置",
        );
        if (!confirmed) throw new Error("用户已取消重置，未修改任何数据");
        await deps.getModel().resetDemoData();
        return { reset: true, note: "已重置为内置演示数据（模型元素 / 字典 / 模板）" };
      },
    ),
  );
  tools.push(
    plainTool(
      "removeAll",
      "清空全部模型元素（危险操作：当前分类 / 表 / 导航将全部删除，不影响字典 / 模板 / 设置；执行前需经用户在界面确认）",
      NO_ARGS,
      async () => {
        const confirmed = await hooks.requestDangerConfirm(
          "清空模型元素",
          "当前全部模型元素（分类 / 表 / 导航）将被清空并提交空集合，字典 / 模板 / 设置不受影响，该操作可经 undo 撤销，确认继续？",
          "确认清空",
        );
        if (!confirmed) throw new Error("用户已取消清空，未修改任何数据");
        const model = deps.getModel();
        const history = deps.getHistory();
        const snap = model.takeSnapshot();
        history.capture(snap);
        model.applySnapshot({
          categories: [],
          tables: [],
          columns: [],
          indexes: [],
          navigates: [],
        });
        try {
          await deps.getApi().save({ categories: [], tables: [], navigates: [] });
        } catch (e) {
          model.rollback(snap);
          throw e;
        }
        return { cleared: true, note: "已清空全部模型元素（可用 undo 撤销）" };
      },
    ),
  );
  tools.push(
    plainTool(
      "saveAll",
      "全量保存模型元素：以当前运行时状态的完整快照提交（不在快照中的分类 / 表 / 导航会被删除；确认全部修改落盘时使用）",
      NO_ARGS,
      async () => {
        const model = deps.getModel();
        await model.saveAll();
        return {
          saved: true,
          counts: {
            categories: model.categoryCount,
            tables: model.tableCount,
            navigates: model.navigateCount,
          },
        };
      },
    ),
  );
  tools.push(
    plainTool(
      "undo",
      "撤销上一步操作（恢复到变更前的运行时状态并全量落盘；画布 Ctrl+Z 同源）",
      NO_ARGS,
      async () => {
        const history = deps.getHistory();
        if (!history.canUndo) return { undone: false, note: "没有可撤销的操作" };
        await history.undo();
        return { undone: true };
      },
    ),
  );
  tools.push(
    plainTool(
      "undoAll",
      "撤销所有操作：一步回到初始状态（恢复到最早一次变更之前并全量落盘）",
      NO_ARGS,
      async () => {
        const history = deps.getHistory();
        if (!history.canUndo) return { undone: false, note: "没有可撤销的操作" };
        await history.undoAll();
        return { undone: true, note: "已回到初始状态" };
      },
    ),
  );
  tools.push(
    plainTool("redo", "重做上一步被撤销的操作（恢复运行时状态并全量落盘）", NO_ARGS, async () => {
      const history = deps.getHistory();
      if (!history.canRedo) return { redone: false, note: "没有可重做的操作" };
      await history.redo();
      return { redone: true };
    }),
  );
  tools.push(
    plainTool(
      "clearHistory",
      "清空撤销 / 重做历史栈（不改变任何数据、不调用接口；确认不再需要回退时使用）",
      NO_ARGS,
      async () => {
        deps.getHistory().clear();
        return { cleared: true };
      },
    ),
  );

  /* ==================== 表分类 ==================== */

  tools.push(
    plainTool("getTableCategories", "获取全部表分类", NO_ARGS, async () =>
      clone(deps.getModel().categories),
    ),
  );
  tools.push(
    plainTool("addTableCategory", "新增表分类", categorySchema, async (a) => {
      const saved = await deps.getModel().saveCategory({
        name: String(a.name ?? ""),
        basePackage: String(a.basePackage ?? ""),
        src: String(a.src ?? ""),
      });
      return clone(saved);
    }),
  );
  tools.push(
    plainTool("updateTableCategory", "更新表分类（按 id 整体替换）", categorySchema, async (a) => {
      const saved = await deps.getModel().saveCategory({
        id: String(a.id ?? ""),
        name: String(a.name ?? ""),
        basePackage: String(a.basePackage ?? ""),
        src: String(a.src ?? ""),
      });
      return clone(saved);
    }),
  );
  tools.push(
    plainTool(
      "removeTableCategory",
      "删除表分类（分类下仍有表时拒绝）",
      obj("删除参数", { categoryId: str("分类ID") }, ["categoryId"]),
      async (a) => {
        await deps.getModel().removeCategory(String(a.categoryId));
        return { removed: true };
      },
    ),
  );

  /* ==================== 表 ==================== */

  tools.push(
    plainTool(
      "getTables",
      "获取表列表（含字段 / 索引 / 画布位置；修改前先查询真实 id 与字段名）",
      obj("筛选参数（全部缺省 = 全部表）", {
        keyword: str("关键词（模糊匹配表名 / 注释 / 类名）"),
        categoryId: str("所属分类ID"),
      }),
      async (a) => {
        const model = deps.getModel();
        const keyword = String(a.keyword ?? "")
          .trim()
          .toLowerCase();
        const categoryId = String(a.categoryId ?? "").trim();
        return model.tables
          .filter((t) => (categoryId ? t.categoryId === categoryId : true))
          .filter((t) => {
            if (!keyword) return true;
            return (
              t.tableName.toLowerCase().includes(keyword) ||
              (t.comment || "").toLowerCase().includes(keyword) ||
              (t.className || "").toLowerCase().includes(keyword)
            );
          })
          .map((t) => clone(model.managerTableOf(t.id)));
      },
    ),
  );
  tools.push(
    plainTool(
      "getTable",
      "获取指定表名的完整表信息（含字段与索引）",
      obj("查询参数", { tableName: str("表名（如 sys_user）") }, ["tableName"]),
      async (a) => {
        const model = deps.getModel();
        const t = model.tables.find((x) => x.tableName === String(a.tableName ?? ""));
        if (!t) throw new Error(`表不存在: ${a.tableName}（可用表见 getTables 结果）`);
        return clone(model.managerTableOf(t.id));
      },
    ),
  );
  tools.push(
    plainTool(
      "addTable",
      "新增表（含字段与索引；表名唯一，字段名表内唯一）",
      tableSchema,
      async (a) => {
        const tableId = await deps
          .getModel()
          .createTable(clone(a) as unknown as Omit<TableAddPayload, "id">);
        return { tableId };
      },
    ),
  );
  tools.push(
    plainTool("updateTable", "更新表（按 id 整体替换，含字段与索引）", tableSchema, async (a) => {
      await deps
        .getModel()
        .saveTable(clone(a) as unknown as Omit<TableUpdatePayload, "rawNavigates">);
      return { updated: true };
    }),
  );
  tools.push(
    plainTool(
      "removeTable",
      "删除表（一并删除其字段、索引与关联导航）",
      obj("删除参数", { tableId: str("表ID") }, ["tableId"]),
      async (a) => {
        await deps.getModel().removeTables([String(a.tableId)]);
        return { removed: true };
      },
    ),
  );
  tools.push(
    plainTool(
      "updateTablePos",
      "批量更新表位置（拖动一张或多张表卡片结束时一次提交；美化画布布局时使用）",
      obj(
        "位置载荷",
        {
          tables: {
            type: "array",
            description: "移动的表位置列表",
            items: obj("单项", {
              tableId: str("表ID"),
              pos: obj("坐标", { x: int("x坐标"), y: int("y坐标") }),
            }),
          },
        },
        ["tables"],
      ),
      async (a) => {
        const model = deps.getModel();
        const items = Array.isArray(a.tables)
          ? (a.tables as Array<{ tableId?: unknown; pos?: { x?: unknown; y?: unknown } }>)
          : [];
        if (!items.length) return { moved: 0 };
        // 本地先行：记录旧坐标，任一表不存在整体拒绝，契约失败回滚坐标
        const olds = new Map<string, { x: number; y: number }>();
        for (const item of items) {
          const t = model.tableById(String(item.tableId ?? ""));
          if (!t) throw new Error(`表不存在: ${item.tableId}`);
          olds.set(t.id, { x: t.x ?? 0, y: t.y ?? 0 });
        }
        for (const item of items) {
          const t = model.tableById(String(item.tableId ?? ""));
          if (!t) continue;
          t.x = Number(item.pos?.x) || 0;
          t.y = Number(item.pos?.y) || 0;
        }
        try {
          await deps.getApi().updateTablePos(clone(a) as unknown as UpdateTablePosDTO);
        } catch (e) {
          for (const [id, pos] of olds) {
            const t = model.tableById(id);
            if (t) {
              t.x = pos.x;
              t.y = pos.y;
            }
          }
          throw e;
        }
        return { moved: items.length };
      },
    ),
  );
  tools.push(
    plainTool(
      "importTablesFromDB",
      "从真实数据库导入表结构：读取库表定义（表 / 字段 / 索引），逐张新增表落库（导入前先 getTableCategories 选择目标分类）",
      obj("导入参数", { categoryId: str("导入到哪个表分类ID") }, ["categoryId"]),
      async (a) => {
        const categoryId = String(a.categoryId ?? "");
        const model = deps.getModel();
        if (!model.categories.some((c) => c.id === categoryId)) {
          throw new Error(`分类不存在: ${categoryId}`);
        }
        const defs = await deps.getApi().importFromDB();
        const ids = await model.importFromDB(categoryId, defs);
        return {
          imported: ids.length,
          tables: ids
            .map((id) => model.tableById(id)?.tableName)
            .filter((n): n is string => Boolean(n)),
        };
      },
    ),
  );

  /* ==================== 导航关系 ==================== */

  tools.push(
    plainTool("getNavigates", "获取全部表间导航关系", NO_ARGS, async () =>
      clone(deps.getModel().navigates),
    ),
  );
  tools.push(
    plainTool("addNavigate", "新增导航关系（两端表必须已存在）", navigateSchema, async (a) => {
      await deps.getModel().addNavigate(clone(a) as unknown as TableNavigate);
      return { added: true };
    }),
  );
  tools.push(
    plainTool("updateNavigate", "更新导航关系（按 id 整体替换）", navigateSchema, async (a) => {
      await deps.getModel().updateNavigate(clone(a) as unknown as TableNavigate);
      return { updated: true };
    }),
  );
  tools.push(
    plainTool(
      "removeNavigate",
      "删除导航关系",
      obj("删除参数", { navigateId: str("导航ID") }, ["navigateId"]),
      async (a) => {
        await deps.getModel().removeNavigate(String(a.navigateId));
        return { removed: true };
      },
    ),
  );

  /* ==================== 字典 ==================== */

  tools.push(
    plainTool(
      "reloadDicts",
      "重新加载字典：调用 getDicts 接口拉取最新字典与字典分类，完全替换当前运行时状态",
      NO_ARGS,
      async () => {
        const dict = deps.getDict();
        dict.loaded = false;
        dict.loading = false;
        await dict.init();
        return { reloaded: true, dicts: dict.dicts.length, categories: dict.categories.length };
      },
    ),
  );
  tools.push(
    plainTool(
      "saveDicts",
      "全量保存字典：以当前运行时状态的完整字典快照提交（不在快照中的字典会被删除）",
      NO_ARGS,
      async () => {
        const dict = deps.getDict();
        await deps.getApi().saveDicts(clone(dict.dicts));
        // 重载收口：以归一化后的持久层为准替换运行时状态
        dict.loaded = false;
        dict.loading = false;
        await dict.init();
        return { saved: true, dicts: dict.dicts.length };
      },
    ),
  );
  tools.push(
    plainTool("getDictCategories", "获取全部字典分类", NO_ARGS, async () =>
      clone(deps.getDict().categories),
    ),
  );
  tools.push(
    plainTool(
      "getDicts",
      "获取字典列表（含字典值）",
      obj("筛选参数（全部缺省 = 全部字典）", {
        keyword: str("关键词（模糊匹配字典键 / 标签 / 注释 / 值键 / 值标签）"),
      }),
      async (a) => {
        const keyword = String(a.keyword ?? "")
          .trim()
          .toLowerCase();
        if (!keyword) return clone(deps.getDict().dicts);
        return deps
          .getDict()
          .dicts.filter((d) => {
            const hit =
              d.dictKey.toLowerCase().includes(keyword) ||
              d.label.toLowerCase().includes(keyword) ||
              (d.comment || "").toLowerCase().includes(keyword);
            if (hit) return true;
            return d.values.some(
              (v) =>
                v.valueKey.toLowerCase().includes(keyword) ||
                v.label.toLowerCase().includes(keyword) ||
                (v.comment || "").toLowerCase().includes(keyword),
            );
          })
          .map(clone);
      },
    ),
  );
  tools.push(
    plainTool(
      "getDict",
      "获取指定字典键的字典信息（含字典值）",
      obj("查询参数", { dictKey: str("字典键（如 user_status）") }, ["dictKey"]),
      async (a) => {
        const dict = deps.getDict().dicts.find((d) => d.dictKey === String(a.dictKey ?? ""));
        if (!dict) throw new Error(`字典不存在: ${a.dictKey}（可用字典见 getDicts 结果）`);
        return clone(dict);
      },
    ),
  );
  tools.push(
    plainTool("addDict", "新增字典（含字典值；字典键唯一）", dictSchema, async (a) => {
      const saved = await deps.getDict().saveDict(clone(a) as unknown as Dict);
      return clone(saved);
    }),
  );
  tools.push(
    plainTool("updateDict", "更新字典（按 id 整体替换，含字典值）", dictSchema, async (a) => {
      await deps.getDict().saveDict(clone(a) as unknown as Dict);
      return { updated: true };
    }),
  );
  tools.push(
    plainTool(
      "removeDict",
      "删除字典",
      obj("删除参数", { dictId: str("字典ID") }, ["dictId"]),
      async (a) => {
        await deps.getDict().removeDict(String(a.dictId));
        return { removed: true };
      },
    ),
  );

  /* ==================== 模板 ==================== */

  tools.push(
    plainTool(
      "reloadTemplates",
      "重新加载模板：调用 getTemplates 接口拉取最新模板集合（含字典模板），完全替换当前运行时状态",
      NO_ARGS,
      async () => {
        const tpl = deps.getTemplate();
        tpl.loaded = false;
        tpl.loading = false;
        await tpl.init();
        return { reloaded: true, templates: tpl.templates.length };
      },
    ),
  );
  tools.push(
    plainTool(
      "saveTemplates",
      "全量保存模板：以当前运行时状态的完整模板快照提交（含字典模板；不在快照中的模板会被删除）",
      NO_ARGS,
      async () => {
        const tpl = deps.getTemplate();
        await deps.getApi().saveTemplates(tpl.templatesSnapshot());
        // 重载收口：以归一化后的持久层为准替换运行时状态
        tpl.loaded = false;
        tpl.loading = false;
        await tpl.init();
        return { saved: true, templates: tpl.templates.length };
      },
    ),
  );
  tools.push(
    plainTool(
      "getTemplates",
      "获取全部模板（含字典模板，Eta 语法；字典模板 id 固定为 tpl-dict-category）",
      NO_ARGS,
      async () => deps.getTemplate().templatesSnapshot(),
    ),
  );
  tools.push(
    plainTool(
      "getTemplate",
      "获取指定 id 的模板信息",
      obj("查询参数", { templateId: str("模板ID") }, ["templateId"]),
      async (a) => {
        const found = deps
          .getTemplate()
          .templatesSnapshot()
          .find((t) => t.id === String(a.templateId ?? ""));
        if (!found) throw new Error(`模板不存在: ${a.templateId}（可用模板见 getTemplates 结果）`);
        return found;
      },
    ),
  );
  tools.push(
    plainTool(
      "getDictTemplate",
      "获取字典模板信息（模板集合中 id 固定为 tpl-dict-category 的一条，用于按分类生成字典代码）",
      NO_ARGS,
      async () => {
        const found = deps
          .getTemplate()
          .templatesSnapshot()
          .find((t) => t.id === DICT_TEMPLATE_ID);
        if (!found)
          throw new Error("字典模板缺失（id 应为 tpl-dict-category），请重置演示数据恢复");
        return found;
      },
    ),
  );
  tools.push(
    plainTool(
      "addTemplate",
      "新增模板（字典模板 id 固定且始终存在，新增同名走更新）",
      templateSchema,
      async (a) => {
        const saved = await deps.getTemplate().saveTemplate({
          id: "",
          name: String(a.templateName ?? ""),
          content: String(a.content ?? ""),
        });
        return clone(saved);
      },
    ),
  );
  tools.push(
    plainTool("updateTemplate", "更新模板（按 id 整体替换）", templateSchema, async (a) => {
      await deps.getTemplate().saveTemplate({
        id: String(a.id ?? ""),
        name: String(a.templateName ?? ""),
        content: String(a.content ?? ""),
      });
      return { updated: true };
    }),
  );
  tools.push(
    plainTool(
      "removeTemplate",
      "删除模板（字典模板为固定模板不可删除）",
      obj("删除参数", { templateId: str("模板ID") }, ["templateId"]),
      async (a) => {
        await deps.getTemplate().removeTemplate(String(a.templateId));
        return { removed: true };
      },
    ),
  );

  /* ---------- 代码生成 / 代码替换（合成能力） ---------- */

  /** 代码生成三件套共用参数（genCode 为单模板单表，其余按范围） */
  const codegenParams = obj("生成范围（全部缺省 = 全部表 + 全部模板 + 生成字典分类代码）", {
    tableNames: strArr("目标表名列表（缺省 = 全部表）"),
    templateNames: strArr("参与的表模板名称列表（缺省 = 全部模板；表级启用模板配置仍生效）"),
    dictEnabled: bool("是否生成字典分类模板代码（默认 true）"),
  });

  /** 生成文件 → 确认弹窗行 / 文件清单行（共用形态） */
  const toFileRows = (files: Awaited<ReturnType<typeof generateFilesOf>>) =>
    files.map((f) => ({
      templateName: f.templateName,
      tableName: f.tableName,
      fileName: f.fileName,
      filePath: f.filePath,
      size: f.content.length,
    }));

  /** zip 下载文件名（与手动代码生成保持同风格：dbm-codegen-时间戳.zip） */
  function zipFileName(): string {
    const t = new Date();
    /** 两位补零（时间戳各片段） */
    const p = (n: number) => String(n).padStart(2, "0");
    return `dbm-codegen-${t.getFullYear()}${p(t.getMonth() + 1)}${p(t.getDate())}-${p(t.getHours())}${p(t.getMinutes())}${p(t.getSeconds())}.zip`;
  }

  tools.push(
    plainTool(
      "genCode",
      "单模板代码生成：用指定模板为指定表生成一份代码，返回生成的代码内容（查看单个产物 / 校验模板效果时使用，不打包不写回）",
      obj("生成参数", { templateName: str("模板名称"), tableName: str("表名") }, [
        "templateName",
        "tableName",
      ]),
      async (a) => {
        const [tplStore, model] = [deps.getTemplate(), deps.getModel()];
        await Promise.all([tplStore.init(), model.init()]);
        const tpl = tplStore
          .templatesSnapshot()
          .find((t) => t.templateName === String(a.templateName ?? ""));
        if (!tpl) {
          throw new Error(`模板不存在: ${a.templateName}（可用模板见 getTemplates 结果）`);
        }
        const table = model.tables.find((t) => t.tableName === String(a.tableName ?? ""));
        if (!table) throw new Error(`表不存在: ${a.tableName}（可用表见 getTables 结果）`);
        const out = tplStore.renderFor({ name: tpl.templateName, content: tpl.content }, table.id);
        if (!out) throw new Error(`表数据缺失: ${a.tableName}`);
        if (out.error)
          throw new Error(`模板渲染失败（${tpl.templateName}/${a.tableName}）：${out.error}`);
        return {
          templateName: tpl.templateName,
          tableName: table.tableName,
          fileName: out.fileName,
          filePath: out.filePath,
          content: out.result || "",
        };
      },
    ),
  );
  tools.push(
    plainTool(
      "genCodeZip",
      "代码生成并打包：按范围用模板生成代码产物，自动打包为 zip 并在界面调用记录旁提供下载按钮，返回文件清单（templateName / tableName / fileName / filePath / size）。不写回源码。",
      obj("生成参数", {
        ...(codegenParams.properties as Record<string, unknown>),
        includeContent: bool(
          "是否在结果中附带每个文件的生成内容（默认 false，内容较大时谨慎开启）",
        ),
      }),
      async (a, ctx) => {
        const files = await generateFilesOf(deps, a);
        const blob = await deps.getTemplate().buildZip(files);
        hooks.registerZip(ctx.callId, blob, zipFileName(), files.length);
        return {
          total: files.length,
          files: files.map((f) => ({
            templateName: f.templateName,
            tableName: f.tableName,
            fileName: f.fileName,
            filePath: f.filePath,
            size: f.content.length,
            ...(a.includeContent
              ? {
                  content:
                    f.content.length > FILE_CONTENT_CAP
                      ? `${f.content.slice(0, FILE_CONTENT_CAP)}\n…（内容过长已截断，共 ${f.content.length} 字符）`
                      : f.content,
                }
              : {}),
          })),
          zip: {
            fileName: zipFileName(),
            size: blob.size,
            note: "已打包为 zip 并在界面调用记录中提供下载按钮，用户可自行下载",
          },
        };
      },
    ),
  );
  tools.push(
    plainTool(
      "genCodeReplace",
      "代码生成并替换源码：按范围用模板生成代码产物，先向用户列出将被覆盖的文件清单并等待确认，确认后经 replace 接口写回对应源码文件（危险操作：会覆盖目标源码文件，仅在用户明确要求时使用；用户取消则本次不执行）。",
      codegenParams,
      async (a) => {
        const files = await generateFilesOf(deps, a);
        if (!files.length) throw new Error("未生成任何文件，请检查表与模板范围");
        const rows = toFileRows(files);
        const confirmed = await hooks.requestReplaceConfirm(rows);
        if (!confirmed) throw new Error("用户已取消本次代码替换，未写回任何文件");
        const zip = await deps.getTemplate().buildZip(files);
        await deps.getApi().replace(zip);
        return {
          replaced: files.length,
          files: rows,
        };
      },
    ),
  );

  /* ==================== 设置 ==================== */

  tools.push(
    plainTool(
      "getSettings",
      "获取当前设置（索引类型列表 / 列类型映射规则 / 代码生成配置 / 字段约定）",
      NO_ARGS,
      async () => {
        const settings = deps.getSettings();
        await settings.init();
        return settings.snapshot();
      },
    ),
  );
  tools.push(
    plainTool(
      "setSettings",
      "保存设置（整体替换语义；索引类型至少一个，正则需合法；保存后同时替换运行时状态）",
      settingsSchema,
      async (a) => {
        await deps.getSettings().save(clone(a) as unknown as Settings);
        return { saved: true };
      },
    ),
  );
  tools.push(
    plainTool(
      "reloadSettings",
      "重新加载设置：调用 getSettings 接口并替换当前运行时状态",
      NO_ARGS,
      async () => {
        const settings = deps.getSettings();
        settings.loaded = false;
        settings.loading = false;
        await settings.init();
        return { reloaded: true };
      },
    ),
  );

  /* ==================== AI 设置 ==================== */

  tools.push(
    plainTool(
      "getAISettings",
      "获取当前 AI 设置（供应商列表 / 每个供应商的模型 / 默认模型 / 全局规则 / 轮数上限）",
      NO_ARGS,
      async () => clone(deps.getAI().aiSettings),
    ),
  );
  tools.push(
    plainTool(
      "setAISettings",
      "保存 AI 设置（整体替换语义；入参须为 getAISettings 结果修改后的完整快照；供应商连接信息变更会影响后续对话）",
      aiSettingsSchema,
      async (a) => {
        await deps.getAI().saveSettings(clone(a) as unknown as AiSettings);
        return { saved: true };
      },
    ),
  );
  tools.push(
    plainTool(
      "reloadAISettings",
      "重新加载 AI 设置：调用 getAISettings 接口并替换当前运行时状态",
      NO_ARGS,
      async () => {
        const ai = deps.getAI();
        ai.loaded = false;
        ai.loading = false;
        await ai.init();
        return { reloaded: true, providers: ai.aiSettings.providers.length };
      },
    ),
  );
  tools.push(
    plainTool(
      "setCurrentModel",
      "设置当前 AI 模型（仅运行时状态不持久化，重启后回落 AI 设置中的默认模型；用于切换对话所用模型）",
      obj("模型参数（两项都缺省 = 重置为 AI 设置中的默认模型）", {
        providerId: str("供应商ID（见 getAISettings 的 providers）"),
        modelId: str("模型 id（见该供应商的 models）"),
      }),
      async (a) => {
        const ai = deps.getAI();
        const providerId = String(a.providerId ?? "").trim();
        const modelId = String(a.modelId ?? "").trim();
        if (!providerId || !modelId) {
          ai.selectedModel = null;
          const cur = ai.currentModelPair;
          return {
            reset: true,
            ...(cur ? { current: `${cur.provider.name}/${cur.model.name || cur.model.id}` } : {}),
          };
        }
        const info = ai.setCurrentModel(providerId, modelId);
        return { current: `${info.providerName}/${info.modelName}`, ...info };
      },
    ),
  );

  /* ==================== 其它扩展 ==================== */

  tools.push(
    plainTool(
      "fetch",
      "发起网络请求获取数据（GET / POST 等；用于查询文档、调用外部接口等场景；响应体超长会截断）",
      obj(
        "请求参数",
        {
          url: str("完整请求地址（http:// 或 https:// 开头）"),
          method: str("请求方法：'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD'（缺省 GET）"),
          headers: obj("附加请求头", {}),
          body: str("请求体（原样发送，通常为 JSON 文本；GET 留空）"),
        },
        ["url"],
      ),
      async (a) => {
        const raw = String(a.method ?? "GET").toUpperCase();
        const method = (["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"] as const).includes(
          raw as "GET",
        )
          ? (raw as "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD")
          : "GET";
        const headers = (a.headers && typeof a.headers === "object" ? a.headers : {}) as Record<
          string,
          string
        >;
        return deps.getAIApi().fetch({
          url: String(a.url ?? ""),
          ...(method !== "GET" ? { method } : {}),
          ...(Object.keys(headers).length ? { headers } : {}),
          ...(method !== "GET" && a.body != null && String(a.body) !== ""
            ? { body: String(a.body) }
            : {}),
        });
      },
    ),
  );

  /* ---------- 技能加载（内置技能文档；单独占用一轮工具调用） ---------- */
  tools.push({
    kind: "skill",
    spec: {
      type: "function",
      function: {
        name: "skill",
        description: `加载内置技能文档，获取领域操作规范与知识（单独占用一轮工具调用；执行对应领域任务前按需加载）：${SKILLS.map((s) => `${s.name}（${s.title}——${s.description}，技能文件：${s.parts.map((p) => p.key).join(" / ")}）`).join("；")}`,
        parameters: obj(
          "加载参数",
          {
            skill: str(`技能名称：${skillNames().join(" / ")}`),
            parts: strArr(
              "要加载的技能文件列表（缺省 = 全部部分；只加载任务相关的部分可节省上下文）",
            ),
          },
          ["skill"],
        ),
      },
    },
    /** 执行器：按技能名与可选 parts 载入内置技能文档（未知技能 / 部分抛错；不改仓库数据） */
    invoke: async (a) => {
      const skill = findSkill(String(a.skill ?? ""));
      if (!skill) {
        throw new Error(`未知技能：${a.skill}（可用技能：${skillNames().join(" / ")}）`);
      }
      const wanted = strList(a.parts)?.length
        ? strList(a.parts)!
            .map((p) => p.trim().toLowerCase())
            .filter(Boolean)
        : [];
      const chosen = wanted.length
        ? skill.parts.filter((p) => wanted.includes(p.key))
        : skill.parts;
      if (!chosen.length) {
        throw new Error(
          `技能 ${skill.name} 不存在技能文件：${wanted.join("、")}（可用部分：${skill.parts.map((p) => p.key).join(" / ")}）`,
        );
      }
      return {
        skill: skill.name,
        title: skill.title,
        loadedParts: chosen.map((p) => ({ key: p.key, title: p.title })),
        content: chosen.map((p) => `## ${p.title}\n${p.content}`).join("\n\n"),
        note: `技能「${skill.title}」已加载，请严格按文档中的规范执行任务`,
      };
    },
  });

  return tools;
}
