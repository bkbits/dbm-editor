<script setup lang="ts">
/**
 * 模板选择对话框：代码生成 / 代码替换前，让用户勾选本次参与的模板（默认全部选中）。
 * 确认后回传所选模板名称列表；与表级「启用模板」（Table.templates）取交集后生效。
 */
import { computed, ref, watch } from 'vue'
import { FileCode } from '@lucide/vue'
import { useTemplateStore } from '@/stores/template'

const props = defineProps<{
  open: boolean
  /** generate：生成并下载 zip；replace：进入替换确认流程 */
  mode: 'generate' | 'replace'
}>()

const emit = defineEmits<{
  (e: 'update:open', v: boolean): void
  (e: 'confirm', templateNames: string[], dictEnabled: boolean): void
}>()

const templateStore = useTemplateStore()

/** 所选模板名称（打开时重置为全部选中） */
const checked = ref<string[]>([])

/** 是否生成字典分类模板代码（每个字典分类一个文件；默认生成） */
const dictEnabled = ref(true)

watch(
  () => props.open,
  (open) => {
    if (!open) return
    templateStore.init()
    checked.value = [...templateStore.templateNames]
    dictEnabled.value = true
  },
)

/** 模板列表异步加载后保持「全选」默认态（尚未手动改动时） */
watch(
  () => templateStore.templateNames,
  (names) => {
    if (props.open && !checked.value.length) checked.value = [...names]
  },
)

const templates = computed(() => templateStore.templates)

const allChecked = computed(
  () => templates.value.length > 0 && checked.value.length === templates.value.length,
)

function toggleAll() {
  checked.value = allChecked.value ? [] : [...templateStore.templateNames]
}

function toggleOne(name: string, v: boolean) {
  if (v) {
    if (!checked.value.includes(name)) checked.value = [...checked.value, name]
  } else {
    checked.value = checked.value.filter((n) => n !== name)
  }
}

function onCancel() {
  emit('update:open', false)
}

function onConfirm() {
  if (!checked.value.length && !dictEnabled.value) return
  emit('confirm', [...checked.value], dictEnabled.value)
  emit('update:open', false)
}
</script>

<template>
  <a-modal
    :open="open"
    :title="mode === 'generate' ? '代码生成：选择模板' : '代码替换：选择模板'"
    width="min(460px, 94vw)"
    wrap-class-name="dbm-modal-wrap"
    :mask-closable="false"
    @cancel="onCancel"
  >
    <template #footer>
      <a-button @click="onCancel">取消</a-button>
      <a-button type="primary" :disabled="!checked.length && !dictEnabled" @click="onConfirm">
        {{ mode === 'generate' ? '生成并下载' : '下一步：确认替换' }}
      </a-button>
    </template>

    <p class="select-tip">
      勾选本次要生成代码文件的表模板（默认全选）；表级「启用模板」配置仍会一并生效，
      模板内标记丢弃（aborted）的产物不会打包。
    </p>

    <div class="dict-toggle">
      <a-checkbox v-model:checked="dictEnabled">
        生成字典分类模板代码
        <span class="toggle-hint">（每个字典分类一个文件，含分类下全部字典与值）</span>
      </a-checkbox>
    </div>

    <div class="tpl-list">
      <div class="list-head">
        <a-checkbox
          :checked="allChecked"
          :indeterminate="checked.length > 0 && !allChecked"
          @change="toggleAll"
        >
          全选（{{ checked.length }}/{{ templates.length }}）
        </a-checkbox>
      </div>
      <div class="list-body">
        <label v-for="t in templates" :key="t.id" class="tpl-item">
          <a-checkbox
            :checked="checked.includes(t.name)"
            @update:checked="(v: boolean) => toggleOne(t.name, v)"
          >
            <span class="tpl-name mono">{{ t.name }}</span>
            <span class="tpl-size">{{ (t.content.length / 1024).toFixed(1) }}k</span>
          </a-checkbox>
        </label>
        <div v-if="!templates.length" class="list-empty">
          <FileCode :size="14" />
          暂无模板，请先在「模板管理」中创建
        </div>
      </div>
    </div>
  </a-modal>
</template>

<style lang="scss" scoped>
.select-tip {
  margin: 0 0 10px;
  font-size: 12px;
  line-height: 1.7;
  color: var(--dbm-text-2);
}

.dict-toggle {
  margin-bottom: 10px;
  padding: 7px 12px;
  border: 1px solid var(--dbm-border);
  border-radius: var(--dbm-radius-m);
  background: var(--dbm-bg-2);
  font-size: 12px;

  .toggle-hint {
    color: var(--dbm-text-3);
    font-size: 11px;
  }
}

.tpl-list {
  border: 1px solid var(--dbm-border);
  border-radius: var(--dbm-radius-m);
  overflow: hidden;
}

.list-head {
  display: flex;
  align-items: center;
  padding: 7px 12px;
  border-bottom: 1px solid var(--dbm-border);
  background: var(--dbm-bg-2);
  font-size: 12px;
}

.list-body {
  max-height: 260px;
  overflow-y: auto;
  padding: 4px 8px;
}

.tpl-item {
  display: flex;
  align-items: center;
  padding: 3px 6px;
  border-radius: var(--dbm-radius-s);
  cursor: pointer;

  &:hover {
    background: var(--dbm-bg-hover);
  }

  :deep(.ant-checkbox-wrapper) {
    width: 100%;
  }

  .tpl-name {
    font-size: 12.5px;
    font-weight: 600;
    color: var(--dbm-text-1);
  }

  .tpl-size {
    margin-left: 8px;
    font-size: 10px;
    color: var(--dbm-text-3);
    font-family: var(--dbm-font-mono);
  }
}

.list-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 26px 0;
  text-align: center;
  color: var(--dbm-text-3);
  font-size: 12px;
}
</style>
