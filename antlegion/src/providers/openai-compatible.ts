/**
 * OpenAI-compatible Provider — 原生 fetch 实现
 * 支持 OpenRouter、Ollama、任何 OpenAI chat/completions 兼容端点
 */

import type { LlmProvider } from "./types.js";
import type {
  Message,
  ToolSchema,
  LlmResponse,
  ContentBlock,
  ToolUseBlock,
  TextBlock,
} from "../types/messages.js";

interface OpenAIMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | null;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
}

interface OpenAIToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

interface OpenAIChoice {
  message: {
    role: string;
    content: string | null;
    tool_calls?: OpenAIToolCall[];
  };
  finish_reason: string;
}

interface OpenAIResponse {
  choices: OpenAIChoice[];
  usage?: { prompt_tokens: number; completion_tokens: number };
}

export class OpenAICompatibleProvider implements LlmProvider {
  constructor(
    private apiKey: string,
    private baseUrl: string,
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  async createMessage(params: {
    model: string;
    system: string;
    messages: Message[];
    tools: ToolSchema[];
    maxTokens: number;
  }): Promise<LlmResponse> {
    const openaiMessages: OpenAIMessage[] = [
      { role: "system", content: params.system },
      ...this.convertMessages(params.messages),
    ];

    const openaiTools = params.tools.map((t) => ({
      type: "function" as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.input_schema,
      },
    }));

    const body: Record<string, unknown> = {
      model: params.model,
      messages: openaiMessages,
      max_tokens: params.maxTokens,
    };

    if (openaiTools.length > 0) {
      body.tools = openaiTools;
    }

    const timeoutMs = 120_000; // 120s，给大模型足够时间
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        throw new Error(`OpenAI-compatible API timeout after ${timeoutMs / 1000}s`);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`OpenAI-compatible API error: ${res.status} ${text}`);
    }

    const data = (await res.json()) as OpenAIResponse;
    return this.normalizeResponse(data);
  }

  private convertMessages(messages: Message[]): OpenAIMessage[] {
    const result: OpenAIMessage[] = [];

    for (const msg of messages) {
      if (typeof msg.content === "string") {
        result.push({ role: msg.role as "user" | "assistant", content: msg.content });
        continue;
      }

      if (!Array.isArray(msg.content)) continue;

      // tool_result blocks → OpenAI tool role messages
      if (msg.content.length > 0 && "tool_use_id" in msg.content[0]) {
        for (const block of msg.content) {
          if ("tool_use_id" in block) {
            result.push({
              role: "tool",
              content: block.content,
              tool_call_id: block.tool_use_id,
            });
          }
        }
        continue;
      }

      // assistant content blocks → text + tool_calls
      const textParts: string[] = [];
      const toolCalls: OpenAIToolCall[] = [];

      for (const block of msg.content) {
        if ("text" in block && block.type === "text") {
          textParts.push(block.text);
        } else if ("name" in block && block.type === "tool_use") {
          toolCalls.push({
            id: block.id,
            type: "function",
            function: {
              name: block.name,
              arguments: JSON.stringify(block.input),
            },
          });
        }
      }

      const openaiMsg: OpenAIMessage = {
        role: msg.role as "user" | "assistant",
        content: textParts.join("\n") || null,
      };
      if (toolCalls.length > 0) {
        openaiMsg.tool_calls = toolCalls;
      }
      result.push(openaiMsg);
    }

    return result;
  }

  private normalizeResponse(data: OpenAIResponse): LlmResponse {
    const choice = data.choices[0];
    if (!choice) throw new Error("no choices in response");

    const content: ContentBlock[] = [];

    if (choice.message.content) {
      content.push({ type: "text", text: choice.message.content } as TextBlock);
    }

    if (choice.message.tool_calls) {
      for (const tc of choice.message.tool_calls) {
        let input: unknown;
        try {
          input = JSON.parse(tc.function.arguments);
        } catch {
          input = {};
        }
        content.push({
          type: "tool_use",
          id: tc.id,
          name: tc.function.name,
          input,
        } as ToolUseBlock);
      }
    }

    const hasToolUse = content.some((b) => b.type === "tool_use");

    return {
      stopReason: hasToolUse ? "tool_use" : "end_turn",
      content,
      usage: data.usage
        ? { inputTokens: data.usage.prompt_tokens, outputTokens: data.usage.completion_tokens }
        : undefined,
    };
  }
}
