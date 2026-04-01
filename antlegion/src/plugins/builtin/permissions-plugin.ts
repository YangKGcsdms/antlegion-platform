/**
 * Builtin Plugin: Permissions
 *
 * 简化为 allow/deny 模型。
 * 工具要么允许使用，要么拒绝——无中间态。
 */

import type { AntPlugin } from "../types.js";
import { PermissionManager } from "../../permissions/PermissionManager.js";

export const permissionsPlugin: AntPlugin = {
  name: "builtin:permissions",

  async setup(api) {
    const config = api.getConfig().permissions;
    if (!config?.enabled) return;

    const pm = new PermissionManager(
      {
        enabled: true,
        policyFile: config.policyFile ?? "PERMISSIONS.md",
        defaultLevel: (config.defaultLevel as "allow" | "deny") ?? "allow",
      },
      api.getConfig().workspace,
    );

    api.addToolMiddleware(async (next, name, input, ctx) => {
      if (!pm.isAllowed(name)) {
        throw new Error(`tool "${name}" is denied by permission policy`);
      }
      return next(name, input, ctx);
    });

    api.log.info("permissions plugin ready", {
      rules: pm.ruleCount,
      defaultLevel: (config.defaultLevel as string) ?? "allow",
    });
  },
};
