import { describe, it, expect } from "vitest";
import { formatEvents } from "../../src/agent/EventFormatter.js";
import type { BusEvent, Fact } from "../../src/types/protocol.js";

function makeFact(overrides: Partial<Fact> = {}): Fact {
  return {
    fact_id: "f1",
    fact_type: "code.review.needed",
    semantic_kind: "request",
    payload: { title: "review login module" },
    domain_tags: ["code"],
    need_capabilities: ["review"],
    priority: 2,
    mode: "exclusive",
    source_ant_id: "ant-pm",
    causation_chain: [],
    causation_depth: 0,
    created_at: 1700000000,
    ttl_seconds: 300,
    schema_version: "1.0.0",
    confidence: null,
    content_hash: "abc",
    state: "published",
    epistemic_state: "asserted",
    claimed_by: null,
    resolved_at: null,
    ...overrides,
  };
}

function makeEvent(overrides: Partial<BusEvent> = {}): BusEvent {
  return {
    event_type: "fact_available",
    fact: makeFact(),
    timestamp: Date.now(),
    ...overrides,
  };
}

describe("EventFormatter", () => {
  it("should format a single event", () => {
    const output = formatEvents([makeEvent()], 0, "");

    expect(output).toContain("## New Events (1)");
    expect(output).toContain("### fact_available");
    expect(output).toContain("- fact_id: f1");
    expect(output).toContain("- fact_type: code.review.needed");
    expect(output).toContain("- mode: exclusive");
    expect(output).toContain("- semantic_kind: request");
    expect(output).toContain("review login module");
    expect(output).toContain("Decide what action");
  });

  it("should include causation memory when provided", () => {
    const memory = "## Causation Context\n\n[Ancestor fact p1] requirements: login module\n";
    const output = formatEvents([makeEvent()], 0, memory);

    expect(output).toContain("## Causation Context");
    expect(output).toContain("[Ancestor fact p1]");
  });

  it("should show dropped warning", () => {
    const output = formatEvents([makeEvent()], 5, "");
    expect(output).toContain("[WARNING] 5 events dropped");
  });

  it("should not show dropped warning when zero", () => {
    const output = formatEvents([makeEvent()], 0, "");
    expect(output).not.toContain("[WARNING]");
  });

  it("should show parent_fact_id when present", () => {
    const event = makeEvent({ fact: makeFact({ parent_fact_id: "parent-1", causation_depth: 1 }) });
    const output = formatEvents([event], 0, "");

    expect(output).toContain("- parent_fact_id: parent-1");
    expect(output).toContain("- causation_depth: 1");
  });

  it("should handle event without fact", () => {
    const event: BusEvent = { event_type: "ant_state_changed", timestamp: Date.now(), detail: "active -> degraded" };
    const output = formatEvents([event], 0, "");

    expect(output).toContain("### ant_state_changed");
    expect(output).toContain("active -> degraded");
  });

  it("should handle multiple events", () => {
    const events = [
      makeEvent({ fact: makeFact({ fact_id: "f1" }) }),
      makeEvent({ fact: makeFact({ fact_id: "f2" }), event_type: "fact_claimed" }),
    ];
    const output = formatEvents(events, 0, "");

    expect(output).toContain("## New Events (2)");
    expect(output).toContain("- fact_id: f1");
    expect(output).toContain("- fact_id: f2");
  });
});
