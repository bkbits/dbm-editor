<script setup lang="ts">
/**
 * 设置页 · 分区三：主键 / 审计 / 逻辑删除字段约定
 *
 * 从原 SettingsView.vue 单文件拆出。约定「编辑表」对话框一键补齐的主键、
 * 四个审计字段与逻辑删除字段的名称 / 数据库类型 / Java 类型（留空时按
 * 「列默认类型」规则自动推导并随类型联动）。主键固定为每表首字段。
 *
 * 分区契约（defineExpose）：dirty / tip / warning / collect / resetDraft，
 * 语义同 TypeMappingSection。
 */
import { computed, ref, watch } from "vue";
import { KeyRound, RotateCcw } from "@lucide/vue";
import type { FieldConventions } from "@/types/model";
import { useSettingsStore, SETTINGS_JAVA_TYPES } from "@/stores/settings";
import { getJavaTypeByType, COMMON_DB_TYPES } from "@/utils/javaType";
import {
  AUDIT_FIELD_LABELS,
  AUDIT_FIELD_NOT_NULL,
  AUDIT_FIELD_ROLES,
  DEFAULT_FIELD_CONVENTIONS,
  normalizeFieldConventions,
} from "@/utils/fieldConvention";

const props = defineProps<{ id?: string }>();

const settingsStore = useSettingsStore();

const fieldConventions = ref<FieldConventions>(normalizeFieldConventions(undefined));

watch(
  () => settingsStore.fieldConventions,
  (v) => {
    fieldConventions.value = normalizeFieldConventions(v);
  },
  { immediate: true },
);

/** 恢复默认约定（仅本卡片草稿，需保存生效） */
function resetFieldConventions() {
  fieldConventions.value = normalizeFieldConventions(DEFAULT_FIELD_CONVENTIONS);
}

/** 约定类型候选项（与表编辑字段类型一致） */
const convTypeOptions = COMMON_DB_TYPES.map((t) => ({ value: t }));

/** Java 类型下拉候选项（供审计 / 逻辑删除字段的 Java 类型输入） */
const javaTypeOptions = SETTINGS_JAVA_TYPES.map((t) => ({ value: t, label: t }));

/** 按设置的规则推导 Java 类型（先规则后内置，与导入同语义） */
function javaOf(dbType: string): string {
  return settingsStore.matchJavaType(dbType) || getJavaTypeByType(dbType);
}

/** 字段约定校验：名称非空、合法标识符、六个名称（主键/四审计/逻辑删除）互不重复 */
const fieldConventionsInvalid = computed(() => {
  const fc = fieldConventions.value;
  const names = [
    fc.primaryKey.name,
    ...AUDIT_FIELD_ROLES.map((role) => fc.auditFields[role].name),
    fc.logicDelete.name,
  ];
  for (const raw of names) {
    const n = raw.trim();
    if (!n) return "名称不能为空";
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(n)) return `「${raw}」需为合法标识符（字母/数字/下划线）`;
  }
  if (new Set(names.map((n) => n.trim())).size !== names.length)
    return "名称重复：主键、审计与逻辑删除字段间需互不相同";
  return null;
});

/* ==================== 分区契约 ==================== */

const dirty = computed(
  () => JSON.stringify(fieldConventions.value) !== JSON.stringify(settingsStore.fieldConventions),
);

const tip = computed(() =>
  fieldConventionsInvalid.value ? `字段约定无效：${fieldConventionsInvalid.value}` : null,
);

const warning = computed(() =>
  fieldConventionsInvalid.value ? `字段约定无效：${fieldConventionsInvalid.value}` : null,
);

/** 分区保存载荷：归一后的字段约定 */
function collect() {
  return { fieldConventions: normalizeFieldConventions(fieldConventions.value) };
}

/** 放弃修改：从 store 重建草稿 */
function resetDraft() {
  fieldConventions.value = normalizeFieldConventions(settingsStore.fieldConventions);
}

defineExpose({ dirty, tip, warning, collect, resetDraft });
</script>

<template>
  <section :id="props.id" class="settings-card">
    <div class="card-head">
      <span class="card-title"><KeyRound :size="13" /> 主键 / 审计 / 逻辑删除</span>
      <span class="card-sub">表结构字段约定：主键固定首字段，审计与逻辑删除一键增删</span>
    </div>

    <div class="card-intro">
      「编辑表」对话框中，每张表的<b>第一个字段固定为主键</b>（按下方约定生成，不可修改、不可排序，每表强制拥有，Java
      类型按「列默认类型」规则自动推导）；「添加审计字段」按下方约定一键补齐四个审计字段（创建人/创建时间强制非空，更新人/更新时间可空），可整组移除；「添加逻辑删除字段」按下方约定一键补齐软删除标记字段（每表至多一个，强制非空）。名称、类型与审计/逻辑删除字段
      Java 类型保存后对新加入的约定字段生效；Java
      类型留空时按「列默认类型」规则自动推导、随类型联动，设定后固定使用该值；字段名采用数据库蛇形命名，Java
      属性名自动转小驼峰。
    </div>

    <div class="conv-table">
      <div class="conv-grid conv-head">
        <span>字段</span>
        <span>名称</span>
        <span>数据库类型</span>
        <span class="h-center">Java 类型</span>
        <span class="h-center">非空</span>
        <span class="h-center">主键</span>
      </div>
      <div class="conv-row conv-grid conv-pk">
        <span class="conv-label">主键ID</span>
        <a-input
          v-model:value="fieldConventions.primaryKey.name"
          size="small"
          class="mono"
          placeholder="id"
          spellcheck="false"
        />
        <a-auto-complete
          v-model:value="fieldConventions.primaryKey.type"
          :options="convTypeOptions"
          size="small"
          class="mono"
          placeholder="BIGINT"
          :filter-option="
            (input: string, option: any) =>
              String(option.value).toUpperCase().includes(input.toUpperCase())
          "
        />
        <span
          class="conv-java mono"
          :title="`Java 类型（按「列默认类型」规则自动推导）：${javaOf(fieldConventions.primaryKey.type)}`"
        >
          {{ javaOf(fieldConventions.primaryKey.type) }}
        </span>
        <span class="conv-tag required">非空</span>
        <span class="conv-tag pk">主键</span>
      </div>
      <div v-for="role in AUDIT_FIELD_ROLES" :key="role" class="conv-row conv-grid">
        <span class="conv-label">{{ AUDIT_FIELD_LABELS[role] }}</span>
        <a-input
          v-model:value="fieldConventions.auditFields[role].name"
          size="small"
          class="mono"
          :placeholder="DEFAULT_FIELD_CONVENTIONS.auditFields[role].name"
          spellcheck="false"
        />
        <a-auto-complete
          v-model:value="fieldConventions.auditFields[role].type"
          :options="convTypeOptions"
          size="small"
          class="mono"
          :placeholder="fieldConventions.auditFields[role].type"
          :filter-option="
            (input: string, option: any) =>
              String(option.value).toUpperCase().includes(input.toUpperCase())
          "
        />
        <a-auto-complete
          v-model:value="fieldConventions.auditFields[role].javaType"
          :options="javaTypeOptions"
          size="small"
          class="mono conv-java-input"
          allow-clear
          :placeholder="javaOf(fieldConventions.auditFields[role].type)"
          :filter-option="
            (input: string, option: any) =>
              String(option.value).toLowerCase().includes(input.toLowerCase())
          "
        />
        <span class="conv-tag" :class="AUDIT_FIELD_NOT_NULL[role] ? 'required' : 'optional'">
          {{ AUDIT_FIELD_NOT_NULL[role] ? "非空" : "可空" }}
        </span>
        <span class="conv-dash">—</span>
      </div>
      <div class="conv-row conv-grid conv-logic">
        <span class="conv-label">逻辑删除</span>
        <a-input
          v-model:value="fieldConventions.logicDelete.name"
          size="small"
          class="mono"
          :placeholder="DEFAULT_FIELD_CONVENTIONS.logicDelete.name"
          spellcheck="false"
        />
        <a-auto-complete
          v-model:value="fieldConventions.logicDelete.type"
          :options="convTypeOptions"
          size="small"
          class="mono"
          :placeholder="DEFAULT_FIELD_CONVENTIONS.logicDelete.type"
          :filter-option="
            (input: string, option: any) =>
              String(option.value).toUpperCase().includes(input.toUpperCase())
          "
        />
        <a-auto-complete
          v-model:value="fieldConventions.logicDelete.javaType"
          :options="javaTypeOptions"
          size="small"
          class="mono conv-java-input"
          allow-clear
          :placeholder="javaOf(fieldConventions.logicDelete.type)"
          :filter-option="
            (input: string, option: any) =>
              String(option.value).toLowerCase().includes(input.toLowerCase())
          "
        />
        <span class="conv-tag required">非空</span>
        <span class="conv-dash">—</span>
      </div>
    </div>

    <div class="conv-foot">
      <a-button size="small" @click="resetFieldConventions">
        <template #icon><RotateCcw :size="12" /></template>
        恢复默认
      </a-button>
      <span v-if="fieldConventionsInvalid" class="conv-invalid">
        {{ fieldConventionsInvalid }}
      </span>
      <span v-else class="conv-tip">
        默认：id / create_by / create_time / update_by / update_time / deleted（Java
        属性名自动转小驼峰；非空约束为固定语义，随字段角色而定；审计与逻辑删除字段 Java 类型留空 =
        按类型映射自动推导；逻辑删除每表至多一个）
      </span>
    </div>
  </section>
</template>

<style lang="scss" scoped>
@use "./card.scss";

.conv-table {
  .conv-grid {
    display: grid;
    grid-template-columns: 76px minmax(110px, 1fr) minmax(130px, 1fr) 110px 56px 44px;
    gap: 4px 8px;
    align-items: center;
  }

  .conv-head {
    padding: 2px 4px 6px;
    font-size: 11px;
    color: var(--dbm-text-3);
    border-bottom: 1px solid var(--dbm-border);

    .h-center {
      text-align: center;
    }
  }

  .conv-row {
    padding: 3px 2px;
    border-radius: var(--dbm-radius-s);

    &:hover {
      background: var(--dbm-bg-hover);
    }

    .conv-label {
      font-size: 12px;
      font-weight: 600;
      color: var(--dbm-text-2);
      white-space: nowrap;
    }

    .conv-java {
      font-size: 11.5px;
      color: var(--dbm-text-3);
      text-align: center;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    /* 审计字段 Java 类型输入（可编辑，留空 placeholder 展示推导值） */
    .conv-java-input {
      width: 100%;
      text-align: center;

      :deep(.ant-input) {
        text-align: center;
      }
    }

    .conv-tag {
      display: inline-block;
      width: 100%;
      text-align: center;
      font-size: 10.5px;
      line-height: 18px;
      border-radius: 3px;

      &.required {
        color: var(--dbm-warning);
        background: var(--dbm-warning-weak);
      }

      &.optional {
        color: var(--dbm-text-3);
        background: var(--dbm-bg-hover);
      }

      &.pk {
        color: var(--dbm-primary-text);
        background: var(--dbm-primary-weak);
      }
    }

    .conv-dash {
      text-align: center;
      color: var(--dbm-text-3);
    }

    &.conv-pk .conv-label {
      color: var(--dbm-primary-text);
    }

    /* 逻辑删除行标签以信息色区分（软删除语义） */
    &.conv-logic .conv-label {
      color: var(--dbm-info);
    }
  }
}

.conv-foot {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 10px;
  flex-wrap: wrap;

  .conv-invalid {
    font-size: 11.5px;
    color: var(--dbm-danger);
  }

  .conv-tip {
    font-size: 11px;
    color: var(--dbm-text-3);
  }
}

/* 移动端：六列压缩为两列（标签+名称一行，类型自动换行下沉） */
@media (max-width: 768px) {
  .conv-table .conv-grid {
    grid-template-columns: minmax(90px, 1fr) minmax(110px, 1fr);
    gap: 4px 8px;

    /* 隐藏表头的 Java 类型 / 非空 / 主键三列（移动端不展示推导与徽标列） */
    .conv-head > :nth-child(4),
    .conv-head > :nth-child(5),
    .conv-head > :nth-child(6) {
      display: none;
    }

    /* 数据行隐藏后三列（Java/非空/主键占位），保留 标签、名称、类型 */
    .conv-row > :nth-child(4),
    .conv-row > :nth-child(5),
    .conv-row > :nth-child(6) {
      display: none;
    }

    .conv-label {
      justify-self: stretch;
    }
  }
}
</style>
