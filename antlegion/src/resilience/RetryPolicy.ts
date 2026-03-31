/**
 * RetryPolicy — 指数退避重试
 * 支持 jitter 避免雷群效应
 */

import type { RetryConfig } from "./types.js";

const RETRYABLE_PATTERNS = [
  "rate limit",
  "timeout",
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "429",
  "500",
  "502",
  "503",
  "529",
  "overloaded",
];

export class RetryPolicy {
  constructor(private config: RetryConfig) {}

  async execute<T>(
    fn: () => Promise<T>,
    isRetryable?: (err: Error) => boolean,
  ): Promise<T> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      try {
        return await fn();
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));

        if (attempt >= this.config.maxRetries) break;

        const retryable = isRetryable
          ? isRetryable(lastError)
          : this.isDefaultRetryable(lastError);

        if (!retryable) break;

        const delay = this.computeDelay(attempt);
        await sleep(delay);
      }
    }

    throw lastError!;
  }

  private isDefaultRetryable(err: Error): boolean {
    const msg = err.message.toLowerCase();
    return RETRYABLE_PATTERNS.some((p) => msg.includes(p.toLowerCase()));
  }

  private computeDelay(attempt: number): number {
    const exponential = this.config.baseDelayMs * Math.pow(this.config.backoffMultiplier, attempt);
    const capped = Math.min(exponential, this.config.maxDelayMs);
    // jitter: 75% - 100% of computed delay
    const jitter = 0.75 + Math.random() * 0.25;
    return Math.floor(capped * jitter);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
