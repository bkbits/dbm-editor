/**
 * 模型仓库：类型与契约
 * （从 stores/model.ts 拆分而来：本文件只放类型定义与 ModelStore 显式接口，
 *   无运行逻辑。ModelStore 由 stores/model/store.ts 的组装结果 `satisfies` 校验，
 *   各 part 文件以 `ThisType<ModelStore>` 取得一致的 this 上下文）
 */
import type {
  DBTable,
  ManagerApi,
  ManagerTable,
  Table,
  TableAddPayload,
  TableCategory,
  TableColumn,
  TableIndex,
  TableNavigate,
  TableUpdatePayload,
  TableVO,
} from "@/types/model";
import type { HistoryStore } from "../history";
import type { SettingsStore } from "../settings";
import type { DictStore } from "../dict";
import type { TemplateStore } from "../template";

/** 工厂依赖（均惰性取用，与原先 action 内 useXxxStore() 的运行时语义一致） */
export interface ModelDeps {
  getApi: () => ManagerApi;
  getHistory: () => HistoryStore;
  getSettings: () => SettingsStore;
  getDict: () => DictStore;
  getTemplate: () => TemplateStore;
}

/** 模型仓库对外形态（状态字段 + 派生 getter + 各域动作） */
export interface ModelStore {
  loaded: boolean;
  loading: boolean;
  error: string;
  categories: TableCategory[];
  tables: Table[];
  columns: TableColumn[];
  indexes: TableIndex[];
  navigates: TableNavigate[];

  readonly tableCount: number;
  readonly navigateCount: number;
  readonly categoryCount: number;
  readonly tableNames: Set<string>;
  readonly categoryNames: Set<string>;
  readonly tableById: (id: string) => Table | undefined;
  readonly categoryById: (id: string) => TableCategory | undefined;
  readonly tablesByCategory: (categoryId: string) => Table[];
  readonly navigatesOf: (tableId: string) => TableNavigate[];
  readonly isMappingTable: (tableId: string) => boolean;
  readonly hasNavigateBetween: (a: string, b: string, excludeId?: string) => boolean;

  /* 加载与全量动作 */
  init(): Promise<void>;
  refresh(): Promise<void>;
  saveAll(): Promise<void>;
  applyTables(tables: ManagerTable[]): void;
  syncToApi(): Promise<void>;
  rollback(snap: ModelSnapshot): void;

  /* 字段 / 索引装配与 VO 投影 */
  setColumnsOf(tableId: string, columns: TableColumn[]): void;
  setIndexesOf(tableId: string, indexes: TableIndex[]): void;
  columnsOf(tableId: string): TableColumn[];
  indexesOf(tableId: string): TableIndex[];
  managerTableOf(tableId: string): ManagerTable;
  shallowVO(tableId: string): TableVO;
  getVO(tableId: string): TableVO | null;

  /* 分类 */
  saveCategory(draft: Partial<TableCategory> & { id?: string }): Promise<TableCategory>;
  removeCategory(id: string): Promise<void>;

  /* 表 */
  createTable(draft: Omit<TableAddPayload, "id">): Promise<string>;
  saveTable(draft: Omit<TableUpdatePayload, "rawNavigates">): Promise<void>;
  setTableHidden(tableId: string, hidden: boolean): Promise<void>;
  moveTablesBy(ids: string[], dx: number, dy: number): void;
  persistTables(ids: string[]): Promise<void>;
  removeTables(ids: string[]): Promise<void>;

  /* 导航 */
  addNavigate(nav: TableNavigate): Promise<void>;
  updateNavigate(nav: TableNavigate): Promise<void>;
  removeNavigate(id: string): Promise<void>;
  reverseNavigate(id: string): Promise<void>;

  /* 复制 / 粘贴 */
  buildCopyDraft(tableId: string): Omit<TableAddPayload, "id"> | null;
  pasteTable(
    draft: Omit<TableAddPayload, "id">,
    position?: { x: number; y: number },
  ): Promise<string>;

  /* 从数据库导入 */
  importFromDB(categoryId: string, defs: DBTable[]): Promise<string[]>;

  /* 快照与恢复 */
  takeSnapshot(): ModelSnapshot;
  applySnapshot(snap: ModelSnapshot): void;
  resetDemoData(): Promise<void>;
}

/** 模型快照（撤销/重做用） */
export interface ModelSnapshot {
  categories: TableCategory[];
  tables: Table[];
  columns: TableColumn[];
  indexes: TableIndex[];
  navigates: TableNavigate[];
}
