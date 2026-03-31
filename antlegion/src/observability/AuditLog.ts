/**
 * JSONL 审计日志
 * 记录所有工具调用和 LLM 调用，用于合规和调试
 */

import fs from "node:fs";
import path from "node:path";
import type { AuditEntry } from "./types.js";

export class AuditLog {
  private stream: fs.WriteStream;

  constructor(filePath: string) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    this.stream = fs.createWriteStream(filePath, { flags: "a" });
  }

  recordToolCall(entry: {
    agentId: string;
    tool: string;
    durationMs: number;
    success: boolean;
    inputSummary?: string;
    outputSummary?: string;
    error?: string;
  }): void {
    this.write({
      ts: new Date().toISOString(),
      type: "tool_call",
      agentId: entry.agentId,
      tool: entry.tool,
      durationMs: entry.durationMs,
      success: entry.success,
      inputSummary: entry.inputSummary,
      outputSummary: entry.outputSummary,
      error: entry.error,
    });
  }

  recordLlmCall(entry: {
    agentId: string;
    model: string;
    durationMs: number;
    success: boolean;
    tokens?: { input: number; output: number };
    costUsd?: number;
    error?: string;
  }): void {
    this.write({
      ts: new Date().toISOString(),
      type: "llm_call",
      agentId: entry.agentId,
      model: entry.model,
      durationMs: entry.durationMs,
      success: entry.success,
      tokens: entry.tokens,
      costUsd: entry.costUsd,
      error: entry.error,
    });
  }

  flush(): void {
    this.stream.end();
  }

  private write(entry: AuditEntry): void {
    this.stream.write(JSON.stringify(entry) + "\n");
  }
}
