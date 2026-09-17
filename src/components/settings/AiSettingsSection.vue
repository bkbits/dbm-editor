<script setup lang="ts">
/**
 * AI 设置区块（系统设置页内嵌卡片）：AI 供应商（openai compatible）
 * + 模型列表（id / 展示名称 / 是否支持思考 / 思考强度 / 输入输出上下文长度）
 * + 全局规则（多行文本，附加在 AI 工具调用中）。
 *
 * 草稿与校验在本组件内维护；保存 / 放弃由设置页底部操作栏统一驱动
 * （经 defineExpose 暴露 dirty / invalid / save / resetDraft）。
 */
import { computed, reactive, watch } from "vue";
import { Bot, Plus, RotateCcw, Trash2 } from "@lucide/vue";
import type { AiModelConfig, ThinkingIntensity } from "@/types/ai";
import { DEFAULT_AI_GLOBAL_RULES } from "@/ai/defaults";
import { useAiStore } from "@/stores/ai";
import { useUiStore } from "@/stores/ui";
import { uid } from "@/utils/id";

const ai = useAiStore();
const ui = useUiStore();

/* ==================== 草稿（保存前本地编辑） ==================== */

/** 模型草稿行（输入框可清空 → 长度字段允许 null，保存时归一为 undefined） */
interface ModelDraft {
  key: string; // 客户端稳定 key（列表渲染复用，保存时剥离）
  id: string;
  name: string;
  supportsThinking: boolean;
  thinkingIntensity: ThinkingIntensity;
  inputContextLength: number | null;
  outputContextLength: number | null;
}

/** 工具调用轮数上限缺省（与 api 层 DEFAULT_MAX_TOOL_ROUNDS 一致） */
const DEFAULT_ROUNDS = 50;

const draft = reactive({
  baseUrl: "",
  apiKey: "",
  globalRules: "",
  maxToolRounds: DEFAULT_ROUNDS as number,
  models: [] as ModelDraft[],
});

/** store 设置 → 编辑草稿（补 uid 稳定 key） */
function toDraft(m: AiModelConfig): ModelDraft {
  return {
    key: uid("aim-"),
    id: m.id,
    name: m.name || "",
    supportsThinking: Boolean(m.supportsThinking),
    thinkingIntensity: m.thinkingIntensity || "medium",
    inputContextLength: m.inputContextLength ?? null,
    outputContextLength: m.outputContextLength ?? null,
  };
}

/** 全局规则恢复默认（仅本区块草稿，需保存生效）：重置为默认任务流程约定文本 */
function resetGlobalRules() {
  draft.globalRules = DEFAULT_AI_GLOBAL_RULES;
}

/** 放弃修改：从 store 重建草稿 */
function resetDraft() {
  draft.baseUrl = ai.aiSettings.baseUrl;
  draft.apiKey = ai.aiSettings.apiKey;
  draft.globalRules = ai.aiSettings.globalRules || "";
  const rounds = Math.floor(Number(ai.aiSettings.maxToolRounds));
  draft.maxToolRounds =
    Number.isFinite(rounds) && rounds >= 1 ? Math.min(500, rounds) : DEFAULT_ROUNDS;
  draft.models = ai.aiSettings.models.map(toDraft);
}

watch(
  () => ai.aiSettings,
  () => resetDraft(),
  { immediate: true },
);

/** 添加模型条目（默认关闭思考） */
function addModel() {
  draft.models.push({
    key: uid("aim-"),
    id: "",
    name: "",
    supportsThinking: false,
    thinkingIntensity: "medium",
    inputContextLength: null,
    outputContextLength: null,
  });
}

/** 删除模型条目 */
function removeModel(idx: number) {
  draft.models.splice(idx, 1);
}

/* ==================== 校验 ==================== */

const INTENSITY_OPTIONS: Array<{ value: ThinkingIntensity; label: string }> = [
  { value: "low", label: "low" },
  { value: "medium", label: "medium" },
  { value: "high", label: "high" },
  { value: "xhigh", label: "xhigh" },
  { value: "max", label: "max" },
];

const baseUrlError = computed(() => {
  const url = draft.baseUrl.trim();
  if (!url) return null;
  if (!/^https?:\/\//i.test(url)) return "服务地址必须以 http:// 或 https:// 开头";
  if (!/\/v1\/?$/i.test(url)) return "服务地址必须以 /v1 结尾（如 https://api.example.com/v1）";
  return null;
});

/** 模型行错误（空 id / 重复 id） */
function modelError(idx: number): string | null {
  const m = draft.models[idx];
  const id = m.id.trim();
  if (!id) return "模型 id 不能为空";
  if (draft.models.some((o, i) => i !== idx && o.id.trim() === id)) return `模型 id 重复：${id}`;
  return null;
}

const modelsError = computed(() => {
  for (let i = 0; i < draft.models.length; i++) {
    const err = modelError(i);
    if (err) return err;
  }
  if (draft.models.length && !draft.baseUrl.trim()) return "已配置模型时必须填写服务地址";
  return null;
});

const invalid = computed(() => baseUrlError.value || modelsError.value);

/* ==================== 脏检查 / 保存（供设置页统一驱动） ==================== */

/** 草稿归一为契约形态（与已保存态比较用） */
function draftModelsNormalized(): AiModelConfig[] {
  return draft.models.map((m) => ({
    id: m.id.trim(),
    name: m.name.trim(),
    supportsThinking: m.supportsThinking,
    thinkingIntensity: m.supportsThinking ? m.thinkingIntensity : undefined,
    inputContextLength: m.inputContextLength ?? undefined,
    outputContextLength: m.outputContextLength ?? undefined,
  }));
}

/** 轮数上限草稿归一（空 / 非法回退 50；范围 1-500） */
function draftRoundsNormalized(): number {
  const n = Math.floor(Number(draft.maxToolRounds));
  if (!Number.isFinite(n) || n < 1) return DEFAULT_ROUNDS;
  return Math.min(500, n);
}

const dirty = computed(
  () =>
    draft.baseUrl !== ai.aiSettings.baseUrl ||
    draft.apiKey !== ai.aiSettings.apiKey ||
    (draft.globalRules || "") !== (ai.aiSettings.globalRules || "") ||
    draftRoundsNormalized() !== ai.maxToolRounds ||
    JSON.stringify(draftModelsNormalized()) !==
      JSON.stringify(
        ai.aiSettings.models.map(
          ({
            id,
            name,
            supportsThinking,
            thinkingIntensity,
            inputContextLength,
            outputContextLength,
          }) => ({
            id,
            name,
            supportsThinking,
            thinkingIntensity,
            inputContextLength,
            outputContextLength,
          }),
        ),
      ),
);

/** 保存 AI 设置（校验失败时抛错，由设置页统一提示） */
async function save() {
  if (invalid.value) throw new Error(invalid.value);
  await ai.saveSettings({
    baseUrl: draft.baseUrl.trim(),
    apiKey: draft.apiKey,
    models: draftModelsNormalized(),
    globalRules: draft.globalRules,
    maxToolRounds: draftRoundsNormalized(),
  });
}

/** 未配置时一键跳转 AI 工具页 */
function gotoAiTool() {
  ui.setPage("ai");
}

defineExpose({ dirty, invalid, save, resetDraft });
</script>

<template>
  <section class="settings-card ai-card">
    <div class="card-head">
      <span class="card-title"><Bot :size="13" /> AI（openai compatible）</span>
      <span class="card-sub">供应商、模型列表与全局规则，随底部「保存设置」统一保存</span>
    </div>

    <div class="field-grid">
      <div class="field-row">
        <label class="field-label">服务地址</label>
        <a-input
          v-model:value="draft.baseUrl"
          placeholder="https://api.example.com/v1（必须以 /v1 结尾）"
          allow-clear
        />
      </div>
      <div v-if="baseUrlError" class="field-error">{{ baseUrlError }}</div>

      <div class="field-row">
        <label class="field-label">API Key</label>
        <a-input-password
          v-model:value="draft.apiKey"
          placeholder="sk-...（Bearer 鉴权；本地服务可留空）"
          allow-clear
        />
      </div>
    </div>

    <div class="models-block">
      <div class="block-head">
        <span class="block-title">模型列表</span>
        <a-button size="small" type="dashed" @click="addModel">
          <template #icon><Plus :size="12" /></template>
          添加模型
        </a-button>
      </div>

      <div v-if="!draft.models.length" class="models-empty">
        暂无模型：添加模型并填写服务地址后，即可在
        <a class="inline-link" @click="gotoAiTool">AI 工具</a>
        页对话
      </div>

      <div v-for="(m, i) in draft.models" :key="m.key" class="model-row">
        <div class="model-line">
          <a-input v-model:value="m.id" class="grow" placeholder="模型 id（如 glm-4.6）" />
          <a-input v-model:value="m.name" class="grow" placeholder="展示名称（空则显示模型 id）" />
          <button class="row-del" type="button" title="删除该模型" @click="removeModel(i)">
            <Trash2 :size="13" />
          </button>
        </div>
        <div class="model-line props">
          <label class="think-toggle">
            <a-switch v-model:checked="m.supportsThinking" size="small" />
            支持思考
          </label>
          <template v-if="m.supportsThinking">
            <span class="prop-label">思考强度</span>
            <a-select
              v-model:value="m.thinkingIntensity"
              :options="INTENSITY_OPTIONS"
              size="small"
              style="width: 96px"
            />
          </template>
          <span class="prop-label">输入上下文</span>
          <a-input-number
            v-model:value="m.inputContextLength"
            size="small"
            :min="0"
            :step="1000"
            placeholder="token"
            style="width: 108px"
          />
          <span class="prop-label">输出上下文</span>
          <a-input-number
            v-model:value="m.outputContextLength"
            size="small"
            :min="0"
            :step="1000"
            placeholder="token"
            style="width: 108px"
          />
        </div>
        <div v-if="modelError(i)" class="field-error">{{ modelError(i) }}</div>
      </div>
    </div>

    <!-- 轮数上限（独立块：位于模型列表之后，避免影响既有选择器顺序） -->
    <div class="rounds-block">
      <div class="field-row">
        <label class="field-label">轮数上限</label>
        <a-input-number
          v-model:value="draft.maxToolRounds"
          size="small"
          :min="1"
          :max="500"
          :step="5"
          style="width: 110px"
        />
        <span class="rounds-hint">
          单次任务工具调用轮数上限（默认 {{ DEFAULT_ROUNDS }}，达到上限自动中止防失控）
        </span>
      </div>
    </div>

    <div class="rules-block">
      <div class="field-row column">
        <div class="rules-head">
          <label class="field-label">全局规则</label>
          <span class="rules-hint">
            附加在 AI 工具每次调用的系统提示中（优先级最高）；留空则仅使用内置默认规则
          </span>
          <a-button class="rules-reset" size="small" @click="resetGlobalRules">
            <template #icon><RotateCcw :size="12" /></template>
            恢复默认
          </a-button>
        </div>
        <a-textarea
          v-model:value="draft.globalRules"
          :rows="5"
          placeholder="多行文本：可约定行为规范、输出风格、操作边界等；点「恢复默认」可找回默认任务流程约定"
        />
      </div>
    </div>
  </section>
</template>

<style lang="scss" scoped>
.ai-card {
  .field-grid {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-bottom: 14px;
  }

  .field-row {
    display: flex;
    align-items: center;
    gap: 10px;

    &.column {
      flex-direction: column;
      align-items: stretch;
      gap: 6px;
    }
  }

  .field-label {
    flex-shrink: 0;
    width: 64px;
    font-size: 12px;
    color: var(--dbm-text-2);
  }

  .field-error {
    margin-left: 74px;
    font-size: 11px;
    color: var(--dbm-danger);
  }

  .rounds-hint {
    font-size: 11px;
    color: var(--dbm-text-3);
  }
}

.models-block {
  margin-bottom: 14px;

  .block-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 8px;
  }

  .block-title {
    font-size: 12px;
    font-weight: 600;
    color: var(--dbm-text-2);
  }

  .models-empty {
    padding: 14px;
    border: 1px dashed var(--dbm-border);
    border-radius: var(--dbm-radius-m);
    text-align: center;
    font-size: 12px;
    color: var(--dbm-text-3);

    .inline-link {
      color: var(--dbm-primary);
      cursor: pointer;

      &:hover {
        text-decoration: underline;
      }
    }
  }
}

.model-row {
  padding: 8px 10px;
  border: 1px solid var(--dbm-border);
  border-radius: var(--dbm-radius-m);
  margin-bottom: 8px;
  background: var(--dbm-bg-2);

  .model-line {
    display: flex;
    align-items: center;
    gap: 8px;

    &.props {
      margin-top: 8px;
      flex-wrap: wrap;
    }

    .grow {
      flex: 1;
      min-width: 0;
    }
  }

  .row-del {
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
    flex-shrink: 0;

    &:hover {
      color: var(--dbm-danger);
      border-color: var(--dbm-danger);
    }
  }

  .think-toggle {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: var(--dbm-text-2);
    cursor: pointer;
  }

  .prop-label {
    font-size: 11px;
    color: var(--dbm-text-3);
  }

  .field-error {
    margin-left: 0;
    margin-top: 6px;
  }
}

.rules-block {
  margin-bottom: 4px;

  .rules-head {
    display: flex;
    align-items: center;
    gap: 10px;

    .rules-hint {
      flex: 1;
      min-width: 0;
      font-size: 11px;
      color: var(--dbm-text-3);
    }

    .rules-reset {
      flex-shrink: 0;
    }
  }
}

.rounds-block {
  margin-bottom: 14px;

  .field-row {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .field-label {
    flex-shrink: 0;
    width: 64px;
    font-size: 12px;
    color: var(--dbm-text-2);
  }

  .rounds-hint {
    font-size: 11px;
    color: var(--dbm-text-3);
  }
}
</style>
