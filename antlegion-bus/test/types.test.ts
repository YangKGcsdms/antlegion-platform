import { describe, it, expect } from "vitest";
import {
  createFact,
  createAntIdentity,
  createAcceptanceFilter,
  generateFactId,
  generateAntId,
  getParentFactId,
  isExpired,
  deriveChild,
  isAntHealthy,
  Priority,
} from "../src/types/protocol.js";

describe("Fact", () => {
  it("creates with defaults", () => {
    const fact = createFact();
    expect(fact.fact_id).toHaveLength(16);
    expect(fact.fact_type).toBe("");
    expect(fact.payload).toEqual({});
    expect(fact.priority).toBe(Priority.NORMAL);
    expect(fact.mode).toBe("exclusive");
    expect(fact.state).toBe("created");
    expect(fact.epistemic_state).toBe("asserted");
  });

  it("creates with custom values", () => {
    const fact = createFact({
      fact_type: "code.review.needed",
      payload: { file: "auth.py" },
      domain_tags: ["python", "auth"],
      need_capabilities: ["review"],
      priority: Priority.HIGH,
      mode: "broadcast",
      source_ant_id: "ant-001",
      ttl_seconds: 600,
      confidence: 0.9,
    });
    expect(fact.fact_type).toBe("code.review.needed");
    expect(fact.payload).toEqual({ file: "auth.py" });
    expect(fact.domain_tags).toEqual(["python", "auth"]);
    expect(fact.priority).toBe(Priority.HIGH);
    expect(fact.mode).toBe("broadcast");
    expect(fact.confidence).toBe(0.9);
  });

  it("computes parent_fact_id from causation_chain", () => {
    const root = createFact();
    expect(getParentFactId(root)).toBe("");

    const child = createFact({
      causation_chain: ["grandparent", "parent-001"],
    });
    expect(getParentFactId(child)).toBe("parent-001");
  });

  it("detects expiration", () => {
    const expired = createFact({
      created_at: Date.now() / 1000 - 1000,
      ttl_seconds: 300,
    });
    expect(isExpired(expired)).toBe(true);

    const fresh = createFact({
      created_at: Date.now() / 1000,
      ttl_seconds: 300,
    });
    expect(isExpired(fresh)).toBe(false);
  });

  it("derives child with causation lineage", () => {
    const parent = createFact({
      fact_id: "parent-001",
      fact_type: "parent",
      causation_chain: ["grandparent"],
      causation_depth: 1,
      source_ant_id: "ant-a",
    });

    const child = deriveChild(parent, "child", { data: "child-data" }, "ant-b");
    expect(child.fact_type).toBe("child");
    expect(child.payload).toEqual({ data: "child-data" });
    expect(child.source_ant_id).toBe("ant-b");
    expect(child.causation_chain).toEqual(["grandparent", "parent-001"]);
    expect(child.causation_depth).toBe(2);
  });
});

describe("AntIdentity", () => {
  it("creates with defaults", () => {
    const ant = createAntIdentity();
    expect(ant.ant_id).toHaveLength(12);
    expect(ant.name).toBe("");
    expect(ant.state).toBe("offline");
    expect(ant.reliability_score).toBe(1.0);
  });

  it("checks health", () => {
    expect(isAntHealthy(createAntIdentity({ state: "active" }))).toBe(true);
    expect(isAntHealthy(createAntIdentity({ state: "degraded" }))).toBe(true);
    expect(isAntHealthy(createAntIdentity({ state: "isolated" }))).toBe(false);
    expect(isAntHealthy(createAntIdentity({ state: "offline" }))).toBe(false);
  });
});

describe("AcceptanceFilter", () => {
  it("creates default filter (accepts everything)", () => {
    const af = createAcceptanceFilter();
    expect(af.capability_offer).toEqual([]);
    expect(af.domain_interests).toEqual([]);
    expect(af.priority_range).toEqual([Priority.CRITICAL, Priority.BULK]);
    expect(af.modes).toEqual(["exclusive", "broadcast"]);
  });
});

describe("Priority", () => {
  it("has correct values", () => {
    expect(Priority.CRITICAL).toBe(0);
    expect(Priority.HIGH).toBe(1);
    expect(Priority.NORMAL).toBe(3);
    expect(Priority.BULK).toBe(7);
    expect(Priority.CRITICAL).toBeLessThan(Priority.BULK);
  });
});

describe("ID generators", () => {
  it("generates unique fact IDs", () => {
    const ids = new Set(Array.from({ length: 100 }, generateFactId));
    expect(ids.size).toBe(100);
  });

  it("generates unique ant IDs", () => {
    const ids = new Set(Array.from({ length: 100 }, generateAntId));
    expect(ids.size).toBe(100);
  });
});
