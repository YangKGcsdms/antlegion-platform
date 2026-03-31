/**
 * Workspace 文件加载
 * 对齐 OpenAnt workspace.ts 的文件规范
 */

import fs from "node:fs";
import path from "node:path";

export const WORKSPACE_FILES = [
  "SOUL.md",
  "AGENTS.md",
  "TOOLS.md",
  "IDENTITY.md",
  "BOOTSTRAP.md",
  "MEMORY.md",
] as const;

export type WorkspaceFileKey = typeof WORKSPACE_FILES[number];

export interface WorkspaceData {
  /** 各文件内容，不存在的文件不包含 */
  files: Partial<Record<WorkspaceFileKey, string>>;
  /** workspace 目录绝对路径 */
  dir: string;
}

/** 从 content 中剥离 YAML front matter */
function stripFrontMatter(content: string): string {
  if (!content.startsWith("---")) return content;
  const end = content.indexOf("\n---", 3);
  if (end === -1) return content;
  return content.slice(end + 4).trimStart();
}

export function loadWorkspace(dir: string): WorkspaceData {
  const resolved = path.resolve(dir);

  if (!fs.existsSync(resolved)) {
    console.warn(`[workspace] directory not found: ${resolved}`);
    return { files: {}, dir: resolved };
  }

  const files: Partial<Record<WorkspaceFileKey, string>> = {};

  for (const filename of WORKSPACE_FILES) {
    const filePath = path.join(resolved, filename);
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, "utf-8");
      if (raw.length > 2 * 1024 * 1024) {
        console.warn(`[workspace] ${filename} exceeds 2MB, skipped`);
        continue;
      }
      files[filename] = stripFrontMatter(raw);
      console.log(`[workspace] loaded ${filename} (${raw.length} bytes)`);
    }
  }

  return { files, dir: resolved };
}
