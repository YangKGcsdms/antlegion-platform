/**
 * ProviderFallback — 实现 LlmProvider 接口
 * 包装多个 provider + 熔断器 + 重试策略
 * 对 AgentRunner 完全透明
 */

import type { LlmProvider } from "../providers/types.js";
import type { LlmResponse } from "../types/messages.js";
import { CircuitBreaker, CircuitBreakerError } from "./CircuitBreaker.js";
import { RetryPolicy } from "./RetryPolicy.js";
import type { CircuitBreakerConfig, RetryConfig } from "./types.js";

export class ProviderFallback implements LlmProvider {
  private providers: Array<{
    provider: LlmProvider;
    breaker: CircuitBreaker;
  }>;
  private retry: RetryPolicy;

  constructor(
    providers: LlmProvider[],
    breakerConfig: CircuitBreakerConfig,
    retryConfig: RetryConfig,
  ) {
    this.providers = providers.map((p, i) => ({
      provider: p,
      breaker: new CircuitBreaker(`provider-${i}`, breakerConfig),
    }));
    this.retry = new RetryPolicy(retryConfig);
  }

  async createMessage(params: Parameters<LlmProvider["createMessage"]>[0]): Promise<LlmResponse> {
    let lastError: Error | undefined;

    for (const { provider, breaker } of this.providers) {
      try {
        return await this.retry.execute(() =>
          breaker.call(() => provider.createMessage(params))
        );
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        // 如果是熔断器打开，直接尝试下一个 provider
        if (err instanceof CircuitBreakerError) continue;
        // 其他错误也尝试下一个
        continue;
      }
    }

    throw lastError ?? new Error("all LLM providers failed");
  }
}
