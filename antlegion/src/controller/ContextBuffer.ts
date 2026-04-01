/**
 * ContextBuffer — 收集 broadcast facts 作为被动上下文
 *
 * Agent 不需要用 legion_bus_query 去轮询 PRD / API 契约等信息，
 * 而是由 Runtime 在 tick 中自动收集 broadcast 事件，
 * 在 LLM 处理 exclusive task 时预注入相关上下文。
 */

import type { Fact, BusEvent } from "../types/protocol.js";
import { matchPattern } from "./RoleConfig.js";

export interface BufferedFact {
  fact: Fact;
  receivedAt: number;
}

export class ContextBuffer {
  /** fact_type → 按时间排序的 facts */
  private buffer = new Map<string, BufferedFact[]>();
  private maxPerType: number;
  private ttlMs: number;
  /** 角色关注的 broadcast fact type patterns（空数组 = 全部接收） */
  private contextInterests: string[];

  constructor(options?: { maxPerType?: number; ttlMs?: number; contextInterests?: string[] }) {
    this.maxPerType = options?.maxPerType ?? 10;
    this.ttlMs = options?.ttlMs ?? 3600_000; // 1 hour
    this.contextInterests = options?.contextInterests ?? [];
  }

  /** 判断一个 fact_type 是否在角色关注范围内 */
  private isRelevant(factType: string): boolean {
    if (this.contextInterests.length === 0) return true;
    return this.contextInterests.some((p) => matchPattern(p, factType));
  }

  /** 收集一个 broadcast fact（仅收集角色关注的类型） */
  add(fact: Fact): void {
    if (!this.isRelevant(fact.fact_type)) return;

    const list = this.buffer.get(fact.fact_type) ?? [];
    list.push({ fact, receivedAt: Date.now() });

    // 保留最新 N 条
    if (list.length > this.maxPerType) {
      list.splice(0, list.length - this.maxPerType);
    }
    this.buffer.set(fact.fact_type, list);
  }

  /** 从事件列表中提取所有 broadcast facts 并收集（按 context_interests 过滤） */
  collectBroadcasts(events: BusEvent[]): BusEvent[] {
    const exclusive: BusEvent[] = [];
    for (const event of events) {
      if (event.fact?.mode === "broadcast") {
        this.add(event.fact);
      } else {
        exclusive.push(event);
      }
    }
    return exclusive;
  }

  /** 获取某类 fact 的最新一条 */
  latest(factType: string): Fact | null {
    const list = this.buffer.get(factType);
    if (!list || list.length === 0) return null;
    return list[list.length - 1].fact;
  }

  /** 获取某类 fact 的所有条目 */
  all(factType: string): Fact[] {
    return (this.buffer.get(factType) ?? []).map((b) => b.fact);
  }

  /** 获取与当前事件相关的上下文 facts（用于预注入 LLM 消息） */
  getRelevant(): Fact[] {
    this.gc();
    const result: Fact[] = [];
    for (const list of this.buffer.values()) {
      if (list.length > 0) {
        result.push(list[list.length - 1].fact);
      }
    }
    return result;
  }

  /** 格式化为 LLM 可读的上下文文本 */
  formatForPrompt(): string {
    const facts = this.getRelevant();
    if (facts.length === 0) return "";

    let text = "\n\n## 团队上下文（其他 Agent 的产出，供参考）\n\n";
    for (const fact of facts) {
      text += `### ${fact.fact_type} (来自 ${fact.source_ant_id?.slice(0, 8) ?? "unknown"})\n`;
      const payload = JSON.stringify(fact.payload, null, 2);
      // 截断大 payload
      text += payload.length > 3000
        ? payload.slice(0, 3000) + "\n... (截断)\n"
        : payload;
      text += "\n\n";
    }
    return text;
  }

  /** 清理过期条目 */
  private gc(): void {
    const now = Date.now();
    for (const [type, list] of this.buffer) {
      const filtered = list.filter((b) => now - b.receivedAt < this.ttlMs);
      if (filtered.length === 0) {
        this.buffer.delete(type);
      } else {
        this.buffer.set(type, filtered);
      }
    }
  }

  get size(): number {
    let count = 0;
    for (const list of this.buffer.values()) count += list.length;
    return count;
  }
}
