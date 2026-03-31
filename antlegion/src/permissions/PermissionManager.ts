/**
 * PermissionManager — 工具执行权限检查
 * 在 ToolRegistry.execute() 中作为前置闸门
 */

import fs from "node:fs";
import path from "node:path";
import type { PermissionLevel, PermissionPolicy, PermissionConfig } from "./types.js";
import { parsePermissionsMarkdown, parsePermissionsJson } from "./PolicyParser.js";

export class PermissionManager {
  private policy: PermissionPolicy;

  constructor(
    private config: PermissionConfig,
    workspaceDir: string,
  ) {
    this.policy = { defaultLevel: config.defaultLevel, rules: [] };

    const filePath = path.isAbsolute(config.policyFile)
      ? config.policyFile
      : path.join(workspaceDir, config.policyFile);

    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, "utf-8");
      if (filePath.endsWith(".json")) {
        this.policy = parsePermissionsJson(content, config.defaultLevel);
      } else {
        this.policy = parsePermissionsMarkdown(content, config.defaultLevel);
      }
    }
  }

  /** 检查工具的权限级别，精确匹配 > 前缀通配 > 全通配 > defaultLevel */
  check(toolName: string): PermissionLevel {
    let exactMatch: PermissionLevel | null = null;
    let prefixMatch: PermissionLevel | null = null;
    let wildcardMatch: PermissionLevel | null = null;

    for (const rule of this.policy.rules) {
      if (rule.pattern === toolName) {
        exactMatch = rule.level;
      } else if (rule.pattern === "*") {
        wildcardMatch = rule.level;
      } else if (rule.pattern.endsWith("*") && toolName.startsWith(rule.pattern.slice(0, -1))) {
        prefixMatch = rule.level;
      }
    }

    return exactMatch ?? prefixMatch ?? wildcardMatch ?? this.policy.defaultLevel;
  }

  get ruleCount(): number {
    return this.policy.rules.length;
  }
}

function matchPattern(pattern: string, toolName: string): boolean {
  if (pattern === "*") return true;
  if (pattern === toolName) return true;

  // 简单通配: "legion_bus_*" 匹配 "legion_bus_publish"
  if (pattern.endsWith("*")) {
    const prefix = pattern.slice(0, -1);
    return toolName.startsWith(prefix);
  }

  return false;
}
