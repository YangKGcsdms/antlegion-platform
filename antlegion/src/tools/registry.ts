/**
 * ToolRegistry — 工具注册 + 中间件链执行
 *
 * 核心只负责工具注册和中间件链组装。
 * 权限检查、指标记录、审计日志等横切关注点
 * 全部通过 addMiddleware() 由插件注入。
 */

import type { ToolSchema } from "../types/messages.js";
import type { LegionBusChannel } from "../channel/FactBusChannel.js";
import type { ToolMiddleware, ToolExecuteFn } from "../plugins/types.js";

export interface ToolContext {
  channel: LegionBusChannel;
  workspaceDir: string;
  agentId: string;
  activeClaims: Set<string>;
  /** PublishFilter: 允许 LLM 发布的 fact_type patterns（来自 role.yaml） */
  allowedPublishPatterns?: string[];
  /** 插件扩展数据（用 symbol key 避免冲突） */
  extensions: Map<symbol, unknown>;
}

/** 类型安全的 extension 访问器 */
export function getExtension<T>(ctx: ToolContext, key: symbol): T | undefined {
  return ctx.extensions.get(key) as T | undefined;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute: (input: unknown, context: ToolContext) => Promise<unknown>;
}

export class ToolRegistry {
  private tools = new Map<string, ToolDefinition>();
  private middlewares: ToolMiddleware[] = [];

  register(tool: ToolDefinition): void {
    this.tools.set(tool.name, tool);
  }

  registerAll(tools: ToolDefinition[]): void {
    for (const tool of tools) {
      this.register(tool);
    }
  }

  /** 添加工具执行中间件（先添加的包在最外层） */
  addMiddleware(mw: ToolMiddleware): void {
    this.middlewares.push(mw);
  }

  schemas(): ToolSchema[] {
    return Array.from(this.tools.values()).map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema,
    }));
  }

  /**
   * 执行工具（通过中间件链）
   *
   * 中间件按注册顺序从外到内包装：
   *   middleware[0]( middleware[1]( ... tool.execute ) )
   *
   * 这意味着第一个注册的中间件最先拦截请求、最后处理响应。
   * observability 应最先注册，这样它能捕获所有中间件的耗时。
   */
  async execute(name: string, input: unknown, context: ToolContext): Promise<unknown> {
    const tool = this.tools.get(name);
    if (!tool) throw new Error(`unknown tool: ${name}`);

    // 构建中间件链：最后注册的最靠近 tool.execute
    let chain: ToolExecuteFn = async (_n, inp, ctx) => tool.execute(inp, ctx);
    for (const mw of [...this.middlewares].reverse()) {
      const next = chain;
      chain = (n, inp, ctx) => mw(next, n, inp, ctx);
    }

    return chain(name, input, context);
  }

  get size(): number {
    return this.tools.size;
  }
}
