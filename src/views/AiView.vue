<script setup lang="ts">
/**
 * AI 工具页：AGENT 交互界面
 * - 左侧上方：历史聊天数据（用户/助手消息；思考内容为可收缩块——流式输出中
 *   自动展开、完成后自动收起；助手消息附工具调用芯片，点击定位右侧记录）
 * - 左侧下方：用户文本输入框（Enter 发送 / Shift+Enter 换行）+ 模型选择 + 停止
 * - 右侧：能力调用记录（ManagerApi 能力 + 代码生成 + 代码替换），默认收起
 *   详情，展开可查看参数与返回值
 */
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import {
  Bot,
  Brain,
  CheckCircle2,
  ChevronRight,
  Eraser,
  Loader2,
  Send,
  Settings2,
  Square,
  User,
  Wrench,
  XCircle,
} from '@lucide/vue'
import { useAiStore } from '@/stores/ai'
import { useUiStore } from '@/stores/ui'
import { highlightCode } from '@/utils/highlight'

const ai = useAiStore()
const ui = useUiStore()

/* ==================== 输入区 ==================== */

const input = ref('')
const textareaEl = ref<HTMLTextAreaElement>()

function autoResize() {
  const el = textareaEl.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${Math.min(el.scrollHeight, 160)}px`
}

function onInput() {
  autoResize()
}

function onSend() {
  const text = input.value.trim()
  if (!text || ai.running) return
  input.value = ''
  nextTick(autoResize)
  ai.send(text)
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault()
    onSend()
  }
}

/* ==================== 聊天滚动跟随 ==================== */

const chatScrollEl = ref<HTMLElement>()
/** 用户停留在底部时流式输出自动跟随滚动（上翻查看历史时不打扰） */
const stickBottom = ref(true)

function onChatScroll() {
  const el = chatScrollEl.value
  if (!el) return
  stickBottom.value = el.scrollHeight - el.scrollTop - el.clientHeight < 80
}

function scrollToBottom() {
  const el = chatScrollEl.value
  if (el) el.scrollTop = el.scrollHeight
}

onMounted(() => {
  scrollToBottom()
  textareaEl.value?.focus()
})

watch(
  () => [ai.messages, ai.toolRecords],
  async () => {
    if (stickBottom.value) {
      await nextTick()
      scrollToBottom()
    }
  },
  { deep: true },
)

/* ==================== 空态引导 ==================== */

const unconfigured = computed(() => !ai.aiSettings.baseUrl || !ai.aiSettings.models.length)

const suggestions = [
  '查询当前模型里有哪些分类和表',
  '为全部表生成代码，给我文件清单',
  '把字典的字典键和值数量统计出来',
]

function useSuggestion(text: string) {
  input.value = text
  nextTick(() => {
    autoResize()
    textareaEl.value?.focus()
  })
}

function gotoSettings() {
  ui.setPage('settings')
}

/* ==================== 轻量 Markdown 渲染 ==================== */

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** 围栏语言 → 已注册的高亮语言别名 */
function fenceLanguage(lang: string): string {
  const l = lang.trim().toLowerCase()
  if (['java', 'sql', 'xml', 'javascript', 'eta', 'plaintext'].includes(l)) return l
  if (l === 'js' || l === 'ts' || l === 'mjs' || l === 'cjs' || l === 'json') return 'javascript'
  if (l === 'html' || l === 'vue') return 'xml'
  return 'plaintext'
}

function renderInline(text: string): string {
  let s = escapeHtml(text)
  s = s.replace(/`([^`\n]+)`/g, '<code class="md-code">$1</code>')
  s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
  s = s.replace(/(^|\n)(#{1,4}) ([^\n]*)/g, (_m, br: string, hashes: string, t: string) => {
    const level = Math.min(hashes.length + 2, 5)
    return `${br}<span class="md-h md-h${level}">${t}</span>`
  })
  return s
}

/** 轻量 Markdown：``` 围栏代码块（highlight.js 高亮）+ 行内 code/加粗/标题 */
function renderMarkdown(text: string): string {
  const parts = String(text || '').split(/```(\w*)\n?([\s\S]*?)```/)
  let out = ''
  for (let i = 0; i < parts.length; i++) {
    if (i % 3 === 0) {
      out += renderInline(parts[i])
    } else if (i % 3 === 2) {
      const lang = fenceLanguage(parts[i - 1])
      const code = parts[i].replace(/\n$/, '')
      out += `<pre class="md-codeblock"><code>${highlightCode(code, lang)}</code></pre>`
    }
  }
  return out
}

function renderedContent(content: string): string {
  return renderMarkdown(content)
}

/* ==================== 右侧调用记录 ==================== */

/** 展开的记录 id 集合（默认收起） */
const expandedRecords = ref(new Set<string>())

function toggleRecord(id: string) {
  const next = new Set(expandedRecords.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  expandedRecords.value = next
}

/** 展示文本截断（详情面板显示上限） */
const DISPLAY_CAP = 8000
function capDisplay(text: string): string {
  return text.length > DISPLAY_CAP
    ? `${text.slice(0, DISPLAY_CAP)}\n…（内容过长已截断，共 ${text.length} 字符）`
    : text
}

function durationText(ms?: number): string {
  if (ms == null) return ''
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`
}

/** 聊天区工具芯片点击 → 展开并定位右侧对应记录 */
function locateRecord(callId: string) {
  const rec = ai.toolRecords.find((r) => r.callId === callId)
  if (!rec) return
  const next = new Set(expandedRecords.value)
  next.add(rec.id)
  expandedRecords.value = next
  nextTick(() => {
    document.getElementById(`tool-rec-${rec.id}`)?.scrollIntoView({
      behavior: 'smooth',
      block: 'nearest',
    })
  })
}

const runningCount = computed(() => ai.toolRecords.filter((r) => r.status === 'running').length)
</script>

<template>
  <div class="ai-view">
    <div class="ai-layout">
      <!-- ==================== 左侧：聊天 ==================== -->
      <section class="chat-pane">
        <div ref="chatScrollEl" class="chat-scroll" @scroll="onChatScroll">
          <!-- 空态 -->
          <div v-if="!ai.messages.length" class="chat-empty">
            <span class="empty-icon"><Bot :size="22" :stroke-width="1.8" /></span>
            <h2>AI 工具</h2>
            <p v-if="unconfigured" class="empty-sub">
              尚未配置 AI 服务，请先到「系统设置 → AI」填写 openai compatible 服务地址（以 /v1
              结尾）并添加模型。
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
          <div
            v-for="m in ai.messages"
            :key="m.id"
            class="msg"
            :class="[m.role, { streaming: m.status === 'streaming' }]"
          >
            <div v-if="m.role === 'user'" class="msg-avatar user"><User :size="13" /></div>
            <div v-else class="msg-avatar bot"><Bot :size="13" /></div>

            <div class="msg-body">
              <!-- 思考内容：可收缩（输出中自动展开 / 完成后自动收起） -->
              <div v-if="m.reasoning" class="reasoning-block" :class="{ open: m.reasoningOpen }">
                <button
                  class="reasoning-head"
                  type="button"
                  @click="m.reasoningOpen = !m.reasoningOpen"
                >
                  <Brain :size="12" />
                  <span>{{ m.status === 'streaming' ? '思考中…' : '思考过程' }}</span>
                  <ChevronRight :size="12" class="chev" :class="{ down: m.reasoningOpen }" />
                </button>
                <div v-show="m.reasoningOpen" class="reasoning-body">{{ m.reasoning }}</div>
              </div>

              <!-- 正文 -->
              <div
                v-if="m.content"
                class="msg-content md-content"
                v-html="renderedContent(m.content)"
              ></div>
              <div v-else-if="m.status === 'streaming'" class="msg-content pending">…</div>

              <!-- 工具调用芯片 -->
              <div v-if="m.toolCalls?.length" class="tool-chips">
                <button
                  v-for="tc in m.toolCalls"
                  :key="tc.id"
                  class="tool-chip"
                  type="button"
                  title="查看调用详情（右侧面板）"
                  @click="locateRecord(tc.id)"
                >
                  <Wrench :size="11" />
                  <span class="mono">{{ tc.name }}</span>
                </button>
              </div>

              <!-- 错误 / 中止 -->
              <div v-if="m.status === 'error' && m.error" class="msg-error">{{ m.error }}</div>
              <div v-else-if="m.status === 'aborted'" class="msg-aborted">（已中止生成）</div>
            </div>
          </div>
        </div>

        <!-- 输入区 -->
        <div class="chat-input">
          <div class="input-top">
            <a-select
              v-model:value="ai.selectedModelId"
              :options="ai.modelOptions"
              size="small"
              style="width: 210px"
              placeholder="选择模型"
              :disabled="!ai.modelOptions.length"
            />
            <span class="input-hint">Enter 发送 · Shift+Enter 换行</span>
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
              <Square :size="12" />
            </button>
          </div>
        </div>
      </section>

      <!-- ==================== 右侧：能力调用记录 ==================== -->
      <section class="tools-pane">
        <div class="tools-head">
          <span class="tools-title">
            <Wrench :size="13" />
            能力调用记录
          </span>
          <span v-if="runningCount" class="running-badge">
            <Loader2 :size="11" class="spin" />
            {{ runningCount }} 执行中
          </span>
          <span v-else class="tools-count">{{ ai.toolRecords.length || '' }}</span>
        </div>
        <div class="tools-list">
          <div v-if="!ai.toolRecords.length" class="tools-empty">
            AI 调用工具时，参数与返回值将记录在这里（默认收起，点击展开详情）
          </div>
          <div
            v-for="r in ai.toolRecords"
            :id="`tool-rec-${r.id}`"
            :key="r.id"
            class="tool-record"
            :class="r.status"
          >
            <button class="record-head" type="button" @click="toggleRecord(r.id)">
              <span class="rec-status">
                <Loader2 v-if="r.status === 'running'" :size="12" class="spin" />
                <CheckCircle2 v-else-if="r.status === 'success'" :size="12" />
                <XCircle v-else :size="12" />
              </span>
              <span class="rec-name mono">{{ r.name }}</span>
              <span class="rec-duration">{{ durationText(r.durationMs) }}</span>
              <ChevronRight :size="12" class="chev" :class="{ down: expandedRecords.has(r.id) }" />
            </button>
            <div v-if="expandedRecords.has(r.id)" class="record-body">
              <div class="rec-section">
                <span class="sec-label">参数</span>
                <pre class="mono">{{ capDisplay(r.argsText) }}</pre>
              </div>
              <div class="rec-section">
                <span class="sec-label" :class="{ err: r.status === 'error' }">
                  {{ r.status === 'error' ? '错误' : '返回' }}
                </span>
                <pre class="mono" :class="{ err: r.status === 'error' }">{{
                  capDisplay(r.resultText)
                }}</pre>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
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

/* ==================== 左侧聊天面板 ==================== */
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

/* ---------- 消息 ---------- */
.msg {
  display: flex;
  gap: 10px;
  max-width: 100%;

  &.user {
    flex-direction: row-reverse;

    .msg-body {
      align-items: flex-end;
      background: var(--dbm-primary-weak);
      border: 1px solid color-mix(in srgb, var(--dbm-primary) 24%, transparent);
      border-radius: var(--dbm-radius-m);
      padding: 8px 12px;
    }

    .msg-content {
      white-space: pre-wrap;
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
    max-width: calc(100% - 40px);
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

  &.streaming .md-content::after {
    content: '▍';
    color: var(--dbm-primary);
    animation: blink 1s steps(2) infinite;
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
  }
}

/* ---------- Markdown 轻量渲染 ---------- */
.md-content {
  white-space: pre-wrap;

  :deep(.md-code) {
    font-family: var(--dbm-font-mono);
    font-size: 12px;
    background: var(--dbm-code-bg);
    border: 1px solid var(--dbm-code-border);
    border-radius: 4px;
    padding: 0 4px;
  }

  :deep(.md-h) {
    display: block;
    font-weight: 600;
    color: var(--dbm-text-1);
    margin-top: 6px;

    &.md-h3,
    &.md-h4,
    &.md-h5 {
      font-weight: 600;
      font-size: 13px;
    }
  }

  :deep(.md-codeblock) {
    margin: 6px 0;
    padding: 10px 12px;
    background: var(--dbm-code-bg);
    border: 1px solid var(--dbm-code-border);
    border-radius: var(--dbm-radius-m);
    overflow-x: auto;
    white-space: normal;

    code {
      font-family: var(--dbm-font-mono);
      font-size: 12px;
      line-height: 1.6;
      display: block;
      white-space: pre;
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
    background: var(--dbm-primary);
    color: var(--dbm-primary-text);
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
      color: #fff;
    }
  }
}

/* ==================== 右侧调用记录面板 ==================== */
.tools-pane {
  width: 330px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  background: var(--dbm-bg-panel);
  border: 1px solid var(--dbm-border);
  border-radius: var(--dbm-radius-m);
  overflow: hidden;
}

.tools-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--dbm-border);
  flex-shrink: 0;

  .tools-title {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 12.5px;
    font-weight: 600;
    color: var(--dbm-text-1);
  }

  .tools-count {
    margin-left: auto;
    font-size: 11px;
    color: var(--dbm-text-3);
    font-family: var(--dbm-font-mono);
  }

  .running-badge {
    margin-left: auto;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 11px;
    color: var(--dbm-primary);
  }
}

.tools-list {
  flex: 1;
  overflow-y: auto;
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.tools-empty {
  margin: auto;
  padding: 0 14px;
  text-align: center;
  font-size: 12px;
  line-height: 1.8;
  color: var(--dbm-text-3);
}

.tool-record {
  border: 1px solid var(--dbm-border);
  border-radius: var(--dbm-radius-m);
  background: var(--dbm-bg-2);
  overflow: hidden;

  &.success .rec-status {
    color: var(--dbm-success);
  }

  &.error {
    border-color: color-mix(in srgb, var(--dbm-danger) 45%, transparent);

    .rec-status {
      color: var(--dbm-danger);
    }
  }

  &.running .rec-status {
    color: var(--dbm-primary);
  }

  .record-head {
    display: flex;
    align-items: center;
    gap: 7px;
    width: 100%;
    border: none;
    background: transparent;
    padding: 7px 10px;
    cursor: pointer;
    text-align: left;

    &:hover {
      background: var(--dbm-bg-hover);
    }

    .rec-name {
      font-size: 11.5px;
      font-weight: 600;
      color: var(--dbm-text-1);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .rec-duration {
      margin-left: auto;
      font-size: 10px;
      color: var(--dbm-text-3);
      font-family: var(--dbm-font-mono);
      flex-shrink: 0;
    }

    .chev {
      flex-shrink: 0;
      color: var(--dbm-text-3);
      transition: transform 0.15s ease;

      &.down {
        transform: rotate(90deg);
      }
    }
  }

  .record-body {
    border-top: 1px solid var(--dbm-border);
    padding: 8px 10px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .rec-section {
    .sec-label {
      display: block;
      font-size: 10.5px;
      color: var(--dbm-text-3);
      margin-bottom: 4px;

      &.err {
        color: var(--dbm-danger);
      }
    }

    pre {
      margin: 0;
      max-height: 220px;
      overflow: auto;
      background: var(--dbm-code-bg);
      border: 1px solid var(--dbm-code-border);
      border-radius: var(--dbm-radius-s);
      padding: 8px 10px;
      font-size: 11px;
      line-height: 1.6;
      white-space: pre-wrap;
      word-break: break-word;
      color: var(--dbm-text-2);

      &.err {
        color: var(--dbm-danger);
      }
    }
  }
}

/* ==================== 动画 ==================== */
@keyframes blink {
  50% {
    opacity: 0;
  }
}

@keyframes pulse {
  50% {
    opacity: 0.35;
  }
}

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

/* ==================== 移动端适配 ==================== */
@media (max-width: 768px) {
  .ai-view {
    padding: 8px;
  }

  .ai-layout {
    flex-direction: column;
  }

  .tools-pane {
    width: auto;
    max-height: 42%;
  }
}
</style>
