/**
 * Builtin Plugin: Task Scheduler
 *
 * 提供：
 * - 3 个调度工具（task_create/list/cancel）
 * - tick 级任务检查和注入
 * - 任务完成/失败状态追踪（通过 TickAction.metadata.taskId 精确匹配）
 */

import type { AntPlugin, TickContext } from "../types.js";
import { TaskScheduler } from "../../scheduler/TaskScheduler.js";
import { DEFAULT_SCHEDULER_CONFIG } from "../../config/types.js";
import { createSchedulerTools } from "../../tools/scheduler.js";

export const schedulerPlugin: AntPlugin = {
  name: "builtin:scheduler",

  async setup(api) {
    const config = api.getConfig().scheduler;
    if (!config?.enabled) return;

    const scheduler = new TaskScheduler(
      { ...DEFAULT_SCHEDULER_CONFIG, ...config },
      api.getConfig().workspace,
    );
    await scheduler.init();

    // 注册调度工具
    for (const tool of createSchedulerTools(scheduler)) {
      api.registerTool(tool);
    }

    // tick 级任务检查：返回 inject_message + metadata.taskId
    api.onTick({
      priority: 10,
      handle: async (_ctx: TickContext) => {
        const readyTasks = scheduler.getReadyTasks();
        if (readyTasks.length === 0) return null;

        const task = readyTasks[0];
        scheduler.markRunning(task.taskId);

        return {
          type: "inject_message" as const,
          message: `## Scheduled Task: ${task.name}\n\n${task.prompt}`,
          metadata: {
            taskId: task.taskId,
            taskName: task.name,
          },
        };
      },
    });

    // 精确标记任务完成（通过 hook context 中的 taskId）
    api.onHook("after_turn", async (ctx) => {
      const taskId = ctx.data.taskId as string | undefined;
      if (!taskId || !ctx.data.tickAction) return;

      scheduler.markCompleted(taskId);
      api.log.info("scheduled task completed", {
        taskId,
        name: ctx.data.taskName,
      });
    });

    // 精确标记任务失败
    api.onHook("on_error", async (ctx) => {
      const taskId = ctx.data.taskId as string | undefined;
      if (!taskId) {
        // 非 scheduler 触发的错误：检查是否有 running 任务需要释放
        const running = scheduler.listTasks({ state: "running" });
        for (const task of running) {
          scheduler.markFailed(task.taskId, String(ctx.data.error));
          api.log.warn("scheduled task failed (unmatched error)", {
            taskId: task.taskId,
            error: ctx.data.error,
          });
        }
        return;
      }

      scheduler.markFailed(taskId, String(ctx.data.error));
      api.log.info("scheduled task failed", {
        taskId,
        error: ctx.data.error,
      });
    });

    api.log.info("scheduler plugin ready", {
      maxConcurrent: config.maxConcurrent ?? 1,
      pendingTasks: scheduler.listTasks({ state: "pending" }).length,
    });
  },
};
