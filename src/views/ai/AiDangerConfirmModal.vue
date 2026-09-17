<script setup lang="ts">
/**
 * AI 工具页 · 危险操作确认弹窗
 *
 * AGENT 调用 resetDemo / removeAll 等危险工具时挂起等待用户确认：
 * 弹窗展示操作标题与危险性说明，用户点确认按钮才真正执行，
 * 取消则放弃本次操作（resolve(false)，工具以错误结果回填模型）。
 * 与代码替换确认（AiReplaceConfirmModal）是两条独立链路。
 */
import { AlertTriangle } from "@lucide/vue";
import { useAiStore } from "@/stores/ai";

const ai = useAiStore();
</script>

<template>
  <!-- 危险操作确认：resetDemo / removeAll 等先经用户确认再执行 -->
  <a-modal
    :open="Boolean(ai.pendingDanger)"
    :title="ai.pendingDanger?.title || '确认操作'"
    :width="480"
    :mask-closable="false"
    :keyboard="false"
    :ok-text="ai.pendingDanger?.confirmText || '确认'"
    cancel-text="取消"
    :ok-button-props="{ danger: true }"
    @ok="ai.resolveDanger(true)"
    @cancel="ai.resolveDanger(false)"
  >
    <div class="danger-confirm">
      <p class="dg-tip">
        <AlertTriangle :size="14" class="dg-warn-icon" />
        {{ ai.pendingDanger?.description }}
      </p>
    </div>
  </a-modal>
</template>

<style lang="scss" scoped>
.danger-confirm {
  .dg-tip {
    display: flex;
    align-items: flex-start;
    gap: 7px;
    margin: 0;
    font-size: 12.5px;
    line-height: 1.7;
    color: var(--dbm-text-2);

    .dg-warn-icon {
      flex-shrink: 0;
      margin-top: 3px;
      color: var(--dbm-warning);
    }
  }
}
</style>
