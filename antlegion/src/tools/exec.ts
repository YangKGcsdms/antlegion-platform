/**
 * exec 工具 — shell 命令执行
 * workspace cwd, 超时, 环境变量剥离
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ToolDefinition, ToolContext } from "./registry.js";

const execFileAsync = promisify(execFile);

/** 从环境变量中剥离敏感 key */
function sanitizeEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    const upper = key.toUpperCase();
    if (upper.includes("API_KEY") || upper.includes("SECRET") || upper.includes("TOKEN")) continue;
    env[key] = value;
  }
  return env;
}

export function createExecTool(): ToolDefinition {
  return {
    name: "exec",
    description: "执行 shell 命令，返回 stdout 和 stderr。在 workspace 目录下执行。",
    inputSchema: {
      type: "object",
      properties: {
        command: { type: "string", description: "要执行的 shell 命令" },
        timeout_ms: { type: "number", description: "超时毫秒数，默认 30000" },
      },
      required: ["command"],
    },
    execute: async (input: unknown, ctx: ToolContext) => {
      const { command, timeout_ms } = input as { command: string; timeout_ms?: number };
      const timeout = timeout_ms ?? 30_000;

      try {
        const { stdout, stderr } = await execFileAsync("sh", ["-c", command], {
          cwd: ctx.workspaceDir,
          timeout,
          maxBuffer: 1024 * 1024,
          env: sanitizeEnv(),
        });
        return { stdout, stderr };
      } catch (err: unknown) {
        const e = err as { stdout?: string; stderr?: string; message?: string };
        return {
          stdout: e.stdout ?? "",
          stderr: e.stderr ?? "",
          error: e.message ?? "command failed",
        };
      }
    },
  };
}
