/**
 * Plugin System — 类型定义
 *
 * PluginApi 是插件与 Runtime 交互的唯一接口。
 * 内置功能（observability/resilience/permissions/knowledge/scheduler）
 * 和外部插件使用完全相同的 API。
 */

import type { ToolDefinition, ToolContext } from "../tools/registry.js";
import type { LegionBusChannel } from "../channel/FactBusChannel.js";
import type { AntLegionConfig } from "../config/types.js";
import type { HookName, HookHandler } from "../hooks/HookRegistry.js";
import type { LlmProvider } from "../providers/types.js";
import type { Session } from "../agent/Session.js";
import type { AgentRunner } from "../agent/AgentRunner.js";
import type { Logger } from "../observability/Logger.js";

// ── Provider Wrapping ──

/** 包装 LLM Provider（用于 resilience、observability 等） */
export type ProviderWrapper = (provider: LlmProvider) => LlmProvider;

// ── Tool Middleware ──

/** 工具执行函数签名 */
export type ToolExecuteFn = (name: string, input: unknown, context: ToolContext) => Promise<unknown>;

/** 工具中间件（用于 permissions、observability 等） */
export type ToolMiddleware = (
  next: ToolExecuteFn,
  name: string,
  input: unknown,
  context: ToolContext,
) => Promise<unknown>;

// ── Prompt Section ──

/** 动态 system prompt 构建上下文 */
export interface PromptBuildContext {
  agentId: string;
  name: string;
  domainInterests: string[];
  factTypePatterns: string[];
}

/** 插件注入的 system prompt 片段 */
export interface PromptSection {
  /** 唯一标识 */
  id: string;
  /** 插入顺序（数字越小越靠前，核心片段占 10-90） */
  order: number;
  /** 构建函数，返回 null 表示不注入 */
  build: (context: PromptBuildContext) => string | null;
}

// ── Tick Handler ──

/** tick 级处理器上下文 */
export interface TickContext {
  tickCount: number;
  session: Session;
  runner: AgentRunner;
  systemPrompt: string;
}

/** tick 级处理器可返回的动作 */
export type TickAction = {
  type: "inject_message";
  message: string;
  /** 可选元数据，会透传到 before_turn/after_turn hook 的 data 中 */
  metadata?: Record<string, unknown>;
};

/** tick 级处理器（用于 scheduler 等） */
export interface TickHandler {
  /** 执行优先级（数字越小越先执行） */
  priority: number;
  /** 处理函数，返回 null 表示无动作 */
  handle: (ctx: TickContext) => Promise<TickAction | null>;
}

// ── Plugin API ──

export interface PluginApi {
  // ── 已有能力 ──
  registerTool(tool: ToolDefinition): void;
  onHook(name: HookName, handler: HookHandler): void;
  getChannel(): LegionBusChannel;
  getConfig(): AntLegionConfig;
  log: Logger;

  // ── 新增：Provider 包装 ──
  /** 包装 LLM Provider（多次调用会链式组合，后注册的包在外层） */
  wrapProvider(wrapper: ProviderWrapper): void;

  // ── 新增：System Prompt 扩展 ──
  /** 注册动态 prompt 片段 */
  addPromptSection(section: PromptSection): void;

  // ── 新增：Tool 中间件 ──
  /** 添加工具执行中间件（经典洋葱模型） */
  addToolMiddleware(middleware: ToolMiddleware): void;

  // ── 新增：Tick 处理器 ──
  /** 注册 tick 级处理器 */
  onTick(handler: TickHandler): void;

  // ── 新增：ToolContext 扩展 ──
  /** 向 ToolContext.extensions 注入数据（用 symbol 避免冲突） */
  extendToolContext<T>(key: symbol, value: T): void;

  // ── 新增：延迟访问（setup() 中调用会抛错） ──
  getSession(): Session;
  getRunner(): AgentRunner;
}

// ── Plugin Interface ──

export interface AntPlugin {
  /** 插件名称（用于日志和调试） */
  name: string;
  /** 初始化（注册工具、中间件、hooks 等） */
  setup(api: PluginApi): Promise<void>;
  /** 可选：优雅关闭时清理资源 */
  teardown?(): Promise<void>;
}
