import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createExecTool } from "../../src/tools/exec.js";
import type { ToolContext } from "../../src/tools/registry.js";

let tmpDir: string;
let ctx: ToolContext;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "exec-"));
  ctx = {
    channel: {} as never,
    workspaceDir: tmpDir,
    agentId: "test",
    activeClaims: new Set(),
  };
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("exec tool", () => {
  const tool = createExecTool();

  it("should execute simple command", async () => {
    const result = await tool.execute({ command: "echo hello" }, ctx) as { stdout: string };
    expect(result.stdout.trim()).toBe("hello");
  });

  it("should run in workspace directory", async () => {
    fs.writeFileSync(path.join(tmpDir, "marker.txt"), "found");
    const result = await tool.execute({ command: "cat marker.txt" }, ctx) as { stdout: string };
    expect(result.stdout.trim()).toBe("found");
  });

  it("should capture stderr", async () => {
    const result = await tool.execute({ command: "echo err >&2" }, ctx) as { stderr: string };
    expect(result.stderr.trim()).toBe("err");
  });

  it("should return error for failing command", async () => {
    const result = await tool.execute({ command: "exit 1" }, ctx) as { error: string };
    expect(result.error).toBeDefined();
  });

  it("should not leak API keys to subprocess", async () => {
    const origKey = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = "secret-test-key";

    try {
      const result = await tool.execute({ command: "env" }, ctx) as { stdout: string };
      expect(result.stdout).not.toContain("secret-test-key");
    } finally {
      if (origKey) process.env.ANTHROPIC_API_KEY = origKey;
      else delete process.env.ANTHROPIC_API_KEY;
    }
  });

  it("should handle timeout", async () => {
    const result = await tool.execute({ command: "sleep 10", timeout_ms: 500 }, ctx) as { error: string };
    expect(result.error).toBeDefined();
  }, 5000);
});
