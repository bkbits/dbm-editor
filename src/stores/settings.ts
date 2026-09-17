/**
 * 设置仓库：索引类型列表 + 列类型映射规则 + 代码生成配置（作者 / 表选项 / 列选项元定义）
 * + 主键与审计字段约定
 * （reactive 对象工厂形态，由 DBManagerView 经上下文注入，不依赖 Pinia；
 *   ManagerApi 经工厂入参 getApi 惰性读取，prop 切换后自动走新实例）
 *
 * 匹配语义：对列类型（如 VARCHAR(255)、Decimal(6, 4)）按 typeMappings 的
 * sort 升序（越小越优先）进行正则表达式匹配（忽略大小写），取第一条命中
 * 规则的 javaType；全部未命中时由调用方回退内置类型映射表
 */
import { reactive } from "vue";
import { message } from "antdv-next";
import { useDBManagerContext } from "./context";
import type { ManagerApi } from "@/types/manager";
import type { OptionSetting, Settings, TypeMapping } from "@/types/model";
import { errorMessageOf } from "@/api/manager-api";
import { uid } from "@/utils/id";
import { normalizeFieldConventions } from "@/utils/fieldConvention";

/** 结构化深拷贝：切断与调用方对象的引用，避免 reactive 代理被外部改动 */
function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

/** 设置中可选的 Java 类型（需求规格枚举） */
export const SETTINGS_JAVA_TYPES = [
  "Character",
  "String",
  "Long",
  "Integer",
  "Float",
  "Double",
  "BigDecimal",
  "LocalDateTime",
  "LocalDate",
  "LocalTime",
  "Timestamp",
] as const;

/** 工厂依赖 */
export interface SettingsDeps {
  getApi: () => ManagerApi;
}

/** 选项定义归一（api 返回/保存前）：去空白、名称/类型/标签兜底 */
function normalizeOptionSettings(raw: unknown): OptionSetting[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((o: Partial<OptionSetting>) => ({
      name: String(o?.name ?? "").trim(),
      type: String(o?.type ?? "boolean").trim() || "boolean",
      label: String(o?.label ?? "").trim(),
      // 空串保留（不转 undefined）：设置页草稿与已保存态的 JSON 比较需两侧键集一致，
      // 否则「未填写」选项会让设置页一加载就误报「有未保存的修改」
      remark: String(o?.remark ?? "").trim(),
      dict: String(o?.dict ?? "").trim(),
    }))
    .filter((o) => o.name)
    .map((o) => ({ ...o, label: o.label || o.name }));
}

/**
 * 创建设置仓库（reactive 对象工厂，不依赖 Pinia；由 createDBManagerState 注入组件树）
 *
 * @param deps 依赖经工厂入参惰性取用：getApi 在每次读写时读取当前 ManagerApi
 */
export function createSettingsStore(deps: SettingsDeps) {
  /** 在途加载 Promise：并发调用方共享同一次加载并等待其完成；结束后清空（失败可重试） */
  let initInFlight: Promise<void> | null = null;
  return reactive({
    loaded: false,
    loading: false,
    indexTypes: [] as string[],
    typeMappings: [] as TypeMapping[],
    /** 代码作者（生成 javadoc 的 @author；空则省略） */
    author: "",
    /** 表选项元定义（表编辑对话框据此渲染表选项编辑项） */
    tableOptions: [] as OptionSetting[],
    /** 列选项元定义（表编辑对话框据此渲染列选项编辑项） */
    columnOptions: [] as OptionSetting[],
    /** 主键与审计字段约定（表编辑据此固定首字段与审计字段一键增删） */
    fieldConventions: normalizeFieldConventions(undefined),

    /** 索引类型选项（空时兜底三常规类型，避免设置未加载时无可选项） */
    get indexTypeOptions(): string[] {
      return this.indexTypes.length ? this.indexTypes : ["UNIQUE", "NORMAL", "FULLTEXT"];
    },
    /** 编译后的规则（按 sort 升序、跳过空/非法正则），保留原始序号用于回显 */
    get compiledRules(): Array<{ re: RegExp; javaType: string; index: number }> {
      const out: Array<{ re: RegExp; javaType: string; index: number }> = [];
      [...this.typeMappings]
        .sort((a, b) => a.sort - b.sort)
        .forEach((r, index) => {
          const pattern = String(r.pattern ?? "").trim();
          if (!pattern) return;
          try {
            out.push({ re: new RegExp(pattern, "i"), javaType: r.javaType, index });
          } catch {
            /* 非法正则跳过（保存前 UI 已拦截） */
          }
        });
      return out;
    },

    /**
     * 加载设置（幂等；并发调用共享同一次在途加载）。
     * 此前"loading 时直接早退"会让后续 await init() 的调用方在加载
     * 完成前拿到空规则（自定义异步 api 实现场景的竞态）；现在
     * 在途 Promise 被共享并真正被 await。
     */
    async init(): Promise<void> {
      if (this.loaded) return;
      if (!initInFlight) {
        this.loading = true;
        initInFlight = (async () => {
          try {
            const settings = await deps.getApi().getSettings();
            this.indexTypes = (settings.indexTypes || []).map(String);
            this.typeMappings = (settings.typeMappings || []).map(clone);
            this.author = String(settings.author ?? "");
            this.tableOptions = normalizeOptionSettings(settings.tableOptions);
            this.columnOptions = normalizeOptionSettings(settings.columnOptions);
            this.fieldConventions = normalizeFieldConventions(settings.fieldConventions);
            this.loaded = true;
          } catch (e) {
            message.error(errorMessageOf(e, "设置加载失败"));
          } finally {
            this.loading = false;
            initInFlight = null;
          }
        })();
      }
      await initInFlight;
    },

    /**
     * 保存设置：api 校验并保存成功后才整体刷新本地字段（失败向上抛出，
     * 由设置页捕获提示，本地保持旧值）；成功后置 loaded，无需再 init。
     */
    async save(settings: Settings) {
      const saved = clone(settings);
      // 异步契约：api 保存成功后才更新本地状态（失败时本地保持旧值）
      await deps.getApi().saveSettings(saved);
      this.indexTypes = (saved.indexTypes || []).map(String);
      this.typeMappings = (saved.typeMappings || []).map(clone);
      this.author = String(saved.author ?? "");
      this.tableOptions = normalizeOptionSettings(saved.tableOptions);
      this.columnOptions = normalizeOptionSettings(saved.columnOptions);
      this.fieldConventions = normalizeFieldConventions(saved.fieldConventions);
      this.loaded = true;
      return saved;
    },

    /** 当前设置快照（供渲染管线作为 TemplateContext.settings 注入模板） */
    snapshot(): Settings {
      return {
        indexTypes: [...this.indexTypes],
        typeMappings: clone(this.typeMappings),
        author: this.author,
        tableOptions: clone(this.tableOptions),
        columnOptions: clone(this.columnOptions),
        fieldConventions: clone(this.fieldConventions),
      };
    },

    /**
     * 依序匹配列类型，返回第一条命中的 Java 类型；未命中返回 null
     * （调用方应回退到内置类型映射 getJavaTypeByType）
     */
    matchJavaType(dbType: string): string | null {
      const raw = String(dbType ?? "").trim();
      if (!raw) return null;
      for (const rule of this.compiledRules) {
        if (rule.re.test(raw)) return rule.javaType;
      }
      return null;
    },

    /** 新建规则草稿行（sort 暂为末尾占位，保存时统一按序重编号） */
    newMappingDraft(): TypeMapping {
      return { sort: this.typeMappings.length, pattern: "", javaType: "String" };
    },

    /** 生成客户端拖拽/编辑用的草稿行（带稳定 key，保存时剥离） */
    draftKey(): string {
      return uid("mapping-");
    },
  });
}

export type SettingsStore = ReturnType<typeof createSettingsStore>;

/** 子组件取用设置仓库（须处于 DBManagerView 组件树内） */
export function useSettingsStore(): SettingsStore {
  return useDBManagerContext().settings;
}
