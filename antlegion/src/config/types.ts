/**
 * antlegion 配置类型
 */

export interface BusFilterConfig {
  capabilityOffer?: string[];
  domainInterests?: string[];
  factTypePatterns?: string[];
  priorityRange?: [number, number];
  modes?: string[];
  subjectKeyPatterns?: string[];
  semanticKinds?: string[];
  minEpistemicRank?: number;
  minConfidence?: number;
  excludeSuperseded?: boolean;
}

export interface BusConfig {
  url: string;
  name: string;
  description?: string;
  filter: BusFilterConfig;
}

export interface ProviderConfig {
  type: "anthropic" | "openai-compatible";
  model: string;
  apiKey: string;
  baseUrl?: string;
}

export interface AgentConfig {
  loopInterval: number;
  heartbeatInterval: number;
  eventQueueCapacity: number;
  maxToolRounds: number;
  sessionKeepTurns: number;
}

export interface PluginsConfig {
  roots: string[];
}

export interface ObservabilityConfig {
  enabled: boolean;
  logLevel: "debug" | "info" | "warn" | "error";
  logFile: string | null;
  auditLog: boolean;
  metricsEndpoint: boolean;
}

export const DEFAULT_OBSERVABILITY_CONFIG: ObservabilityConfig = {
  enabled: true,
  logLevel: "info",
  logFile: null,
  auditLog: true,
  metricsEndpoint: true,
};

export interface SchedulerConfig {
  enabled: boolean;
  maxConcurrent: number;
  tasksDir: string;
}

export const DEFAULT_SCHEDULER_CONFIG: SchedulerConfig = {
  enabled: false,
  maxConcurrent: 1,
  tasksDir: ".antlegion/tasks",
};

export interface CircuitBreakerConfig {
  failureThreshold: number;
  resetTimeoutMs: number;
}

export interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
}

export interface ResilienceConfig {
  enabled: boolean;
  circuitBreaker?: Partial<CircuitBreakerConfig>;
  retry?: Partial<RetryConfig>;
  fallbackProviders?: ProviderConfig[];
}

export interface PermissionConfig {
  enabled: boolean;
  policyFile: string;
  defaultLevel: "allow" | "deny";
}

export interface AntLegionConfig {
  bus: BusConfig;
  provider: ProviderConfig;
  workspace: string;
  agent: AgentConfig;
  plugins?: PluginsConfig;
  observability?: ObservabilityConfig;
  scheduler?: SchedulerConfig;
  resilience?: ResilienceConfig;
  permissions?: PermissionConfig;
  knowledge?: KnowledgeConfig;
}

export interface KnowledgeConfig {
  enabled: boolean;
  storageDir: string;
  maxEntries: number;
  maxPromptEntries: number;
}

export const DEFAULT_AGENT_CONFIG: AgentConfig = {
  loopInterval: 1000,
  heartbeatInterval: 30000,
  eventQueueCapacity: 100,
  maxToolRounds: 50,
  sessionKeepTurns: 3,
};
