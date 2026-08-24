#!/usr/bin/env bash
#
# End-to-end proof that a dsh harness runs as a DCU: it registers on the bus,
# is woken by a fact somebody else deposited, claims it, resolves it, and hangs
# its product under it. No human at a prompt, and no model key — `stub-model.mjs`
# stands in for the provider and plays the three turns the plugin's protocol
# prompt asks for.
#
# What the stub does NOT stand in for is any of the coordination: the patrol,
# the fold, the claim, the resolve and the causation link are the real plugin
# talking to a real bus. That is the half worth proving.
#
# Run ./setup-dcu-profile.sh first.
#
set -euo pipefail

PROFILE="${PROFILE:-dcu}"
PORT="${PORT:-28390}"
STUB_PORT="${STUB_PORT:-28391}"
DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"
WORK="${VERIFY_WORK:-$(mktemp -d)}"; mkdir -p "$WORK"
# Session ids are derived from (author, topic) and sessions persist, so a
# fixed author would have this run resume the last run's conversations. A
# verifier that depends on leftover state is not verifying anything.
AUTHOR="dsh-dcu-verify-$$"
BUS="http://127.0.0.1:$PORT"
DSH="${DSH:-$HERE/.dsh-launcher/node_modules/.bin/dsh}"
command -v dsh >/dev/null 2>&1 && DSH="${DSH_OVERRIDE:-$(command -v dsh)}"
ALCTL="$REPO/antlegion-bus/dist/bin.js"

pids=()
cleanup() { for p in "${pids[@]:-}"; do kill "$p" 2>/dev/null || true; done; [ -n "${VERIFY_WORK:-}" ] || rm -rf "$WORK"; }
trap cleanup EXIT

step() { printf '\n\033[1m== %s\033[0m\n' "$*"; }
fail() { printf '\033[31mFAIL: %s\033[0m\n' "$*"; exit 1; }

[ -f "$ALCTL" ] || (cd "$REPO/antlegion-bus" && npm run build >/dev/null)

step "a bus on $PORT"
ANTLEGION_DATA_DIR="$WORK/data" ANTLEGION_BUS_SECRET=verify-loop PORT="$PORT" \
  node "$REPO/antlegion-bus/dist/index.js" > "$WORK/bus.log" 2>&1 &
pids+=($!)
for _ in $(seq 1 40); do curl -sf --noproxy '*' "$BUS/health" >/dev/null && break; sleep 0.25; done
curl -sf --noproxy '*' "$BUS/health" || fail "the bus never came up — $WORK/bus.log"

step "the stand-in model on $STUB_PORT"
STUB_PORT="$STUB_PORT" node "$HERE/stub-model.mjs" > "$WORK/stub.log" 2>&1 &
pids+=($!)
sleep 1

step "the DCU"
# One overlay on top of the profile's own patch: this run's bus and model.
cat > "$WORK/verify.patch.yml" <<YML
- id: antlegion-dcu
  config:
    busUrl: $BUS
    author: $AUTHOR
    resident: true
    interests:
      - task.*
    publishes:
      - task.done
    pollMs: 500
    livenessTtlSec: 300
- id: llm-deepseek
  config:
    baseURL: http://127.0.0.1:$STUB_PORT/v1
    apiKeyEnv: VERIFY_LOOP_KEY
YML
VERIFY_LOOP_KEY=stand-in DSH_HOME="$DSH_HOME" \
  "$DSH" --profile "$PROFILE" --patch "$WORK/verify.patch.yml" > "$WORK/dcu.log" 2>&1 &
pids+=($!)

for _ in $(seq 1 60); do grep -q "registered —" "$WORK/dcu.log" 2>/dev/null && break; sleep 0.5; done
grep -q "registered —" "$WORK/dcu.log" || { grep -v "^ *at " "$WORK/dcu.log" | head -30; fail "the DCU never registered"; }
grep -E "bus OK|resident session|patrol starting|registered —" "$WORK/dcu.log"

publish() {  # <subject> <title> → prints the fact id
  ANTLEGION_BUS_URL="$BUS" node "$ALCTL" publish task.request "{\"title\":\"$2\"}" \
    --author human-operator --subject "$1" \
    | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>console.log(JSON.parse(s).id))'
}
settled() {  # <id> → prints the folded lifecycle state
  ANTLEGION_BUS_URL="$BUS" node "$ALCTL" state "$1" \
    | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>console.log(JSON.parse(s).state))'
}

step "somebody else deposits a fact"
ID=$(publish "incident:42" "verify the loop")
echo "task.request $ID  subject incident:42"

step "waiting for the DCU to close it"
for _ in $(seq 1 60); do [ "$(settled "$ID")" = resolved ] && break; sleep 1; done

STATE=$(ANTLEGION_BUS_URL="$BUS" node "$ALCTL" state "$ID")
echo "state: $STATE"
grep -q '"state":"resolved"' <<<"$STATE" || { grep -v "^ *at " "$WORK/dcu.log" | tail -20; fail "the fact was never resolved"; }
grep -q "\"owner\":\"$AUTHOR\"" <<<"$STATE" || fail "resolved by the wrong author"

step "an unrelated fact — a different subject, so a different conversation"
# The point of the split: the model should not reason about hiring with an
# incident still in view, and the incident's context should not be spent on it.
ID2=$(publish "hiring:eng-3" "unrelated work")
echo "task.request $ID2  subject hiring:eng-3"
for _ in $(seq 1 60); do [ "$(settled "$ID2")" = resolved ] && break; sleep 1; done
[ "$(settled "$ID2")" = resolved ] || { grep -v "^ *at " "$WORK/dcu.log" | tail -20; fail "the unrelated fact was never resolved"; }

grep -E "opened session|resumed session|woke topic" "$WORK/dcu.log"
TOPICS=$(grep -oP 'woke topic \K\S+' "$WORK/dcu.log" | sort -u | wc -l)
SESSIONS=$(grep -oP '(opened|resumed) session \K\S+' "$WORK/dcu.log" | sort -u | wc -l)
[ "$TOPICS" -ge 2 ] || fail "both facts went to one topic — the session never switched"
[ "$SESSIONS" -ge 2 ] || fail "only $SESSIONS session was ever opened"
echo "→ $TOPICS topics across $SESSIONS sessions"

step "the stream"
curl -sf --noproxy '*' "$BUS/facts?since=0" | node -e '
  let s = ""; process.stdin.on("data", (c) => (s += c)).on("end", () => {
    const facts = JSON.parse(s);
    for (const f of facts) {
      console.log(String(f.seq).padStart(3), f.type.padEnd(14), f.author.padEnd(18),
                  JSON.stringify(f.payload).slice(0, 56));
    }
    const need = ["sys.registry", "task.request", "_.claim", "_.resolve", "task.done"];
    const missing = need.filter((t) => !facts.some((f) => f.type === t));
    if (missing.length) { console.error("missing: " + missing.join(", ")); process.exit(1); }
    const reqs = facts.filter((f) => f.type === "task.request");
    if (reqs.length !== 2) { console.error("expected 2 task.request facts, saw " + reqs.length); process.exit(1); }
    for (const req of reqs) {
      const done = facts.find((f) => f.type === "task.done" && f.refs.parent === req.id);
      if (!done) { console.error("no task.done hangs under " + req.id.slice(0, 8)); process.exit(1); }
    }
  });
' || fail "the stream is not the shape a closed loop leaves"

printf '\n\033[32mPASS\033[0m — registered, woken by another author, claimed, resolved, published,\n'
printf '        and an unrelated fact opened its own conversation.\n'
