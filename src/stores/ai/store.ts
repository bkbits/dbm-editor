/**
 * AI 仓库：会话状态与运行编排
 * （reactive 对象工厂形态，由 DBManagerView 经上下文注入，不依赖 Pinia；
 *   运行内核为 @earendil-works/pi-agent-core 的 Agent 循环，经 src/ai/pi-agent.ts
 *   适配层接入。「模型流式输出 → 工具调用 → 结果回填 → 继续生成」由 Agent 驱动，
 *   经 subscribe 事件镜像到界面会话态（消息流式 / 工具记录 / 任务清单 / token 统计），
 *   轮数上限防失控；工具对模型等数据的改动在会话结束后按域同步刷新，
 *   保证画布 / 字典 / 模板 / 设置页与数据一致。）
 */
import { reactive } from "vue";
import { message } from "antdv-next";
import { useDBManagerContext } from "../context";
import type { AiModelConfig, AiSettings } from "@/types/ai";
import { errorMessageOf } from "@/api/manager-api";
import { DEFAULT_MAX_TOOL_ROUNDS } from "@/api/demo-manager-api";
import {
  Agent,
  createChatStreamFn,
  piModelOf,
  piThinkingLevelOf,
  seedMessagesOf,
  serializeMessagesForCompact,
  textOf,
  thinkingOf,
  toPiTools,
  toolCallsOf,
} from "@/ai/pi-agent";
import type { AgentEvent } from "@/ai/pi-agent";
import type { Message } from "@earendil-works/pi-ai";
import { uid } from "@/utils/id";
import {
  COMPACT_MIN_NEW_MSGS,
  COMPACT_RATIO,
  COMPACT_SYSTEM_PROMPT,
  buildSystemPrompt,
  prettyJson,
} from "./prompt";
import { renderTaskBlock, syncTasksFromContent } from "./task-list";
import { buildAgentTools } from "./tools";
import type {
  AgentHooks,
  AiChatMessage,
  AiDeps,
  AiPendingReplace,
  AiTaskItem,
  AiToolRecord,
  AiZipDownload,
} from "./types";

/** 深拷贝（JSON 往返）：用于模型配置等纯数据，避免与外部对象共享引用 */
function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}
/* ==================== 仓库 ==================== */

/**
 * 创建 AI 仓库实例（reactive 工厂形态：每个宿主实例一份，经上下文注入子树，不依赖 Pinia）。
 * deps 每次调用时懒取（api / 模型 / 字典 / 模板 / 设置），避免 api 切换后拿到旧实例。
 */
export function createAiStore(deps: AiDeps) {
  /** 在途加载 Promise：并发调用方共享同一次加载；失败可重试 */
  let initInFlight: Promise<void> | null = null;
  /** 当前运行中的 pi Agent 实例（闭包持有，不进 reactive——避免深度代理其内部状态） */
  let activeAgent: InstanceType<typeof Agent> | null = null;
  return reactive({
    loaded: false,
    loading: false,
    /** AI 设置（已保存态；编辑草稿由设置页 AI 区块本地管理） */
    aiSettings: { baseUrl: "", apiKey: "", models: [], globalRules: "" } as AiSettings,
    /** 当前选中模型 id（缺省取模型列表第一个） */
    selectedModelId: "",

    /* ---------- 会话状态 ---------- */
    messages: [] as AiChatMessage[],
    toolRecords: [] as AiToolRecord[],
    running: false,
    abortController: null as AbortController | null,
    /** 代码生成 zip 下载缓存（callId → Blob URL，会话内可重复下载） */
    zipDownloads: {} as Record<string, AiZipDownload>,
    /** 待确认的代码替换（弹窗展示文件清单，用户确认/取消后 resolve） */
    pendingReplace: null as AiPendingReplace | null,

    /* ---------- 任务清单（左侧任务面板；由模型按模板同步） ---------- */
    tasks: [] as AiTaskItem[],

    /* ---------- token 用量统计 ---------- */
    /** 上下文已用 token（最近一轮 usage 的 total；流式期间含当轮输出估算增长） */
    contextUsed: 0,
    /** 当前任务实时输出速度（tok/s；running 期间持续更新，结束归零） */
    currentSpeedTokSec: 0,
    /** 上一次任务的输出速度（tok/s；任务结束后保留，供空闲时展示） */
    lastSpeedTokSec: 0,

    /** 模型下拉选项 */
    get modelOptions(): Array<{ value: string; label: string }> {
      return this.aiSettings.models.map((m) => ({ value: m.id, label: m.name || m.id }));
    },
    /** 当前生效模型配置 */
    get currentModel(): AiModelConfig | undefined {
      return (
        this.aiSettings.models.find((m) => m.id === this.selectedModelId) ||
        this.aiSettings.models[0]
      );
    },

    /** 单次任务工具调用轮数上限（设置项，缺省 50） */
    get maxToolRounds(): number {
      const n = Math.floor(Number(this.aiSettings.maxToolRounds));
      return Number.isFinite(n) && n >= 1 ? Math.min(500, n) : DEFAULT_MAX_TOOL_ROUNDS;
    },

    /* ---------- 设置读写 ---------- */

    /** 懒加载 AI 设置（并发调用共享同一在途 Promise；失败弹中文提示并允许重试） */
    async init(): Promise<void> {
      if (this.loaded) return;
      if (!initInFlight) {
        this.loading = true;
        initInFlight = (async () => {
          try {
            const s = await deps.getApi().getAiSettings();
            this.aiSettings = {
              baseUrl: String(s.baseUrl ?? ""),
              apiKey: String(s.apiKey ?? ""),
              models: Array.isArray(s.models) ? s.models.map(clone) : [],
              globalRules: String(s.globalRules ?? ""),
              maxToolRounds:
                Math.floor(Number(s.maxToolRounds)) >= 1
                  ? Math.min(500, Math.floor(Number(s.maxToolRounds)))
                  : DEFAULT_MAX_TOOL_ROUNDS,
            };
            if (!this.aiSettings.models.some((m) => m.id === this.selectedModelId)) {
              this.selectedModelId = this.aiSettings.models[0]?.id ?? "";
            }
            this.loaded = true;
          } catch (e) {
            message.error(errorMessageOf(e, "AI 设置加载失败"));
          } finally {
            this.loading = false;
            initInFlight = null;
          }
        })();
      }
      await initInFlight;
    },

    /** 保存 AI 设置（api 校验通过后更新本地已保存态） */
    async saveSettings(settings: AiSettings) {
      const saved: AiSettings = {
        baseUrl: String(settings.baseUrl ?? "").trim(),
        apiKey: String(settings.apiKey ?? ""),
        models: (settings.models || []).map(clone),
        globalRules: String(settings.globalRules ?? ""),
        maxToolRounds:
          Math.floor(Number(settings.maxToolRounds)) >= 1
            ? Math.min(500, Math.floor(Number(settings.maxToolRounds)))
            : DEFAULT_MAX_TOOL_ROUNDS,
      };
      await deps.getApi().saveAiSettings(saved);
      this.aiSettings = saved;
      if (!this.aiSettings.models.some((m) => m.id === this.selectedModelId)) {
        this.selectedModelId = this.aiSettings.models[0]?.id ?? "";
      }
      this.loaded = true;
    },

    /* ---------- 会话操作 ---------- */

    /** 中止当前生成（Agent 循环与流式请求一并 abort，消息标记为已中止；待确认的替换一并取消） */
    stop() {
      this.resolveReplace(false);
      this.abortController?.abort();
      activeAgent?.abort();
    },

    /** 开启新会话（清空消息、调用记录与任务清单，释放 zip 缓存；不影响模型选择） */
    clearSession() {
      if (this.running) this.stop();
      this.messages = [];
      this.toolRecords = [];
      this.tasks = [];
      this.contextUsed = 0;
      this.releaseZipDownloads();
    },

    /** 仅清空能力调用记录（聊天消息保留；释放被清记录关联的 zip 下载缓存） */
    clearToolRecords() {
      if (this.running) return;
      for (const r of this.toolRecords) {
        const zip = this.zipDownloads[r.callId];
        if (zip) {
          URL.revokeObjectURL(zip.url);
          delete this.zipDownloads[r.callId];
        }
      }
      this.toolRecords = [];
    },

    /** api 切换时重置会话与加载态（由 DBManagerView 调用） */
    resetForApiSwitch() {
      if (this.running) this.stop();
      this.messages = [];
      this.toolRecords = [];
      this.tasks = [];
      this.contextUsed = 0;
      this.currentSpeedTokSec = 0;
      this.lastSpeedTokSec = 0;
      this.loaded = false;
      this.loading = false;
      this.releaseZipDownloads();
    },

    /* ---------- zip 下载缓存 ---------- */

    /** 释放全部 zip 下载缓存（会话清理时调用） */
    releaseZipDownloads() {
      for (const key of Object.keys(this.zipDownloads)) {
        URL.revokeObjectURL(this.zipDownloads[key].url);
        delete this.zipDownloads[key];
      }
    },

    /** 触发 zip 下载（缓存 Blob URL，可重复点击；不释放） */
    downloadZip(callId: string) {
      const entry = this.zipDownloads[callId];
      if (!entry) return;
      const a = document.createElement("a");
      a.href = entry.url;
      a.download = entry.fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
    },

    /* ---------- 代码替换确认 ---------- */

    /** 弹窗回调：确认 / 取消待确认的代码替换 */
    resolveReplace(ok: boolean) {
      const pending = this.pendingReplace;
      if (!pending) return;
      this.pendingReplace = null;
      pending.resolve(ok);
    },

    /**
     * 发送用户消息并运行 AGENT 循环：
     * 流式输出（思考 / 正文）→ 工具调用 → 结果回填 → 继续生成，直至最终回答。
     * 全局规则非空时附加在系统提示中；工具改动过的域在结束时同步刷新仓库。
     *
     * 任务清单：模型按系统提示中的模板输出【任务清单·汇报/同步】块，
     * 流式期间实时解析进 this.tasks（左侧任务面板）；用户中止时执行中的任务转暂停，
     * 下一轮发送时把暂停中的任务同步给模型（modelContent）。
     * 上下文压缩：已用上下文 ≥ 模型输入上下文的 85% 时，在轮边界自动发起压缩请求，
     * 历史折叠为摘要（compact 标记消息），模型序列以摘要为基座继续。
     */
    async send(text: string) {
      const content = String(text ?? "").trim();
      if (!content || this.running) return;
      await this.init();
      if (!this.aiSettings.baseUrl || !this.aiSettings.models.length) {
        this.messages.push({
          id: uid("ai-"),
          role: "assistant",
          content:
            "尚未配置 AI 服务：请先在「系统设置 → AI」中填写 openai compatible 服务地址（以 /v1 结尾）并添加模型，保存后再来对话。",
          status: "error",
          createdAt: Date.now(),
        });
        return;
      }
      const model = this.currentModel!;
      const maxRounds = this.maxToolRounds;
      /* 界面态钩子：zip 缓存注册 + 代码替换确认（绑定本仓库实例） */
      const hooks: AgentHooks = {
        /** 注册（或覆盖）某次调用的 zip 下载缓存：同 callId 旧 URL 先释放，避免内存泄漏 */
        registerZip: (callId, blob, fileName, fileCount) => {
          const old = this.zipDownloads[callId];
          if (old) URL.revokeObjectURL(old.url);
          this.zipDownloads = {
            ...this.zipDownloads,
            [callId]: {
              fileName,
              url: URL.createObjectURL(blob),
              size: blob.size,
              fileCount,
              createdAt: Date.now(),
            },
          };
        },
        /** 代码替换确认：挂起 pendingReplace（界面据此弹窗），用户确认/取消由 resolveReplace 落地 */
        requestReplaceConfirm: (files) =>
          new Promise<boolean>((resolve) => {
            this.pendingReplace = { files, resolve };
          }),
      };
      const tools = buildAgentTools(deps, hooks);
      const dirtyDomains = new Set<string>();

      /* ---------- 暂停任务同步：上轮被中止的任务在下轮发给模型 ---------- */
      const pausedTasks = this.tasks.filter((t) => t.status === "paused");
      const userMsg: AiChatMessage = reactive({
        id: uid("ai-"),
        role: "user",
        content,
        ...(pausedTasks.length
          ? {
              modelContent: `${content}\n\n${renderTaskBlock(
                "【任务清单·同步】上轮任务被用户中止，以下任务处于暂停状态，请在理解上下文后继续完成（完成后按模板同步状态）：",
                pausedTasks,
              )}`,
            }
          : {}),
        status: "done",
        createdAt: Date.now(),
      });
      this.messages.push(userMsg);
      // 无暂停任务时清空上一任务的残留清单（新问题 = 新任务上下文）
      if (!pausedTasks.length) this.tasks = [];
      this.running = true;
      const controller = new AbortController();
      this.abortController = controller;

      /* ---------- token 采集：实时速度（估算）与轮末真实值 ---------- */
      this.currentSpeedTokSec = 0;
      /** 粗略 token 估算（中文 ~2 字符/token；仅流式期间的瞬时展示，轮末以真实 usage 覆盖） */
      const estTokens = (chars: number) => Math.max(1, Math.round(chars / 2));
      let turnFirstDeltaAt = 0; // 本轮首个增量到达时刻（0 = 尚无输出）
      let turnDeltaChars = 0; // 本轮增量字符数（正文 + 思考）
      let turnBaseTotal = this.contextUsed; // 本轮开始时的上下文基准（流式期间估算叠加）
      let turnStartAt = Date.now(); // 本轮请求发起时刻（速度兜底基准）
      const speedTicker = window.setInterval(() => {
        if (!turnFirstDeltaAt) return;
        const elapsed = (Date.now() - turnFirstDeltaAt) / 1000;
        if (elapsed > 0) this.currentSpeedTokSec = estTokens(turnDeltaChars) / elapsed;
      }, 500);

      const sysPrompt = buildSystemPrompt(this.aiSettings.globalRules || "");
      const piModel = piModelOf(model);

      /* ---------- 上下文自动压缩（compact）---------- */

      /** 界面历史自最近 compact 标记起累积的消息数（compact 再触发频率下限） */
      const countSinceCompact = (): number => {
        let since = 0;
        for (const m of this.messages) {
          if (m.compact) {
            since = 0;
            continue;
          }
          if (m.role === "user") since += 1;
          else if (
            m.role === "assistant" &&
            m.status === "done" &&
            (m.content || m.toolCalls?.length)
          )
            since += 1 + (m.toolCalls?.length ?? 0);
        }
        return since;
      };
      let msgsSinceCompact = countSinceCompact();

      /** 压缩执行：序列化消息 → 压缩请求 → compact 标记消息入界面历史（事实源同步） */
      const runCompact = async (
        messages: ReadonlyArray<Message | { role: string }>,
      ): Promise<boolean> => {
        const serialized = serializeMessagesForCompact(messages);
        if (!serialized) return false;
        const res = await deps.getApi().chatComplete({
          model: model.id,
          messages: [
            { role: "system", content: COMPACT_SYSTEM_PROMPT },
            { role: "user", content: `请压缩以下对话历史：\n\n${serialized}` },
          ],
          signal: controller.signal,
        });
        const summary = String(res.content || "").trim();
        if (!summary) return false;
        this.messages.push(
          reactive({
            id: uid("ai-"),
            role: "assistant",
            content: "",
            status: "done",
            createdAt: Date.now(),
            compact: { summary },
          }),
        );
        msgsSinceCompact = 0;
        return true;
      };

      /** 压缩触发条件：占用 ≥ 85% 且距上次压缩有足够新消息（防对摘要反复压缩） */
      const shouldCompact = (): boolean =>
        piModel.contextWindow > 0 &&
        this.contextUsed > 0 &&
        this.contextUsed / piModel.contextWindow >= COMPACT_RATIO &&
        msgsSinceCompact >= COMPACT_MIN_NEW_MSGS;

      /* ---------- 事件镜像运行态 ---------- */
      let reachedFinal = false; // 得到无工具调用的最终回答（自然收敛）
      let endedAbnormally: "aborted" | "error" | null = null; // 流式/循环异常终止形态
      let lastErrorText = "";
      let turnCount = 0; // 已完成轮数（轮数上限）
      let currentAsst: AiChatMessage | null = null; // 流式中的助手消息
      const recordStarts = new Map<string, { record: AiToolRecord; at: number }>();
      /** 流式增量累加（正文 + 思考）：记录首增量时刻与累计字符，并实时估算上下文占用 */
      const bumpDelta = (len: number) => {
        if (!turnFirstDeltaAt) turnFirstDeltaAt = Date.now();
        turnDeltaChars += len;
        // 上下文实时估算：基准 + 当轮已输出（usage 到达后被真实值覆盖）
        this.contextUsed = turnBaseTotal + estTokens(turnDeltaChars);
      };

      /** pi 工具注册表（执行成功上报脏域；subscribe 镜像共享本仓库实例态） */
      const piTools = toPiTools(tools, (domains) => {
        for (const d of domains) dirtyDomains.add(d);
      });

      let agent: InstanceType<typeof Agent> | null = null;
      let unsubscribe: (() => void) | null = null;

      try {
        /* 首轮边界压缩（跨任务累积的占用；运行中的轮边界压缩由 prepareNextTurn 承接） */
        // 种子源排除本轮 userMsg（prompt() 会作为新消息追加，避免重复）；
        // 压缩标记消息按引用过滤不受插入位置影响
        /** 种子消息源：首轮构建与压缩后重建模型序列共用（过滤规则见上方两行注释） */
        const seedSource = () => this.messages.filter((m) => m !== userMsg);
        let seed: Message[] = seedMessagesOf(seedSource(), this.toolRecords);
        if (shouldCompact()) {
          try {
            if (await runCompact(seed)) seed = seedMessagesOf(seedSource(), this.toolRecords);
          } catch (e) {
            if (controller.signal.aborted || (e as Error)?.name === "AbortError") throw e;
            console.warn("[ai] 上下文自动压缩失败", e);
          }
        }

        agent = new Agent({
          streamFn: createChatStreamFn(() => deps.getApi()),
          initialState: {
            systemPrompt: sysPrompt,
            model: piModel,
            thinkingLevel: piThinkingLevelOf(model),
            messages: seed,
            tools: piTools,
          },
          // 串行执行：与既有行为一致（工具多为数据写入，避免并发竞态）
          toolExecution: "sequential",
          /** 回合结束回调：累加已完成轮数，达到设置上限（maxRounds）即停止循环 */
          shouldStopAfterTurn: () => ++turnCount >= maxRounds,
          /** 轮边界回调：压缩阈值达成时以摘要重建 Agent 上下文；失败返回 undefined 继续原历史 */
          prepareNextTurn: async () => {
            // 轮边界上下文压缩（每轮结束后、下一轮请求前调用）
            if (!shouldCompact()) return undefined;
            try {
              if (await runCompact(agent!.state.messages)) {
                // 压缩成功：Agent 上下文整体替换为以摘要为基座的新种子
                //（本轮 userMsg 与既有轮次均已被吸收进摘要，compact 标记已入界面历史）
                return {
                  context: {
                    systemPrompt: sysPrompt,
                    messages: seedMessagesOf(seedSource(), this.toolRecords),
                    tools: piTools,
                  },
                };
              }
            } catch (e) {
              if (controller.signal.aborted || (e as Error)?.name === "AbortError") throw e;
              // 压缩失败不阻断会话：继续用完整历史
              console.warn("[ai] 上下文自动压缩失败", e);
            }
            return undefined;
          },
        });
        activeAgent = agent;

        /* Agent 事件 → 界面会话态镜像（消息流式 / 工具记录 / 任务清单 / token 统计） */
        unsubscribe = agent.subscribe((event: AgentEvent) => {
          switch (event.type) {
            case "turn_start":
              // 轮级 token 采集重置（速度按单轮计算，避免工具执行间隙拉低均值）
              turnFirstDeltaAt = 0;
              turnDeltaChars = 0;
              turnBaseTotal = this.contextUsed;
              turnStartAt = Date.now();
              break;
            case "message_start":
              if (event.message.role === "assistant") {
                currentAsst = reactive({
                  id: uid("ai-"),
                  role: "assistant" as const,
                  content: "",
                  reasoning: "",
                  reasoningOpen: false,
                  status: "streaming" as const,
                  createdAt: Date.now(),
                });
                this.messages.push(currentAsst);
              }
              break;
            case "message_update": {
              const e = event.assistantMessageEvent;
              const asst = currentAsst;
              if (!asst) break;
              if (e.type === "text_delta") {
                asst.content += e.delta;
                bumpDelta(e.delta.length);
                // 任务清单：流式期间实时解析（部分块也解析，面板逐步刷新）
                syncTasksFromContent(this, asst.content);
              } else if (e.type === "thinking_delta") {
                asst.reasoning = (asst.reasoning || "") + e.delta;
                asst.reasoningOpen = true; // 思考输出中自动展开
                bumpDelta(e.delta.length);
              } else if (e.type === "toolcall_end") {
                asst.toolCalls = [
                  ...(asst.toolCalls || []),
                  {
                    id: e.toolCall.id,
                    name: e.toolCall.name,
                    args: JSON.stringify(e.toolCall.arguments ?? {}),
                  },
                ];
              }
              break;
            }
            case "message_end": {
              const m = event.message;
              const asst = currentAsst;
              currentAsst = null;
              if (m.role !== "assistant" || !asst) break;
              // 展示文本收口（流式期间的中间态不做处理，完成时统一收口）
              asst.content = textOf(m).trim();
              asst.reasoning = thinkingOf(m).trim();
              if (m.stopReason === "error" || m.stopReason === "aborted") {
                asst.status = m.stopReason === "aborted" ? "aborted" : "error";
                asst.reasoningOpen = false;
                if (m.stopReason === "error" && m.errorMessage) asst.error = m.errorMessage.trim();
                endedAbnormally = m.stopReason;
                lastErrorText = m.errorMessage || "";
              } else {
                asst.status = "done";
                asst.reasoningOpen = false; // 完成后自动收起（用户可手动再展开）
                // 任务清单最终收口（模板块完整形态解析）
                syncTasksFromContent(this, asst.content);
                // 轮末 usage 收口：速度 + 上下文 + 消息/问题级用量
                const usage = m.usage;
                if (usage && (usage.input || usage.output || usage.totalTokens)) {
                  this.contextUsed = usage.totalTokens;
                  asst.tokens = { input: usage.input, output: usage.output };
                  userMsg.tokens = {
                    input: (userMsg.tokens?.input ?? 0) + usage.input,
                    output: (userMsg.tokens?.output ?? 0) + usage.output,
                  };
                  if (usage.output > 0) {
                    const span = (Date.now() - (turnFirstDeltaAt || turnStartAt)) / 1000;
                    if (span > 0) {
                      this.currentSpeedTokSec = usage.output / span;
                      this.lastSpeedTokSec = this.currentSpeedTokSec;
                      asst.speedTokSec = Math.round(usage.output / span);
                    }
                  }
                }
              }
              break;
            }
            case "tool_execution_start": {
              const tool = tools.find((t) => t.spec.function.name === event.toolName);
              const record: AiToolRecord = reactive({
                id: uid("tool-"),
                callId: event.toolCallId,
                name: event.toolName,
                argsText: prettyJson(event.args).trim(),
                resultText: "",
                status: "running",
                createdAt: Date.now(),
                ...(tool?.kind === "skill" ? { kind: "skill" as const } : {}),
              });
              this.toolRecords.push(record);
              recordStarts.set(event.toolCallId, { record, at: Date.now() });
              break;
            }
            case "tool_execution_end": {
              const entry = recordStarts.get(event.toolCallId);
              if (!entry) break;
              recordStarts.delete(event.toolCallId);
              const { record } = entry;
              record.durationMs = Date.now() - entry.at;
              record.status = event.isError ? "error" : "success";
              const result = event.result as
                | { content?: Array<{ type?: string; text?: string }>; details?: unknown }
                | undefined;
              if (event.isError) {
                // 错误文本去掉适配层加的前缀，界面展示原始原因
                record.resultText = String(result?.content?.[0]?.text ?? "")
                  .replace(/^工具执行失败：/, "")
                  .trim();
              } else {
                record.resultText = prettyJson(result?.details).trim();
              }
              msgsSinceCompact += 1;
              // 技能加载：回填展示信息（记录 + 聊天芯片——加载了哪个技能的哪些部分）
              const tool = tools.find((t) => t.spec.function.name === event.toolName);
              if (tool?.kind === "skill" && !event.isError) {
                const v = result?.details as {
                  skill?: string;
                  title?: string;
                  loadedParts?: Array<{ key: string; title: string }>;
                } | null;
                if (v?.skill) {
                  const info = {
                    name: String(v.skill),
                    title: String(v.title || v.skill),
                    parts: (v.loadedParts || []).map((p) => String(p.title || p.key)),
                  };
                  record.skill = info;
                  const lastAsst = [...this.messages].reverse().find((m) => m.role === "assistant");
                  const chip = lastAsst?.toolCalls?.find((c) => c.id === event.toolCallId);
                  if (chip) chip.skill = info;
                }
              }
              break;
            }
            case "turn_end": {
              const m = event.message;
              if (m.role === "assistant") {
                msgsSinceCompact += 1;
                if (
                  m.stopReason !== "error" &&
                  m.stopReason !== "aborted" &&
                  !toolCallsOf(m).length
                )
                  reachedFinal = true;
              }
              break;
            }
            default:
              break;
          }
        });

        await agent.prompt({
          role: "user",
          content: userMsg.modelContent || userMsg.content,
          timestamp: userMsg.createdAt,
        });
        await agent.waitForIdle();

        if (endedAbnormally) {
          // 任务未完成被中止 / 出错：执行中的任务转暂停（下轮发送时同步给模型）
          if (this.tasks.some((t) => t.status === "running")) {
            this.tasks = this.tasks.map((t) =>
              t.status === "running" ? { ...t, status: "paused" as const } : t,
            );
          }
          if (endedAbnormally === "aborted") {
            message.info("已停止生成");
          } else {
            message.error(lastErrorText || "AI 调用失败");
          }
        } else if (!reachedFinal) {
          this.messages.push({
            id: uid("ai-"),
            role: "assistant",
            content: `已连续执行 ${maxRounds} 轮工具调用仍未得到最终回答，为避免失控已中止；可继续追问让任务收尾。`,
            status: "error",
            createdAt: Date.now(),
          });
        }
        // 工具改动过的域：同步刷新对应仓库（画布/字典/模板/设置页保持一致）
        await this.syncDirtyStores(dirtyDomains);
      } catch (e) {
        const aborted = controller.signal.aborted || (e as Error)?.name === "AbortError";
        const last = [...this.messages].reverse().find((m) => m.role === "assistant");
        if (last) {
          last.status = aborted ? "aborted" : "error";
          last.reasoningOpen = false;
          if (!aborted) last.error = errorMessageOf(e, "AI 调用失败").trim();
        }
        // 任务未完成被中止 / 出错：执行中的任务转暂停（下轮发送时同步给模型）
        if (this.tasks.some((t) => t.status === "running")) {
          this.tasks = this.tasks.map((t) =>
            t.status === "running" ? { ...t, status: "paused" as const } : t,
          );
        }
        if (aborted) {
          message.info("已停止生成");
        } else {
          message.error(errorMessageOf(e, "AI 调用失败"));
        }
      } finally {
        window.clearInterval(speedTicker);
        // 任务结束：上一次速度保留（本次有输出则更新）；当前速度归零，界面切到展示上一次
        if (this.currentSpeedTokSec > 0) this.lastSpeedTokSec = this.currentSpeedTokSec;
        this.currentSpeedTokSec = 0;
        this.running = false;
        this.abortController = null;
        activeAgent = null;
        unsubscribe?.();
      }
    },

    /** 按域同步刷新被工具改动的仓库（失败静默，不阻断会话） */
    async syncDirtyStores(domains: Set<string>) {
      if (domains.has("model")) {
        try {
          await deps.getModel().refresh();
        } catch {
          /* 刷新失败不打断会话 */
        }
      }
      if (domains.has("dict")) {
        const dict = deps.getDict();
        try {
          dict.loaded = false;
          dict.loading = false;
          await dict.init();
        } catch {
          /* ignore */
        }
      }
      if (domains.has("template")) {
        const tpl = deps.getTemplate();
        try {
          tpl.loaded = false;
          tpl.loading = false;
          await tpl.init();
        } catch {
          /* ignore */
        }
      }
      if (domains.has("settings")) {
        const settings = deps.getSettings();
        try {
          settings.loaded = false;
          settings.loading = false;
          await settings.init();
        } catch {
          /* ignore */
        }
      }
    },
  });
}

export type AiStore = ReturnType<typeof createAiStore>;

/** 子组件取用 AI 仓库（须处于 DBManagerView 组件树内） */
export function useAiStore(): AiStore {
  return useDBManagerContext().ai;
}
