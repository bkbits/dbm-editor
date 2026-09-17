/**
 * 模型仓库：从真实数据库导入
 * （按库表定义批量建表：列 Java 类型经设置规则映射，索引类型取设置项，位置按行排布）
 */
import type { DBTable } from "@/types/model";
import { uid } from "@/utils/id";
import { toCamelCase } from "@/utils/string";
import { getJavaTypeByType } from "@/utils/javaType";
import type { ModelDeps, ModelStore } from "./types";

/**
 * 导入域 part 工厂：把真实数据库表定义批量转为本地表（含重名处理与自动布局）。
 * 返回对象的方法以 `this` 访问仓库状态，this 上下文由 `ThisType<ModelStore>` 提供。
 */
export function importMethods(deps: ModelDeps) {
  return {
    /**
     * 批量导入库表定义到指定分类：表名重名自动加序号，列 Java 类型按设置规则匹配
     * （未命中回退内置映射），索引类型不在设置列表时归一为首项，位置自最大 y 起网格排布；
     * capture 撤销点后逐个 await addTable，任一步失败整体回滚并抛错。
     */
    async importFromDB(categoryId: string, defs: DBTable[]) {
      const api = deps.getApi();
      // 列类型映射规则：设置中 sort 最小命中优先，未命中回退内置映射
      const settings = deps.getSettings();
      if (!settings.loaded) await settings.init();
      const history = deps.getHistory();
      const snap = this.takeSnapshot();
      history.capture(snap);
      const indexTypes = settings.indexTypes.length
        ? settings.indexTypes
        : ["UNIQUE", "NORMAL", "FULLTEXT"];
      // 自动布局：从当前最大 y 下方开始网格排布
      const maxY = this.tables.reduce((m, t) => Math.max(m, (t.y ?? 0) + 260), 40);
      let col = 0;
      const createdIds: string[] = [];
      for (const def of defs) {
        let tableName = def.tableName;
        let n = 1;
        while (this.tableNames.has(tableName)) {
          tableName = `${def.tableName}_${n++}`;
        }
        const tableId = uid("t-");
        this.tables.push({
          id: tableId,
          categoryId,
          tableName,
          className: toCamelCase(tableName),
          comment: def.comment || "",
          hidden: false,
          x: 40 + col * 340,
          y: maxY,
        });
        this.setColumnsOf(
          tableId,
          def.columns.map((c, i) => ({
            id: uid("c-"),
            tableId: "",
            columnName: c.columnName,
            propertyName: toCamelCase(c.columnName, true),
            sort: i,
            type: c.type,
            javaType: settings.matchJavaType(c.type) ?? getJavaTypeByType(c.type),
            comment: c.comment || "",
            notNull: Boolean(c.notNull),
            primaryKey: Boolean(c.primaryKey),
            dict: "",
          })),
        );
        // 索引：类型不在设置列表时归一为列表首项
        this.setIndexesOf(
          tableId,
          (def.indexes || [])
            .filter((idx) => String(idx.indexName || "").trim())
            .map((idx) => {
              const type = String(idx.type || "")
                .trim()
                .toUpperCase();
              return {
                id: uid("i-"),
                tableId: "",
                indexName: String(idx.indexName).trim(),
                type: indexTypes.includes(type) ? type : indexTypes[0],
                columns: (idx.columns || []).map(String),
                comment: idx.comment || "",
              };
            }),
        );
        createdIds.push(tableId);
        col = (col + 1) % 5;
      }
      try {
        for (const id of createdIds) await api.addTable(this.managerTableOf(id));
      } catch (e) {
        this.rollback(snap);
        throw e;
      }
      return createdIds;
    },
  } satisfies ThisType<ModelStore> & Partial<ModelStore>;
}
