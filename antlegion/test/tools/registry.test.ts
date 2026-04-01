import { describe, it, expect } from "vitest";
import { ToolRegistry, type ToolDefinition, type ToolContext } from "../../src/tools/registry.js";
import { MetricsCollector } from "../../src/observability/MetricsCollector.js";
import { PermissionManager } from "../../src/permissions/PermissionManager.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const mockContext = {} as ToolContext;

function makeTool(name: string, result: unknown = "ok"): ToolDefinition {
  return {
    name,
    description: `tool ${name}`,
    inputSchema: { type: "object" },
    execute: async () => result,
  };
}

describe("ToolRegistry", () => {
  it("should register and execute a tool", async () => {
    const reg = new ToolRegistry();
    reg.register(makeTool("foo", 42));

    const result = await reg.execute("foo", {}, mockContext);
    expect(result).toBe(42);
  });

  it("should throw on unknown tool", async () => {
    const reg = new ToolRegistry();
    await expect(reg.execute("nope", {}, mockContext)).rejects.toThrow("unknown tool: nope");
  });

  it("should registerAll", () => {
    const reg = new ToolRegistry();
    reg.registerAll([makeTool("a"), makeTool("b"), makeTool("c")]);
    expect(reg.size).toBe(3);
  });

  it("should return schemas without execute", () => {
    const reg = new ToolRegistry();
    reg.register(makeTool("foo"));

    const schemas = reg.schemas();
    expect(schemas).toHaveLength(1);
    expect(schemas[0].name).toBe("foo");
    expect(schemas[0].description).toBe("tool foo");
    expect(schemas[0].input_schema).toEqual({ type: "object" });
    // execute should not be in schema
    expect((schemas[0] as Record<string, unknown>).execute).toBeUndefined();
  });

  it("should overwrite tool with same name", () => {
    const reg = new ToolRegistry();
    reg.register(makeTool("foo", "first"));
    reg.register(makeTool("foo", "second"));
    expect(reg.size).toBe(1);
  });

  it("should record metrics on tool execution", async () => {
    const metrics = new MetricsCollector();
    const ctx = { ...mockContext, metrics } as ToolContext;

    const reg = new ToolRegistry();
    reg.register(makeTool("foo", "result"));
    await reg.execute("foo", {}, ctx);

    const snap = metrics.snapshot();
    expect(snap.tools.totalCalls).toBe(1);
    expect(snap.tools.byTool["foo"].calls).toBe(1);
    expect(snap.tools.byTool["foo"].errors).toBe(0);
  });

  it("should record error metrics on tool failure", async () => {
    const metrics = new MetricsCollector();
    const ctx = { ...mockContext, metrics } as ToolContext;

    const reg = new ToolRegistry();
    reg.register({
      name: "bad",
      description: "fails",
      inputSchema: { type: "object" },
      execute: async () => { throw new Error("boom"); },
    });

    await expect(reg.execute("bad", {}, ctx)).rejects.toThrow("boom");

    const snap = metrics.snapshot();
    expect(snap.tools.totalCalls).toBe(1);
    expect(snap.tools.totalErrors).toBe(1);
  });

  it("should reject denied tools via permission middleware", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "reg-perm-test-"));
    const md = `| Tool Pattern | Level |
|---|---|
| danger | deny |
`;
    fs.writeFileSync(path.join(tmpDir, "PERMISSIONS.md"), md);

    const pm = new PermissionManager(
      { enabled: true, policyFile: "PERMISSIONS.md", defaultLevel: "allow" },
      tmpDir,
    );

    const reg = new ToolRegistry();
    reg.register(makeTool("danger", "should not reach"));
    reg.addMiddleware(async (next, name, input, ctx) => {
      if (!pm.isAllowed(name)) {
        throw new Error(`tool "${name}" is denied by permission policy`);
      }
      return next(name, input, ctx);
    });

    await expect(reg.execute("danger", {}, mockContext)).rejects.toThrow("denied by permission policy");

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("should allow permitted tools via permission middleware", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "reg-perm-test-"));
    const md = `| Tool Pattern | Level |
|---|---|
| safe | allow |
`;
    fs.writeFileSync(path.join(tmpDir, "PERMISSIONS.md"), md);

    const pm = new PermissionManager(
      { enabled: true, policyFile: "PERMISSIONS.md", defaultLevel: "deny" },
      tmpDir,
    );

    const reg = new ToolRegistry();
    reg.register(makeTool("safe", "allowed"));
    reg.addMiddleware(async (next, name, input, ctx) => {
      if (!pm.isAllowed(name)) {
        throw new Error(`tool "${name}" is denied by permission policy`);
      }
      return next(name, input, ctx);
    });

    const result = await reg.execute("safe", {}, mockContext);
    expect(result).toBe("allowed");

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
