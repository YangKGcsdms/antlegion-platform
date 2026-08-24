/**
 * topics.js — which conversation a fact belongs in.
 *
 * Deterministic, model-free, and deliberately so. A DCU that runs for weeks
 * meets facts about unrelated things, and feeding them all into one
 * conversation is wrong twice: the model reasons about a deploy incident with a
 * hiring thread still in view, and the context window fills with material that
 * will never be relevant again — so compaction discards the parts that would
 * have been.
 *
 * The obvious alternative is to ask the model whether two facts are related.
 * That costs a turn per fact, is non-deterministic, and would make two DCUs
 * reading one log disagree about their own history. The log already answers it:
 * `refs.subject` names a piece of the world (§5.4) and a causal trail is one
 * piece of work (§8.2). That is the topic, read from the stream rather than
 * guessed at — the same "perception is plain code, only deciding costs a turn"
 * split the rest of this plugin is built on.
 *
 * Nothing here imports the harness, so it folds under `node --test` with only
 * the bus installed.
 */

/** Facts that declare no topic share one session rather than each getting one. */
export const SHARED_TOPIC = '~'

/** How far to walk `refs.parent` looking for a trail root. */
const MAX_ROOT_WALK = 64

/**
 * The topmost resolvable `refs.parent` ancestor of a fact, or the fact itself.
 *
 * Bounded because §8.0 requires folds to terminate on any stream, including an
 * exported or hand-repaired one where content addressing no longer rules out a
 * cycle.
 */
function causalRoot(fact, index) {
  let current = fact
  for (let step = 0; step < MAX_ROOT_WALK; step++) {
    const parentId = current.refs?.parent
    if (typeof parentId !== 'string') break
    const parent = index.get(parentId)
    if (parent === undefined) break // §8.2: a parent MAY name a fact we do not hold
    current = parent
  }
  return current.id
}

/**
 * Which conversation a fact belongs in.
 *
 * @param fact  - the fact to place.
 * @param index - `id → fact` over the reader's mirror, for the ancestry walk.
 * @param scope - `subject` | `root` | `fact` | `none`.
 * @returns an opaque topic key; equal keys mean "same conversation".
 *
 * `subject` is the default and the conservative one: it splits only where the
 * stream itself says two facts are about different things, and everything that
 * declares neither subject nor ancestry keeps sharing one session — exactly the
 * behaviour before topics existed.
 */
export function sessionKeyOf(fact, index, scope) {
  if (scope === 'none') return SHARED_TOPIC
  if (scope === 'fact') return `fact:${fact.id}`

  const subject = fact.refs?.subject
  if (scope === 'subject' && typeof subject === 'string' && subject.length > 0) {
    return `subject:${subject}`
  }

  const root = causalRoot(fact, index)
  if (root !== fact.id) return `root:${root}`

  // Nothing to go on. Under `root` the fact is its own trail and so its own
  // topic; under `subject` an undeclared topic is not a claim that this fact is
  // unrelated to the last one, so it joins the shared session.
  return scope === 'root' ? `root:${fact.id}` : SHARED_TOPIC
}

/**
 * Split one batch into per-topic groups, preserving bus order within each and
 * ordering the groups by first appearance.
 *
 * The `id → fact` index is built once per batch, and only when some fact in it
 * actually has a `parent` to walk — the common case (a subject, or no ancestry
 * at all) never touches the mirror. Facts arrive rarely; ticks do not.
 */
export function groupBySession(facts, mirror, scope) {
  const needsWalk = scope !== 'none' && scope !== 'fact'
    && facts.some((f) => typeof f.refs?.parent === 'string')
  const index = needsWalk ? new Map((mirror ?? []).map((f) => [f.id, f])) : new Map()

  const groups = new Map()
  for (const fact of facts) {
    const key = sessionKeyOf(fact, index, scope)
    const group = groups.get(key)
    if (group) group.push(fact)
    else groups.set(key, [fact])
  }
  return [...groups].map(([key, batch]) => ({ key, facts: batch }))
}
