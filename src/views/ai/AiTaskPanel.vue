<script setup lang="ts">
/**
 * AI 工具页 · 左侧任务清单面板
 *
 * 从原 AiView.vue 单文件拆出。数据源为 ai store 的 tasks（模型按系统提示
 * 内置的汇报 / 同步消息模板输出任务清单块，store 解析后驱动本面板）。
 * 四态醒目展示：执行中 / 未开始 / 已完成 / 暂停（中止后执行中任务转暂停，
 * 下轮发送时注入暂停任务提示模型续办）。
 */
import { CheckCircle2, Circle, CirclePause, ListTodo, Loader2 } from "@lucide/vue";
import { useAiStore, type AiTaskStatus } from "@/stores/ai";

const ai = useAiStore();

/** 任务状态展示元数据（状态色条类名 / 徽标文案 / 悬浮说明） */
const TASK_STATUS_META: Record<AiTaskStatus, { label: string; cls: string; title: string }> = {
  running: { label: "执行中", cls: "running", title: "正在执行" },
  pending: { label: "未开始", cls: "pending", title: "尚未开始" },
  completed: { label: "已完成", cls: "completed", title: "已完成" },
  paused: { label: "暂停", cls: "paused", title: "已暂停（上轮被中止）" },
};

/** 各状态任务数（面板头部汇总芯片） */
const taskCountBy = (s: AiTaskStatus) => ai.tasks.filter((t) => t.status === s).length;
</script>

<template>
  <aside class="task-pane">
    <div class="task-head">
      <span class="task-title"><ListTodo :size="13" /> 任务清单</span>
      <span v-if="ai.tasks.length" class="task-count">{{ ai.tasks.length }}</span>
    </div>
    <div class="task-summary" v-if="ai.tasks.length">
      <span class="ts-chip running"
        ><Loader2 :size="10" class="spin" /> 执行中 {{ taskCountBy("running") }}</span
      >
      <span class="ts-chip completed"
        ><CheckCircle2 :size="10" /> 完成 {{ taskCountBy("completed") }}</span
      >
      <span class="ts-chip paused"
        ><CirclePause :size="10" /> 暂停 {{ taskCountBy("paused") }}</span
      >
      <span class="ts-chip pending"><Circle :size="10" /> 待办 {{ taskCountBy("pending") }}</span>
    </div>
    <div class="task-list">
      <div v-if="!ai.tasks.length" class="task-empty">
        暂无任务<br />
        <span>复杂任务将在这里展示分步计划与执行进度</span>
      </div>
      <div
        v-for="(t, i) in ai.tasks"
        :key="t.id || i"
        class="task-item"
        :class="TASK_STATUS_META[t.status].cls"
        :title="TASK_STATUS_META[t.status].title"
      >
        <span class="ti-icon">
          <Loader2 v-if="t.status === 'running'" :size="13" class="spin" />
          <CheckCircle2 v-else-if="t.status === 'completed'" :size="13" />
          <CirclePause v-else-if="t.status === 'paused'" :size="13" />
          <Circle v-else :size="13" />
        </span>
        <span class="ti-label">{{ TASK_STATUS_META[t.status].label }}</span>
        <span class="ti-text">{{ t.title }}</span>
      </div>
    </div>
  </aside>
</template>

<style lang="scss" scoped>
.task-pane {
  width: 212px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  background: var(--dbm-bg-panel);
  border: 1px solid var(--dbm-border);
  border-radius: var(--dbm-radius-m);
  overflow: hidden;

  .task-head {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 10px 12px;
    border-bottom: 1px solid var(--dbm-border);
    flex-shrink: 0;

    .task-title {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 12.5px;
      font-weight: 600;
      color: var(--dbm-text-1);
    }

    .task-count {
      margin-left: auto;
      font-size: 11px;
      color: var(--dbm-text-3);
      font-family: var(--dbm-font-mono);
    }
  }

  /* 状态汇总芯片（醒目体现四态） */
  .task-summary {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    padding: 8px 10px;
    border-bottom: 1px solid var(--dbm-border);
    flex-shrink: 0;

    .ts-chip {
      display: inline-flex;
      align-items: center;
      gap: 3px;
      font-size: 10px;
      line-height: 1;
      padding: 3px 6px;
      border-radius: 999px;
      border: 1px solid var(--dbm-border);
      color: var(--dbm-text-3);
      background: var(--dbm-bg-2);

      &.running {
        color: var(--dbm-primary);
        border-color: color-mix(in srgb, var(--dbm-primary) 40%, transparent);
        background: var(--dbm-primary-weak);
        font-weight: 600;
      }

      &.completed {
        color: var(--dbm-success);
        border-color: color-mix(in srgb, var(--dbm-success) 40%, transparent);
        background: var(--dbm-success-weak);
      }

      &.paused {
        color: var(--dbm-warning);
        border-color: color-mix(in srgb, var(--dbm-warning) 40%, transparent);
        background: var(--dbm-warning-weak);
        font-weight: 600;
      }
    }
  }

  .task-list {
    flex: 1;
    overflow-y: auto;
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .task-empty {
    margin: auto;
    padding: 0 10px;
    text-align: center;
    font-size: 11.5px;
    line-height: 1.8;
    color: var(--dbm-text-3);

    span {
      font-size: 10.5px;
      opacity: 0.8;
    }
  }

  /* 任务项：左侧状态色条 + 状态徽标（醒目） */
  .task-item {
    display: flex;
    align-items: flex-start;
    gap: 6px;
    padding: 6px 8px;
    border-radius: var(--dbm-radius-s);
    border: 1px solid var(--dbm-border);
    border-left-width: 3px;
    background: var(--dbm-bg-2);

    .ti-icon {
      flex-shrink: 0;
      margin-top: 1px;
      display: inline-flex;
    }

    .ti-label {
      flex-shrink: 0;
      font-size: 9.5px;
      line-height: 1.5;
      padding: 0 4px;
      border-radius: 4px;
      color: var(--dbm-text-3);
      background: var(--dbm-bg-3);
      white-space: nowrap;
    }

    .ti-text {
      min-width: 0;
      font-size: 11px;
      line-height: 1.55;
      color: var(--dbm-text-2);
      word-break: break-word;
    }

    &.running {
      border-left-color: var(--dbm-primary);

      .ti-icon {
        color: var(--dbm-primary);
      }

      .ti-label {
        color: var(--dbm-primary);
        background: var(--dbm-primary-weak);
        font-weight: 600;
      }

      .ti-text {
        color: var(--dbm-text-1);
      }
    }

    &.completed {
      border-left-color: var(--dbm-success);
      opacity: 0.82;

      .ti-icon {
        color: var(--dbm-success);
      }

      .ti-label {
        color: var(--dbm-success);
        background: var(--dbm-success-weak);
      }

      .ti-text {
        text-decoration: line-through;
        text-decoration-color: color-mix(in srgb, var(--dbm-text-3) 60%, transparent);
      }
    }

    &.paused {
      border-left-color: var(--dbm-warning);
      background: var(--dbm-warning-weak);

      .ti-icon {
        color: var(--dbm-warning);
      }

      .ti-label {
        color: var(--dbm-warning);
        background: color-mix(in srgb, var(--dbm-warning) 18%, transparent);
        font-weight: 600;
      }

      .ti-text {
        color: var(--dbm-text-1);
      }
    }

    &.pending {
      border-left-color: var(--dbm-border-strong);

      .ti-icon {
        color: var(--dbm-text-3);
      }
    }
  }
}

/* 执行中图标旋转（scoped 样式会改写 keyframes 名，须与使用处同文件） */
.spin {
  animation: spin 0.9s linear infinite;
}

@keyframes spin {
  from {
    transform: rotate(0deg);
  }

  to {
    transform: rotate(360deg);
  }
}

/* 移动端适配：任务面板移至底部并限高滚动 */
@media (max-width: 768px) {
  .task-pane {
    width: auto;
    max-height: 30%;
    order: 3;
  }
}
</style>
