/**
 * AIApi 注入体系（与 ManagerApi 注入体系平行）
 *
 * DBManagerView 通过 prop 接收可选的 AIApi 实例（缺省使用内置 DemoAIApi
 * 演示实现），并以 provide/inject 向子组件分发。AI 专属能力（AI 设置、
 * 三协议对话、fetch）全部经本接口；模型元素 / 字典 / 模板 / 设置等数据
 * 能力仍经 ManagerApi（见 ./manager-api.ts）。
 */
import { computed, inject, type ComputedRef, type InjectionKey } from "vue";
import type { AIApi } from "@/types/ai";
import { DemoAIApi } from "./demo-ai-api";

/** 注入键：值为当前 AIApi 的响应式引用（ComputedRef），保证 prop 切换可传导 */
export const AI_API_KEY: InjectionKey<ComputedRef<AIApi>> = Symbol("ai-api");

/** 共享的 demo 演示实现单例（无外部 aiApi 时的缺省实现） */
export const sharedDemoAIApi: DemoAIApi = new DemoAIApi();

/**
 * 子组件注入当前 AIApi（返回响应式引用，使用处取 .value）。
 * 未处于 DBManagerView 子树时回退共享 demo 演示实现。
 */
export function useAIApi(): ComputedRef<AIApi> {
  return inject(AI_API_KEY, () => computed(() => sharedDemoAIApi), true);
}
