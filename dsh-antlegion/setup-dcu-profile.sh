#!/usr/bin/env bash
#
# Build a dsh profile that boots this checkout as a DCU, from nothing.
#
# The README's two-line install ("dsh plugin add @antlegion/dsh", or symlink the
# checkout) is the shape of the thing, not a working recipe today, for three
# reasons this script handles:
#
#   1. `@antlegion/bus` 0.5.0 is not on npm, so nothing can resolve the
#      plugin's own dependency. The local bus is built and packed instead.
#   2. The `@deepseek-ai/*` `latest` tag points at 0.0.1-rc.1, whose own
#      dependencies 404. Every install here pins $DSH_LINE.
#   3. Both trees skip peer dependencies — the launcher because a full peer
#      resolve does not terminate in reasonable time, the profile because it
#      ships `autoInstallPeers: false` — so the packages the bundles import at
#      runtime are named explicitly.
#
# A symlinked plugin would resolve `schemastery`, `dsh-tools` and `dsh-llm`
# from the checkout rather than from the profile (Node resolves through the
# real path), giving the plugin its own duplicate copies of the host's
# services. So the plugin is copied in, exactly where a published install
# would put it.
#
#   ./setup-dcu-profile.sh                 # profile "dcu" → 127.0.0.1:28090
#   PROFILE=ops ANTLEGION_BUS_URL=http://10.0.0.7:28090 ./setup-dcu-profile.sh
#
set -euo pipefail

DSH_LINE="${DSH_LINE:-0.1.1-rc.2}"
PROFILE="${PROFILE:-dcu}"
BUS_URL="${ANTLEGION_BUS_URL:-http://127.0.0.1:28090}"
AUTHOR="${ANTLEGION_AUTHOR:-dsh-dcu}"
DSH_HOME="${DSH_HOME:-$HOME/.dsh}"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"
WORK="${DSH_WORK:-$HERE/.dsh-launcher}"

say() { printf '\n\033[1m== %s\033[0m\n' "$*"; }

# The peers each tree imports at runtime but no installer pulled in. Both lists
# are what an actual boot asked for, one ERR_MODULE_NOT_FOUND at a time.
LAUNCHER_PEERS=(cordis-plugin-group dsh-scope dsh-timeout)
PROFILE_PEERS=(
  dsh-anonymous-user-id dsh-atomic-write dsh-bash-local dsh-compaction dsh-fs
  dsh-output-retention dsh-sandbox dsh-scope dsh-session-telemetry
  dsh-session-title-llm dsh-shell dsh-spill dsh-subagent-in-process-driver
  dsh-timeout dsh-workflow
)

say "1/5  build + pack the bus from this checkout"
(cd "$REPO/antlegion-bus" && npm install --no-audit --no-fund >/dev/null && npm run build >/dev/null)
BUS_TGZ="$(cd "$REPO/antlegion-bus" && npm pack --pack-destination "$WORK" 2>/dev/null | tail -1)"
mkdir -p "$WORK"
echo "packed $BUS_TGZ"

say "2/5  the dsh launcher ($DSH_LINE)"
if command -v dsh >/dev/null 2>&1; then
  DSH=dsh
  echo "using the dsh already on PATH"
else
  mkdir -p "$WORK"
  [ -f "$WORK/package.json" ] || echo '{"name":"dsh-launcher","private":true}' > "$WORK/package.json"
  # --legacy-peer-deps: a full peer resolve over the @deepseek-ai prerelease
  # graph does not terminate in reasonable time. The peers it skips are below.
  (cd "$WORK" && npm install --legacy-peer-deps --no-audit --no-fund \
      "@deepseek-ai/dsh@$DSH_LINE" >/dev/null)
  for p in "${LAUNCHER_PEERS[@]}"; do
    (cd "$WORK" && npm install --legacy-peer-deps --no-audit --no-fund "@deepseek-ai/$p" >/dev/null) || true
  done
  DSH="$WORK/node_modules/.bin/dsh"
fi
"$DSH" --version

say "3/5  profile '$PROFILE' with dsh-base + its runtime peers"
"$DSH" plugin --profile "$PROFILE" add "@deepseek-ai/dsh-base@$DSH_LINE" >/dev/null
PDIR="$DSH_HOME/profiles/$PROFILE"
(cd "$PDIR" && pnpm add $(printf "@deepseek-ai/%s@$DSH_LINE " "${PROFILE_PEERS[@]}") >/dev/null)
echo "profile at $PDIR"

say "4/5  install @antlegion/dsh + @antlegion/bus into the profile tree"
NM="$DSH_HOME/profiles/node_modules/@antlegion"
rm -rf "$NM/dsh" "$NM/bus"; mkdir -p "$NM/dsh" "$NM/bus"
tar -xzf "$WORK/$BUS_TGZ" -C "$NM/bus" --strip-components=1
for f in index.js tools.js patrol.js topics.js resident.js preflight.js check.js test.js \
         package.json cordis.patch.yml README.md GUIDE.zh-CN.md; do
  cp "$HERE/$f" "$NM/dsh/$f"
done
node -e '
  const fs = require("fs"), p = process.argv[1];
  const d = JSON.parse(fs.readFileSync(p, "utf8"));
  const b = d.dsh.profile.bundles;
  if (!b.includes("@antlegion/dsh")) b.push("@antlegion/dsh");
  fs.writeFileSync(p, JSON.stringify(d, null, 2) + "\n");
' "$PDIR/package.json"
echo "bundles: $(node -e 'console.log(require(process.argv[1]).dsh.profile.bundles.join(", "))' "$PDIR/package.json")"

say "5/5  config"
PATCH="$PDIR/cordis.patch.yml"
if grep -q "antlegion-dcu" "$PATCH" 2>/dev/null; then
  echo "$PATCH already configures antlegion-dcu — left alone"
else
  cat > "$PATCH" <<YML
# A patch replaces a row's whole config, so every key you care about is here.
- id: antlegion-dcu
  config:
    busUrl: $BUS_URL
    author: $AUTHOR
    resident: true
    interests:
      - task.*
    publishes:
      - task.done
    pollMs: 1000
    livenessTtlSec: 300
YML
  echo "wrote $PATCH"
fi

cat <<EOF

Done. Check the composition, then boot it:

  $DSH --profile $PROFILE --dump-config
  $DSH --profile $PROFILE

A model key is needed for the DCU to act on a fact ("resident session … up on
<provider>/<model>" appears without one; the turn is what fails). To drive the
whole loop without a key:

  ./verify-loop.sh
EOF
