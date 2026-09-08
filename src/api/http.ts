/**
 * Axios 实例：所有请求经自定义 adapter 转发至 Mock 分发器
 * （未来对接真实后端时，删除 adapter 即可无缝切换）
 */
import axios, { type AxiosAdapter, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios'
import { mockDispatch } from '@/mock/db'

const mockAdapter: AxiosAdapter = async (config) => {
  const method = (config.method || 'get').toLowerCase()
  // POST JSON 的 data 在进入 adapter 前已被序列化为字符串，此处还原
  let body: unknown = null
  if (config.data !== undefined && config.data !== null) {
    if (typeof config.data === 'string') {
      try {
        body = JSON.parse(config.data)
      } catch {
        body = config.data
      }
    } else {
      // FormData 等二进制载荷原样传递
      body = config.data
    }
  }
  const res = await mockDispatch(method, config.url || '/', body, config.params)
  const response: AxiosResponse = {
    data: res.data,
    status: res.status,
    statusText: res.status === 200 ? 'OK' : 'ERROR',
    headers: {},
    config: config as InternalAxiosRequestConfig,
    request: { mock: true },
  }
  return response
}

export const http = axios.create({
  baseURL: '/api',
  timeout: 20000,
  adapter: mockAdapter,
})

/** 提取后端业务错误信息 */
export function extractErrorMessage(err: unknown, fallback = '请求失败'): string {
  const e = err as { response?: { data?: { message?: string } }; message?: string }
  return e?.response?.data?.message || e?.message || fallback
}
