/**
 * Runtime — antlegion 主类
 * 启动序列 + 主循环 + 安全网 + 优雅关闭
 *
 * 架构原则（Agent Runtime，不是 Task Worker）：
 * - LLM 保留全部工具自主权（workspace + bus 读写）
 * - Runtime 不替代 LLM 决策，只在外面包安全网
 * - 安全网：ContextBuffer（预注入上下文）、ClaimGuard（防泄漏）、
 *           PublishFilter（白名单）、续写恢复（tool rounds exceeded）
 */

import path from "node:path";
import fs from "node:fs";
import type { AntLegionConfig } from "./config/types.js";
import type { BusEvent } from "./types/protocol.js";
import { LegionBusChannel } from "./channel/FactBusChannel.js";
import { AnthropicProvider } from "./providers/anthropic.js";
import { OpenAICompatibleProvider } from "./providers/openai-compatible.js";
import type { LlmProvider } from "./providers/types.js";
import { ToolRegistry, type ToolContext } from "./tools/registry.js";
import { createLegionBusTools } from "./tools/factbus.js";
import { createFilesystemTools } from "./tools/filesystem.js";
import { createExecTool } from "./tools/exec.js";
import { AgentRunner } from "./agent/AgentRunner.js";
import { Session } from "./agent/Session.js";
import { FactMemory } from "./agent/FactMemory.js";
import { formatEvents } from "./agent/EventFormatter.js";
import { loadWorkspace } from "./workspace/loader.js";
import { loadSkills } from "./workspace/skills.js";
import { buildSystemPrompt } from "./agent/SystemPromptBuilder.js";
import { loadPlugins } from "./plugins/loader.js";
import { createServer, type Server } from "node:http";
import { Logger } from "./observability/Logger.js";
import { MetricsCollector } from "./observability/MetricsCollector.js";
import { AuditLog } from "./observability/AuditLog.js";
import { HookRegistry, type HookContext } from "./hooks/HookRegistry.js";
import { TaskScheduler } from "./scheduler/TaskScheduler.js";
import { createSchedulerTools } from "./tools/scheduler.js";
import { DEFAULT_SCHEDULER_CONFIG } from "./config/types.js";
import { ProviderFallback } from "./resilience/ProviderFallback.js";
import { DEFAULT_CIRCUIT_BREAKER, DEFAULT_RETRY } from "./resilience/types.js";
import { PermissionManager } from "./permissions/PermissionManager.js";
import { KnowledgeBase } from "./knowledge/KnowledgeBase.js";
import { DEFAULT_KNOWLEDGE_CONFIG } from "./knowledge/types.js";
import { createKnowledgeTools } from "./tools/knowledge.js";

// ── 安全网组件 ──
import { ContextBuffer } from "./controller/ContextBuffer.js";
import { ClaimGuard } from "./controller/ClaimGuard.js";
import { loadRoleConfig, type RoleConfig } from "./controller/RoleConfig.js";

export class Runtime {
  private config: AntLegionConfig;
  private channel: LegionBusChannel;
  private provider!: LlmProvider;
  private toolRegistry!: ToolRegistry;
  private runner!: AgentRunner;
  private session!: Session;
  private factMemory!: FactMemory;
  private activeClaims = new Set<string>();
  private running = false;
  private lastHeartbeat = 0;
  private systemPrompt = "";
  private healthServer: Server | null = null;
  private startedAt = 0;
  private tickCount = 0;

  // observability
  private logger: Logger;
  private metrics: MetricsCollector;
  private auditLog: AuditLog | null = null;

  // hooks
  private hooks: HookRegistry;
  private agentId = "";

  // scheduler
  private scheduler: TaskScheduler | null = null;

  // permissions
  private permissionManager: PermissionManager | null = null;

  // knowledge
  private knowledgeBase: KnowledgeBase | null = null;

  // heartbeat timer (independent of main loop)
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  // ── 安全网 ──
  private contextBuffer!: ContextBuffer;
  private claimGuard!: ClaimGuard;
  private roleConfig!: RoleConfig;

  constructor(config: AntLegionConfig) {
    this.config = config;
    this.channel = new LegionBusChannel(config.bus, config.agent.eventQueueCapacity);

    const obs = config.observability;
    this.logger = new Logger(
      "runtime",
      obs?.logLevel ?? "info",
      obs?.logFile ?? null,
    );
    this.metrics = new MetricsCollector();
    this.hooks = new HookRegistry();
  }

  async start(): Promise<void> {
    // ── 1. connect to bus ──
    const ant = await this.channel.connect();
    this.agentId = ant.ant_id;
    this.logger.info("connected", { antId: ant.ant_id, name: ant.name });

    // ── 2. create LLM provider ──
    this.provider = this.createProvider();
    this.logger.info("provider ready", {
      type: this.config.provider.type,
      model: this.config.provider.model,
    });

    // ── 3. load role config (安全网) ──
    this.roleConfig = loadRoleConfig(this.config.workspace);
    this.contextBuffer = new ContextBuffer();
    this.logger.info("role config loaded", {
      role: this.roleConfig.role,
      claims: this.roleConfig.data.claims,
      allowedPublish: this.roleConfig.data.allowed_publish,
    });

    // ── 4. build tool registry ──
    const dataDir = path.join(this.config.workspace, ".antlegion");

    if (this.config.observability?.auditLog !== false) {
      this.auditLog = new AuditLog(path.join(dataDir, "audit.jsonl"));
    }

    const permConfig = this.config.permissions;
    if (permConfig?.enabled) {
      this.permissionManager = new PermissionManager(
        { enabled: true, policyFile: permConfig.policyFile ?? "PERMISSIONS.md", defaultLevel: permConfig.defaultLevel ?? "unrestricted" },
        this.config.workspace,
      );
      this.logger.info("permissions enabled", { rules: this.permissionManager.ruleCount });
    }

    const toolContext: ToolContext = {
      channel: this.channel,
      workspaceDir: this.config.workspace,
      agentId: ant.ant_id,
      activeClaims: this.activeClaims,
      metrics: this.metrics,
      auditLog: this.auditLog ?? undefined,
      permissionManager: this.permissionManager ?? undefined,
      // PublishFilter 白名单
      allowedPublishPatterns: this.roleConfig.data.allowed_publish,
    };

    this.toolRegistry = new ToolRegistry();
    this.toolRegistry.registerAll(createLegionBusTools());
    this.toolRegistry.registerAll(createFilesystemTools());
    this.toolRegistry.register(createExecTool());
    this.logger.info("tools registered", { count: this.toolRegistry.size });

    // ── 4b. load plugins ──
    await loadPlugins(this.config, this.toolRegistry, this.channel, this.hooks);
    this.logger.info("plugins loaded", {
      totalTools: this.toolRegistry.size,
      hooks: this.hooks.totalHandlers(),
    });

    // ── 4c. task scheduler ──
    const schedConfig = this.config.scheduler;
    if (schedConfig?.enabled) {
      this.scheduler = new TaskScheduler(
        { ...DEFAULT_SCHEDULER_CONFIG, ...schedConfig },
        this.config.workspace,
      );
      await this.scheduler.init();
      this.toolRegistry.registerAll(createSchedulerTools(this.scheduler));
      this.logger.info("scheduler enabled", {
        maxConcurrent: schedConfig.maxConcurrent ?? 1,
        pendingTasks: this.scheduler.listTasks({ state: "pending" }).length,
      });
    }

    // ── 4d. knowledge base ──
    const kbConfig = this.config.knowledge;
    if (kbConfig?.enabled) {
      this.knowledgeBase = new KnowledgeBase(
        { ...DEFAULT_KNOWLEDGE_CONFIG, ...kbConfig },
        this.config.workspace,
      );
      await this.knowledgeBase.init();
      this.toolRegistry.registerAll(createKnowledgeTools(this.knowledgeBase));
      this.logger.info("knowledge base enabled", { entries: this.knowledgeBase.size });
    }

    // ── 5. create agent runner ──
    // 使用 role.yaml 的 maxToolRounds（如有），否则用全局配置
    const maxToolRounds = this.roleConfig.maxToolRounds || this.config.agent.maxToolRounds;
    this.runner = new AgentRunner(
      this.provider,
      this.toolRegistry,
      toolContext,
      this.config.provider.model,
      maxToolRounds,
    );

    // ── 6. session + fact memory ──
    this.session = new Session(this.config.agent.sessionKeepTurns);
    this.session.initTranscript(path.join(dataDir, "transcripts"), ant.ant_id);
    this.factMemory = new FactMemory(path.join(dataDir, "facts"));
    this.logger.info("session initialized", { factsDir: path.join(dataDir, "facts") });

    // ── 7. ClaimGuard ──
    this.claimGuard = new ClaimGuard(this.channel, this.activeClaims, this.logger);

    // ── 8. workspace + system prompt ──
    const workspace = loadWorkspace(this.config.workspace);
    const skillsPrompt = loadSkills(this.config.workspace);

    const knowledgeEntries = this.knowledgeBase?.getRelevantForPrompt(
      this.config.bus.filter.domainInterests ?? [],
    );

    this.systemPrompt = buildSystemPrompt({
      antId: ant.ant_id,
      name: this.config.bus.name,
      capabilities: this.config.bus.filter.capabilityOffer ?? [],
      domainInterests: this.config.bus.filter.domainInterests ?? [],
      factTypePatterns: this.config.bus.filter.factTypePatterns ?? [],
      workspace,
      skillsPrompt,
      toolSchemas: this.toolRegistry.schemas(),
      knowledgeEntries,
    });

    // 注入角色行为指南到系统提示词
    this.systemPrompt += this.buildRoleGuidance();

    this.logger.info("system prompt built", {
      chars: this.systemPrompt.length,
      knowledgeEntries: knowledgeEntries?.length ?? 0,
    });

    // ── 9. health server ──
    this.startHealthServer();

    // ── 10. independent heartbeat ──
    this.lastHeartbeat = Date.now();
    this.heartbeatTimer = setInterval(async () => {
      if (!this.running) return;
      await this.channel.heartbeat().catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn("heartbeat failed", { error: msg });
      });
      this.lastHeartbeat = Date.now();
    }, this.config.agent.heartbeatInterval);

    // ── 11. main loop ──
    this.registerShutdownHandlers();
    this.running = true;
    this.startedAt = Date.now();
    await this.emitHook("on_boot", {});
    this.logger.info("entering main loop");

    while (this.running) {
      try {
        await this.tick();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error("tick error", { error: msg });
        this.metrics.recordError(msg);
      }
      await sleep(this.config.agent.loopInterval);
    }

    await this.cleanup();
  }

  shutdown(): void {
    this.logger.info("shutdown requested");
    this.running = false;
  }

  // ══════════════════════════════════════════════════════════════════
  // tick — 事件分流 + 上下文预注入 + 安全网
  // ══════════════════════════════════════════════════════════════════

  private async tick(): Promise<void> {
    this.tickCount++;
    this.metrics.recordTick();
    await this.emitHook("before_tick", { tick: this.tickCount });

    // ── scheduled task execution ──
    if (this.scheduler) {
      const readyTasks = this.scheduler.getReadyTasks();
      if (readyTasks.length > 0) {
        await this.executeScheduledTask(readyTasks[0]);
      }
    }

    // ── sense events ──
    const { events, dropped } = this.channel.sense();
    if (events.length === 0) {
      await this.emitHook("after_tick", { tick: this.tickCount });
      return;
    }

    this.logger.info("sensed events", { count: events.length, dropped });

    // ── 安全网 1: 事件分流 ──
    // broadcast → 存入 ContextBuffer（不触发 LLM）
    // exclusive → 先 claim，成功才交给 LLM；失败则静默丢弃，不浪费 token
    const actionableEvents: BusEvent[] = [];
    for (const event of events) {
      if (event.fact?.mode === "broadcast") {
        this.contextBuffer.add(event.fact);
        this.logger.info("context buffered", {
          factType: event.fact.fact_type,
          factId: event.fact.fact_id,
        });
      } else if (event.fact?.mode === "exclusive" && event.event_type === "fact_available") {
        // exclusive fact: 先 claim 再干活，claim 失败说明别人抢到了
        const factId = event.fact.fact_id;
        try {
          const result = await this.channel.claim(factId);
          if (result.success) {
            this.activeClaims.add(factId);
            this.logger.info("pre-claimed exclusive fact", {
              factType: event.fact.fact_type,
              factId,
            });
            actionableEvents.push(event);
          } else {
            this.logger.info("exclusive fact lost to another ant, skipping", {
              factType: event.fact.fact_type,
              factId,
              reason: result.error,
            });
          }
        } catch (err) {
          this.logger.warn("pre-claim failed, skipping exclusive fact", {
            factType: event.fact.fact_type,
            factId,
            error: String(err),
          });
        }
      } else {
        actionableEvents.push(event);
      }
    }

    if (actionableEvents.length === 0) {
      await this.emitHook("after_tick", { tick: this.tickCount });
      return;
    }

    // ── 构建 LLM 消息 ──
    const causationMemory = this.factMemory.loadForEvents(actionableEvents);
    let userMessage = formatEvents(actionableEvents, dropped, causationMemory);

    // ── 安全网 2: 上下文预注入 ──
    // 把 ContextBuffer 中已收集的 broadcast 上下文附在消息末尾
    // 这样 LLM 不需要用 legion_bus_query 轮询
    const contextText = this.contextBuffer.formatForPrompt();
    if (contextText) {
      userMessage += contextText;
    }

    this.session.appendUser(userMessage);

    const factIds = actionableEvents
      .map((e: BusEvent) => e.fact?.fact_id)
      .filter((id): id is string => !!id);

    // ── 执行 LLM（带续写恢复）──
    await this.runWithRecovery(actionableEvents, factIds);

    await this.emitHook("after_tick", { tick: this.tickCount });
  }

  /**
   * 带恢复的 LLM 执行（对标 Claude Code 的 recovery state machine）
   *
   * 恢复路径：
   * 1. tool_rounds_exceeded → 注入续写消息，继续执行
   * 2. llm_timeout → 直接重试
   * 3. 其他错误 → ClaimGuard 释放孤儿 claim
   */
  private async runWithRecovery(events: BusEvent[], factIds: string[]): Promise<void> {
    const maxContinuations = this.roleConfig.maxRetries;
    let continuations = 0;

    while (continuations <= maxContinuations) {
      try {
        // ── 预检：上下文接近阈值时先 compact ──
        if (this.session.needsCompaction) {
          this.logger.info("pre-request compact", { estimatedTokens: this.session.estimatedTokens });
          await this.session.autoCompact();
        }

        await this.emitHook("before_turn", { eventCount: events.length, continuation: continuations });
        const result = await this.runner.run(this.systemPrompt, this.session);
        await this.emitHook("after_turn", { eventCount: events.length });

        // 固化已处理的 facts
        for (const factId of factIds) {
          const fact = events.find((e: BusEvent) => e.fact?.fact_id === factId)?.fact;
          if (fact) {
            this.factMemory.persist({
              factId,
              factType: fact.fact_type,
              summary: this.extractSummary(result.content),
              payload: fact.payload,
              timestamp: Date.now(),
            });
          }
        }

        this.session.sealCurrentTurn();

        // ── 安全网 3: ClaimGuard ──
        // LLM 正常完成后，检查是否有忘记 resolve 的 claim
        const orphans = await this.claimGuard.cleanup();
        if (orphans > 0) {
          this.logger.warn("ClaimGuard released orphan claims", { count: orphans });
        }

        return; // 成功，唯一的正常退出路径
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);

        if (msg.includes("prompt") && msg.includes("long") || msg.includes("context_length")) {
          // ── 上下文溢出恢复（对标 Claude Code reactive compact）──
          this.logger.info("context overflow detected, triggering auto-compact");
          const compacted = await this.session.autoCompact();
          if (compacted) {
            continuations++;
            this.logger.info("auto-compact succeeded, retrying", { estimatedTokens: this.session.estimatedTokens });
            continue;
          }
          // compact 也救不了 → 当不可恢复错误处理
        }

        if (msg.includes("tool loop exceeded") && continuations < maxContinuations) {
          // ── 续写恢复 ──
          continuations++;
          this.logger.info("continuation recovery", {
            attempt: continuations,
            maxContinuations,
            activeClaims: this.activeClaims.size,
          });

          // 列出已写的文件，帮助 LLM 了解进度
          const filesInfo = await this.listSharedFiles();
          this.session.appendUser(
            `## 续写指令\n\n` +
            `你的工作因工具调用轮次用尽被中断。请继续完成未完成的工作。\n\n` +
            `### 当前状态\n` +
            `- 未 resolve 的 claim: ${[...this.activeClaims].join(", ") || "无"}\n` +
            `- /shared/ 目录已有文件:\n${filesInfo}\n\n` +
            `请继续完成任务。如果代码已写完，记得调用 legion_bus_resolve 完成交付。`,
          );
          continue; // 回到 while 循环顶部重新运行
        }

        // 不可恢复的错误
        this.logger.error("agent run failed", { error: msg, continuations });
        this.metrics.recordError(msg);
        await this.emitHook("on_error", { error: msg });

        // ── 安全网 3: ClaimGuard 兜底 ──
        const orphans = await this.claimGuard.cleanup();
        if (orphans > 0) {
          this.logger.warn("ClaimGuard released claims after failure", { count: orphans });
        }

        this.session.sealCurrentTurn("Agent run failed, claims released by ClaimGuard");
        return;
      }
    }
  }

  // ══════════════════════════════════════════════════════════════════
  // helpers
  // ══════════════════════════════════════════════════════════════════

  private async executeScheduledTask(task: { taskId: string; name: string; prompt: string; priority: number }): Promise<void> {
    this.logger.info("executing scheduled task", {
      taskId: task.taskId,
      name: task.name,
      priority: task.priority,
    });
    this.scheduler!.markRunning(task.taskId);
    const userMessage = `## Scheduled Task: ${task.name}\n\n${task.prompt}`;
    this.session.appendUser(userMessage);

    try {
      await this.emitHook("before_turn", { taskId: task.taskId, taskName: task.name });
      await this.runner.run(this.systemPrompt, this.session);
      await this.emitHook("after_turn", { taskId: task.taskId, taskName: task.name });
      this.scheduler!.markCompleted(task.taskId);
      this.metrics.recordTaskCompletion(true);
      this.logger.info("task completed", { taskId: task.taskId, name: task.name });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.scheduler!.markFailed(task.taskId, msg);
      this.metrics.recordTaskCompletion(false);
      this.metrics.recordError(msg);
      this.logger.error("task failed", { taskId: task.taskId, error: msg });
      await this.emitHook("on_error", { taskId: task.taskId, error: msg });
      await this.claimGuard.cleanup();
    }
    this.session.sealCurrentTurn();
  }

  /**
   * 构建角色行为指南，注入到系统提示词末尾
   * 明确告知 LLM 它的角色边界和行为规范
   */
  private buildRoleGuidance(): string {
    const r = this.roleConfig.data;
    let guidance = "\n\n---\n\n## 角色行为指南（Runtime 自动注入）\n\n";

    guidance += `你的角色: ${r.role}\n\n`;

    guidance += `### 你应该 claim 的任务类型\n`;
    guidance += r.claims.map((c) => `- \`${c}\``).join("\n") + "\n\n";

    guidance += `### 你可以 publish 的 fact 类型\n`;
    guidance += r.allowed_publish.map((p) => `- \`${p}\``).join("\n") + "\n\n";

    if (r.on_complete.length > 0) {
      guidance += `### 完成任务后建议发布的结果\n`;
      for (const f of r.on_complete) {
        guidance += `- \`${f.fact_type}\` (${f.semantic_kind}, ${f.mode})\n`;
      }
      guidance += "\n";
    }

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

  /** 列出 /shared/ 目录下的文件（用于续写恢复时的上下文） */
  private async listSharedFiles(): Promise<string> {
    try {
      const sharedDirs = ["/shared/code", "/shared/docs", "/shared/tests", "/shared/requirements"];
      const files: string[] = [];
      for (const dir of sharedDirs) {
        await this.walkDir(dir, files);
      }
      return files.length > 0
        ? files.map((f) => `  - ${f}`).join("\n")
        : "  (无文件)";
    } catch {
      return "  (无法读取)";
    }
  }

  private async walkDir(dir: string, files: string[], depth = 0): Promise<void> {
    if (depth > 3) return;
    try {
      const entries = await fs.promises.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await this.walkDir(fullPath, files, depth + 1);
        } else {
          files.push(fullPath);
        }
      }
    } catch {
      // 目录不存在或无权限
    }
  }

  private createProvider(): LlmProvider {
    const primary = this.createSingleProvider(this.config.provider);

    const res = this.config.resilience;
    if (!res?.enabled) return primary;

    const providers: LlmProvider[] = [primary];
    if (res.fallbackProviders) {
      for (const cfg of res.fallbackProviders) {
        providers.push(this.createSingleProvider(cfg));
      }
    }

    const breakerConfig = { ...DEFAULT_CIRCUIT_BREAKER, ...res.circuitBreaker };
    const retryConfig = { ...DEFAULT_RETRY, ...res.retry };

    this.logger.info("resilience enabled", {
      providers: providers.length,
      circuitBreaker: breakerConfig,
      retry: { maxRetries: retryConfig.maxRetries },
    });

    return new ProviderFallback(providers, breakerConfig, retryConfig);
  }

  private createSingleProvider(config: { type: string; apiKey: string; baseUrl?: string }): LlmProvider {
    switch (config.type) {
      case "anthropic":
        return new AnthropicProvider(config.apiKey);
      case "openai-compatible":
        if (!config.baseUrl) {
          throw new Error("openai-compatible provider requires LLM_BASE_URL");
        }
        return new OpenAICompatibleProvider(config.apiKey, config.baseUrl);
      default:
        throw new Error(`unknown provider type: ${config.type}`);
    }
  }

  private extractSummary(content: Array<{ type: string; text?: string }>): string {
    const text = content
      .filter((b) => b.type === "text" && b.text)
      .map((b) => b.text!)
      .join(" ");
    return text.length > 200 ? text.slice(0, 200) + "..." : text || "(no text output)";
  }

  private startHealthServer(): void {
    const port = parseInt(process.env.HEALTH_PORT ?? "9090", 10);
    const metricsEnabled = this.config.observability?.metricsEndpoint !== false;

    this.healthServer = createServer((req, res) => {
      if (req.url === "/health") {
        const body = JSON.stringify({
          status: "ok",
          antId: this.channel.antId,
          connected: this.channel.isConnected,
          role: this.roleConfig?.role,
          uptime: Math.floor((Date.now() - this.startedAt) / 1000),
          ticks: this.tickCount,
          activeClaims: this.activeClaims.size,
          contextBufferSize: this.contextBuffer?.size ?? 0,
          tools: this.toolRegistry.size,
        });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(body);
      } else if (req.url === "/metrics" && metricsEnabled) {
        const body = JSON.stringify(this.metrics.snapshot());
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(body);
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    this.healthServer.listen(port, () => {
      this.logger.info("health server started", { port, metricsEnabled });
    });
  }

  private async cleanup(): Promise<void> {
    this.logger.info("cleaning up");
    await this.emitHook("on_shutdown", {});
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    this.healthServer?.close();
    await this.claimGuard.cleanup();
    this.session.flush();
    this.auditLog?.flush();
    this.channel.disconnect();
    this.logger.info("stopped");
    this.logger.flush();
  }

  private async emitHook(hookName: HookContext["hookName"], data: Record<string, unknown>): Promise<void> {
    await this.hooks.emit(hookName, {
      hookName,
      agentId: this.agentId,
      timestamp: Date.now(),
      data,
    });
  }

  private registerShutdownHandlers(): void {
    let shuttingDown = false;
    const handler = () => {
      if (shuttingDown) return;
      shuttingDown = true;
      this.shutdown();
    };
    process.on("SIGTERM", handler);
    process.on("SIGINT", handler);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
