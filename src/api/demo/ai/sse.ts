/**
 * AIApi 对话客户端共用设施：POST 建流与 SSE data: 行迭代
 *
 * 三协议（openai-chat / openai-responses / anthropic）的流式客户端共用：
 * - postSse：fetch 建流（网络 / HTTP / 空响应体错误统一转中文提示，
 *   AbortError 原样透传供停止生成语义）
 * - consumeSse：SSE 逐行解析（data: {payload} 载荷；onPayload 返回 true
 *   表示协议结束哨兵到达，提前停止读取并释放流）
 * - parseErrorBody：HTTP 非 2xx 时提取服务端错误信息（openai / anthropic
 *   两种错误体形态 + 裸文本兜底）
 */

/** POST 建流选项（headers / body 已按协议组装完毕） */
export interface PostSseOptions {
  url: string; // 完整请求地址
  headers: Record<string, string>;
  body: unknown; // JSON 请求体
  signal?: AbortSignal;
  label: string; // 错误提示中的服务标识（如供应商地址）
}

/** 提取 HTTP 错误响应体的可读信息（openai / anthropic 错误形态 + 裸文本兜底） */
export async function parseErrorBody(res: Response): Promise<string> {
  const text = await res.text().catch(() => "");
  try {
    const parsed = JSON.parse(text) as {
      error?: { message?: string };
      message?: string;
    };
    return parsed?.error?.message || parsed?.message || text;
  } catch {
    /* 非 JSON 错误体原样展示 */
  }
  return text;
}

/** POST 建流：返回响应体流（网络 / HTTP 错误转中文提示；AbortError 透传） */
export async function postSse(opts: PostSseOptions): Promise<ReadableStream<Uint8Array>> {
  let res: Response;
  try {
    res = await fetch(opts.url, {
      method: "POST",
      headers: opts.headers,
      body: JSON.stringify(opts.body),
      signal: opts.signal,
    });
  } catch (e: unknown) {
    if ((e as Error)?.name === "AbortError") throw e;
    throw new Error(
      `无法连接 AI 服务（${opts.label}）：${(e as Error)?.message || "网络错误"}；跨域或证书问题请检查服务端 CORS 配置`,
    );
  }
  if (!res.ok) {
    const detail = await parseErrorBody(res);
    throw new Error(`AI 服务请求失败（HTTP ${res.status}）：${String(detail).slice(0, 400)}`);
  }
  const stream = res.body;
  if (!stream) throw new Error("AI 服务未返回流式响应（响应体为空）");
  return stream;
}

/**
 * 逐行消费 SSE：把每个 `data: {payload}` 载荷交给回调。
 * 回调返回 true 时提前结束（协议结束哨兵，如 openai 系的 [DONE] 或
 * anthropic 的 message_stop），随即 cancel 读锁释放连接。
 */
export async function consumeSse(
  stream: ReadableStream<Uint8Array>,
  onPayload: (payload: string) => boolean | void,
): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        // 空行 / SSE 注释与心跳行跳过
        if (!trimmed || trimmed.startsWith(":")) continue;
        if (!trimmed.startsWith("data:")) continue;
        const payload = trimmed.slice(5).trim();
        if (onPayload(payload)) return;
      }
    }
  } finally {
    reader.cancel().catch(() => {
      /* 连接已结束或已被中止 */
    });
  }
}
