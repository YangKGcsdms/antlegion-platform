/**
 * Recomputes epistemic_state from corroboration/contradiction evidence.
 * Unlike WorkflowStateMachine (explicit transitions), epistemic state
 * is derived from the accumulated evidence.
 * Mirrors Python: EpistemicStateMachine.
 */

import type { EpistemicState, Fact } from "../types/protocol.js";
import {
  DEFAULT_CONSENSUS_QUORUM,
  DEFAULT_REFUTATION_QUORUM,
} from "../types/protocol.js";

/**
 * Recompute epistemic state from evidence and mutate the fact in-place.
 * Returns the new epistemic state.
 */
export function recomputeEpistemic(
  fact: Fact,
  consensusQuorum: number = DEFAULT_CONSENSUS_QUORUM,
  refutationQuorum: number = DEFAULT_REFUTATION_QUORUM,
): EpistemicState {
  let newState: EpistemicState;

  if (fact.superseded_by) {
    newState = "superseded";
  } else if (fact.contradictions.length >= refutationQuorum) {
    newState = "refuted";
  } else if (fact.contradictions.length > 0) {
    newState = "contested";
  } else if (fact.corroborations.length >= consensusQuorum) {
    newState = "consensus";
  } else if (fact.corroborations.length > 0) {
    newState = "corroborated";
  } else {
    newState = "asserted";
  }

  fact.epistemic_state = newState;
  return newState;
}
