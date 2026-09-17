<script setup lang="ts">
/**
 * AI 设置区块（系统设置页内嵌卡片）：多供应商（协议 / 服务地址 / API Key）
 * × 多模型（id / 展示名称 / 是否支持思考 / 思考强度 / 输入输出上下文长度）
 * + 默认模型（供应商/模型 二元组）+ 全局规则（多行文本，附加在 AI 工具
 * 调用中）+ 工具调用轮数上限。
 *
 * 草稿与校验在本组件内维护；保存 / 放弃由设置页底部操作栏统一驱动
 * （经 defineExpose 暴露 dirty / invalid / save / resetDraft）。
 */
import { computed, reactive, watch } from "vue";
import { Bot, Plus, RotateCcw, Trash2 } from "@lucide/vue";
import type { AIProviderConfig, AiModelConfig, ChatProtocol, ThinkingIntensity } from "@/types/ai";
import { CHAT_PROTOCOL_LABELS } from "@/types/ai";
import { DEFAULT_AI_GLOBAL_RULES } from "@/ai/defaults";
import { modelKeyOf, splitModelKey, useAiStore } from "@/stores/ai";
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

/** 供应商草稿行（新供应商添加时即生成 id，供默认模型引用） */
interface ProviderDraft {
  key: string; // 客户端稳定 key（保存时剥离）
  id: string;
  name: string;
  protocol: ChatProtocol;
  baseUrl: string;
  apiKey: string;
  models: ModelDraft[];
}

/** 工具调用轮数上限缺省（与 api 层 DEFAULT_MAX_TOOL_ROUNDS 一致） */
const DEFAULT_ROUNDS = 50;

const draft = reactive({
  providers: [] as ProviderDraft[],
  /** 默认模型（复合键；空 = 未选择，保存时回落首个可用模型） */
  currentModelKey: "",
  globalRules: "",
  maxToolRounds: DEFAULT_ROUNDS as number,
});

const PROTOCOL_OPTIONS: Array<{ value: ChatProtocol; label: string }> = (
  ["openai-chat", "openai-responses", "anthropic"] as ChatProtocol[]
).map((p) => ({ value: p, label: CHAT_PROTOCOL_LABELS[p] }));

const INTENSITY_OPTIONS: Array<{ value: ThinkingIntensity; label: string }> = [
  { value: "low", label: "low" },
  { value: "medium", label: "medium" },
  { value: "high", label: "high" },
  { value: "xhigh", label: "xhigh" },
  { value: "max", label: "max" },
];

/** store 模型配置 → 编辑草稿（补 uid 稳定 key） */
function toModelDraft(m: AiModelConfig): ModelDraft {
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

/** store 供应商配置 → 编辑草稿 */
function toProviderDraft(p: AIProviderConfig): ProviderDraft {
  return {
    key: uid("prvk-"),
    id: p.id,
    name: p.name || "",
    protocol: p.protocol,
    baseUrl: p.baseUrl || "",
    apiKey: p.apiKey || "",
    models: (p.models || []).map(toModelDraft),
  };
}

/** 全局规则恢复默认（仅本区块草稿，需保存生效）：重置为默认任务流程约定文本 */
function resetGlobalRules() {
  draft.globalRules = DEFAULT_AI_GLOBAL_RULES;
}

/** 放弃修改：从 store 重建草稿 */
function resetDraft() {
  draft.providers = ai.aiSettings.providers.map(toProviderDraft);
  const cur = ai.aiSettings.currentModel;
  draft.currentModelKey =
    cur && ai.aiSettings.providers.some((p) => p.id === cur.providerId)
      ? modelKeyOf(cur.providerId, cur.modelId)
      : "";
  draft.globalRules = ai.aiSettings.globalRules || "";
  const rounds = Math.floor(Number(ai.aiSettings.maxToolRounds));
  draft.maxToolRounds =
    Number.isFinite(rounds) && rounds >= 1 ? Math.min(500, rounds) : DEFAULT_ROUNDS;
}

watch(
  () => ai.aiSettings,
  () => resetDraft(),
  { immediate: true },
);

/* ==================== 供应商 / 模型行操作 ==================== */

/** 添加供应商（id 即时生成，协议缺省 openai-chat） */
function addProvider() {
  draft.providers.push({
    key: uid("prvk-"),
    id: uid("prv-"),
    name: "",
    protocol: "openai-chat",
    baseUrl: "",
    apiKey: "",
    models: [],
  });
}

/** 删除供应商（默认模型指向它时清空选择） */
function removeProvider(idx: number) {
  const [removed] = draft.providers.splice(idx, 1);
  if (removed && draft.currentModelKey.startsWith(`${removed.id}\u0000`)) {
    draft.currentModelKey = "";
  }
}

/** 添加模型条目（默认关闭思考） */
function addModel(p: ProviderDraft) {
  p.models.push({
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
function removeModel(p: ProviderDraft, idx: number) {
  p.models.splice(idx, 1);
}

/* ==================== 校验 ==================== */

/** 供应商地址校验（按协议：openai 系须以 /v1 结尾，anthropic 只查 http 前缀） */
function providerBaseUrlError(p: ProviderDraft): string | null {
  const url = p.baseUrl.trim();
  if (!url) return null;
  if (!/^https?:\/\//i.test(url)) return "服务地址必须以 http:// 或 https:// 开头";
  if (p.protocol !== "anthropic" && !/\/v1\/?$/i.test(url)) {
    return "该协议的服务地址必须以 /v1 结尾（如 https://api.example.com/v1）";
  }
  return null;
}

/** 模型行错误（空 id / 供应商内重复 id） */
function modelError(p: ProviderDraft, idx: number): string | null {
  const m = p.models[idx];
  const id = m.id.trim();
  if (!id) return "模型 id 不能为空";
  if (p.models.some((o, i) => i !== idx && o.id.trim() === id)) return `模型 id 重复：${id}`;
  return null;
}

/** 全部校验错误（首个即拦截保存） */
const invalid = computed(() => {
  const seenIds = new Set<string>();
  for (const p of draft.providers) {
    if (!p.id.trim()) return "供应商 id 不能为空";
    if (seenIds.has(p.id.trim())) return `供应商 id 重复：${p.id}`;
    seenIds.add(p.id.trim());
    const urlErr = providerBaseUrlError(p);
    if (urlErr) return urlErr;
    if (p.models.length && !p.baseUrl.trim()) return "已配置模型时必须填写服务地址";
    for (let i = 0; i < p.models.length; i++) {
      const err = modelError(p, i);
      if (err) return err;
    }
  }
  // 默认模型须指向草稿中存在的供应商与模型
  const parsed = splitModelKey(draft.currentModelKey);
  if (parsed) {
    const hit = draft.providers
      .find((p) => p.id === parsed.providerId)
      ?.models.some((m) => m.id === parsed.modelId);
    if (!hit) return "默认模型指向的供应商或模型不存在，请重新选择";
  }
  return null;
});

/* ==================== 脏检查 / 保存（供设置页统一驱动） ==================== */

/** 草稿归一为契约形态（与已保存态比较用） */
function draftNormalized() {
  const providers: AIProviderConfig[] = draft.providers.map((p) => ({
    id: p.id.trim(),
    name: p.name.trim() || `供应商${draft.providers.indexOf(p) + 1}`,
    protocol: p.protocol,
    baseUrl: p.baseUrl.trim(),
    apiKey: p.apiKey,
    models: p.models.map((m) => ({
      id: m.id.trim(),
      name: m.name.trim(),
      supportsThinking: m.supportsThinking,
      thinkingIntensity: m.supportsThinking ? m.thinkingIntensity : undefined,
      inputContextLength: m.inputContextLength ?? undefined,
      outputContextLength: m.outputContextLength ?? undefined,
    })),
  }));
  const parsed = splitModelKey(draft.currentModelKey);
  const first = providers.find((p) => p.models.length);
  const currentModel = parsed
    ? { providerId: parsed.providerId, modelId: parsed.modelId }
    : first
      ? { providerId: first.id, modelId: first.models[0].id }
      : undefined;
  return { providers, currentModel };
}

/** 轮数上限草稿归一（空 / 非法回退 50；范围 1-500） */
function draftRoundsNormalized(): number {
  const n = Math.floor(Number(draft.maxToolRounds));
  if (!Number.isFinite(n) || n < 1) return DEFAULT_ROUNDS;
  return Math.min(500, n);
}

const dirty = computed(
  () =>
    JSON.stringify(draftNormalized()) !==
      JSON.stringify({
        providers: ai.aiSettings.providers.map((p) => ({
          id: p.id,
          name: p.name,
          protocol: p.protocol,
          baseUrl: p.baseUrl,
          apiKey: p.apiKey,
          models: p.models.map(
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
        })),
        // 形态对齐：两侧都仅在存在时携带 currentModel 键（否则 undefined vs null 恒不等）
        ...(ai.aiSettings.currentModel ? { currentModel: { ...ai.aiSettings.currentModel } } : {}),
      }) ||
    (draft.globalRules || "") !== (ai.aiSettings.globalRules || "") ||
    draftRoundsNormalized() !== ai.maxToolRounds,
);

/** 保存 AI 设置（校验失败时抛错，由设置页统一提示） */
async function save() {
  if (invalid.value) throw new Error(invalid.value);
  const norm = draftNormalized();
  await ai.saveSettings({
    providers: norm.providers,
    ...(norm.currentModel ? { currentModel: norm.currentModel } : {}),
    globalRules: draft.globalRules,
    maxToolRounds: draftRoundsNormalized(),
  });
}

/** 未配置时一键跳转 AI 工具页 */
function gotoAiTool() {
  ui.setPage("ai");
}

/** 默认模型下拉选项（草稿供应商 × 模型，显示「供应商名/模型名」） */
const currentModelOptions = computed(() =>
  draft.providers.flatMap((p) =>
    p.models.map((m) => {
      const pid = p.id.trim();
      const mid = m.id.trim();
      return {
        value: mid ? modelKeyOf(pid, mid) : `pending-${m.key}`,
        label: `${p.name.trim() || `供应商${draft.providers.indexOf(p) + 1}`}/${m.name.trim() || mid || "（未填模型 id）"}`,
      };
    }),
  ),
);

defineExpose({ dirty, invalid, save, resetDraft });
</script>

<template>
  <section class="settings-card ai-card">
    <div class="card-head">
      <span class="card-title"><Bot :size="13" /> AI（多供应商 / 多模型）</span>
      <span class="card-sub"
        >供应商（协议 / 地址 /
        密钥）与模型列表、默认模型、全局规则，随底部「保存设置」统一保存</span
      >
    </div>

    <div class="providers-block">
      <div class="block-head">
        <span class="block-title">供应商列表</span>
        <a-button size="small" type="dashed" @click="addProvider">
          <template #icon><Plus :size="12" /></template>
          添加供应商
        </a-button>
      </div>

      <div v-if="!draft.providers.length" class="providers-empty">
        暂无供应商：添加供应商（选择对话协议、填写服务地址）并添加模型后，即可在
        <a class="inline-link" @click="gotoAiTool">AI 工具</a>
        页对话
      </div>

      <div v-for="(p, pi) in draft.providers" :key="p.key" class="provider-row">
        <div class="provider-line">
          <a-input
            v-model:value="p.name"
            class="grow"
            placeholder="供应商名称（如 OpenAI / Anthropic；空则自动命名）"
          />
          <a-select
            v-model:value="p.protocol"
            :options="PROTOCOL_OPTIONS"
            size="small"
            style="width: 210px"
          />
          <button class="row-del" type="button" title="删除该供应商" @click="removeProvider(pi)">
            <Trash2 :size="13" />
          </button>
        </div>
        <div class="provider-line">
          <a-input
            v-model:value="p.baseUrl"
            class="grow"
            :placeholder="
              p.protocol === 'anthropic'
                ? 'https://api.anthropic.com（可带或不带 /v1）'
                : 'https://api.example.com/v1（必须以 /v1 结尾）'
            "
            allow-clear
          />
        </div>
        <div class="provider-line">
          <a-input-password
            v-model:value="p.apiKey"
            class="grow"
            :placeholder="
              p.protocol === 'anthropic'
                ? 'sk-ant-...（x-api-key 鉴权；本地服务可留空）'
                : 'sk-...（Bearer 鉴权；本地服务可留空）'
            "
            allow-clear
          />
        </div>
        <div v-if="providerBaseUrlError(p)" class="field-error">{{ providerBaseUrlError(p) }}</div>

        <div class="models-block">
          <div class="block-head">
            <span class="block-title">模型列表</span>
            <a-button size="small" type="dashed" @click="addModel(p)">
              <template #icon><Plus :size="12" /></template>
              添加模型
            </a-button>
          </div>
          <div v-if="!p.models.length" class="models-empty">该供应商暂无模型</div>
          <div v-for="(m, i) in p.models" :key="m.key" class="model-row">
            <div class="model-line">
              <a-input v-model:value="m.id" class="grow" placeholder="模型 id（如 glm-4.6）" />
              <a-input
                v-model:value="m.name"
                class="grow"
                placeholder="展示名称（空则显示模型 id）"
              />
              <button class="row-del" type="button" title="删除该模型" @click="removeModel(p, i)">
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
            <div v-if="modelError(p, i)" class="field-error">{{ modelError(p, i) }}</div>
          </div>
        </div>
      </div>
    </div>

    <!-- 默认模型（AI 工具页启动时的选中模型；会话内切换不写回设置） -->
    <div class="current-model-block">
      <div class="field-row">
        <label class="field-label">默认模型</label>
        <a-select
          v-model:value="draft.currentModelKey"
          :options="currentModelOptions"
          size="small"
          style="min-width: 240px"
          placeholder="选择默认模型（显示为 供应商名/模型名）"
          allow-clear
        />
        <span class="rounds-hint">AI 工具页启动时选中的模型，显示为「供应商名/模型名」</span>
      </div>
    </div>

    <!-- 轮数上限（独立块：位于默认模型之后） -->
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
    margin-left: 0;
    margin-top: 6px;
    font-size: 11px;
    color: var(--dbm-danger);
  }

  .rounds-hint {
    font-size: 11px;
    color: var(--dbm-text-3);
  }
}

.providers-block {
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

  .providers-empty {
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

.provider-row {
  padding: 10px;
  border: 1px solid var(--dbm-border);
  border-radius: var(--dbm-radius-m);
  margin-bottom: 10px;
  background: var(--dbm-bg-2);

  .provider-line {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;

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
}

.models-block {
  border-top: 1px dashed var(--dbm-border);
  padding-top: 8px;

  .block-head {
    margin-bottom: 6px;
  }

  .block-title {
    font-size: 11.5px;
    font-weight: 600;
    color: var(--dbm-text-3);
  }

  .models-empty {
    padding: 8px 2px;
    font-size: 11.5px;
    color: var(--dbm-text-3);
  }
}

.model-row {
  padding: 8px 10px;
  border: 1px solid var(--dbm-border);
  border-radius: var(--dbm-radius-m);
  margin-bottom: 8px;
  background: var(--dbm-bg-panel);

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
}

.current-model-block {
  margin-bottom: 14px;

  .field-row {
    display: flex;
    align-items: center;
    gap: 10px;
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
