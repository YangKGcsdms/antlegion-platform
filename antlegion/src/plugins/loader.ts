/**
 * External Plugin 加载器
 * 加载顺序：workspace/plugins/ → config roots → ~/.antlegion/plugins/
 *
 * 注：builtin plugins 由 Bootstrapper 直接加载，不经过这里。
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { AntPlugin } from "./types.js";
import type { ToolDefinition, ToolContext } from "../tools/registry.js";
import type { ToolRegistry } from "../tools/registry.js";
import type { LegionBusChannel } from "../channel/FactBusChannel.js";
import type { AntLegionConfig } from "../config/types.js";
import type { HookRegistry } from "../hooks/HookRegistry.js";
import type { Logger } from "../observability/Logger.js";

interface PluginManifest {
  name: string;
  version: string;
  entry: string;
  tools?: string[];
  hooks?: string[];
}

/**
 * 加载外部插件。
 *
 * 外部插件使用与 builtin plugins 相同的 PluginApi 接口，
 * 但这里构建一个简化版（不支持 wrapProvider/addPromptSection 等高级功能，
 * 因为 provider 和 prompt 在外部插件加载前已经构建完毕）。
 *
 * 外部插件主要用于注册自定义工具和 hooks。
 */
export async function loadPlugins(
  config: AntLegionConfig,
  toolRegistry: ToolRegistry,
  channel: LegionBusChannel,
  hookRegistry: HookRegistry,
  logger?: Logger,
): Promise<void> {
  const roots = collectPluginRoots(config);
  let loaded = 0;

  for (const root of roots) {
    if (!fs.existsSync(root)) continue;

    const entries = fs.readdirSync(root, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const manifestPath = path.join(root, entry.name, "manifest.json");
      if (!fs.existsSync(manifestPath)) continue;

      try {
        const manifest: PluginManifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
        const entryPath = path.resolve(root, entry.name, manifest.entry);

        const mod = await import(entryPath);
        const plugin: AntPlugin = mod.default ?? mod;

        if (typeof plugin.setup !== "function") {
          const msg = `${manifest.name}: no setup() export, skipped`;
          logger ? logger.warn(msg) : console.warn(`[plugins] ${msg}`);
          continue;
        }

        // 简化版 PluginApi（外部插件使用）
        const api = {
          registerTool: (tool: ToolDefinition) => toolRegistry.register(tool),
          onHook: (name: Parameters<typeof hookRegistry.register>[0], handler: Parameters<typeof hookRegistry.register>[1]) => {
            hookRegistry.register(name, handler);
          },
          getChannel: () => channel,
          getConfig: () => config,
          log: logger ?? (console as any),

          // 外部插件不支持这些高级功能（已在 bootstrap 阶段完成）
          wrapProvider: () => {
            throw new Error("wrapProvider is only available for builtin plugins");
          },
          addPromptSection: () => {
            throw new Error("addPromptSection is only available for builtin plugins");
          },
          addToolMiddleware: (mw: any) => toolRegistry.addMiddleware(mw),
          onTick: () => {
            throw new Error("onTick is only available for builtin plugins");
          },
          extendToolContext: () => {
            throw new Error("extendToolContext is only available for builtin plugins");
          },
          getSession: () => {
            throw new Error("getSession is only available for builtin plugins");
          },
          getRunner: () => {
            throw new Error("getRunner is only available for builtin plugins");
          },
        };

        await plugin.setup(api as any);
        loaded++;
        const msg = `loaded: ${manifest.name}@${manifest.version}`;
        logger ? logger.info(msg) : console.log(`[plugins] ${msg}`);
      } catch (err) {
        const msg = `failed to load ${entry.name}: ${err instanceof Error ? err.message : err}`;
        logger ? logger.error(msg) : console.error(`[plugins] ${msg}`);
      }
    }
  }

  if (loaded > 0) {
    const msg = `${loaded} external plugin(s) loaded`;
    logger ? logger.info(msg) : console.log(`[plugins] ${msg}`);
  }
}

function collectPluginRoots(config: AntLegionConfig): string[] {
  const roots: string[] = [];

  // workspace/plugins/
  roots.push(path.join(config.workspace, "plugins"));

  // config-specified roots
  if (config.plugins?.roots) {
    for (const r of config.plugins.roots) {
      roots.push(path.resolve(r));
    }
  }

  // global ~/.antlegion/plugins/
  roots.push(path.join(os.homedir(), ".antlegion", "plugins"));

  return roots;
}
