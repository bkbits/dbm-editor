<script setup lang="ts">
import { computed, reactive } from 'vue'
import { AlertTriangle } from '@lucide/vue'
import { useUiStore } from '@/stores/ui'
import { useTemplateStore } from '@/stores/template'
import { useManagerApi, errorMessageOf } from '@/api/manager-api'
import { message } from 'antdv-next'

const ui = useUiStore()
const templateStore = useTemplateStore()
const api = useManagerApi()

const dialogOpen = computed(() => ui.replaceConfirm.open)
const files = computed(() => ui.replaceConfirm.files)
const loading = reactive({ replacing: false })

const shownFiles = computed(() => files.value.slice(0, 30))

async function confirmReplace() {
  loading.replacing = true
  try {
    const zip = await templateStore.buildZip(files.value)
    // 成功反馈由 api 实现自行处理（demo 实现展示替换文件数）；
    // 异步契约下 zip 解析失败 reject 在此捕获提示
    await api.value.replace(zip)
    ui.closeReplaceConfirm()
  } catch (e: unknown) {
    message.error(errorMessageOf(e, '代码替换失败'))
  } finally {
    loading.replacing = false
  }
}
</script>

<template>
  <a-modal
    :open="dialogOpen"
    title="确认代码替换"
    :width="620"
    :mask-closable="false"
    @cancel="ui.closeReplaceConfirm()"
  >
    <template #footer>
      <a-button @click="ui.closeReplaceConfirm()">取消</a-button>
      <a-button type="primary" danger :loading="loading.replacing" @click="confirmReplace">
        确认上传并替换
      </a-button>
    </template>

    <div class="replace-warn">
      <AlertTriangle :size="16" />
      <div>
        <p>
          即将通过 <span class="mono">ManagerApi.replace</span> 上传 zip
          并<b>直接替换</b>对应的源码文件。
        </p>
        <p>
          该操作影响面大，请谨慎确认！当前将替换 <b>{{ files.length }}</b> 个文件。
        </p>
      </div>
    </div>

    <div class="replace-files">
      <div class="files-title">文件清单（预览前 30 项）</div>
      <div class="files-body mono">
        <div v-for="(f, i) in shownFiles" :key="i" class="file-line">
          <span class="tpl-name">{{ f.templateName }}</span>
          <span class="file-path">{{ f.filePath }}</span>
        </div>
        <div v-if="files.length > shownFiles.length" class="more">
          … 其余 {{ files.length - shownFiles.length }} 个文件
        </div>
      </div>
    </div>
  </a-modal>
</template>

<style lang="scss" scoped>
.replace-warn {
  display: flex;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid var(--warning);
  background: var(--warning-weak);
  color: var(--warning);
  border-radius: var(--radius-m);
  font-size: 12.5px;

  svg {
    flex-shrink: 0;
    margin-top: 1px;
  }

  p {
    margin: 0 0 4px;
    &:last-child {
      margin-bottom: 0;
    }

    b {
      color: inherit;
    }
  }
}

.replace-files {
  margin-top: 12px;

  .files-title {
    font-size: 11.5px;
    color: var(--text-2);
    margin-bottom: 4px;
  }

  .files-body {
    max-height: 240px;
    overflow-y: auto;
    border: 1px solid var(--border);
    border-radius: var(--radius-m);
    padding: 6px 10px;
    font-size: 11px;

    .file-line {
      display: flex;
      gap: 10px;
      padding: 1.5px 0;

      .tpl-name {
        color: var(--primary-text);
        width: 80px;
        flex-shrink: 0;
      }

      .file-path {
        color: var(--text-2);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
    }

    .more {
      color: var(--text-3);
      padding-top: 4px;
    }
  }
}
</style>
