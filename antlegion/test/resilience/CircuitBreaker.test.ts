import { describe, it, expect } from "vitest";
import { CircuitBreaker, CircuitBreakerError } from "../../src/resilience/CircuitBreaker.js";

describe("CircuitBreaker", () => {
  it("should start in closed state", () => {
    const cb = new CircuitBreaker("test", { failureThreshold: 3, resetTimeoutMs: 1000 });
    expect(cb.currentState).toBe("closed");
  });

  it("should pass through successful calls", async () => {
    const cb = new CircuitBreaker("test", { failureThreshold: 3, resetTimeoutMs: 1000 });
    const result = await cb.call(async () => 42);
    expect(result).toBe(42);
    expect(cb.currentState).toBe("closed");
  });

  it("should stay closed below failure threshold", async () => {
    const cb = new CircuitBreaker("test", { failureThreshold: 3, resetTimeoutMs: 1000 });

    // 2 failures (threshold is 3)
    for (let i = 0; i < 2; i++) {
      await cb.call(async () => { throw new Error("fail"); }).catch(() => {});
    }

    expect(cb.currentState).toBe("closed");
  });

  it("should open after reaching failure threshold", async () => {
    const cb = new CircuitBreaker("test", { failureThreshold: 3, resetTimeoutMs: 60_000 });

    for (let i = 0; i < 3; i++) {
      await cb.call(async () => { throw new Error("fail"); }).catch(() => {});
    }

    expect(cb.currentState).toBe("open");
  });

  it("should reject calls when open", async () => {
    const cb = new CircuitBreaker("test", { failureThreshold: 1, resetTimeoutMs: 60_000 });

    await cb.call(async () => { throw new Error("fail"); }).catch(() => {});
    expect(cb.currentState).toBe("open");

    await expect(cb.call(async () => "nope")).rejects.toThrow(CircuitBreakerError);
  });

  it("should transition to half_open after reset timeout", async () => {
    const cb = new CircuitBreaker("test", { failureThreshold: 1, resetTimeoutMs: 10 });

    await cb.call(async () => { throw new Error("fail"); }).catch(() => {});
    expect(cb.currentState).toBe("open");

    // wait for reset timeout
    await new Promise((r) => setTimeout(r, 15));

    expect(cb.currentState).toBe("half_open");
  });

  it("should close on success in half_open state", async () => {
    const cb = new CircuitBreaker("test", { failureThreshold: 1, resetTimeoutMs: 10 });

    await cb.call(async () => { throw new Error("fail"); }).catch(() => {});
    await new Promise((r) => setTimeout(r, 15));

    expect(cb.currentState).toBe("half_open");

    await cb.call(async () => "recovered");
    expect(cb.currentState).toBe("closed");
  });

  it("should re-open on failure in half_open state", async () => {
    const cb = new CircuitBreaker("test", { failureThreshold: 1, resetTimeoutMs: 10 });

    await cb.call(async () => { throw new Error("fail"); }).catch(() => {});
    await new Promise((r) => setTimeout(r, 15));

    expect(cb.currentState).toBe("half_open");

    await cb.call(async () => { throw new Error("still broken"); }).catch(() => {});
    expect(cb.currentState).toBe("open");
  });

  it("should reset manually", async () => {
    const cb = new CircuitBreaker("test", { failureThreshold: 1, resetTimeoutMs: 60_000 });

    await cb.call(async () => { throw new Error("fail"); }).catch(() => {});
    expect(cb.currentState).toBe("open");

    cb.reset();
    expect(cb.currentState).toBe("closed");

    const result = await cb.call(async () => "ok");
    expect(result).toBe("ok");
  });

  it("should reset failure count on success", async () => {
    const cb = new CircuitBreaker("test", { failureThreshold: 3, resetTimeoutMs: 1000 });

    await cb.call(async () => { throw new Error("fail"); }).catch(() => {});
    await cb.call(async () => { throw new Error("fail"); }).catch(() => {});
    // 2 failures, then success resets
    await cb.call(async () => "ok");
    // 1 more failure should not trip
    await cb.call(async () => { throw new Error("fail"); }).catch(() => {});

    expect(cb.currentState).toBe("closed");
  });
});
