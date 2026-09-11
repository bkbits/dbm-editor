/**
 * 字典仓库：数据字典 CRUD + 模糊搜索
 * 数据读写经 ManagerApi（新增字典的 id 由本地生成后随载荷提交）
 */
import { defineStore } from 'pinia'
import { message } from 'antdv-next'
import type { Dict } from '@/types/model'
import { getManagerApi, errorMessageOf } from '@/api/manager-api'
import { uid } from '@/utils/id'

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T
}

export const useDictStore = defineStore('dict', {
  state: () => ({
    loaded: false,
    loading: false,
    dicts: [] as Dict[],
    keyword: '',
    selectedDictId: '',
  }),

  getters: {
    /** 模糊搜索：字典键/标签/注释 或 其值的 值键/标签/注释 命中即保留 */
    filteredDicts(): Dict[] {
      const kw = this.keyword.trim().toLowerCase()
      if (!kw) return this.dicts
      return this.dicts.filter((d) => {
        const selfHit =
          d.dictKey.toLowerCase().includes(kw) ||
          d.label.toLowerCase().includes(kw) ||
          (d.comment || '').toLowerCase().includes(kw)
        if (selfHit) return true
        return d.values.some(
          (v) =>
            v.valueKey.toLowerCase().includes(kw) ||
            v.label.toLowerCase().includes(kw) ||
            (v.comment || '').toLowerCase().includes(kw),
        )
      })
    },
    selectedDict(): Dict | undefined {
      return this.dicts.find((d) => d.id === this.selectedDictId)
    },
    dictKeys(): string[] {
      return this.dicts.map((d) => d.dictKey)
    },
    /** 某值键是否命中搜索（用于高亮） */
    isValueHit(): (dictId: string, valueId: string) => boolean {
      const kw = this.keyword.trim().toLowerCase()
      return (dictId, valueId) => {
        if (!kw) return false
        const dict = this.dicts.find((d) => d.id === dictId)
        const value = dict?.values.find((v) => v.id === valueId)
        if (!value) return false
        return (
          value.valueKey.toLowerCase().includes(kw) ||
          value.label.toLowerCase().includes(kw) ||
          (value.comment || '').toLowerCase().includes(kw)
        )
      }
    },
  },

  actions: {
    async init() {
      if (this.loaded || this.loading) return
      this.loading = true
      try {
        this.dicts = (await getManagerApi().getDicts()).map(clone)
        this.loaded = true
        if (!this.selectedDictId && this.dicts.length) this.selectedDictId = this.dicts[0].id
      } catch (e) {
        message.error(errorMessageOf(e, '字典加载失败'))
      } finally {
        this.loading = false
      }
    },
    async saveDict(draft: Dict) {
      try {
        const dict = clone(draft)
        if (!dict.id) dict.id = uid('dict-')
        const api = getManagerApi()
        if (draft.id) {
          await api.updateDict(dict)
          const idx = this.dicts.findIndex((d) => d.id === draft.id)
          if (idx >= 0) this.dicts[idx] = clone(dict)
        } else {
          await api.addDict(dict)
          this.dicts.push(clone(dict))
          this.selectedDictId = dict.id
        }
        return dict
      } catch (e) {
        message.error(errorMessageOf(e, '字典保存失败'))
        throw e
      }
    },
    async removeDict(id: string) {
      try {
        await getManagerApi().removeDict(id)
        this.dicts = this.dicts.filter((d) => d.id !== id)
        if (this.selectedDictId === id) {
          this.selectedDictId = this.dicts[0]?.id ?? ''
        }
      } catch (e) {
        message.error(errorMessageOf(e, '字典删除失败'))
        throw e
      }
    },
    /** 供编辑器快速创建空值行（未保存前） */
    newValueDraft(dictId: string) {
      return {
        id: uid('dv-'),
        dictId,
        valueKey: '',
        label: '',
        labelType: 'I' as const,
        comment: '',
        color: '',
      }
    },
  },
})
