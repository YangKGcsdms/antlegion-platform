import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { TaskScheduler } from "../../src/scheduler/TaskScheduler.js";
import type { SchedulerConfig } from "../../src/scheduler/types.js";

let tmpDir: string;
let scheduler: TaskScheduler;

const config: SchedulerConfig = {
  enabled: true,
  maxConcurrent: 2,
  tasksDir: "", // will be set in beforeEach
};

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "scheduler-test-"));
  const cfg = { ...config, tasksDir: path.join(tmpDir, "tasks") };
  scheduler = new TaskScheduler(cfg, tmpDir);
  await scheduler.init();
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("TaskScheduler", () => {
  it("should add a task and list it", () => {
    const task = scheduler.addTask({
      name: "test task",
      description: "do something",
      prompt: "Hello, do the thing",
    });

    expect(task.taskId).toBeDefined();
    expect(task.state).toBe("pending");
    expect(task.name).toBe("test task");

    const list = scheduler.listTasks();
    expect(list).toHaveLength(1);
  });

  it("should return ready tasks sorted by priority", () => {
    scheduler.addTask({ name: "low", description: "", prompt: "p", priority: 5 });
    scheduler.addTask({ name: "high", description: "", prompt: "p", priority: 1 });
    scheduler.addTask({ name: "critical", description: "", prompt: "p", priority: 0 });

    const ready = scheduler.getReadyTasks();
    expect(ready).toHaveLength(2); // maxConcurrent = 2
    expect(ready[0].name).toBe("critical");
    expect(ready[1].name).toBe("high");
  });

  it("should respect maxConcurrent", () => {
    scheduler.addTask({ name: "a", description: "", prompt: "p" });
    scheduler.addTask({ name: "b", description: "", prompt: "p" });
    scheduler.addTask({ name: "c", description: "", prompt: "p" });

    const ready = scheduler.getReadyTasks();
    expect(ready).toHaveLength(2); // maxConcurrent = 2
  });

  it("should transition states: pending → running → completed", () => {
    const task = scheduler.addTask({ name: "t", description: "", prompt: "p" });
    expect(task.state).toBe("pending");

    scheduler.markRunning(task.taskId);
    expect(scheduler.getTask(task.taskId)!.state).toBe("running");

    scheduler.markCompleted(task.taskId);
    expect(scheduler.getTask(task.taskId)!.state).toBe("completed");
  });

  it("should handle failure with retries", () => {
    const task = scheduler.addTask({
      name: "flaky",
      description: "",
      prompt: "p",
      maxRetries: 2,
    });

    scheduler.markRunning(task.taskId);
    scheduler.markFailed(task.taskId, "timeout");

    const t = scheduler.getTask(task.taskId)!;
    expect(t.state).toBe("pending"); // retry
    expect(t.retriesLeft).toBe(1);
    expect(t.nextRunAt).not.toBeNull(); // backoff delay
  });

  it("should mark failed after retries exhausted", () => {
    const task = scheduler.addTask({
      name: "broken",
      description: "",
      prompt: "p",
      maxRetries: 1,
    });

    scheduler.markRunning(task.taskId);
    scheduler.markFailed(task.taskId, "err1");
    // retriesLeft = 0, back to pending with backoff

    scheduler.markRunning(task.taskId);
    scheduler.markFailed(task.taskId, "err2");

    const t = scheduler.getTask(task.taskId)!;
    expect(t.state).toBe("failed");
  });

  it("should cancel a task", () => {
    const task = scheduler.addTask({ name: "cancel me", description: "", prompt: "p" });
    scheduler.cancelTask(task.taskId);
    expect(scheduler.getTask(task.taskId)!.state).toBe("cancelled");
  });

  it("should not return cancelled tasks as ready", () => {
    const task = scheduler.addTask({ name: "t", description: "", prompt: "p" });
    scheduler.cancelTask(task.taskId);

    const ready = scheduler.getReadyTasks();
    expect(ready).toHaveLength(0);
  });

  it("should filter tasks by state", () => {
    scheduler.addTask({ name: "a", description: "", prompt: "p" });
    const b = scheduler.addTask({ name: "b", description: "", prompt: "p" });
    scheduler.markRunning(b.taskId);
    scheduler.markCompleted(b.taskId);

    expect(scheduler.listTasks({ state: "pending" })).toHaveLength(1);
    expect(scheduler.listTasks({ state: "completed" })).toHaveLength(1);
  });

  it("should respect task dependencies", () => {
    const dep = scheduler.addTask({ name: "dep", description: "", prompt: "p" });
    scheduler.addTask({
      name: "child",
      description: "",
      prompt: "p",
      dependsOn: [dep.taskId],
    });

    // child should not be ready because dep is still pending
    const ready = scheduler.getReadyTasks();
    expect(ready).toHaveLength(1);
    expect(ready[0].name).toBe("dep");

    // complete the dependency
    scheduler.markRunning(dep.taskId);
    scheduler.markCompleted(dep.taskId);

    const ready2 = scheduler.getReadyTasks();
    expect(ready2).toHaveLength(1);
    expect(ready2[0].name).toBe("child");
  });

  it("should not return future-scheduled tasks as ready", () => {
    scheduler.addTask({
      name: "future",
      description: "",
      prompt: "p",
      nextRunAt: new Date(Date.now() + 3600_000).toISOString(),
    });

    expect(scheduler.getReadyTasks()).toHaveLength(0);
  });

  it("should reschedule recurring interval tasks on completion", () => {
    const task = scheduler.addTask({
      name: "recurring",
      description: "",
      prompt: "p",
      recurrence: { intervalMs: 60_000 },
    });

    scheduler.markRunning(task.taskId);
    scheduler.markCompleted(task.taskId);

    const t = scheduler.getTask(task.taskId)!;
    expect(t.state).toBe("pending"); // rescheduled
    expect(t.nextRunAt).not.toBeNull();
    expect(t.lastRunAt).not.toBeNull();
  });

  it("should persist and reload tasks from disk", async () => {
    scheduler.addTask({ name: "persist-test", description: "", prompt: "hello" });

    // create a new scheduler instance pointing to same directory
    const cfg = { ...config, tasksDir: path.join(tmpDir, "tasks") };
    const scheduler2 = new TaskScheduler(cfg, tmpDir);
    await scheduler2.init();

    const list = scheduler2.listTasks();
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe("persist-test");
  });

  it("should reset running tasks to pending on init (crash recovery)", async () => {
    const task = scheduler.addTask({ name: "was-running", description: "", prompt: "p" });
    scheduler.markRunning(task.taskId);

    // simulate restart
    const cfg = { ...config, tasksDir: path.join(tmpDir, "tasks") };
    const scheduler2 = new TaskScheduler(cfg, tmpDir);
    await scheduler2.init();

    expect(scheduler2.getTask(task.taskId)!.state).toBe("pending");
  });

  it("should throw on unknown taskId", () => {
    expect(() => scheduler.markRunning("nonexistent")).toThrow("task not found");
  });
});
