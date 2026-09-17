/**
 * 字典仓库：字典分类 CRUD + 字典 CRUD + 模糊搜索
 * （reactive 对象工厂形态，由 DBManagerView 经上下文注入，不依赖 Pinia；
 *   数据读写经 ManagerApi，新增分类/字典的 id 由本地生成后随载荷提交）
 */
import { reactive } from "vue";
import { message } from "antdv-next";
import { useDBManagerContext } from "./context";
import type { Dict, DictCategory, ManagerApi } from "@/types/model";
import { errorMessageOf } from "@/api/manager-api";
import { uid } from "@/utils/id";

/** 结构化深拷贝：切断与调用方对象的引用，避免 reactive 代理被外部改动 */
function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

/** 工厂依赖 */
export interface DictDeps {
  getApi: () => ManagerApi;
}

/**
 * 创建字典仓库（reactive 对象工厂，不依赖 Pinia；由 createDBManagerState 注入组件树）
 *
 * @param deps 依赖经工厂入参惰性取用：getApi 在每次动作时读取当前 ManagerApi
 */
export function createDictStore(deps: DictDeps) {
  return reactive({
    loaded: false,
    loading: false,
    categories: [] as DictCategory[],
    dicts: [] as Dict[],
    keyword: "",
    selectedDictId: "",

    /** 模糊搜索：字典键/标签/注释 或 其值的 值键/标签/注释 命中即保留 */
    get filteredDicts(): Dict[] {
      const kw = this.keyword.trim().toLowerCase();
      if (!kw) return this.dicts;
      return this.dicts.filter((d) => {
        const selfHit =
          d.dictKey.toLowerCase().includes(kw) ||
          d.label.toLowerCase().includes(kw) ||
          (d.comment || "").toLowerCase().includes(kw);
        if (selfHit) return true;
        return d.values.some(
          (v) =>
            v.valueKey.toLowerCase().includes(kw) ||
            v.label.toLowerCase().includes(kw) ||
            (v.comment || "").toLowerCase().includes(kw),
        );
      });
    },
    /** 当前选中的字典（selectedDictId 无匹配时为 undefined，非 null） */
    get selectedDict(): Dict | undefined {
      return this.dicts.find((d) => d.id === this.selectedDictId);
    },
    /** 全部字典键的有序列表（按 dicts 顺序，不做去重） */
    get dictKeys(): string[] {
      return this.dicts.map((d) => d.dictKey);
    },
    /** 分类取值：不存在（含未分类空串）时返回 undefined */
    get categoryById(): (id: string) => DictCategory | undefined {
      return (id) => this.categories.find((c) => c.id === id);
    },
    /** 按分类分组：未分类（categoryId 空）排在末尾，返回 [{category|null, dicts}] */
    get grouped(): Array<{ category: DictCategory | null; dicts: Dict[] }> {
      const groups: Array<{ category: DictCategory | null; dicts: Dict[] }> = this.categories.map(
        (category) => ({ category, dicts: [] }),
      );
      const ungrouped = { category: null, dicts: [] as Dict[] };
      const byId = new Map(groups.map((g) => [g.category!.id, g]));
      for (const d of this.filteredDicts) {
        const g = d.categoryId ? byId.get(d.categoryId) : undefined;
        (g || ungrouped).dicts.push(d);
      }
      return ungrouped.dicts.length ? [...groups, ungrouped] : groups;
    },
    /** 某值键是否命中搜索（用于高亮） */
    get isValueHit(): (dictId: string, valueId: string) => boolean {
      const kw = this.keyword.trim().toLowerCase();
      return (dictId, valueId) => {
        if (!kw) return false;
        const dict = this.dicts.find((d) => d.id === dictId);
        const value = dict?.values.find((v) => v.id === valueId);
        if (!value) return false;
        return (
          value.valueKey.toLowerCase().includes(kw) ||
          value.label.toLowerCase().includes(kw) ||
          (value.comment || "").toLowerCase().includes(kw)
        );
      };
    },

    /** 首次加载分类与字典（幂等：已加载或在途时直接返回，不等待；失败提示且可重试） */
    async init() {
      if (this.loaded || this.loading) return;
      this.loading = true;
      try {
        const api = deps.getApi();
        this.categories = (await api.getDictCategories()).map(clone);
        this.dicts = (await api.getDicts()).map(clone);
        this.loaded = true;
        if (!this.selectedDictId && this.dicts.length) this.selectedDictId = this.dicts[0].id;
      } catch (e) {
        message.error(errorMessageOf(e, "字典加载失败"));
      } finally {
        this.loading = false;
      }
    },
    /**
     * 保存字典分类草稿：无 id 时本地生成 id 后新增，有 id 时更新。
     * 契约先行（api 成功后才回写本地列表），失败提示并抛出，调用方可保持对话框开启。
     */
    async saveDictCategory(draft: DictCategory) {
      try {
        const category = clone(draft);
        const api = deps.getApi();
        if (draft.id) {
          await api.updateDictCategory(category);
          const idx = this.categories.findIndex((c) => c.id === draft.id);
          if (idx >= 0) this.categories[idx] = clone(category);
        } else {
          category.id = uid("dictcat-");
          await api.addDictCategory(category);
          this.categories.push(clone(category));
        }
        return category;
      } catch (e) {
        message.error(errorMessageOf(e, "字典分类保存失败"));
        throw e;
      }
    },
    /** 删除字典分类（先落契约再改本地；失败提示并抛出，本地列表不变） */
    async removeDictCategory(id: string) {
      try {
        await deps.getApi().removeDictCategory(id);
        this.categories = this.categories.filter((c) => c.id !== id);
      } catch (e) {
        message.error(errorMessageOf(e, "字典分类删除失败"));
        throw e;
      }
    },
    /**
     * 保存字典草稿：无 id 时本地生成 id 后新增，有 id 时更新；新增后自动选中该字典。
     * 契约先行（api 成功后才回写本地），失败提示并抛出；返回入库用的副本。
     */
    async saveDict(draft: Dict) {
      try {
        const dict = clone(draft);
        if (!dict.id) dict.id = uid("dict-");
        const api = deps.getApi();
        if (draft.id) {
          await api.updateDict(dict);
          const idx = this.dicts.findIndex((d) => d.id === draft.id);
          if (idx >= 0) this.dicts[idx] = clone(dict);
        } else {
          await api.addDict(dict);
          this.dicts.push(clone(dict));
          this.selectedDictId = dict.id;
        }
        return dict;
      } catch (e) {
        message.error(errorMessageOf(e, "字典保存失败"));
        throw e;
      }
    },
    /** 删除字典（先落契约再改本地；删除选中项时回退到首个，失败提示并抛出） */
    async removeDict(id: string) {
      try {
        await deps.getApi().removeDict(id);
        this.dicts = this.dicts.filter((d) => d.id !== id);
        if (this.selectedDictId === id) {
          this.selectedDictId = this.dicts[0]?.id ?? "";
        }
      } catch (e) {
        message.error(errorMessageOf(e, "字典删除失败"));
        throw e;
      }
    },
    /** 供编辑器快速创建空值行（未保存前） */
    newValueDraft(dictId: string) {
      return {
        id: uid("dv-"),
        dictId,
        valueKey: "",
        propertyName: "",
        label: "",
        labelType: "I" as const,
        comment: "",
        color: "",
      };
    },
  });
}

export type DictStore = ReturnType<typeof createDictStore>;

/** 子组件取用字典仓库（须处于 DBManagerView 组件树内） */
export function useDictStore(): DictStore {
  return useDBManagerContext().dict;
}
