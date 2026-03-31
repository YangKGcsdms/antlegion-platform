/**
 * 可观测性配置类型
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface ObservabilityConfig {
  enabled: boolean;
  logLevel: LogLevel;
  logFile: string | null;
  auditLog: boolean;
  metricsEndpoint: boolean;
}

export const DEFAULT_OBSERVABILITY_CONFIG: ObservabilityConfig = {
  enabled: true,
  logLevel: "info",
  logFile: null,
  auditLog: true,
  metricsEndpoint: true,
};

export interface LogEntry {
  ts: string;
  level: LogLevel;
  component: string;
  msg: string;
  data?: Record<string, unknown>;
}

export interface ToolCallMetric {
  calls: number;
  errors: number;
  totalMs: number;
}

export interface MetricsSnapshot {
  uptime: number;
  ticks: number;
  tasks: { completed: number; failed: number };
  tools: {
    totalCalls: number;
    totalErrors: number;
    byTool: Record<string, ToolCallMetric>;
  };
  llm: {
    calls: number;
    inputTokens: number;
    outputTokens: number;
    estimatedCostUsd: number;
    totalMs: number;
  };
  errors: { total: number; lastError?: string };
}

export interface AuditEntry {
  ts: string;
  type: "tool_call" | "llm_call";
  agentId: string;
  tool?: string;
  model?: string;
  durationMs: number;
  success: boolean;
  inputSummary?: string;
  outputSummary?: string;
  tokens?: { input: number; output: number };
  costUsd?: number;
  error?: string;
}
