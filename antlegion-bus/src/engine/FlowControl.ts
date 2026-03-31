/**
 * Flow control, storm protection, and livelock prevention.
 * Mirrors Python: flow_control.py
 *
 * Three lines of defense:
 *   1. Causation depth breaker
 *   2. Per-ant rate limiter (token bucket)
 *   3. Global bus load breaker
 * Plus: deduplication window, causation cycle check, behavioral livelock detection.
 */

import type { Fact } from "../types/protocol.js";
import { Priority } from "../types/protocol.js";

// ---------------------------------------------------------------------------
// Defense 1: Causation depth breaker
// ---------------------------------------------------------------------------

export const MAX_CAUSATION_DEPTH = 16;

export function checkCausationDepth(
  fact: Fact,
  maxDepth = MAX_CAUSATION_DEPTH,
): [boolean, string] {
  if (fact.causation_depth > maxDepth) {
    return [
      false,
      `causation depth ${fact.causation_depth} exceeds limit ${maxDepth}`,
    ];
  }
  return [true, "ok"];
}

export function checkCausationCycle(fact: Fact): [boolean, string] {
  if (fact.causation_chain.includes(fact.fact_id)) {
    return [
      false,
      `cycle detected: fact ${fact.fact_id} references itself in chain`,
    ];
  }
  if (new Set(fact.causation_chain).size !== fact.causation_chain.length) {
    return [false, "cycle detected: duplicate fact_id in causation chain"];
  }
  return [true, "ok"];
}

export function checkBehavioralLoop(
  fact: Fact,
  chainSignatures: Map<string, string>,
): [boolean, string] {
  const currentSig = `${fact.source_ant_id}:${fact.fact_type}`;
  const seenSigs: string[] = [];

  for (const ancestorId of fact.causation_chain) {
    const sig = chainSignatures.get(ancestorId);
    if (sig !== undefined) seenSigs.push(sig);
  }

  if (seenSigs.includes(currentSig)) {
    return [
      false,
      `behavioral loop detected: ${currentSig} already appeared in causation chain (livelock pattern A→B→A)`,
    ];
  }
  return [true, "ok"];
}

// ---------------------------------------------------------------------------
// Defense 2: Per-ant token bucket rate limiter
// ---------------------------------------------------------------------------

export class TokenBucket {
  tokens: number;
  private lastRefill: number;

  constructor(
    public readonly capacity: number = 20,
    public readonly refillRate: number = 5,
  ) {
    this.tokens = capacity;
    this.lastRefill = Date.now() / 1000;
  }

  tryConsume(n = 1): boolean {
    const now = Date.now() / 1000;
    const elapsed = now - this.lastRefill;
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillRate);
    this.lastRefill = now;

    if (this.tokens >= n) {
      this.tokens -= n;
      return true;
    }
    return false;
  }
}

export class AntRateLimiter {
  private buckets = new Map<string, TokenBucket>();

  constructor(
    private defaultCapacity = 20,
    private defaultRefillRate = 5,
  ) {}

  check(antId: string): [boolean, string] {
    let bucket = this.buckets.get(antId);
    if (!bucket) {
      bucket = new TokenBucket(this.defaultCapacity, this.defaultRefillRate);
      this.buckets.set(antId, bucket);
    }
    if (bucket.tryConsume()) return [true, "ok"];
    return [false, `ant ${antId} rate limit exceeded`];
  }
}

// ---------------------------------------------------------------------------
// Defense 3: Global bus load breaker
// ---------------------------------------------------------------------------

export class BusLoadBreaker {
  private timestamps: number[] = [];
  private _emergencyMode = false;

  constructor(
    private windowSeconds = 5,
    private maxFactsPerWindow = 200,
    private emergencyPriorityThreshold = Priority.HIGH,
  ) {}

  get isEmergency(): boolean {
    return this._emergencyMode;
  }

  recordAndCheck(fact: Fact): [boolean, string] {
    const now = Date.now() / 1000;
    const cutoff = now - this.windowSeconds;

    this.timestamps = this.timestamps.filter((t) => t > cutoff);
    this.timestamps.push(now);

    const currentLoad = this.timestamps.length;

    if (currentLoad > this.maxFactsPerWindow) {
      this._emergencyMode = true;
      const effectivePriority = fact.effective_priority ?? fact.priority;
      if (effectivePriority > this.emergencyPriorityThreshold) {
        return [
          false,
          `bus overloaded (${currentLoad}/${this.maxFactsPerWindow}), only priority ≤${this.emergencyPriorityThreshold} accepted`,
        ];
      }
    } else {
      this._emergencyMode = false;
    }

    return [true, "ok"];
  }
}

// ---------------------------------------------------------------------------
// Priority aging
// ---------------------------------------------------------------------------

export function applyAging(
  fact: Fact,
  agingIntervalSeconds = 30,
): void {
  if (fact.effective_priority === null) {
    fact.effective_priority = fact.priority;
  }
  const age = Date.now() / 1000 - fact.created_at;
  const boost = Math.floor(age / agingIntervalSeconds);
  fact.effective_priority = Math.max(Priority.HIGH, fact.priority - boost);
}

// ---------------------------------------------------------------------------
// Deduplication window
// ---------------------------------------------------------------------------

export class DeduplicationWindow {
  private seen = new Map<string, number>();

  constructor(private windowSeconds = 10) {}

  isDuplicate(fact: Fact): boolean {
    const now = Date.now() / 1000;
    const key = `${fact.source_ant_id}:${fact.fact_type}:${fact.content_hash}`;

    // Lazy eviction
    for (const [k, t] of this.seen) {
      if (now - t > this.windowSeconds) this.seen.delete(k);
    }

    if (this.seen.has(key)) return true;
    this.seen.set(key, now);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Composite gate
// ---------------------------------------------------------------------------

export class PublishGate {
  readonly rateLimiter: AntRateLimiter;
  readonly loadBreaker: BusLoadBreaker;
  readonly dedupWindow: DeduplicationWindow;
  readonly chainSignatures = new Map<string, string>();

  constructor(opts?: {
    rateLimitCapacity?: number;
    rateLimitRefillRate?: number;
    circuitBreakerWindowSeconds?: number;
    circuitBreakerThreshold?: number;
    dedupeWindowSeconds?: number;
  }) {
    this.rateLimiter = new AntRateLimiter(
      opts?.rateLimitCapacity,
      opts?.rateLimitRefillRate,
    );
    this.loadBreaker = new BusLoadBreaker(
      opts?.circuitBreakerWindowSeconds,
      opts?.circuitBreakerThreshold,
    );
    this.dedupWindow = new DeduplicationWindow(opts?.dedupeWindowSeconds);
  }

  check(fact: Fact, maxCausationDepth = MAX_CAUSATION_DEPTH): [boolean, string] {
    // 1. Causation depth
    let [ok, reason] = checkCausationDepth(fact, maxCausationDepth);
    if (!ok) return [false, reason];

    // 2. Causation cycle
    [ok, reason] = checkCausationCycle(fact);
    if (!ok) return [false, reason];

    // 3. Behavioral livelock
    if (fact.causation_chain.length > 0) {
      [ok, reason] = checkBehavioralLoop(fact, this.chainSignatures);
      if (!ok) return [false, reason];
    }

    // 4. Deduplication
    if (this.dedupWindow.isDuplicate(fact)) {
      return [false, "duplicate fact within deduplication window"];
    }

    // 5. Per-ant rate limit
    [ok, reason] = this.rateLimiter.check(fact.source_ant_id);
    if (!ok) return [false, reason];

    // 6. Global bus load
    [ok, reason] = this.loadBreaker.recordAndCheck(fact);
    if (!ok) return [false, reason];

    // Record signature for future behavioral loop checks
    this.chainSignatures.set(
      fact.fact_id,
      `${fact.source_ant_id}:${fact.fact_type}`,
    );

    return [true, "ok"];
  }
}
