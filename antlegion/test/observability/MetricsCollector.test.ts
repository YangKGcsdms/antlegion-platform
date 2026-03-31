import { describe, it, expect } from "vitest";
import { MetricsCollector } from "../../src/observability/MetricsCollector.js";

describe("MetricsCollector", () => {
  it("should start with zero counters", () => {
    const m = new MetricsCollector();
    const snap = m.snapshot();
    expect(snap.ticks).toBe(0);
    expect(snap.tools.totalCalls).toBe(0);
    expect(snap.llm.calls).toBe(0);
    expect(snap.errors.total).toBe(0);
  });

  it("should record ticks", () => {
    const m = new MetricsCollector();
    m.recordTick();
    m.recordTick();
    m.recordTick();
    expect(m.snapshot().ticks).toBe(3);
  });

  it("should record tool calls with per-tool breakdown", () => {
    const m = new MetricsCollector();
    m.recordToolCall("exec", 100, true);
    m.recordToolCall("exec", 200, false);
    m.recordToolCall("read_file", 50, true);

    const snap = m.snapshot();
    expect(snap.tools.totalCalls).toBe(3);
    expect(snap.tools.totalErrors).toBe(1);
    expect(snap.tools.byTool["exec"]).toEqual({ calls: 2, errors: 1, totalMs: 300 });
    expect(snap.tools.byTool["read_file"]).toEqual({ calls: 1, errors: 0, totalMs: 50 });
  });

  it("should record LLM calls with token counts", () => {
    const m = new MetricsCollector();
    m.recordLlmCall("claude-sonnet-4-6-20250514", 1000, 500, 2000);
    m.recordLlmCall("claude-sonnet-4-6-20250514", 2000, 1000, 3000);

    const snap = m.snapshot();
    expect(snap.llm.calls).toBe(2);
    expect(snap.llm.inputTokens).toBe(3000);
    expect(snap.llm.outputTokens).toBe(1500);
    expect(snap.llm.totalMs).toBe(5000);
    expect(snap.llm.estimatedCostUsd).toBeGreaterThan(0);
  });

  it("should record task completions", () => {
    const m = new MetricsCollector();
    m.recordTaskCompletion(true);
    m.recordTaskCompletion(true);
    m.recordTaskCompletion(false);

    const snap = m.snapshot();
    expect(snap.tasks.completed).toBe(2);
    expect(snap.tasks.failed).toBe(1);
  });

  it("should record errors with last error message", () => {
    const m = new MetricsCollector();
    m.recordError("first error");
    m.recordError("second error");

    const snap = m.snapshot();
    expect(snap.errors.total).toBe(2);
    expect(snap.errors.lastError).toBe("second error");
  });

  it("should track uptime", () => {
    const m = new MetricsCollector();
    const snap = m.snapshot();
    expect(snap.uptime).toBeGreaterThanOrEqual(0);
  });
});
