<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { message } from 'antdv-next'
import type { DBTableDef } from '@/types/model'
import { useUiStore } from '@/stores/ui'
import { useModelStore } from '@/stores/model'
import { useCanvasStore } from '@/stores/canvas'
import { tableApi } from '@/api/modules'
import { extractErrorMessage } from '@/api/http'

const ui = useUiStore()
const model = useModelStore()
const canvas = useCanvasStore()

const dialogOpen = computed(() => ui.importDB.open)

const loading = reactive({ fetching: false, importing: false })
const dbTables = ref<DBTableDef[]>([])
const selected = reactive(new Set<string>())
const categoryId = ref('')

async function fetchDefs() {
  loading.fetching = true
  try {
    dbTables.value = await tableApi.queryFromDB()
    selected.clear()
  } catch (e) {
    message.error(extractErrorMessage(e, '查询数据库结构失败'))
  } finally {
    loading.fetching = false
  }
}

watch(dialogOpen, (open) => {
  if (open) {
    categoryId.value = model.categories[0]?.id ?? ''
    if (!dbTables.value.length) fetchDefs()
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
    message.error(extractErrorMessage(e, '导入失败'))
  } finally {
    loading.importing = false
  }
}

onMounted(() => {
  // 预取（无弹窗时保持空数据）
})
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
      <a-button type="primary" :loading="loading.importing" :disabled="!canImport" @click="doImport">
        导入所选（{{ selected.size }}）
      </a-button>
    </template>

    <a-spin :spinning="loading.fetching">
      <div class="import-head">
        <div class="item">
          <label>导入到分类</label>
          <a-select v-model:value="categoryId" :options="categoryOptions" size="small" style="width: 260px" />
        </div>
        <a-button size="small" @click="fetchDefs">重新查询</a-button>
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
          <div class="db-cols mono" :title="t.columns.map((c) => c.columnName).join(', ')">
            {{ t.columns.length }} 个字段
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
