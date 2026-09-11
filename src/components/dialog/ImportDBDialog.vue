<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { message } from 'antdv-next'
import type { DBTable } from '@/types/model'
import { useUiStore } from '@/stores/ui'
import { useModelStore } from '@/stores/model'
import { useCanvasStore } from '@/stores/canvas'
import { useSettingsStore } from '@/stores/settings'
import { useManagerApi, errorMessageOf } from '@/api/manager-api'
import { getJavaTypeByType } from '@/utils/javaType'

const ui = useUiStore()
const model = useModelStore()
const canvas = useCanvasStore()
const settingsStore = useSettingsStore()
const api = useManagerApi()

const dialogOpen = computed(() => ui.importDB.open)

const loading = reactive({ fetching: false, importing: false })
const dbTables = ref<DBTable[]>([])
const selected = reactive(new Set<string>())
const categoryId = ref('')

async function fetchDefs() {
  loading.fetching = true
  try {
    dbTables.value = await api.value.importFromDB()
    selected.clear()
  } catch (e) {
    message.error(errorMessageOf(e, '查询数据库结构失败'))
  } finally {
    loading.fetching = false
  }
}

watch(dialogOpen, (open) => {
  if (open) {
    categoryId.value = model.categories[0]?.id ?? ''
    if (!dbTables.value.length) fetchDefs()
    // 列默认类型规则预取：导入字段 Java 类型默认值由设置规则推导
    settingsStore.init()
  }
})

const categoryOptions = computed(() =>
  model.categories.map((c) => ({ value: c.id, label: `${c.name}（${c.basePackage}）` })),
)

function toggle(tableName: string) {
  if (selected.has(tableName)) selected.delete(tableName)
  else selected.add(tableName)
}

const canImport = computed(() => Boolean(categoryId.value) && selected.size > 0)

/** 字段 Java 类型预览：设置规则第一条命中优先，未命中回退内置映射 */
function previewJavaType(type: string): string {
  if (!settingsStore.loaded) return ''
  return settingsStore.matchJavaType(type) ?? getJavaTypeByType(type)
}

/** 悬停预览：字段推导 + 索引归一化结果 */
function columnPreview(t: DBTable): string {
  const lines = t.columns.map((c) => {
    const jt = previewJavaType(c.type)
    return jt ? `${c.columnName}  ${c.type} → ${jt}` : `${c.columnName}  ${c.type}`
  })
  const types = settingsStore.indexTypeOptions
  for (const idx of t.indexes || []) {
    const raw = String(idx.type || '')
      .trim()
      .toUpperCase()
    const normalized = types.includes(raw) ? raw : types[0]
    lines.push(`[索引] ${idx.indexName}  ${idx.type} → ${normalized}（${idx.columns.join(', ')}）`)
  }
  return lines.join('\n')
}

async function doImport() {
  if (!canImport.value) return
  loading.importing = true
  try {
    const defs = dbTables.value.filter((t) => selected.has(t.tableName))
    const ids = await model.importFromDB(categoryId.value, defs)
    message.success(`已从数据库导入 ${ids.length} 张表`)
    ui.closeImportDB()
    canvas.setSelection(ids)
    if (ids.length) canvas.fitAll()
  } catch (e) {
    message.error(errorMessageOf(e, '导入失败'))
  } finally {
    loading.importing = false
  }
}
</script>

<template>
  <a-modal
    :open="dialogOpen"
    title="从数据库导入表"
    :width="640"
    :mask-closable="false"
    @cancel="ui.closeImportDB()"
  >
    <template #footer>
      <a-button @click="ui.closeImportDB()">取消</a-button>
      <a-button
        type="primary"
        :loading="loading.importing"
        :disabled="!canImport"
        @click="doImport"
      >
        导入所选（{{ selected.size }}）
      </a-button>
    </template>

    <a-spin :spinning="loading.fetching">
      <div class="import-head">
        <div class="item">
          <label>导入到分类</label>
          <a-select
            v-model:value="categoryId"
            :options="categoryOptions"
            size="small"
            style="width: 260px"
          />
        </div>
        <a-button size="small" @click="fetchDefs">重新查询</a-button>
      </div>

      <div class="import-tip">
        字段 Java 类型默认值由「系统设置 →
        列默认类型」规则依序正则匹配推导（悬停查看各字段推导结果）；未命中时回退内置类型映射。索引类型不在设置列表时归一为列表首项，悬停可预览归一化结果。
      </div>

      <div class="db-table-list">
        <div
          v-for="t in dbTables"
          :key="t.tableName"
          class="db-table-row"
          :class="{ checked: selected.has(t.tableName) }"
          @click="toggle(t.tableName)"
        >
          <a-checkbox :checked="selected.has(t.tableName)" @click.prevent />
          <div class="db-table-info">
            <div class="db-name mono">{{ t.tableName }}</div>
            <div class="db-comment">{{ t.comment }}</div>
          </div>
          <div class="db-cols mono" :title="columnPreview(t)">
            {{ t.columns.length }} 个字段<template v-if="t.indexes?.length">
              / {{ t.indexes.length }} 索引</template
            >
          </div>
        </div>
        <a-empty v-if="!dbTables.length && !loading.fetching" description="未查询到表结构" />
      </div>
    </a-spin>
  </a-modal>
</template>

<style lang="scss" scoped>
.import-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  margin-bottom: 10px;

  .item {
    display: flex;
    flex-direction: column;
    gap: 4px;

    label {
      font-size: 11.5px;
      color: var(--text-2);
    }
  }
}

.import-tip {
  font-size: 11.5px;
  color: var(--text-3);
  background: var(--bg-2);
  border: 1px dashed var(--border);
  border-radius: var(--radius-m);
  padding: 6px 10px;
  margin-bottom: 10px;
  line-height: 1.6;
}

.db-table-list {
  max-height: 320px;
  overflow-y: auto;
  border: 1px solid var(--border);
  border-radius: var(--radius-m);
  padding: 4px;
}

.db-table-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 10px;
  border-radius: var(--radius-s);
  cursor: pointer;

  &:hover {
    background: var(--bg-hover);
  }

  &.checked {
    background: var(--primary-weak);
  }

  .db-table-info {
    flex: 1;
    min-width: 0;

    .db-name {
      font-size: 12.5px;
      font-weight: 600;
      color: var(--text-1);
    }

    .db-comment {
      font-size: 11px;
      color: var(--text-3);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  }

  .db-cols {
    font-size: 11px;
    color: var(--text-3);
    flex-shrink: 0;
  }
}
</style>
