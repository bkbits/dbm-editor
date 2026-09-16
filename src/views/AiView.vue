<script setup lang="ts">
/**
 * AI 工具页：AGENT 交互界面
 * - 左侧上方：历史聊天数据（用户/助手消息；思考内容为可收缩块——流式输出中
 *   自动展开、完成后自动收起，输出中块内停留在底部时新内容追加自动跟随
 *   滚到底部，上翻查看即停跟、回底恢复；助手消息附工具调用芯片，点击定位右侧记录）
 * - 左侧下方：用户文本输入框（Enter 发送 / Shift+Enter 换行）+ 模型选择 + 停止
 * - 右侧：能力调用记录（ManagerApi 能力 + 代码生成 + 代码替换），默认收起
 *   详情，展开可查看参数与返回值；代码生成记录提供 zip 下载
 * - 助手正文用 markstream-vue 做流式 Markdown 渲染（mode=chat 平滑出字）
 * - 代码替换触发时弹出文件清单确认框，用户确认后才写回
 */
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import {
  AlertTriangle,
  Bot,
  Brain,
  CheckCircle2,
  ChevronRight,
  Download,
  Eraser,
  Loader2,
  Send,
  Settings2,
  Square,
  User,
  Wrench,
  XCircle,
} from '@lucide/vue'
import MarkdownRender from 'markstream-vue'
import 'markstream-vue/index.css'
import { useAiStore, type AiZipDownload } from '@/stores/ai'
import { useUiStore } from '@/stores/ui'
import { useThemeStore } from '@/stores/theme'

const ai = useAiStore()
const ui = useUiStore()
const theme = useThemeStore()

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

/* ==================== 思考块滚动跟随 ==================== */

/** 各思考块贴底状态（消息 id → 是否贴底）。默认视为贴底：思考流式输出追加
 *  内容时，停留在底部的块自动跟随滚到底部；用户在块内上翻查看历史即停止
 *  跟随（不打扰），翻回底部后自动恢复跟随 */
const reasoningStick = new Map<string, boolean>()

function onReasoningScroll(e: Event) {
  const el = e.currentTarget as HTMLElement
  const id = el.dataset.msgId
  if (!id) return
  reasoningStick.set(id, el.scrollHeight - el.scrollTop - el.clientHeight < 24)
}

watch(
  () => ai.messages.map((m) => m.reasoning),
  async () => {
    await nextTick()
    for (const m of ai.messages) {
      // 仅跟随正在流式输出且展开中的思考块；用户已上翻（非贴底）的不打扰
      if (m.status !== 'streaming' || !m.reasoning || !m.reasoningOpen) continue
      if (reasoningStick.get(m.id) === false) continue
      const el = chatScrollEl.value?.querySelector<HTMLElement>(
        `.reasoning-body[data-msg-id="${m.id}"]`,
      )
      if (el) el.scrollTop = el.scrollHeight
    }
  },
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

/* ==================== 右侧调用记录 ==================== */

/** 展开的记录 id 集合（默认收起） */
const expandedRecords = ref(new Set<string>())

function toggleRecord(id: string) {
  const next = new Set(expandedRecords.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  expandedRecords.value = next
}

/** 右侧记录面板滚动跟随：原本处于底部时，新记录添加后跟随滚到底部 */
const toolsScrollEl = ref<HTMLElement>()
const toolsStickBottom = ref(true)

function onToolsScroll() {
  const el = toolsScrollEl.value
  if (!el) return
  toolsStickBottom.value = el.scrollHeight - el.scrollTop - el.clientHeight < 24
}

watch(
  () => ai.toolRecords.length,
  async () => {
    if (!toolsStickBottom.value) return
    await nextTick()
    const el = toolsScrollEl.value
    if (el) el.scrollTop = el.scrollHeight
  },
)

/** zip 下载缓存查询（代码生成记录） */
function zipEntry(callId: string): AiZipDownload | undefined {
  return ai.zipDownloads[callId]
}

function sizeText(size: number): string {
  return size >= 1024 ? `${(size / 1024).toFixed(1)} KB` : `${size} B`
}

/** 展示文本截断（详情面板显示上限；顺带去头尾空白） */
const DISPLAY_CAP = 8000
function capDisplay(text: string): string {
  const t = String(text ?? '').trim()
  return t.length > DISPLAY_CAP
    ? `${t.slice(0, DISPLAY_CAP)}\n…（内容过长已截断，共 ${t.length} 字符）`
    : t
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
                <div
                  v-show="m.reasoningOpen"
                  class="reasoning-body"
                  :data-msg-id="m.id"
                  @scroll="onReasoningScroll"
                >
                  {{ m.reasoning }}
                </div>
              </div>

              <!-- 正文：用户为纯文本，助手用 markstream 流式 Markdown 渲染 -->
              <div v-if="m.content && m.role === 'user'" class="msg-content user-text">
                {{ m.content }}
              </div>
              <MarkdownRender
                v-else-if="m.content"
                mode="chat"
                class="msg-content md-render"
                :content="m.content"
                :final="m.status !== 'streaming'"
                :is-dark="theme.isDark"
              />
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
              <Square :size="12" fill="currentColor" />
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
        <div ref="toolsScrollEl" class="tools-list" @scroll="onToolsScroll">
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
            <div class="record-head" @click="toggleRecord(r.id)">
              <span class="rec-status">
                <Loader2 v-if="r.status === 'running'" :size="12" class="spin" />
                <CheckCircle2 v-else-if="r.status === 'success'" :size="12" />
                <XCircle v-else :size="12" />
              </span>
              <span class="rec-name mono">{{ r.name }}</span>
              <button
                v-if="zipEntry(r.callId)"
                class="zip-mini"
                type="button"
                title="下载生成的代码 zip"
                @click.stop="ai.downloadZip(r.callId)"
              >
                <Download :size="11" />
              </button>
              <span class="rec-duration">{{ durationText(r.durationMs) }}</span>
              <ChevronRight :size="12" class="chev" :class="{ down: expandedRecords.has(r.id) }" />
            </div>
            <div v-if="expandedRecords.has(r.id)" class="record-body">
              <div v-if="zipEntry(r.callId)" class="rec-zip">
                <button class="zip-btn" type="button" @click="ai.downloadZip(r.callId)">
                  <Download :size="12" />
                  <span class="mono">{{ zipEntry(r.callId)?.fileName }}</span>
                  <span class="zip-meta">
                    {{ sizeText(zipEntry(r.callId)?.size ?? 0) }} ·
                    {{ zipEntry(r.callId)?.fileCount }} 个文件
                  </span>
                </button>
              </div>
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
  flex-shrink: 0; /* 长会话不破挤压，超出由容器滚动 */

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
  flex-shrink: 0; /* 记录过多时不被纵向挤压，超出由列表滚动 */

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
    user-select: none;

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

    .zip-mini {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 20px;
      height: 20px;
      border: 1px solid var(--dbm-border);
      border-radius: var(--dbm-radius-s);
      background: transparent;
      color: var(--dbm-text-3);
      cursor: pointer;
      flex-shrink: 0;
      padding: 0;

      &:hover {
        color: var(--dbm-primary);
        border-color: var(--dbm-primary);
        background: var(--dbm-primary-weak);
      }
    }

    .rec-duration {
      margin-left: auto;
      font-size: 10px;
      color: var(--dbm-text-3);
      font-family: var(--dbm-font-mono);
      flex-shrink: 0;
    }

    .rec-duration + .chev {
      margin-left: 0;
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

  .rec-zip {
    .zip-btn {
      display: flex;
      align-items: center;
      gap: 7px;
      width: 100%;
      border: 1px dashed var(--dbm-primary);
      border-radius: var(--dbm-radius-s);
      background: var(--dbm-primary-weak);
      color: var(--dbm-primary-text);
      padding: 6px 10px;
      cursor: pointer;
      font-size: 11.5px;
      transition: all 0.15s ease;

      &:hover {
        border-style: solid;
        background: color-mix(in srgb, var(--dbm-primary) 20%, transparent);
      }

      .mono {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .zip-meta {
        margin-left: auto;
        flex-shrink: 0;
        font-size: 10.5px;
        color: var(--dbm-text-3);
      }
    }
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

/* ==================== 代码替换确认弹窗 ==================== */
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

/* ==================== 动画 ==================== */
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
