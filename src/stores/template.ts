/**
 * 模板仓库：代码模板 CRUD + 代码生成（zip 打包下载 / 上传替换）
 * 模板读写经 ManagerApi（Template.templateName ↔ 应用内部 CodeTemplate.name 适配）
 */
import { defineStore } from 'pinia'
import { message } from 'antdv-next'
import JSZip from 'jszip'
import type { CodeTemplate, GeneratedFile, TableVO, Template } from '@/types/model'
import { getManagerApi, errorMessageOf } from '@/api/manager-api'
import { renderTemplate } from '@/utils/render'
import { uid } from '@/utils/id'
import { useModelStore } from './model'

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T
}

export const useTemplateStore = defineStore('template', {
  state: () => ({
    loaded: false,
    loading: false,
    templates: [] as CodeTemplate[],
    /** 实时编辑预览状态 */
    previewTableId: '',
  }),

  getters: {
    templateNames(): string[] {
      return this.templates.map((t) => t.name)
    },
    templateNamesSet(): Set<string> {
      return new Set(this.templates.map((t) => t.name))
    },
  },

  actions: {
    async init() {
      if (this.loaded || this.loading) return
      this.loading = true
      try {
        this.templates = (await getManagerApi().getTemplates()).map((t) => ({
          id: t.id,
          name: t.templateName,
          content: t.content,
        }))
        this.loaded = true
      } catch (e) {
        message.error(errorMessageOf(e, '模板加载失败'))
      } finally {
        this.loading = false
      }
    },
    async saveTemplate(draft: CodeTemplate) {
      try {
        const api = getManagerApi()
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
        await getManagerApi().removeTemplate(id)
        this.templates = this.templates.filter((t) => t.id !== id)
      } catch (e) {
        message.error(errorMessageOf(e, '模板删除失败'))
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
      const model = useModelStore()
      const vo = model.getVO(tableId)
      if (!vo) return null
      const category = model.categoryById(vo.categoryId)
      return renderTemplate(template.name, template.content, vo, category?.basePackage || '')
    },

    /**
     * 批量生成代码文件
     * @param tableIds 目标表
     */
    generateFiles(tableIds: string[]): { files: GeneratedFile[]; errors: string[] } {
      const model = useModelStore()
      const files: GeneratedFile[] = []
      const errors: string[] = []
      for (const tableId of tableIds) {
        const vo: TableVO | null = model.getVO(tableId)
        if (!vo) continue
        const category = model.categoryById(vo.categoryId)
        const basePackage = category?.basePackage || ''
        for (const tpl of this.templates) {
          const out = renderTemplate(tpl.name, tpl.content, vo, basePackage)
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
      return { files, errors }
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

    /** 代码生成：直接触发下载 zip */
    async generateAndDownload(tableIds: string[]) {
      if (!this.templates.length) {
        message.warning('请先在「模板管理」中创建代码模板')
        return
      }
      const { files, errors } = this.generateFiles(tableIds)
      if (!files.length) {
        message.warning('未生成任何文件，请检查选择范围与模板')
        return
      }
      const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '')
      const zip = await this.buildZip(files)
      this.downloadBlob(zip, `codegen-${stamp}.zip`)
      if (errors.length) {
        message.warning(`已生成 ${files.length} 个文件，其中 ${errors.length} 个模板渲染失败`)
      } else {
        message.success(`已生成并下载 ${files.length} 个代码文件`)
      }
    },

    /** 代码替换：构建 zip 并经 ManagerApi.replace 上传（调用前必须经用户确认）
     *  （成功反馈由 api 实现自行处理，失败 reject 向上传播） */
    async replaceWithGenerated(tableIds: string[]) {
      if (!this.templates.length) {
        message.warning('请先在「模板管理」中创建代码模板')
        return null
      }
      const { files } = this.generateFiles(tableIds)
      if (!files.length) {
        message.warning('未生成任何文件，请检查选择范围与模板')
        return null
      }
      const zip = await this.buildZip(files)
      await getManagerApi().replace(zip)
      return true
    },

    newTemplateId(): string {
      return uid('tpl-')
    },
  },
})
