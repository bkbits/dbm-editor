<script setup lang="ts">
/**
 * AI 工具页 · 右侧能力调用记录面板
 *
 * 从原 AiView.vue 单文件拆出。展示 AGENT 每次工具调用的参数与返回值：
 * - ManagerApi 能力 / 代码生成 / 代码替换记录，默认收起详情，点击头部展开
 * - 技能加载记录为独立蓝色书本样式（含已加载部分清单）
 * - 代码生成记录提供 zip 下载（迷你按钮 + 展开后主按钮）
 * - 头部「清空」仅清记录面板不影响对话（running 与空列表时禁用）
 * - 经 defineExpose 暴露 locate(callId)：聊天区工具芯片点击后展开并定位
 *   对应记录（滚动到可见）
 */
import { computed, nextTick, ref, watch } from "vue";
import {
  BookOpen,
  CheckCircle2,
  ChevronRight,
  Download,
  Loader2,
  Trash2,
  Wrench,
  XCircle,
} from "@lucide/vue";
import { useAiStore, type AiZipDownload } from "@/stores/ai";
import { capDisplay, durationText, sizeText } from "./format";

const ai = useAiStore();

/** 展开的记录 id 集合（默认收起） */
const expandedRecords = ref(new Set<string>());

/** 清空能力调用记录（仅右侧面板；聊天消息保留，同步清理本地展开态） */
function onClearRecords() {
  ai.clearToolRecords();
  expandedRecords.value = new Set();
}

/** 展开 / 收起一条记录详情 */
function toggleRecord(id: string) {
  const next = new Set(expandedRecords.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  expandedRecords.value = next;
}

/** 右侧记录面板滚动跟随：原本处于底部时，新记录添加后跟随滚到底部 */
const toolsScrollEl = ref<HTMLElement>();
const toolsStickBottom = ref(true);

/** 记录面板滚动：更新贴底状态 */
function onToolsScroll() {
  const el = toolsScrollEl.value;
  if (!el) return;
  toolsStickBottom.value = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
}

watch(
  () => ai.toolRecords.length,
  async () => {
    if (!toolsStickBottom.value) return;
    await nextTick();
    const el = toolsScrollEl.value;
    if (el) el.scrollTop = el.scrollHeight;
  },
);

/** zip 下载缓存查询（代码生成记录） */
function zipEntry(callId: string): AiZipDownload | undefined {
  return ai.zipDownloads[callId];
}

const runningCount = computed(() => ai.toolRecords.filter((r) => r.status === "running").length);

/** 展开对应记录并平滑滚动到可见（供聊天区工具芯片定位；记录必须已存在） */
function locate(callId: string) {
  const rec = ai.toolRecords.find((r) => r.callId === callId);
  if (!rec) return;
  const next = new Set(expandedRecords.value);
  next.add(rec.id);
  expandedRecords.value = next;
  nextTick(() => {
    document.getElementById(`tool-rec-${rec.id}`)?.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
    });
  });
}

defineExpose({ locate });
</script>

<template>
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
      <span v-else class="tools-count">{{ ai.toolRecords.length || "" }}</span>
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
            r.kind === "skill" ? `技能·${r.skill?.title || r.name}` : r.name
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
              {{ r.status === "error" ? "错误" : "返回" }}
            </span>
            <pre class="mono" :class="{ err: r.status === 'error' }">{{
              capDisplay(r.resultText)
            }}</pre>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<style lang="scss" scoped>
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

/* 移动端适配：记录面板居中限高 */
@media (max-width: 768px) {
  .tools-pane {
    width: auto;
    max-height: 42%;
    order: 2;
  }
}
</style>
