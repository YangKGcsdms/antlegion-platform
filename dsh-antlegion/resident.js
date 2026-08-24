/**
 * resident.js — the resident DCU sessions.
 *
 * Long-lived Agents, created at plugin mount and kept alive for the process.
 * They are never driven by a human: the patrol hands facts over, and this
 * runtime turns each hand-off into exactly one waking turn, serialized on the
 * agent's own idle boundary (the same discipline `dsh-schedule`'s
 * ScheduleRuntime uses to fire reminders into a live session).
 *
 * Back-pressure lives here, not in the patrol: facts queue while a turn runs
 * and are drained in batches afterwards, so a slow model never stalls the bus
 * tail or the liveness slot.
 *
 * **One session per topic, not one session per process.** A DCU that runs for
 * weeks meets facts about unrelated things. Feeding them all into one
 * conversation is wrong twice: the model reasons about a deploy incident with a
 * hiring thread still in view, and the context window fills with material that
 * will never be relevant again — so compaction throws away the parts that would
 * have been. The log already says what a fact is about: `refs.subject` names a
 * piece of the world (§5.4), and a causal trail is one piece of work. That is
 * the topic, and it is read from the stream rather than guessed at.
 */

import { createHash, randomUUID } from 'node:crypto'
import { installModelSelection } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { groupBySession, SHARED_TOPIC } from './topics.js'

/** How much of a fact payload is worth showing the model verbatim. */
const PAYLOAD_BUDGET = 800

/** Render one fact as a compact, self-contained briefing line. */
function renderFact(fact, index) {
  let payload = ''
  try {
    payload = JSON.stringify(fact.payload ?? {})
  } catch {
    payload = '<unserializable>'
  }
  if (payload.length > PAYLOAD_BUDGET) payload = `${payload.slice(0, PAYLOAD_BUDGET)}… (truncated)`
  const refs = fact.refs && Object.keys(fact.refs).length > 0 ? `\n   refs: ${JSON.stringify(fact.refs)}` : ''
  return `${index + 1}. id=${fact.id}\n   type=${fact.type}  author=${fact.author}  seq=${fact.seq}\n   payload: ${payload}${refs}`
}

/**
 * Build the turn text for one batch of facts. Self-contained on purpose: the
 * session may have compacted away everything before it, so each briefing
 * restates the protocol instead of relying on conversational memory.
 */
export function brief(facts, { author, busUrl }) {
  const head = facts.length === 1
    ? '1 条新事实进入你的关注范围'
    : `${facts.length} 条新事实进入你的关注范围`
  return [
    `[AntLegion] ${head}（bus ${busUrl}，你的身份是 ${author}）：`,
    '',
    facts.map(renderFact).join('\n\n'),
    '',
    '按事实总线协议处理，逐条来：',
    '1. antlegion_claim(id) 先认领。won=false 说明别人赢了这一条 —— 直接跳过，不要重做。',
    '2. won=true 才动手。做完用 antlegion_resolve(id, children) 收尾，把你的产出放进 children（[{type, payload}]），它们会挂在原事实下形成因果链。',
    '3. 做不了或缺信息：antlegion_publish 一条 context.request 说明缺什么，然后继续下一条，不要卡住。',
    '',
    '规则：只发布事实，绝不给别的 agent 发指令；不确定就少做，别编。全部处理完就停下等下一批。',
  ].join('\n')
}

/**
 * Mount one agent inside its own cordis fiber, so it can be disposed on its
 * own. `agents.create` gives the *calling* context structural ownership of the
 * agent's lifecycle — call it from the plugin's own context and the only way to
 * free one session is to unload the whole plugin.
 */
function spawnScoped(ctx, make) {
  const ready = Promise.withResolvers()
  const fiber = ctx.plugin(async (childCtx) => {
    try {
      ready.resolve(await make(childCtx))
    } catch (error) {
      ready.reject(error)
    }
  })
  return { fiber, ready: ready.promise }
}

/** Process-local resident agents, one per topic, driven exclusively by facts. */
export class ResidentDCU {
  #ctx
  #options
  /** key → { agent, sessionId, fiber }. Iteration order is LRU, oldest first. */
  #sessions = new Map()
  #mirror = []
  #queue = []
  #stop = Promise.withResolvers()
  #stopping = false
  #run
  #disposal

  /**
   * @param ctx - the plugin's root context (carries agents/sessions/logger).
   * @param options - author, busUrl, sessionId, cwd, maxFactsPerTurn,
   *   sessionScope, maxLiveSessions, resumeSessions, log.
   */
  constructor(ctx, options) {
    this.#ctx = ctx
    this.#options = options
  }

  /** The default session's agent, once {@link start} has resolved. */
  get agent() {
    return this.#sessions.get(this.#defaultKey())?.agent
  }

  /** How many conversations are currently live. */
  get liveSessions() {
    return this.#sessions.size
  }

  #defaultKey() {
    return this.#options.sessionScope === 'fact' ? 'boot' : SHARED_TOPIC
  }

  /**
   * Open the default session. Done at boot rather than lazily so the four
   * startup lines still say whether the model is configured — a DCU that only
   * discovers it has no model when the first fact arrives has already accepted
   * responsibility for that fact.
   */
  async start() {
    await this.#ctx.get('loader')?.await()
    if (this.#stopping) return
    const agents = this.#ctx.get('agents')
    const defaultModel = this.#ctx.get('agentDefaultModel')
    if (agents === undefined || defaultModel === undefined) {
      throw new Error('antlegion-dcu: resident mode needs the `agents` and `agentDefaultModel` services')
    }

    // Context is the resource a resident agent runs out of, and it does so
    // silently: every turn after the ceiling fails, and the DCU keeps claiming
    // work it can no longer do. The host handles it (dsh-compaction-basic
    // compacts at 80% pressure on `agent/pre-step` and again on an overflow
    // error) — so the only thing worth saying is whether it is actually there.
    const compaction = this.#ctx.get('compaction')
    this.#options.log(compaction !== undefined
      ? 'auto-compaction: on — the host compacts this session under context pressure'
      : 'WARNING: no `compaction` service in this profile. A resident session accumulates history until the context window is full, and every turn after that fails. Add @deepseek-ai/dsh-compaction-basic to the profile bundles.')

    const entry = await this.#openSession(this.#defaultKey())
    this.#sessions.set(this.#defaultKey(), entry)
    if (this.#queue.length > 0) this.#kick()
  }

  /**
   * Hand facts to the DCU. Returns immediately — this is the patrol's trigger
   * edge and must never block the bus tail.
   * @param facts - selected work facts, in bus order.
   * @param context - the patrol's `{ mirror }`, for the ancestry walk.
   */
  enqueue(facts, context) {
    if (this.#stopping || facts.length === 0) return
    if (context?.mirror) this.#mirror = context.mirror
    this.#queue.push(...facts)
    if (this.#sessions.size > 0) this.#kick()
  }

  /** Start the drain if one is not already running. */
  #kick() {
    if (this.#run !== undefined || this.#stopping) return
    const run = this.#drain()
    this.#run = run
    void run.then(
      () => { this.#retire(run) },
      (error) => {
        this.#options.log(`turn failed: ${error instanceof Error ? error.message : String(error)}`)
        this.#retire(run)
      },
    )
  }

  /** Release the finished drain and honor anything queued in its final tick. */
  #retire(run) {
    if (this.#run !== run) return
    this.#run = undefined
    if (this.#queue.length > 0 && !this.#stopping) this.#kick()
  }

  /** A stable session id for a topic, so a restart resumes the same thread. */
  #sessionIdFor(key) {
    if (this.#options.sessionId) return this.#options.sessionId
    if (this.#options.sessionScope === 'none') {
      return `session-antlegion-dcu-${randomUUID()}`
    }
    // Derived, not random: the same topic on the same DCU is the same
    // conversation across restarts, which is the whole point of a resident.
    // JSON, not concatenation: author and key are both free-form strings, so a
    // plain separator between them lets two different pairs hash the same.
    const digest = createHash('sha256')
      .update(JSON.stringify([this.#options.author, key]))
      .digest('hex').slice(0, 16)
    return `session-antlegion-dcu-${digest}`
  }

  /** Open (or reopen) the conversation for one topic, in its own fiber. */
  async #openSession(key) {
    const defaultModel = this.#ctx.get('agentDefaultModel')
    const selection = defaultModel.currentSelection()
    const sessionId = this.#sessionIdFor(key)
    const meta = { cwd: this.#options.cwd || process.cwd() }
    // This bundle composes no preset roster, so the model-facing rows sit in
    // the host plane and the agent reads them from the global layer — the same
    // arrangement dsh-headless documents for a directly created agent.
    const setup = (agentCtx) => {
      installModelSelection(agentCtx, { current: selection, assembled: undefined })
    }
    const agentOptions = { provider: selection.provider, model: selection.model }

    const { fiber, ready } = spawnScoped(this.#ctx, async (childCtx) => {
      const agents = childCtx.get('agents')
      if (this.#options.resumeSessions) {
        try {
          // A topic that went quiet for a week comes back to its own history
          // rather than to a blank page. Rejects when nothing is persisted
          // under this id, which is simply the first time we see the topic.
          //
          // `resumeSessionId`, not `sessionId`: the resume path takes the
          // persisted id under its own name, and passing the create-path key
          // resolves to undefined and rejects — silently falling back to a
          // blank session that then overwrites the history it failed to load.
          const resumed = await agents.resume({ resumeSessionId: sessionId, agentOptions, setup })
          return { agent: resumed.agent, resumed: true }
        } catch { /* no persisted session under this id — open a new one */ }
      }
      const created = await agents.create({ sessionId, meta, agentOptions, setup })
      return { agent: created.agent, resumed: false }
    })

    let result
    try {
      result = await ready
    } catch (error) {
      fiber.dispose()
      throw error
    }
    this.#options.log(
      `${result.resumed ? 'resumed' : 'opened'} session ${sessionId} for topic ${key} ` +
      `on ${selection.provider}/${selection.model}`,
    )
    return { agent: result.agent, sessionId, fiber }
  }

  /** Retire the least recently used conversation, freeing its agent. */
  async #evictOldest() {
    const oldest = this.#sessions.entries().next().value
    if (oldest === undefined) return
    const [key, entry] = oldest
    this.#sessions.delete(key)
    this.#options.log(`retiring session ${entry.sessionId} (topic ${key}) — ${this.#options.maxLiveSessions} live sessions is the cap`)
    await this.#closeSession(entry)
  }

  /** Flush a conversation's session and dispose the fiber that owns its agent. */
  async #closeSession(entry) {
    try {
      await this.#ctx.get('sessions')?.flush(entry.agent.session)
    } catch { /* a session that will not flush must not block the eviction */ }
    try {
      entry.fiber.dispose()
    } catch (error) {
      this.#options.log(`session ${entry.sessionId} did not dispose cleanly: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /** The live agent for a topic, opening or re-opening it as needed. */
  async #agentFor(key) {
    const live = this.#sessions.get(key)
    if (live !== undefined) {
      this.#sessions.delete(key)   // re-insert to move it to the LRU tail
      this.#sessions.set(key, live)
      return live.agent
    }
    while (this.#sessions.size >= Math.max(1, this.#options.maxLiveSessions)) {
      await this.#evictOldest()
      if (this.#stopping) return undefined
    }
    const entry = await this.#openSession(key)
    if (this.#stopping) { await this.#closeSession(entry); return undefined }
    this.#sessions.set(key, entry)
    return entry.agent
  }

  /** Drive queued facts into turns — one turn at a time, one topic at a time. */
  async #drain() {
    const { maxFactsPerTurn, author, busUrl, sessionScope } = this.#options
    while (this.#queue.length > 0 && !this.#stopping) {
      const batch = this.#queue.splice(0, this.#queue.length)
      for (const group of groupBySession(batch, this.#mirror, sessionScope)) {
        for (let i = 0; i < group.facts.length && !this.#stopping; i += maxFactsPerTurn) {
          const facts = group.facts.slice(i, i + maxFactsPerTurn)
          const agent = await this.#agentFor(group.key)
          if (agent === undefined) return
          await this.#oneTurn(agent, facts, group.key, { author, busUrl })
          if (this.#stopping) return
        }
      }
    }
  }

  /** One waking turn, injected at the agent's own idle boundary. */
  async #oneTurn(agent, facts, key, { author, busUrl }) {
    // Wait for a real idle boundary before injecting: a followup landing
    // mid-turn would be a second ordinary message on someone else's turn.
    await Promise.race([agent.whenIdle(), this.#stop.promise])
    if (this.#stopping) return
    const message = createUserMessage({
      content: [{ type: 'text', text: brief(facts, { author, busUrl }) }],
      source: { kind: 'plugin', plugin: 'antlegion-dcu' },
    })
    // Background work has no human initiator; attributing it to one would
    // misreport who asked for the turn.
    const agents = this.#ctx.get('agents')
    if (agents?.withoutInitiator !== undefined) {
      agents.withoutInitiator(() => { agent.followup(message) })
    } else {
      agent.followup(message)
    }
    this.#options.log(`woke topic ${key} with ${facts.length} fact(s)`)
    await Promise.race([agent.whenIdle(), this.#stop.promise])
    if (this.#stopping) return
    await this.#ctx.get('sessions')?.flush(agent.session)
  }

  /** Stop future turns, await the in-flight drain, and close every session. */
  dispose() {
    return (this.#disposal ??= (async () => {
      this.#stopping = true
      this.#queue.length = 0
      this.#stop.resolve()
      await Promise.allSettled([this.#run].filter((value) => value !== undefined))
      const open = [...this.#sessions.values()]
      this.#sessions.clear()
      await Promise.allSettled(open.map((entry) => this.#closeSession(entry)))
    })())
  }
}
