/**
 * legion_bus_* 工具 — 总线操作
 * 见 DESIGN.md §12.3
 */

import type { ToolDefinition, ToolContext } from "./registry.js";
import { matchPattern } from "../controller/RoleConfig.js";

export function createLegionBusTools(): ToolDefinition[] {
  return [
    {
      name: "legion_bus_publish",
      description: "发布一个事实到 Ant Legion Bus。用于报告观察、发起请求或输出工作结果。source_ant_id / token / content_hash / created_at 由 runtime 自动填入。",
      inputSchema: {
        type: "object",
        properties: {
          fact_type: { type: "string", description: "点号分隔，如 code.review.needed" },
          payload: { type: "object", description: "事实内容" },
          semantic_kind: { type: "string", enum: ["observation", "assertion", "request", "resolution", "correction", "signal"] },
          priority: { type: "number", minimum: 0, maximum: 7 },
          mode: { type: "string", enum: ["exclusive", "broadcast"] },
          need_capabilities: { type: "array", items: { type: "string" } },
          domain_tags: { type: "array", items: { type: "string" } },
          parent_fact_id: { type: "string", description: "父事实 ID，自动构建因果链" },
          ttl_seconds: { type: "number", minimum: 10 },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          subject_key: { type: "string" },
        },
        required: ["fact_type", "payload"],
      },
      execute: async (input: unknown, ctx: ToolContext) => {
        const p = input as Record<string, unknown>;
        // PublishFilter: 校验 fact_type 白名单
        if (ctx.allowedPublishPatterns && ctx.allowedPublishPatterns.length > 0) {
          const factType = p.fact_type as string;
          const allowed = ctx.allowedPublishPatterns.some((pat: string) => matchPattern(pat, factType));
          if (!allowed) {
            return {
              error: `不允许发布 fact_type="${factType}"。允许的类型: ${ctx.allowedPublishPatterns.join(", ")}`,
            };
          }
        }
        const fact = await ctx.channel.publish({
          fact_type: p.fact_type as string,
          payload: (p.payload as Record<string, unknown>) ?? {},
          semantic_kind: p.semantic_kind as string | undefined,
          domain_tags: p.domain_tags as string[] | undefined,
          need_capabilities: p.need_capabilities as string[] | undefined,
          priority: p.priority as number | undefined,
          mode: p.mode as string | undefined,
          ttl_seconds: p.ttl_seconds as number | undefined,
          confidence: p.confidence as number | undefined,
          parent_fact_id: p.parent_fact_id as string | undefined,
          subject_key: p.subject_key as string | undefined,
        });
        return { fact_id: fact.fact_id, state: fact.state };
      },
    },

    {
      name: "legion_bus_claim",
      description: "独占认领一个 exclusive 事实。claim 失败说明其他 agent 已认领，不得重试同一个 fact_id。claim 后必须 resolve 或 release。",
      inputSchema: {
        type: "object",
        properties: { fact_id: { type: "string" } },
        required: ["fact_id"],
      },
      execute: async (input: unknown, ctx: ToolContext) => {
        const { fact_id } = input as { fact_id: string };
        const result = await ctx.channel.claim(fact_id);
        if (result.success) {
          ctx.activeClaims.add(fact_id);
        }
        return result;
      },
    },

    {
      name: "legion_bus_resolve",
      description: "标记已认领的事实为已解决。可附带 result_facts 发布子事实，自动继承因果链。",
      inputSchema: {
        type: "object",
        properties: {
          fact_id: { type: "string" },
          result_facts: {
            type: "array",
            items: {
              type: "object",
              properties: {
                fact_type: { type: "string" },
                payload: { type: "object" },
                semantic_kind: { type: "string" },
                priority: { type: "number" },
                mode: { type: "string" },
                domain_tags: { type: "array", items: { type: "string" } },
                need_capabilities: { type: "array", items: { type: "string" } },
              },
              required: ["fact_type", "payload"],
            },
          },
        },
        required: ["fact_id"],
      },
      execute: async (input: unknown, ctx: ToolContext) => {
        const p = input as { fact_id: string; result_facts?: Array<Record<string, unknown>> };
        await ctx.channel.resolve(p.fact_id, p.result_facts as never);
        ctx.activeClaims.delete(p.fact_id);
        return { resolved: true, fact_id: p.fact_id };
      },
    },

    {
      name: "legion_bus_release",
      description: "释放已认领但无法完成的事实，让其他 agent 处理。",
      inputSchema: {
        type: "object",
        properties: { fact_id: { type: "string" } },
        required: ["fact_id"],
      },
      execute: async (input: unknown, ctx: ToolContext) => {
        const { fact_id } = input as { fact_id: string };
        await ctx.channel.release(fact_id);
        ctx.activeClaims.delete(fact_id);
        return { released: true, fact_id };
      },
    },

    {
      name: "legion_bus_corroborate",
      description: "确认另一个 agent 发布的事实为真。增加该事实的 corroboration 计数，推动其认识论状态从 ASSERTED → CORROBORATED → CONSENSUS。",
      inputSchema: {
        type: "object",
        properties: { fact_id: { type: "string" } },
        required: ["fact_id"],
      },
      execute: async (input: unknown, ctx: ToolContext) => {
        const { fact_id } = input as { fact_id: string };
        await ctx.channel.corroborate(fact_id);
        return { corroborated: true, fact_id };
      },
    },

    {
      name: "legion_bus_contradict",
      description: "质疑另一个 agent 发布的事实。增加该事实的 contradiction 计数，推动其认识论状态从 ASSERTED → CONTESTED → REFUTED。",
      inputSchema: {
        type: "object",
        properties: { fact_id: { type: "string" } },
        required: ["fact_id"],
      },
      execute: async (input: unknown, ctx: ToolContext) => {
        const { fact_id } = input as { fact_id: string };
        await ctx.channel.contradict(fact_id);
        return { contradicted: true, fact_id };
      },
    },

    {
      name: "legion_bus_sense",
      description: "获取当前缓冲的新事件。在 tool loop 中调用可获取处理期间到达的新事件。",
      inputSchema: {
        type: "object",
        properties: { limit: { type: "number" } },
      },
      execute: async (input: unknown, ctx: ToolContext) => {
        const limit = (input as { limit?: number }).limit ?? 10;
        const { events, dropped } = ctx.channel.sense();
        return { events: events.slice(0, limit), dropped };
      },
    },

    {
      name: "legion_bus_query",
      description: "按条件查询总线上的事实。",
      inputSchema: {
        type: "object",
        properties: {
          fact_type: { type: "string" },
          state: { type: "string", enum: ["published", "claimed", "resolved", "dead"] },
          limit: { type: "number" },
        },
      },
      execute: async (input: unknown, ctx: ToolContext) => {
        const p = input as { fact_type?: string; state?: string; limit?: number };
        const facts = await ctx.channel.query(p);
        return { facts, count: facts.length };
      },
    },
  ];
}
