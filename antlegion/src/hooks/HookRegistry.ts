/**
 * HookRegistry — 生命周期钩子注册表
 * 插件通过 api.onHook() 注册处理函数
 * Runtime 在各生命周期点 emit 触发
 */

export type HookName =
  | "on_boot"
  | "before_tick"
  | "after_tick"
  | "before_turn"
  | "after_turn"
  | "on_tool_call"
  | "after_tool_call"
  | "on_error"
  | "on_shutdown";

export interface HookContext {
  hookName: HookName;
  agentId: string;
  timestamp: number;
  data: Record<string, unknown>;
}

export type HookHandler = (context: HookContext) => Promise<void>;

export class HookRegistry {
  private handlers = new Map<HookName, HookHandler[]>();

  register(hookName: HookName, handler: HookHandler): void {
    let list = this.handlers.get(hookName);
    if (!list) {
      list = [];
      this.handlers.set(hookName, list);
    }
    list.push(handler);
  }

  async emit(hookName: HookName, context: HookContext): Promise<void> {
    const list = this.handlers.get(hookName);
    if (!list || list.length === 0) return;

    for (const handler of list) {
      try {
        await handler(context);
      } catch (err) {
        // 钩子错误不应该中断主流程，只记录
        process.stderr.write(
          JSON.stringify({
            ts: new Date().toISOString(),
            level: "error",
            component: "hooks",
            msg: "hook handler error",
            data: {
              hookName,
              error: err instanceof Error ? err.message : String(err),
            },
          }) + "\n"
        );
      }
    }
  }

  handlerCount(hookName: HookName): number {
    return this.handlers.get(hookName)?.length ?? 0;
  }

  totalHandlers(): number {
    let total = 0;
    for (const list of this.handlers.values()) {
      total += list.length;
    }
    return total;
  }
}
