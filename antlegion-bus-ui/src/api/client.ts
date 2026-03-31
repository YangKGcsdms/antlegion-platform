const BASE_URL = import.meta.env.VITE_BUS_API_URL ?? "http://localhost:28080";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error((err as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Fact {
  fact_id: string;
  fact_type: string;
  semantic_kind: string;
  payload: Record<string, unknown>;
  domain_tags: string[];
  need_capabilities: string[];
  priority: number;
  mode: string;
  source_ant_id: string;
  state: string;
  epistemic_state: string;
  created_at: number;
  ttl_seconds: number;
  claimed_by: string | null;
  effective_priority: number | null;
  causation_depth: number;
  causation_chain: string[];
  parent_fact_id: string;
  confidence: number | null;
  subject_key: string;
  supersedes: string;
  superseded_by: string;
  content_hash: string;
  schema_version: string;
  signature: string;
  sequence_number: number;
  resolved_at: number | null;
  corroborations: string[];
  contradictions: string[];
  protocol_version: string;
}

export interface Ant {
  ant_id: string;
  name: string;
  description: string;
  state: string;
  reliability_score: number;
  capabilities: string[];
  acceptance_filter: Record<string, unknown>;
  max_concurrent_claims: number;
  transmit_error_counter: number;
  connected_at: number | null;
  last_heartbeat: number | null;
}

export interface Stats {
  facts: {
    total: number;
    by_state: Record<string, number>;
    by_epistemic: Record<string, number>;
  };
  ants: {
    connected: number;
    by_state: Record<string, number>;
  };
  store: {
    totalEntries: number;
    logSizeBytes: number;
  };
  protocol_version: string;
}

export interface Metrics extends Stats {
  computed: {
    resolution_rate: number;
    dead_letter_rate: number;
    active_claims: number;
    pending_facts: number;
  };
}

export interface BusEvent {
  event_type: string;
  fact?: Fact;
  ant_id?: string;
  detail?: string;
  timestamp: number;
}

export interface CleanupResult {
  dry_run: boolean;
  count: number;
  fact_ids?: string[];
  deleted?: string[];
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

export const api = {
  // Health
  getHealth: () => request<{ status: string; timestamp: number }>("/health"),
  getStats: () => request<Stats>("/stats"),

  // Facts
  getFacts: (params?: Record<string, string>) => {
    const qs = params ? "?" + new URLSearchParams(params).toString() : "";
    return request<Fact[]>(`/facts${qs}`);
  },
  getFact: (id: string) => request<Fact>(`/facts/${id}`),
  getCausation: (id: string) => request<Fact[]>(`/facts/${id}/causation`),

  // Ants
  getAnts: () => request<Ant[]>("/ants"),
  getAnt: (id: string) => request<Ant>(`/ants/${id}`),
  getAntActivity: (id: string, limit = 50) =>
    request<{ ant_id: string; activity: Array<Record<string, unknown>> }>(
      `/ants/${id}/activity?limit=${limit}`,
    ),

  // Admin: Storage
  adminGc: () => request<{ removed: number }>("/admin/storage/gc", { method: "POST" }),
  adminCompact: () =>
    request<{ stale_entries_removed: number }>("/admin/storage/compact", { method: "POST" }),
  adminStorageStats: () =>
    request<{ store: { totalEntries: number; logSizeBytes: number }; facts_total: number }>(
      "/admin/storage/stats",
    ),

  // Admin: Facts
  adminDeleteFact: (id: string) =>
    request<{ success: boolean }>(`/admin/facts/${id}`, { method: "DELETE" }),
  adminRedispatch: (id: string) =>
    request<{ success: boolean; new_state: string }>(`/admin/facts/${id}/redispatch`, {
      method: "POST",
    }),
  adminCleanup: (opts: {
    fact_states?: string[];
    older_than_seconds?: number;
    keep_most_recent?: number;
    dry_run?: boolean;
  }) =>
    request<CleanupResult>("/admin/facts/cleanup", {
      method: "POST",
      body: JSON.stringify(opts),
    }),
  adminDeadLetter: (limit = 100) => request<Fact[]>(`/admin/dead-letter?limit=${limit}`),

  // Admin: Ants
  adminIsolateAnt: (id: string) =>
    request<{ success: boolean; state: string }>(`/admin/ants/${id}/isolate`, {
      method: "POST",
    }),
  adminRestoreAnt: (id: string) =>
    request<{ success: boolean; state: string }>(`/admin/ants/${id}/restore`, {
      method: "POST",
    }),

  // Admin: Metrics & Causation
  adminMetrics: () => request<Metrics>("/admin/metrics"),
  adminBrokenChains: () =>
    request<{ broken: Array<Record<string, unknown>> }>("/admin/causation/broken-chains"),
  adminRepairCausation: (factId?: string) =>
    request<{ repaired: string[]; count: number }>("/admin/causation/repair", {
      method: "POST",
      body: JSON.stringify(factId ? { fact_id: factId } : {}),
    }),
};

export function createWsUrl(): string {
  const httpUrl = BASE_URL.replace(/^http/, "ws");
  return `${httpUrl}/ws`;
}
