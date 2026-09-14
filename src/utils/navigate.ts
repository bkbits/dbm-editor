/**
 * 导航关系工具：类型翻转 / 反转 / 校验 / 单向视图生成
 */
import type { Navigate, NavigateCascade, NavigateType, TableNavigate } from '@/types/model'

/** 导航类型展示标签 */
export const NAVIGATE_TYPE_LABEL: Record<NavigateType, string> = {
  '11': '一对一',
  '1N': '一对多',
  N1: '多对一',
  NN: '多对多',
}

/** 级联操作展示标签 */
export const CASCADE_LABEL: Record<NavigateCascade, string> = {
  AUTO: '自动',
  NO_ACTION: '无动作',
  SET_NULL: '设为Null',
  DELETE: '删除',
}

/** 翻转导航类型：1N <-> N1，11/NN 不变 */
export function flipNavigateType(type: NavigateType): NavigateType {
  if (type === '1N') return 'N1'
  if (type === 'N1') return '1N'
  return type
}

/**
 * 反转原始导航对象（self与target调换，类型同步调换）
 */
export function reverseNavigate(nav: TableNavigate): TableNavigate {
  return {
    ...nav,
    type: flipNavigateType(nav.type),
    self: nav.target,
    selfProperty: [...nav.targetProperty],
    selfMappingProperty: [...nav.targetMappingProperty],
    selfPropertyName: nav.targetPropertyName,
    target: nav.self,
    targetProperty: [...nav.selfProperty],
    targetMappingProperty: [...nav.selfMappingProperty],
    targetPropertyName: nav.selfPropertyName,
    selfToTargetCascade: nav.targetToSelfCascade,
    targetToSelfCascade: nav.selfToTargetCascade,
  }
}

/** 两表之间是否存在导航关系（不考虑方向） */
export function navigatesBetween(
  navigates: TableNavigate[],
  tableA: string,
  tableB: string,
  excludeId?: string,
): TableNavigate[] {
  return navigates.filter((n) => {
    if (excludeId && n.id === excludeId) return false
    const pair = [n.self, n.target]
    return pair.includes(tableA) && pair.includes(tableB)
  })
}

/** 生成默认属性名建议：属性名 = 对端表名小驼峰 */
export function suggestPropertyName(targetTableName: string): string {
  const t = String(targetTableName || 'target')
  return t.toLowerCase().replace(/[\s_\-.]+(.)/g, (_, c) => String(c).toUpperCase())
}

/**
 * 由原始导航 + 视角表构建单向 Navigate（模板上下文用）
 * @param nav 原始导航
 * @param viewerTableId 视角表ID（必须是 nav.self 或 nav.target）
 * @param buildShallowVO 构建浅层 TableVO 的工厂（navigates 置空避免循环）
 */
export function buildNavigateView(
  nav: TableNavigate,
  viewerTableId: string,
  buildShallowVO: (tableId: string) => any,
): Navigate | null {
  if (nav.self !== viewerTableId && nav.target !== viewerTableId) return null
  const reversed = nav.target === viewerTableId
  const selfId = reversed ? nav.target : nav.self
  const targetId = reversed ? nav.self : nav.target
  return {
    propertyName: reversed ? nav.targetPropertyName : nav.selfPropertyName,
    type: reversed ? flipNavigateType(nav.type) : nav.type,
    comment: nav.comment || '',
    self: buildShallowVO(selfId),
    selfProperty: reversed ? [...nav.targetProperty] : [...nav.selfProperty],
    selfMappingProperty: reversed ? [...nav.targetMappingProperty] : [...nav.selfMappingProperty],
    mappingTable: nav.mappingTable ? buildShallowVO(nav.mappingTable) : (undefined as any),
    target: buildShallowVO(targetId),
    targetProperty: reversed ? [...nav.selfProperty] : [...nav.targetProperty],
    targetMappingProperty: reversed ? [...nav.selfMappingProperty] : [...nav.targetMappingProperty],
    cascade: reversed ? nav.targetToSelfCascade : nav.selfToTargetCascade,
  }
}
