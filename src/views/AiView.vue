<script setup lang="ts">
/**
 * AI 工具页：AGENT 交互界面（页面级编排）
 *
 * 由原 1913 行单文件拆分为本文件 + src/views/ai/ 子组件（行为等价拆分）：
 * - AiTaskPanel：左侧任务清单（模型按模板同步；执行中 / 未开始 / 已完成 /
 *   暂停四态醒目展示，中止后执行中任务转暂停，下轮发送时同步给模型）
 * - AiChatPane：中间聊天（消息列表 + 空态引导 + 输入区；助手正文经
 *   markstream-vue 流式 Markdown 渲染，思考内容为可收缩块）
 * - AiMessageItem：单条消息（压缩分隔条 / 思考块贴底跟随 / 工具调用芯片 /
 *   token 用量标签 / 错误与中止提示）
 * - AiToolRecordsPane：右侧能力调用记录（默认收起详情；代码生成记录提供
 *   zip 下载），经 ref 暴露 locate(callId) 供聊天区芯片点击定位
 * - AiReplaceConfirmModal：代码替换触发时的文件清单确认框
 * - AiDangerConfirmModal：resetDemo / removeAll 等危险工具触发时的确认框
 * 本文件仅负责三栏布局与跨面板联动（芯片点击 → 右侧记录定位）。
 */
import { ref } from "vue";
import AiTaskPanel from "./ai/AiTaskPanel.vue";
import AiChatPane from "./ai/AiChatPane.vue";
import AiToolRecordsPane from "./ai/AiToolRecordsPane.vue";
import AiReplaceConfirmModal from "./ai/AiReplaceConfirmModal.vue";
import AiDangerConfirmModal from "./ai/AiDangerConfirmModal.vue";

/** 右侧记录面板引用：接收聊天区工具芯片的 locate 事件并定位对应记录 */
const recordsPane = ref<InstanceType<typeof AiToolRecordsPane> | null>(null);
</script>

<template>
  <div class="ai-view">
    <div class="ai-layout">
      <!-- 左侧：当前任务清单 -->
      <AiTaskPanel />

      <!-- 中间：聊天 -->
      <AiChatPane @locate="(id) => recordsPane?.locate(id)" />

      <!-- 右侧：能力调用记录 -->
      <AiToolRecordsPane ref="recordsPane" />
    </div>

    <!-- 代码替换确认：先列出将被覆盖的文件，用户确认后才写回 -->
    <AiReplaceConfirmModal />

    <!-- 危险操作确认：resetDemo / removeAll 等先经用户确认再执行 -->
    <AiDangerConfirmModal />
  </div>
</template>

<style lang="scss" scoped>
.ai-view {
  height: 100%;
  padding: 12px 14px;
  min-height: 0;
}

.ai-layout {
  height: 100%;
  display: flex;
  gap: 12px;
  min-height: 0;
}

/* 移动端适配：三栏改纵向堆叠（子面板自身的响应式规则在各自组件内） */
@media (max-width: 768px) {
  .ai-view {
    padding: 8px;
  }

  .ai-layout {
    flex-direction: column;
  }
}
</style>
