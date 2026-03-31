import { describe, it, expect, vi } from "vitest";
import { RetryPolicy } from "../../src/resilience/RetryPolicy.js";

describe("RetryPolicy", () => {
  it("should succeed on first try", async () => {
    const policy = new RetryPolicy({ maxRetries: 3, baseDelayMs: 10, maxDelayMs: 100, backoffMultiplier: 2 });
    const fn = vi.fn(async () => "ok");

    const result = await policy.execute(fn);
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledOnce();
  });

  it("should retry on retryable errors", async () => {
    const policy = new RetryPolicy({ maxRetries: 3, baseDelayMs: 10, maxDelayMs: 100, backoffMultiplier: 2 });
    let attempts = 0;

    const result = await policy.execute(async () => {
      attempts++;
      if (attempts < 3) throw new Error("rate limit exceeded");
      return "recovered";
    });

    expect(result).toBe("recovered");
    expect(attempts).toBe(3);
  });

  it("should not retry non-retryable errors", async () => {
    const policy = new RetryPolicy({ maxRetries: 3, baseDelayMs: 10, maxDelayMs: 100, backoffMultiplier: 2 });
    const fn = vi.fn(async () => { throw new Error("invalid input"); });

    await expect(policy.execute(fn)).rejects.toThrow("invalid input");
    expect(fn).toHaveBeenCalledOnce(); // no retries
  });

  it("should exhaust retries and throw last error", async () => {
    const policy = new RetryPolicy({ maxRetries: 2, baseDelayMs: 10, maxDelayMs: 100, backoffMultiplier: 2 });
    let attempts = 0;

    await expect(policy.execute(async () => {
      attempts++;
      throw new Error("503 service unavailable");
    })).rejects.toThrow("503 service unavailable");

    expect(attempts).toBe(3); // 1 initial + 2 retries
  });

  it("should respect custom isRetryable", async () => {
    const policy = new RetryPolicy({ maxRetries: 3, baseDelayMs: 10, maxDelayMs: 100, backoffMultiplier: 2 });
    let attempts = 0;

    await expect(policy.execute(
      async () => {
        attempts++;
        throw new Error("custom error");
      },
      (err) => err.message.includes("custom"),
    )).rejects.toThrow("custom error");

    expect(attempts).toBe(4); // 1 initial + 3 retries (all retryable by custom fn)
  });

  it("should handle timeout errors as retryable", async () => {
    const policy = new RetryPolicy({ maxRetries: 1, baseDelayMs: 10, maxDelayMs: 100, backoffMultiplier: 2 });
    let attempts = 0;

    await policy.execute(async () => {
      attempts++;
      if (attempts === 1) throw new Error("ETIMEDOUT");
      return "ok";
    });

    expect(attempts).toBe(2);
  });
});
