/**
 * WebSocket endpoint for per-ant real-time event push.
 * Uses the `ws` library directly on the Node.js HTTP server.
 *
 * Protocol:
 *   1. Client connects: GET /ws?ant_id={id}&token={token}  (query style)
 *      — or —          GET /ws/{ant_id}?token={token}     (path style, antlegion compatible)
 *   2. Server verifies token, registers WS connection
 *   3. Client sends: { action: "subscribe", filter: {...} }
 *   4. Server pushes BusEvent JSON to client
 *   5. Client can send: { action: "heartbeat" } or { action: "update_filter", filter: {...} }
 */

import type { IncomingMessage, Server as HttpServer } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import type { BusEngine } from "../engine/BusEngine.js";
import type { BusEvent, AcceptanceFilter } from "../types/protocol.js";
import {
  createAntIdentity,
  createAcceptanceFilter,
  getParentFactId,
} from "../types/protocol.js";
import type { Fact } from "../types/protocol.js";

export function attachWebSocket(server: HttpServer | { on: HttpServer["on"] }, engine: BusEngine): void {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (request: IncomingMessage, socket, head) => {
    const url = new URL(request.url ?? "", `http://${request.headers.host}`);

    // Accept both /ws?ant_id=X and /ws/{ant_id} path styles
    const pathMatch = url.pathname.match(/^\/ws(?:\/([^/]+))?$/);
    if (!pathMatch) {
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      // Path param takes precedence over query param
      const antId = pathMatch[1] ?? url.searchParams.get("ant_id") ?? "";
      const token = url.searchParams.get("token") ?? "";
      wss.emit("connection", ws, request, antId, token);
    });
  });

  wss.on(
    "connection",
    (ws: WebSocket, _req: IncomingMessage, antId: string, token: string) => {
      // Verify token if provided
      if (token && !engine.verifyAntToken(antId, token)) {
        ws.close(4003, "invalid token");
        return;
      }

      let subscribed = false;

      // Event callback: push events to this WS
      const eventCallback = (_cid: string, event: BusEvent) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify(eventToJson(event)));
        }
      };

      ws.on("message", (data) => {
        try {
          const msg = JSON.parse(data.toString());

          if (msg.action === "subscribe" && !subscribed) {
            const filterData = msg.filter ?? {};
            const identity = createAntIdentity({
              ant_id: antId,
              name: msg.name ?? "ws-client",
              acceptance_filter: filterFromJson(filterData),
            });

            engine.connectAnt(antId, identity, eventCallback);
            subscribed = true;
            ws.send(JSON.stringify({ status: "subscribed", ant_id: antId }));
          } else if (msg.action === "heartbeat") {
            engine.heartbeat(antId);
            ws.send(JSON.stringify({ type: "pong" }));
          } else if (msg.action === "update_filter") {
            const ant = engine.getAnt(antId);
            if (ant) {
              Object.assign(
                ant.acceptance_filter,
                filterFromJson(msg.filter ?? {}),
              );
              ws.send(JSON.stringify({ status: "filter_updated" }));
            }
          }
        } catch {
          // Ignore malformed messages
        }
      });

      ws.on("close", () => {
        if (subscribed) engine.disconnectAnt(antId);
      });

      ws.on("error", () => {
        if (subscribed) engine.disconnectAnt(antId);
      });
    },
  );
}

function filterFromJson(d: Record<string, unknown>): AcceptanceFilter {
  return createAcceptanceFilter({
    capability_offer: (d.capability_offer as string[]) ?? [],
    domain_interests: (d.domain_interests as string[]) ?? [],
    fact_type_patterns: (d.fact_type_patterns as string[]) ?? [],
    priority_range: (d.priority_range as [number, number]) ?? [0, 7],
    modes: (d.modes as any[]) ?? ["exclusive", "broadcast"],
    semantic_kinds: (d.semantic_kinds as any[]) ?? [],
    min_epistemic_rank: (d.min_epistemic_rank as number) ?? -3,
    min_confidence: (d.min_confidence as number) ?? 0.0,
    exclude_superseded: (d.exclude_superseded as boolean) ?? true,
    subject_key_patterns: (d.subject_key_patterns as string[]) ?? [],
  });
}

function eventToJson(event: BusEvent): Record<string, unknown> {
  const result: Record<string, unknown> = {
    event_type: event.event_type,
    timestamp: event.timestamp,
  };
  if (event.fact) result.fact = factToJson(event.fact);
  if (event.ant_id) result.ant_id = event.ant_id;
  if (event.detail) result.detail = event.detail;
  return result;
}

function factToJson(fact: Fact): Record<string, unknown> {
  let visibleState: string = fact.state;
  if (fact.state === "matched") visibleState = "published";
  if (fact.state === "processing") visibleState = "claimed";

  return {
    fact_id: fact.fact_id,
    fact_type: fact.fact_type,
    semantic_kind: fact.semantic_kind,
    payload: fact.payload,
    domain_tags: fact.domain_tags,
    need_capabilities: fact.need_capabilities,
    priority: fact.priority,
    mode: fact.mode,
    source_ant_id: fact.source_ant_id,
    state: visibleState,
    epistemic_state: fact.epistemic_state,
    created_at: fact.created_at,
    ttl_seconds: fact.ttl_seconds,
    claimed_by: fact.claimed_by,
    effective_priority: fact.effective_priority,
    causation_depth: fact.causation_depth,
    causation_chain: fact.causation_chain,
    parent_fact_id: getParentFactId(fact),
    confidence: fact.confidence,
    subject_key: fact.subject_key,
    supersedes: fact.supersedes,
    superseded_by: fact.superseded_by,
    content_hash: fact.content_hash,
    signature: fact.signature,
    sequence_number: fact.sequence_number,
    resolved_at: fact.resolved_at,
    corroborations: fact.corroborations,
    contradictions: fact.contradictions,
    protocol_version: fact.protocol_version,
  };
}
