import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { FactMemory } from "../../src/agent/FactMemory.js";
import type { BusEvent, Fact } from "../../src/types/protocol.js";

let tmpDir: string;
let memory: FactMemory;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "factmem-"));
  memory = new FactMemory(tmpDir);
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function makeFact(id: string, chain: string[] = []): Fact {
  return {
    fact_id: id,
    fact_type: "test.fact",
    semantic_kind: "observation",
    payload: {},
    domain_tags: [],
    need_capabilities: [],
    priority: 3,
    mode: "exclusive",
    source_ant_id: "c1",
    causation_chain: chain,
    causation_depth: chain.length,
    created_at: Date.now() / 1000,
    ttl_seconds: 300,
    schema_version: "1.0.0",
    confidence: null,
    content_hash: "x",
    state: "published",
    epistemic_state: "asserted",
    claimed_by: null,
    resolved_at: null,
  };
}

describe("FactMemory", () => {
  it("should persist and load a record", () => {
    memory.persist({
      factId: "f1",
      factType: "code.review",
      summary: "reviewed login module",
      payload: { file: "auth.ts" },
      timestamp: Date.now(),
    });

    const record = memory.load("f1");
    expect(record).not.toBeNull();
    expect(record!.factId).toBe("f1");
    expect(record!.summary).toBe("reviewed login module");
    expect(record!.payload).toEqual({ file: "auth.ts" });
  });

  it("should return null for missing fact", () => {
    expect(memory.load("nonexistent")).toBeNull();
  });

  it("should overwrite existing record", () => {
    memory.persist({ factId: "f1", factType: "t", summary: "v1", payload: {}, timestamp: 1 });
    memory.persist({ factId: "f1", factType: "t", summary: "v2", payload: {}, timestamp: 2 });

    const record = memory.load("f1");
    expect(record!.summary).toBe("v2");
  });

  it("should load causation context for events", () => {
    // persist ancestor
    memory.persist({
      factId: "ancestor-1",
      factType: "requirements.defined",
      summary: "login feature defined",
      payload: {},
      timestamp: Date.now(),
    });

    // event with causation chain pointing to ancestor
    const events: BusEvent[] = [
      {
        event_type: "fact_available",
        fact: makeFact("child-1", ["ancestor-1"]),
        timestamp: Date.now(),
      },
    ];

    const result = memory.loadForEvents(events);
    expect(result).toContain("## Causation Context");
    expect(result).toContain("[Ancestor fact ancestor-1]");
    expect(result).toContain("login feature defined");
  });

  it("should return empty string when no ancestors found", () => {
    const events: BusEvent[] = [
      { event_type: "fact_available", fact: makeFact("f1"), timestamp: Date.now() },
    ];
    expect(memory.loadForEvents(events)).toBe("");
  });

  it("should deduplicate ancestor ids across events", () => {
    memory.persist({
      factId: "shared-ancestor",
      factType: "root",
      summary: "root fact",
      payload: {},
      timestamp: Date.now(),
    });

    const events: BusEvent[] = [
      { event_type: "fact_available", fact: makeFact("c1", ["shared-ancestor"]), timestamp: Date.now() },
      { event_type: "fact_available", fact: makeFact("c2", ["shared-ancestor"]), timestamp: Date.now() },
    ];

    const result = memory.loadForEvents(events);
    // should appear only once
    const matches = result.match(/shared-ancestor/g);
    expect(matches).toHaveLength(1);
  });

  it("should handle events without facts", () => {
    const events: BusEvent[] = [
      { event_type: "ant_state_changed", timestamp: Date.now() },
    ];
    expect(memory.loadForEvents(events)).toBe("");
  });
});
