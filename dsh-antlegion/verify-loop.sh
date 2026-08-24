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
    author: dsh-dcu-verify
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

step "somebody else deposits a fact"
ID=$(ANTLEGION_BUS_URL="$BUS" node "$ALCTL" publish task.request '{"title":"verify the loop"}' \
       --author human-operator | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>console.log(JSON.parse(s).id))')
echo "task.request $ID"

step "waiting for the DCU to close it"
for _ in $(seq 1 60); do
  [ "$(ANTLEGION_BUS_URL="$BUS" node "$ALCTL" state "$ID" | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>console.log(JSON.parse(s).state))')" = resolved ] && break
  sleep 1
done

STATE=$(ANTLEGION_BUS_URL="$BUS" node "$ALCTL" state "$ID")
echo "state: $STATE"
grep -q '"state":"resolved"' <<<"$STATE" || { grep -v "^ *at " "$WORK/dcu.log" | tail -20; fail "the fact was never resolved"; }
grep -q '"owner":"dsh-dcu-verify"' <<<"$STATE" || fail "resolved by the wrong author"

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
    const done = facts.find((f) => f.type === "task.done");
    const req = facts.find((f) => f.type === "task.request");
    if (done.refs.parent !== req.id) { console.error("task.done is not a child of task.request"); process.exit(1); }
  });
' || fail "the stream is not the shape a closed loop leaves"

printf '\n\033[32mPASS\033[0m — registered, woken by another author, claimed, resolved, published.\n'
