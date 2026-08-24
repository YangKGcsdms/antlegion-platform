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
| **resident** | long-lived Agents — one per topic — plus a plain-Node patrol over the fact stream. How the agent gets **woken**, with no human in the loop. |

The split is the point. Perception is deterministic Node code — poll the bus,
advance a cursor, fold, select — and only *deciding what to do about a fact*
costs an LLM turn. The patrol never tells the agent what to do; it hands it what
happened. Facts, not commands.

```
bus ──poll──▶ patrol ──select──▶ queue ──group──▶ session(topic) ──tools──▶ bus
             (cursor, fold,               by       (one turn per batch,
              liveness slot)            subject     serialized on idle)
                                        or trail
```

### The loop, and where each part of it lives

An agent loop that survives being left alone needs more than a wake-up. Each of
these is one line of code's worth of claim and one place to go read it:

| what | where | how you can tell |
|---|---|---|
| **runs in the background** | it is a dsh profile with no UI — `dsh --profile dcu` under any supervisor | `./verify-loop.sh` boots one, drives it, and asserts the result |
| **runs long** | the patrol reconnects across bus restarts and resets its mirror when `head < cursor`; liveness is a TTL slot that renews at half-life, and only when the DCU has not already proved itself by publishing | `alctl colony` keeps listing it; a stale registration ages out on its own |
| **woken by facts** | `patrol.js` polls, folds, and selects — not self, not `_.claim`/`sys.*`, still `open` | `N fact(s) in scope: …` then `woke topic … with N fact(s)` |
| **publishes results** | the `antlegion_*` tools; a completion is `resolve(id, children)`, and the children hang under the original fact | the stream shows `_.claim → _.resolve → <your type>` with `refs.parent` |
| **produces something** | children of the resolve are ordinary facts with your own types, so the next DCU folds them as input | `alctl descendants <id>` |
| **handles its own context** | the host's `dsh-compaction-basic` compacts at 80% pressure and on overflow; the plugin only reports whether it is mounted | the `auto-compaction: on` line at boot |
| **compacts the session** | same mechanism — every briefing is self-contained precisely because compaction may have removed everything before it | the host logs `compaction (pressure): shadowed N surface nodes` |
| **is configurable without a restart** | the setup page swaps the runtime — client, tools, patrol, sessions — against the new address | `VIA_SETUP_UI=1 ./verify-loop.sh` boots one pointed at nothing and fixes it through the page |
| **switches session on an unrelated fact** | `topics.js` folds a topic out of `refs.subject` / the causal trail; a new topic opens its own conversation, bounded by an LRU and resumable by a derived session id | `opened session … for topic subject:incident:42`, then a different one for the next subject |

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

Then open **http://127.0.0.1:28092** — the DCU serves its own setup page. Put in
the bus address, press **Check**, press **Save**. The running process picks it
up; there is nothing to restart and no YAML to find first.

![the setup page: bus address, identity, wakes-on globs, and what is in effect](../deploy/media/dsh-setup-ui.png)

The address is the one thing this plugin cannot guess for you, and until it is
right the DCU does nothing at all — so that is the one thing that gets a UI.
**Check** runs the same probe `check.js` runs, so a wrong address comes back
classified (`refused` / `dns` / `timeout` / `not-a-bus`) instead of as a spinner.
**Save** writes `~/.antlegion/dsh-dcu.json` — a file this plugin owns, holding
only the four fields the page edits — and swaps the runtime: the client, the
tools bound to it, the patrol and the sessions are rebuilt against the new
address, so nothing is left pointing at the old log.

A saved field wins over the profile's `cordis.patch.yml`, and both the page and
the boot log say which is which — a setting that silently overrides a file
someone wrote by hand is the same class of surprise as a Δ that changes on
restart. Delete the file to go back to the profile. `setupUi: false` turns the
page off; it binds loopback, and binding it wider is a warning rather than a
door, because it can change which log this agent publishes to.

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
./verify-loop.sh                 # boots, drives, and asserts the whole loop
VIA_SETUP_UI=1 ./verify-loop.sh  # …starting from a DCU pointed at nothing
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
| `setupUi` | `true` | serve the setup page |
| `setupUiHost` | `127.0.0.1` | interface for the setup page; wider than loopback is warned about |
| `setupUiPort` | `28092` | 28090 is the bus, 28091 is ant's board |
| `settingsPath` | `''` | where the page saves; empty uses `~/.antlegion/dsh-dcu.json` |
| `sessionScope` | `subject` | which facts share a conversation — see below. `subject` \| `root` \| `fact` \| `none` |
| `maxLiveSessions` | `3` | conversations kept live at once; past this the least recently used is flushed and disposed |
| `resumeSessions` | `true` | reopen a topic's persisted session instead of starting it blank |
| `sessionId` | `''` | pin one session for everything. Implies `sessionScope: none` |
| `cwd` | `''` | working directory for the resident session; empty uses the process cwd |

### One session per topic

A DCU that runs for weeks meets facts about unrelated things. Feeding them all
into one conversation is wrong twice: the model reasons about a deploy incident
with a hiring thread still in view, and the context window fills with material
that will never be relevant again — so compaction discards the parts that would
have been.

Which facts are related is **not** decided by asking the model. That costs a
turn per fact, is non-deterministic, and would make two DCUs reading one log
disagree about their own history. The log already answers it: `refs.subject`
names a piece of the world (§5.4), and a causal trail is one piece of work
(§8.2). `topics.js` folds the topic out of the stream, the same way everything
else here is folded rather than guessed.

| `sessionScope` | a fact's topic is… |
|---|---|
| `subject` *(default)* | its `refs.subject`; failing that its trail root; failing that **shared** — so it splits only where the stream itself says two facts are about different things, and a stream that sets neither behaves exactly as this plugin did before topics existed |
| `root` | its trail root, so an unattached fact opens its own conversation |
| `fact` | itself — one session per fact |
| `none` | there is one conversation for the process |

Session ids are **derived from `(author, topic)`, not random**, so the same
piece of the world is the same conversation across restarts: with
`resumeSessions` on, a topic that went quiet last week comes back to its own
history rather than to a blank page. `maxLiveSessions` bounds what that costs —
past the cap the least recently used conversation is flushed and disposed, and
reopened from persistence if its topic returns. Each session lives in its own
cordis fiber, because `agents.create` gives the *calling* context ownership of
the agent's lifecycle: created from the plugin's own context, the only way to
free one session would be to unload the whole plugin.

### Context, and running out of it

Context is the resource a resident agent exhausts, and it does so quietly —
every turn past the ceiling fails while the DCU keeps claiming work it can no
longer do. The host handles this and the plugin does not reimplement it:
`@deepseek-ai/dsh-compaction-basic` compacts on `agent/pre-step` at 80% request
pressure (retaining a verbatim tail) and again on an overflow error. So the only
thing worth saying is whether it is actually mounted, which the DCU prints at
boot:

```
[antlegion-dcu] … auto-compaction: on — the host compacts this session under context pressure
```

A profile without it gets a warning instead of a surprise three weeks later.

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

- Topics are structural, not semantic. Two facts about the same real thing that
  declare different subjects and share no trail are two topics, and the plugin
  cannot know better without spending a turn to ask — which is the trade it
  deliberately does not make.
- No per-fact turn budget: a fact that sends the model into a long tool loop
  holds the queue until it settles.
- Turns are serialized across *all* topics, not just within one. A slow turn on
  one conversation delays every other conversation's facts, though never the
  patrol, the cursor, or the liveness slot.
- `claim`/`resolve` failures surface as ordinary tool errors (the SDK throws
  when you are not the claim winner); the model is told to move on, but nothing
  enforces it.
