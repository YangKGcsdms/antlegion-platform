/**
 * 内存指标收集器
 * 追踪工具调用、LLM 调用、任务完成、错误
 */

import { estimateCost } from "./CostCalculator.js";
import type { MetricsSnapshot, ToolCallMetric } from "./types.js";

export class MetricsCollector {
  private startedAt = Date.now();
  private ticks = 0;
  private tasksCompleted = 0;
  private tasksFailed = 0;

  private toolCalls: Record<string, ToolCallMetric> = {};
  private totalToolCalls = 0;
  private totalToolErrors = 0;

  private llmCalls = 0;
  private llmInputTokens = 0;
  private llmOutputTokens = 0;
  private llmCostUsd = 0;
  private llmTotalMs = 0;

  private errorCount = 0;
  private lastError?: string;

  recordTick(): void {
    this.ticks++;
  }

  recordToolCall(toolName: string, durationMs: number, success: boolean): void {
    this.totalToolCalls++;
    if (!success) this.totalToolErrors++;

    if (!this.toolCalls[toolName]) {
      this.toolCalls[toolName] = { calls: 0, errors: 0, totalMs: 0 };
    }
    const m = this.toolCalls[toolName];
    m.calls++;
    if (!success) m.errors++;
    m.totalMs += durationMs;
  }

  recordLlmCall(
    model: string,
    inputTokens: number,
    outputTokens: number,
    durationMs: number,
  ): void {
    this.llmCalls++;
    this.llmInputTokens += inputTokens;
    this.llmOutputTokens += outputTokens;
    this.llmTotalMs += durationMs;
    this.llmCostUsd += estimateCost(model, inputTokens, outputTokens);
  }

  recordTaskCompletion(success: boolean): void {
    if (success) this.tasksCompleted++;
    else this.tasksFailed++;
  }

  recordError(error: string): void {
    this.errorCount++;
    this.lastError = error;
  }

  snapshot(): MetricsSnapshot {
    return {
      uptime: Math.floor((Date.now() - this.startedAt) / 1000),
      ticks: this.ticks,
      tasks: {
        completed: this.tasksCompleted,
        failed: this.tasksFailed,
      },
      tools: {
        totalCalls: this.totalToolCalls,
        totalErrors: this.totalToolErrors,
        byTool: { ...this.toolCalls },
      },
      llm: {
        calls: this.llmCalls,
        inputTokens: this.llmInputTokens,
        outputTokens: this.llmOutputTokens,
        estimatedCostUsd: Math.round(this.llmCostUsd * 1_000_000) / 1_000_000,
        totalMs: this.llmTotalMs,
      },
      errors: {
        total: this.errorCount,
        ...(this.lastError && { lastError: this.lastError }),
      },
    };
  }
}
