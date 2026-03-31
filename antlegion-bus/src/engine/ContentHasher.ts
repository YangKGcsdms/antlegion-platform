/**
 * Content integrity: SHA-256 content_hash + HMAC-SHA256 bus signature.
 * Mirrors Python reference: Fact.canonical_immutable_record / expected_content_hash.
 */

import { createHash } from "node:crypto";
import type { Fact } from "../types/protocol.js";
import { Priority } from "../types/protocol.js";
import { getParentFactId } from "../types/protocol.js";

/**
 * Build the canonical immutable record for content_hash computation.
 * Must match Python's Fact.canonical_immutable_record exactly.
 */
export function canonicalImmutableRecord(fact: Fact): Record<string, unknown> {
  const modeVal = fact.mode;
  const priorityVal =
    fact.priority != null ? Number(fact.priority) : Priority.NORMAL;

  const record: Record<string, unknown> = {
    fact_type: fact.fact_type,
    payload: fact.payload,
    source_ant_id: fact.source_ant_id,
    created_at: fact.created_at,
    mode: modeVal,
    priority: priorityVal,
    ttl_seconds: fact.ttl_seconds,
    causation_depth: fact.causation_depth,
  };

  const pid = getParentFactId(fact);
  if (pid) {
    record.parent_fact_id = pid;
  }
  if (fact.confidence != null) {
    record.confidence = fact.confidence;
  }
  if (fact.domain_tags.length > 0) {
    record.domain_tags = [...fact.domain_tags].sort();
  }
  if (fact.need_capabilities.length > 0) {
    record.need_capabilities = [...fact.need_capabilities].sort();
  }

  return record;
}

/**
 * Fields that are `float` in the Python canonical record.
 * These must be serialized with ".0" when whole numbers to match Python output.
 */
const CANONICAL_FLOAT_KEYS = new Set(["created_at", "confidence"]);

/**
 * Compute SHA-256 hex digest of the canonical immutable JSON record.
 * Uses sorted keys + Python-compatible float serialization.
 */
export function computeContentHash(fact: Fact): string {
  const record = canonicalImmutableRecord(fact);
  const canonical = stableJsonStringify(record, CANONICAL_FLOAT_KEYS);
  return createHash("sha256").update(canonical, "utf-8").digest("hex");
}

/** Verify that a fact's content_hash matches the canonical record. */
export function verifyContentHash(fact: Fact): boolean {
  if (!fact.content_hash) return true;
  return fact.content_hash === computeContentHash(fact);
}

// ---------------------------------------------------------------------------
// Stable JSON stringify (matches Python's json.dumps(sort_keys=True))
// ---------------------------------------------------------------------------

/**
 * JSON.stringify with recursively sorted keys.
 * Matches Python's json.dumps(sort_keys=True, ensure_ascii=False).
 *
 * Python's json.dumps preserves the float/int distinction:
 *   - int 3 → "3", float 1000.0 → "1000.0"
 * JS has no such distinction (both are `number`), so we track which
 * top-level keys are "float fields" in the canonical record and render
 * them with a trailing ".0" when they are whole numbers.
 */
export function stableJsonStringify(
  obj: unknown,
  floatKeys?: ReadonlySet<string>,
): string {
  return jsonSerialize(sortKeys(obj), floatKeys);
}

/** Serialize to JSON string, rendering float-flagged fields with ".0". */
function jsonSerialize(
  value: unknown,
  floatKeys?: ReadonlySet<string>,
): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    // Default: use standard JSON serialization (int-style)
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
        // Force float representation: 1000 → "1000.0"
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
