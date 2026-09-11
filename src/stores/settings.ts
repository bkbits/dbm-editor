/**
 * 设置仓库：索引类型列表 + 列类型映射规则（从数据库导入时的 Java 类型默认映射）
 *
 * 匹配语义：对列类型（如 VARCHAR(255)、Decimal(6, 4)）按 typeMappings 的
 * sort 升序（越小越优先）进行正则表达式匹配（忽略大小写），取第一条命中
 * 规则的 javaType；全部未命中时由调用方回退内置类型映射表
 */
import { defineStore } from 'pinia'
import { message } from 'antdv-next'
import type { Settings, TypeMapping } from '@/types/model'
import { getManagerApi, errorMessageOf } from '@/api/manager-api'
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

/** 在途加载 Promise：并发调用方共享同一次加载并等待其完成；结束后清空（失败可重试） */
let initInFlight: Promise<void> | null = null

export const useSettingsStore = defineStore('settings', {
  state: () => ({
    loaded: false,
    loading: false,
    indexTypes: [] as string[],
    typeMappings: [] as TypeMapping[],
  }),

  getters: {
    /** 索引类型选项（空时兜底三常规类型，避免设置未加载时无可选项） */
    indexTypeOptions(): string[] {
      return this.indexTypes.length ? this.indexTypes : ['UNIQUE', 'NORMAL', 'FULLTEXT']
    },
    /** 编译后的规则（按 sort 升序、跳过空/非法正则），保留原始序号用于回显 */
    compiledRules(): Array<{ re: RegExp; javaType: string; index: number }> {
      const out: Array<{ re: RegExp; javaType: string; index: number }> = []
      ;[...this.typeMappings]
        .sort((a, b) => a.sort - b.sort)
        .forEach((r, index) => {
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
    /**
     * 加载设置（幂等；并发调用共享同一次在途加载）。
     * 此前"loading 时直接早退"会让后续 await init() 的调用方在加载
     * 完成前拿到空规则（自定义异步 api 实现场景的竞态）；现在
     * 在途 Promise 被共享并真正被 await。
     */
    async init(): Promise<void> {
      if (this.loaded) return
      if (!initInFlight) {
        this.loading = true
        initInFlight = (async () => {
          try {
            const settings = await getManagerApi().getSettings()
            this.indexTypes = (settings.indexTypes || []).map(String)
            this.typeMappings = (settings.typeMappings || []).map(clone)
            this.loaded = true
          } catch (e) {
            message.error(errorMessageOf(e, '设置加载失败'))
          } finally {
            this.loading = false
            initInFlight = null
          }
        })()
      }
      await initInFlight
    },

    async save(settings: Settings) {
      const saved = clone(settings)
      // 异步契约：api 保存成功后才更新本地状态（失败时本地保持旧值）
      await getManagerApi().saveSettings(saved)
      this.indexTypes = (saved.indexTypes || []).map(String)
      this.typeMappings = (saved.typeMappings || []).map(clone)
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

    /** 新建规则草稿行（sort 暂为末尾占位，保存时统一按序重编号） */
    newMappingDraft(): TypeMapping {
      return { sort: this.typeMappings.length, pattern: '', javaType: 'String' }
    },

    /** 生成客户端拖拽/编辑用的草稿行（带稳定 key，保存时剥离） */
    draftKey(): string {
      return uid('mapping-')
    },
  },
})
