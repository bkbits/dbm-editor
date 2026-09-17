<script setup lang="ts">
/**
 * 表编辑对话框 · 「导航」分区
 *
 * 从原 TableEditDialog.vue 单文件拆出。实时列出当前表参与的全部导航关系
 * （视图模型含类型 / 两端表名 / 属性 / 级联），支持编辑（打开导航编辑
 * 对话框）与删除（确认后调模型仓库）；新建表未保存前提示先保存表。
 *
 * 草稿经 props.draft 传入（对话框持有，reactive 对象就地编辑）。
 */
import { computed } from "vue";
import { message } from "antdv-next";
import { Plus } from "@lucide/vue";
import { useUiStore } from "@/stores/ui";
import { useModelStore } from "@/stores/model";
import { NAVIGATE_TYPE_LABEL, CASCADE_LABEL, flipNavigateType } from "@/utils/navigate";
import type { TableEditDraft } from "./columns";

const props = defineProps<{ draft: TableEditDraft }>();

const ui = useUiStore();
const model = useModelStore();

/** 编辑态（已有表）才展示导航列表；新建表提示先保存 */
const isEdit = computed(() => Boolean(props.draft.id));

/** 当前表参与的导航（实时来自 store，删除后即时反映） */
const tableNavs = computed(() => (props.draft.id ? model.navigatesOf(props.draft.id) : []));

/** 导航行视图模型：非 self 端视角翻转类型，两端表名 / 属性 / 级联标签齐备 */
function navView(nav: (typeof tableNavs.value)[number]) {
  const isSelf = nav.self === props.draft.id;
  const type = isSelf ? nav.type : flipNavigateType(nav.type);
  return {
    id: nav.id,
    type,
    typeLabel: NAVIGATE_TYPE_LABEL[type],
    selfName: model.tableById(nav.self)?.tableName ?? "?",
    targetName: model.tableById(nav.target)?.tableName ?? "?",
    selfProp: nav.selfPropertyName,
    targetProp: nav.targetPropertyName,
    cascadeAB: CASCADE_LABEL[nav.selfToTargetCascade],
    cascadeBA: CASCADE_LABEL[nav.targetToSelfCascade],
  };
}

/** 删除导航（确认后调模型仓库） */
async function deleteNavigate(id: string) {
  await model.removeNavigate(id);
  message.success("导航已删除");
}
</script>

<template>
  <div v-if="!isEdit" class="nav-tip">
    <a-alert message="保存表后即可为其创建导航关系" type="info" show-icon />
  </div>
  <template v-else>
    <div class="columns-body nav-body">
      <div v-for="nv in tableNavs.map(navView)" :key="nv.id" class="nav-row">
        <span class="nav-type" :class="`t-${nv.type.toLowerCase()}`">{{ nv.typeLabel }}</span>
        <span class="nav-tables mono">
          {{ nv.selfName }}
          <span class="nav-arrow">-&nbsp;{{ nv.type[0] }}&nbsp;-&nbsp;{{ nv.type[1] }}&nbsp;-</span>
          {{ nv.targetName }}
        </span>
        <span class="nav-props mono" :title="`${nv.selfProp} / ${nv.targetProp}`">
          {{ nv.selfProp }} ⇄ {{ nv.targetProp }}
        </span>
        <span class="nav-cascade">级联：{{ nv.cascadeAB }} / {{ nv.cascadeBA }}</span>
        <span class="nav-actions">
          <a-button size="small" @click="ui.openNavigateEdit(nv.id)">编辑</a-button>
          <a-popconfirm
            title="删除该导航关系？"
            ok-text="删除"
            cancel-text="取消"
            @confirm="deleteNavigate(nv.id)"
          >
            <a-button size="small" danger>删除</a-button>
          </a-popconfirm>
        </span>
      </div>
      <a-empty
        v-if="!tableNavs.length"
        description="该表暂未参与任何导航关系"
        :image-style="{ height: '40px' }"
      />
    </div>
    <a-button
      v-if="isEdit"
      size="small"
      type="dashed"
      block
      class="add-btn"
      @click="ui.openNavigateEdit(null, { self: draft.id })"
    >
      <template #icon><Plus :size="12" /></template>
      新增导航
    </a-button>
  </template>
</template>

<style lang="scss" scoped>
@use "./shared.scss";

/* 导航 tab */
.nav-tip {
  margin-bottom: 8px;
}

.nav-body {
  max-height: 300px;
}

.nav-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 8px;
  border: 1px solid var(--dbm-border);
  border-radius: var(--dbm-radius-m);
  margin-bottom: 6px;
  font-size: 12px;

  .nav-type {
    flex-shrink: 0;
    font-size: 10.5px;
    border-radius: 3px;
    padding: 0 6px;
    line-height: 18px;

    &.t-11 {
      color: var(--dbm-info);
      background: var(--dbm-info-weak);
    }
    &.t-1n {
      color: var(--dbm-success);
      background: var(--dbm-success-weak);
    }
    &.t-n1 {
      color: var(--dbm-warning);
      background: var(--dbm-warning-weak);
    }
    &.t-nn {
      color: var(--dbm-primary-text);
      background: var(--dbm-primary-weak);
    }
  }

  .nav-tables {
    font-weight: 600;
    color: var(--dbm-text-1);

    .nav-arrow {
      color: var(--dbm-text-3);
      font-weight: 400;
    }
  }

  .nav-props {
    color: var(--dbm-text-2);
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .nav-cascade {
    color: var(--dbm-text-3);
    font-size: 11px;
    flex-shrink: 0;
  }

  .nav-actions {
    display: flex;
    gap: 6px;
    flex-shrink: 0;
  }
}
</style>
