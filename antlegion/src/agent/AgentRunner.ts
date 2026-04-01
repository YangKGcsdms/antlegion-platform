/**
 * AgentRunner — LLM + tool use 循环
 *
 * 纯粹的 LLM 交互循环：发送消息 → 处理 tool_use → 收集 tool_result → 循环
 * 所有横切关注点（计量、审计、权限）通过 Provider 包装和 Tool 中间件注入，
 * AgentRunner 本身不依赖任何 observability 模块。
 */

import type { LlmProvider } from "../providers/types.js";
import type { ToolRegistry, ToolContext } from "../tools/registry.js";
import type { ContentBlock, ToolUseBlock } from "../types/messages.js";
import type { Session } from "./Session.js";

export interface RunResult {
  content: ContentBlock[];
  usage?: { inputTokens: number; outputTokens: number };
}

export class AgentRunner {
  constructor(
    private provider: LlmProvider,
    private toolRegistry: ToolRegistry,
    private toolContext: ToolContext,
    private model: string,
    private maxToolRounds: number,
  ) {}

  async run(systemPrompt: string, session: Session): Promise<RunResult> {
    for (let round = 0; round < this.maxToolRounds; round++) {
      const response = await this.provider.createMessage({
        model: this.model,
        system: systemPrompt,
        messages: session.getMessages(),
        tools: this.toolRegistry.schemas(),
        maxTokens: 4096,
      });

      session.appendAssistant(response.content);

      if (response.stopReason === "end_turn") {
        return { content: response.content, usage: response.usage };
      }

      // stop_reason === "tool_use"
      const toolUseBlocks = response.content.filter(
        (b): b is ToolUseBlock => b.type === "tool_use",
      );

      const toolResults = [];
      for (const block of toolUseBlocks) {
        try {
          const result = await this.toolRegistry.execute(
            block.name,
            block.input,
            this.toolContext,
          );
          toolResults.push({
            type: "tool_result" as const,
            tool_use_id: block.id,
            content: JSON.stringify(result),
          });
        } catch (err) {
          toolResults.push({
            type: "tool_result" as const,
            tool_use_id: block.id,
            content: `Error: ${err instanceof Error ? err.message : String(err)}`,
            is_error: true,
          });
        }
      }

      session.appendToolResults(toolResults);
    }

    throw new Error(`tool loop exceeded ${this.maxToolRounds} rounds`);
  }
}
