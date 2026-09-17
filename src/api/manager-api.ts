/**
 * ManagerApi 注入体系
 *
 * DBManagerView 通过 prop 接收可选的 ManagerApi 实例（缺省使用内置
 * DemoManagerApi 演示实现），并以 provide/inject 向子组件分发：
 * - 子组件：useManagerApi() 获取当前 api（响应式引用，随 prop 切换更新）
 * - 状态仓库：由 DBManagerView 创建状态时经工厂依赖 getApi() 读取
 *   （Pinia 时代的全局激活实例机制已随状态注入体系改造移除）
 */
import { computed, inject, type ComputedRef, type InjectionKey } from "vue";
import type { ManagerApi } from "@/types/manager";
import { DemoManagerApi } from "./demo-manager-api";

/** 注入键：值为当前 api 的响应式引用（ComputedRef），保证 prop 切换可传导 */
export const MANAGER_API_KEY: InjectionKey<ComputedRef<ManagerApi>> = Symbol("manager-api");

/** 共享的 demo 演示实现单例（无外部 api 时的缺省实现） */
export const sharedDemoApi: DemoManagerApi = new DemoManagerApi();

/**
 * 子组件注入当前 ManagerApi（返回响应式引用，使用处取 .value）。
 * 未处于 DBManagerView 子树时回退共享 demo 演示实现。
 */
export function useManagerApi(): ComputedRef<ManagerApi> {
  return inject(MANAGER_API_KEY, () => computed(() => sharedDemoApi), true);
}

/** 提取 api 抛出的业务错误信息（原 axios 错误形态的等价替代） */
export function errorMessageOf(err: unknown, fallback = "操作失败"): string {
  return (err as Error | undefined)?.message || fallback;
}
