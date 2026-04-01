/**
 * 权限管理类型 — 简化为 allow/deny 模型
 *
 * antlegion agent 自主运行，无人类审批环节，
 * 只需要简单的工具白名单/黑名单控制。
 */

export type PermissionLevel = "allow" | "deny";

export interface ToolPermission {
  /** 精确工具名或通配 pattern (例: "exec", "legion_bus_*", "*") */
  pattern: string;
  level: PermissionLevel;
}

export interface PermissionPolicy {
  defaultLevel: PermissionLevel;
  rules: ToolPermission[];
}

export interface PermissionConfig {
  enabled: boolean;
  /** 策略文件路径 (相对 workspace), 支持 .json 或 .md */
  policyFile: string;
  defaultLevel: PermissionLevel;
}

export const DEFAULT_PERMISSION_CONFIG: PermissionConfig = {
  enabled: false,
  policyFile: "PERMISSIONS.md",
  defaultLevel: "allow",
};
