/**
 * Formal transition table for fact workflow states.
 * Like TCP's state machine, only the defined transitions are legal.
 * Mirrors Python: WorkflowStateMachine.
 */

import type { Fact, FactState } from "../types/protocol.js";

export class InvalidStateTransition extends Error {
  constructor(from: FactState, to: FactState) {
    super(`cannot transition from ${from} to ${to}`);
    this.name = "InvalidStateTransition";
  }
}

const TRANSITIONS: Record<FactState, readonly FactState[]> = {
  created: ["published", "dead"],
  published: ["matched", "claimed", "dead"],
  matched: ["claimed", "dead"],
  claimed: ["processing", "resolved", "published", "dead"], // published = release
  processing: ["resolved", "dead"],
  resolved: [], // terminal
  dead: ["published"], // admin redispatch only
};

export function canTransition(from: FactState, to: FactState): boolean {
  return (TRANSITIONS[from] ?? []).includes(to);
}

export function transition(
  fact: Fact,
  to: FactState,
  force = false,
): void {
  if (!force && !canTransition(fact.state, to)) {
    throw new InvalidStateTransition(fact.state, to);
  }
  fact.state = to;
}
