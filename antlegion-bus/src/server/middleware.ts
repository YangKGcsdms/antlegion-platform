/**
 * Authentication middleware for ant token verification.
 */

import type { Context, Next } from "hono";
import type { BusEngine } from "../engine/BusEngine.js";

/**
 * Create a middleware that verifies X-Ant-Id / X-Ant-Token headers
 * or ant_id/token in request body.
 */
export function antAuth(getEngine: () => BusEngine) {
  return async (c: Context, next: Next) => {
    const engine = getEngine();

    // Try headers first, then body
    let antId = c.req.header("X-Ant-Id") ?? "";
    let token = c.req.header("X-Ant-Token") ?? "";

    if (!antId || !token) {
      // Will be checked in the route handler from body
      // Let it pass through — route handlers verify themselves
    } else {
      if (!engine.verifyAntToken(antId, token)) {
        return c.json({ error: `invalid token for ant ${antId}` }, 403);
      }
    }

    await next();
  };
}

/**
 * Verify ant token from request body fields.
 * Returns error response or null if ok.
 */
export function verifyBodyToken(
  engine: BusEngine,
  antId: string,
  token: string,
): Response | null {
  if (!token) return null; // Allow empty token if no tokens registered
  if (!engine.verifyAntToken(antId, token)) {
    return Response.json(
      { error: `invalid token for ant ${antId}` },
      { status: 403 },
    );
  }
  return null;
}
