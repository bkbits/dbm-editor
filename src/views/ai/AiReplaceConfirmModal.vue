<script setup lang="ts">
/**
 * AI 工具页 · 代码替换确认弹窗
 *
 * 从原 AiView.vue 单文件拆出。AGENT 调用 replaceCode 工具后挂起等待用户
 * 确认：先列出将被覆盖的源码文件清单（文件名 / 路径 / 所属表 / 模板 / 大小），
 * 用户点「确认替换」才真正写回，取消则放弃本次替换（resolve(false)）。
 * 与模板管理的 ReplaceConfirmModal（ui store 驱动）是两条独立链路。
 */
import { AlertTriangle } from "@lucide/vue";
import { useAiStore } from "@/stores/ai";
import { sizeText } from "./format";

const ai = useAiStore();
</script>

<template>
  <!-- 代码替换确认：先列出将被覆盖的文件，用户确认后才写回 -->
  <a-modal
    :open="Boolean(ai.pendingReplace)"
    title="确认代码替换"
    :width="600"
    :mask-closable="false"
    :keyboard="false"
    ok-text="确认替换"
    cancel-text="取消替换"
    :ok-button-props="{ danger: true }"
    @ok="ai.resolveReplace(true)"
    @cancel="ai.resolveReplace(false)"
  >
    <div class="replace-confirm">
      <p class="rp-tip">
        <AlertTriangle :size="14" class="rp-warn-icon" />
        以下 <b>{{ ai.pendingReplace?.files.length ?? 0 }}</b>
        个源码文件将被生成的代码覆盖，该操作不可撤销，请确认后继续：
      </p>
      <div class="rp-list">
        <div v-for="(f, i) in ai.pendingReplace?.files || []" :key="i" class="rp-row">
          <span class="rp-idx">{{ i + 1 }}</span>
          <div class="rp-file">
            <span class="rp-name mono">{{ f.fileName }}</span>
            <span class="rp-path mono">{{ f.filePath }}</span>
          </div>
          <span class="rp-meta"
            >{{ f.tableName }} · {{ f.templateName }} · {{ sizeText(f.size) }}</span
          >
        </div>
      </div>
    </div>
  </a-modal>
</template>

<style lang="scss" scoped>
.replace-confirm {
  .rp-tip {
    display: flex;
    align-items: flex-start;
    gap: 7px;
    margin: 0 0 10px;
    font-size: 12.5px;
    line-height: 1.7;
    color: var(--dbm-text-2);

    .rp-warn-icon {
      flex-shrink: 0;
      margin-top: 3px;
      color: var(--dbm-warning);
    }

    b {
      color: var(--dbm-danger);
    }
  }

  .rp-list {
    max-height: 320px;
    overflow-y: auto;
    border: 1px solid var(--dbm-border);
    border-radius: var(--dbm-radius-m);
    background: var(--dbm-bg-2);
    padding: 4px;
  }

  .rp-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 8px;
    border-radius: var(--dbm-radius-s);

    &:hover {
      background: var(--dbm-bg-hover);
    }

    .rp-idx {
      flex-shrink: 0;
      width: 20px;
      font-size: 10.5px;
      color: var(--dbm-text-3);
      font-family: var(--dbm-font-mono);
      text-align: right;
    }

    .rp-file {
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 1px;

      .rp-name {
        font-size: 12px;
        font-weight: 600;
        color: var(--dbm-text-1);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .rp-path {
        font-size: 10.5px;
        color: var(--dbm-text-3);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
    }

    .rp-meta {
      margin-left: auto;
      flex-shrink: 0;
      font-size: 10.5px;
      color: var(--dbm-text-3);
    }
  }
}
</style>
