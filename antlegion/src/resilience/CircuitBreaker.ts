/**
 * CircuitBreaker — 熔断器
 * closed → open (连续 N 次失败) → half_open (超时后试探) → closed/open
 */

import type { CircuitBreakerConfig } from "./types.js";

export type CircuitState = "closed" | "open" | "half_open";

export class CircuitBreakerError extends Error {
  constructor(name: string) {
    super(`circuit breaker "${name}" is open — request rejected`);
    this.name = "CircuitBreakerError";
  }
}

export class CircuitBreaker {
  private state: CircuitState = "closed";
  private failures = 0;
  private lastFailureAt = 0;

  constructor(
    private name: string,
    private config: CircuitBreakerConfig,
  ) {}

  get currentState(): CircuitState {
    if (this.state === "open") {
      // 检查是否超时可以半开
      if (Date.now() - this.lastFailureAt >= this.config.resetTimeoutMs) {
        this.state = "half_open";
      }
    }
    return this.state;
  }

  async call<T>(fn: () => Promise<T>): Promise<T> {
    const state = this.currentState;

    if (state === "open") {
      throw new CircuitBreakerError(this.name);
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure();
      throw err;
    }
  }

  reset(): void {
    this.state = "closed";
    this.failures = 0;
  }

  private onSuccess(): void {
    this.failures = 0;
    this.state = "closed";
  }

  private onFailure(): void {
    this.failures++;
    this.lastFailureAt = Date.now();

    if (this.state === "half_open" || this.failures >= this.config.failureThreshold) {
      this.state = "open";
    }
  }
}
