<script setup lang="ts">
/**
 * AI 工具页：AGENT 交互界面
 * - 左侧：当前任务清单（模型按模板同步；执行中 / 未开始 / 已完成 / 暂停四态醒目展示，
 *   中止后执行中任务转暂停，下轮发送时同步给模型）
 * - 中间上方：历史聊天数据（用户/助手消息；思考内容为可收缩块——流式输出中
 *   自动展开、完成后自动收起，输出中块内停留在底部时新内容追加自动跟随
 *   滚到底部，上翻查看即停跟、回底恢复；助手消息附工具调用芯片，点击定位右侧
 *   记录；技能加载芯片独立样式展示加载了哪个技能的哪些部分；上下文自动压缩
 *   以分隔条提示）
 * - 中间下方：用户文本输入框（Enter 发送 / Shift+Enter 换行）+ 模型选择 + 停止
 * - 右侧：能力调用记录（ManagerApi 能力 + 代码生成 + 代码替换），默认收起
 *   详情，展开可查看参数与返回值；代码生成记录提供 zip 下载
 * - 助手正文用 markstream-vue 做流式 Markdown 渲染（mode=chat 平滑出字）
 * - 代码替换触发时弹出文件清单确认框，用户确认后才写回
 */
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import {
  AlertTriangle,
  Archive,
  BookOpen,
  Bot,
  Brain,
  CheckCircle2,
  ChevronRight,
  Circle,
  CirclePause,
  Download,
  Eraser,
  ListTodo,
  Loader2,
  Send,
  Settings2,
  Square,
  Trash2,
  User,
  Wrench,
  XCircle,
} from '@lucide/vue'
import MarkdownRender from 'markstream-vue'
import 'markstream-vue/index.css'
import { parseAiTaskList, useAiStore, type AiTaskStatus, type AiZipDownload } from '@/stores/ai'
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
/** 程序跟随写入的 scrollTop（消息 id → 值）：用于区分「程序滚动」与「用户主动上翻」。
 *  洞口：程序写入 scrollTop 后 scroll 事件是异步派发的，事件到达时内容可能已
 *  又增长（scrollHeight 变大、scrollTop 停在旧值），若按「距底距离」判断会把
 *  自己的跟随误判为用户上翻而永久停跟（真实 SSE 高频分片下必现）；按「是否
 *  低于程序最近写入位置」判断则不受内容增长时序影响 */
const reasoningOwnTop = new Map<string, number>()

function onReasoningScroll(e: Event) {
  const el = e.currentTarget as HTMLElement
  const id = el.dataset.msgId
  if (!id) return
  const own = reasoningOwnTop.get(id) ?? 0
  if (el.scrollTop < own - 4) {
    // 低于程序跟随点：用户主动上翻 → 停止跟随
    reasoningStick.set(id, false)
  } else if (el.scrollHeight - el.scrollTop - el.clientHeight < 24) {
    // 回到底部：恢复跟随
    reasoningStick.set(id, true)
  }
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
      if (el && el.scrollHeight > el.clientHeight) {
        el.scrollTop = el.scrollHeight
        reasoningOwnTop.set(m.id, el.scrollTop)
      }
    }
  },
)

/* ==================== 任务清单（左侧面板） ==================== */

/** 任务状态展示元数据（图标 / 文案 / 颜色令牌） */
const TASK_STATUS_META: Record<AiTaskStatus, { label: string; cls: string; title: string }> = {
  running: { label: '执行中', cls: 'running', title: '正在执行' },
  pending: { label: '未开始', cls: 'pending', title: '尚未开始' },
  completed: { label: '已完成', cls: 'completed', title: '已完成' },
  paused: { label: '暂停', cls: 'paused', title: '已暂停（上轮被中止）' },
}

/** 各状态任务数（面板头部汇总） */
const taskCountBy = (s: AiTaskStatus) => ai.tasks.filter((t) => t.status === s).length

/* ==================== 消息展示文本 ==================== */

/** 助手消息展示文本：剔除任务清单块（已解析到左侧任务面板，正文中不再重复展示） */
function displayContent(m: { role: string; content: string }): string {
  if (m.role !== 'assistant' || !m.content) return m.content
  return parseAiTaskList(m.content).cleaned
}

/* ==================== token 用量统计 ==================== */

/** 当前模型上下文长度（未配置为 0：界面只显示已用量不显示分母） */
const ctxLimit = computed(() => ai.currentModel?.inputContextLength ?? 0)

/** 展示用 token 数：<10000 原样，≥10000 用 k/M 缩写 */
function fmtTok(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 10_000) return `${(n / 1000).toFixed(1)}k`
  return String(Math.round(n))
}

/** 展示速度：任务进行中显示当前实时速度，停止后显示上一次任务速度 */
const speedTokSec = computed(() =>
  ai.running ? Math.round(ai.currentSpeedTokSec) : Math.round(ai.lastSpeedTokSec),
)

/* ==================== 空态引导 ==================== */

const unconfigured = computed(() => !ai.aiSettings.baseUrl || !ai.aiSettings.models.length)

const suggestions = [
  '查询当前模型里有哪些分类和表',
  '为全部表生成代码，给我文件清单',
  '把字典的字典键和值数量统计出来',
  '重新设置每个表卡片的位置，美化当前画布布置',
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

/** 清空能力调用记录（仅右侧面板；聊天消息保留，同步清理本地展开态） */
function onClearRecords() {
  ai.clearToolRecords()
  expandedRecords.value = new Set()
}

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
      <!-- ==================== 左侧：当前任务清单 ==================== -->
      <aside class="task-pane">
        <div class="task-head">
          <span class="task-title"><ListTodo :size="13" /> 任务清单</span>
          <span v-if="ai.tasks.length" class="task-count">{{ ai.tasks.length }}</span>
        </div>
        <div class="task-summary" v-if="ai.tasks.length">
          <span class="ts-chip running"
            ><Loader2 :size="10" class="spin" /> 执行中 {{ taskCountBy('running') }}</span
          >
          <span class="ts-chip completed"
            ><CheckCircle2 :size="10" /> 完成 {{ taskCountBy('completed') }}</span
          >
          <span class="ts-chip paused"
            ><CirclePause :size="10" /> 暂停 {{ taskCountBy('paused') }}</span
          >
          <span class="ts-chip pending"
            ><Circle :size="10" /> 待办 {{ taskCountBy('pending') }}</span
          >
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

      <!-- ==================== 中间：聊天 ==================== -->
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
            <!-- 上下文自动压缩分隔条：此前的历史已折叠为摘要 -->
            <div v-if="m.compact" class="msg-compact" :title="m.compact.summary">
              <span class="compact-line"></span>
              <span class="compact-tag"><Archive :size="11" /> 上下文已自动压缩</span>
              <span class="compact-line"></span>
            </div>
            <template v-else>
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

                <!-- 正文：用户为纯文本，助手用 markstream 流式 Markdown 渲染
                   （任务清单块已剥离——解析到左侧任务面板） -->
                <div v-if="m.content && m.role === 'user'" class="msg-content user-text">
                  {{ m.content }}
                </div>
                <MarkdownRender
                  v-else-if="displayContent(m)"
                  mode="chat"
                  class="msg-content md-render"
                  :content="displayContent(m)"
                  :final="m.status !== 'streaming'"
                  :is-dark="theme.isDark"
                />
                <div v-else-if="m.status === 'streaming'" class="msg-content pending">…</div>

                <!-- 工具调用芯片（技能加载为独立样式：展示加载了哪个技能的哪些部分） -->
                <div v-if="m.toolCalls?.length" class="tool-chips">
                  <button
                    v-for="tc in m.toolCalls"
                    :key="tc.id"
                    class="tool-chip"
                    :class="{ skill: tc.skill }"
                    type="button"
                    :title="
                      tc.skill
                        ? `已加载技能「${tc.skill.title}」的部分：${tc.skill.parts.join('、')}`
                        : '查看调用详情（右侧面板）'
                    "
                    @click="locateRecord(tc.id)"
                  >
                    <BookOpen v-if="tc.skill" :size="11" />
                    <Wrench v-else :size="11" />
                    <span class="mono">{{
                      tc.skill ? `技能 ${tc.skill.title} · ${tc.skill.parts.length} 部分` : tc.name
                    }}</span>
                  </button>
                </div>

                <!-- token 用量：问题花费（user）/ 本轮输出与速度（assistant） -->
                <div v-if="m.tokens" class="msg-tokens">
                  <template v-if="m.role === 'user'">
                    输入 {{ fmtTok(m.tokens.input) }} · 回答 {{ fmtTok(m.tokens.output) }} tok
                  </template>
                  <template v-else>
                    输出 {{ fmtTok(m.tokens.output) }} tok<template v-if="m.speedTokSec">
                      · {{ m.speedTokSec }} tok/s</template
                    >
                  </template>
                </div>

                <!-- 错误 / 中止 -->
                <div v-if="m.status === 'error' && m.error" class="msg-error">{{ m.error }}</div>
                <div v-else-if="m.status === 'aborted'" class="msg-aborted">（已中止生成）</div>
              </div>
            </template>
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
                上下文 {{ fmtTok(ai.contextUsed) }}{{ ctxLimit ? `/${fmtTok(ctxLimit)}` : '' }}
              </span>
              <span v-if="speedTokSec" class="tok-speed" :class="{ live: ai.running }">
                {{ speedTokSec }} tok/s{{ ai.running ? '' : '（上次）' }}
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
          <a-tooltip title="清空能力调用记录（不影响对话内容）">
            <button
              class="tools-clear"
              type="button"
              :disabled="!ai.toolRecords.length || ai.running"
              @click="onClearRecords"
            >
              <Trash2 :size="12" />
            </button>
          </a-tooltip>
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
            :class="[r.status, { skill: r.kind === 'skill' }]"
          >
            <div class="record-head" @click="toggleRecord(r.id)">
              <span class="rec-status">
                <Loader2 v-if="r.status === 'running'" :size="12" class="spin" />
                <CheckCircle2 v-else-if="r.status === 'success'" :size="12" />
                <XCircle v-else :size="12" />
              </span>
              <BookOpen v-if="r.kind === 'skill'" :size="12" class="rec-skill-icon" />
              <span class="rec-name mono" :class="{ 'skill-name': r.kind === 'skill' }">{{
                r.kind === 'skill' ? `技能·${r.skill?.title || r.name}` : r.name
              }}</span>
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
              <!-- 技能加载：已加载部分清单（独立样式） -->
              <div v-if="r.skill" class="rec-skill">
                <div class="skill-name-row">
                  <BookOpen :size="12" />
                  <span class="mono">{{ r.skill.name }}</span>
                  <span class="skill-parts-count">{{ r.skill.parts.length }} 部分</span>
                </div>
                <div class="skill-parts">
                  <span v-for="p in r.skill.parts" :key="p" class="skill-part-chip">{{ p }}</span>
                </div>
              </div>
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

/* ==================== 左侧任务清单面板 ==================== */
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

  /* 清空能力调用记录（仅右侧面板；running 与空列表时禁用） */
  .tools-clear {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border: 1px solid var(--dbm-border);
    border-radius: var(--dbm-radius-s);
    background: transparent;
    color: var(--dbm-text-3);
    cursor: pointer;
    flex-shrink: 0;

    &:hover:not(:disabled) {
      color: var(--dbm-danger);
      border-color: var(--dbm-danger);
    }

    &:disabled {
      opacity: 0.35;
      cursor: not-allowed;
    }
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

  /* 技能加载记录：独立样式（信息蓝调边框 + 淡底） */
  &.skill {
    border-color: color-mix(in srgb, var(--dbm-info) 45%, transparent);
    background: color-mix(in srgb, var(--dbm-info) 5%, var(--dbm-bg-2));

    .rec-skill-icon {
      color: var(--dbm-info);
      flex-shrink: 0;
    }

    .rec-name.skill-name {
      color: var(--dbm-info);
      font-weight: 600;
    }
  }

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

  /* 技能加载详情：已加载部分清单（独立样式） */
  .rec-skill {
    border: 1px dashed color-mix(in srgb, var(--dbm-info) 50%, transparent);
    background: var(--dbm-info-weak);
    border-radius: var(--dbm-radius-s);
    padding: 6px 8px;

    .skill-name-row {
      display: flex;
      align-items: center;
      gap: 6px;
      color: var(--dbm-info);
      font-size: 11.5px;
      font-weight: 600;

      .skill-parts-count {
        margin-left: auto;
        font-weight: 400;
        font-size: 10px;
        color: var(--dbm-text-3);
        font-family: var(--dbm-font-mono);
      }
    }

    .skill-parts {
      margin-top: 5px;
      display: flex;
      flex-wrap: wrap;
      gap: 4px;

      .skill-part-chip {
        font-size: 10px;
        line-height: 1.4;
        padding: 1px 6px;
        border-radius: 4px;
        color: var(--dbm-info);
        background: color-mix(in srgb, var(--dbm-info) 14%, transparent);
        border: 1px solid color-mix(in srgb, var(--dbm-info) 30%, transparent);
      }
    }
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

  .task-pane {
    width: auto;
    max-height: 30%; /* 窄屏：任务面板放底部，限高滚动 */
    order: 3;
  }

  .chat-pane {
    order: 1;
  }

  .tools-pane {
    width: auto;
    max-height: 42%;
    order: 2;
  }
}
</style>
