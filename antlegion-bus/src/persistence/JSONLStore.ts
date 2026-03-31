/**
 * Append-only JSONL fact store.
 * Mirrors Python: JSONLFactStore.
 *
 * Provides:
 * - Durability: facts persisted to disk immediately (fsync)
 * - Recoverability: full state reconstructed from log replay
 * - Observability: human-readable, grep-able log
 * - Simplicity: no external dependencies
 */

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
  fsyncSync,
  closeSync,
} from "node:fs";
import { join, dirname } from "node:path";
import type { Fact, JournalEventType } from "../types/protocol.js";

export interface JournalEntry {
  fact: Fact;
  event: JournalEventType;
  timestamp: number;
  metadata: Record<string, unknown>;
}

export class JSONLStore {
  readonly dataDir: string;
  readonly factLogPath: string;

  constructor(dataDir = ".data") {
    this.dataDir = dataDir;
    mkdirSync(dataDir, { recursive: true });
    this.factLogPath = join(dataDir, "facts.jsonl");
  }

  /** Append a fact entry to the log (atomic append with fsync). */
  append(
    fact: Fact,
    event: JournalEventType = "publish",
    metadata: Record<string, unknown> = {},
  ): void {
    const entry = {
      fact,
      event,
      timestamp: Date.now() / 1000,
      metadata,
    };
    const line = JSON.stringify(entry) + "\n";
    const fd = openSync(this.factLogPath, "a");
    try {
      appendFileSync(fd, line, "utf-8");
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  }

  /**
   * Read all entries from the log.
   * Used for state recovery on startup.
   * Skips corrupted lines silently.
   */
  readAll(): JournalEntry[] {
    if (!existsSync(this.factLogPath)) return [];

    const content = readFileSync(this.factLogPath, "utf-8");
    const entries: JournalEntry[] = [];

    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const raw = JSON.parse(trimmed);
        entries.push({
          fact: raw.fact as Fact,
          event: raw.event ?? "publish",
          timestamp: raw.timestamp ?? 0,
          metadata: raw.metadata ?? {},
        });
      } catch {
        // Skip corrupted lines
      }
    }

    return entries;
  }

  /**
   * Compact the log: keep only entries for facts still in memory.
   * Writes to a temp file, then atomically replaces the original.
   * Returns the number of stale entries removed.
   */
  compact(liveFacts: Map<string, Fact>): number {
    if (!existsSync(this.factLogPath)) return 0;

    const liveIds = new Set(liveFacts.keys());
    const tmpPath = this.factLogPath + ".tmp";
    const content = readFileSync(this.factLogPath, "utf-8");
    const lines = content.split("\n");

    let kept = 0;
    let total = 0;
    const keptLines: string[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      total++;
      try {
        const entry = JSON.parse(trimmed);
        const factId = entry?.fact?.fact_id;
        if (factId && liveIds.has(factId)) {
          keptLines.push(JSON.stringify(entry));
          kept++;
        }
      } catch {
        // skip corrupted
      }
    }

    writeFileSync(tmpPath, keptLines.join("\n") + (keptLines.length > 0 ? "\n" : ""), "utf-8");
    renameSync(tmpPath, this.factLogPath);

    return total - kept;
  }

  /** Return store statistics. */
  getStats(): {
    totalEntries: number;
    dataDir: string;
    logFile: string;
    logSizeBytes: number;
  } {
    let totalEntries = 0;
    let logSizeBytes = 0;

    if (existsSync(this.factLogPath)) {
      const content = readFileSync(this.factLogPath, "utf-8");
      totalEntries = content.split("\n").filter((l) => l.trim()).length;
      logSizeBytes = statSync(this.factLogPath).size;
    }

    return {
      totalEntries,
      dataDir: this.dataDir,
      logFile: this.factLogPath,
      logSizeBytes,
    };
  }
}
