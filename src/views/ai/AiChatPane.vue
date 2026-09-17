<script setup lang="ts">
/**
 * AI 工具页 · 中间聊天面板
 *
 * 从原 AiView.vue 单文件拆出。职责：
 * - 历史消息列表（AiMessageItem 逐条渲染）与外层容器贴底跟随滚动（上翻
 *   查看历史时不打扰，翻回底部自动恢复）
 * - 空态引导（未配置 AI 服务时的前往配置入口；已配置时的建议问题列表）
 * - 底部输入区：自适应高度 textarea（Enter 发送 / Shift+Enter 换行）、
 *   模型选择、上下文占用与输出速度状态条、新会话与停止生成按钮
 */
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { Bot, Eraser, Send, Settings2, Square } from "@lucide/vue";
import { useAiStore } from "@/stores/ai";
import { useUiStore } from "@/stores/ui";
import AiMessageItem from "./AiMessageItem.vue";
import { fmtTok } from "./format";

const ai = useAiStore();
const ui = useUiStore();

const emit = defineEmits<{ locate: [callId: string] }>();

/* ==================== 聊天滚动跟随 ==================== */

const chatScrollEl = ref<HTMLElement>();
/** 用户停留在底部时流式输出自动跟随滚动（上翻查看历史时不打扰） */
const stickBottom = ref(true);

/** 聊天容器滚动：更新贴底状态 */
function onChatScroll() {
  const el = chatScrollEl.value;
  if (!el) return;
  stickBottom.value = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
}

/** 聊天容器滚到底部 */
function scrollToBottom() {
  const el = chatScrollEl.value;
  if (el) el.scrollTop = el.scrollHeight;
}

/* ==================== 输入区 ==================== */

const input = ref("");
const textareaEl = ref<HTMLTextAreaElement>();

/** textarea 自适应高度：内容增长撑高（上限 160px），发送后收回单行 */
function autoResize() {
  const el = textareaEl.value;
  if (!el) return;
  el.style.height = "auto";
  el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
}

/** 输入：自适应高度重算 */
function onInput() {
  autoResize();
}

/** 发送：空文本或运行中忽略，发送后收回输入框 */
function onSend() {
  const text = input.value.trim();
  if (!text || ai.running) return;
  input.value = "";
  nextTick(autoResize);
  ai.send(text);
}

/** Enter 发送 / Shift+Enter 换行（输入法组词中不抢 Enter） */
function onKeydown(e: KeyboardEvent) {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    onSend();
  }
}

/* ==================== token 用量统计（输入区状态条） ==================== */

/** 当前模型上下文长度（未配置为 0：界面只显示已用量不显示分母） */
const ctxLimit = computed(() => ai.currentModel?.inputContextLength ?? 0);

/** 展示速度：任务进行中显示当前实时速度，停止后显示上一次任务速度 */
const speedTokSec = computed(() =>
  ai.running ? Math.round(ai.currentSpeedTokSec) : Math.round(ai.lastSpeedTokSec),
);

/* ==================== 空态引导 ==================== */

/** 未配置判断：无供应商或无任何可用模型 */
const unconfigured = computed(() => ai.unconfigured);

const suggestions = [
  "查询当前模型里有哪些分类和表",
  "为全部表生成代码，给我文件清单",
  "把字典的字典键和值数量统计出来",
  "重新设置每个表卡片的位置，美化当前画布布置",
];

/** 采纳建议问题（填入输入框并聚焦） */
function useSuggestion(text: string) {
  input.value = text;
  nextTick(() => {
    autoResize();
    textareaEl.value?.focus();
  });
}

/** 未配置引导：跳转设置页 AI 分区 */
function gotoSettings() {
  ui.setPage("settings");
}

/* ==================== 生命周期 ==================== */

onMounted(() => {
  scrollToBottom();
  textareaEl.value?.focus();
});

/** 消息与工具记录变化时贴底跟随（流式输出期间高频触发） */
watch(
  () => [ai.messages, ai.toolRecords],
  async () => {
    if (stickBottom.value) {
      await nextTick();
      scrollToBottom();
    }
  },
  { deep: true },
);
</script>

<template>
  <section class="chat-pane">
    <div ref="chatScrollEl" class="chat-scroll" @scroll="onChatScroll">
      <!-- 空态 -->
      <div v-if="!ai.messages.length" class="chat-empty">
        <span class="empty-icon"><Bot :size="22" :stroke-width="1.8" /></span>
        <h2>AI 工具</h2>
        <p v-if="unconfigured" class="empty-sub">
          尚未配置 AI 服务，请先到「系统设置 →
          AI」添加供应商（选择对话协议、填写服务地址）并添加模型。
          <a class="empty-link" @click="gotoSettings">前往配置 <Settings2 :size="11" /></a>
        </p>
        <p v-else class="empty-sub">
          对话即操作：AI 可调用当前应用的全部管理能力（分类 / 表 / 导航 / 字典 / 模板 /
          设置）、代码生成与代码替换；调用过程与参数可在右侧查看。
        </p>
        <div v-if="!unconfigured" class="suggestion-group">
          <button
            v-for="s in suggestions"
            :key="s"
            class="suggestion-chip"
            type="button"
            @click="useSuggestion(s)"
          >
            {{ s }}
          </button>
        </div>
      </div>

      <!-- 消息列表 -->
      <AiMessageItem
        v-for="m in ai.messages"
        :key="m.id"
        :message="m"
        @locate="(id) => emit('locate', id)"
      />
    </div>

    <!-- 输入区 -->
    <div class="chat-input">
      <div class="input-top">
        <a-select
          v-model:value="ai.selectedModelKey"
          :options="ai.modelOptions"
          size="small"
          style="width: 240px"
          placeholder="选择模型"
          :disabled="!ai.modelOptions.length"
        />
        <span class="input-hint">Enter 发送 · Shift+Enter 换行</span>
        <!-- token 用量：上下文占用 + 输出速度（任务中实时 / 停止后上次） -->
        <span class="tok-stats">
          <span
            v-if="ai.contextUsed"
            class="ctx-meter"
            :class="{
              warn: ctxLimit && ai.contextUsed / ctxLimit > 0.8,
              compact: ctxLimit && ai.contextUsed / ctxLimit >= 0.85,
            }"
            :title="
              `上下文已用 ${ai.contextUsed} token` +
              (ctxLimit
                ? `（上限 ${ctxLimit}，超出 80% 高亮；达到 85% 时自动压缩历史）`
                : '（模型未配置输入上下文长度，设置后可显示上限并自动压缩）')
            "
          >
            上下文 {{ fmtTok(ai.contextUsed) }}{{ ctxLimit ? `/${fmtTok(ctxLimit)}` : "" }}
          </span>
          <span v-if="speedTokSec" class="tok-speed" :class="{ live: ai.running }">
            {{ speedTokSec }} tok/s{{ ai.running ? "" : "（上次）" }}
          </span>
        </span>
        <a-tooltip title="开启新会话（清空当前对话与调用记录）">
          <button
            class="input-icon-btn"
            type="button"
            :disabled="!ai.messages.length || ai.running"
            @click="ai.clearSession()"
          >
            <Eraser :size="13" />
          </button>
        </a-tooltip>
      </div>
      <div class="input-box" :class="{ running: ai.running }">
        <textarea
          ref="textareaEl"
          v-model="input"
          rows="1"
          :placeholder="
            ai.running
              ? '生成中…可点击停止按钮中断'
              : '输入任务，例如：为用户表和角色表建立多对多导航关系'
          "
          @keydown="onKeydown"
          @input="onInput"
        ></textarea>
        <button
          v-if="!ai.running"
          class="send-btn"
          type="button"
          title="发送"
          :disabled="!input.trim()"
          @click="onSend"
        >
          <Send :size="15" />
        </button>
        <button v-else class="send-btn stop" type="button" title="停止生成" @click="ai.stop()">
          <Square :size="12" fill="currentColor" />
        </button>
      </div>
    </div>
  </section>
</template>

<style lang="scss" scoped>
.chat-pane {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  background: var(--dbm-bg-panel);
  border: 1px solid var(--dbm-border);
  border-radius: var(--dbm-radius-m);
  overflow: hidden;
}

.chat-scroll {
  flex: 1;
  overflow-y: auto;
  padding: 16px 18px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

/* ---------- 空态 ---------- */
.chat-empty {
  margin: auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  text-align: center;
  max-width: 460px;
  padding: 24px 12px;

  .empty-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 46px;
    height: 46px;
    border-radius: var(--dbm-radius-m);
    background: var(--dbm-primary-weak);
    color: var(--dbm-primary);
    margin-bottom: 4px;
  }

  h2 {
    margin: 0;
    font-size: 16px;
    font-weight: 600;
    color: var(--dbm-text-1);
  }

  .empty-sub {
    margin: 0;
    font-size: 12.5px;
    line-height: 1.8;
    color: var(--dbm-text-3);
  }

  .empty-link {
    color: var(--dbm-primary);
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 3px;

    &:hover {
      text-decoration: underline;
    }
  }

  .suggestion-group {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-top: 10px;
    width: 100%;
  }

  .suggestion-chip {
    border: 1px solid var(--dbm-border);
    background: var(--dbm-bg-2);
    color: var(--dbm-text-2);
    border-radius: var(--dbm-radius-m);
    padding: 8px 12px;
    font-size: 12.5px;
    cursor: pointer;
    text-align: left;
    transition: all 0.15s ease;

    &:hover {
      border-color: var(--dbm-primary);
      color: var(--dbm-primary-text);
      background: var(--dbm-primary-weak);
    }
  }
}

/* ---------- 输入区 ---------- */
.chat-input {
  border-top: 1px solid var(--dbm-border);
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  background: var(--dbm-bg-panel);
}

.input-top {
  display: flex;
  align-items: center;
  gap: 10px;

  .input-hint {
    font-size: 11px;
    color: var(--dbm-text-3);
  }

  /* token 用量：上下文占用 + 输出速度（紧凑状态条，等宽字体对齐） */
  .tok-stats {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-size: 11px;
    font-family: var(--dbm-font-mono);
    color: var(--dbm-text-3);
    white-space: nowrap;
    overflow: hidden;

    .ctx-meter {
      &.warn {
        color: var(--dbm-warning);
        font-weight: 600;
      }

      /* 达到自动压缩阈值：更醒目提示（悬浮说明自动压缩行为） */
      &.compact {
        color: var(--dbm-danger);
        font-weight: 700;
      }
    }

    .tok-speed {
      &.live {
        color: var(--dbm-primary);
      }
    }
  }

  .input-icon-btn {
    margin-left: auto;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    border: 1px solid var(--dbm-border);
    border-radius: var(--dbm-radius-s);
    background: transparent;
    color: var(--dbm-text-3);
    cursor: pointer;

    &:hover:not(:disabled) {
      color: var(--dbm-primary-text);
      border-color: var(--dbm-primary);
    }

    &:disabled {
      opacity: 0.45;
      cursor: not-allowed;
    }
  }
}

.input-box {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  border: 1px solid var(--dbm-border);
  border-radius: var(--dbm-radius-m);
  background: var(--dbm-bg-2);
  padding: 8px 8px 8px 12px;
  transition: border-color 0.15s ease;

  &:focus-within {
    border-color: var(--dbm-primary);
  }

  textarea {
    flex: 1;
    border: none;
    outline: none;
    background: transparent;
    resize: none;
    font-size: 13px;
    line-height: 1.6;
    color: var(--dbm-text-1);
    max-height: 160px;
    font-family: inherit;

    &::placeholder {
      color: var(--dbm-text-3);
    }
  }

  .send-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border: none;
    border-radius: var(--dbm-radius-m);
    /* 主色实底上的前景色专用令牌：亮色白 / 暗色深青（原 --dbm-primary-text 与背景近乎同色，图标隐形） */
    background: var(--dbm-primary);
    color: var(--dbm-on-primary);
    cursor: pointer;
    flex-shrink: 0;
    transition: opacity 0.15s ease;

    &:hover:not(:disabled) {
      opacity: 0.88;
    }

    &:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }

    &.stop {
      background: var(--dbm-danger);
      color: var(--dbm-on-danger);

      /* 实心方块停止图标（缩放描边方形视觉上像空点） */
      svg {
        fill: currentColor;
      }
    }
  }
}

/* 移动端适配：聊天面板置顶 */
@media (max-width: 768px) {
  .chat-pane {
    order: 1;
  }
}
</style>
