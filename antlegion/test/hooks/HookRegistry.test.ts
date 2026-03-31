import { describe, it, expect, vi } from "vitest";
import { HookRegistry, type HookHandler, type HookContext } from "../../src/hooks/HookRegistry.js";

function makeContext(hookName: string, data: Record<string, unknown> = {}): HookContext {
  return {
    hookName: hookName as HookContext["hookName"],
    agentId: "test-agent",
    timestamp: Date.now(),
    data,
  };
}

describe("HookRegistry", () => {
  it("should register and emit hooks", async () => {
    const registry = new HookRegistry();
    const handler = vi.fn(async () => {});

    registry.register("on_boot", handler);
    await registry.emit("on_boot", makeContext("on_boot"));

    expect(handler).toHaveBeenCalledOnce();
  });

  it("should emit to multiple handlers in order", async () => {
    const registry = new HookRegistry();
    const order: number[] = [];

    registry.register("before_tick", async () => { order.push(1); });
    registry.register("before_tick", async () => { order.push(2); });
    registry.register("before_tick", async () => { order.push(3); });

    await registry.emit("before_tick", makeContext("before_tick"));

    expect(order).toEqual([1, 2, 3]);
  });

  it("should not throw when emitting with no handlers", async () => {
    const registry = new HookRegistry();
    await expect(registry.emit("on_shutdown", makeContext("on_shutdown"))).resolves.toBeUndefined();
  });

  it("should isolate hook errors — one failing handler does not block others", async () => {
    const registry = new HookRegistry();
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    const handler1 = vi.fn(async () => { throw new Error("boom"); });
    const handler2 = vi.fn(async () => {});

    registry.register("on_error", handler1);
    registry.register("on_error", handler2);

    await registry.emit("on_error", makeContext("on_error", { error: "test" }));

    expect(handler1).toHaveBeenCalledOnce();
    expect(handler2).toHaveBeenCalledOnce();
    // error was logged to stderr
    expect(stderrSpy).toHaveBeenCalled();

    stderrSpy.mockRestore();
  });

  it("should pass context to handlers", async () => {
    const registry = new HookRegistry();
    let received: HookContext | null = null;

    registry.register("after_turn", async (ctx) => { received = ctx; });

    const ctx = makeContext("after_turn", { eventCount: 5 });
    await registry.emit("after_turn", ctx);

    expect(received).not.toBeNull();
    expect(received!.hookName).toBe("after_turn");
    expect(received!.data.eventCount).toBe(5);
  });

  it("should count handlers correctly", () => {
    const registry = new HookRegistry();
    expect(registry.handlerCount("on_boot")).toBe(0);
    expect(registry.totalHandlers()).toBe(0);

    registry.register("on_boot", async () => {});
    registry.register("on_boot", async () => {});
    registry.register("on_shutdown", async () => {});

    expect(registry.handlerCount("on_boot")).toBe(2);
    expect(registry.handlerCount("on_shutdown")).toBe(1);
    expect(registry.totalHandlers()).toBe(3);
  });

  it("should not cross-contaminate different hook names", async () => {
    const registry = new HookRegistry();
    const bootHandler = vi.fn(async () => {});
    const shutdownHandler = vi.fn(async () => {});

    registry.register("on_boot", bootHandler);
    registry.register("on_shutdown", shutdownHandler);

    await registry.emit("on_boot", makeContext("on_boot"));

    expect(bootHandler).toHaveBeenCalledOnce();
    expect(shutdownHandler).not.toHaveBeenCalled();
  });
});
