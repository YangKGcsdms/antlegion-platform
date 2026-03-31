import { describe, it, expect } from "vitest";
import {
  canTransition,
  transition,
  InvalidStateTransition,
} from "../src/engine/WorkflowStateMachine.js";
import { recomputeEpistemic } from "../src/engine/EpistemicStateMachine.js";
import { createFact } from "../src/types/protocol.js";
import type { FactState } from "../src/types/protocol.js";

describe("WorkflowStateMachine", () => {
  describe("canTransition", () => {
    const validTransitions: [FactState, FactState][] = [
      ["created", "published"],
      ["created", "dead"],
      ["published", "matched"],
      ["published", "claimed"],
      ["published", "dead"],
      ["matched", "claimed"],
      ["matched", "dead"],
      ["claimed", "processing"],
      ["claimed", "resolved"],
      ["claimed", "published"], // release
      ["claimed", "dead"],
      ["processing", "resolved"],
      ["processing", "dead"],
      ["dead", "published"], // admin redispatch
    ];

    for (const [from, to] of validTransitions) {
      it(`allows ${from} → ${to}`, () => {
        expect(canTransition(from, to)).toBe(true);
      });
    }

    const invalidTransitions: [FactState, FactState][] = [
      ["created", "claimed"],
      ["created", "resolved"],
      ["published", "resolved"],
      ["published", "processing"],
      ["matched", "published"],
      ["matched", "processing"],
      ["resolved", "published"], // terminal
      ["resolved", "dead"], // terminal
      ["dead", "resolved"],
      ["dead", "claimed"],
    ];

    for (const [from, to] of invalidTransitions) {
      it(`rejects ${from} → ${to}`, () => {
        expect(canTransition(from, to)).toBe(false);
      });
    }
  });

  describe("transition", () => {
    it("mutates fact state on valid transition", () => {
      const fact = createFact({ state: "created" });
      transition(fact, "published");
      expect(fact.state).toBe("published");
    });

    it("throws on invalid transition", () => {
      const fact = createFact({ state: "created" });
      expect(() => transition(fact, "resolved")).toThrow(
        InvalidStateTransition,
      );
    });

    it("allows forced invalid transition", () => {
      const fact = createFact({ state: "created" });
      transition(fact, "resolved", true);
      expect(fact.state).toBe("resolved");
    });
  });
});

describe("EpistemicStateMachine", () => {
  it("defaults to asserted", () => {
    const fact = createFact();
    const state = recomputeEpistemic(fact);
    expect(state).toBe("asserted");
    expect(fact.epistemic_state).toBe("asserted");
  });

  it("corroborated with 1 corroboration", () => {
    const fact = createFact({ corroborations: ["ant-a"] });
    expect(recomputeEpistemic(fact)).toBe("corroborated");
  });

  it("consensus with >= quorum corroborations", () => {
    const fact = createFact({ corroborations: ["ant-a", "ant-b"] });
    expect(recomputeEpistemic(fact)).toBe("consensus");
  });

  it("consensus with custom quorum", () => {
    const fact = createFact({
      corroborations: ["a", "b", "c"],
    });
    expect(recomputeEpistemic(fact, 3)).toBe("consensus");

    const fact2 = createFact({ corroborations: ["a", "b"] });
    expect(recomputeEpistemic(fact2, 3)).toBe("corroborated");
  });

  it("contested with 1 contradiction", () => {
    const fact = createFact({ contradictions: ["ant-x"] });
    expect(recomputeEpistemic(fact)).toBe("contested");
  });

  it("refuted with >= quorum contradictions", () => {
    const fact = createFact({ contradictions: ["ant-x", "ant-y"] });
    expect(recomputeEpistemic(fact)).toBe("refuted");
  });

  it("contradictions override corroborations", () => {
    const fact = createFact({
      corroborations: ["a", "b", "c"],
      contradictions: ["x"],
    });
    expect(recomputeEpistemic(fact)).toBe("contested");
  });

  it("superseded overrides everything", () => {
    const fact = createFact({
      corroborations: ["a", "b", "c"],
      superseded_by: "new-fact-id",
    });
    expect(recomputeEpistemic(fact)).toBe("superseded");
  });

  it("mutates fact.epistemic_state in place", () => {
    const fact = createFact({ corroborations: ["a", "b"] });
    expect(fact.epistemic_state).toBe("asserted"); // before
    recomputeEpistemic(fact);
    expect(fact.epistemic_state).toBe("consensus"); // after
  });
});
