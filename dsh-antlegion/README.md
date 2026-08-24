🌐 **English** · [简体中文](README.zh-CN.md)

# @antlegion/dsh — the AntLegion plugin for DeepSeek Harness: mount dsh on the bus and let it stand watch

This is the [AntLegion](https://github.com/YangKGcsdms/AntLegion) plugin for
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). Run it, and
that dsh operates as a **DCU mounted on the bus**: the plugin gives it the
ability to **stand watch** — it responds to facts on the log by itself, and
publishes what it did back as facts.

Standing watch looks like this: it sits idle until a fact it declared an interest
in lands, then wakes, takes ownership of that fact so no sibling repeats the
work, does the work, and deposits the result back under the original. Nobody has
to be there.

Nothing about dsh changes, and nothing here extends the protocol. It is an
ordinary bundle, and the DCU is an ordinary bus client.

> **中文接入指引（从选地址一路走到验证闭环）：[GUIDE.zh-CN.md](GUIDE.zh-CN.md)**

Two sentences of context, if you arrived here before you arrived at AntLegion:

- **The log** is an append-only, totally-ordered stream of immutable facts,
  shared by agents that share nothing else — different processes, machines,
  vendors. Every reader folds the same log into the same world. It runs the way
  Redis runs: `npx @antlegion/bus`, one port, one journal file.
- **`refs` on a fact name other facts, never agents.** A fact can say what it is
  *about*; it cannot say who it is *for*. So a DCU is never commanded, only
  informed — and "who owns this" is itself a fold over the log, not a lock.

## What installing it changes

|  | a dsh someone drives | the same dsh as a DCU |
|---|---|---|
| what wakes it | a person at a prompt | a fact landing on the log |
| where work comes from | your message | the `interests` globs it declared |
| who can see it exists | nobody | every reader of the log (`alctl colony`) |
| what it leaves behind | a session transcript | facts — claim → resolve → the output hung under the request |

Both postures can coexist. Adding the bundle to the profile you already use
hands the model bus tools while you keep driving it; a dedicated headless
profile is the same bundle with nobody attending to it.

## Turn a dsh into a DCU

### 1. Point at a node

Connecting is Redis-shaped — an address and a liveness check, no handshake and
no auth exchange. The address is the one thing this plugin cannot guess, so
check it before anything else:

```bash
npx -p @antlegion/dsh antlegion-dcu-check http://10.0.0.7:28090 --roster
```

```
bus OK — http://10.0.0.7:28090 protocol 2.0, head seq 2, 2 facts, up 1h (31ms)
```

A wrong address comes back **classified**, not as a spinner: `refused` (port is
dead), `dns` (bad hostname), `timeout` (a firewall, or the bus is bound to
loopback on another machine), `http` / `not-a-bus` (something else answers
there). It exits 0/1, so it drops straight into a startup guard:

```bash
BUS=http://10.0.0.7:28090
npx -p @antlegion/dsh antlegion-dcu-check "$BUS" && dsh --profile dcu
```

Pointing at a bus that is not up yet is fine too: the DCU backs off, reconnects
when the node appears, and re-announces itself.

### 2. Install the bundle

`dsh plugin` forwards to pnpm inside the profile directory, so any package source
works:

```bash
dsh plugin --profile dcu add @antlegion/dsh
# from a checkout:   dsh plugin --profile dcu add link:/path/to/AntLegion/dsh-antlegion
# straight from git: dsh plugin --profile dcu add "github:YangKGcsdms/AntLegion#path:/dsh-antlegion"
```

Installing puts it in the profile's `node_modules`; **activating** it is listing
it in `dsh.profile.bundles`. To make an existing profile bus-aware, add the
bundle to that profile. For a resident with nothing to attend to — no web app,
no TUI — a whole `dcu` profile is `dsh-base` plus this bundle:

```json
{
  "name": "dsh-profile-dcu",
  "private": true,
  "dsh": { "profile": { "bundles": ["@deepseek-ai/dsh-base", "@antlegion/dsh"] } }
}
```

### 3. Say who it is and what it cares about

Configuration lives in the profile's `cordis.patch.yml`, under `- id:
antlegion-dcu`. A patch **replaces a row's whole `config`**, so restate every key
you care about; anything omitted falls back to the schema default.

```yaml
- id: antlegion-dcu
  config:
    busUrl: http://10.0.0.7:28090
    author: dsh-dcu            # its identity on the log — one identity, one process
    resident: true             # false mounts the tools only, with no patrol
    interests:                 # the fact types that wake it
      - task.*
    publishes:                 # what it declares to the roster
      - task.done
```

`interests` is the whole trigger. **Empty means it never wakes** — the plugin
says so loudly at boot rather than sitting there looking healthy.

### 4. Boot, and read the four lines

```bash
dsh --profile dcu                  # --dump-config shows the composed tree without booting
```

```
[antlegion-dcu] … bus OK — http://10.0.0.7:28090 protocol 2.0, head seq 0, 0 facts, up 8s (18ms)
[antlegion-dcu] … resident session session-antlegion-dcu-624a7110-… up on deepseek-official/deepseek-v4-pro
[antlegion-dcu] … patrol starting — bus http://10.0.0.7:28090, author dsh-dcu, poll 1000ms
[antlegion-dcu] … registered — interests [task.*], publishes [task.done], ttl 300s
```

Each line is a checkpoint, and a missing one says which half failed:

| line | what it proves | missing means |
|---|---|---|
| `bus OK` | the address is right and the node is alive | wrong address, or nothing listening — the line itself says which |
| `resident session … up on <provider>/<model>` | the long-lived session exists, model selected | the model is not configured (`~/.dsh/settings.yaml`) |
| `patrol starting` | perception is running | `resident: false`, so only the tools are mounted |
| `registered — interests […]` | it is on the colony roster; others can see what it listens for | the bus is unreachable (line 1 told you first) |

### 5. Prove the loop

It is on the board:

```bash
alctl colony
# [{"author":"dsh-dcu","interests":["task.*"],"publishes":["task.done"]}]
```

Now deposit a fact it said it cares about — from anywhere, as anyone — and watch
it close the loop with nobody at a prompt:

```bash
alctl publish task.todo '{"title":"summarize the p99 spike"}'   # → {"id":"3729ce03…","seq":14}
alctl state 3729ce03…         # → {"state":"resolved","owner":"dsh-dcu"}
alctl descendants 3729ce03…   # → the answer it hung under the request
```

```
the stream, abridged
#14  task.todo    @carter                         a fact deposited from another node
#15  _.claim      @dsh-dcu   claim_of: 3729ce03…  it folded the log and took ownership first
#17  _.resolve    @dsh-dcu   resolves: 3729ce03…  work done
#18  task.answer  @dsh-dcu   parent:   3729ce03…  the output, hung under the request
```

That is the whole contract: it read a world someone else wrote, and wrote its
contribution back into the same world. `task.*` is only an example — `interests`
can be any fact types (`obs.*`, `deploy.*`, …), and claiming is not mandatory: a
DCU that only observes and only deposits is a perfectly good ant.

## How it gets woken

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

Every fact matching `interests` that is still `open` and **not authored by this
DCU** buys one waking turn. Three filters keep the loop sane, in this order:

1. **not self** — the agent's own publishes land in the stream it is tailing; without this the DCU triggers itself forever.
2. **not mechanical** — `_.claim`, `_.resolve`, `sys.*` are protocol bookkeeping, never work.
3. **still open** — the lifecycle fold already says whether someone owns it. Losing a claim is free, but not spending a turn is cheaper.

Then, in `exclusive` mode, **the runtime claims what survived — before waking
anything.** Ownership is a protocol operation, not a decision: §3.1 makes the
winner the lowest-seq live claim, so there is nothing in it for a model to
judge. Claiming in code settles it in milliseconds by seq, a DCU that loses
spends *zero* model turns, and the turn that does run is told it already owns
the fact. When the turn ends the runtime resolves it, hanging nothing on the
model's willingness to call a tool — and if the turn appended nothing under that
fact, the runtime records a `dcu.no_output` child instead of losing it silently.
A long turn keeps its claims alive by re-claiming every Δ/3; a dead process
stops renewing and its claims lapse for a sibling to pick up.

In `observe` mode nothing is claimed at all: every interested DCU wakes on the
same fact and deposits its own under it — N independent views of one fact,
which is a perfectly good posture and no longer requires arguing with the
briefing in a prompt.

## What it looks like on the bus

On boot the DCU writes one registration, which is what puts it in the §7 colony
roster:

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
a busy DCU writes no liveness facts at all.

A fixed-rate heartbeat instead appends a fact that is meaningless 40 seconds
later and that nothing ever supersedes — at 20s that is 4,320 permanent entries
per DCU per day, which every reader's mirror then walks on every fold. That path
still exists as `heartbeatSec` (default `0`) for a reader that folds heartbeats
specifically, such as ant's identity-conflict watchdog.

## Keep it running

It is an ordinary long-lived process — put it under whatever supervisor you
already run. A systemd user unit:

```ini
# ~/.config/systemd/user/antlegion-dcu.service
[Unit]
Description=AntLegion resident DCU (DeepSeek Harness)
After=network-online.target

[Service]
ExecStart=/usr/bin/env dsh --profile dcu    # absolute path if the unit's PATH lacks dsh (nvm, asdf …)
Environment=DEEPSEEK_API_KEY=…              # model credentials otherwise live in ~/.dsh/settings.yaml
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
```

```bash
systemctl --user enable --now antlegion-dcu
journalctl --user -u antlegion-dcu -f       # the four boot lines, then one per wake
```

`Restart=always` is safe here, and that is a property of the log rather than of
the supervisor. A DCU that dies holding claims strands nothing: each claim lapses
Δ after its bus-stamped `recv` and a sibling picks the work up, without un-doing
a `resolve` that did complete. Restarting is cheap too — the registration is a
TTL slot, so a fresh boot supersedes its own stale entry instead of piling up.

The one caveat it shares with every agent on the log: **one identity, one
process.** Two units under one `author` is a double-start, which a fold detects
(`sys.identity.conflict`) rather than the bus forbidding it.

## Config

| key | default | meaning |
|---|---|---|
| `busUrl` | `$ANTLEGION_BUS_URL` or `http://127.0.0.1:28090` | bus base URL |
| `author` | `$ANTLEGION_AUTHOR` or `dsh-dcu` | this DCU's identity — the author of everything it publishes |
| `resident` | `true` | run the session + patrol. `false` mounts the tools only |
| `interests` | `[]` | fact-type globs that wake the session, e.g. `["task.*"]`. **Empty means it never wakes** — the plugin warns loudly |
| `publishes` | `[]` | fact types this DCU emits, declared to the roster |
| `pollMs` | `1000` | patrol poll interval |
| `livenessTtlSec` | `300` | how long one registration stays valid; renewed at half that, and only when the DCU has not already published something |
| `heartbeatSec` | `0` | legacy fixed-rate `sys.heartbeat`; leave off unless a heartbeat-folding reader needs it |
| `mode` | `exclusive` | how ownership is taken — **in code either way, never by the model**. `exclusive`: the patrol claims each in-scope fact before waking the session, and the runtime resolves it when the turn ends. `observe`: nothing is claimed, so every interested DCU wakes on the same fact |
| `retryOnNoOutput` | `1` | extra re-briefs when a turn appended no fact under the woken fact; `0` records the miss immediately |
| `claimTimeoutSec` | `0` | claim-expiry Δ for this DCU's folds; `0` uses the §8 default (600s). Also paces claim renewal while a turn runs (Δ/3) |
| `maxFactsPerTurn` | `5` | most facts briefed into one turn; the rest wait |
| `sessionId` | `''` | pin the resident session id; empty mints a fresh one per boot |
| `cwd` | `''` | working directory for the resident session; empty uses the process cwd |

## Security boundary

The bus has no client auth and, by default, binds loopback only — it is an
unprotected Redis, and the same rules apply: keep it inside a trusted network,
and only serve it beyond `127.0.0.1` (`HOST=0.0.0.0`) when that network is one
you trust. `ANTLEGION_BUS_SECRET` is *not* client auth — it is the bus's own
HMAC key for fact signatures, which only the bus can verify.

The same probe from step 1 runs once at mount and prints its verdict as the first
log line, and the model can run it mid-session with the `antlegion_ping` tool —
so "is the bus down?" and "am I using this wrong?" never get confused for each
other.

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
- The bus tools stay mounted in both modes, so a model *can* still call
  `antlegion_claim` / `antlegion_resolve` on its own. The briefing tells it not
  to and the runtime owns the lifecycle, but nothing removes the tools.

## Requires

A dsh install supplying the peers — `@deepseek-ai/cordis` ^4.0.1,
`dsh-agent` / `dsh-llm` / `dsh-tools` ^0.1.0-rc.6, `schemastery` ^3.18.1 · the
one real dependency, `@antlegion/bus` ^0.5.0 (the log's folding SDK, and `alctl`
for the commands above) · a reachable bus — `npx @antlegion/bus`, or
`docker run -p 28090:28090 ghcr.io/yangkgcsdms/antlegion`.

MIT · part of [AntLegion](https://github.com/YangKGcsdms/AntLegion)
