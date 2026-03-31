import { describe, it, expect } from "vitest";
import {
  checkCausationDepth,
  checkCausationCycle,
  checkBehavioralLoop,
  TokenBucket,
  AntRateLimiter,
  BusLoadBreaker,
  DeduplicationWindow,
  PublishGate,
  applyAging,
} from "../src/engine/FlowControl.js";
import { createFact, Priority } from "../src/types/protocol.js";

describe("checkCausationDepth", () => {
  it("passes within limit", () => {
    const fact = createFact({ causation_depth: 5 });
    expect(checkCausationDepth(fact)[0]).toBe(true);
  });

  it("rejects beyond limit", () => {
    const fact = createFact({ causation_depth: 17 });
    const [ok, reason] = checkCausationDepth(fact);
    expect(ok).toBe(false);
    expect(reason).toContain("exceeds limit");
  });

  it("passes at exact limit", () => {
    const fact = createFact({ causation_depth: 16 });
    expect(checkCausationDepth(fact)[0]).toBe(true);
  });
});

describe("checkCausationCycle", () => {
  it("passes with no cycle", () => {
    const fact = createFact({
      fact_id: "c",
      causation_chain: ["a", "b"],
    });
    expect(checkCausationCycle(fact)[0]).toBe(true);
  });

  it("detects self-reference", () => {
    const fact = createFact({
      fact_id: "a",
      causation_chain: ["x", "a"],
    });
    const [ok] = checkCausationCycle(fact);
    expect(ok).toBe(false);
  });

  it("detects duplicate in chain", () => {
    const fact = createFact({
      fact_id: "c",
      causation_chain: ["a", "b", "a"],
    });
    const [ok] = checkCausationCycle(fact);
    expect(ok).toBe(false);
  });
});

describe("checkBehavioralLoop", () => {
  it("detects livelock pattern", () => {
    const sigs = new Map([["ancestor-1", "ant-a:task.do"]]);
    const fact = createFact({
      source_ant_id: "ant-a",
      fact_type: "task.do",
      causation_chain: ["ancestor-1"],
    });
    const [ok] = checkBehavioralLoop(fact, sigs);
    expect(ok).toBe(false);
  });

  it("passes with different signatures", () => {
    const sigs = new Map([["ancestor-1", "ant-b:task.do"]]);
    const fact = createFact({
      source_ant_id: "ant-a",
      fact_type: "task.do",
      causation_chain: ["ancestor-1"],
    });
    expect(checkBehavioralLoop(fact, sigs)[0]).toBe(true);
  });
});

describe("TokenBucket", () => {
  it("allows burst up to capacity", () => {
    const bucket = new TokenBucket(5, 1);
    for (let i = 0; i < 5; i++) {
      expect(bucket.tryConsume()).toBe(true);
    }
    expect(bucket.tryConsume()).toBe(false);
  });
});

describe("AntRateLimiter", () => {
  it("creates bucket on first check", () => {
    const limiter = new AntRateLimiter(3, 1);
    expect(limiter.check("ant-1")[0]).toBe(true);
    expect(limiter.check("ant-1")[0]).toBe(true);
    expect(limiter.check("ant-1")[0]).toBe(true);
    expect(limiter.check("ant-1")[0]).toBe(false);
  });

  it("isolates per ant", () => {
    const limiter = new AntRateLimiter(1, 0);
    expect(limiter.check("a")[0]).toBe(true);
    expect(limiter.check("a")[0]).toBe(false);
    expect(limiter.check("b")[0]).toBe(true); // different ant
  });
});

describe("BusLoadBreaker", () => {
  it("allows under threshold", () => {
    const breaker = new BusLoadBreaker(5, 3);
    for (let i = 0; i < 3; i++) {
      expect(breaker.recordAndCheck(createFact())[0]).toBe(true);
    }
    expect(breaker.isEmergency).toBe(false);
  });

  it("triggers emergency over threshold", () => {
    const breaker = new BusLoadBreaker(60, 3); // large window
    for (let i = 0; i < 3; i++) {
      breaker.recordAndCheck(createFact());
    }
    // 4th fact (priority NORMAL=3, threshold HIGH=1)
    const fact = createFact({ priority: Priority.NORMAL });
    const [ok] = breaker.recordAndCheck(fact);
    expect(ok).toBe(false);
    expect(breaker.isEmergency).toBe(true);
  });

  it("allows high-priority facts during emergency", () => {
    const breaker = new BusLoadBreaker(60, 3);
    for (let i = 0; i < 4; i++) {
      breaker.recordAndCheck(createFact());
    }
    const critical = createFact({ priority: Priority.CRITICAL });
    expect(breaker.recordAndCheck(critical)[0]).toBe(true);
  });
});

describe("DeduplicationWindow", () => {
  it("detects duplicate within window", () => {
    const dedup = new DeduplicationWindow(10);
    const fact = createFact({
      source_ant_id: "a",
      fact_type: "t",
      content_hash: "h",
    });
    expect(dedup.isDuplicate(fact)).toBe(false);
    expect(dedup.isDuplicate(fact)).toBe(true);
  });

  it("allows same content from different ant", () => {
    const dedup = new DeduplicationWindow(10);
    const f1 = createFact({
      source_ant_id: "a",
      fact_type: "t",
      content_hash: "h",
    });
    const f2 = createFact({
      source_ant_id: "b",
      fact_type: "t",
      content_hash: "h",
    });
    expect(dedup.isDuplicate(f1)).toBe(false);
    expect(dedup.isDuplicate(f2)).toBe(false);
  });
});

describe("PublishGate", () => {
  it("passes a normal fact", () => {
    const gate = new PublishGate();
    const fact = createFact({
      source_ant_id: "ant-1",
      fact_type: "test",
      content_hash: "abc",
    });
    expect(gate.check(fact)[0]).toBe(true);
  });

  it("rejects excessive causation depth", () => {
    const gate = new PublishGate();
    const fact = createFact({ causation_depth: 20 });
    expect(gate.check(fact)[0]).toBe(false);
  });

  it("rejects duplicate", () => {
    const gate = new PublishGate();
    const fact = createFact({
      source_ant_id: "a",
      fact_type: "t",
      content_hash: "h",
    });
    gate.check(fact);
    const dup = createFact({
      source_ant_id: "a",
      fact_type: "t",
      content_hash: "h",
    });
    const [ok, reason] = gate.check(dup);
    expect(ok).toBe(false);
    expect(reason).toContain("duplicate");
  });
});

describe("applyAging", () => {
  it("boosts priority over time", () => {
    const fact = createFact({
      priority: Priority.LOW, // 4
      created_at: Date.now() / 1000 - 90, // 90s ago
    });
    applyAging(fact, 30);
    // 90s / 30s = 3 boosts, 4 - 3 = 1, but floor is HIGH (1)
    expect(fact.effective_priority).toBe(Priority.HIGH);
  });

  it("never promotes to CRITICAL", () => {
    const fact = createFact({
      priority: Priority.BULK, // 7
      created_at: Date.now() / 1000 - 600,
    });
    applyAging(fact, 30);
    expect(fact.effective_priority).toBe(Priority.HIGH); // floor
  });
});
