/**
 * Ant Legion Bus 协议类型定义
 * 对齐参考实现 ant_legion_bus + ant_legion_bus_plugin
 */

// ──── 枚举 ────

export type FactState =
  | "created"
  | "published"
  | "matched"
  | "claimed"
  | "processing"
  | "resolved"
  | "dead";

export type EpistemicState =
  | "asserted"
  | "corroborated"
  | "consensus"
  | "contested"
  | "refuted"
  | "superseded";

export type SemanticKind =
  | "observation"
  | "assertion"
  | "request"
  | "resolution"
  | "correction"
  | "signal";

export type FactMode = "broadcast" | "exclusive";

export type BusEventType =
  | "fact_available"
  | "fact_claimed"
  | "fact_resolved"
  | "fact_expired"
  | "fact_dead"
  | "fact_trust_changed"
  | "fact_superseded"
  | "ant_state_changed";

// ──── 核心实体 ────

export interface Fact {
  fact_id: string;
  fact_type: string;
  semantic_kind: SemanticKind;
  payload: Record<string, unknown>;
  domain_tags: string[];
  need_capabilities: string[];
  priority: number;
  mode: FactMode;
  source_ant_id: string;
  causation_chain: string[];
  causation_depth: number;
  parent_fact_id?: string;
  subject_key: string;
  supersedes: string;
  created_at: number;
  ttl_seconds: number;
  schema_version: string;
  confidence: number | null;
  content_hash: string;
  signature: string;
  protocol_version: string;
  // 可变状态（bus 管理）
  state: FactState;
  epistemic_state: EpistemicState;
  claimed_by: string | null;
  resolved_at: number | null;
  effective_priority: number | null;
  sequence_number: number;
  superseded_by: string;
  corroborations: string[];
  contradictions: string[];
}

export interface BusEvent {
  event_type: BusEventType;
  fact?: Fact;
  ant_id?: string;
  detail?: string;
  timestamp: number;
}

export interface FactCreateRequest {
  fact_type: string;
  payload: Record<string, unknown>;
  source_ant_id: string;
  token: string;
  content_hash: string;
  created_at: number;
  semantic_kind?: string;
  domain_tags?: string[];
  need_capabilities?: string[];
  priority?: number;
  mode?: string;
  ttl_seconds?: number;
  schema_version?: string;
  confidence?: number | null;
  parent_fact_id?: string;
  causation_chain?: string[];
  causation_depth?: number;
  subject_key?: string;
  supersedes?: string;
}

export interface AntConnectRequest {
  name: string;
  description?: string;
  capability_offer?: string[];
  domain_interests?: string[];
  fact_type_patterns?: string[];
  priority_range?: [number, number];
  modes?: FactMode[];
  semantic_kinds?: SemanticKind[];
  max_concurrent_claims?: number;
  min_epistemic_rank?: number;
  min_confidence?: number;
  exclude_superseded?: boolean;
  subject_key_patterns?: string[];
}

export interface AntResponse {
  ant_id: string;
  name: string;
  state: string;
  reliability_score: number;
  token?: string;
}

export interface AcceptanceFilter {
  capability_offer?: string[];
  domain_interests?: string[];
  fact_type_patterns?: string[];
  priority_range?: [number, number];
  modes?: FactMode[];
  semantic_kinds?: SemanticKind[];
  min_epistemic_rank?: number;
  min_confidence?: number;
  exclude_superseded?: boolean;
  subject_key_patterns?: string[];
}

export interface ClaimResult {
  success: boolean;
  error?: string;
}

export interface ChildFact {
  fact_type: string;
  payload: Record<string, unknown>;
  semantic_kind?: string;
  priority?: number;
  mode?: string;
  domain_tags?: string[];
  need_capabilities?: string[];
}
