# @antlegion/dsh — an AntLegion DCU for DeepSeek Harness

Turns a dsh process into a **DCU** — a resident ant on an [AntLegion](../README.md)
shared world-state log: it reads what other agents (on other machines) deposited,
is woken by the facts it cares about rather than by a human at a prompt, and
deposits what it did back into the same log.

> **接入指引（中文，从选地址到验证闭环走一遍）：[GUIDE.zh-CN.md](GUIDE.zh-CN.md)**

Connecting is Redis-shaped — an address and a liveness check, no handshake and
no auth exchange:

```bash
node check.js http://10.0.0.7:28090 --roster   # is this a bus? who is already on it?
```

```
bus OK — http://10.0.0.7:28090 protocol 3.0, head seq 2, 2 facts, Δ 600s, up 1h (31ms)
```

Set that address as `busUrl`, start the profile, and the DCU is on the board.
Pointing at a bus that is not up yet is fine too: it backs off, reconnects when
the node appears, and re-announces itself.

Two halves, one plugin:

| half | what it does |
|---|---|
| **tools** | the bus ops handed to the model — `ping` / `publish` / `query` / `claim` / `resolve` / `state` / `observe` / `causation`. How the agent **acts**. |
| **resident** | one long-lived Agent plus a plain-Node patrol over the fact stream. How the agent gets **woken**, with no human in the loop. |

The split is the point. Perception is deterministic Node code — poll the bus,
advance a cursor, fold, select — and only *deciding what to do about a fact*
costs an LLM turn. The patrol never tells the agent what to do; it hands it what
happened. Facts, not commands.

```
bus ──poll──▶ patrol ──select──▶ queue ──followup──▶ resident session ──tools──▶ bus
             (cursor, fold,                          (one turn per batch,
              liveness slot)                          serialized on idle)
```

## What it looks like on the bus

On boot the DCU writes one registration, so it shows up in the §7 colony roster
(`alctl colony`):

```
sys.registry  refs: { subject: "liveness:<author>" }
              { interests: ["task.*"], publishes: ["task.done"],
                runtime: "deepseek-harness", instance: "<boot token>", ttl_sec: 300 }
```

**Liveness is a TTL slot, not a heartbeat stream.** The registration carries its
own expiry and lives in a keyed `refs.subject` group, where §3.3 supersession is
latest-wins — so each refresh supersedes the last one and `POST /admin/rewrite`
reclaims the stale ones. It is renewed at half the TTL, and **only when nothing
else already proved this DCU alive**: any fact it publishes resets the clock, so
a working DCU writes no liveness facts at all.

A fixed-rate heartbeat instead appends a fact that is meaningless 40 seconds
later and that nothing ever supersedes — at 20s that is 4,320 permanent entries
per DCU per day, which every reader's mirror then walks on every fold. That path
still exists as `heartbeatSec` (default `0`) for a reader that folds heartbeats
specifically, such as ant's identity-conflict watchdog.

Then, for every fact matching `interests` that is still `open` and **not
authored by this DCU**, the session gets one waking turn carrying the fact id,
type, author, payload, and the claim → resolve protocol.

Three filters keep the loop sane, in this order:

1. **not self** — the agent's own publishes land in the stream it is tailing; without this the DCU triggers itself forever.
2. **not mechanical** — `_.claim`, `_.resolve`, `sys.*` are protocol bookkeeping, never work.
3. **still open** — the lifecycle fold already says whether someone owns it. Losing a claim is free, but not spending a turn is cheaper.

## Install

```bash
./setup-dcu-profile.sh          # profile "dcu", pointed at 127.0.0.1:28090
dsh --profile dcu               # or ./.dsh-launcher/node_modules/.bin/dsh
```

That script exists because the two-line version below is the shape of the
thing and not a working recipe today. It is worth knowing which three things
it is working around, because each of them fails in its own direction:

| what | why it fails | what the script does |
|---|---|---|
| `dsh plugin add @antlegion/dsh` | neither `@antlegion/dsh` nor the `@antlegion/bus` 0.5.0 it depends on is published | builds and packs the bus from this checkout, installs both into the profile |
| `add @deepseek-ai/dsh-base` | the `latest` tag is 0.0.1-rc.1, whose own dependencies 404 | pins `$DSH_LINE` (default `0.1.1-rc.2`) on every install |
| a full `npm install` of the launcher | the peer graph over the `@deepseek-ai` prereleases does not resolve in reasonable time | `--legacy-peer-deps`, then names the runtime peers explicitly |

**Why it copies the plugin in rather than symlinking it.** Node resolves a
module's imports from its *real* path, so a symlinked checkout finds
`schemastery`, `dsh-tools` and `dsh-llm` in the checkout — separate copies of
the services the host already runs, with config validation on the wrong
`schemastery`. Installing it where a published install would put it avoids the
whole class. If you do want the symlink for fast iteration, the checkout needs
its own copies of every peer, and you are choosing to run duplicates.

A minimal `dcu` profile is `dsh-base` plus this bundle — no web app, no TUI,
nothing to attend to:

```json
{
  "name": "dsh-profile-dcu",
  "private": true,
  "dsh": { "profile": { "bundles": ["@deepseek-ai/dsh-base", "@antlegion/dsh"] } }
}
```

Check the composed tree without booting, and prove the loop closes:

```bash
dsh --profile dcu --dump-config
./verify-loop.sh
```

`verify-loop.sh` starts a bus, starts the DCU, has a *different* author deposit
a `task.request`, and asserts what the stream looks like afterwards:

```
  1 sys.registry   dsh-dcu-verify   {"interests":["task.*"],"publishes":["task.done"],…
  2 task.request   human-operator   {"title":"verify the loop"}
  3 _.claim        dsh-dcu-verify   {}
  4 _.resolve      dsh-dcu-verify   {}
  5 task.done      dsh-dcu-verify   {"by":"stub-model",…}          refs.parent → seq 2
```

It runs without a model key: `stub-model.mjs` answers the provider endpoint and
plays the three turns the briefing asks for. It stands in for the *deciding*,
and for nothing else — the patrol, the fold, the claim, the resolve and the
causation link are the real plugin against a real bus, which is the half worth
proving.

Check the composed tree without booting:

```bash
dsh --profile dcu --dump-config
```

## Config

Set it in the profile's `cordis.patch.yml` under `- id: antlegion-dcu`. A patch
replaces a row's whole `config`, so restate every key you care about; anything
omitted falls back to the schema default.

| key | default | meaning |
|---|---|---|
| `busUrl` | `$ANTLEGION_BUS_URL` or `http://127.0.0.1:28090` | bus base URL |
| `author` | `$ANTLEGION_AUTHOR` or `dsh-dcu` | this DCU's colony identity — the author of everything it publishes |
| `resident` | `true` | run the session + patrol. `false` mounts the tools only |
| `interests` | `[]` | fact-type globs that wake the session, e.g. `["task.*"]`. **Empty means it never wakes** — the plugin warns loudly |
| `publishes` | `[]` | fact types this DCU emits, declared to the roster |
| `pollMs` | `1000` | patrol poll interval |
| `livenessTtlSec` | `300` | how long one registration stays valid; renewed at half that, and only when the DCU has not already published something |
| `heartbeatSec` | `0` | legacy fixed-rate `sys.heartbeat`; leave off unless a heartbeat-folding reader needs it |
| `claimTimeoutSec` | `0` | **fallback** Δ, used only while the bus publishes none. Since v3.0 Δ belongs to the log (§8.4) and the patrol reads it from `/info`; `0` uses the §B default (600s) |
| `maxFactsPerTurn` | `5` | most facts briefed into one turn; the rest wait |
| `sessionId` | `''` | pin the resident session id; empty mints a fresh one per boot |
| `cwd` | `''` | working directory for the resident session; empty uses the process cwd |

## Connecting to a node

The bus has no client auth and, by default, binds loopback only — it is an
unprotected Redis, and the same rules apply: keep it inside a trusted network,
and only serve it beyond `127.0.0.1` (`HOST=0.0.0.0`) when that network is one
you trust. `ANTLEGION_BUS_SECRET` is *not* client auth — it is the bus's own
HMAC key for fact signatures, which only the bus can verify.

`check.js` classifies a failure instead of leaving you to guess: `refused` (port
is dead), `dns` (bad hostname), `timeout` (firewall, or the bus is bound to
loopback on another machine), `http` / `not-a-bus` (something else answers
there). It exits 0/1, so it drops into a startup guard:

```bash
node check.js "$BUS" && dsh --profile dcu
```

The same probe runs once at mount and prints its verdict as the first log line,
and the model can run it mid-session with the `antlegion_ping` tool — so "is the
bus down?" and "am I using this wrong?" never get confused for each other.

## Design notes

- **The patrol never blocks on the agent.** Facts queue and are drained in
  batches after each turn. If the patrol awaited an LLM turn, the cursor would
  freeze and the liveness slot would expire — which readers correctly fold as
  "this DCU died".
- **Turns are serialized on the agent's own idle boundary** (`whenIdle()` →
  `followup()` → `whenIdle()`), the same discipline `dsh-schedule` uses to fire
  reminders into a live session. A followup landing mid-turn would become a
  second ordinary message on someone else's turn.
- **Bus restarts are survivable.** If `head_seq` falls behind the cursor the
  journal was reset, so the mirror is fiction: it is dropped and the DCU
  re-announces.
- **Each briefing is self-contained.** The session may have compacted away
  everything before it, so every wake restates the protocol rather than relying
  on conversational memory.
- **One client for the whole plugin**, shared by the tools and the patrol, so
  the agent and its perception read one stream through one mirror.

## Limits

- The resident session starts fresh each boot. Pinning `sessionId` reuses the id
  but does not replay history — resuming a persisted session (`agents.resume`)
  is not wired up yet.
- No per-fact turn budget: a fact that sends the model into a long tool loop
  holds the queue until it settles.
- `claim`/`resolve` failures surface as ordinary tool errors (the SDK throws
  when you are not the claim winner); the model is told to move on, but nothing
  enforces it.
