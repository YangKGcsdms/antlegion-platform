/**
 * Adversarial probes against v3.0's normative claims.
 *
 * The other suites check that the implementation does what the spec says. This
 * one attacks the spec itself: each probe constructs the state an invariant
 * forbids and asserts what actually happens. A probe that passes is a claim
 * that survived; a probe that documents a gap says so in its name.
 *
 * Findings are written up in `research/protocol-v3-audit-2026-08.md`.
 */

import { describe, it, expect } from "vitest";
import { appendFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BusV2 } from "../src/bus.js";
import { ClientV2, localTransport } from "../src/client.js";
import { lifecycle } from "../src/fold.js";
import type { Fact } from "../src/types.js";

const tmp = () => mkdtempSync(join(tmpdir(), "al-adv-"));
const logPath = (dir: string) => join(dir, "facts-v2.jsonl");

/** A stored fact with an explicit seq/recv, for folding at a pinned prefix. */
function f(seq: number, author: string, refs: Fact["refs"], recv: number, type = "x"): Fact {
  return { seq, recv, id: "id" + seq, type, author, ts: 1, payload: {}, refs, sig: "" };
}

const F = "F";
const target: Fact = {
  seq: 0, recv: 1000, id: F, type: "task", author: "seed", ts: 1, payload: {}, refs: {}, sig: "",
};

/**
 * §9.3 Theorem 3 states absorption over prefixes: once `ownership(F)` returns
 * `resolved(a)`, every longer prefix returns it too. §9.2 Theorem 2 is careful
 * to state determinism as a function of **(P, Δ)**. Theorem 3 is not — and its
 * proof silently reuses the `active` set, which is a function of Δ.
 *
 * So absorption holds per-Δ, and Δ is the one fold input that does not live in
 * the log. These probes pin the prefix and vary only Δ.
 */
describe("§9.3 — absorption is relative to Δ, and Δ is not in the log", () => {
  // One prefix, fixed for every probe below: agent-a claims F, then resolves it
  // 900s later. Nothing else ever touches F.
  const prefix = [
    target,
    f(1, "agent-a", { claim_of: F }, 1_000, "_.claim"),
    f(2, "agent-a", { resolves: F }, 1_900, "_.resolve"),
  ];

  it("the same prefix folds resolved under Δ=600 and open under Δ=60", () => {
    // Under a Δ wide enough to cover the work, the claim is still live when the
    // resolve arrives, so the resolve is honoured.
    expect(lifecycle(prefix, F, { now: 2_000, claimTimeout: 3_600 }))
      .toEqual({ state: "resolved", owner: "agent-a" });

    // Under a narrower Δ the claim had already lapsed at the resolve's own recv,
    // so there is no winner to honour it. A terminal state is un-done — not by a
    // later fact, which §9.3 proves impossible, but by a parameter change.
    expect(lifecycle(prefix, F, { now: 2_000, claimTimeout: 60 }))
      .toEqual({ state: "open", owner: null });
  });

  it("the resolve fact is still on the log — only its meaning changed", () => {
    // Nothing was lost or rewritten. This is the whole point: the bytes are
    // identical and two conforming readers disagree about whether the work is
    // done, because they were handed different Δ by the same bus at different
    // times.
    const resolves = prefix.filter((x) => x.refs.resolves === F);
    expect(resolves).toHaveLength(1);
  });

  it("a bus refuses to serve an existing log under a different Δ", () => {
    // The fix: Δ is pinned to the log at genesis. Reopening the same data dir
    // with a different Δ is refused loudly rather than silently re-interpreting
    // every claim ever made on it.
    const dir = tmp();
    const first = new BusV2({ secret: "s", dataDir: dir, claimTimeout: 600 });
    first.append({ type: "task", author: "seed", ts: 1 });
    first.close();

    expect(() => new BusV2({ secret: "s", dataDir: dir, claimTimeout: 60 }))
      .toThrow(/Δ|claim timeout/i);

    // Reopening with the pinned value is fine, as is omitting it entirely: the
    // log's own value is adopted.
    const same = new BusV2({ secret: "s", dataDir: dir, claimTimeout: 600 });
    expect(same.info().claim_timeout).toBe(600);
    same.close();

    const adopted = new BusV2({ secret: "s", dataDir: dir });
    expect(adopted.info().claim_timeout).toBe(600);
    adopted.close();
  });

  it("a log written with a non-default Δ keeps it across a restart", () => {
    // Without pinning, `node dist/index.js` with no env re-opens a Δ=30 log as
    // a Δ=600 log and every historical claim silently widens.
    const dir = tmp();
    const first = new BusV2({ secret: "s", dataDir: dir, claimTimeout: 30 });
    first.append({ type: "task", author: "seed", ts: 1 });
    first.close();

    const reopened = new BusV2({ secret: "s", dataDir: dir });
    expect(reopened.info().claim_timeout).toBe(30);
    reopened.close();
  });

  it("an empty data dir adopts whatever Δ it is given, and pins it", () => {
    const dir = tmp();
    const bus = new BusV2({ secret: "s", dataDir: dir, claimTimeout: 45 });
    expect(bus.info().claim_timeout).toBe(45);
    bus.close();

    expect(() => new BusV2({ secret: "s", dataDir: dir, claimTimeout: 46 })).toThrow();
  });
});

/**
 * §11.1 says two things that cannot both be true:
 *
 *   "`seq` is restored as the **maximum** `seq` present."
 *   "A bus MUST NOT reuse a `seq`, ever, including after a truncation."
 *
 * A torn final record is truncated away; if it held the highest `seq`, the
 * maximum present is one lower and the next append takes the seq back. These
 * probes pin the actual behaviour so the spec can be corrected to match it.
 */
describe("§11.1 — a torn tail hands its seq to the next fact", () => {
  it("the seq of a truncated torn record is reissued", () => {
    const dir = tmp();
    const bus = new BusV2({ secret: "s", dataDir: dir, fsync: "always" });
    const first = bus.append({ type: "task", author: "a", ts: 1 });
    expect(first.seq).toBe(1);
    bus.close();

    // Simulate a crash mid-write: a second record that never finished.
    appendFileSync(logPath(dir), '{"seq":2,"recv":2,"id":"hal', "utf-8");

    const reopened = new BusV2({ secret: "s", dataDir: dir, fsync: "always" });
    expect(reopened.info().truncated_at).not.toBeNull();
    const next = reopened.append({ type: "task", author: "b", ts: 2 });
    expect(next.seq).toBe(2); // the torn record's seq, reissued
    reopened.close();
  });

  it("under fsync=always nothing was acknowledged at that seq, so reuse is sound", () => {
    // The reissue is only dangerous when a `201` was returned for content that
    // the crash then tore away — which `fsync=always` rules out by construction
    // and a relaxed policy does not. The bus surfaces the truncation so an
    // operator can tell the two situations apart.
    const dir = tmp();
    const bus = new BusV2({ secret: "s", dataDir: dir, fsync: "everysec" });
    bus.append({ type: "task", author: "a", ts: 1 });
    bus.close();
    appendFileSync(logPath(dir), '{"seq":2,"recv":2,"id":"hal', "utf-8");

    const reopened = new BusV2({ secret: "s", dataDir: dir, fsync: "everysec" });
    const info = reopened.info();
    expect(info.truncated_at).not.toBeNull();
    expect(info.fsync).toBe("everysec");
    reopened.close();
  });
});

/**
 * §9.3: "A reader MUST NOT make a terminal decision on a trailing `claimed` or
 * a trailing `open`." Appending a resolve is a terminal decision, and the SDK
 * gates it on exactly that state — so whether your own completion is even sent
 * depends on your wall clock, while whether it is *honoured* does not.
 */
describe("SDK — the resolve gate reads an advisory state", () => {
  it("the send decision is clock-dependent while the fold outcome is not", async () => {
    const bus = new BusV2({ secret: "s", dataDir: tmp(), claimTimeout: 600 });
    const a = new ClientV2(localTransport(bus), "agent-a", { claimTimeout: 600 });
    const { id } = await a.publish("task", { n: 1 });
    expect(await a.claim(id)).toMatchObject({ won: true });

    const stream = bus.read({ since: 0, limit: 1000 });
    const claim = stream.find((x) => x.refs.claim_of === id)!;

    // The SDK's precondition, evaluated at two clocks. Same prefix, same Δ.
    expect(lifecycle(stream, id, { now: claim.recv, claimTimeout: 600 }).owner).toBe("agent-a");
    expect(lifecycle(stream, id, { now: claim.recv + 601, claimTimeout: 600 }).owner).toBeNull();

    // Now append the resolve on the wire, bypassing the SDK gate. Its own recv
    // is inside Δ, so every reader folds `resolved` — at ANY wall clock. The
    // clock-dependent half is the client's refusal to send, not the outcome.
    bus.append({ type: "_.resolve", author: "agent-a", ts: 1, refs: { resolves: id }, nonce: "n1" });
    const after = bus.read({ since: 0, limit: 1000 });
    for (const now of [claim.recv, claim.recv + 601, 1e9]) {
      expect(lifecycle(after, id, { now, claimTimeout: 600 }))
        .toEqual({ state: "resolved", owner: "agent-a" });
    }
    bus.close();
  });
});

/**
 * The trailing branch is the one place two readers at the same prefix may
 * differ (§9.2's boundary). It is only safe if the divergence cannot reach an
 * absorbing state. These probes bound it.
 */
describe("§9.2 — the advisory branch cannot reach an absorbing state", () => {
  const claimed = [target, f(1, "agent-a", { claim_of: F }, 1_000, "_.claim")];

  it("two readers at the same prefix disagree about a trailing claim", () => {
    expect(lifecycle(claimed, F, { now: 1_100, claimTimeout: 600 }).state).toBe("claimed");
    expect(lifecycle(claimed, F, { now: 9_999, claimTimeout: 600 }).state).toBe("open");
  });

  it("no wall-clock value can turn a resolved fact into anything else", () => {
    const resolved = [...claimed, f(2, "agent-a", { resolves: F }, 1_100, "_.resolve")];
    for (const now of [0, 1_000, 1_100, 1e9, Number.MAX_SAFE_INTEGER]) {
      expect(lifecycle(resolved, F, { now, claimTimeout: 600 }))
        .toEqual({ state: "resolved", owner: "agent-a" });
    }
  });

  it("no wall-clock value can turn a dead fact into anything else", () => {
    const dead = [...claimed, f(2, "seed", { tombstones: F }, 1_100, "_.tombstone")];
    for (const now of [0, 1_000, 1e9]) {
      expect(lifecycle(dead, F, { now, claimTimeout: 600 }))
        .toEqual({ state: "dead", owner: null });
    }
  });
});
