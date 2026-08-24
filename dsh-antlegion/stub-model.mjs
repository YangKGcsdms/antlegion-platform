/**
 * A stand-in for the model endpoint, so the DCU loop can be driven end to end
 * without a provider key. Speaks the OpenAI-compatible streaming shape the dsh
 * DeepSeek provider posts to: POST {baseURL}/chat/completions, SSE out.
 *
 * It is not an LLM and does not pretend to be one. It reads the fact id out of
 * the briefing the patrol wrote and plays the exact three turns the plugin's
 * protocol prompt asks for: claim, resolve with a child fact, then stop.
 */

import { createServer } from "node:http";

const PORT = Number(process.env.STUB_PORT || 28300);
const log = (...a) => console.error("[stub-model]", ...a);

function sse(res, obj) {
  res.write(`data: ${JSON.stringify(obj)}\n\n`);
}

const frame = (choice) => ({
  id: "stub-1",
  object: "chat.completion.chunk",
  created: 0,
  model: "deepseek-v4-flash",
  choices: [{ index: 0, ...choice }],
});

/** The fact id the patrol briefed, taken from the "id=<64 hex>" line. */
function factIdFrom(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const c = messages[i]?.content;
    const text = typeof c === "string" ? c : Array.isArray(c) ? c.map((p) => p?.text ?? "").join("\n") : "";
    const m = /id=([0-9a-f]{64})/.exec(text);
    if (m) return m[1];
  }
  return null;
}

/**
 * Which tools have already run **for this fact**.
 *
 * Keyed on the fact id, not on the tool name: sessions persist and resume, so a
 * thread routinely opens with a completed claim/resolve pair for an older fact
 * already in it. A name-only check reads that as "already done" and the DCU
 * answers the new fact by doing nothing.
 */
function done(messages, id) {
  const names = new Set();
  if (id === null) return names;
  for (const m of messages) {
    if (m?.role !== "assistant" || !Array.isArray(m.tool_calls)) continue;
    for (const t of m.tool_calls) {
      const name = t?.function?.name;
      if (!name) continue;
      let args = {};
      try { args = JSON.parse(t.function.arguments ?? "{}"); } catch { /* not ours */ }
      if (args?.id === id) names.add(name);
    }
  }
  return names;
}

createServer((req, res) => {
  if (!req.url?.endsWith("/chat/completions")) {
    res.writeHead(404, { "content-type": "application/json" });
    return res.end(JSON.stringify({ error: { message: "stub: only /chat/completions" } }));
  }
  let body = "";
  req.on("data", (c) => { body += c; });
  req.on("end", () => {
    let messages = [];
    try { messages = JSON.parse(body).messages ?? []; } catch { /* fall through */ }
    const id = factIdFrom(messages);
    const already = done(messages, id);

    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    sse(res, frame({ delta: { role: "assistant", content: "" }, finish_reason: null }));

    let call = null;
    if (id && !already.has("antlegion_claim")) {
      call = { name: "antlegion_claim", arguments: JSON.stringify({ id }) };
    } else if (id && !already.has("antlegion_resolve")) {
      call = {
        name: "antlegion_resolve",
        arguments: JSON.stringify({
          id,
          children: [{ type: "task.done", payload: { by: "stub-model", note: "one deterministic cycle" } }],
        }),
      };
    }

    if (call) {
      log("→", call.name, id?.slice(0, 8));
      sse(res, frame({
        delta: { tool_calls: [{ index: 0, id: `call_${call.name}`, type: "function", function: call }] },
        finish_reason: null,
      }));
      sse(res, frame({ delta: {}, finish_reason: "tool_calls" }));
    } else {
      log("→ stop");
      sse(res, frame({ delta: { content: "done — the fact is resolved and a task.done hangs under it." }, finish_reason: null }));
      sse(res, frame({ delta: {}, finish_reason: "stop" }));
    }
    sse(res, { ...frame({ delta: {}, finish_reason: null }), usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
    res.write("data: [DONE]\n\n");
    res.end();
  });
}).listen(PORT, "127.0.0.1", () => log(`listening on http://127.0.0.1:${PORT}/v1`));
