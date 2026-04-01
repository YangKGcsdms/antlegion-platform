/**
 * LegionBusChannel — 组合 BusRestClient + BusWebSocket + EventQueue
 * 对外暴露统一的 Channel 接口
 */

import type {
  Fact,
  BusEvent,
  AntResponse,
  ClaimResult,
  ChildFact,
  AcceptanceFilter,
} from "../types/protocol.js";
import type { BusConfig, BusFilterConfig } from "../config/types.js";
import { BusRestClient } from "./BusRestClient.js";
import { BusWebSocket } from "./BusWebSocket.js";
import { EventQueue } from "./EventQueue.js";

export class LegionBusChannel {
  private rest: BusRestClient;
  private ws: BusWebSocket | null = null;
  private queue: EventQueue;
  private config: BusConfig;

  constructor(config: BusConfig, queueCapacity: number) {
    this.config = config;
    this.rest = new BusRestClient(config.url);
    this.queue = new EventQueue(queueCapacity);
  }

  /** 注册节点 + 建立 WebSocket */
  async connect(maxConcurrentClaims?: number): Promise<AntResponse> {
    const filter = this.config.filter;
    const antResponse = await this.rest.connect({
      name: this.config.name,
      description: this.config.description,
      capability_offer: filter.capabilityOffer,
      domain_interests: filter.domainInterests,
      fact_type_patterns: filter.factTypePatterns,
      priority_range: filter.priorityRange,
      modes: filter.modes as Array<"broadcast" | "exclusive"> | undefined,
      subject_key_patterns: filter.subjectKeyPatterns,
      semantic_kinds: filter.semanticKinds as Array<"observation" | "assertion" | "request" | "resolution" | "correction" | "signal"> | undefined,
      min_epistemic_rank: filter.minEpistemicRank,
      min_confidence: filter.minConfidence,
      exclude_superseded: filter.excludeSuperseded,
      max_concurrent_claims: maxConcurrentClaims,
    });

    // 启动 WebSocket
    const acceptanceFilter: AcceptanceFilter = {
      capability_offer: filter.capabilityOffer,
      domain_interests: filter.domainInterests,
      fact_type_patterns: filter.factTypePatterns,
      priority_range: filter.priorityRange,
      modes: filter.modes as Array<"broadcast" | "exclusive"> | undefined,
      subject_key_patterns: filter.subjectKeyPatterns,
    };

    this.ws = new BusWebSocket({
      wsUrl: this.rest.getWebSocketUrl(),
      antId: antResponse.ant_id,
      name: this.config.name,
      filter: acceptanceFilter,
      eventQueue: this.queue,
    });

    await this.ws.start();
    return antResponse;
  }

  /** drain 事件队列 */
  sense(): { events: BusEvent[]; dropped: number } {
    return this.queue.drain();
  }

  /** 发布事实（自动填 ant_id / token / content_hash / created_at） */
  async publish(input: {
    fact_type: string;
    payload: Record<string, unknown>;
    semantic_kind?: string;
    domain_tags?: string[];
    need_capabilities?: string[];
    priority?: number;
    mode?: string;
    ttl_seconds?: number;
    confidence?: number | null;
    parent_fact_id?: string;
    subject_key?: string;
    supersedes?: string;
  }): Promise<Fact> {
    return this.rest.publish(input);
  }

  async claim(factId: string): Promise<ClaimResult> {
    return this.rest.claim(factId);
  }

  async resolve(factId: string, resultFacts?: ChildFact[]): Promise<void> {
    return this.rest.resolve(factId, resultFacts);
  }

  async release(factId: string): Promise<void> {
    return this.rest.release(factId);
  }

  async corroborate(factId: string): Promise<void> {
    return this.rest.corroborate(factId);
  }

  async contradict(factId: string): Promise<void> {
    return this.rest.contradict(factId);
  }

  async query(params?: { fact_type?: string; state?: string; limit?: number }): Promise<Fact[]> {
    return this.rest.query(params);
  }

  async getFact(factId: string): Promise<Fact | null> {
    return this.rest.getFact(factId);
  }

  async heartbeat(): Promise<void> {
    return this.rest.heartbeat();
  }

  disconnect(): void {
    this.ws?.stop();
    this.rest.disconnect();
  }

  get antId(): string | null {
    return this.rest.currentAntId;
  }

  get isConnected(): boolean {
    return this.rest.isConnected;
  }

  /** ant_id 变化时重建 WebSocket（见 DESIGN.md §6.4） */
  async reconnect(): Promise<AntResponse> {
    this.ws?.stop();
    return this.connect();
  }
}
