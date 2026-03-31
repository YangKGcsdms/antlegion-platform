import { describe, it, expect, vi } from "vitest";
import { ProviderFallback } from "../../src/resilience/ProviderFallback.js";
import type { LlmProvider } from "../../src/providers/types.js";
import type { LlmResponse } from "../../src/types/messages.js";

function makeProvider(behavior: "ok" | "fail" | "fail-then-ok"): LlmProvider {
  let callCount = 0;
  return {
    createMessage: vi.fn(async (): Promise<LlmResponse> => {
      callCount++;
      if (behavior === "fail") throw new Error("provider down");
      if (behavior === "fail-then-ok" && callCount <= 1) throw new Error("rate limit");
      return {
        stopReason: "end_turn",
        content: [{ type: "text", text: "response" }],
        usage: { inputTokens: 100, outputTokens: 50 },
      };
    }),
  };
}

const dummyParams = {
  model: "test",
  system: "sys",
  messages: [{ role: "user" as const, content: "hello" }],
  tools: [],
  maxTokens: 100,
};

describe("ProviderFallback", () => {
  it("should use primary provider when it works", async () => {
    const primary = makeProvider("ok");
    const fallback = new ProviderFallback(
      [primary],
      { failureThreshold: 5, resetTimeoutMs: 60_000 },
      { maxRetries: 0, baseDelayMs: 10, maxDelayMs: 100, backoffMultiplier: 2 },
    );

    const result = await fallback.createMessage(dummyParams);
    expect(result.stopReason).toBe("end_turn");
    expect(primary.createMessage).toHaveBeenCalledOnce();
  });

  it("should fall back to secondary when primary fails", async () => {
    const primary = makeProvider("fail");
    const secondary = makeProvider("ok");

    const fallback = new ProviderFallback(
      [primary, secondary],
      { failureThreshold: 1, resetTimeoutMs: 60_000 },
      { maxRetries: 0, baseDelayMs: 10, maxDelayMs: 100, backoffMultiplier: 2 },
    );

    const result = await fallback.createMessage(dummyParams);
    expect(result.stopReason).toBe("end_turn");
    expect(secondary.createMessage).toHaveBeenCalled();
  });

  it("should throw when all providers fail", async () => {
    const p1 = makeProvider("fail");
    const p2 = makeProvider("fail");

    const fallback = new ProviderFallback(
      [p1, p2],
      { failureThreshold: 1, resetTimeoutMs: 60_000 },
      { maxRetries: 0, baseDelayMs: 10, maxDelayMs: 100, backoffMultiplier: 2 },
    );

    await expect(fallback.createMessage(dummyParams)).rejects.toThrow("provider down");
  });

  it("should retry within a single provider before falling back", async () => {
    const primary = makeProvider("fail-then-ok");

    const fallback = new ProviderFallback(
      [primary],
      { failureThreshold: 5, resetTimeoutMs: 60_000 },
      { maxRetries: 2, baseDelayMs: 10, maxDelayMs: 100, backoffMultiplier: 2 },
    );

    const result = await fallback.createMessage(dummyParams);
    expect(result.stopReason).toBe("end_turn");
    // should have retried within primary
    expect(primary.createMessage).toHaveBeenCalledTimes(2);
  });
});
