/**
 * PermissionManager — 工具执行权限检查（简化为 allow/deny）
 *
 * antlegion agent 自主运行，不需要 supervised/sandboxed 等交互式权限等级。
 * 只需要判断：这个工具，这个角色能不能用。
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

  /** 检查工具是否允许执行：精确匹配 > 前缀通配 > 全通配 > defaultLevel */
  isAllowed(toolName: string): boolean {
    return this.check(toolName) === "allow";
  }

  /** 返回工具的权限级别 */
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
