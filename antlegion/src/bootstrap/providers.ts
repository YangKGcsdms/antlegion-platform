/**
 * Provider 工厂 — 根据配置创建 LLM Provider
 */

import { AnthropicProvider } from "../providers/anthropic.js";
import { OpenAICompatibleProvider } from "../providers/openai-compatible.js";
import type { LlmProvider } from "../providers/types.js";
import type { ProviderConfig } from "../config/types.js";

export function createSingleProvider(config: ProviderConfig): LlmProvider {
  switch (config.type) {
    case "anthropic":
      return new AnthropicProvider(config.apiKey);
    case "openai-compatible":
      if (!config.baseUrl) {
        throw new Error("openai-compatible provider requires baseUrl (LLM_BASE_URL)");
      }
      return new OpenAICompatibleProvider(config.apiKey, config.baseUrl);
    default:
      throw new Error(`unknown provider type: ${config.type}`);
  }
}
