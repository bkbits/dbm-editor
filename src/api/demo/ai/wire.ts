/**
 * AIApi 对话客户端 · wire 形态转换（归一契约 → 三协议请求体）
 *
 * 归一 ChatMessage / ChatToolSpec 在各协议下的请求形态差异全部收敛在本文件：
 * - openai-chat：messages 数组（snake_case 工具调用）+ tools 嵌套 function
 * - openai-responses：input 数组（消息 / function_call / function_call_output
 *   混排 items）+ tools 拍平
 * - anthropic：system 独立字段 + messages 严格 user/assistant 交替（连续
 *   tool 结果合并为一个 user 消息的 tool_result 块）+ tools 用 input_schema
 */
import type { ChatMessage, ChatToolSpec } from "@/types/ai";

/* ==================== openai chat completions ==================== */

/** 归一消息 → openai chat completions wire（camelCase 契约 → snake_case） */
export function openaiChatMessages(messages: ChatMessage[]): unknown[] {
  return messages.map((m) => {
    const out: Record<string, unknown> = { role: m.role, content: m.content ?? null };
    if (m.toolCalls?.length) {
      out.tool_calls = m.toolCalls.map((c) => ({
        id: c.id,
        type: "function",
        function: { name: c.function.name, arguments: c.function.arguments || "{}" },
      }));
    }
    if (m.toolCallId) out.tool_call_id = m.toolCallId;
    return out;
  });
}

/** 归一工具定义 → openai chat completions tools（嵌套 function 形态） */
export function openaiChatTools(tools: ChatToolSpec[]): unknown[] {
  return tools;
}

/* ==================== openai responses ==================== */

/**
 * 归一消息 → openai responses input items：
 * system/user/assistant 转角色消息（assistant 正文独立成项），
 * assistant 的工具调用逐个转 function_call item，tool 消息转 function_call_output。
 */
export function openaiResponsesInput(messages: ChatMessage[]): unknown[] {
  const items: unknown[] = [];
  for (const m of messages) {
    if (m.role === "system" || m.role === "user") {
      items.push({ role: m.role, content: m.content ?? "" });
    } else if (m.role === "assistant") {
      const text = String(m.content ?? "");
      if (text) items.push({ role: "assistant", content: text });
      for (const tc of m.toolCalls || []) {
        items.push({
          type: "function_call",
          call_id: tc.id,
          name: tc.function.name,
          arguments: tc.function.arguments || "{}",
        });
      }
    } else {
      items.push({
        type: "function_call_output",
        call_id: m.toolCallId ?? "",
        output: String(m.content ?? ""),
      });
    }
  }
  return items;
}

/** 归一工具定义 → openai responses tools（拍平形态：name/description/parameters 顶层） */
export function openaiResponsesTools(tools: ChatToolSpec[]): unknown[] {
  return tools.map((t) => ({
    type: "function",
    name: t.function.name,
    description: t.function.description,
    parameters: t.function.parameters,
  }));
}

/* ==================== anthropic messages ==================== */

/**
 * 归一消息 → anthropic 请求载荷：system 消息合并为独立 system 字符串；
 * assistant 正文块 + tool_use 块；tool 消息转 user 的 tool_result 块，
 * 连续 tool 消息合并进同一 user 消息（协议要求角色严格交替）。
 */
export function anthropicPayload(messages: ChatMessage[]): {
  system: string;
  messages: Array<{ role: "user" | "assistant"; content: unknown }>;
} {
  const systemParts: string[] = [];
  const out: Array<{ role: "user" | "assistant"; content: unknown }> = [];
  /** 把消息追加到 user/assistant 序列（连续 tool 结果并入最后一条 user） */
  const push = (role: "user" | "assistant", content: unknown) => {
    const last = out[out.length - 1];
    // 连续 user（tool 结果）合并：anthropic 要求严格交替
    if (role === "user" && last && last.role === "user" && Array.isArray(last.content)) {
      last.content = [...last.content, ...(Array.isArray(content) ? content : [])];
      return;
    }
    out.push({ role, content });
  };
  for (const m of messages) {
    if (m.role === "system") {
      const text = String(m.content ?? "").trim();
      if (text) systemParts.push(text);
    } else if (m.role === "user") {
      push("user", String(m.content ?? "") || " ");
    } else if (m.role === "assistant") {
      const text = String(m.content ?? "");
      const blocks: unknown[] = [];
      if (text) blocks.push({ type: "text", text });
      for (const tc of m.toolCalls || []) {
        let input: unknown = {};
        try {
          input = JSON.parse(tc.function.arguments || "{}") as unknown;
        } catch {
          /* 参数非 JSON 时回退空对象 */
        }
        blocks.push({ type: "tool_use", id: tc.id, name: tc.function.name, input });
      }
      // anthropic 要求 assistant content 非空
      push("assistant", blocks.length ? blocks : [{ type: "text", text: " " }]);
    } else {
      push("user", [
        { type: "tool_result", tool_use_id: m.toolCallId ?? "", content: String(m.content ?? "") },
      ]);
    }
  }
  return { system: systemParts.join("\n\n"), messages: out };
}

/** 归一工具定义 → anthropic tools（input_schema 形态） */
export function anthropicTools(tools: ChatToolSpec[]): unknown[] {
  return tools.map((t) => ({
    name: t.function.name,
    description: t.function.description,
    input_schema: t.function.parameters,
  }));
}
