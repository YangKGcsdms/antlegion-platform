/**
 * Builtin Plugin: Resilience
 *
 * 提供：
 * - 多 provider fallback
 * - 熔断器（Circuit Breaker）
 * - 指数退避重试
 *
 * 通过 wrapProvider() 包装 LLM Provider，对 AgentRunner 完全透明。
 */

import type { AntPlugin } from "../types.js";
import { ProviderFallback } from "../../resilience/ProviderFallback.js";
import { DEFAULT_CIRCUIT_BREAKER, DEFAULT_RETRY } from "../../resilience/types.js";
import { createSingleProvider } from "../../bootstrap/providers.js";
import type { LlmProvider } from "../../providers/types.js";

export const resiliencePlugin: AntPlugin = {
  name: "builtin:resilience",

  async setup(api) {
    const config = api.getConfig().resilience;
    if (!config?.enabled) return;

    const breakerConfig = { ...DEFAULT_CIRCUIT_BREAKER, ...config.circuitBreaker };
    const retryConfig = { ...DEFAULT_RETRY, ...config.retry };

    api.wrapProvider((primary: LlmProvider): LlmProvider => {
      const providers: LlmProvider[] = [primary];

      if (config.fallbackProviders) {
        for (const cfg of config.fallbackProviders) {
          providers.push(createSingleProvider(cfg));
        }
      }

      return new ProviderFallback(providers, breakerConfig, retryConfig);
    });

    api.log.info("resilience plugin ready", {
      providers: 1 + (config.fallbackProviders?.length ?? 0),
      circuitBreaker: breakerConfig,
      retry: { maxRetries: retryConfig.maxRetries },
    });
  },
};
