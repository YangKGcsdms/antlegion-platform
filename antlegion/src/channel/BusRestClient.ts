/**
 * BusRestClient — Legion Bus REST API 封装
 * 参考 ant_legion_bus_plugin/src/api.ts，简化为 antlegion 所需的子集
 */

import type {
  Fact,
  FactCreateRequest,
  AntConnectRequest,
  AntResponse,
  ClaimResult,
  ChildFact,
} from "../types/protocol.js";
import { computeContentHash } from "./ContentHasher.js";

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

export class BusRestClient {
  private baseUrl: string;
  private antId: string | null = null;
  private token: string | null = null;

  constructor(busUrl: string) {
    this.baseUrl = busUrl.replace(/\/$/, "");
  }

  // ──── Connection ────

  async connect(request: AntConnectRequest): Promise<AntResponse> {
    const res = await this.fetchJson<AntResponse>("/ants/connect", {
      method: "POST",
      body: JSON.stringify({
        name: request.name,
        description: request.description ?? "",
        capability_offer: request.capability_offer ?? [],
        domain_interests: request.domain_interests ?? [],
        fact_type_patterns: request.fact_type_patterns ?? [],
        priority_range: request.priority_range ?? [0, 7],
        modes: request.modes ?? ["exclusive", "broadcast"],
        max_concurrent_claims: request.max_concurrent_claims ?? 1,
        subject_key_patterns: request.subject_key_patterns ?? [],
        semantic_kinds: request.semantic_kinds ?? [],
        min_epistemic_rank: request.min_epistemic_rank ?? -3,
        min_confidence: request.min_confidence ?? 0.0,
        exclude_superseded: request.exclude_superseded ?? true,
      }),
    });

    if (!res.success || !res.data) {
      throw new Error(`connect failed: ${res.error ?? "unknown"}`);
    }

    this.antId = res.data.ant_id;
    this.token = res.data.token ?? null;
    return res.data;
  }

  async heartbeat(): Promise<void> {
    if (!this.antId) return;
    await this.fetchJson(`/ants/${this.antId}/heartbeat`, { method: "POST" });
  }

  disconnect(): void {
    const id = this.antId;
    const tok = this.token;
    this.antId = null;
    this.token = null;
    if (id && tok) {
      fetch(`${this.baseUrl}/ants/${encodeURIComponent(id)}/disconnect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: tok }),
      }).catch(() => {});
    }
  }

  // ──── Fact Operations ────

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
    this.ensureConnected();

    const createdAt = Date.now() / 1000;
    const parentFactId = input.parent_fact_id;

    // When parent_fact_id is set, the server corrects causation_depth/chain
    // from the parent's values. The client cannot know the correct depth,
    // so we let the server compute the content_hash instead.
    const contentHash = parentFactId
      ? ""
      : computeContentHash({
          fact_type: input.fact_type,
          payload: input.payload,
          source_ant_id: this.antId!,
          created_at: createdAt,
          mode: input.mode ?? "exclusive",
          priority: input.priority ?? 3,
          ttl_seconds: input.ttl_seconds ?? 300,
          causation_depth: 0,
          confidence: input.confidence,
          domain_tags: input.domain_tags,
          need_capabilities: input.need_capabilities,
        });

    const body: Record<string, unknown> = {
      fact_type: input.fact_type,
      semantic_kind: input.semantic_kind ?? "observation",
      payload: input.payload,
      domain_tags: input.domain_tags ?? [],
      need_capabilities: input.need_capabilities ?? [],
      priority: input.priority ?? 3,
      mode: input.mode ?? "exclusive",
      source_ant_id: this.antId!,
      token: this.token!,
      ttl_seconds: input.ttl_seconds ?? 300,
      schema_version: "1.0.0",
      causation_chain: [],
      causation_depth: 0,
      subject_key: input.subject_key ?? "",
      supersedes: input.supersedes ?? "",
      content_hash: contentHash,
      created_at: createdAt,
    };

    if (parentFactId) body.parent_fact_id = parentFactId;
    if (input.confidence != null) body.confidence = input.confidence;

    const res = await this.fetchJson<Fact>("/facts", {
      method: "POST",
      body: JSON.stringify(body),
    });

    if (!res.success || !res.data) {
      throw new Error(`publish failed: ${res.error ?? "unknown"}`);
    }
    return res.data;
  }

  async claim(factId: string): Promise<ClaimResult> {
    this.ensureConnected();
    const res = await this.fetchJson<{ success: boolean; fact_id: string }>(
      `/facts/${factId}/claim`,
      {
        method: "POST",
        body: JSON.stringify({ ant_id: this.antId, token: this.token }),
      }
    );
    return { success: res.success, error: res.error };
  }

  async resolve(factId: string, resultFacts?: ChildFact[]): Promise<void> {
    this.ensureConnected();
    const res = await this.fetchJson(`/facts/${factId}/resolve`, {
      method: "POST",
      body: JSON.stringify({
        ant_id: this.antId,
        token: this.token,
        result_facts: resultFacts ?? [],
      }),
    });
    if (!res.success) {
      throw new Error(`resolve failed: ${res.error ?? "unknown"}`);
    }
  }

  async release(factId: string): Promise<void> {
    this.ensureConnected();
    const res = await this.fetchJson(`/facts/${factId}/release`, {
      method: "POST",
      body: JSON.stringify({ ant_id: this.antId, token: this.token }),
    });
    if (!res.success) {
      throw new Error(`release failed: ${res.error ?? "unknown"}`);
    }
  }

  async corroborate(factId: string): Promise<void> {
    this.ensureConnected();
    const res = await this.fetchJson(`/facts/${factId}/corroborate`, {
      method: "POST",
      body: JSON.stringify({ ant_id: this.antId, token: this.token }),
    });
    if (!res.success) {
      throw new Error(`corroborate failed: ${res.error ?? "unknown"}`);
    }
  }

  async contradict(factId: string): Promise<void> {
    this.ensureConnected();
    const res = await this.fetchJson(`/facts/${factId}/contradict`, {
      method: "POST",
      body: JSON.stringify({ ant_id: this.antId, token: this.token }),
    });
    if (!res.success) {
      throw new Error(`contradict failed: ${res.error ?? "unknown"}`);
    }
  }

  async query(params?: {
    fact_type?: string;
    state?: string;
    limit?: number;
  }): Promise<Fact[]> {
    const sp = new URLSearchParams();
    if (params?.fact_type) sp.set("fact_type", params.fact_type);
    if (params?.state) sp.set("state", params.state);
    if (params?.limit) sp.set("limit", String(params.limit));
    const qs = sp.toString();
    const path = qs ? `/facts?${qs}` : "/facts";

    const res = await this.fetchJson<Fact[]>(path, { method: "GET" });
    return res.data ?? [];
  }

  async getFact(factId: string): Promise<Fact | null> {
    const res = await this.fetchJson<Fact>(`/facts/${factId}`, { method: "GET" });
    return res.data ?? null;
  }

  // ──── Accessors ────

  get currentAntId(): string | null {
    return this.antId;
  }

  get currentToken(): string | null {
    return this.token;
  }

  get isConnected(): boolean {
    return this.antId !== null;
  }

  getWebSocketUrl(): string {
    const url = new URL(this.baseUrl);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    let s = url.toString();
    if (s.endsWith("/")) s = s.slice(0, -1);
    return s;
  }

  // ──── Private ────

  private ensureConnected(): void {
    if (!this.antId || !this.token) {
      throw new Error("not connected to Legion Bus");
    }
  }

  private async fetchJson<T>(path: string, options: RequestInit = {}): Promise<ApiResponse<T>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        ...options,
        headers: {
          "Content-Type": "application/json",
          ...options.headers,
        },
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (!response.ok) {
        const errData = await response.json().catch(() => ({})) as { error?: string };
        return { success: false, error: errData.error ?? `HTTP ${response.status}` };
      }

      const data = await response.json() as T;
      return { success: true, data };
    } catch (error) {
      clearTimeout(timer);
      const msg = (error as Error).name === "AbortError"
        ? "Bus request timeout (10s)"
        : (error instanceof Error ? error.message : "unknown error");
      return { success: false, error: msg };
    }
  }
}
