/**
 * @antlegion/dsh — turn a DeepSeek Harness process into an AntLegion DCU.
 *
 * Two halves, one plugin:
 *
 *   tools    the seven bus ops handed to the model (publish/query/claim/
 *            resolve/state/observe/causation) — how the agent ACTS.
 *   resident a long-lived Agent plus a plain-Node patrol over the fact bus —
 *            how the agent gets WOKEN, with no human in the loop.
 *
 * The split is the point: perception is deterministic Node code (poll, fold,
 * select), and only the act of deciding what to do about a fact costs an LLM
 * turn. Facts, not commands — the patrol never tells the agent what to do, it
 * hands it what happened.
 */

import { ClientV2, httpTransport } from '@antlegion/bus/client'
import z from '@deepseek-ai/schemastery'
import { createPatrol } from './patrol.js'
import { probeBus, renderProbe } from './preflight.js'
import { ResidentDCU } from './resident.js'
import { mergeSettings, readSettings, settingsPath, writeSettings } from './settings.js'
import { serveSetupUi } from './setup-ui.js'
import { registerBusTools } from './tools.js'

/** Stable Cordis plugin name. */
export const name = 'antlegion-dcu'

/**
 * `tools` carries the bus surface; the rest back the resident session. They are
 * all core dsh-base services, so requiring them costs nothing and fails loudly
 * rather than half-mounting a DCU that can never wake.
 */
export const inject = ['tools', 'agents', 'agentDefaultModel', 'sessions']

export const Config = z.object({
  /** Bus base URL. Defaults to the loopback bus, matching `alctl`'s default. */
  busUrl: z.string().default(process.env.ANTLEGION_BUS_URL || 'http://127.0.0.1:28090'),
  /** Fact author for everything this DCU publishes — its colony identity. */
  author: z.string().default(process.env.ANTLEGION_AUTHOR || 'dsh-dcu'),
  /** Run the resident session + patrol. Set false for a tools-only mount. */
  resident: z.boolean().default(true),
  /** Fact-type globs that wake the session, e.g. `['task.*', 'req.ready']`. */
  interests: z.array(z.string()).default([]),
  /** Fact types this DCU emits, declared to the §7 colony roster. */
  publishes: z.array(z.string()).default([]),
  /** Patrol poll interval in ms. */
  pollMs: z.number().default(1000),
  /**
   * How long one registration stays valid. The liveness slot is refreshed at
   * half this, and only when the DCU has not already published something —
   * work is its own proof of life. 0 registers once and never refreshes.
   */
  livenessTtlSec: z.number().default(300),
  /**
   * Legacy fixed-rate `sys.heartbeat`, off by default. Nothing supersedes a
   * heartbeat, so every one is a permanent log entry that is meaningless
   * seconds later; turn it on only for a reader that folds heartbeats
   * specifically (ant's identity-conflict watchdog).
   */
  heartbeatSec: z.number().default(0),
  /**
   * Fallback Δ in seconds, used only while the bus has not published one.
   *
   * Since protocol v3.0 Δ is a property of the log, not of the reader (§8.4):
   * the patrol reads it from the bus's `/info` and folds with that. Two readers
   * folding one stream with different Δ do not merely disagree about who holds
   * a claim — they disagree about whether the work was resolved at all. 0 uses
   * the §B default of 600.
   */
  claimTimeoutSec: z.number().default(0),
  /** Most facts briefed into one turn; the rest wait for the next. */
  maxFactsPerTurn: z.number().default(5),
  /**
   * Which facts share a conversation.
   *
   * `subject` (default) splits only where the stream says two facts are about
   * different things — `refs.subject` first, then the causal trail root — and
   * keeps everything that declares neither in one shared session. `root`
   * splits by trail, so an unattached fact opens its own. `fact` gives every
   * fact its own session. `none` is one conversation for the process, which is
   * what this plugin did before topics existed.
   */
  sessionScope: z.union(['subject', 'root', 'fact', 'none']).default('subject'),
  /**
   * How many conversations stay live at once. The least recently used is
   * flushed and disposed past this, so a DCU that meets thousands of topics
   * over a month holds bounded memory rather than an agent per topic.
   */
  maxLiveSessions: z.number().default(3),
  /**
   * Reopen a topic's persisted session instead of starting it blank. Session
   * ids are derived from the topic, so this survives restarts — the same piece
   * of the world comes back to its own history. Needs session persistence in
   * the profile (`dsh-session-persistence-jsonl`); without it every reopen
   * falls through to a fresh session.
   */
  resumeSessions: z.boolean().default(true),
  /** Pin one session id for everything. Implies `sessionScope: 'none'`. */
  sessionId: z.string().default(''),
  /** Working directory for the resident session. Empty uses the process cwd. */
  cwd: z.string().default(''),
  /**
   * Serve the setup page — one field, a Check button, and Save.
   *
   * On by default because the address is the one thing this plugin cannot
   * guess, and until it is right the DCU does nothing at all. Everything else
   * here is designed to need no attention; this is the exception.
   */
  setupUi: z.boolean().default(true),
  /** Interface for the setup page. Beyond loopback it is a warning, not a door. */
  setupUiHost: z.string().default('127.0.0.1'),
  /** Port for the setup page. 28090 is the bus, 28091 is ant's board. */
  setupUiPort: z.number().default(28092),
  /** Where the setup page saves. Empty uses `~/.antlegion/dsh-dcu.json`. */
  settingsPath: z.string().default(''),
})

/**
 * Mount the DCU.
 * @param ctx - plugin context carrying tools and the agent registry.
 * @param config - validated plugin config.
 */
export function apply(ctx, config) {
  // A DCU profile mounts no UI and, unless the profile wires a logger exporter,
  // `ctx.logger` buffers into nothing — a background daemon whose only record of
  // itself is invisible. So stderr is the primary sink and ctx.logger is
  // additive, for profiles that do collect it.
  const log = (message) => {
    console.error(`[antlegion-dcu] ${new Date().toISOString()} ${message}`)
    try {
      ctx.logger?.info?.(`antlegion-dcu: ${message}`)
    } catch {
      // A logger that is not wired up must never take the DCU down with it.
    }
  }

  const file = settingsPath(config.settingsPath)

  ctx.effect(() => {
    // The runtime is everything that depends on WHERE the bus is: the client,
    // the tools bound to it, the patrol, and the sessions. It is built from an
    // effective config and torn down whole, so changing the address is a
    // replacement rather than a mutation — nothing is left pointing at the old
    // log, and the process never has to restart to change worlds.
    let runtime = null
    let effective = mergeSettings(config, readSettings(file))
    let status = 'not checked yet'

    /** Build one runtime. Returns its stop function; never throws on a bad bus. */
    const startRuntime = (settings) => {
      const claimTimeout = config.claimTimeoutSec > 0 ? config.claimTimeoutSec : undefined
      // One client for the whole runtime: the tools the model calls and the
      // patrol that wakes it read the same stream through the same mirror.
      //
      // No Δ is passed: the client adopts the bus-published value on its first
      // sync (§8.4). Handing it one here would pin it and make this DCU
      // non-conforming — `claimTimeoutSec` is only the patrol's fallback for a
      // bus that publishes none.
      const client = new ClientV2(httpTransport(settings.busUrl), settings.author)
      const disposeTools = registerBusTools(ctx, client, settings.busUrl)

      // Say once, out loud, whether this address is a bus. A DCU pointed at the
      // wrong port is otherwise indistinguishable from a quiet colony. This
      // never blocks or fails the mount: the patrol reconnects on its own, so a
      // bus started five minutes from now still works.
      const probed = probeBus(settings.busUrl).then(
        (verdict) => {
          status = renderProbe(verdict)
          log(status)
          if (!verdict.ok) log(`open the setup page, or run \`node check.js ${settings.busUrl}\``)
        },
        () => {},
      )

      if (!config.resident) {
        log(`tools-only mount — bus ${settings.busUrl}, author ${settings.author}`)
        return { probed, stop: async () => { disposeTools() } }
      }

      if (settings.interests.length === 0) {
        log('WARNING: `interests` is empty — the resident session will never be woken by a fact. Set interests in the setup page, e.g. ["task.*"].')
      }

      // A pinned session id and a topic split are contradictory instructions:
      // honour the explicit one and say so, rather than silently opening several
      // conversations that all claim the same id.
      const sessionScope = config.sessionId ? 'none' : config.sessionScope
      if (config.sessionId && config.sessionScope !== 'none') {
        log(`sessionId is pinned, so sessionScope '${config.sessionScope}' is ignored — one session handles every topic`)
      }

      const resident = new ResidentDCU(ctx, {
        author: settings.author,
        busUrl: settings.busUrl,
        sessionId: config.sessionId,
        sessionScope,
        maxLiveSessions: config.maxLiveSessions,
        resumeSessions: config.resumeSessions,
        cwd: config.cwd,
        maxFactsPerTurn: config.maxFactsPerTurn,
        log,
      })

      const patrol = createPatrol({
        client,
        busUrl: settings.busUrl,
        author: settings.author,
        interests: settings.interests,
        publishes: settings.publishes,
        pollMs: config.pollMs,
        livenessTtlSec: config.livenessTtlSec,
        heartbeatSec: config.heartbeatSec,
        claimTimeout,
        log,
        onWork: (facts, context) => { resident.enqueue(facts, context) },
      })

      // Start the session first: the patrol may select work on its very first
      // tick, and `enqueue` before the agent exists only parks it.
      //
      // Keep retrying if it will not start. A DCU is a background daemon nobody
      // is watching, and the reasons this fails — a model not configured yet, a
      // provider refusing at exactly the wrong second — are the transient kind.
      // One rejected promise used to end the DCU's life without ending its
      // process: the patrol never started, so it never polled, never registered,
      // and never appeared on the roster. From outside it was indistinguishable
      // from a bus that could not be reached, which is what the guide tells you
      // to go and check.
      let stopped = false
      const started = (async () => {
        for (let attempt = 1; !stopped; attempt++) {
          try {
            await resident.start()
            if (!stopped) patrol.start()
            return
          } catch (error) {
            const why = error instanceof Error ? error.message : String(error)
            const waitMs = Math.min(30_000, 1_000 * 2 ** Math.min(attempt - 1, 5))
            log(`resident session failed to start (attempt ${attempt}): ${why} — the patrol stays down ` +
                `until it is up, so this DCU is claiming nothing; retrying in ${Math.round(waitMs / 1000)}s`)
            await new Promise((resolve) => setTimeout(resolve, waitMs))
          }
        }
      })()

      return {
        probed,
        stop: async () => {
          stopped = true          // ends the retry loop rather than waiting it out
          disposeTools()
          await started.catch(() => {})
          await patrol.stop()
          await resident.dispose()
        },
      }
    }

    /** Swap the runtime for one built from `settings`. */
    const reload = async (settings, { awaitProbe = false } = {}) => {
      const previous = runtime
      runtime = null
      if (previous) await previous.stop()
      runtime = startRuntime(settings)
      if (awaitProbe) await runtime.probed
    }

    for (const key of Object.keys(effective.source)) {
      if (effective.source[key] === 'setup-ui') {
        log(`${key} comes from the setup page (${file}), overriding the profile`)
      }
    }
    void reload(effective.config)

    // The setup page outlives each runtime: it is how you fix the address that
    // the runtime could not reach.
    let ui = null
    if (config.setupUi) {
      if (config.setupUiHost !== '127.0.0.1' && config.setupUiHost !== 'localhost') {
        log(`WARNING: the setup page is bound to ${config.setupUiHost}. It has no auth and it can change which log this agent publishes to — keep it inside a network you trust, or set setupUi: false.`)
      }
      ui = serveSetupUi({
        host: config.setupUiHost,
        port: config.setupUiPort,
        log,
        state: () => view(effective, file, status),
        save: async (patch) => {
          const next = { ...(readSettings(file) ?? {}), ...patch }
          writeSettings(file, next)
          effective = mergeSettings(config, next)
          log(`settings saved to ${file} — reloading onto ${effective.config.busUrl} as ${effective.config.author}`)
          await reload(effective.config, { awaitProbe: true })
          return view(effective, file, status)
        },
      })
      if (ui) log(`setup page → ${ui.url}`)
    }

    return async () => {
      await ui?.close()
      if (runtime) await runtime.stop()
      log('stopped')
    }
  }, 'antlegion-dcu()')
}

/** Exactly what the setup page is allowed to see about a running DCU. */
function view(effective, file, status) {
  const { config, source } = effective
  return {
    config: {
      busUrl: config.busUrl,
      author: config.author,
      interests: config.interests,
      publishes: config.publishes,
    },
    source,
    settingsPath: file,
    status,
    note: 'Saved here wins over the profile patch. Delete the file to go back to it.',
  }
}
