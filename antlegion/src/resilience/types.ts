/**
 * 容错恢复配置类型
 */

import type { ProviderConfig } from "../config/types.js";

export interface CircuitBreakerConfig {
  failureThreshold: number;  // 连续失败次数触发断路, default 5
  resetTimeoutMs: number;    // 断路后多久尝试半开, default 60000
}

export interface RetryConfig {
  maxRetries: number;        // default 3
  baseDelayMs: number;       // default 1000
  maxDelayMs: number;        // default 30000
  backoffMultiplier: number; // default 2
}

export interface ResilienceConfig {
  enabled: boolean;
  circuitBreaker: CircuitBreakerConfig;
  retry: RetryConfig;
  fallbackProviders?: ProviderConfig[];
}

export const DEFAULT_CIRCUIT_BREAKER: CircuitBreakerConfig = {
  failureThreshold: 5,
  resetTimeoutMs: 60_000,
};

export const DEFAULT_RETRY: RetryConfig = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30_000,
  backoffMultiplier: 2,
};
