import { describe, it, expect } from "vitest";
import { EventQueue } from "../../src/channel/EventQueue.js";
import type { BusEvent } from "../../src/types/protocol.js";

function makeEvent(id: string): BusEvent {
  return {
    event_type: "fact_available",
    fact: {
      fact_id: id,
      fact_type: "test",
      semantic_kind: "observation",
      payload: {},
      domain_tags: [],
      need_capabilities: [],
      priority: 3,
      mode: "exclusive",
      source_ant_id: "ant1",
      causation_chain: [],
      causation_depth: 0,
      created_at: Date.now() / 1000,
      ttl_seconds: 300,
      schema_version: "1.0.0",
      confidence: null,
      content_hash: "abc",
      state: "published",
      epistemic_state: "asserted",
      claimed_by: null,
      resolved_at: null,
    },
    timestamp: Date.now(),
  };
}

describe("EventQueue", () => {
  it("should push and drain events", () => {
    const q = new EventQueue(10);
    q.push(makeEvent("a"));
    q.push(makeEvent("b"));

    expect(q.size).toBe(2);

    const { events, dropped } = q.drain();
    expect(events).toHaveLength(2);
    expect(events[0].fact!.fact_id).toBe("a");
    expect(events[1].fact!.fact_id).toBe("b");
    expect(dropped).toBe(0);
    expect(q.size).toBe(0);
  });

  it("should drop oldest when capacity exceeded", () => {
    const q = new EventQueue(3);
    q.push(makeEvent("a"));
    q.push(makeEvent("b"));
    q.push(makeEvent("c"));
    q.push(makeEvent("d")); // drops "a"

    expect(q.size).toBe(3);
    const { events, dropped } = q.drain();
    expect(dropped).toBe(1);
    expect(events[0].fact!.fact_id).toBe("b");
    expect(events[2].fact!.fact_id).toBe("d");
  });

  it("should reset dropped count after drain", () => {
    const q = new EventQueue(1);
    q.push(makeEvent("a"));
    q.push(makeEvent("b")); // drops "a"

    q.drain(); // dropped=1, resets

    q.push(makeEvent("c"));
    const { dropped } = q.drain();
    expect(dropped).toBe(0);
  });

  it("should return empty on drain with no events", () => {
    const q = new EventQueue();
    const { events, dropped } = q.drain();
    expect(events).toHaveLength(0);
    expect(dropped).toBe(0);
  });

  it("should use default capacity of 100", () => {
    const q = new EventQueue();
    for (let i = 0; i < 100; i++) {
      q.push(makeEvent(`e${i}`));
    }
    expect(q.size).toBe(100);

    q.push(makeEvent("overflow"));
    expect(q.size).toBe(100);
    const { dropped } = q.drain();
    expect(dropped).toBe(1);
  });
});
