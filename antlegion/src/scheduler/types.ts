/**
 * 任务调度器类型
 */

export type TaskState = "pending" | "running" | "completed" | "failed" | "cancelled";

export type TaskRecurrence =
  | "once"
  | { cron: string }
  | { intervalMs: number };

export interface TaskDefinition {
  taskId: string;
  name: string;
  description: string;
  /** 注入给 agent 的任务提示词 */
  prompt: string;
  priority: number; // 0-7, 0 = 最高
  state: TaskState;
  recurrence: TaskRecurrence;
  /** 下次执行时间 (ISO), null = 立即执行 */
  nextRunAt: string | null;
  lastRunAt: string | null;
  /** 前置依赖任务 ID */
  dependsOn: string[];
  retriesLeft: number;
  maxRetries: number;
  createdAt: string;
  updatedAt: string;
  metadata: Record<string, unknown>;
}

export interface SchedulerConfig {
  enabled: boolean;
  maxConcurrent: number;
  tasksDir: string;
}

export const DEFAULT_SCHEDULER_CONFIG: SchedulerConfig = {
  enabled: false,
  maxConcurrent: 1,
  tasksDir: ".antlegion/tasks",
};
