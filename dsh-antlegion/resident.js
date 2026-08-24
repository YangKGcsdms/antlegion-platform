/**
 * resident.js — the resident DCU session.
 *
 * One long-lived Agent, created at plugin mount and kept alive for the process.
 * It is never driven by a human: the patrol hands it facts, and this runtime
 * turns each hand-off into exactly one waking turn, serialized on the agent's
 * own idle boundary (the same discipline `dsh-schedule`'s ScheduleRuntime uses
 * to fire reminders into a live session).
 *
 * Back-pressure lives here, not in the patrol: facts queue while a turn runs
 * and are drained in batches afterwards, so a slow model never stalls the bus
 * tail or the heartbeat.
 */

import { randomUUID } from 'node:crypto'
import { installModelSelection } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'

/** Recorded when a wake produced nothing — the accounting entry, not an error. */
const NO_OUTPUT = 'dcu.no_output'

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
 * restates what to do instead of relying on conversational memory.
 *
 * It restates no *protocol*, though. Claiming and resolving are deterministic
 * (§3.1: the winner is the lowest-seq live claim), so handing them to a model
 * would spend a turn — and risk disobedience — on something with no decision
 * in it. What is left here is the only part a model can supply: what to
 * publish about the fact.
 */
export function brief(facts, { author, busUrl, mode = 'exclusive', nudge = false }) {
  const head = facts.length === 1
    ? '1 条新事实进入你的关注范围'
    : `${facts.length} 条新事实进入你的关注范围`
  const ownership = mode === 'exclusive'
    ? '这些事实**已经由运行时认领下来，归你处理**。认领和收尾都不用你操心：不要调 antlegion_claim，也不要调 antlegion_resolve —— 你这一轮结束后运行时会自己收尾。'
    : '这些事实是公开的评议对象，别的 DCU 也在各看各的。不要认领，也不要 resolve —— 认领会把别人挡在门外。'
  return [
    nudge
      ? `[AntLegion] 上一轮你对下面的事实没有产出任何事实，再来一次（bus ${busUrl}，你的身份是 ${author}）：`
      : `[AntLegion] ${head}（bus ${busUrl}，你的身份是 ${author}）：`,
    '',
    facts.map(renderFact).join('\n\n'),
    '',
    ownership,
    '',
    '你要做的只有一件事：对每条事实，用 antlegion_publish 发布你的产出，并在 refs 里挂上 { "parent": "<该事实的 id>" } —— 产出因此挂在原事实底下，形成因果链。',
    '做不了或缺信息：publish 一条 context.request 说明缺什么，然后继续下一条，不要卡住。',
    '',
    '规则：只发布事实，绝不给别的 agent 发指令；不确定就少做，别编。全部处理完就停下等下一批。',
  ].join('\n')
}

/** One process-local resident agent driven exclusively by bus facts. */
export class ResidentDCU {
  #ctx
  #options
  #agent
  #queue = []
  #stop = Promise.withResolvers()
  #stopping = false
  #run
  #disposal

  /**
   * @param ctx - the plugin's root context (carries agents/sessions/logger).
   * @param options - author, busUrl, sessionId, cwd, maxFactsPerTurn, log.
   */
  constructor(ctx, options) {
    this.#ctx = ctx
    this.#options = options
  }

  /** The live agent, once {@link start} has resolved. */
  get agent() {
    return this.#agent
  }

  /**
   * Create the resident agent. Awaits full application composition first so the
   * agent is born with every scoped tool — including this plugin's — in place.
   */
  async start() {
    await this.#ctx.get('loader')?.await()
    if (this.#stopping) return
    const agents = this.#ctx.get('agents')
    const defaultModel = this.#ctx.get('agentDefaultModel')
    if (agents === undefined || defaultModel === undefined) {
      throw new Error('antlegion-dcu: resident mode needs the `agents` and `agentDefaultModel` services')
    }

    const selection = defaultModel.currentSelection()
    const sessionId = this.#options.sessionId || `session-antlegion-dcu-${randomUUID()}`
    // This bundle composes no preset roster, so the model-facing rows sit in
    // the host plane and the agent reads them from the global layer — the same
    // arrangement dsh-headless documents for a directly created agent.
    const { agent } = await agents.create({
      sessionId,
      meta: { cwd: this.#options.cwd || process.cwd() },
      agentOptions: { provider: selection.provider, model: selection.model },
      setup: (agentCtx) => {
        installModelSelection(agentCtx, { current: selection, assembled: undefined })
      },
    })
    this.#agent = agent
    this.#options.log(`resident session ${sessionId} up on ${selection.provider}/${selection.model}`)
    // Facts may have arrived while the model was being resolved.
    if (this.#queue.length > 0) this.#kick()
  }

  /**
   * Hand facts to the resident session. Returns immediately — this is the
   * patrol's trigger edge and must never block the bus tail.
   * @param facts - selected work facts, in bus order.
   */
  enqueue(facts) {
    if (this.#stopping || facts.length === 0) return
    this.#queue.push(...facts)
    if (this.#agent !== undefined) this.#kick()
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

  /** Drive queued facts into turns, one turn at a time. */
  async #drain() {
    const { maxFactsPerTurn, retryOnNoOutput = 1, log } = this.#options
    while (this.#queue.length > 0 && !this.#stopping) {
      // Wait for a real idle boundary before injecting: a followup landing
      // mid-turn would be a second ordinary message on someone else's turn.
      await Promise.race([this.#agent.whenIdle(), this.#stop.promise])
      if (this.#stopping) return
      const facts = this.#queue.splice(0, maxFactsPerTurn)
      const stopRenewal = this.#renewClaims(facts)
      try {
        await this.#turn(facts, false)
        if (this.#stopping) return
        let pending = await this.#withoutOutput(facts)
        for (let i = 0; i < retryOnNoOutput && pending.length > 0 && !this.#stopping; i += 1) {
          log(`no output for ${pending.length} fact(s) — re-briefing`)
          await this.#turn(pending, true)
          pending = await this.#withoutOutput(pending)
        }
        if (!this.#stopping) await this.#account(facts, pending)
      } finally {
        stopRenewal()
      }
    }
  }

  /** One waking turn: inject the briefing, then wait for the idle boundary. */
  async #turn(facts, nudge) {
    const { author, busUrl, mode = 'exclusive', log } = this.#options
    const message = createUserMessage({
      content: [{ type: 'text', text: brief(facts, { author, busUrl, mode, nudge }) }],
      source: { kind: 'plugin', plugin: 'antlegion-dcu' },
    })
    // Background work has no human initiator; attributing it to one would
    // misreport who asked for the turn.
    const agents = this.#ctx.get('agents')
    if (agents?.withoutInitiator !== undefined) {
      agents.withoutInitiator(() => { this.#agent.followup(message) })
    } else {
      this.#agent.followup(message)
    }
    log(`woke session with ${facts.length} fact(s)${nudge ? ' (re-brief)' : ''}`)
    await Promise.race([this.#agent.whenIdle(), this.#stop.promise])
    if (this.#stopping) return
    await this.#ctx.get('sessions')?.flush(this.#agent.session)
  }

  /**
   * Which of these facts the turn produced nothing for. The question goes to
   * the BUS, not to the model: "did this author append anything under that
   * parent" is a query with one answer, so a turn that only *talked* about
   * working is indistinguishable from one that never ran — which is exactly
   * the silent loss {@link #account} then writes down.
   */
  async #withoutOutput(facts) {
    const { client, author, log } = this.#options
    const pending = []
    for (const fact of facts) {
      try {
        const kids = await client.query({ author, ref: { key: 'parent', value: fact.id } })
        if (kids.length === 0) pending.push(fact)
      } catch (error) {
        log(`output check failed for ${fact.id.slice(0, 8)} (${error instanceof Error ? error.message : String(error)})`)
      }
    }
    return pending
  }

  /**
   * Close the books on the batch, so every wake ends with something on the log:
   * a real output, or a recorded `dcu.no_output`. In `exclusive` mode the
   * runtime also resolves what it claimed — the barren ones included, so a fact
   * nobody could produce for is closed rather than passed around forever.
   */
  async #account(facts, pending) {
    const { client, mode = 'exclusive', log } = this.#options
    const barren = new Set(pending.map((fact) => fact.id))
    for (const fact of facts) {
      const short = fact.id.slice(0, 8)
      const missing = barren.has(fact.id)
      const note = { fact: fact.id, type: fact.type, reason: 'turn produced no fact under this parent' }
      try {
        if (mode === 'exclusive') {
          await client.resolve(fact.id, missing ? [{ type: NO_OUTPUT, payload: note }] : [])
          log(missing ? `resolved ${short} with ${NO_OUTPUT} — the turn produced nothing` : `resolved ${short}`)
        } else if (missing) {
          await client.publish(NO_OUTPUT, note, { refs: { parent: fact.id } })
          log(`recorded ${NO_OUTPUT} for ${short} — the turn produced nothing`)
        }
      } catch (error) {
        log(`accounting failed for ${short} (${error instanceof Error ? error.message : String(error)})`)
      }
    }
  }

  /**
   * Hold the claims for as long as the turn runs. A claim expires Δ after its
   * bus-stamped `recv`, and re-claiming with a fresh nonce makes this author's
   * later claim the lowest live one again — ownership continues with no lock
   * and no protocol change. It stops when the turn does, so a wedged or dead
   * process lets its claims lapse on their own and a sibling picks the work up.
   */
  #renewClaims(facts) {
    const { client, mode = 'exclusive', claimTimeoutSec = 0, log } = this.#options
    if (mode !== 'exclusive' || facts.length === 0) return () => {}
    const deltaMs = (claimTimeoutSec > 0 ? claimTimeoutSec : 600) * 1000
    const timer = setInterval(() => {
      for (const fact of facts) {
        void client.claim(fact.id).catch((error) => {
          log(`claim renew failed for ${fact.id.slice(0, 8)} (${error instanceof Error ? error.message : String(error)})`)
        })
      }
    }, Math.max(5_000, Math.floor(deltaMs / 3)))
    timer.unref?.()
    return () => { clearInterval(timer) }
  }

  /** Stop future turns and await the in-flight drain. */
  dispose() {
    return (this.#disposal ??= (async () => {
      this.#stopping = true
      this.#queue.length = 0
      this.#stop.resolve()
      await Promise.allSettled([this.#run].filter((value) => value !== undefined))
    })())
  }
}
