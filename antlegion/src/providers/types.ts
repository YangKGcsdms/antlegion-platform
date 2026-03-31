import type { Message, ToolSchema, LlmResponse } from "../types/messages.js";

export interface LlmProvider {
  createMessage(params: {
    model: string;
    system: string;
    messages: Message[];
    tools: ToolSchema[];
    maxTokens: number;
  }): Promise<LlmResponse>;
}
