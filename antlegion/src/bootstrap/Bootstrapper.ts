/**
 * Bootstrapper — 组装 Runtime 所需的全部组件
 *
 * 职责：连接总线 → 创建 provider → 注册工具 → 加载插件 →
 *        应用 provider 包装 → 构建 system prompt → 创建 AgentRunner/Session →
 *        输出 RuntimeContext
 *
 * Runtime 只需拿到 RuntimeContext 就能跑主循环，不再关心组装细节。
 */

import path from "node:path";

import type { AntLegionConfig } from "../config/types.js";
import type { LlmProvider } from "../providers/types.js";
import type {
  PluginApi,
  AntPlugin,
  ProviderWrapper,
  PromptSection,
  ToolMiddleware,
  TickHandler,
} from "../plugins/types.js";
import type { HookContext } from "../hooks/HookRegistry.js";
import type { ToolDefinition, ToolContext } from "../tools/registry.js";

import { LegionBusChannel } from "../channel/FactBusChannel.js";
import { ToolRegistry } from "../tools/registry.js";
import { AgentRunner } from "../agent/AgentRunner.js";
import { Session } from "../agent/Session.js";
import { FactMemory } from "../agent/FactMemory.js";
import { formatEvents } from "../agent/EventFormatter.js";
import { buildSystemPrompt } from "../agent/SystemPromptBuilder.js";
import { loadWorkspace } from "../workspace/loader.js";
import { loadSkills } from "../workspace/skills.js";
import { loadPlugins } from "../plugins/loader.js";
import { createLegionBusTools } from "../tools/factbus.js";
import { createFilesystemTools } from "../tools/filesystem.js";
import { createExecTool } from "../tools/exec.js";
import { Logger } from "../observability/Logger.js";
import { MetricsCollector } from "../observability/MetricsCollector.js";
import { HookRegistry } from "../hooks/HookRegistry.js";
import { ContextBuffer } from "../controller/ContextBuffer.js";
import { ClaimGuard } from "../controller/ClaimGuard.js";
import { loadRoleConfig, type RoleConfig, type RoleConfigData } from "../controller/RoleConfig.js";
import { createSingleProvider } from "./providers.js";

// ── builtin plugins ──
import { resiliencePlugin } from "../plugins/builtin/resilience-plugin.js";
import { knowledgePlugin } from "../plugins/builtin/knowledge-plugin.js";
import { permissionsPlugin } from "../plugins/builtin/permissions-plugin.js";
import { observabilityPlugin } from "../plugins/builtin/observability-plugin.js";
import { schedulerPlugin } from "../plugins/builtin/scheduler-plugin.js";

/** Runtime 主循环所需的全部组件 */
export interface RuntimeContext {
  config: AntLegionConfig;
  channel: LegionBusChannel;
  provider: LlmProvider;
  toolRegistry: ToolRegistry;
  toolContext: ToolContext;
  runner: AgentRunner;
  session: Session;
  factMemory: FactMemory;
  claimGuard: ClaimGuard;
  contextBuffer: ContextBuffer;
  roleConfig: RoleConfig;
  hooks: HookRegistry;
  systemPrompt: string;
  tickHandlers: TickHandler[];
  logger: Logger;
  metrics: MetricsCollector;
  agentId: string;
  plugins: AntPlugin[];
  formatEvents: typeof formatEvents;
}

export class Bootstrapper {
  // ── 插件收集器 ──
  private providerWrappers: ProviderWrapper[] = [];
  private promptSections: PromptSection[] = [];
  private tickHandlers: TickHandler[] = [];
  private contextExtensions = new Map<symbol, unknown>();

  // ── 延迟绑定（setup 阶段不可用，tick 阶段可用）──
  private _session: Session | null = null;
  private _runner: AgentRunner | null = null;

  async bootstrap(config: AntLegionConfig): Promise<RuntimeContext> {
    // ── 1. logger + metrics（基础设施，最先创建）──
    const obs = config.observability;
    const logger = new Logger(
      "runtime",
      obs?.logLevel ?? "info",
      obs?.logFile ?? null,
    );
    const metrics = new MetricsCollector();
    const hooks = new HookRegistry();

    // ── 2. load role config (before connect, need max_concurrent_claims) ──
    const roleConfig = loadRoleConfig(config.workspace);
    const contextBuffer = new ContextBuffer({
      contextInterests: roleConfig.data.context_interests,
    });
    logger.info("role config loaded", {
      role: roleConfig.role,
      claims: roleConfig.data.claims,
      allowedPublish: roleConfig.data.allowed_publish,
      maxConcurrentClaims: roleConfig.maxConcurrentClaims,
    });

    // ── 3. connect to bus ──
    const channel = new LegionBusChannel(config.bus, config.agent.eventQueueCapacity);
    const ant = await channel.connect(roleConfig.maxConcurrentClaims);
    const agentId = ant.ant_id;
    logger.info("connected", { antId: agentId, name: ant.name });

    // ── 4. create base LLM provider ──
    let provider: LlmProvider = createSingleProvider(config.provider);
    logger.info("provider ready", { type: config.provider.type, model: config.provider.model });

    // ── 5. build tool registry with core tools ──
    const activeClaims = new Set<string>();
    const toolRegistry = new ToolRegistry();
    toolRegistry.registerAll(createLegionBusTools());
    toolRegistry.registerAll(createFilesystemTools());
    toolRegistry.register(createExecTool());
    logger.info("core tools registered", { count: toolRegistry.size });

    // ── 6. build PluginApi ──
    const pluginApi = this.buildPluginApi(
      config, channel, toolRegistry, hooks, logger,
    );

    // ── 7. load builtin plugins (config-driven, fixed order) ──
    const builtinPlugins: AntPlugin[] = [
      observabilityPlugin,  // 最先：middleware 包在最外层
      resiliencePlugin,     // 第二：包装 provider
      permissionsPlugin,    // 第三：tool middleware
      knowledgePlugin,      // 第四：tools + prompt
      schedulerPlugin,      // 最后：tick handler
    ];

    const loadedPlugins: AntPlugin[] = [];
    for (const plugin of builtinPlugins) {
      try {
        await plugin.setup(pluginApi);
        loadedPlugins.push(plugin);
        logger.info("builtin plugin loaded", { name: plugin.name });
      } catch (err) {
        // builtin plugin 失败不致命（功能降级）
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn("builtin plugin failed", { name: plugin.name, error: msg });
      }
    }

    // ── 8. load external plugins ──
    await loadPlugins(config, toolRegistry, channel, hooks, logger);
    logger.info("plugins loaded", {
      builtin: loadedPlugins.length,
      totalTools: toolRegistry.size,
      hooks: hooks.totalHandlers(),
    });

    // ── 9. apply provider wrappers ──
    for (const wrapper of this.providerWrappers) {
      provider = wrapper(provider);
    }
    if (this.providerWrappers.length > 0) {
      logger.info("provider wrapped", { layers: this.providerWrappers.length });
    }

    // ── 10. apply tool middlewares ──
    // 中间件按收集顺序注册（observability 先注册 → 包最外层）
    // 无需额外操作，已在 pluginApi.addToolMiddleware() 中直接注册到 toolRegistry

    // ── 11. build tool context ──
    const toolContext: ToolContext = {
      channel,
      workspaceDir: config.workspace,
      agentId,
      activeClaims,
      allowedPublishPatterns: roleConfig.data.allowed_publish,
      publishModeResolver: (ft: string) => roleConfig.getPublishMode(ft),
      extensions: this.contextExtensions,
    };

    // ── 12. create AgentRunner ──
    const maxToolRounds = roleConfig.maxToolRounds || config.agent.maxToolRounds;
    const runner = new AgentRunner(
      provider,
      toolRegistry,
      toolContext,
      config.provider.model,
      maxToolRounds,
    );
    this._runner = runner;

    // ── 13. create Session + FactMemory ──
    const dataDir = path.join(config.workspace, ".antlegion");
    const session = new Session(config.agent.sessionKeepTurns);
    session.initTranscript(path.join(dataDir, "transcripts"), agentId);
    const factMemory = new FactMemory(path.join(dataDir, "facts"));
    this._session = session;
    logger.info("session initialized", { factsDir: path.join(dataDir, "facts") });

    // ── 14. ClaimGuard ──
    const claimGuard = new ClaimGuard(channel, activeClaims, logger);

    // ── 15. build system prompt (with plugin sections) ──
    const workspace = loadWorkspace(config.workspace);
    const skillsPrompt = loadSkills(config.workspace);

    // 注入角色行为指南作为内置 prompt section
    this.promptSections.push({
      id: "role-guidance",
      order: 85, // Protocol Rules 之前
      build: () => buildRoleGuidance(roleConfig),
    });

    const systemPrompt = buildSystemPrompt({
      antId: agentId,
      name: config.bus.name,
      capabilities: config.bus.filter.capabilityOffer ?? [],
      domainInterests: config.bus.filter.domainInterests ?? [],
      factTypePatterns: config.bus.filter.factTypePatterns ?? [],
      workspace,
      skillsPrompt,
      toolSchemas: toolRegistry.schemas(),
      pluginSections: this.promptSections,
    });

    logger.info("system prompt built", {
      chars: systemPrompt.length,
      pluginSections: this.promptSections.length,
    });

    return {
      config,
      channel,
      provider,
      toolRegistry,
      toolContext,
      runner,
      session,
      factMemory,
      claimGuard,
      contextBuffer,
      roleConfig,
      hooks,
      systemPrompt,
      tickHandlers: [...this.tickHandlers].sort((a, b) => a.priority - b.priority),
      logger,
      metrics,
      agentId,
      plugins: loadedPlugins,
      formatEvents,
    };
  }

  private buildPluginApi(
    config: AntLegionConfig,
    channel: LegionBusChannel,
    toolRegistry: ToolRegistry,
    hooks: HookRegistry,
    logger: Logger,
  ): PluginApi {
    return {
      // 已有
      registerTool: (tool: ToolDefinition) => toolRegistry.register(tool),
      onHook: (name, handler) => hooks.register(name, handler),
      getChannel: () => channel,
      getConfig: () => config,
      log: logger,

      // 新增
      wrapProvider: (wrapper) => this.providerWrappers.push(wrapper),
      addPromptSection: (section) => this.promptSections.push(section),
      addToolMiddleware: (mw) => toolRegistry.addMiddleware(mw),
      onTick: (handler) => this.tickHandlers.push(handler),
      extendToolContext: <T>(key: symbol, value: T) => this.contextExtensions.set(key, value),

      // 延迟绑定
      getSession: () => {
        if (!this._session) throw new Error("Session not available during plugin setup()");
        return this._session;
      },
      getRunner: () => {
        if (!this._runner) throw new Error("AgentRunner not available during plugin setup()");
        return this._runner;
      },
    };
  }
}

// ── 角色行为指南（从 Runtime 提取） ──

function buildRoleGuidance(roleConfig: RoleConfig): string {
  const r = roleConfig.data;
  let guidance = `## 角色行为指南（Runtime 自动注入）\n\n`;

  guidance += `你的角色: ${r.role}\n\n`;

  guidance += `### 你应该 claim 的任务类型\n`;
  guidance += r.claims.map((c) => `- \`${c}\``).join("\n") + "\n\n";

  guidance += `### 你可以 publish 的 fact 类型\n`;
  guidance += r.allowed_publish.map((p) => `- \`${p}\``).join("\n") + "\n\n";

  guidance += `### 行为规范\n`;
  guidance += `- 收到 broadcast 事实时：作为参考信息，不需要 claim，不需要立即行动\n`;
  guidance += `- 收到与你无关的 exclusive 事实时：忽略，不要 claim\n`;
  guidance += `- 不要用 legion_bus_query 或 legion_bus_sense 轮询等待——相关上下文会在消息中预注入\n`;
  guidance += `- claim 之后必须 resolve 或 release，不要忘记\n`;
  guidance += `- 专注于你的职责范围内的工作\n`;

  guidance += `\n### 工具使用语法（必须遵守）\n\n`;
  guidance += `**写文件**：必须用 \`write_file\` 工具，不要用 \`exec("cat > file << EOF")\` 或 \`exec("echo ... > file")\`。`;
  guidance += `write_file 支持写入 /shared/ 路径，content 可以是字符串或 JSON 对象。\n\n`;
  guidance += `**读文件**：用 \`read_file\` 读取文件内容，用 \`list_dir\` 列目录。不要用 \`exec("cat file")\` 或 \`exec("ls dir")\`。\n\n`;
  guidance += `**查询总线**：不要用 \`legion_bus_sense\` 或 \`legion_bus_query\` 轮询等待其他 Agent 的产出。`;
  guidance += `相关上下文（PRD、API契约等）已经在你收到的消息中预注入，直接使用即可。\n\n`;
  guidance += `**执行命令**：\`exec\` 仅用于必须在 shell 中运行的操作（npm install、编译、运行测试等），不要用来替代文件操作工具。\n\n`;
  guidance += `**并行调用**：多个 \`read_file\` 或 \`list_dir\` 可以在同一轮 tool call 中并行发出，不要一个一个串行调用。\n\n`;
  guidance += `**工具优先级**：write_file > exec heredoc，read_file > exec cat，list_dir > exec ls，legion_bus_publish > exec curl。\n`;

  return guidance;
}
