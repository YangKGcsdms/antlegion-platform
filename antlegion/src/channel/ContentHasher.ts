/**
 * content_hash 计算
 * 对齐 Python json.dumps(sort_keys=True, ensure_ascii=False) 输出格式
 * 与 antlegion-bus/src/engine/ContentHasher.ts 完全一致
 */

import { createHash } from "node:crypto";

export interface CanonicalFields {
  fact_type: string;
  payload: Record<string, unknown>;
  source_ant_id: string;
  created_at: number;
  mode: string;
  priority: number;
  ttl_seconds: number;
  causation_depth: number;
  parent_fact_id?: string;
  confidence?: number | null;
  domain_tags?: string[];
  need_capabilities?: string[];
}

/** Fields that are `float` in the Python canonical record. */
const FLOAT_KEYS = new Set(["created_at", "confidence"]);

export function computeContentHash(fields: CanonicalFields): string {
  const record: Record<string, unknown> = {
    fact_type: fields.fact_type,
    payload: fields.payload,
    source_ant_id: fields.source_ant_id,
    created_at: fields.created_at,
    mode: fields.mode,
    priority: fields.priority,
    ttl_seconds: fields.ttl_seconds,
    causation_depth: fields.causation_depth,
  };

  if (fields.parent_fact_id) record.parent_fact_id = fields.parent_fact_id;
  if (fields.confidence != null) record.confidence = fields.confidence;
  if (fields.domain_tags?.length) record.domain_tags = [...fields.domain_tags].sort();
  if (fields.need_capabilities?.length) record.need_capabilities = [...fields.need_capabilities].sort();

  const canonical = stableJsonStringify(sortKeys(record), FLOAT_KEYS);
  return createHash("sha256").update(canonical, "utf-8").digest("hex");
}

// ---------------------------------------------------------------------------
// Python-compatible JSON serialization
// ---------------------------------------------------------------------------

function stableJsonStringify(
  value: unknown,
  floatKeys?: ReadonlySet<string>,
): string {
  return jsonSerialize(value, floatKeys);
}

function jsonSerialize(
  value: unknown,
  floatKeys?: ReadonlySet<string>,
): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    return Object.is(value, -0) ? "0" : String(value);
  }
  if (Array.isArray(value)) {
    const items = value.map((v) => jsonSerialize(v, floatKeys));
    return `[${items.join(", ")}]`;
  }
  if (typeof value === "object") {
    const entries: string[] = [];
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      let serializedValue: string;
      if (
        floatKeys?.has(k) &&
        typeof v === "number" &&
        Number.isFinite(v) &&
        Number.isInteger(v)
      ) {
        serializedValue = v.toFixed(1);
      } else {
        serializedValue = jsonSerialize(v, floatKeys);
      }
      entries.push(`${JSON.stringify(k)}: ${serializedValue}`);
    }
    return `{${entries.join(", ")}}`;
  }
  return String(value);
}

function sortKeys(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(sortKeys);
  if (typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = sortKeys((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}
