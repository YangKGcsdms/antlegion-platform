/**
 * Anthropic Provider — @anthropic-ai/sdk 封装
 */

import Anthropic from "@anthropic-ai/sdk";
import type { LlmProvider } from "./types.js";
import type { Message, ToolSchema, LlmResponse, ContentBlock } from "../types/messages.js";

export class AnthropicProvider implements LlmProvider {
  private client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  async createMessage(params: {
    model: string;
    system: string;
    messages: Message[];
    tools: ToolSchema[];
    maxTokens: number;
  }): Promise<LlmResponse> {
    const response = await this.client.messages.create({
      model: params.model,
      max_tokens: params.maxTokens,
      system: params.system,
      messages: params.messages as Anthropic.MessageParam[],
      tools: params.tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.input_schema as Anthropic.Tool.InputSchema,
      })),
    });

    return {
      stopReason: response.stop_reason as "end_turn" | "tool_use",
      content: response.content as ContentBlock[],
      usage: response.usage
        ? { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens }
        : undefined,
    };
  }
}
