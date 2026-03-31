/**
 * 策略解析器
 * 支持 Markdown 表格格式和 JSON 格式
 *
 * Markdown 格式:
 * | Tool Pattern   | Level        |
 * |----------------|-------------|
 * | exec           | supervised  |
 * | write_file     | supervised  |
 * | legion_bus_*   | unrestricted|
 * | *              | sandboxed   |
 */

import type { PermissionPolicy, PermissionLevel, ToolPermission } from "./types.js";

const VALID_LEVELS: Set<string> = new Set(["unrestricted", "supervised", "restricted", "sandboxed"]);

function isSeparatorLine(line: string): boolean {
  // |---|---| or |:---:|:---:| etc
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

  // 找到所有 markdown 表格并提取数据行
  let i = 0;
  while (i < lines.length) {
    const trimmed = lines[i].trim();

    // 寻找表头行 (第一个 | 开头的行)
    if (!trimmed.startsWith("|")) {
      i++;
      continue;
    }

    // 检查下一行是否是分隔行
    const nextLine = i + 1 < lines.length ? lines[i + 1].trim() : "";
    if (!isSeparatorLine(nextLine)) {
      i++;
      continue;
    }

    // 跳过表头和分隔行
    i += 2;

    // 读取数据行
    while (i < lines.length) {
      const dataLine = lines[i].trim();
      if (!dataLine.startsWith("|")) break;
      if (isSeparatorLine(dataLine)) break;

      const cells = parseTableRow(dataLine);
      if (cells.length >= 2) {
        const pattern = cells[0];
        const level = cells[1].toLowerCase();
        if (VALID_LEVELS.has(level)) {
          rules.push({ pattern, level: level as PermissionLevel });
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
      if (rule.pattern && VALID_LEVELS.has(rule.level)) {
        rules.push({ pattern: rule.pattern, level: rule.level });
      }
    }
  }

  return {
    defaultLevel: VALID_LEVELS.has(data.defaultLevel) ? data.defaultLevel : defaultLevel,
    rules,
  };
}
