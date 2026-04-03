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
  private currentPhase = "idle";
  private lastToolCall = "";

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
      const claims = ctx.toolContext?.activeClaims?.size ?? 0;
      await ctx.channel.heartbeat({
        current_action: this.currentPhase,
        status_text: `tick#${this.tickCount} claims:${claims}${this.lastToolCall ? ` last_tool:${this.lastToolCall}` : ""}`,
      }).catch((err) => {
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
    this.currentPhase = "tick_handlers";
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
    this.currentPhase = "sense";
    const { events, dropped } = this.ctx.channel.sense();
    if (events.length === 0) {
      await this.emitHook("after_tick", { tick: this.tickCount });
      return;
    }

    this.ctx.logger.info("sensed events", { count: events.length, dropped });

    // ── 3. triage: broadcast → ContextBuffer, exclusive → pre-claim ──
    this.currentPhase = "triage";
    const actionableEvents: BusEvent[] = [];
    const preClaimedIds = new Set<string>();
    for (const event of events) {
      if (event.fact?.mode === "broadcast") {
        this.ctx.contextBuffer.add(event.fact);

        // DDD: broadcast facts matching context_interests also trigger agent turns
        if (this.ctx.roleConfig.isContextInterest(event.fact.fact_type)) {
          actionableEvents.push(event);
          this.ctx.logger.info("broadcast fact triggers agent turn (context_interest match)", {
            factType: event.fact.fact_type,
            factId: event.fact.fact_id,
          });
        } else {
          this.ctx.logger.info("context buffered (no trigger)", {
            factType: event.fact.fact_type,
            factId: event.fact.fact_id,
          });
        }
      } else if (event.fact?.mode === "exclusive" && event.event_type === "fact_available") {
        const factId = event.fact.fact_id;
        const factType = event.fact.fact_type;

        // ── claims 白名单校验：只 claim 本角色职责范围内的 fact ──
        if (!this.ctx.roleConfig.shouldClaim(factType)) {
          this.ctx.logger.info("exclusive fact not in claims scope, buffering as context", {
            factType,
            factId,
          });
          this.ctx.contextBuffer.add(event.fact);
          continue;
        }

        // ── 自发布防护：不 claim 自己发布的 fact ──
        if (event.fact.source_ant_id === this.ctx.channel.antId) {
          this.ctx.logger.info("skipping self-published exclusive fact", {
            factType,
            factId,
          });
          continue;
        }

        try {
          const result = await this.ctx.channel.claim(factId);
          if (result.success) {
            this.ctx.toolContext.activeClaims.add(factId);
            preClaimedIds.add(factId);
            this.ctx.logger.info("pre-claimed exclusive fact", {
              factType,
              factId,
            });
            actionableEvents.push(event);
          } else {
            this.ctx.logger.info("exclusive fact lost to another ant, skipping", {
              factType,
              factId,
              reason: result.error,
            });
          }
        } catch (err) {
          this.ctx.logger.warn("pre-claim failed, skipping exclusive fact", {
            factType,
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
    this.currentPhase = "format";
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
    this.currentPhase = "llm_run";
    await this.runWithRecovery(actionableEvents, factIds);

    this.currentPhase = "idle";
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
      const url = new URL(req.url ?? "/", `http://localhost:${port}`);

      if (url.pathname === "/health") {
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
      } else if (url.pathname === "/metrics" && metricsEnabled) {
        const metrics = getExtension<MetricsCollector>(this.ctx.toolContext, METRICS_KEY);
        const body = metrics
          ? JSON.stringify(metrics.snapshot())
          : JSON.stringify({ error: "metrics not available" });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(body);
      } else if (url.pathname === "/session") {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(this.renderSessionPage());
      } else if (url.pathname === "/session/api") {
        res.writeHead(200, {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        });
        res.end(JSON.stringify(this.getSessionData()));
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    this.healthServer.listen(port, () => {
      this.ctx.logger.info("health server started", { port, metricsEnabled });
    });
  }

  // ══════════════════════════════════════════════════════════════════
  // Session 看板
  // ══════════════════════════════════════════════════════════════════

  private getSessionData(): Record<string, unknown> {
    const messages = this.ctx.session.getMessages();
    const formatted = messages.map((msg, idx) => {
      if (typeof msg.content === "string") {
        return { idx, role: msg.role, type: "text", text: msg.content };
      }
      if (Array.isArray(msg.content)) {
        const blocks = msg.content.map((block) => {
          if ("type" in block && block.type === "text" && "text" in block) {
            return { type: "text", text: (block as { text: string }).text };
          }
          if ("type" in block && block.type === "tool_use") {
            const tb = block as { id: string; name: string; input: unknown };
            return { type: "tool_use", id: tb.id, name: tb.name, input: tb.input };
          }
          if ("type" in block && block.type === "tool_result") {
            const tr = block as { tool_use_id: string; content: string; is_error?: boolean };
            return { type: "tool_result", tool_use_id: tr.tool_use_id, content: tr.content, is_error: tr.is_error };
          }
          return { type: "unknown", raw: JSON.stringify(block) };
        });
        return { idx, role: msg.role, type: "blocks", blocks };
      }
      return { idx, role: msg.role, type: "unknown" };
    });

    return {
      antId: this.ctx.agentId,
      name: this.ctx.config.bus.name,
      role: this.ctx.roleConfig?.role ?? "unknown",
      connected: this.ctx.channel.isConnected,
      uptime: Math.floor((Date.now() - this.startedAt) / 1000),
      ticks: this.tickCount,
      activeClaims: [...this.ctx.toolContext.activeClaims],
      estimatedTokens: this.ctx.session.estimatedTokens,
      messageCount: this.ctx.session.messageCount,
      messages: formatted,
      timestamp: Date.now(),
    };
  }

  private renderSessionPage(): string {
    const name = this.ctx.config.bus.name;
    const role = this.ctx.roleConfig?.role ?? "agent";

    const roleLabels: Record<string, string> = {
      "product-manager": "产品经理",
      "backend-developer": "后端开发",
      "frontend-developer": "前端开发",
      "qa-tester": "测试工程师",
    };
    const roleColors: Record<string, string> = {
      "product-manager": "#8b5cf6",
      "backend-developer": "#3b82f6",
      "frontend-developer": "#10b981",
      "qa-tester": "#f59e0b",
    };
    const label = roleLabels[name] ?? name;
    const color = roleColors[name] ?? "#6b7280";

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${label} — Session 看板</title>
<style>
  :root {
    --accent: ${color};
    --bg: #0f172a;
    --card: #1e293b;
    --border: #334155;
    --text: #e2e8f0;
    --text-dim: #94a3b8;
    --user-bg: #1e3a5f;
    --assistant-bg: #1a2e1a;
    --tool-bg: #2d2416;
    --tool-result-bg: #1c1c2e;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Noto Sans SC", sans-serif;
    background: var(--bg); color: var(--text);
    line-height: 1.6; padding: 0;
  }
  .header {
    background: var(--card); border-bottom: 3px solid var(--accent);
    padding: 16px 24px; display: flex; align-items: center; gap: 16px;
    position: sticky; top: 0; z-index: 10;
  }
  .header .dot { width: 14px; height: 14px; border-radius: 50%; background: var(--accent); flex-shrink: 0; }
  .header h1 { font-size: 18px; font-weight: 600; color: var(--accent); }
  .header .meta { margin-left: auto; font-size: 12px; color: var(--text-dim); text-align: right; }
  .header .meta span { display: inline-block; margin-left: 16px; }
  .controls {
    padding: 12px 24px; background: var(--card); border-bottom: 1px solid var(--border);
    display: flex; align-items: center; gap: 12px; font-size: 13px;
  }
  .controls label { color: var(--text-dim); }
  .controls input[type=checkbox] { accent-color: var(--accent); }
  .controls button {
    padding: 4px 14px; border-radius: 4px; border: 1px solid var(--border);
    background: var(--card); color: var(--text); cursor: pointer; font-size: 12px;
  }
  .controls button:hover { border-color: var(--accent); color: var(--accent); }
  .controls .status { margin-left: auto; }
  .controls .status .live { color: #22c55e; }
  .controls .status .off { color: #ef4444; }

  #messages { padding: 16px 24px 80px; }
  .msg {
    margin-bottom: 12px; border-radius: 8px; padding: 12px 16px;
    border-left: 4px solid transparent; position: relative;
    page-break-inside: avoid;
  }
  .msg.user { background: var(--user-bg); border-left-color: #3b82f6; }
  .msg.assistant { background: var(--assistant-bg); border-left-color: #22c55e; }
  .msg .role-tag {
    font-size: 11px; font-weight: 700; text-transform: uppercase;
    letter-spacing: 0.5px; margin-bottom: 6px; opacity: 0.7;
  }
  .msg.user .role-tag { color: #60a5fa; }
  .msg.assistant .role-tag { color: #4ade80; }
  .msg .content { white-space: pre-wrap; word-break: break-word; font-size: 13px; }

  .tool-call {
    background: var(--tool-bg); border-radius: 6px; padding: 10px 14px;
    margin: 6px 0; border-left: 3px solid #f59e0b;
  }
  .tool-call .tool-name { color: #fbbf24; font-weight: 600; font-size: 12px; }
  .tool-call .tool-input {
    font-family: "SF Mono", "Fira Code", monospace; font-size: 11px;
    color: var(--text-dim); margin-top: 4px; max-height: 200px; overflow-y: auto;
  }
  .tool-result {
    background: var(--tool-result-bg); border-radius: 6px; padding: 10px 14px;
    margin: 6px 0; border-left: 3px solid #818cf8;
  }
  .tool-result.error { border-left-color: #ef4444; }
  .tool-result .tr-label { color: #a5b4fc; font-weight: 600; font-size: 12px; }
  .tool-result.error .tr-label { color: #fca5a5; }
  .tool-result .tr-content {
    font-family: "SF Mono", "Fira Code", monospace; font-size: 11px;
    color: var(--text-dim); margin-top: 4px; max-height: 200px; overflow-y: auto;
    white-space: pre-wrap; word-break: break-all;
  }

  .msg-idx {
    position: absolute; top: 8px; right: 12px;
    font-size: 10px; color: var(--text-dim); opacity: 0.5;
  }

  .empty {
    text-align: center; color: var(--text-dim); padding: 60px 20px;
    font-size: 14px;
  }

  /* ── 打印样式 ── */
  @media print {
    :root {
      --bg: #fff; --card: #fff; --border: #ddd; --text: #1a1a1a;
      --text-dim: #666; --user-bg: #eef4ff; --assistant-bg: #eefbee;
      --tool-bg: #fff8ee; --tool-result-bg: #f0f0ff;
    }
    body { background: #fff; color: #1a1a1a; padding: 0; font-size: 11px; }
    .header { position: static; border-bottom: 2px solid var(--accent); padding: 10px 16px; }
    .header h1 { font-size: 14px; }
    .controls { display: none; }
    #messages { padding: 8px 16px; }
    .msg { padding: 8px 12px; margin-bottom: 8px; page-break-inside: avoid; }
    .msg .content { font-size: 11px; }
    .tool-call .tool-input, .tool-result .tr-content {
      max-height: none; font-size: 9px;
    }
    @page { margin: 1cm; size: A4; }
  }
</style>
</head>
<body>
<div class="header">
  <span class="dot"></span>
  <h1>${label} — LLM Session</h1>
  <div class="meta">
    <span id="meta-tokens"></span>
    <span id="meta-msgs"></span>
    <span id="meta-ticks"></span>
    <span id="meta-uptime"></span>
  </div>
</div>
<div class="controls">
  <label><input type="checkbox" id="auto-refresh" checked> 自动刷新</label>
  <label><input type="checkbox" id="auto-scroll" checked> 自动滚底</label>
  <label><input type="checkbox" id="collapse-tools"> 折叠工具调用</label>
  <button onclick="location.reload()">手动刷新</button>
  <button onclick="window.print()">打印 / PDF</button>
  <div class="status">
    <span id="conn-status"></span>
    <span id="last-update" style="margin-left:8px;font-size:11px;color:var(--text-dim)"></span>
  </div>
</div>
<div id="messages"><div class="empty">加载中…</div></div>

<script>
const API = '/session/api';
let lastCount = 0;
let autoRefresh = true;
let autoScroll = true;
let collapseTools = false;

document.getElementById('auto-refresh').addEventListener('change', e => { autoRefresh = e.target.checked; });
document.getElementById('auto-scroll').addEventListener('change', e => { autoScroll = e.target.checked; });
document.getElementById('collapse-tools').addEventListener('change', e => {
  collapseTools = e.target.checked;
  document.querySelectorAll('.tool-call .tool-input, .tool-result .tr-content').forEach(el => {
    el.style.display = collapseTools ? 'none' : 'block';
  });
});

function escapeHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function truncate(s, max) {
  if (s.length <= max) return s;
  return s.slice(0, max) + '\\n… [已截断 ' + (s.length - max) + ' 字符]';
}

function renderBlock(block) {
  if (block.type === 'text') {
    return '<div class="content">' + escapeHtml(block.text) + '</div>';
  }
  if (block.type === 'tool_use') {
    const inputStr = typeof block.input === 'string' ? block.input : JSON.stringify(block.input, null, 2);
    const display = collapseTools ? 'none' : 'block';
    return '<div class="tool-call">'
      + '<div class="tool-name">⚡ ' + escapeHtml(block.name) + '</div>'
      + '<pre class="tool-input" style="display:' + display + '">' + escapeHtml(truncate(inputStr, 2000)) + '</pre>'
      + '</div>';
  }
  if (block.type === 'tool_result') {
    const cls = block.is_error ? 'tool-result error' : 'tool-result';
    const label = block.is_error ? '✗ 工具错误' : '✓ 工具返回';
    const display = collapseTools ? 'none' : 'block';
    return '<div class="' + cls + '">'
      + '<div class="tr-label">' + label + ' (' + escapeHtml(block.tool_use_id || '') + ')</div>'
      + '<pre class="tr-content" style="display:' + display + '">' + escapeHtml(truncate(block.content || '', 3000)) + '</pre>'
      + '</div>';
  }
  return '<div class="content" style="color:var(--text-dim)">[unknown block]</div>';
}

function renderMessage(m) {
  let inner = '';
  if (m.type === 'text') {
    inner = '<div class="content">' + escapeHtml(m.text) + '</div>';
  } else if (m.type === 'blocks') {
    inner = (m.blocks || []).map(renderBlock).join('');
  }
  const roleLabel = m.role === 'user' ? 'USER' : 'ASSISTANT';
  return '<div class="msg ' + m.role + '">'
    + '<span class="msg-idx">#' + m.idx + '</span>'
    + '<div class="role-tag">' + roleLabel + '</div>'
    + inner
    + '</div>';
}

function formatUptime(s) {
  if (s < 60) return s + 's';
  if (s < 3600) return Math.floor(s/60) + 'm' + (s%60) + 's';
  return Math.floor(s/3600) + 'h' + Math.floor((s%3600)/60) + 'm';
}

async function refresh() {
  try {
    const r = await fetch(API);
    const data = await r.json();

    document.getElementById('meta-tokens').textContent = '~' + data.estimatedTokens + ' tokens';
    document.getElementById('meta-msgs').textContent = data.messageCount + ' msgs';
    document.getElementById('meta-ticks').textContent = 'tick #' + data.ticks;
    document.getElementById('meta-uptime').textContent = formatUptime(data.uptime);
    document.getElementById('conn-status').innerHTML = data.connected
      ? '<span class="live">● 已连接</span>'
      : '<span class="off">● 未连接</span>';
    document.getElementById('last-update').textContent = new Date().toLocaleTimeString();

    const container = document.getElementById('messages');
    if (!data.messages || data.messages.length === 0) {
      container.innerHTML = '<div class="empty">暂无对话消息，等待事件触发…</div>';
      lastCount = 0;
      return;
    }

    if (data.messages.length !== lastCount) {
      container.innerHTML = data.messages.map(renderMessage).join('');
      lastCount = data.messages.length;
      if (autoScroll) {
        window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
      }
    }
  } catch(e) {
    document.getElementById('conn-status').innerHTML = '<span class="off">● 连接失败</span>';
  }
}

refresh();
setInterval(() => { if (autoRefresh) refresh(); }, 2000);
</script>
</body>
</html>`;
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
