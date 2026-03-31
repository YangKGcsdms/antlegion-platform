import { describe, it, expect } from "vitest";
import { evaluateFilter, arbitrate } from "../src/engine/FilterEngine.js";
import {
  createFact,
  createAntIdentity,
  createAcceptanceFilter,
  Priority,
} from "../src/types/protocol.js";

function activeAnt(overrides: Parameters<typeof createAntIdentity>[0] = {}) {
  return createAntIdentity({ state: "active", ...overrides });
}

describe("evaluateFilter", () => {
  it("rejects when ant is isolated", () => {
    const fact = createFact({ fact_type: "test", mode: "broadcast" });
    const ant = activeAnt({ state: "isolated" });
    expect(evaluateFilter(fact, ant).matched).toBe(false);
  });

  it("rejects when ant is offline", () => {
    const fact = createFact({ fact_type: "test", mode: "broadcast" });
    const ant = activeAnt({ state: "offline" });
    expect(evaluateFilter(fact, ant).matched).toBe(false);
  });

  it("passes for active ant with no filters (monitor mode)", () => {
    const fact = createFact({ fact_type: "test", mode: "broadcast" });
    const ant = activeAnt();
    expect(evaluateFilter(fact, ant).matched).toBe(true);
  });

  it("passes for degraded ant", () => {
    const fact = createFact({ fact_type: "test", mode: "broadcast" });
    const ant = activeAnt({ state: "degraded" });
    expect(evaluateFilter(fact, ant).matched).toBe(true);
  });

  it("rejects when priority out of range", () => {
    const fact = createFact({ priority: Priority.BULK, mode: "broadcast" });
    const ant = activeAnt({
      acceptance_filter: createAcceptanceFilter({
        priority_range: [Priority.CRITICAL, Priority.NORMAL],
      }),
    });
    expect(evaluateFilter(fact, ant).matched).toBe(false);
  });

  it("rejects when mode not in filter", () => {
    const fact = createFact({ mode: "exclusive" });
    const ant = activeAnt({
      acceptance_filter: createAcceptanceFilter({ modes: ["broadcast"] }),
    });
    expect(evaluateFilter(fact, ant).matched).toBe(false);
  });

  it("rejects when semantic_kind not in filter", () => {
    const fact = createFact({ semantic_kind: "signal", mode: "broadcast" });
    const ant = activeAnt({
      acceptance_filter: createAcceptanceFilter({
        semantic_kinds: ["observation", "request"],
      }),
    });
    expect(evaluateFilter(fact, ant).matched).toBe(false);
  });

  it("rejects superseded facts when exclude_superseded", () => {
    const fact = createFact({
      mode: "broadcast",
      epistemic_state: "superseded",
    });
    const ant = activeAnt({
      acceptance_filter: createAcceptanceFilter({ exclude_superseded: true }),
    });
    expect(evaluateFilter(fact, ant).matched).toBe(false);
  });

  it("rejects below min_epistemic_rank", () => {
    const fact = createFact({
      mode: "broadcast",
      epistemic_state: "refuted", // rank = -2
    });
    const ant = activeAnt({
      acceptance_filter: createAcceptanceFilter({ min_epistemic_rank: 0 }),
    });
    expect(evaluateFilter(fact, ant).matched).toBe(false);
  });

  it("rejects below min_confidence", () => {
    const fact = createFact({ mode: "broadcast", confidence: 0.3 });
    const ant = activeAnt({
      acceptance_filter: createAcceptanceFilter({ min_confidence: 0.5 }),
    });
    expect(evaluateFilter(fact, ant).matched).toBe(false);
  });

  it("matches on capability overlap", () => {
    const fact = createFact({
      mode: "broadcast",
      need_capabilities: ["review", "test"],
    });
    const ant = activeAnt({
      acceptance_filter: createAcceptanceFilter({
        capability_offer: ["review", "deploy"],
      }),
    });
    const result = evaluateFilter(fact, ant);
    expect(result.matched).toBe(true);
    expect(result.capabilityOverlap).toBe(1);
  });

  it("matches on domain overlap", () => {
    const fact = createFact({
      mode: "broadcast",
      domain_tags: ["python", "auth"],
    });
    const ant = activeAnt({
      acceptance_filter: createAcceptanceFilter({
        domain_interests: ["auth", "api"],
      }),
    });
    const result = evaluateFilter(fact, ant);
    expect(result.matched).toBe(true);
    expect(result.domainOverlap).toBe(1);
  });

  it("matches on fact_type pattern (glob)", () => {
    const fact = createFact({ fact_type: "code.review.needed", mode: "broadcast" });
    const ant = activeAnt({
      acceptance_filter: createAcceptanceFilter({
        fact_type_patterns: ["code.*"],
      }),
    });
    const result = evaluateFilter(fact, ant);
    expect(result.matched).toBe(true);
    expect(result.typePatternHit).toBe(true);
  });

  it("rejects when content filters set but no match", () => {
    const fact = createFact({
      mode: "broadcast",
      need_capabilities: ["review"],
      domain_tags: ["python"],
    });
    const ant = activeAnt({
      acceptance_filter: createAcceptanceFilter({
        capability_offer: ["deploy"],
        domain_interests: ["java"],
      }),
    });
    expect(evaluateFilter(fact, ant).matched).toBe(false);
  });

  it("computes correct score", () => {
    const fact = createFact({
      mode: "broadcast",
      need_capabilities: ["review", "test"],
      domain_tags: ["python"],
      fact_type: "code.review",
    });
    const ant = activeAnt({
      acceptance_filter: createAcceptanceFilter({
        capability_offer: ["review", "test"],
        domain_interests: ["python"],
        fact_type_patterns: ["code.*"],
      }),
    });
    const result = evaluateFilter(fact, ant);
    expect(result.matched).toBe(true);
    // 2 caps × 10 + 1 domain × 5 + type hit × 3 = 28, × reliability 1.0 = 28
    expect(result.score).toBe(28);
  });

  it("score scales with reliability_score", () => {
    const fact = createFact({
      mode: "broadcast",
      need_capabilities: ["review"],
    });
    const ant = activeAnt({
      reliability_score: 0.5,
      acceptance_filter: createAcceptanceFilter({
        capability_offer: ["review"],
      }),
    });
    const result = evaluateFilter(fact, ant);
    expect(result.score).toBe(5); // 1 × 10 × 0.5
  });
});

describe("arbitrate", () => {
  /** Helper: evaluate filters and build scored candidate array. */
  function scored(fact: ReturnType<typeof createFact>, ants: ReturnType<typeof activeAnt>[]) {
    return ants
      .map((ant) => ({ ant, match: evaluateFilter(fact, ant) }))
      .filter((c) => c.match.matched)
      .map((c) => ({ ant: c.ant, score: c.match.score }));
  }

  it("returns all candidates for broadcast", () => {
    const fact = createFact({ mode: "broadcast" });
    const ants = [activeAnt(), activeAnt()];
    expect(arbitrate(fact, scored(fact, ants))).toHaveLength(2);
  });

  it("returns single winner for exclusive", () => {
    const fact = createFact({
      mode: "exclusive",
      need_capabilities: ["review"],
    });
    const antA = activeAnt({
      ant_id: "aaa",
      acceptance_filter: createAcceptanceFilter({
        capability_offer: ["review"],
      }),
    });
    const antB = activeAnt({
      ant_id: "bbb",
      acceptance_filter: createAcceptanceFilter({
        capability_offer: ["review"],
        domain_interests: ["python"],
      }),
    });
    // antA score = 10, antB score = 10 (domain doesn't match since fact has no domain_tags)
    // Tie → higher reliability → higher ant_id
    const winners = arbitrate(fact, scored(fact, [antA, antB]));
    expect(winners).toHaveLength(1);
    expect(winners[0].ant_id).toBe("bbb"); // higher lexicographic id wins
  });

  it("returns empty for no matching candidates", () => {
    const fact = createFact({ mode: "exclusive" });
    const ant = activeAnt({ state: "isolated" });
    expect(arbitrate(fact, scored(fact, [ant]))).toHaveLength(0);
  });

  it("higher score wins", () => {
    const fact = createFact({
      mode: "exclusive",
      need_capabilities: ["review", "test"],
    });
    const weak = activeAnt({
      ant_id: "zzz",
      acceptance_filter: createAcceptanceFilter({
        capability_offer: ["review"],
      }),
    });
    const strong = activeAnt({
      ant_id: "aaa",
      acceptance_filter: createAcceptanceFilter({
        capability_offer: ["review", "test"],
      }),
    });
    const winners = arbitrate(fact, scored(fact, [weak, strong]));
    expect(winners).toHaveLength(1);
    expect(winners[0].ant_id).toBe("aaa"); // higher score (20 vs 10)
  });
});
