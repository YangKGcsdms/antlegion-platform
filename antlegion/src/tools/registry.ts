import type { ToolSchema } from "../types/messages.js";
import type { LegionBusChannel } from "../channel/FactBusChannel.js";
import type { MetricsCollector } from "../observability/MetricsCollector.js";
import type { AuditLog } from "../observability/AuditLog.js";
import type { PermissionManager } from "../permissions/PermissionManager.js";

export interface ToolContext {
  channel: LegionBusChannel;
  workspaceDir: string;
  agentId: string;
  activeClaims: Set<string>;
  metrics?: MetricsCollector;
  auditLog?: AuditLog;
  permissionManager?: PermissionManager;
  /** PublishFilter: 允许 LLM 发布的 fact_type patterns（来自 role.yaml） */
  allowedPublishPatterns?: string[];
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute: (input: unknown, context: ToolContext) => Promise<unknown>;
}

export class ToolRegistry {
  private tools = new Map<string, ToolDefinition>();

  register(tool: ToolDefinition): void {
    this.tools.set(tool.name, tool);
  }

  registerAll(tools: ToolDefinition[]): void {
    for (const tool of tools) {
      this.register(tool);
    }
  }

  schemas(): ToolSchema[] {
    return Array.from(this.tools.values()).map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema,
    }));
  }

  async execute(name: string, input: unknown, context: ToolContext): Promise<unknown> {
    const tool = this.tools.get(name);
    if (!tool) throw new Error(`unknown tool: ${name}`);

    // 权限检查
    if (context.permissionManager) {
      const level = context.permissionManager.check(name);
      if (level === "restricted") {
        throw new Error(`tool "${name}" is restricted by permission policy`);
      }
      if (level === "supervised") {
        // v1: supervised 工具记录警告但仍执行
        // 未来: 发布审批请求到 bus 并等待
        context.auditLog?.recordToolCall({
          agentId: context.agentId,
          tool: name,
          durationMs: 0,
          success: true,
          inputSummary: `[supervised] ${summarize(input)}`,
        });
      }
    }

    const start = Date.now();
    let success = true;
    let error: string | undefined;
    let result: unknown;

    try {
      result = await tool.execute(input, context);
    } catch (err) {
      success = false;
      error = err instanceof Error ? err.message : String(err);
      throw err;
    } finally {
      const durationMs = Date.now() - start;
      context.metrics?.recordToolCall(name, durationMs, success);
      context.auditLog?.recordToolCall({
        agentId: context.agentId,
        tool: name,
        durationMs,
        success,
        inputSummary: summarize(input),
        outputSummary: success ? summarize(result) : undefined,
        error,
      });
    }

    return result;
  }

  get size(): number {
    return this.tools.size;
  }
}

function summarize(value: unknown): string {
  const s = JSON.stringify(value);
  if (!s) return "(undefined)";
  return s.length > 200 ? s.slice(0, 200) + "..." : s;
}
