import { describe, it, expect } from "vitest";
import {
  computeContentHash,
  verifyContentHash,
  canonicalImmutableRecord,
  stableJsonStringify,
} from "../src/engine/ContentHasher.js";
import { createFact, Priority } from "../src/types/protocol.js";

describe("ContentHasher", () => {
  // Test vectors from Python reference implementation
  const VECTOR_1 = {
    fact: createFact({
      fact_type: "test",
      payload: { key: "value", nested: { a: 1 } },
      source_ant_id: "src",
      created_at: 1000.0,
      ttl_seconds: 300,
      causation_depth: 0,
      mode: "exclusive",
      priority: Priority.NORMAL,
    }),
    expectedHash:
      "fc153af9663c21aa0febc6b3d8e05b95c8f49f2e7fde7cb6956fc1d3ba970d1c",
  };

  const VECTOR_2 = {
    fact: createFact({
      fact_type: "code.review",
      payload: { file: "auth.py" },
      source_ant_id: "ant-001",
      created_at: 2000.0,
      ttl_seconds: 600,
      causation_depth: 0,
      mode: "broadcast",
      priority: Priority.HIGH,
      domain_tags: ["python", "auth"],
      need_capabilities: ["review"],
      confidence: 0.9,
    }),
    expectedHash:
      "82c21858aaf2b9334e6c218727b611a812c362bfbcfc3eda0afcfafc1ad0f882",
  };

  const VECTOR_3 = {
    fact: createFact({
      fact_type: "child",
      payload: { data: 1 },
      source_ant_id: "ant-b",
      created_at: 3000.0,
      ttl_seconds: 300,
      causation_depth: 2,
      causation_chain: ["grandparent", "parent-001"],
      mode: "exclusive",
      priority: Priority.NORMAL,
    }),
    expectedHash:
      "5b395740dce50a9bd7f7c87f5acd46cf546c9f36f02c455a1cee6853f1dbfe59",
  };

  it("matches Python hash (vector 1: simple fact)", () => {
    const hash = computeContentHash(VECTOR_1.fact);
    expect(hash).toBe(VECTOR_1.expectedHash);
  });

  it("matches Python hash (vector 2: with tags, capabilities, confidence)", () => {
    const hash = computeContentHash(VECTOR_2.fact);
    expect(hash).toBe(VECTOR_2.expectedHash);
  });

  it("matches Python hash (vector 3: with causation_chain)", () => {
    const hash = computeContentHash(VECTOR_3.fact);
    expect(hash).toBe(VECTOR_3.expectedHash);
  });

  it("produces 64-char hex digest", () => {
    const hash = computeContentHash(VECTOR_1.fact);
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]+$/);
  });

  it("same content → same hash (deterministic)", () => {
    const h1 = computeContentHash(VECTOR_1.fact);
    const h2 = computeContentHash(VECTOR_1.fact);
    expect(h1).toBe(h2);
  });

  it("different fact_type → different hash", () => {
    const other = createFact({ ...VECTOR_1.fact, fact_type: "other" });
    expect(computeContentHash(other)).not.toBe(VECTOR_1.expectedHash);
  });

  it("verifyContentHash passes for correct hash", () => {
    const fact = { ...VECTOR_1.fact, content_hash: VECTOR_1.expectedHash };
    expect(verifyContentHash(fact)).toBe(true);
  });

  it("verifyContentHash fails for wrong hash", () => {
    const fact = { ...VECTOR_1.fact, content_hash: "0".repeat(64) };
    expect(verifyContentHash(fact)).toBe(false);
  });

  it("verifyContentHash passes for empty hash", () => {
    const fact = { ...VECTOR_1.fact, content_hash: "" };
    expect(verifyContentHash(fact)).toBe(true);
  });
});

describe("stableJsonStringify", () => {
  it("sorts keys at all nesting levels", () => {
    const obj = { z: 1, a: { c: 3, b: 2 } };
    const result = stableJsonStringify(obj);
    // Matches Python json.dumps(sort_keys=True) format: space after colon/comma
    expect(result).toBe('{"a": {"b": 2, "c": 3}, "z": 1}');
  });

  it("handles arrays (preserves order)", () => {
    const obj = { arr: [3, 1, 2] };
    expect(stableJsonStringify(obj)).toBe('{"arr": [3, 1, 2]}');
  });

  it("handles null", () => {
    const obj = { a: null };
    expect(stableJsonStringify(obj)).toBe('{"a": null}');
  });
});
