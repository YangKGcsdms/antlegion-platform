/**
 * Runtime — antlegion 主循环
 *
 * 职责：
 * - 运行 tick handlers（插件注入的任务）
 * - 感知 Bus 事件
 * - 分流：broadcast → ContextBuffer, exclusive → pre-claim
 * - 格式化事件 → LLM 处理
 * - 错误恢复 + ClaimGuard 安全网
 * - 优雅关闭
 *
 * 所有组件的组装由 Bootstrapper 完成，Runtime 只管跑循环。
 */

import fs from "node:fs";
import path from "node:path";
import { createServer, type Server } from "node:http";

import type { BusEvent } from "./types/protocol.js";
import type { RuntimeContext } from "./bootstrap/Bootstrapper.js";
import type { HookContext } from "./hooks/HookRegistry.js";
import { METRICS_KEY } from "./plugins/builtin/observability-plugin.js";
import type { MetricsCollector } from "./observability/MetricsCollector.js";
import { getExtension } from "./tools/registry.js";

export class Runtime {
  private ctx!: RuntimeContext;
  private running = false;
  private startedAt = 0;
  private tickCount = 0;
  private healthServer: Server | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private runtimeContext: RuntimeContext) {
    this.ctx = runtimeContext;
  }

  async start(): Promise<void> {
    const { ctx } = this;

    // ── health server ──
    this.startHealthServer();

    // ── independent heartbeat ──
    this.heartbeatTimer = setInterval(async () => {
      if (!this.running) return;
      await ctx.channel.heartbeat().catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        ctx.logger.warn("heartbeat failed", { error: msg });
      });
    }, ctx.config.agent.heartbeatInterval);

    // ── main loop ──
    this.registerShutdownHandlers();
    this.running = true;
    this.startedAt = Date.now();
    await this.emitHook("on_boot", {});
    ctx.logger.info("entering main loop");

    while (this.running) {
      try {
        await this.tick();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        ctx.logger.error("tick error", { error: msg });
        await this.emitHook("on_error", { error: msg });
      }
      await sleep(ctx.config.agent.loopInterval);
    }

    await this.cleanup();
  }

  shutdown(): void {
    this.ctx.logger.info("shutdown requested");
    this.running = false;
  }

  // ══════════════════════════════════════════════════════════════════
  // tick — tick handlers → sense → triage → format → run → persist
  // ══════════════════════════════════════════════════════════════════

  private async tick(): Promise<void> {
    this.tickCount++;
    await this.emitHook("before_tick", { tick: this.tickCount });

    // ── 1. run plugin tick handlers (scheduler injects messages here) ──
    for (const handler of this.ctx.tickHandlers) {
      const action = await handler.handle({
        tickCount: this.tickCount,
        session: this.ctx.session,
        runner: this.ctx.runner,
        systemPrompt: this.ctx.systemPrompt,
      });
      if (action?.type === "inject_message") {
        this.ctx.session.appendUser(action.message);
        // 把 tick action 的 metadata 透传到 hook context（scheduler 用 taskId 精确标记）
        const hookExtra = { tickAction: true, ...action.metadata };
        await this.runWithRecovery([], [], hookExtra);
      }
    }

    // ── 2. sense events ──
    const { events, dropped } = this.ctx.channel.sense();
    if (events.length === 0) {
      await this.emitHook("after_tick", { tick: this.tickCount });
      return;
    }

    this.ctx.logger.info("sensed events", { count: events.length, dropped });

    // ── 3. triage: broadcast → ContextBuffer, exclusive → pre-claim ──
    const actionableEvents: BusEvent[] = [];
    const preClaimedIds = new Set<string>();
    for (const event of events) {
      if (event.fact?.mode === "broadcast") {
        this.ctx.contextBuffer.add(event.fact);
        this.ctx.logger.info("context buffered", {
          factType: event.fact.fact_type,
          factId: event.fact.fact_id,
        });
      } else if (event.fact?.mode === "exclusive" && event.event_type === "fact_available") {
        const factId = event.fact.fact_id;
        try {
          const result = await this.ctx.channel.claim(factId);
          if (result.success) {
            this.ctx.toolContext.activeClaims.add(factId);
            preClaimedIds.add(factId);
            this.ctx.logger.info("pre-claimed exclusive fact", {
              factType: event.fact.fact_type,
              factId,
            });
            actionableEvents.push(event);
          } else {
            this.ctx.logger.info("exclusive fact lost to another ant, skipping", {
              factType: event.fact.fact_type,
              factId,
              reason: result.error,
            });
          }
        } catch (err) {
          this.ctx.logger.warn("pre-claim failed, skipping exclusive fact", {
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

    // ── 4. build LLM message ──
    const causationMemory = this.ctx.factMemory.loadForEvents(actionableEvents);
    let userMessage = this.ctx.formatEvents(actionableEvents, dropped, causationMemory, preClaimedIds);

    // 预注入 broadcast 上下文
    const contextText = this.ctx.contextBuffer.formatForPrompt();
    if (contextText) {
      userMessage += contextText;
    }

    this.ctx.session.appendUser(userMessage);

    const factIds = actionableEvents
      .map((e: BusEvent) => e.fact?.fact_id)
      .filter((id): id is string => !!id);

    // ── 5. execute LLM (with recovery) ──
    await this.runWithRecovery(actionableEvents, factIds);

    await this.emitHook("after_tick", { tick: this.tickCount });
  }

  // ══════════════════════════════════════════════════════════════════
  // runWithRecovery — 续写恢复 + 上下文溢出恢复 + ClaimGuard
  // ══════════════════════════════════════════════════════════════════

  private async runWithRecovery(
    events: BusEvent[],
    factIds: string[],
    hookExtra?: Record<string, unknown>,
  ): Promise<void> {
    const maxContinuations = this.ctx.roleConfig.maxRetries;
    let continuations = 0;

    while (continuations <= maxContinuations) {
      try {
        // 预检：上下文接近阈值时先 compact
        if (this.ctx.session.needsCompaction) {
          this.ctx.logger.info("pre-request compact", { estimatedTokens: this.ctx.session.estimatedTokens });
          await this.ctx.session.autoCompact();
        }

        await this.emitHook("before_turn", { eventCount: events.length, continuation: continuations, ...hookExtra });
        const result = await this.ctx.runner.run(this.ctx.systemPrompt, this.ctx.session);
        await this.emitHook("after_turn", { eventCount: events.length, ...hookExtra });

        // 固化已处理的 facts
        for (const factId of factIds) {
          const fact = events.find((e: BusEvent) => e.fact?.fact_id === factId)?.fact;
          if (fact) {
            this.ctx.factMemory.persist({
              factId,
              factType: fact.fact_type,
              summary: this.extractSummary(result.content),
              payload: fact.payload,
              timestamp: Date.now(),
            });
          }
        }

        this.ctx.session.sealCurrentTurn();

        // ClaimGuard 安全网
        const orphans = await this.ctx.claimGuard.cleanup();
        if (orphans > 0) {
          this.ctx.logger.warn("ClaimGuard released orphan claims", { count: orphans });
        }

        return;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);

        if ((msg.includes("prompt") && msg.includes("long")) || msg.includes("context_length")) {
          this.ctx.logger.info("context overflow detected, triggering auto-compact");
          const compacted = await this.ctx.session.autoCompact();
          if (compacted) {
            continuations++;
            this.ctx.logger.info("auto-compact succeeded, retrying", {
              estimatedTokens: this.ctx.session.estimatedTokens,
            });
            continue;
          }
        }

        if (msg.includes("tool loop exceeded") && continuations < maxContinuations) {
          continuations++;
          this.ctx.logger.info("continuation recovery", {
            attempt: continuations,
            maxContinuations,
            activeClaims: this.ctx.toolContext.activeClaims.size,
          });

          const filesInfo = await this.listSharedFiles();
          this.ctx.session.appendUser(
            `## 续写指令\n\n` +
            `你的工作因工具调用轮次用尽被中断。请继续完成未完成的工作。\n\n` +
            `### 当前状态\n` +
            `- 未 resolve 的 claim: ${[...this.ctx.toolContext.activeClaims].join(", ") || "无"}\n` +
            `- /shared/ 目录已有文件:\n${filesInfo}\n\n` +
            `请继续完成任务。如果代码已写完，记得调用 legion_bus_resolve 完成交付。`,
          );
          continue;
        }

        // 不可恢复的错误
        this.ctx.logger.error("agent run failed", { error: msg, continuations });
        await this.emitHook("on_error", { error: msg, ...hookExtra });

        const orphans = await this.ctx.claimGuard.cleanup();
        if (orphans > 0) {
          this.ctx.logger.warn("ClaimGuard released claims after failure", { count: orphans });
        }

        this.ctx.session.sealCurrentTurn("Agent run failed, claims released by ClaimGuard");
        return;
      }
    }
  }

  // ══════════════════════════════════════════════════════════════════
  // helpers
  // ══════════════════════════════════════════════════════════════════

  private extractSummary(content: Array<{ type: string; text?: string }>): string {
    const text = content
      .filter((b) => b.type === "text" && b.text)
      .map((b) => b.text!)
      .join(" ");
    return text.length > 200 ? text.slice(0, 200) + "..." : text || "(no text output)";
  }

  private async listSharedFiles(): Promise<string> {
    try {
      const sharedDirs = ["/shared/code", "/shared/docs", "/shared/tests", "/shared/requirements"];
      const files: string[] = [];
      for (const dir of sharedDirs) {
        await this.walkDir(dir, files);
      }
      return files.length > 0 ? files.map((f) => `  - ${f}`).join("\n") : "  (无文件)";
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

  private startHealthServer(): void {
    const port = parseInt(process.env.HEALTH_PORT ?? "9090", 10);
    const metricsEnabled = this.ctx.config.observability?.metricsEndpoint !== false;

    this.healthServer = createServer((req, res) => {
      if (req.url === "/health") {
        const body = JSON.stringify({
          status: "ok",
          antId: this.ctx.agentId,
          connected: this.ctx.channel.isConnected,
          role: this.ctx.roleConfig?.role,
          uptime: Math.floor((Date.now() - this.startedAt) / 1000),
          ticks: this.tickCount,
          activeClaims: this.ctx.toolContext.activeClaims.size,
          contextBufferSize: this.ctx.contextBuffer?.size ?? 0,
          tools: this.ctx.toolRegistry.size,
        });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(body);
      } else if (req.url === "/metrics" && metricsEnabled) {
        const metrics = getExtension<MetricsCollector>(this.ctx.toolContext, METRICS_KEY);
        const body = metrics
          ? JSON.stringify(metrics.snapshot())
          : JSON.stringify({ error: "metrics not available" });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(body);
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    this.healthServer.listen(port, () => {
      this.ctx.logger.info("health server started", { port, metricsEnabled });
    });
  }

  private async cleanup(): Promise<void> {
    this.ctx.logger.info("cleaning up");
    await this.emitHook("on_shutdown", {});
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    this.healthServer?.close();
    await this.ctx.claimGuard.cleanup();
    this.ctx.session.flush();

    // 调用插件的 teardown
    for (const plugin of this.ctx.plugins) {
      if (plugin.teardown) {
        try {
          await plugin.teardown();
        } catch (err) {
          this.ctx.logger.warn("plugin teardown failed", {
            name: plugin.name,
            error: String(err),
          });
        }
      }
    }

    this.ctx.channel.disconnect();
    this.ctx.logger.info("stopped");
    this.ctx.logger.flush();
  }

  private async emitHook(hookName: HookContext["hookName"], data: Record<string, unknown>): Promise<void> {
    await this.ctx.hooks.emit(hookName, {
      hookName,
      agentId: this.ctx.agentId,
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
