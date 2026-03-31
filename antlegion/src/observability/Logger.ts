/**
 * 结构化日志器
 * JSON 输出到 stderr + 可选 JSONL 文件
 */

import fs from "node:fs";
import path from "node:path";
import type { LogLevel, LogEntry } from "./types.js";

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export class Logger {
  private minLevelNum: number;
  private fileStream: fs.WriteStream | null = null;

  constructor(
    private component: string,
    private minLevel: LogLevel = "info",
    logFile?: string | null,
  ) {
    this.minLevelNum = LEVEL_ORDER[minLevel];
    if (logFile) {
      fs.mkdirSync(path.dirname(logFile), { recursive: true });
      this.fileStream = fs.createWriteStream(logFile, { flags: "a" });
    }
  }

  debug(msg: string, data?: Record<string, unknown>): void {
    this.log("debug", msg, data);
  }

  info(msg: string, data?: Record<string, unknown>): void {
    this.log("info", msg, data);
  }

  warn(msg: string, data?: Record<string, unknown>): void {
    this.log("warn", msg, data);
  }

  error(msg: string, data?: Record<string, unknown>): void {
    this.log("error", msg, data);
  }

  child(component: string): Logger {
    const child = new Logger(
      `${this.component}.${component}`,
      this.minLevel,
    );
    child.fileStream = this.fileStream;
    return child;
  }

  flush(): void {
    this.fileStream?.end();
    this.fileStream = null;
  }

  private log(level: LogLevel, msg: string, data?: Record<string, unknown>): void {
    if (LEVEL_ORDER[level] < this.minLevelNum) return;

    const entry: LogEntry = {
      ts: new Date().toISOString(),
      level,
      component: this.component,
      msg,
      ...(data && { data }),
    };

    const line = JSON.stringify(entry);
    process.stderr.write(line + "\n");
    this.fileStream?.write(line + "\n");
  }
}
