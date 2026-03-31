/**
 * LLM 可调用的任务调度工具
 * task_create, task_list, task_cancel
 */

import type { ToolDefinition, ToolContext } from "./registry.js";
import type { TaskScheduler } from "../scheduler/TaskScheduler.js";

export function createSchedulerTools(scheduler: TaskScheduler): ToolDefinition[] {
  return [
    {
      name: "task_create",
      description: "Create a scheduled task for future execution. The task prompt will be injected as a user message when the task runs.",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string", description: "Short task name" },
          description: { type: "string", description: "What the task does" },
          prompt: { type: "string", description: "The instruction to execute when the task runs" },
          priority: { type: "number", description: "Priority 0-7 (0=highest), default 3" },
          recurrence: {
            description: "'once' | { cron: string } | { intervalMs: number }",
            oneOf: [
              { type: "string", enum: ["once"] },
              { type: "object", properties: { cron: { type: "string" } }, required: ["cron"] },
              { type: "object", properties: { intervalMs: { type: "number" } }, required: ["intervalMs"] },
            ],
          },
          nextRunAt: { type: "string", description: "ISO timestamp for first run, null = immediately", nullable: true },
          dependsOn: { type: "array", items: { type: "string" }, description: "Task IDs that must complete first" },
          maxRetries: { type: "number", description: "Max retries on failure, default 3" },
        },
        required: ["name", "description", "prompt"],
      },
      execute: async (input: unknown, _context: ToolContext) => {
        const params = input as {
          name: string;
          description: string;
          prompt: string;
          priority?: number;
          recurrence?: "once" | { cron: string } | { intervalMs: number };
          nextRunAt?: string | null;
          dependsOn?: string[];
          maxRetries?: number;
        };
        const task = scheduler.addTask(params);
        return { taskId: task.taskId, state: task.state, nextRunAt: task.nextRunAt };
      },
    },
    {
      name: "task_list",
      description: "List scheduled tasks, optionally filtered by state",
      inputSchema: {
        type: "object",
        properties: {
          state: { type: "string", enum: ["pending", "running", "completed", "failed", "cancelled"], description: "Filter by state" },
        },
      },
      execute: async (input: unknown, _context: ToolContext) => {
        const params = input as { state?: string };
        const tasks = scheduler.listTasks(
          params.state ? { state: params.state as "pending" | "running" | "completed" | "failed" | "cancelled" } : undefined,
        );
        return tasks.map((t) => ({
          taskId: t.taskId,
          name: t.name,
          state: t.state,
          priority: t.priority,
          nextRunAt: t.nextRunAt,
          recurrence: t.recurrence,
        }));
      },
    },
    {
      name: "task_cancel",
      description: "Cancel a scheduled task by ID",
      inputSchema: {
        type: "object",
        properties: {
          taskId: { type: "string", description: "The task ID to cancel" },
        },
        required: ["taskId"],
      },
      execute: async (input: unknown, _context: ToolContext) => {
        const params = input as { taskId: string };
        scheduler.cancelTask(params.taskId);
        return { cancelled: true, taskId: params.taskId };
      },
    },
  ];
}
