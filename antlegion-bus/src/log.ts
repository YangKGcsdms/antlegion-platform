/**
 * Append-only log (PROTOCOL.md §7) — the AOF of AntLegion.
 *
 * fsync policy mirrors Redis `appendfsync`:
 *   always   — fsync after every append (max durability, slowest)
 *   everysec — fsync at most once a second on a timer (≤1s loss on crash)
 *   no       — never fsync explicitly; flush on close, OS decides otherwise
 *
 * A single append-mode fd is kept open (so we don't pay open/close per write).
 * Compaction (the BGREWRITEAOF analog) writes a temp file, fsyncs it, renames
 * atomically and fsyncs the directory; the held fd is flushed + closed first and
 * reopened lazily, so we never keep writing into the unlinked pre-rewrite inode.
 */

import {
  appendFileSync, existsSync, mkdirSync, openSync, readFileSync,
  renameSync, statSync, writeFileSync, fsyncSync, closeSync, truncateSync,
} from "node:fs";
import { join } from "node:path";
import type { Fact } from "./types.js";

export type FsyncPolicy = "always" | "everysec" | "no";

/**
 * An interior record that does not parse (§7.1). Unlike a torn tail this is not
 * repairable by truncation: skipping it would remove a fact other readers have
 * already folded, permanently forking their view. The bus MUST NOT start.
 */
export class LogCorrupt extends Error {
  constructor(readonly offset: number, cause?: string) {
    super(`corrupt record at byte offset ${offset}${cause ? `: ${cause}` : ""} — ` +
      `interior corruption requires explicit repair; the bus will not start`);
    this.name = "LogCorrupt";
  }
}

/**
 * The log's own parameters, stored beside the journal. §8.4 makes Δ a property
 * of the log; this is where the log keeps it.
 */
export interface LogMeta {
  protocol: string;
  claim_timeout: number;
}

export interface RecoveryReport {
  facts: Fact[];
  /** Byte offset the torn tail was truncated at, if any (§7.1). */
  truncatedAt: number | null;
  /** A trailing record that parsed but had lost its newline; repaired in place. */
  repairedTail: boolean;
}

export class JsonlLog {
  readonly path: string;
  readonly metaPath: string;
  readonly dataDir: string;
  readonly fsyncPolicy: FsyncPolicy;
  private fd: number | null = null;
  private dirty = false;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(dataDir = ".data-v2", fsyncPolicy: FsyncPolicy = "always") {
    mkdirSync(dataDir, { recursive: true });
    this.dataDir = dataDir;
    this.path = join(dataDir, "facts-v2.jsonl");
    this.metaPath = join(dataDir, "log-meta.json");
    this.fsyncPolicy = fsyncPolicy;
    if (fsyncPolicy === "everysec") {
      this.timer = setInterval(() => this.flush(), 1000);
      this.timer.unref?.(); // don't keep the process (or tests) alive
    }
  }

  private ensureFd(): number {
    if (this.fd === null) this.fd = openSync(this.path, "a");
    return this.fd;
  }

  /** fsync if there are unflushed writes. */
  flush(): void {
    if (this.dirty && this.fd !== null) {
      fsyncSync(this.fd);
      this.dirty = false;
    }
  }

  append(fact: Fact): void {
    const fd = this.ensureFd();
    appendFileSync(fd, JSON.stringify(fact) + "\n", "utf-8");
    if (this.fsyncPolicy === "always") fsyncSync(fd);
    else this.dirty = true; // flushed by timer (everysec) or on close (no/everysec)
  }

  /**
   * Recover the log (§7.1). Records are read in order with byte offsets held,
   * because the response to damage depends on *where* it is:
   *
   * - A **torn final record** is truncated away, to the last offset that parses.
   *   Merely skipping the fragment is not enough: the next append is
   *   concatenated onto it, the combined line never parses again, and an
   *   acknowledged fact is lost on the following restart while its `seq` has
   *   been handed to different content. That breaks the total order all of §3
   *   rests on.
   * - A **trailing record that parses but lost its newline** is repaired by
   *   writing the newline, not by truncation — it is a whole fact and nothing
   *   needs to be lost to make the file appendable again.
   * - An **interior corrupt record** throws `LogCorrupt`. It is not ours to
   *   silently drop.
   */
  recover(): RecoveryReport {
    if (!existsSync(this.path)) return { facts: [], truncatedAt: null, repairedTail: false };

    const buf = readFileSync(this.path);
    const facts: Fact[] = [];
    let offset = 0;
    let truncatedAt: number | null = null;
    let repairedTail = false;

    while (offset < buf.length) {
      const nl = buf.indexOf(0x0a, offset);
      const isFinal = nl === -1;               // no newline ⇒ the write was cut short
      const end = isFinal ? buf.length : nl;
      const text = buf.subarray(offset, end).toString("utf-8").trim();

      if (text) {
        let parsed: Fact | null = null;
        try {
          parsed = JSON.parse(text) as Fact;
        } catch (err) {
          if (!isFinal) throw new LogCorrupt(offset, err instanceof Error ? err.message : undefined);
          truncateSync(this.path, offset);      // torn tail: drop it, keep the file appendable
          truncatedAt = offset;
          break;
        }
        facts.push(parsed);
        if (isFinal) {
          appendFileSync(this.path, "\n", "utf-8"); // whole fact, missing terminator
          repairedTail = true;
        }
      }

      if (isFinal) break;
      offset = nl + 1;
    }

    return { facts, truncatedAt, repairedTail };
  }

  /**
   * The log's own parameters (§8.4, §B). Δ is specified as "a property of the
   * log, not of the reader", and every §8.4 fold is a function of (prefix, Δ) —
   * so a Δ that lives only in the bus process's environment makes that sentence
   * false the moment the process restarts with a different one. Every claim
   * ever made on the log is then re-interpreted, and `resolved`, which §9.3
   * proves absorbing, can fold back to `open`.
   *
   * Writing it beside the journal makes the spec's wording literally true: Δ
   * travels with the log, survives a restart, and can be copied to a replica.
   */
  readMeta(): LogMeta | null {
    if (!existsSync(this.metaPath)) return null;
    try {
      const raw = JSON.parse(readFileSync(this.metaPath, "utf-8")) as Partial<LogMeta>;
      const delta = raw.claim_timeout;
      if (typeof delta !== "number" || !Number.isFinite(delta) || delta <= 0) return null;
      return { protocol: String(raw.protocol ?? "3.0"), claim_timeout: delta };
    } catch {
      // An unreadable meta file must not brick the bus; it is re-pinned below.
      return null;
    }
  }

  /** Persist the log's parameters durably: temp → fsync → rename → fsync dir. */
  writeMeta(meta: LogMeta): void {
    const tmp = this.metaPath + ".tmp";
    writeFileSync(tmp, JSON.stringify(meta) + "\n", "utf-8");
    const fd = openSync(tmp, "r+");
    try { fsyncSync(fd); } finally { closeSync(fd); }
    renameSync(tmp, this.metaPath);
    const dirFd = openSync(this.dataDir, "r");
    try { fsyncSync(dirFd); } catch { /* not fsyncable on every platform */ } finally { closeSync(dirFd); }
  }

  /**
   * Compaction (§7.2): rewrite the log keeping every skeleton, stripping the
   * payloads of `payloadDroppable` ids and marking each stripped fact so a
   * reader can tell "unverifiable" from "tampered" — a compacted fact no longer
   * hashes to its own `id`, and §7.2 forbids reporting that as an integrity
   * failure.
   *
   * Durability per §7.2: temp file → fsync → atomic rename → fsync the
   * directory. The live fd is flushed and closed first, then dropped, so the
   * next append reopens the NEW file rather than the unlinked inode.
   */
  compact(facts: Fact[], payloadDroppable: Set<string>): number {
    this.flush();
    if (this.fd !== null) { closeSync(this.fd); this.fd = null; }

    const tmp = this.path + ".tmp";
    let stripped = 0;
    const lines = facts.map((f) => {
      if (payloadDroppable.has(f.id) && Object.keys(f.payload).length > 0) {
        stripped++;
        return JSON.stringify({ ...f, payload: {}, compacted: true });
      }
      return JSON.stringify(f);
    });
    writeFileSync(tmp, lines.length ? lines.join("\n") + "\n" : "", "utf-8");

    const tmpFd = openSync(tmp, "r+");
    try { fsyncSync(tmpFd); } finally { closeSync(tmpFd); }
    renameSync(tmp, this.path);
    const dirFd = openSync(this.dataDir, "r");
    try { fsyncSync(dirFd); } catch { /* not fsyncable on every platform */ } finally { closeSync(dirFd); }

    this.dirty = false;
    return stripped;
  }

  /** Flush + close. Call on graceful shutdown. */
  close(): void {
    this.flush();
    if (this.fd !== null) { closeSync(this.fd); this.fd = null; }
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  stats(): { entries: number; bytes: number } {
    if (!existsSync(this.path)) return { entries: 0, bytes: 0 };
    const content = readFileSync(this.path, "utf-8");
    return {
      entries: content.split("\n").filter((l) => l.trim()).length,
      bytes: statSync(this.path).size,
    };
  }
}
