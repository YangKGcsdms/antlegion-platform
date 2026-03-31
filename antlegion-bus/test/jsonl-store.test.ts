import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { rmSync, existsSync, readFileSync, appendFileSync } from "node:fs";
import { JSONLStore } from "../src/persistence/JSONLStore.js";
import { createFact } from "../src/types/protocol.js";

const TEST_DIR = ".data-test";

describe("JSONLStore", () => {
  let store: JSONLStore;

  beforeEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
    store = new JSONLStore(TEST_DIR);
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it("creates data directory", () => {
    expect(existsSync(TEST_DIR)).toBe(true);
  });

  it("appends and reads back entries", () => {
    const fact = createFact({ fact_type: "test.type", payload: { x: 1 } });
    store.append(fact, "publish");

    const entries = store.readAll();
    expect(entries).toHaveLength(1);
    expect(entries[0].fact.fact_id).toBe(fact.fact_id);
    expect(entries[0].fact.fact_type).toBe("test.type");
    expect(entries[0].event).toBe("publish");
  });

  it("appends multiple entries", () => {
    for (let i = 0; i < 5; i++) {
      store.append(createFact({ fact_type: `type.${i}` }), "publish");
    }
    expect(store.readAll()).toHaveLength(5);
  });

  it("records different event types", () => {
    const fact = createFact({ fact_type: "test" });
    store.append(fact, "publish");
    store.append({ ...fact, state: "claimed" }, "claim", {
      claimer: "ant-a",
    });
    store.append({ ...fact, state: "resolved" }, "resolve");

    const entries = store.readAll();
    expect(entries).toHaveLength(3);
    expect(entries.map((e) => e.event)).toEqual([
      "publish",
      "claim",
      "resolve",
    ]);
  });

  it("stores metadata", () => {
    const fact = createFact();
    store.append(fact, "claim", { claimer: "ant-a", reason: "test" });

    const entries = store.readAll();
    expect(entries[0].metadata).toEqual({ claimer: "ant-a", reason: "test" });
  });

  it("returns empty array for non-existent file", () => {
    const emptyStore = new JSONLStore(TEST_DIR + "-nonexistent");
    expect(emptyStore.readAll()).toEqual([]);
    rmSync(TEST_DIR + "-nonexistent", { recursive: true, force: true });
  });

  it("skips corrupted lines gracefully", () => {
    const fact = createFact({ fact_type: "good" });
    store.append(fact, "publish");

    // Inject corrupted line
    appendFileSync(store.factLogPath, "this is not json\n", "utf-8");

    const fact2 = createFact({ fact_type: "also-good" });
    store.append(fact2, "publish");

    const entries = store.readAll();
    expect(entries).toHaveLength(2);
    expect(entries[0].fact.fact_type).toBe("good");
    expect(entries[1].fact.fact_type).toBe("also-good");
  });

  describe("compact", () => {
    it("removes entries for deleted facts", () => {
      const f1 = createFact({ fact_id: "keep-1", fact_type: "a" });
      const f2 = createFact({ fact_id: "remove-1", fact_type: "b" });
      const f3 = createFact({ fact_id: "keep-2", fact_type: "c" });

      store.append(f1, "publish");
      store.append(f2, "publish");
      store.append(f3, "publish");

      const liveFacts = new Map<string, typeof f1>();
      liveFacts.set("keep-1", f1);
      liveFacts.set("keep-2", f3);

      const removed = store.compact(liveFacts);
      expect(removed).toBe(1);

      const entries = store.readAll();
      expect(entries).toHaveLength(2);
      expect(entries.map((e) => e.fact.fact_id)).toEqual(["keep-1", "keep-2"]);
    });

    it("returns 0 for non-existent file", () => {
      const emptyStore = new JSONLStore(TEST_DIR + "-compact-test");
      expect(emptyStore.compact(new Map())).toBe(0);
      rmSync(TEST_DIR + "-compact-test", { recursive: true, force: true });
    });
  });

  describe("getStats", () => {
    it("returns correct stats", () => {
      store.append(createFact(), "publish");
      store.append(createFact(), "publish");

      const stats = store.getStats();
      expect(stats.totalEntries).toBe(2);
      expect(stats.dataDir).toBe(TEST_DIR);
      expect(stats.logSizeBytes).toBeGreaterThan(0);
    });

    it("returns zero stats for empty store", () => {
      const stats = store.getStats();
      expect(stats.totalEntries).toBe(0);
      expect(stats.logSizeBytes).toBe(0);
    });
  });
});
