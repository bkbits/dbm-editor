/**
 * 模型仓库：通用小工具
 * （深拷贝与实体比较——快照 / 回滚 / 「无变化不发请求」判定共用）
 */

export function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

/** 实体是否与目标一致（逐字节比较，避免多余 api 调用） */
export function sameEntity(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
