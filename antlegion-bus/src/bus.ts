/**
 * The trusted core (PROTOCOL.md §0.6, §2).
 *
 * The bus does four things and nothing else: assign total order (seq), verify
 * content integrity (id), stamp trusted time (recv) + sign, persist, serve a
 * range. No per-fact mutable state, no state machine — meaning is a reader fold
 * (see fold.ts). The only derived indexes are the seq counter and an id→seq
 * dedup index, both pure projections of the log.
 */

import { randomBytes } from "node:crypto";
import { computeId, computeSig, verifySig } from "./hash.js";
import { JsonlLog, type FsyncPolicy } from "./log.js";
import {
  DEFAULT_LIMITS, FactRejected, RESERVED, validateFactInput,
  type AppendResult, type Fact, type FactInput, type Limits,
} from "./types.js";
import { retracted } from "./fold.js";
import { globMatch } from "./canonical.js";

/** §8 default claim timeout Δ, in seconds. A property of the log, not the reader. */
export const DEFAULT_CLAIM_TIMEOUT = 600;

/**
 * Refusing to serve an existing log under a Δ it was not written with (§8.4).
 *
 * Every §8.4 fold is a function of (prefix, Δ). Serving the same journal under
 * a different Δ therefore re-interprets every claim ever made on it, and can
 * turn a `resolved` — which §9.3 proves absorbing over prefixes — back into
 * `open`. That is a silent history rewrite, so it fails loudly instead.
 */
export class ClaimTimeoutConflict extends Error {
  constructor(readonly pinned: number, readonly requested: number, readonly metaPath: string) {
    super(
      `Δ conflict: this log was created with a claim timeout of ${pinned}s, but the bus was ` +
      `started with ${requested}s. Δ is a property of the log (§8.4) — serving the same journal ` +
      `under a different Δ re-folds every claim on it and can un-resolve finished work. ` +
      `Start with ANTLEGION_CLAIM_TIMEOUT=${pinned} (or unset it), use a different ` +
      `ANTLEGION_DATA_DIR for a log with a different Δ, or edit ${metaPath} deliberately.`,
    );
    this.name = "ClaimTimeoutConflict";
  }
}

export interface ReadQuery {
  since?: number;
  limit?: number;
  type?: string;            // glob
  author?: string;
  /** Match a refs key, e.g. { claim_of: "<id>" }. */
  ref?: { key: string; value: string };
}

export class BusV2 {
  private readonly secret: string;
  private readonly secretStable: boolean;
  private readonly log: JsonlLog;
  private readonly maxDepth: number;            // §6.2 causation depth cap
  private readonly limits: Limits;              // §8
  /** Δ — published via /info; every reader MUST fold with this value (§3.4, §8). */
  readonly claimTimeout: number;
  private readonly facts: Fact[] = [];          // ordered by seq, in-memory projection
  private readonly byId = new Map<string, Fact>(); // id → fact (dedup + lookup)
  private seqCounter = 0;
  private dedupHits = 0;
  private sigFailures = 0;                       // §4.2: header signature mismatches
  private idFailures = 0;                        // §7.1: content-address mismatches
  private truncatedAt: number | null = null;     // §7.1: torn tail dropped on recovery
  private readonly startedAt = Date.now();

  constructor(opts?: {
    secret?: string; dataDir?: string; fsync?: FsyncPolicy;
    maxDepth?: number; claimTimeout?: number; limits?: Partial<Limits>;
  }) {
    const providedSecret = opts?.secret ?? process.env.ANTLEGION_BUS_SECRET;
    this.secretStable = providedSecret != null;
    this.secret = providedSecret ?? randomBytes(32).toString("hex");
    this.maxDepth = opts?.maxDepth ?? 64;
    this.limits = { ...DEFAULT_LIMITS, ...opts?.limits };
    this.log = new JsonlLog(opts?.dataDir, opts?.fsync ?? "always");
    this.claimTimeout = this.pinClaimTimeout(opts?.claimTimeout);
    this.recover();
  }

  /**
   * Resolve Δ against the log rather than against the environment (§8.4).
   *
   * - A log that already records a Δ hands it back. Passing a different one is
   *   a {@link ClaimTimeoutConflict}: it would silently re-fold every claim
   *   the log has ever carried.
   * - A log that records none — a fresh data dir, or one written by a bus from
   *   before Δ was pinned — adopts the requested value (or §B's default) and
   *   records it, so the next start is bound by it.
   */
  private pinClaimTimeout(requested?: number): number {
    const meta = this.log.readMeta();
    if (meta) {
      if (requested !== undefined && requested !== meta.claim_timeout) {
        throw new ClaimTimeoutConflict(meta.claim_timeout, requested, this.log.metaPath);
      }
      return meta.claim_timeout;
    }
    const delta = requested ?? DEFAULT_CLAIM_TIMEOUT;
    this.log.writeMeta({ protocol: "3.0", claim_timeout: delta });
    return delta;
  }

  /**
   * §7.1. The log *is* the state; recovery rebuilds only pure projections. Two
   * integrity checks run here and they answer different questions:
   *
   * - `sig` covers the header (id|author|type|ts|recv|seq). A failure means the
   *   header was altered or the log was written under a different secret.
   * - `id` covers the content. §4.2's signature does not, so re-hashing is the
   *   only check that detects on-disk payload tampering. A fact whose payload
   *   compaction dropped is skipped here by design (§7.2): it no longer hashes
   *   to its own id, and reporting that as tampering would be a false alarm.
   *
   * Neither failure rejects the fact — a secret rotation must not brick the bus
   * — but both are counted and surfaced through INFO (§2.5).
   */
  private recover(): void {
    const report = this.log.recover();
    this.truncatedAt = report.truncatedAt;
    for (const f of report.facts) {
      this.facts.push(f);
      this.byId.set(f.id, f);
      // §7.1: seq is restored as the MAXIMUM present, and is never reused —
      // including after the truncation above.
      if (f.seq > this.seqCounter) this.seqCounter = f.seq;
      if (this.secretStable && !verifySig(this.secret, f)) this.sigFailures++;
      if (!f.compacted && computeId(f) !== f.id) this.idFailures++;
    }
  }

  /**
   * §6.2 causation-depth guard. Walks the resolvable `refs.parent` ancestry of a
   * would-be fact and returns its depth (1 = no present parent). This bounds
   * append-time work, not the depth of any trail a reader will fold: a `parent`
   * MAY name a fact that is not present, so a deep chain can always be built
   * leaf-first. Parent *cycles* are unconstructible under content addressing —
   * closing A→B→A needs A's id before A is hashed — but the walk is bounded
   * anyway, because exported and hand-repaired logs exist.
   */
  private depthOf(parentId: string | undefined): number {
    let depth = 1;
    let cur = parentId ? this.byId.get(parentId) : undefined;
    while (cur) {
      depth++;
      if (depth > this.maxDepth) break; // bounded walk; caller rejects on > maxDepth
      cur = cur.refs.parent ? this.byId.get(cur.refs.parent) : undefined;
    }
    return depth;
  }

  /** The single write. Idempotent by id (§4.3): a repeat returns the existing fact. */
  append(input: FactInput): AppendResult {
    // §6.1 well-formedness first: everything downstream, the content address
    // included, assumes the field domains of §1.1 already hold.
    validateFactInput(input, this.limits);

    const id = computeId(input);

    if (input.id && input.id !== id) {
      throw new FactRejected(`id mismatch: client sent ${input.id}, computed ${id}`, 400);
    }

    const existing = this.byId.get(id);
    if (existing) {
      this.dedupHits++;
      return { seq: existing.seq, recv: existing.recv, id, sig: existing.sig, deduped: true };
    }

    if (this.depthOf(input.refs?.parent) > this.maxDepth) {
      throw new FactRejected(`causation depth exceeds max (${this.maxDepth})`, 400);
    }

    const seq = ++this.seqCounter;
    // §7.1: recv MUST be non-decreasing in seq. A clock that steps backwards
    // would otherwise invert the expiry arithmetic of §3.4 for one append.
    const recv = Math.max(Date.now() / 1000, this.facts.length ? this.facts[this.facts.length - 1].recv : 0);
    const sig = computeSig(this.secret, {
      id, author: input.author, type: input.type, ts: input.ts, recv, seq,
    });

    const fact: Fact = {
      seq, recv, id,
      type: input.type,
      author: input.author,
      ts: input.ts,
      payload: input.payload ?? {},
      refs: input.refs ?? {},
      ...(input.nonce !== undefined ? { nonce: input.nonce } : {}),
      sig,
    };

    this.log.append(fact);
    this.facts.push(fact);
    this.byId.set(id, fact);
    return { seq, recv, id, sig, deduped: false };
  }

  /** The single read: a filtered window over the totally-ordered stream. */
  read(q: ReadQuery = {}): Fact[] {
    const since = q.since ?? 0;
    const limit = q.limit ?? 100;
    const out: Fact[] = [];
    for (const f of this.facts) {
      if (f.seq <= since) continue;
      if (q.type && !globMatch(q.type, f.type)) continue;
      if (q.author && f.author !== q.author) continue;
      if (q.ref && f.refs[q.ref.key] !== q.ref.value) continue;
      out.push(f);
      if (out.length >= limit) break;
    }
    return out;
  }

  get(id: string): Fact | undefined {
    return this.byId.get(id);
  }

  headSeq(): number {
    return this.seqCounter;
  }

  /** All facts (ordered) — used by the fold layer (fold.ts), not a wire endpoint. */
  all(): readonly Fact[] {
    return this.facts;
  }

  /**
   * Compaction (§7.2): drop the payloads of the given fact ids while keeping
   * their full {id, seq, recv, author, refs, sig} skeleton, so folds still work.
   * Returns the number of payloads stripped.
   */
  compact(payloadDroppable: Set<string>): number {
    const stripped = this.log.compact(this.facts, payloadDroppable);
    for (const f of this.facts) {
      if (payloadDroppable.has(f.id) && Object.keys(f.payload).length > 0) {
        f.payload = {};      // keep the in-memory projection == disk
        f.compacted = true;
      }
    }
    return stripped;
  }

  /**
   * Rewrite (the BGREWRITEAOF analog): compact by stripping the payloads of
   * **retracted** facts only.
   *
   * §7.2 is explicit that supersession alone is not grounds. v2.0 stripped every
   * non-head member of every register, which destroyed exactly the use case
   * §3.1 recommends — a reader accumulating multi-source observations over
   * `history(S)`. Votes are held back too: §3.3 reads `payload.verdict`.
   *
   * Retraction is `_.tombstone` *from the target's own author* (§5.1). A
   * stranger's tombstone is not a retraction and MUST NOT license destroying
   * anyone's payload — that was the data-destruction primitive v3.0 closed.
   */
  rewrite(): number {
    const droppable = new Set<string>();
    for (const f of this.facts) {
      if (f.type === RESERVED.VOTE) continue;
      if (retracted(this.facts, f)) droppable.add(f.id);
    }
    return this.compact(droppable);
  }

  /** INFO — the operator's window into the bus (the redis INFO analog, §2.5). */
  info(): Record<string, unknown> {
    const s = this.log.stats();
    return {
      protocol: "3.0",
      head_seq: this.seqCounter,
      facts: this.facts.length,
      log_entries: s.entries,
      log_bytes: s.bytes,
      fsync: this.log.fsyncPolicy,
      dedup_hits: this.dedupHits,
      secret_stable: this.secretStable,
      sig_failures: this.sigFailures,
      id_failures: this.idFailures,
      truncated_at: this.truncatedAt,
      max_depth: this.maxDepth,
      // §3.4/§8: Δ is a property of the log. Readers MUST fold with this value
      // and MUST NOT substitute their own.
      claim_timeout: this.claimTimeout,
      limits: this.limits,
      uptime_seconds: Math.floor((Date.now() - this.startedAt) / 1000),
    };
  }

  /** Flush + close the log. Call on graceful shutdown. */
  close(): void {
    this.log.close();
  }
}
