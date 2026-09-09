/**
 * ManagerApi 注入体系
 *
 * DBManagerView 通过 prop 接收可选的 ManagerApi 实例（缺省使用内置
 * DemoManagerApi 演示实现），并以 provide/inject 向子组件分发：
 * - 子组件：useManagerApi() 获取当前 api（响应式引用，随 prop 切换更新）
 * - Pinia store：getManagerApi() 读取全局激活实例（store 无法使用 inject，
 *   由 DBManagerView 在 setup 时通过 setActiveApi 写入）
 */
import { computed, inject, shallowRef, type ComputedRef, type InjectionKey } from 'vue'
import type { ManagerApi } from '@/types/model'
import { DemoManagerApi } from './demo-manager-api'

/** 注入键：值为当前 api 的响应式引用（ComputedRef），保证 prop 切换可传导 */
export const MANAGER_API_KEY: InjectionKey<ComputedRef<ManagerApi>> = Symbol('manager-api')

/** 共享的 demo 演示实现单例（无外部 api 时的缺省实现） */
export const sharedDemoApi: DemoManagerApi = new DemoManagerApi()

/** 全局激活实例（供 Pinia store 读取） */
const activeApiRef = shallowRef<ManagerApi | null>(null)

/** 写入全局激活实例（由 DBManagerView 在 setup 时调用） */
export function setActiveApi(api: ManagerApi | null): void {
  activeApiRef.value = api
}

/** 读取当前生效的 ManagerApi：优先外部激活实例，回退 demo 演示实现 */
export function getManagerApi(): ManagerApi {
  return activeApiRef.value ?? sharedDemoApi
}

/**
 * 子组件注入当前 ManagerApi（返回响应式引用，使用处取 .value）。
 * 未处于 DBManagerView 子树时回退全局激活实例。
 */
export function useManagerApi(): ComputedRef<ManagerApi> {
  return inject(MANAGER_API_KEY, () => computed(getManagerApi), true)
}

/** 提取 api 抛出的业务错误信息（原 axios 错误形态的等价替代） */
export function errorMessageOf(err: unknown, fallback = '操作失败'): string {
  return (err as Error | undefined)?.message || fallback
}
