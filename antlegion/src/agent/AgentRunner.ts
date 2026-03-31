/**
 * AgentRunner — LLM + tool use 循环
 * 见 DESIGN.md §11
 */

import type { LlmProvider } from "../providers/types.js";
import type { ToolRegistry, ToolContext } from "../tools/registry.js";
import type { ContentBlock, ToolUseBlock } from "../types/messages.js";
import type { Session } from "./Session.js";
import type { MetricsCollector } from "../observability/MetricsCollector.js";
import type { AuditLog } from "../observability/AuditLog.js";
import { estimateCost } from "../observability/CostCalculator.js";

export interface RunResult {
  content: ContentBlock[];
  usage?: { inputTokens: number; outputTokens: number };
}

export class AgentRunner {
  private metrics?: MetricsCollector;
  private auditLog?: AuditLog;

  constructor(
    private provider: LlmProvider,
    private toolRegistry: ToolRegistry,
    private toolContext: ToolContext,
    private model: string,
    private maxToolRounds: number,
  ) {
    this.metrics = toolContext.metrics;
    this.auditLog = toolContext.auditLog;
  }

  async run(systemPrompt: string, session: Session): Promise<RunResult> {
    for (let round = 0; round < this.maxToolRounds; round++) {
      const start = Date.now();
      let success = true;
      let error: string | undefined;

      let response;
      try {
        response = await this.provider.createMessage({
          model: this.model,
          system: systemPrompt,
          messages: session.getMessages(),
          tools: this.toolRegistry.schemas(),
          maxTokens: 4096,
        });
      } catch (err) {
        success = false;
        error = err instanceof Error ? err.message : String(err);
        const durationMs = Date.now() - start;
        this.metrics?.recordLlmCall(this.model, 0, 0, durationMs);
        this.auditLog?.recordLlmCall({
          agentId: this.toolContext.agentId,
          model: this.model,
          durationMs,
          success: false,
          error,
        });
        throw err;
      }

      const durationMs = Date.now() - start;
      const inputTokens = response.usage?.inputTokens ?? 0;
      const outputTokens = response.usage?.outputTokens ?? 0;

      this.metrics?.recordLlmCall(this.model, inputTokens, outputTokens, durationMs);
      this.auditLog?.recordLlmCall({
        agentId: this.toolContext.agentId,
        model: this.model,
        durationMs,
        success: true,
        tokens: { input: inputTokens, output: outputTokens },
        costUsd: estimateCost(this.model, inputTokens, outputTokens),
      });

      session.appendAssistant(response.content);

      if (response.stopReason === "end_turn") {
        return { content: response.content, usage: response.usage };
      }

      // stop_reason === "tool_use"
      const toolUseBlocks = response.content.filter(
        (b): b is ToolUseBlock => b.type === "tool_use"
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
