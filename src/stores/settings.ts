/**
 * 设置仓库：列默认类型规则（从数据库导入时的 Java 类型默认映射）
 *
 * 匹配语义：对列类型（如 VARCHAR(255)、Decimal(6, 4)）按规则顺序依次
 * 进行正则表达式匹配（忽略大小写），取第一条命中规则的 javaType；
 * 全部未命中时由调用方回退内置类型映射表
 */
import { defineStore } from 'pinia'
import { message } from 'antdv-next'
import type { ColumnTypeRule } from '@/types/model'
import { settingsApi } from '@/api/modules'
import { extractErrorMessage } from '@/api/http'
import { uid } from '@/utils/id'

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T
}

/** 设置中可选的 Java 类型（需求规格枚举） */
export const SETTINGS_JAVA_TYPES = [
  'Character',
  'String',
  'Long',
  'Integer',
  'Float',
  'Double',
  'BigDecimal',
  'LocalDateTime',
  'LocalDate',
  'LocalTime',
  'Timestamp',
] as const

export const useSettingsStore = defineStore('settings', {
  state: () => ({
    loaded: false,
    loading: false,
    columnTypeRules: [] as ColumnTypeRule[],
  }),

  getters: {
    /** 编译后的规则（跳过空/非法正则），保留原始序号用于回显 */
    compiledRules(): Array<{ re: RegExp; javaType: string; index: number }> {
      const out: Array<{ re: RegExp; javaType: string; index: number }> = []
      this.columnTypeRules.forEach((r, index) => {
        const pattern = String(r.pattern ?? '').trim()
        if (!pattern) return
        try {
          out.push({ re: new RegExp(pattern, 'i'), javaType: r.javaType, index })
        } catch {
          /* 非法正则跳过（保存前 UI 已拦截） */
        }
      })
      return out
    },
  },

  actions: {
    async init() {
      if (this.loaded || this.loading) return
      this.loading = true
      try {
        const settings = await settingsApi.query()
        this.columnTypeRules = (settings.columnTypeRules || []).map(clone)
        this.loaded = true
      } catch (e) {
        message.error(extractErrorMessage(e, '设置加载失败'))
      } finally {
        this.loading = false
      }
    },

    async save(rules: ColumnTypeRule[]) {
      const saved = await settingsApi.update({ columnTypeRules: rules.map(clone) })
      this.columnTypeRules = (saved.columnTypeRules || []).map(clone)
      this.loaded = true
      return saved
    },

    /**
     * 依序匹配列类型，返回第一条命中的 Java 类型；未命中返回 null
     * （调用方应回退到内置类型映射 getJavaTypeByType）
     */
    matchJavaType(dbType: string): string | null {
      const raw = String(dbType ?? '').trim()
      if (!raw) return null
      for (const rule of this.compiledRules) {
        if (rule.re.test(raw)) return rule.javaType
      }
      return null
    },

    /** 新建规则草稿行 */
    newRuleDraft(): ColumnTypeRule {
      return { id: uid('rule-'), pattern: '', javaType: 'String' }
    },
  },
})
