/**
 * TaskScheduler — 主动任务引擎
 * 优先级队列 + JSON 文件持久化
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { nextCronMatch } from "./cron.js";
import type { TaskDefinition, TaskState, TaskRecurrence, SchedulerConfig } from "./types.js";

export class TaskScheduler {
  private tasks = new Map<string, TaskDefinition>();
  private tasksDir: string;
  private runningCount = 0;

  constructor(
    private config: SchedulerConfig,
    workspaceDir: string,
  ) {
    this.tasksDir = path.isAbsolute(config.tasksDir)
      ? config.tasksDir
      : path.join(workspaceDir, config.tasksDir);
  }

  async init(): Promise<void> {
    fs.mkdirSync(this.tasksDir, { recursive: true });

    const files = fs.readdirSync(this.tasksDir).filter((f) => f.endsWith(".json"));
    for (const file of files) {
      try {
        const raw = fs.readFileSync(path.join(this.tasksDir, file), "utf-8");
        const task: TaskDefinition = JSON.parse(raw);
        // 重启后 running 状态重置为 pending
        if (task.state === "running") {
          task.state = "pending";
          this.persist(task);
        }
        this.tasks.set(task.taskId, task);
      } catch {
        // 跳过损坏文件
      }
    }
  }

  /** 获取已就绪的任务（按 priority 排序），受 maxConcurrent 限制 */
  getReadyTasks(): TaskDefinition[] {
    const now = new Date().toISOString();
    const available = this.config.maxConcurrent - this.runningCount;
    if (available <= 0) return [];

    const ready: TaskDefinition[] = [];

    for (const task of this.tasks.values()) {
      if (task.state !== "pending") continue;
      if (task.nextRunAt && task.nextRunAt > now) continue;
      if (!this.dependenciesMet(task)) continue;
      ready.push(task);
    }

    // priority 升序 (0 = 最高), 同 priority 按 createdAt 先进先出
    ready.sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      return a.createdAt < b.createdAt ? -1 : 1;
    });

    return ready.slice(0, available);
  }

  markRunning(taskId: string): void {
    const task = this.mustGet(taskId);
    task.state = "running";
    task.updatedAt = new Date().toISOString();
    this.runningCount++;
    this.persist(task);
  }

  markCompleted(taskId: string): void {
    const task = this.mustGet(taskId);
    task.state = "completed";
    task.lastRunAt = new Date().toISOString();
    task.updatedAt = task.lastRunAt;
    this.runningCount = Math.max(0, this.runningCount - 1);

    // 周期任务：重置为 pending + 计算下次运行时间
    if (task.recurrence !== "once") {
      task.state = "pending";
      task.retriesLeft = task.maxRetries;
      task.nextRunAt = this.computeNextRun(task.recurrence);
    }

    this.persist(task);
  }

  markFailed(taskId: string, error: string): void {
    const task = this.mustGet(taskId);
    task.updatedAt = new Date().toISOString();
    this.runningCount = Math.max(0, this.runningCount - 1);

    if (task.retriesLeft > 0) {
      task.retriesLeft--;
      task.state = "pending";
      // 指数退避: 1s * 2^(maxRetries - retriesLeft)
      const attempt = task.maxRetries - task.retriesLeft;
      const delayMs = 1000 * Math.pow(2, attempt);
      task.nextRunAt = new Date(Date.now() + delayMs).toISOString();
    } else {
      task.state = "failed";
      task.metadata._lastError = error;
    }

    this.persist(task);
  }

  addTask(input: {
    name: string;
    description: string;
    prompt: string;
    priority?: number;
    recurrence?: TaskRecurrence;
    nextRunAt?: string | null;
    dependsOn?: string[];
    maxRetries?: number;
    metadata?: Record<string, unknown>;
  }): TaskDefinition {
    const now = new Date().toISOString();
    const task: TaskDefinition = {
      taskId: crypto.randomUUID(),
      name: input.name,
      description: input.description,
      prompt: input.prompt,
      priority: input.priority ?? 3,
      state: "pending",
      recurrence: input.recurrence ?? "once",
      nextRunAt: input.nextRunAt ?? null,
      lastRunAt: null,
      dependsOn: input.dependsOn ?? [],
      retriesLeft: input.maxRetries ?? 3,
      maxRetries: input.maxRetries ?? 3,
      createdAt: now,
      updatedAt: now,
      metadata: input.metadata ?? {},
    };

    this.tasks.set(task.taskId, task);
    this.persist(task);
    return task;
  }

  cancelTask(taskId: string): void {
    const task = this.mustGet(taskId);
    if (task.state === "running") {
      this.runningCount = Math.max(0, this.runningCount - 1);
    }
    task.state = "cancelled";
    task.updatedAt = new Date().toISOString();
    this.persist(task);
  }

  listTasks(filter?: { state?: TaskState }): TaskDefinition[] {
    const all = Array.from(this.tasks.values());
    if (!filter?.state) return all;
    return all.filter((t) => t.state === filter.state);
  }

  getTask(taskId: string): TaskDefinition | undefined {
    return this.tasks.get(taskId);
  }

  // ──── private ────

  private mustGet(taskId: string): TaskDefinition {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`task not found: ${taskId}`);
    return task;
  }

  private dependenciesMet(task: TaskDefinition): boolean {
    for (const depId of task.dependsOn) {
      const dep = this.tasks.get(depId);
      if (!dep || dep.state !== "completed") return false;
    }
    return true;
  }

  private computeNextRun(recurrence: TaskRecurrence): string {
    if (recurrence === "once") return new Date().toISOString();

    if ("intervalMs" in recurrence) {
      return new Date(Date.now() + recurrence.intervalMs).toISOString();
    }

    if ("cron" in recurrence) {
      return nextCronMatch(recurrence.cron, new Date()).toISOString();
    }

    return new Date().toISOString();
  }

  private persist(task: TaskDefinition): void {
    const filePath = path.join(this.tasksDir, `${task.taskId}.json`);
    fs.writeFileSync(filePath, JSON.stringify(task, null, 2));
  }
}
