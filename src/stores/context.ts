/**
 * DBManagerView 全局状态注入体系（替代 Pinia）
 *
 * DBManagerView 在 setup 时调用 createDBManagerState() 创建整套状态仓库
 * （theme/ui/model/canvas/dict/template/settings/history），经 provide/inject
 * 向子组件分发；子组件继续通过各仓库模块的 useXxxStore() 取用 ——
 * 函数名与原先 Pinia 版本保持一致，调用面零改动。
 *
 * - 每个仓库是 Vue reactive 对象（state 字段 + getter 访问器 + action 方法），
 *   不依赖 Pinia，也不依赖应用级全局单例
 * - 仓库间的相互引用通过工厂入参的惰性取值函数（getXxx）建立，
 *   与原先「action 内 useXxxStore()」的运行时取用语义一致
 * - api 通过 getApi() 惰性读取：DBManagerView 的 api prop 切换后，
 *   各仓库下一次动作即走新 api（配合 DBManagerView 的切换重载逻辑）
 */
import { inject, type InjectionKey } from "vue";
import type { ManagerApi } from "@/types/manager";
import { createThemeStore, type ThemeStore } from "./theme";
import { createUiStore, type UiStore } from "./ui";
import { createSettingsStore, type SettingsStore } from "./settings";
import { createDictStore, type DictStore } from "./dict";
import { createTemplateStore, type TemplateStore } from "./template";
import { createHistoryStore, type HistoryStore } from "./history";
import { createModelStore, type ModelStore } from "./model";
import { createCanvasStore, type CanvasStore } from "./canvas";
import { createAiStore, type AiStore } from "./ai";

/** 注入的整体状态形态 */
export interface DBManagerState {
  theme: ThemeStore;
  ui: UiStore;
  settings: SettingsStore;
  dict: DictStore;
  template: TemplateStore;
  history: HistoryStore;
  model: ModelStore;
  canvas: CanvasStore;
  ai: AiStore;
}

/** 注入键 */
export const DBMANAGER_STATE_KEY: InjectionKey<DBManagerState> = Symbol("dbmanager-state");

/**
 * 创建整套状态仓库（由 DBManagerView 在 setup 时调用，每实例一套）
 *
 * @param getApi 惰性读取当前生效的 ManagerApi（prop 切换后取到新实例）
 */
export function createDBManagerState(getApi: () => ManagerApi): DBManagerState {
  const theme = createThemeStore();
  const ui = createUiStore();
  const settings = createSettingsStore({ getApi });
  const dict = createDictStore({ getApi });
  // template / history / model 相互引用，先声明后回填（工厂内以惰性取值函数解耦）
  let model!: ModelStore;
  const template = createTemplateStore({
    /** 惰性读取当前 ManagerApi（api prop 切换后，下一次动作即走新实例） */
    getApi,
    /** 惰性读取模型仓库：model 稍后创建，闭包延迟求值以打破循环依赖 */
    getModel: () => model,
    /** 惰性读取设置仓库：渲染取设置快照注入模板上下文 */
    getSettings: () => settings,
    /** 惰性读取字典仓库：字典分类模板渲染取分类与字典数据 */
    getDict: () => dict,
  });
  const history = createHistoryStore({
    /** 惰性读取模型仓库：撤销/重做取快照、同步持久层皆经此 */
    getModel: () => model,
  });
  model = createModelStore({
    /** 惰性读取当前 ManagerApi（api prop 切换后，下一次动作即走新实例） */
    getApi,
    /** 惰性读取历史仓库：增删改前捕获快照，变更失败时回滚 */
    getHistory: () => history,
    /** 惰性读取设置仓库：类型映射规则、主键与审计字段约定 */
    getSettings: () => settings,
    /** 惰性读取字典仓库：重置演示数据时一并重置其加载标志 */
    getDict: () => dict,
    /** 惰性读取模板仓库：重置演示数据时一并重置其加载标志 */
    getTemplate: () => template,
  });
  const canvas = createCanvasStore({
    /** 惰性读取模型仓库：表/关系数据与持久化均经此，画布不另存一份 */
    getModel: () => model,
    /** 惰性读取 UI 仓库：连线完成即打开关系编辑对话框 */
    getUi: () => ui,
    /** 惰性读取历史仓库：自动布局、对齐、粘贴前捕获快照 */
    getHistory: () => history,
  });
  // AI 仓库依赖 model / dict / template / settings（AGENT 工具执行与域同步刷新）
  const ai = createAiStore({
    /** 惰性读取当前 ManagerApi（AGENT 调用与工具执行走同一实例） */
    getApi,
    /** 惰性读取模型仓库：AGENT 工具读写表与关系 */
    getModel: () => model,
    /** 惰性读取字典仓库：字典类工具与域数据刷新 */
    getDict: () => dict,
    /** 惰性读取模板仓库：代码生成工具复用模板管线 */
    getTemplate: () => template,
    /** 惰性读取设置仓库：代码生成注入设置上下文 */
    getSettings: () => settings,
  });
  return { theme, ui, settings, dict, template, history, model, canvas, ai };
}

/**
 * 子组件注入整体状态（各仓库模块的 useXxxStore() 均基于此实现）。
 * 必须在 DBManagerView 组件树内调用，否则抛出中文错误提示。
 */
export function useDBManagerContext(): DBManagerState {
  const state = inject(DBMANAGER_STATE_KEY);
  if (!state) {
    throw new Error("状态未注入：请在 <DBManagerView> 组件树内使用 useXxxStore()");
  }
  return state;
}
