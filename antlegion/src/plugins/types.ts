import type { ToolDefinition } from "../tools/registry.js";
import type { LegionBusChannel } from "../channel/FactBusChannel.js";
import type { AntLegionConfig } from "../config/types.js";
import type { HookName, HookHandler } from "../hooks/HookRegistry.js";

export interface PluginApi {
  registerTool(tool: ToolDefinition): void;
  onHook(name: HookName, handler: HookHandler): void;
  getChannel(): LegionBusChannel;
  getConfig(): AntLegionConfig;
  log: Console;
}

export interface AntPlugin {
  setup(api: PluginApi): Promise<void>;
}
