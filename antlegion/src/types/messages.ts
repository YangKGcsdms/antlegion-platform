/**
 * LLM 消息类型定义
 * 对齐 Anthropic Messages API，provider 内部负责转换其他格式
 */

export interface TextBlock {
  type: "text";
  text: string;
}

export interface ToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: unknown;
}

export interface ToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

export type ContentBlock = TextBlock | ToolUseBlock;

export interface Message {
  role: "user" | "assistant";
  content: string | ContentBlock[] | ToolResultBlock[];
}

export interface ToolSchema {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface LlmResponse {
  stopReason: "end_turn" | "tool_use";
  content: ContentBlock[];
  usage?: { inputTokens: number; outputTokens: number };
}
