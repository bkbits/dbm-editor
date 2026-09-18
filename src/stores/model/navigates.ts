/**
 * 模型仓库：导航关系增删改
 * （反向反转：type 与 self/target 成对调换，经 flipNavigateType 推导；
 *   写入前经 normalizeNavigateProps 兜底残缺字段，保证本地状态与落盘形态齐备）
 */
import type { TableNavigate } from "@/types/model";
import { normalizeNavigateProps, reverseNavigate } from "@/utils/navigate";
import { clone } from "./helpers";
import type { ModelDeps, ModelStore } from "./types";

/**
 * 导航域 part 工厂：表间导航关系的新增 / 更新 / 删除与反向反转（均经契约持久化）。
 * 返回对象的方法以 `this` 访问仓库状态，this 上下文由 `ThisType<ModelStore>` 提供。
 */
export function navigateMethods(deps: ModelDeps) {
  return {
    /** 新增导航（自动创建中间表的逻辑由调用方完成后传入；写入前字段兜底归一） */
    async addNavigate(nav: TableNavigate) {
      const api = deps.getApi();
      const history = deps.getHistory();
      const snap = this.takeSnapshot();
      const normalized = normalizeNavigateProps(clone(nav));
      history.capture(snap);
      this.navigates.push(clone(normalized));
      try {
        await api.addNavigate(clone(normalized));
      } catch (e) {
        this.rollback(snap);
        throw e;
      }
    },

    /** 更新导航：目标 id 不存在时静默返回；本地先行并 capture 撤销点，失败回滚并抛错 */
    async updateNavigate(nav: TableNavigate) {
      const normalized = normalizeNavigateProps(clone(nav));
      const idx = this.navigates.findIndex((n) => n.id === normalized.id);
      if (idx < 0) return;
      const api = deps.getApi();
      const history = deps.getHistory();
      const snap = this.takeSnapshot();
      history.capture(snap);
      this.navigates[idx] = clone(normalized);
      try {
        await api.updateNavigate(clone(normalized));
      } catch (e) {
        this.rollback(snap);
        throw e;
      }
    },

    /** 删除导航：id 不存在时静默返回；本地先行并 capture 撤销点，契约失败回滚并抛错 */
    async removeNavigate(id: string) {
      const nav = this.navigates.find((n) => n.id === id);
      if (!nav) return;
      const api = deps.getApi();
      const history = deps.getHistory();
      const snap = this.takeSnapshot();
      history.capture(snap);
      this.navigates = this.navigates.filter((n) => n.id !== id);
      try {
        await api.removeNavigate(id);
      } catch (e) {
        this.rollback(snap);
        throw e;
      }
    },

    /** 反转导航（self/target 调换，类型同步调换；列名数组经兜底后不丢字段） */
    async reverseNavigate(id: string) {
      const nav = this.navigates.find((n) => n.id === id);
      if (!nav) return;
      await this.updateNavigate(reverseNavigate(clone(nav)));
    },
  } satisfies ThisType<ModelStore> & Partial<ModelStore>;
}
