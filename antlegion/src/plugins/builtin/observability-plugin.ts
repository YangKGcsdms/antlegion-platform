/**
 * Builtin Plugin: Observability
 *
 * 提供：
 * - LLM 调用计量（通过 wrapProvider）
 * - 工具调用计量 + 审计（通过 addToolMiddleware）
 * - tick/error 计数（通过 hooks）
 *
 * 加载顺序：最先加载，middleware 包在最外层。
 */

import path from "node:path";
import type { AntPlugin } from "../types.js";
import { MetricsCollector } from "../../observability/MetricsCollector.js";
import { AuditLog } from "../../observability/AuditLog.js";
import { estimateCost } from "../../observability/CostCalculator.js";
import type { LlmProvider } from "../../providers/types.js";

/** 用于从 ToolContext.extensions 取回 MetricsCollector */
export const METRICS_KEY = Symbol("observability:metrics");
/** 用于从 ToolContext.extensions 取回 AuditLog */
export const AUDIT_KEY = Symbol("observability:audit");

export const observabilityPlugin: AntPlugin = {
  name: "builtin:observability",

  async setup(api) {
    const config = api.getConfig();
    const obs = config.observability;
    const workspaceDir = config.workspace;
    const dataDir = path.join(workspaceDir, ".antlegion");
    const agentName = config.bus.name;

    const metrics = new MetricsCollector();
    let auditLog: AuditLog | null = null;

    if (obs?.auditLog !== false) {
      auditLog = new AuditLog(path.join(dataDir, "audit.jsonl"));
    }

    // 注入到 ToolContext.extensions（供 health server 等访问）
    api.extendToolContext(METRICS_KEY, metrics);
    if (auditLog) {
      api.extendToolContext(AUDIT_KEY, auditLog);
    }

    // ── LLM 调用计量（通过 provider 包装）──
    api.wrapProvider((inner: LlmProvider): LlmProvider => ({
      async createMessage(params) {
        const start = Date.now();
        let success = true;
        let error: string | undefined;

        try {
          const response = await inner.createMessage(params);
          const durationMs = Date.now() - start;
          const inputTokens = response.usage?.inputTokens ?? 0;
          const outputTokens = response.usage?.outputTokens ?? 0;

          metrics.recordLlmCall(params.model, inputTokens, outputTokens, durationMs);
          auditLog?.recordLlmCall({
            agentId: agentName,
            model: params.model,
            durationMs,
            success: true,
            tokens: { input: inputTokens, output: outputTokens },
            costUsd: estimateCost(params.model, inputTokens, outputTokens),
          });

          return response;
        } catch (err) {
          success = false;
          error = err instanceof Error ? err.message : String(err);
          const durationMs = Date.now() - start;

          metrics.recordLlmCall(params.model, 0, 0, durationMs);
          auditLog?.recordLlmCall({
            agentId: "agent",
            model: params.model,
            durationMs,
            success: false,
            error,
          });

          throw err;
        }
      },
    }));

    // ── 工具调用计量 + 审计（通过 tool middleware）──
    api.addToolMiddleware(async (next, name, input, ctx) => {
      const start = Date.now();
      let success = true;
      let error: string | undefined;
      let result: unknown;

      try {
        result = await next(name, input, ctx);
      } catch (err) {
        success = false;
        error = err instanceof Error ? err.message : String(err);
        throw err;
      } finally {
        const durationMs = Date.now() - start;
        metrics.recordToolCall(name, durationMs, success);
        auditLog?.recordToolCall({
          agentId: ctx.agentId,
          tool: name,
          durationMs,
          success,
          inputSummary: summarize(input),
          outputSummary: success ? summarize(result) : undefined,
          error,
        });
      }

      return result;
    });

    // ── tick/error 计数 ──
    api.onHook("before_tick", async () => {
      metrics.recordTick();
    });

    api.onHook("on_error", async (ctx) => {
      metrics.recordError(String(ctx.data.error));
    });

    api.log.info("observability plugin ready", {
      auditLog: !!auditLog,
    });
  },
};

function summarize(value: unknown): string {
  const s = JSON.stringify(value);
  if (!s) return "(undefined)";
  return s.length > 200 ? s.slice(0, 200) + "..." : s;
}
