import { describe, it, expect } from "vitest";
import { computeContentHash } from "../../src/channel/ContentHasher.js";

describe("ContentHasher", () => {
  const baseFields = {
    fact_type: "code.review.needed",
    payload: { title: "test" },
    source_ant_id: "ant-1",
    created_at: 1700000000,
    mode: "exclusive",
    priority: 3,
    ttl_seconds: 300,
    causation_depth: 0,
  };

  it("should produce deterministic hash", () => {
    const h1 = computeContentHash(baseFields);
    const h2 = computeContentHash(baseFields);
    expect(h1).toBe(h2);
    expect(h1).toHaveLength(64); // SHA-256 hex
  });

  it("should change hash when payload changes", () => {
    const h1 = computeContentHash(baseFields);
    const h2 = computeContentHash({ ...baseFields, payload: { title: "different" } });
    expect(h1).not.toBe(h2);
  });

  it("should include optional fields only when present", () => {
    const h1 = computeContentHash(baseFields);
    const h2 = computeContentHash({ ...baseFields, parent_fact_id: "parent-1" });
    expect(h1).not.toBe(h2);
  });

  it("should not include confidence when null", () => {
    const h1 = computeContentHash(baseFields);
    const h2 = computeContentHash({ ...baseFields, confidence: null });
    expect(h1).toBe(h2); // null confidence is excluded
  });

  it("should include confidence when set", () => {
    const h1 = computeContentHash(baseFields);
    const h2 = computeContentHash({ ...baseFields, confidence: 0.8 });
    expect(h1).not.toBe(h2);
  });

  it("should sort domain_tags for order independence", () => {
    const h1 = computeContentHash({ ...baseFields, domain_tags: ["b", "a"] });
    const h2 = computeContentHash({ ...baseFields, domain_tags: ["a", "b"] });
    expect(h1).toBe(h2);
  });

  it("should sort need_capabilities for order independence", () => {
    const h1 = computeContentHash({ ...baseFields, need_capabilities: ["z", "a"] });
    const h2 = computeContentHash({ ...baseFields, need_capabilities: ["a", "z"] });
    expect(h1).toBe(h2);
  });

  it("should exclude empty domain_tags", () => {
    const h1 = computeContentHash(baseFields);
    const h2 = computeContentHash({ ...baseFields, domain_tags: [] });
    expect(h1).toBe(h2);
  });

  // Cross-project alignment with Python reference + antlegion-bus
  it("should match Python reference hash (vector 1)", () => {
    const hash = computeContentHash({
      fact_type: "test",
      payload: { key: "value", nested: { a: 1 } },
      source_ant_id: "src",
      created_at: 1000.0,
      mode: "exclusive",
      priority: 3,
      ttl_seconds: 300,
      causation_depth: 0,
    });
    expect(hash).toBe("33dc6c76a43bdd85073c6591f858f6fa2702474930954845378fc3ec8620ba21");
  });

  it("should match Python reference hash (vector 2: with tags + confidence)", () => {
    const hash = computeContentHash({
      fact_type: "code.review",
      payload: { file: "auth.py" },
      source_ant_id: "ant-001",
      created_at: 2000.0,
      mode: "broadcast",
      priority: 1,
      ttl_seconds: 600,
      causation_depth: 0,
      domain_tags: ["python", "auth"],
      need_capabilities: ["review"],
      confidence: 0.9,
    });
    expect(hash).toBe("c5c909b45716af4f9909bd81e5e4c00101441ea478024a1e66cab45d3c411800");
  });

  it("should match Python reference hash (vector 3: with parent_fact_id)", () => {
    const hash = computeContentHash({
      fact_type: "child",
      payload: { data: 1 },
      source_ant_id: "ant-b",
      created_at: 3000.0,
      mode: "exclusive",
      priority: 3,
      ttl_seconds: 300,
      causation_depth: 2,
      parent_fact_id: "parent-001",
    });
    expect(hash).toBe("8d9682806eb8ec7d6db23914a5bda0275f5018b0d5dd38369033e8fbc27b04e2");
  });
});
