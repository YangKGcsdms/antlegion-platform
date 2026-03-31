/**
 * 配置加载：文件 + 环境变量覆盖
 */

import fs from "node:fs";
import path from "node:path";
import {
  type AntLegionConfig,
  DEFAULT_AGENT_CONFIG,
  DEFAULT_OBSERVABILITY_CONFIG,
  DEFAULT_SCHEDULER_CONFIG,
} from "./types.js";

function resolveEnvRef(value: string): string {
  if (value.startsWith("env:")) {
    const envName = value.slice(4);
    const envValue = process.env[envName];
    if (!envValue) throw new Error(`env var ${envName} not set (referenced in config)`);
    return envValue;
  }
  return value;
}

export function loadConfig(configPath?: string): AntLegionConfig {
  const filePath = configPath
    ?? process.env.ANTLEGION_CONFIG
    ?? "antlegion.json";

  let fileConfig: Partial<AntLegionConfig> = {};

  if (fs.existsSync(filePath)) {
    const raw = fs.readFileSync(filePath, "utf-8");
    fileConfig = JSON.parse(raw);
  }

  const config: AntLegionConfig = {
    bus: {
      url: process.env.ANT_BUS_URL ?? fileConfig.bus?.url ?? "http://localhost:28080",
      name: process.env.ANT_BUS_NAME ?? fileConfig.bus?.name ?? "antlegion-agent",
      description: process.env.ANT_BUS_DESCRIPTION ?? fileConfig.bus?.description,
      filter: {
        ...fileConfig.bus?.filter,
        capabilityOffer: process.env.ANT_CAPABILITY_OFFER?.split(",") ?? fileConfig.bus?.filter?.capabilityOffer,
        domainInterests: process.env.ANT_DOMAIN_INTERESTS?.split(",") ?? fileConfig.bus?.filter?.domainInterests,
        factTypePatterns: process.env.ANT_FACT_TYPE_PATTERNS?.split(",") ?? fileConfig.bus?.filter?.factTypePatterns ?? ["*"],
      },
    },
    provider: {
      type: (process.env.LLM_PROVIDER_TYPE || fileConfig.provider?.type || "anthropic") as "anthropic" | "openai-compatible",
      model: process.env.LLM_MODEL || fileConfig.provider?.model || "claude-sonnet-4-6-20250514",
      apiKey: resolveEnvRef(
        process.env.ANTHROPIC_API_KEY
          || process.env.LLM_API_KEY
          || fileConfig.provider?.apiKey
          || ""
      ),
      baseUrl: process.env.LLM_BASE_URL || fileConfig.provider?.baseUrl,
    },
    workspace: process.env.ANT_WORKSPACE ?? fileConfig.workspace ?? "./workspace",
    agent: { ...DEFAULT_AGENT_CONFIG, ...fileConfig.agent },
    plugins: fileConfig.plugins,
    observability: { ...DEFAULT_OBSERVABILITY_CONFIG, ...fileConfig.observability },
    scheduler: fileConfig.scheduler
      ? { ...DEFAULT_SCHEDULER_CONFIG, ...fileConfig.scheduler }
      : undefined,
  };

  if (!config.provider.apiKey) {
    throw new Error("No LLM API key configured. Set ANTHROPIC_API_KEY or LLM_API_KEY.");
  }

  config.workspace = path.resolve(config.workspace);

  return config;
}
