import { describe, it, expect } from "vitest";
import { estimateCost } from "../../src/observability/CostCalculator.js";

describe("CostCalculator", () => {
  it("should calculate cost for known Anthropic model", () => {
    // claude-sonnet: $3/1M input, $15/1M output
    const cost = estimateCost("claude-sonnet-4-6-20250514", 1_000_000, 1_000_000);
    expect(cost).toBe(3 + 15);
  });

  it("should calculate cost for GPT-4o", () => {
    // gpt-4o: $2.5/1M input, $10/1M output
    const cost = estimateCost("gpt-4o", 1_000_000, 1_000_000);
    expect(cost).toBe(2.5 + 10);
  });

  it("should return 0 for unknown model", () => {
    const cost = estimateCost("unknown-model-xyz", 1000, 1000);
    expect(cost).toBe(0);
  });

  it("should scale linearly with token count", () => {
    const cost1k = estimateCost("claude-sonnet-4-6-20250514", 1000, 0);
    const cost10k = estimateCost("claude-sonnet-4-6-20250514", 10000, 0);
    expect(cost10k).toBeCloseTo(cost1k * 10, 10);
  });

  it("should handle zero tokens", () => {
    const cost = estimateCost("claude-sonnet-4-6-20250514", 0, 0);
    expect(cost).toBe(0);
  });
});
