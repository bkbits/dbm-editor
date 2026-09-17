/**
 * AI 仓库：代码生成共用逻辑
 * （表名 → 表 id 解析与仓库预加载 + 按范围生成文件；代码生成工具与代码替换
 *   工具共用，避免两处各写一遍加载与校验）
 */
import type { AiDeps } from "./types";

/* ---------- 代码生成 / 代码替换共用 ---------- */

/** 文件内容回填上限（includeContent 开启时单文件截断长度） */
export const FILE_CONTENT_CAP = 6000;

/** 解析目标表 id 列表：表名 → id（未知名报错）；缺省 = 全部表 */
export function resolveTableIds(deps: AiDeps, tableNames: unknown): string[] {
  const model = deps.getModel();
  if (Array.isArray(tableNames) && tableNames.length) {
    const names = tableNames.map(String);
    const unknown = names.filter((n) => !model.tableNames.has(n));
    if (unknown.length)
      throw new Error(`以下表名不存在：${unknown.join("、")}（可用表见 getTables 结果）`);
    return model.tables.filter((t) => names.includes(t.tableName)).map((t) => t.id);
  }
  return model.tables.map((t) => t.id);
}

/** 确保相关仓库已加载后按范围生成文件 */
export async function generateFilesOf(deps: AiDeps, args: Record<string, unknown>) {
  const [model, tpl, dict] = [deps.getModel(), deps.getTemplate(), deps.getDict()];
  await Promise.all([model.init(), tpl.init(), dict.init()]);
  const tableIds = resolveTableIds(deps, args.tableNames);
  const templateNames = Array.isArray(args.templateNames)
    ? args.templateNames.map(String)
    : undefined;
  const { files } = tpl.generateFiles(tableIds, templateNames, args.dictEnabled !== false);
  return files;
}
