/**
 * Plugin 加载器
 * 加载顺序：workspace/plugins/ → ~/.antlegion/plugins/ → 内置
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { AntPlugin, PluginApi } from "./types.js";
import type { ToolRegistry } from "../tools/registry.js";
import type { LegionBusChannel } from "../channel/FactBusChannel.js";
import type { AntLegionConfig } from "../config/types.js";
import type { HookRegistry } from "../hooks/HookRegistry.js";

interface PluginManifest {
  name: string;
  version: string;
  entry: string;
  tools?: string[];
  hooks?: string[];
}

export async function loadPlugins(
  config: AntLegionConfig,
  toolRegistry: ToolRegistry,
  channel: LegionBusChannel,
  hookRegistry?: HookRegistry,
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
          console.warn(`[plugins] ${manifest.name}: no setup() export, skipped`);
          continue;
        }

        const api: PluginApi = {
          registerTool: (tool) => toolRegistry.register(tool),
          onHook: (name, handler) => {
            if (hookRegistry) {
              hookRegistry.register(name, handler);
            }
          },
          getChannel: () => channel,
          getConfig: () => config,
          log: console,
        };

        await plugin.setup(api);
        loaded++;
        console.log(`[plugins] loaded: ${manifest.name}@${manifest.version}`);
      } catch (err) {
        console.error(`[plugins] failed to load ${entry.name}:`, err instanceof Error ? err.message : err);
      }
    }
  }

  if (loaded > 0) {
    console.log(`[plugins] ${loaded} plugin(s) loaded`);
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
