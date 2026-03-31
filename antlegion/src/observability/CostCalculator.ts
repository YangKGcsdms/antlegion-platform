/**
 * LLM 调用成本估算器
 * 静态价格表，单位: USD per 1M tokens
 */

interface ModelPricing {
  inputPer1M: number;
  outputPer1M: number;
}

const PRICING: Record<string, ModelPricing> = {
  // Anthropic
  "claude-opus-4-6-20250514":   { inputPer1M: 15, outputPer1M: 75 },
  "claude-sonnet-4-6-20250514": { inputPer1M: 3, outputPer1M: 15 },
  "claude-haiku-4-5-20251001":  { inputPer1M: 0.8, outputPer1M: 4 },
  // OpenAI
  "gpt-4o":                     { inputPer1M: 2.5, outputPer1M: 10 },
  "gpt-4o-mini":                { inputPer1M: 0.15, outputPer1M: 0.6 },
  "gpt-4.1":                    { inputPer1M: 2, outputPer1M: 8 },
  "gpt-4.1-mini":               { inputPer1M: 0.4, outputPer1M: 1.6 },
  "gpt-4.1-nano":               { inputPer1M: 0.1, outputPer1M: 0.4 },
  // DeepSeek
  "deepseek-chat":              { inputPer1M: 0.27, outputPer1M: 1.1 },
  "deepseek-reasoner":          { inputPer1M: 0.55, outputPer1M: 2.19 },
};

export function estimateCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const pricing = PRICING[model];
  if (!pricing) return 0;
  return (
    (inputTokens / 1_000_000) * pricing.inputPer1M +
    (outputTokens / 1_000_000) * pricing.outputPer1M
  );
}
