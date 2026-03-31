/**
 * 文件系统工具 — workspace 范围内
 */

import fs from "node:fs/promises";
import path from "node:path";
import type { ToolDefinition, ToolContext } from "./registry.js";

// Allowed base paths: workspace + shared output directories (Docker mounts)
const ALLOWED_PREFIXES = ["/shared/", "/knowledge-base/"];

function resolveSafe(workspaceDir: string, filePath: string): string {
  const resolved = path.resolve(workspaceDir, filePath);
  if (resolved.startsWith(workspaceDir)) return resolved;
  for (const prefix of ALLOWED_PREFIXES) {
    if (resolved.startsWith(prefix)) return resolved;
  }
  throw new Error(`path outside workspace: ${filePath}`);
}

export function createFilesystemTools(): ToolDefinition[] {
  return [
    {
      name: "read_file",
      description: "读取文件内容。路径相对于 workspace 目录。",
      inputSchema: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
      },
      execute: async (input: unknown, ctx: ToolContext) => {
        const { path: filePath } = input as { path: string };
        const resolved = resolveSafe(ctx.workspaceDir, filePath);
        return await fs.readFile(resolved, "utf-8");
      },
    },

    {
      name: "write_file",
      description: "写入文件内容。路径相对于 workspace 目录，目录不存在时自动创建。",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string" },
          content: { type: "string" },
        },
        required: ["path", "content"],
      },
      execute: async (input: unknown, ctx: ToolContext) => {
        const raw = input as { path: string; content: unknown };
        const resolved = resolveSafe(ctx.workspaceDir, raw.path);
        // Accept both string and object content (auto-serialize JSON)
        const content = typeof raw.content === "string"
          ? raw.content
          : JSON.stringify(raw.content, null, 2);
        await fs.mkdir(path.dirname(resolved), { recursive: true });
        await fs.writeFile(resolved, content, "utf-8");
        return { written: resolved };
      },
    },

    {
      name: "list_dir",
      description: "列出目录内容。路径相对于 workspace 目录。",
      inputSchema: {
        type: "object",
        properties: { path: { type: "string" } },
      },
      execute: async (input: unknown, ctx: ToolContext) => {
        const dirPath = (input as { path?: string }).path ?? ".";
        const resolved = resolveSafe(ctx.workspaceDir, dirPath);
        const entries = await fs.readdir(resolved, { withFileTypes: true });
        return entries.map((e) => ({
          name: e.name,
          type: e.isDirectory() ? "directory" : "file",
        }));
      },
    },
  ];
}
