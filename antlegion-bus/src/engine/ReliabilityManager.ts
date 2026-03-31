/**
 * Reliability scoring and fault confinement protocol.
 * Mirrors Python: reliability.py
 *
 * CAN-style error state machine:
 *   active    (TEC < 128) → normal operation
 *   degraded  (TEC >= 128) → facts marked low-confidence
 *   isolated  (TEC >= 256) → cannot publish, facts dropped
 */

import type { AntIdentity, AntState, Fact } from "../types/protocol.js";

/** Events that affect a ant's error counters. */
export const ErrorEvent = {
  CONTRADICTION: 8,
  SCHEMA_VIOLATION: 8,
  FACT_EXPIRED: 2,
  RATE_EXCEEDED: 1,
  CORROBORATION: -1,
  FACT_RESOLVED: -1,
  HEARTBEAT_OK: -1,
} as const;

export type ErrorEventValue = (typeof ErrorEvent)[keyof typeof ErrorEvent];

export const DEGRADED_THRESHOLD = 128;
export const ISOLATED_THRESHOLD = 256;

/**
 * Apply an error event to a ant's counters and transition state if needed.
 * Returns the new state.
 */
export function recordEvent(
  ant: AntIdentity,
  event: ErrorEventValue,
): AntState {
  if (ant.state === "offline") return "offline";

  ant.transmit_error_counter = Math.max(
    0,
    ant.transmit_error_counter + event,
  );

  const newState = evaluateState(ant);
  ant.state = newState;
  ant.reliability_score = computeReliability(ant);

  return newState;
}

function evaluateState(ant: AntIdentity): AntState {
  const tec = ant.transmit_error_counter;

  if (ant.state === "isolated") {
    if (tec < DEGRADED_THRESHOLD) return "active";
    if (tec < ISOLATED_THRESHOLD) return "degraded";
    return "isolated";
  }

  if (tec >= ISOLATED_THRESHOLD) return "isolated";
  if (tec >= DEGRADED_THRESHOLD) return "degraded";
  return "active";
}

/**
 * Derive a 0.0–1.0 reliability score from error counters.
 * Linear interpolation: TEC=0 → 1.0, TEC≥256 → 0.0
 */
function computeReliability(ant: AntIdentity): number {
  const tec = ant.transmit_error_counter;
  if (tec >= ISOLATED_THRESHOLD) return 0.0;
  return Math.max(0.0, 1.0 - tec / ISOLATED_THRESHOLD);
}

/**
 * Gate check before accepting a fact from a ant.
 * Returns [accepted, reason].
 */
export function shouldAcceptPublication(
  ant: AntIdentity,
  fact: Fact,
): [boolean, string] {
  if (ant.state === "isolated") {
    return [false, "ant is isolated (bus-off equivalent)"];
  }
  if (ant.state === "offline") {
    return [false, "ant is not connected"];
  }
  if (ant.state === "degraded") {
    const base = fact.confidence ?? 1.0;
    fact.confidence = Math.min(base, 0.3);
  }
  return [true, "ok"];
}
