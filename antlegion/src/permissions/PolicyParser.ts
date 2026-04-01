/**
 * 策略解析器 — 简化为 allow/deny 模型
 * 支持 Markdown 表格格式和 JSON 格式
 *
 * Markdown 格式:
 * | Tool Pattern   | Level |
 * |----------------|-------|
 * | exec           | allow |
 * | legion_bus_*   | allow |
 * | dangerous_tool | deny  |
 */

import type { PermissionPolicy, PermissionLevel, ToolPermission } from "./types.js";

const VALID_LEVELS: Set<string> = new Set(["allow", "deny"]);

/** 兼容旧格式：unrestricted/supervised → allow, restricted/sandboxed → deny */
function normalizeLevel(level: string): PermissionLevel | null {
  const l = level.toLowerCase();
  if (l === "allow" || l === "unrestricted" || l === "supervised") return "allow";
  if (l === "deny" || l === "restricted" || l === "sandboxed") return "deny";
  return null;
}

function isSeparatorLine(line: string): boolean {
  return /^\|[\s\-:|]+\|[\s\-:|]*$/.test(line);
}

function parseTableRow(line: string): string[] {
  return line
    .split("|")
    .map((c) => c.trim())
    .filter((c) => c.length > 0);
}

export function parsePermissionsMarkdown(content: string, defaultLevel: PermissionLevel): PermissionPolicy {
  const rules: ToolPermission[] = [];
  const lines = content.split("\n");

  let i = 0;
  while (i < lines.length) {
    const trimmed = lines[i].trim();

    if (!trimmed.startsWith("|")) {
      i++;
      continue;
    }

    const nextLine = i + 1 < lines.length ? lines[i + 1].trim() : "";
    if (!isSeparatorLine(nextLine)) {
      i++;
      continue;
    }

    // 跳过表头和分隔行
    i += 2;

    while (i < lines.length) {
      const dataLine = lines[i].trim();
      if (!dataLine.startsWith("|")) break;
      if (isSeparatorLine(dataLine)) break;

      const cells = parseTableRow(dataLine);
      if (cells.length >= 2) {
        const pattern = cells[0];
        const level = normalizeLevel(cells[1]);
        if (level) {
          rules.push({ pattern, level });
        }
      }
      i++;
    }
  }

  return { defaultLevel, rules };
}

export function parsePermissionsJson(content: string, defaultLevel: PermissionLevel): PermissionPolicy {
  const data = JSON.parse(content);

  const rules: ToolPermission[] = [];
  if (Array.isArray(data.rules)) {
    for (const rule of data.rules) {
      const level = normalizeLevel(rule.level);
      if (rule.pattern && level) {
        rules.push({ pattern: rule.pattern, level });
      }
    }
  }

  const parsedDefault = normalizeLevel(data.defaultLevel);
  return {
    defaultLevel: parsedDefault ?? defaultLevel,
    rules,
  };
}
