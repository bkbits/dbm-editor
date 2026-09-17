/**
 * 轻量级统一日志器（src/log/Logger.ts）
 *
 * 用法：
 *   import { Logger } from '@/log/Logger'
 *   Logger.setLevel('INFO')            // 或 Logger.level = 'INFO'
 *   Logger.debug('入参', args)          // DEBUG 级，受级别过滤
 *   Logger.error('失败', err)           // ERROR 级
 *
 * 级别语义（权重递增）：DEBUG < INFO < WARN < ERROR < FATAL；
 * 只输出当前级别及以上的日志；DISABLED 屏蔽一切输出（含 log 与 fatal）。
 * log() 为无级别方法：只要未禁用即输出（定位等同 console.log，
 * 不参与级别过滤，适合必须可见的关键提示）。
 *
 * 输出通道映射：debug/log → console.log（不用 console.debug——
 * Chrome DevTools 默认过滤级隐藏 Verbose，debug 会看不到）；
 * info → console.info；warn → console.warn；error/fatal → console.error
 * （fatal 以 [FATAL] 标签区分）。
 *
 * 输出格式：`[HH:mm:ss.SSS] [级别]` 前缀 + 原样透传的参数
 * （对象保持 DevTools 可展开，不被字符串化）。
 *
 * 默认级别：开发构建 DEBUG（全量输出），生产构建 INFO
 * （可用 setLevel 运行时调整）。
 */

/** 日志级别：DISABLED 表示完全关闭日志输出 */
export type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR" | "FATAL" | "DISABLED";

/** 级别权重（越大越严重；DISABLED 无权重、直接短路屏蔽） */
const WEIGHT: Record<Exclude<LogLevel, "DISABLED">, number> = {
  DEBUG: 10,
  INFO: 20,
  WARN: 30,
  ERROR: 40,
  FATAL: 50,
};

/** 当前级别：模块级闭包变量（方法被解构调用时不依赖 this，依然正确） */
let currentLevel: LogLevel = import.meta.env.DEV ? "DEBUG" : "INFO";

/** 目标级别是否达到当前级别门槛（DISABLED 恒为否） */
function enabled(level: Exclude<LogLevel, "DISABLED">): boolean {
  if (currentLevel === "DISABLED") return false;
  return WEIGHT[currentLevel] <= WEIGHT[level];
}

/** 时间戳 [HH:mm:ss.SSS] */
function stamp(): string {
  const d = new Date();
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

export const Logger = {
  /** 读取 / 设置当前级别（Logger.level = 'WARN' 与 setLevel 等价） */
  get level(): LogLevel {
    return currentLevel;
  },
  set level(level: LogLevel) {
    currentLevel = level;
  },

  /** 设置日志级别（DEBUG / INFO / WARN / ERROR / FATAL / DISABLED） */
  setLevel(level: LogLevel): void {
    currentLevel = level;
  },

  /** 当前日志级别 */
  getLevel(): LogLevel {
    return currentLevel;
  },

  /** 无级别输出：未禁用即打印（不参与级别过滤，等同 console.log 定位） */
  log(...args: unknown[]): void {
    if (currentLevel === "DISABLED") return;
    console.log(`[${stamp()}] [LOG]`, ...args);
  },

  /** DEBUG 级输出（细粒度追踪，如契约方法的入参 / 返回） */
  debug(...args: unknown[]): void {
    if (!enabled("DEBUG")) return;
    console.log(`[${stamp()}] [DEBUG]`, ...args);
  },

  /** INFO 级输出 */
  info(...args: unknown[]): void {
    if (!enabled("INFO")) return;
    console.info(`[${stamp()}] [INFO]`, ...args);
  },

  /** WARN 级输出 */
  warn(...args: unknown[]): void {
    if (!enabled("WARN")) return;
    console.warn(`[${stamp()}] [WARN]`, ...args);
  },

  /** ERROR 级输出 */
  error(...args: unknown[]): void {
    if (!enabled("ERROR")) return;
    console.error(`[${stamp()}] [ERROR]`, ...args);
  },

  /** FATAL 级输出（最高级别；控制台无 fatal 通道，按 error 通道 + [FATAL] 标签输出） */
  fatal(...args: unknown[]): void {
    if (!enabled("FATAL")) return;
    console.error(`[${stamp()}] [FATAL]`, ...args);
  },
};
