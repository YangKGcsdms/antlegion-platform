/**
 * setup-ui.js — the one page you need after `dsh plugin add @antlegion/dsh`.
 *
 * A DCU needs an address before it can do anything, and the address is the one
 * thing nobody can guess for you. Everything else this plugin does is designed
 * to need no attention; this is the exception, so it gets the smallest possible
 * surface: a field, a **Check** button that classifies the failure instead of
 * spinning, and **Save**, which takes effect on the running process.
 *
 * Zero dependencies and one file — `node:http` plus the HTML below. The bus's
 * own `/console` is built the same way, for the same reason: an operations page
 * that needs a build step is a page that is out of date.
 *
 * Not an authenticated surface. It binds loopback, and it can change where this
 * agent's facts go, so serving it beyond `127.0.0.1` is a decision the plugin
 * warns about rather than makes for you — the same posture as the bus itself.
 */

import { createServer } from 'node:http'
import { probeBus, renderProbe } from './preflight.js'
import { validateSettings } from './settings.js'

/** Refuse a body big enough to be an attack rather than a config. */
const MAX_BODY_BYTES = 64 * 1024

const json = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}

async function readJsonBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) throw new Error('request body too large')
    chunks.push(chunk)
  }
  if (size === 0) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf-8'))
}

/**
 * Serve the setup page.
 *
 * @param options.host - interface to bind (default `127.0.0.1`).
 * @param options.port - port to bind.
 * @param options.state - `() => ({ config, source, settingsPath, status })`,
 *   read fresh on every request so the page never shows a stale answer.
 * @param options.save - `async (patch) => ({ config, source })`, persists and
 *   applies. Throws with a human message on a rejected patch.
 * @param options.log - the plugin's logger.
 * @returns `{ url, close }`, or `null` when the port could not be bound —
 *   a setup page is a convenience and must never take the DCU down with it.
 */
export function serveSetupUi({ host = '127.0.0.1', port, state, save, log }) {
  const server = createServer((req, res) => {
    void handle(req, res).catch((error) => {
      json(res, 500, { error: error instanceof Error ? error.message : String(error) })
    })
  })

  async function handle(req, res) {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)

    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
      return res.end(PAGE)
    }

    if (req.method === 'GET' && url.pathname === '/favicon.svg') {
      res.writeHead(200, { 'content-type': 'image/svg+xml', 'cache-control': 'max-age=86400' })
      return res.end(FAVICON)
    }

    if (req.method === 'GET' && url.pathname === '/api/state') {
      return json(res, 200, state())
    }

    // Probing is a GET-shaped question about an arbitrary address, but it is a
    // POST because it makes an outbound request on the caller's behalf.
    if (req.method === 'POST' && url.pathname === '/api/check') {
      const body = await readJsonBody(req)
      const target = typeof body.busUrl === 'string' ? body.busUrl.trim() : ''
      if (target === '') return json(res, 400, { error: 'busUrl is required' })
      const verdict = await probeBus(target, { timeoutMs: 4000 })
      return json(res, 200, { verdict, rendered: renderProbe(verdict) })
    }

    if (req.method === 'POST' && url.pathname === '/api/save') {
      const body = await readJsonBody(req)
      const checked = validateSettings(body)
      if (!checked.ok) return json(res, 400, { error: checked.error })
      try {
        const applied = await save(checked.value)
        return json(res, 200, applied)
      } catch (error) {
        return json(res, 500, { error: error instanceof Error ? error.message : String(error) })
      }
    }

    json(res, 404, { error: `no route for ${req.method} ${url.pathname}` })
  }

  server.on('error', (error) => {
    const why = error?.code === 'EADDRINUSE'
      ? `port ${port} is already in use — set setupUiPort, or setupUi: false`
      : (error instanceof Error ? error.message : String(error))
    log(`setup page not served: ${why}`)
  })

  try {
    server.listen(port, host)
  } catch (error) {
    log(`setup page not served: ${error instanceof Error ? error.message : String(error)}`)
    return null
  }

  const shown = host === '0.0.0.0' ? '127.0.0.1' : host
  return {
    url: `http://${shown}:${port}`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  }
}

/** An ant, in enough pixels to tell it apart from a tab that failed to load. */
const FAVICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
<g fill="none" stroke="#a2542a" stroke-width="2.2" stroke-linecap="round">
<path d="M16 7v18M16 11l-6-4M16 11l6-4M16 17l-7-2M16 17l7-2M16 22l-6 4M16 22l6 4"/>
</g><circle cx="16" cy="6" r="3" fill="#a2542a"/></svg>`

/** The whole page. No build step, no CDN, no fonts to fail to load. */
const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>AntLegion DCU — setup</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<style>
  :root {
    color-scheme: light dark;
    --bg: #fbfaf9; --fg: #1d1c1a; --muted: #6b6862; --line: #e2ded8;
    --card: #ffffff; --accent: #a2542a; --ok: #2f6f43; --bad: #a3342a;
    --code: #f3f0ec; --on-accent: #ffffff;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #16150f; --fg: #eae7e1; --muted: #9c968c; --line: #33302a;
      --card: #1e1c16; --accent: #d08a5c; --ok: #7fbf95; --bad: #e08b7f;
      --code: #26241d;
      /* The accent is a light tan here, so the primary button takes dark text. */
      --on-accent: #16150f;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 2.5rem 1.25rem 4rem; background: var(--bg); color: var(--fg);
    font: 15px/1.6 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  }
  main { max-width: 42rem; margin: 0 auto; }
  h1 { font-size: 1.35rem; margin: 0 0 .35rem; letter-spacing: -.01em; }
  .lede { color: var(--muted); margin: 0 0 2rem; }
  .card { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 1.25rem 1.25rem 1.4rem; margin-bottom: 1.1rem; }
  label { display: block; font-weight: 600; margin-bottom: .3rem; }
  .hint { color: var(--muted); font-size: .86rem; margin: .3rem 0 0; }
  input, textarea {
    width: 100%; padding: .55rem .7rem; border: 1px solid var(--line); border-radius: 8px;
    background: var(--bg); color: var(--fg); font: 14px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace;
  }
  input:focus, textarea:focus { outline: 2px solid var(--accent); outline-offset: 1px; }
  textarea { resize: vertical; min-height: 3.6rem; }
  .field + .field { margin-top: 1.1rem; }
  .row { display: flex; gap: .6rem; flex-wrap: wrap; margin-top: 1.2rem; }
  button {
    font: inherit; font-weight: 600; padding: .5rem 1.05rem; border-radius: 8px; cursor: pointer;
    border: 1px solid var(--line); background: var(--card); color: var(--fg);
  }
  button.primary { background: var(--accent); border-color: var(--accent); color: var(--on-accent); }
  button:disabled { opacity: .55; cursor: progress; }
  .verdict { margin-top: 1.1rem; padding: .8rem .9rem; border-radius: 8px; border: 1px solid var(--line);
             background: var(--code); font: 13px/1.55 ui-monospace, SFMono-Regular, Menlo, monospace; white-space: pre-wrap; }
  .verdict.ok { border-color: var(--ok); }
  .verdict.bad { border-color: var(--bad); }
  .verdict b { color: var(--ok); }
  .verdict i { color: var(--bad); font-style: normal; }
  dl { display: grid; grid-template-columns: auto 1fr; gap: .35rem 1rem; margin: 0; font-size: .9rem; }
  dt { color: var(--muted); }
  dd { margin: 0; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; overflow-wrap: anywhere; }
  .tag { font-size: .72rem; font-weight: 600; letter-spacing: .04em; text-transform: uppercase;
         padding: .08rem .4rem; border-radius: 4px; background: var(--code); color: var(--muted); margin-left: .4rem; }
  .tag.ui { color: var(--accent); }
  footer { color: var(--muted); font-size: .85rem; margin-top: 1.6rem; }
  code { background: var(--code); padding: .1rem .3rem; border-radius: 4px; font-size: .9em; }
</style>
</head>
<body>
<main>
  <h1>AntLegion DCU</h1>
  <p class="lede">Point this agent at a fact bus. Check it, save it — the running process picks it up without a restart.</p>

  <div class="card">
    <div class="field">
      <label for="busUrl">Bus address</label>
      <input id="busUrl" spellcheck="false" autocomplete="off" placeholder="http://127.0.0.1:28090">
      <p class="hint">The bus is Redis-shaped: an address and a liveness check, no handshake. Another machine's bus must have been started with <code>HOST=0.0.0.0</code>.</p>
    </div>

    <div class="field">
      <label for="author">Identity</label>
      <input id="author" spellcheck="false" autocomplete="off" placeholder="dsh-dcu">
      <p class="hint">The author of every fact this DCU publishes. One identity, one process.</p>
    </div>

    <div class="field">
      <label for="interests">Wakes on</label>
      <textarea id="interests" spellcheck="false" placeholder="task.*"></textarea>
      <p class="hint">Fact-type globs, one per line. <strong>Empty means it never wakes.</strong></p>
    </div>

    <div class="field">
      <label for="publishes">Emits</label>
      <textarea id="publishes" spellcheck="false" placeholder="task.done"></textarea>
      <p class="hint">Declared to the colony roster so a supervisor can spot facts nobody consumes.</p>
    </div>

    <div class="row">
      <button id="check">Check</button>
      <button id="save" class="primary">Save &amp; apply</button>
      <button id="reload">Discard changes</button>
    </div>

    <div id="verdict" class="verdict" hidden></div>
  </div>

  <div class="card">
    <dl id="live"></dl>
  </div>

  <footer id="footer"></footer>
</main>

<script>
const $ = (id) => document.getElementById(id)
const lines = (s) => s.split('\\n').map((x) => x.trim()).filter(Boolean)

let current = null

function say(text, kind) {
  const box = $('verdict')
  box.hidden = false
  box.className = 'verdict' + (kind ? ' ' + kind : '')
  box.textContent = text
}

function fill(state) {
  current = state
  $('busUrl').value = state.config.busUrl ?? ''
  $('author').value = state.config.author ?? ''
  $('interests').value = (state.config.interests ?? []).join('\\n')
  $('publishes').value = (state.config.publishes ?? []).join('\\n')

  const tag = (field) => state.source?.[field] === 'setup-ui'
    ? '<span class="tag ui">saved here</span>'
    : '<span class="tag">from profile</span>'
  $('live').innerHTML = [
    ['In effect', escapeHtml(state.config.busUrl ?? '—') + tag('busUrl')],
    ['Identity', escapeHtml(state.config.author ?? '—') + tag('author')],
    ['Wakes on', escapeHtml((state.config.interests ?? []).join(', ') || '— never wakes') + tag('interests')],
    ['Bus says', escapeHtml(state.status ?? 'not checked yet')],
    ['Saved to', escapeHtml(state.settingsPath ?? '—')],
  ].map(([k, v]) => '<dt>' + k + '</dt><dd>' + v + '</dd>').join('')
  $('footer').textContent = state.note ?? ''
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}

function patch() {
  return {
    busUrl: $('busUrl').value.trim(),
    author: $('author').value.trim(),
    interests: lines($('interests').value),
    publishes: lines($('publishes').value),
  }
}

async function load() {
  const res = await fetch('/api/state')
  fill(await res.json())
}

async function withBusy(button, work) {
  button.disabled = true
  try { await work() } finally { button.disabled = false }
}

$('check').onclick = () => withBusy($('check'), async () => {
  say('checking ' + $('busUrl').value.trim() + ' …')
  const res = await fetch('/api/check', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ busUrl: $('busUrl').value.trim() }),
  })
  const body = await res.json()
  if (!res.ok) return say(body.error, 'bad')
  say(body.rendered, body.verdict.ok ? 'ok' : 'bad')
})

$('save').onclick = () => withBusy($('save'), async () => {
  const res = await fetch('/api/save', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch()),
  })
  const body = await res.json()
  if (!res.ok) return say(body.error, 'bad')
  fill(body)
  say('saved and applied — the DCU is now on ' + body.config.busUrl + '.\\n' +
      (body.status ?? ''), 'ok')
})

$('reload').onclick = () => withBusy($('reload'), async () => {
  await load()
  say('reloaded what the process is actually running')
})

load().catch((error) => say('could not read the DCU state: ' + error.message, 'bad'))
</script>
</body>
</html>
`
