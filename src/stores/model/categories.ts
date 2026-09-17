/**
 * 模型仓库：表分类增删改
 * （本地先行 + 契约持久化，失败回滚快照）
 */
import type { TableCategory } from "@/types/model";
import { uid } from "@/utils/id";
import { clone } from "./helpers";
import type { ModelDeps, ModelStore } from "./types";

/**
 * 分类域 part 工厂：表分类的新增 / 更新 / 删除，均按「本地先行 + 契约持久化 + 失败回滚」执行。
 * 返回对象的方法以 `this` 访问仓库状态，this 上下文由 `ThisType<ModelStore>` 提供。
 */
export function categoryMethods(deps: ModelDeps) {
  return {
    /**
     * 新增或更新分类（draft.id 存在即更新）：先校验名称/基础包非空与名称唯一，
     * 再本地改并 capture 撤销点、await 契约；失败回滚快照并抛错，成功返回落库结果。
     */
    async saveCategory(draft: Partial<TableCategory> & { id?: string }) {
      const name = String(draft.name || "").trim();
      const basePackage = String(draft.basePackage || "").trim();
      if (!name) throw new Error("分类名称不能为空");
      if (!basePackage) throw new Error("基础包路径不能为空");
      if (this.categories.some((c) => c.name === name && c.id !== draft.id)) {
        throw new Error(`分类名称已存在: ${name}`);
      }
      const api = deps.getApi();
      const history = deps.getHistory();
      const snap = this.takeSnapshot();
      let saved: TableCategory;
      if (draft.id) {
        const idx = this.categories.findIndex((c) => c.id === draft.id);
        if (idx < 0) throw new Error(`分类不存在: ${draft.id}`);
        saved = { ...this.categories[idx], id: draft.id, name, basePackage, src: draft.src || "" };
        history.capture(snap);
        this.categories[idx] = clone(saved);
        try {
          await api.updateCategory(clone(saved));
        } catch (e) {
          this.rollback(snap);
          throw e;
        }
      } else {
        saved = { id: uid("cat-"), name, basePackage, src: draft.src || "" };
        history.capture(snap);
        this.categories.push(clone(saved));
        try {
          await api.addCategory(clone(saved));
        } catch (e) {
          this.rollback(snap);
          throw e;
        }
      }
      return saved;
    },

    /** 删除分类（先本地移除并 capture 撤销点，契约失败回滚并抛错；不级联删除分类下的表） */
    async removeCategory(id: string) {
      const history = deps.getHistory();
      const snap = this.takeSnapshot();
      history.capture(snap);
      this.categories = this.categories.filter((c) => c.id !== id);
      try {
        await deps.getApi().removeCategory(id);
      } catch (e) {
        this.rollback(snap);
        throw e;
      }
    },
  } satisfies ThisType<ModelStore> & Partial<ModelStore>;
}
