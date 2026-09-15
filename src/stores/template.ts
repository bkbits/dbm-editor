/**
 * 模板仓库：表模板/字典分类模板 CRUD + 代码生成（zip 打包下载 / 上传替换）
 * （reactive 对象工厂形态，由 DBManagerView 经上下文注入，不依赖 Pinia；
 *   模板读写经 ManagerApi，Template.templateName ↔ 应用内部 CodeTemplate.name 适配）
 */
import { reactive } from 'vue'
import { message } from 'antdv-next'
import JSZip from 'jszip'
import { useDBManagerContext } from './context'
import type { CodeTemplate, GeneratedFile, ManagerApi, TableVO, Template } from '@/types/model'
import { errorMessageOf } from '@/api/manager-api'
import { renderDictCategoryTemplate, renderTemplate } from '@/utils/render'
import { uid } from '@/utils/id'
import type { DictStore } from './dict'
import type { ModelStore } from './model'
import type { SettingsStore } from './settings'

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T
}

/** 工厂依赖 */
export interface TemplateDeps {
  getApi: () => ManagerApi
  getModel: () => ModelStore
  getSettings: () => SettingsStore
  getDict: () => DictStore
}

export function createTemplateStore(deps: TemplateDeps) {
  return reactive({
    loaded: false,
    loading: false,
    templates: [] as CodeTemplate[],
    /** 字典分类模板（仅一个；null = 未加载） */
    dictCategoryTemplate: null as CodeTemplate | null,
    /** 实时编辑预览状态 */
    previewTableId: '',

    get templateNames(): string[] {
      return this.templates.map((t) => t.name)
    },
    get templateNamesSet(): Set<string> {
      return new Set(this.templates.map((t) => t.name))
    },

    async init() {
      if (this.loaded || this.loading) return
      this.loading = true
      try {
        const api = deps.getApi()
        this.templates = (await api.getTemplates()).map((t) => ({
          id: t.id,
          name: t.templateName,
          content: t.content,
        }))
        const dictTpl = await api.getDictCategoryTemplate()
        this.dictCategoryTemplate = {
          id: dictTpl.id,
          name: dictTpl.templateName,
          content: dictTpl.content,
        }
        this.loaded = true
      } catch (e) {
        message.error(errorMessageOf(e, '模板加载失败'))
      } finally {
        this.loading = false
      }
    },
    async saveTemplate(draft: CodeTemplate) {
      try {
        const api = deps.getApi()
        if (draft.id) {
          const spec: Template = { id: draft.id, templateName: draft.name, content: draft.content }
          await api.updateTemplate(spec)
          const idx = this.templates.findIndex((t) => t.id === draft.id)
          if (idx >= 0) this.templates[idx] = clone({ ...draft })
          return draft
        }
        const spec: Template = { id: uid('tpl-'), templateName: draft.name, content: draft.content }
        await api.addTemplate(spec)
        const created: CodeTemplate = { id: spec.id, name: draft.name, content: draft.content }
        this.templates.push(clone(created))
        return created
      } catch (e) {
        message.error(errorMessageOf(e, '模板保存失败'))
        throw e
      }
    },
    async removeTemplate(id: string) {
      try {
        await deps.getApi().removeTemplate(id)
        this.templates = this.templates.filter((t) => t.id !== id)
      } catch (e) {
        message.error(errorMessageOf(e, '模板删除失败'))
        throw e
      }
    },
    /** 保存字典分类模板（仅一个，无新增/删除） */
    async saveDictCategoryTemplate(draft: CodeTemplate) {
      try {
        const spec: Template = { id: draft.id, templateName: draft.name, content: draft.content }
        await deps.getApi().updateDictCategoryTemplate(spec)
        this.dictCategoryTemplate = { id: draft.id, name: draft.name, content: draft.content }
        return this.dictCategoryTemplate
      } catch (e) {
        message.error(errorMessageOf(e, '字典分类模板保存失败'))
        throw e
      }
    },
    newTemplateDraft() {
      let name = 'new_template'
      let n = 1
      while (this.templateNamesSet.has(name)) name = `new_template_${n++}`
      return { id: '', name, content: '' } as CodeTemplate
    },

    /* ==================== 渲染 ==================== */

    /** 渲染单个模板（预览用，失败返回带 error 的结果） */
    renderFor(template: Pick<CodeTemplate, 'name' | 'content'>, tableId: string) {
      const model = deps.getModel()
      const vo = model.getVO(tableId)
      if (!vo) return null
      const category = model.categoryById(vo.categoryId)
      return renderTemplate(
        template.name,
        template.content,
        vo,
        category?.basePackage || '',
        deps.getSettings().snapshot(),
      )
    },

    /** 解析表级启用模板（Table.templates 逗号分割；空 = 启用全部） */
    enabledTemplatesOf(table: Pick<TableVO, 'templates'>): Set<string> | null {
      const raw = String(table.templates ?? '').trim()
      if (!raw) return null
      const names = raw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
      return names.length ? new Set(names) : null
    },

    /**
     * 批量生成代码文件
     * @param tableIds 目标表
     * @param templateNames 本次选中的模板名称（缺省 = 全部模板）；
     *   与表级「启用模板」（Table.templates）取交集，模板内置
     *   context.aborted = true 的产物不进入结果
     */
    generateFiles(
      tableIds: string[],
      templateNames?: string[],
      dictEnabled?: boolean,
    ): {
      files: GeneratedFile[]
      errors: string[]
      aborted: string[]
    } {
      const model = deps.getModel()
      const settings = deps.getSettings().snapshot()
      const selected = templateNames?.length ? new Set(templateNames) : null
      const files: GeneratedFile[] = []
      const errors: string[] = []
      const aborted: string[] = []
      for (const tableId of tableIds) {
        const vo: TableVO | null = model.getVO(tableId)
        if (!vo) continue
        const category = model.categoryById(vo.categoryId)
        const basePackage = category?.basePackage || ''
        const enabled = this.enabledTemplatesOf(vo)
        for (const tpl of this.templates) {
          if (selected && !selected.has(tpl.name)) continue
          if (enabled && !enabled.has(tpl.name)) continue
          const out = renderTemplate(tpl.name, tpl.content, vo, basePackage, settings)
          if (out.aborted) {
            aborted.push(`[${vo.tableName}/${tpl.name}]`)
            continue
          }
          if (out.error) {
            errors.push(`[${vo.tableName}/${tpl.name}] ${out.error}`)
          }
          files.push({
            templateName: tpl.name,
            tableName: vo.tableName,
            fileName: out.fileName,
            filePath: String(out.filePath || '')
              .replace(/\\/g, '/')
              .replace(/^\/+/, ''),
            content: out.result || '',
          })
        }
      }
      // 字典分类模板：每个字典分类执行一次（产物含该分类下全部字典与值）；
      // dictEnabled 缺省视为开启（与「默认生成」语义一致）；未分类字典不参与
      if (dictEnabled !== false && this.dictCategoryTemplate) {
        const dictStore = deps.getDict()
        const dictTpl = this.dictCategoryTemplate
        const byCat = new Map<string, typeof dictStore.dicts>()
        for (const d of dictStore.dicts) {
          if (!d.categoryId) continue
          const list = byCat.get(d.categoryId) || []
          list.push(d)
          byCat.set(d.categoryId, list)
        }
        for (const category of dictStore.categories) {
          const dicts = byCat.get(category.id) || []
          if (!dicts.length) continue
          const out = renderDictCategoryTemplate(
            dictTpl.name,
            dictTpl.content,
            category,
            dicts,
            settings,
          )
          if (out.aborted) {
            aborted.push(`[dict:${category.name}]`)
            continue
          }
          if (out.error) {
            errors.push(`[dict:${category.name}] ${out.error}`)
          }
          files.push({
            templateName: dictTpl.name,
            tableName: `dict:${category.name}`,
            fileName: out.fileName,
            filePath: String(out.filePath || '')
              .replace(/\\/g, '/')
              .replace(/^\/+/, ''),
            content: out.result || '',
          })
        }
      }
      return { files, errors, aborted }
    },

    /** 将生成文件打包为 zip Blob */
    async buildZip(files: GeneratedFile[]): Promise<Blob> {
      const zip = new JSZip()
      for (const f of files) {
        zip.file(f.filePath || f.fileName, f.content)
      }
      return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' })
    },

    /** 触发浏览器下载 */
    downloadBlob(blob: Blob, filename: string) {
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 3000)
    },

    /** 代码生成：直接触发下载 zip（templateNames 为本次选中的模板，缺省全部；
     *  dictEnabled = 是否生成字典分类代码，缺省生成） */
    async generateAndDownload(tableIds: string[], templateNames?: string[], dictEnabled?: boolean) {
      if (!this.templates.length && !this.dictCategoryTemplate) {
        message.warning('请先在「模板管理」中创建代码模板')
        return
      }
      const { files, errors, aborted } = this.generateFiles(tableIds, templateNames, dictEnabled)
      if (!files.length) {
        message.warning(
          aborted.length
            ? '未生成任何文件：产物均被丢弃（aborted）或未选中，请检查表选项与启用模板'
            : '未生成任何文件，请检查选择范围与模板',
        )
        return
      }
      const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '')
      const zip = await this.buildZip(files)
      this.downloadBlob(zip, `codegen-${stamp}.zip`)
      if (errors.length) {
        message.warning(`已生成 ${files.length} 个文件，其中 ${errors.length} 个模板渲染失败`)
      } else {
        const dropTip = aborted.length ? `，丢弃 ${aborted.length} 个模板产物` : ''
        message.success(`已生成并下载 ${files.length} 个代码文件${dropTip}`)
      }
    },

    /** 代码替换：构建 zip 并经 ManagerApi.replace 上传（调用前必须经用户确认）
     *  （成功反馈由 api 实现自行处理，失败 reject 向上传播） */
    async replaceWithGenerated(
      tableIds: string[],
      templateNames?: string[],
      dictEnabled?: boolean,
    ) {
      if (!this.templates.length && !this.dictCategoryTemplate) {
        message.warning('请先在「模板管理」中创建代码模板')
        return null
      }
      const { files } = this.generateFiles(tableIds, templateNames, dictEnabled)
      if (!files.length) {
        message.warning('未生成任何文件，请检查选择范围与模板')
        return null
      }
      const zip = await this.buildZip(files)
      await deps.getApi().replace(zip)
      return true
    },

    newTemplateId(): string {
      return uid('tpl-')
    },
  })
}

export type TemplateStore = ReturnType<typeof createTemplateStore>

/** 子组件取用模板仓库（须处于 DBManagerView 组件树内） */
export function useTemplateStore(): TemplateStore {
  return useDBManagerContext().template
}
