<script setup lang="ts">
/**
 * AI 工具页 · 单条聊天消息（用户 / 助手）
 *
 * 从原 AiView.vue 单文件拆出。职责：
 * - 上下文自动压缩分隔条（compact 标记消息整条以分隔条呈现）
 * - 思考内容可收缩块：流式输出中自动展开、完成后自动收起；块内停留在底部
 *   时新内容追加自动跟随滚到底（贴底跟随逻辑内聚到每条消息实例，用户上翻
 *   即停跟、回底恢复）
 * - 正文渲染：用户为纯文本气泡，助手经 markstream-vue 流式 Markdown 渲染
 *   （任务清单块已剥离——由左侧任务面板展示）
 * - 工具调用芯片（技能加载为独立蓝色书本样式）；点击向上冒泡 locate 事件，
 *   由页面级定位右侧对应能力调用记录
 * - token 用量标签（问题花费 / 本轮输出与速度）、错误与中止提示
 */
import { nextTick, ref, watch } from "vue";
import { Archive, BookOpen, Bot, Brain, ChevronRight, User, Wrench } from "@lucide/vue";
import MarkdownRender from "markstream-vue";
import "markstream-vue/index.css";
import { parseAiTaskList, type AiChatMessage } from "@/stores/ai";
import { useThemeStore } from "@/stores/theme";
import { fmtTok } from "./format";

const props = defineProps<{ message: AiChatMessage }>();
const emit = defineEmits<{ locate: [callId: string] }>();

const theme = useThemeStore();

/** 助手消息展示文本：剔除任务清单块（已解析到左侧任务面板，正文中不再重复展示） */
const displayContent = () => {
  const m = props.message;
  if (m.role !== "assistant" || !m.content) return m.content;
  return parseAiTaskList(m.content).cleaned;
};

/* ==================== 思考块滚动跟随（本消息实例私有） ==================== */

/** 思考块贴底状态：默认贴底——流式追加内容时停留在底部的块自动跟随滚到底；
 *  用户在块内上翻查看历史即停止跟随（不打扰），翻回底部后自动恢复 */
const reasoningStick = ref(true);

/** 程序跟随写入的 scrollTop：用于区分「程序滚动」与「用户主动上翻」。
 *  洞口：程序写入 scrollTop 后 scroll 事件是异步派发的，事件到达时内容可能已
 *  又增长（scrollHeight 变大、scrollTop 停在旧值），若按「距底距离」判断会把
 *  自己的跟随误判为用户上翻而永久停跟（真实 SSE 高频分片下必现）；按「是否
 *  低于程序最近写入位置」判断则不受内容增长时序影响 */
const reasoningOwnTop = ref(0);

/** 思考块滚动容器（v-show 保留 DOM，完成后隐藏但保留滚动位置） */
const reasoningEl = ref<HTMLElement>();

/** 思考块内滚动：区分用户上翻与程序跟随（ownTop 判据） */
function onReasoningScroll(e: Event) {
  const el = e.currentTarget as HTMLElement;
  if (!el) return;
  if (el.scrollTop < reasoningOwnTop.value - 4) {
    // 低于程序跟随点：用户主动上翻 → 停止跟随
    reasoningStick.value = false;
  } else if (el.scrollHeight - el.scrollTop - el.clientHeight < 24) {
    // 回到底部：恢复跟随
    reasoningStick.value = true;
  }
}

watch(
  () => props.message.reasoning,
  async () => {
    await nextTick();
    const m = props.message;
    // 仅跟随正在流式输出且展开中的思考块；用户已上翻（非贴底）的不打扰
    if (m.status !== "streaming" || !m.reasoning || !m.reasoningOpen) return;
    if (reasoningStick.value === false) return;
    const el = reasoningEl.value;
    if (el && el.scrollHeight > el.clientHeight) {
      el.scrollTop = el.scrollHeight;
      reasoningOwnTop.value = el.scrollTop;
    }
  },
);
</script>

<template>
  <div class="msg" :class="[message.role, { streaming: message.status === 'streaming' }]">
    <!-- 上下文自动压缩分隔条：此前的历史已折叠为摘要 -->
    <div v-if="message.compact" class="msg-compact" :title="message.compact.summary">
      <span class="compact-line"></span>
      <span class="compact-tag"><Archive :size="11" /> 上下文已自动压缩</span>
      <span class="compact-line"></span>
    </div>
    <template v-else>
      <div v-if="message.role === 'user'" class="msg-avatar user"><User :size="13" /></div>
      <div v-else class="msg-avatar bot"><Bot :size="13" /></div>

      <div class="msg-body">
        <!-- 思考内容：可收缩（输出中自动展开 / 完成后自动收起） -->
        <div
          v-if="message.reasoning"
          class="reasoning-block"
          :class="{ open: message.reasoningOpen }"
        >
          <button
            class="reasoning-head"
            type="button"
            @click="message.reasoningOpen = !message.reasoningOpen"
          >
            <Brain :size="12" />
            <span>{{ message.status === "streaming" ? "思考中…" : "思考过程" }}</span>
            <ChevronRight :size="12" class="chev" :class="{ down: message.reasoningOpen }" />
          </button>
          <div
            v-show="message.reasoningOpen"
            ref="reasoningEl"
            class="reasoning-body"
            :data-msg-id="message.id"
            @scroll="onReasoningScroll"
          >
            {{ message.reasoning }}
          </div>
        </div>

        <!-- 正文：用户为纯文本，助手用 markstream 流式 Markdown 渲染
             （任务清单块已剥离——解析到左侧任务面板） -->
        <div v-if="message.content && message.role === 'user'" class="msg-content user-text">
          {{ message.content }}
        </div>
        <MarkdownRender
          v-else-if="displayContent()"
          mode="chat"
          class="msg-content md-render"
          :content="displayContent()"
          :final="message.status !== 'streaming'"
          :is-dark="theme.isDark"
        />
        <div v-else-if="message.status === 'streaming'" class="msg-content pending">…</div>

        <!-- 工具调用芯片（技能加载为独立样式：展示加载了哪个技能的哪些部分） -->
        <div v-if="message.toolCalls?.length" class="tool-chips">
          <button
            v-for="tc in message.toolCalls"
            :key="tc.id"
            class="tool-chip"
            :class="{ skill: tc.skill }"
            type="button"
            :title="
              tc.skill
                ? `已加载技能「${tc.skill.title}」的部分：${tc.skill.parts.join('、')}`
                : '查看调用详情（右侧面板）'
            "
            @click="emit('locate', tc.id)"
          >
            <BookOpen v-if="tc.skill" :size="11" />
            <Wrench v-else :size="11" />
            <span class="mono">{{
              tc.skill ? `技能 ${tc.skill.title} · ${tc.skill.parts.length} 部分` : tc.name
            }}</span>
          </button>
        </div>

        <!-- token 用量：问题花费（user）/ 本轮输出与速度（assistant） -->
        <div v-if="message.tokens" class="msg-tokens">
          <template v-if="message.role === 'user'">
            输入 {{ fmtTok(message.tokens.input) }} · 回答 {{ fmtTok(message.tokens.output) }} tok
          </template>
          <template v-else>
            输出 {{ fmtTok(message.tokens.output) }} tok<template v-if="message.speedTokSec">
              · {{ message.speedTokSec }} tok/s</template
            >
          </template>
        </div>

        <!-- 错误 / 中止 -->
        <div v-if="message.status === 'error' && message.error" class="msg-error">
          {{ message.error }}
        </div>
        <div v-else-if="message.status === 'aborted'" class="msg-aborted">（已中止生成）</div>
      </div>
    </template>
  </div>
</template>

<style lang="scss" scoped>
/* ---------- 消息 ---------- */
.msg {
  display: flex;
  gap: 10px;
  max-width: 100%;
  flex-shrink: 0; /* 长会话不破挤压，超出由容器滚动 */

  &.user {
    flex-direction: row-reverse;

    .msg-body {
      align-items: flex-end;
      background: var(--dbm-primary-weak);
      border: 1px solid color-mix(in srgb, var(--dbm-primary) 24%, transparent);
      border-radius: var(--dbm-radius-m);
      padding: 8px 12px;
      max-width: calc(100% - 40px);
    }

    .msg-content {
      white-space: pre-wrap;
    }
  }

  /* 助手消息主体铺满可用宽度（思考块 / 正文不再收窄成列） */
  &:not(.user) .msg-body {
    flex: 1 1 auto;
    max-width: none;
  }

  /* 上下文自动压缩分隔条：居中占满消息行宽 */
  .msg-compact {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 2px 0;
    user-select: none;

    .compact-line {
      flex: 1;
      height: 1px;
      background: var(--dbm-border);
    }

    .compact-tag {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      flex-shrink: 0;
      font-size: 10.5px;
      color: var(--dbm-text-3);
      font-family: var(--dbm-font-mono);
      padding: 2px 8px;
      border: 1px dashed var(--dbm-border);
      border-radius: 999px;
      background: var(--dbm-bg-2);
      cursor: help;
    }
  }

  .msg-avatar {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    border-radius: var(--dbm-radius-m);
    flex-shrink: 0;
    margin-top: 2px;

    &.user {
      background: var(--dbm-bg-3);
      color: var(--dbm-text-2);
    }

    &.bot {
      background: var(--dbm-primary-weak);
      color: var(--dbm-primary);
    }
  }

  .msg-body {
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-width: 0;
  }

  .msg-content {
    font-size: 13px;
    line-height: 1.75;
    color: var(--dbm-text-1);
    word-break: break-word;
  }

  .msg-content.pending {
    color: var(--dbm-text-3);
    animation: pulse 1.4s ease infinite;
  }

  .msg-error {
    padding: 7px 10px;
    border: 1px solid var(--dbm-danger);
    background: var(--dbm-danger-weak);
    color: var(--dbm-danger);
    border-radius: var(--dbm-radius-s);
    font-size: 12px;
    line-height: 1.6;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .msg-aborted {
    font-size: 11px;
    color: var(--dbm-text-3);
  }
}

/* ---------- 思考块 ---------- */
.reasoning-block {
  border: 1px solid var(--dbm-border);
  border-radius: var(--dbm-radius-m);
  background: var(--dbm-bg-2);
  overflow: hidden;

  .reasoning-head {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    border: none;
    background: transparent;
    color: var(--dbm-text-2);
    font-size: 11.5px;
    padding: 5px 10px;
    cursor: pointer;

    &:hover {
      color: var(--dbm-text-1);
    }

    .chev {
      margin-left: auto;
      transition: transform 0.15s ease;

      &.down {
        transform: rotate(90deg);
      }
    }
  }

  .reasoning-body {
    max-height: 240px;
    overflow-y: auto;
    padding: 8px 12px;
    border-top: 1px solid var(--dbm-border);
    font-size: 11.5px;
    line-height: 1.7;
    color: var(--dbm-text-3);
    white-space: pre-wrap;
    word-break: break-word;
  }
}

/* ---------- 工具芯片 ---------- */
.tool-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;

  .tool-chip {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    border: 1px solid var(--dbm-border);
    background: var(--dbm-bg-2);
    color: var(--dbm-text-2);
    font-size: 11px;
    padding: 3px 8px;
    border-radius: 999px;
    cursor: pointer;
    transition: all 0.15s ease;

    &:hover {
      border-color: var(--dbm-primary);
      color: var(--dbm-primary-text);
      background: var(--dbm-primary-weak);
    }

    /* 技能加载芯片：独立样式（书本图标 + 信息蓝调） */
    &.skill {
      border-color: color-mix(in srgb, var(--dbm-info) 45%, transparent);
      background: var(--dbm-info-weak);
      color: var(--dbm-info);
      font-weight: 600;

      &:hover {
        border-color: var(--dbm-info);
        background: color-mix(in srgb, var(--dbm-info) 20%, transparent);
        color: var(--dbm-info);
      }
    }
  }
}

/* ---------- token 用量标签（消息级） ---------- */
.msg-tokens {
  margin-top: 3px;
  font-size: 10.5px;
  line-height: 1.5;
  color: var(--dbm-text-3);
  font-family: var(--dbm-font-mono);
  opacity: 0.92;
  user-select: none;
}

/* ---------- markstream 流式 Markdown 渲染（主题令牌对接） ----------
   注：MarkdownRender 根元素同时携带 markstream-vue / markdown-renderer / md-render
   类（同一元素），变量需用复合选择器提升特异性覆盖内置主题 */
.md-render {
  font-size: 13px;
  line-height: 1.75;
  color: var(--dbm-text-1);
  min-width: 0;

  &.markstream-vue {
    /* 主题变量对接：正文尺寸 / 字体 / 代码块配色全部回接 --dbm- 令牌 */
    --ms-text-body: 13px;
    --ms-leading-body: 1.75;
    --ms-font-mono: var(--dbm-font-mono);
    --inline-code-bg: var(--dbm-code-bg);
    --inline-code-fg: var(--dbm-text-2);
    --inline-code-border: var(--dbm-code-border);
    --code-bg: var(--dbm-code-bg);
    --code-fg: var(--dbm-text-1);
    --code-border: var(--dbm-code-border);
    --code-header-bg: var(--dbm-bg-2);
    background: transparent;
  }

  /* 聊天气泡内的标题/段落尺寸收敛（markstream 默认面向文档页面，标题过大） */
  :deep(h1),
  :deep(h2),
  :deep(h3),
  :deep(h4),
  :deep(h5),
  :deep(h6) {
    margin: 8px 0 4px;
    font-weight: 600;
    color: var(--dbm-text-1);
    line-height: 1.4;

    &:first-child {
      margin-top: 0;
    }

    &:last-child {
      margin-bottom: 0;
    }
  }

  :deep(h1) {
    font-size: 15px;
  }

  :deep(h2) {
    font-size: 14px;
  }

  :deep(h3),
  :deep(h4),
  :deep(h5),
  :deep(h6) {
    font-size: 13px;
  }

  :deep(p) {
    margin: 4px 0;

    &:first-child {
      margin-top: 0;
    }

    &:last-child {
      margin-bottom: 0;
    }
  }

  :deep(ul),
  :deep(ol) {
    margin: 4px 0;
    padding-left: 1.5em;
  }

  :deep(blockquote) {
    margin: 6px 0;
    padding: 2px 10px;
    border-left: 3px solid var(--dbm-border-strong);
    color: var(--dbm-text-2);
  }

  :deep(a) {
    color: var(--dbm-primary);
  }

  :deep(table) {
    border-collapse: collapse;
    margin: 6px 0;
    font-size: 12px;

    th,
    td {
      border: 1px solid var(--dbm-border);
      padding: 4px 8px;
    }

    th {
      background: var(--dbm-bg-2);
    }
  }

  :deep(hr) {
    border: none;
    border-top: 1px solid var(--dbm-border);
    margin: 8px 0;
  }
}

/* 等待正文首字时的呼吸动画（scoped 样式会改写 keyframes 名，须与使用处同文件） */
@keyframes pulse {
  50% {
    opacity: 0.35;
  }
}
</style>
