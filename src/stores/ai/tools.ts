/**
 * AI 仓库：AGENT 工具注册表构建
 * （ManagerApi 全部能力（去除 AI 设置与 chatComplete 两项，replace 为 zip 二进制
 *   参数不可 JSON 化、由代码替换工具承担）+ 代码生成 + 代码替换 + 技能加载；
 *   每次 send 重建，捕获当次 deps 与 hooks）
 */
import { errorMessageOf } from "@/api/manager-api";
import { SKILLS, findSkill, skillNames } from "@/ai/skills";
import type { UpdateTablePosDTO } from "@/types/model";
import { FILE_CONTENT_CAP, generateFilesOf } from "./codegen";
import {
  NO_ARGS,
  bool,
  categorySchema,
  dictCategorySchema,
  dictSchema,
  int,
  navigateSchema,
  obj,
  objectTool,
  plainTool,
  settingsSchema,
  str,
  strArr,
  tableSchema,
  templateSchema,
} from "./tool-schema";
import type { AgentHooks, AgentTool, AiDeps } from "./types";

/**
 * 构建 AGENT 工具注册表：ManagerApi 全部能力（去除 AI 设置与 chatComplete；
 * replace 为 zip 二进制参数不可 JSON 化，由代码替换工具承担）+ 代码生成 + 代码替换。
 * 每次 send 重建（捕获当次 deps 与 hooks；api prop 切换后取到新实例，resetDemo 按需注册）。
 */
export function buildAgentTools(deps: AiDeps, hooks: AgentHooks): AgentTool[] {
  const api = deps.getApi();
  const tools: AgentTool[] = [];

  /* ---------- 设置 ---------- */
  tools.push(
    plainTool(
      "getSettings",
      "获取应用设置（索引类型列表 / 列类型映射规则 / 代码生成配置）",
      NO_ARGS,
      [],
      async () => api.getSettings(),
    ),
  );
  tools.push(
    objectTool(
      "saveSettings",
      "保存应用设置（整体替换语义；索引类型至少一个，正则需合法）",
      settingsSchema,
      ["settings"],
      "saveSettings",
      deps,
    ),
  );
  tools.push(
    plainTool(
      "importFromDB",
      "从真实数据库读取表结构（返回可导入的表 / 字段 / 索引定义）",
      NO_ARGS,
      [],
      async () => api.importFromDB(),
    ),
  );

  /* ---------- 模型全量 ---------- */
  tools.push(
    plainTool("load", "加载完整模型（分类 / 表 / 导航关系一次性返回）", NO_ARGS, [], async () =>
      api.load(),
    ),
  );
  tools.push(
    plainTool("save", "全量保存模型（确认全部修改落盘时使用）", NO_ARGS, [], async () =>
      api.save(),
    ),
  );
  tools.push(
    plainTool(
      "refresh",
      "刷新数据：重新加载画布模型 / 字典 / 模板 / 应用设置（界面数据可能已过期、用户要求刷新、或需要以最新数据为准重新执行任务时使用）",
      NO_ARGS,
      [],
      async () => {
        const [modelStore, dictStore, tplStore, settingsStore] = [
          deps.getModel(),
          deps.getDict(),
          deps.getTemplate(),
          deps.getSettings(),
        ];
        const errors: string[] = [];
        await Promise.all([
          modelStore.refresh().catch((e: unknown) => errors.push(`画布：${errorMessageOf(e)}`)),
          (async () => {
            dictStore.loaded = false;
            dictStore.loading = false;
            await dictStore.init().catch((e: unknown) => errors.push(`字典：${errorMessageOf(e)}`));
          })(),
          (async () => {
            tplStore.loaded = false;
            tplStore.loading = false;
            await tplStore.init().catch((e: unknown) => errors.push(`模板：${errorMessageOf(e)}`));
          })(),
          (async () => {
            settingsStore.loaded = false;
            settingsStore.loading = false;
            await settingsStore
              .init()
              .catch((e: unknown) => errors.push(`设置：${errorMessageOf(e)}`));
          })(),
        ]);
        return errors.length
          ? { refreshed: true, partial: true, errors }
          : { refreshed: true, note: "画布 / 字典 / 模板 / 设置已重新加载为最新数据" };
      },
    ),
  );

  /* ---------- 技能加载（内置技能文档；单独占用一轮工具调用） ---------- */
  tools.push({
    kind: "skill",
    spec: {
      type: "function",
      function: {
        name: "loadSkill",
        description: `加载内置技能文档，获取领域操作规范与知识（单独占用一轮工具调用；执行对应领域任务前按需加载）：${SKILLS.map((s) => `${s.name}（${s.title}——${s.description}，部分：${s.parts.map((p) => p.key).join(" / ")}）`).join("；")}`,
        parameters: obj(
          "加载参数",
          {
            skill: str(`技能名：${skillNames().join(" / ")}`),
            parts: strArr("要加载的部分列表（缺省 = 全部部分；只加载任务相关的部分可节省上下文）"),
          },
          ["skill"],
        ),
      },
    },
    domains: [],
    /** 执行器：按技能名与可选 parts 载入内置技能文档（未知技能 / 部分抛错；不改仓库数据） */
    invoke: async (a) => {
      const skill = findSkill(String(a.skill ?? ""));
      if (!skill) {
        throw new Error(`未知技能：${a.skill}（可用技能：${skillNames().join(" / ")}）`);
      }
      const wanted = Array.isArray(a.parts)
        ? a.parts.map((p) => String(p).trim().toLowerCase()).filter(Boolean)
        : [];
      const chosen = wanted.length
        ? skill.parts.filter((p) => wanted.includes(p.key))
        : skill.parts;
      if (!chosen.length) {
        throw new Error(
          `技能 ${skill.name} 不存在部分：${wanted.join("、")}（可用部分：${skill.parts.map((p) => p.key).join(" / ")}）`,
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

  /* ---------- 分类 ---------- */
  tools.push(
    plainTool("getCategories", "获取全部表分类", NO_ARGS, [], async () => api.getCategories()),
  );
  tools.push(
    objectTool("addCategory", "新增表分类", categorySchema, ["model"], "addCategory", deps),
  );
  tools.push(
    objectTool(
      "updateCategory",
      "更新表分类（按 id 整体替换）",
      categorySchema,
      ["model"],
      "updateCategory",
      deps,
    ),
  );
  tools.push(
    plainTool(
      "removeCategory",
      "删除表分类（分类下仍有表时拒绝）",
      obj("删除参数", { categoryId: str("分类ID") }, ["categoryId"]),
      ["model"],
      async (a) => api.removeCategory(String(a.categoryId)),
    ),
  );

  /* ---------- 表 ---------- */
  tools.push(
    plainTool(
      "getTables",
      "获取全部表（含字段 / 索引 / 画布位置；修改前先查询真实 id 与字段名）",
      NO_ARGS,
      [],
      async () => api.getTables(),
    ),
  );
  tools.push(
    objectTool(
      "addTable",
      "新增表（含字段与索引；表名唯一，字段名表内唯一）",
      tableSchema,
      ["model"],
      "addTable",
      deps,
    ),
  );
  tools.push(
    objectTool(
      "updateTable",
      "更新表（按 id 整体替换，含字段与索引）",
      tableSchema,
      ["model"],
      "updateTable",
      deps,
    ),
  );
  tools.push(
    plainTool(
      "removeTable",
      "删除表（一并删除其字段、索引与关联导航）",
      obj("删除参数", { tableId: str("表ID") }, ["tableId"]),
      ["model"],
      async (a) => api.removeTable(String(a.tableId)),
    ),
  );
  tools.push(
    plainTool(
      "updateTablePos",
      "批量更新表位置（拖动结束落点保存）",
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
      ["model"],
      async (a) => api.updateTablePos(a as unknown as UpdateTablePosDTO),
    ),
  );

  /* ---------- 导航 ---------- */
  tools.push(
    plainTool("getNavigates", "获取全部表间导航关系", NO_ARGS, [], async () => api.getNavigates()),
  );
  tools.push(
    objectTool(
      "addNavigate",
      "新增导航关系（两端表必须已存在）",
      navigateSchema,
      ["model"],
      "addNavigate",
      deps,
    ),
  );
  tools.push(
    objectTool(
      "updateNavigate",
      "更新导航关系（按 id 整体替换）",
      navigateSchema,
      ["model"],
      "updateNavigate",
      deps,
    ),
  );
  tools.push(
    plainTool(
      "removeNavigate",
      "删除导航关系",
      obj("删除参数", { navigateId: str("导航ID") }, ["navigateId"]),
      ["model"],
      async (a) => api.removeNavigate(String(a.navigateId)),
    ),
  );

  /* ---------- 字典分类 ---------- */
  tools.push(
    plainTool("getDictCategories", "获取全部字典分类", NO_ARGS, [], async () =>
      api.getDictCategories(),
    ),
  );
  tools.push(
    objectTool(
      "addDictCategory",
      "新增字典分类",
      dictCategorySchema,
      ["dict"],
      "addDictCategory",
      deps,
    ),
  );
  tools.push(
    objectTool(
      "updateDictCategory",
      "更新字典分类（按 id 整体替换）",
      dictCategorySchema,
      ["dict"],
      "updateDictCategory",
      deps,
    ),
  );
  tools.push(
    plainTool(
      "removeDictCategory",
      "删除字典分类（分类下仍有字典时拒绝）",
      obj("删除参数", { categoryId: str("字典分类ID") }, ["categoryId"]),
      ["dict"],
      async (a) => api.removeDictCategory(String(a.categoryId)),
    ),
  );

  /* ---------- 字典 ---------- */
  tools.push(
    plainTool("getDicts", "获取全部字典（含字典值）", NO_ARGS, [], async () => api.getDicts()),
  );
  tools.push(
    objectTool(
      "addDict",
      "新增字典（含字典值；字典键唯一）",
      dictSchema,
      ["dict"],
      "addDict",
      deps,
    ),
  );
  tools.push(
    objectTool(
      "updateDict",
      "更新字典（按 id 整体替换，含字典值）",
      dictSchema,
      ["dict"],
      "updateDict",
      deps,
    ),
  );
  tools.push(
    plainTool(
      "removeDict",
      "删除字典",
      obj("删除参数", { dictId: str("字典ID") }, ["dictId"]),
      ["dict"],
      async (a) => api.removeDict(String(a.dictId)),
    ),
  );

  /* ---------- 模板 ---------- */
  tools.push(
    plainTool("getTemplates", "获取全部表模板（Eta 语法）", NO_ARGS, [], async () =>
      api.getTemplates(),
    ),
  );
  tools.push(
    objectTool("addTemplate", "新增表模板", templateSchema, ["template"], "addTemplate", deps),
  );
  tools.push(
    objectTool(
      "updateTemplate",
      "更新表模板（按 id 整体替换）",
      templateSchema,
      ["template"],
      "updateTemplate",
      deps,
    ),
  );
  tools.push(
    plainTool(
      "removeTemplate",
      "删除表模板",
      obj("删除参数", { templateId: str("模板ID") }, ["templateId"]),
      ["template"],
      async (a) => api.removeTemplate(String(a.templateId)),
    ),
  );
  tools.push(
    plainTool(
      "getDictCategoryTemplate",
      "获取字典分类模板（仅一个，按分类生成字典代码）",
      NO_ARGS,
      [],
      async () => api.getDictCategoryTemplate(),
    ),
  );
  tools.push(
    objectTool(
      "updateDictCategoryTemplate",
      "更新字典分类模板（按 id 整体替换）",
      templateSchema,
      ["template"],
      "updateDictCategoryTemplate",
      deps,
    ),
  );

  /* ---------- demo 扩展 ---------- */
  if (typeof api.resetDemo === "function") {
    tools.push(
      plainTool(
        "resetDemo",
        "重置为内置演示数据（危险操作：当前全部数据将被覆盖，仅在用户明确要求时使用）",
        NO_ARGS,
        ["model", "dict", "template", "settings"],
        async () => api.resetDemo!(),
      ),
    );
  }

  /* ---------- 代码生成 / 代码替换（合成能力） ---------- */
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
      "generateCode",
      "代码生成：按表模板与字典分类模板生成代码产物，自动打包为 zip 并在界面提供下载按钮（用户点击即可下载），返回文件清单（templateName / tableName / fileName / filePath / size）。不写回源码。",
      obj("生成参数", {
        ...(codegenParams.properties as Record<string, unknown>),
        includeContent: bool(
          "是否在结果中附带每个文件的生成内容（默认 false，内容较大时谨慎开启）",
        ),
      }),
      [],
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
      "replaceCode",
      "代码替换：按模板生成代码产物，先向用户列出将被覆盖的文件清单并等待确认，确认后经代码替换接口写回对应源码文件（危险操作：会覆盖目标源码文件，仅在用户明确要求时使用；用户取消则本次不执行）。",
      codegenParams,
      [],
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
  return tools;
}
