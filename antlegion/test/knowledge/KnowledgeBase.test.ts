import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { KnowledgeBase } from "../../src/knowledge/KnowledgeBase.js";
import type { KnowledgeConfig } from "../../src/knowledge/types.js";

let tmpDir: string;
let kb: KnowledgeBase;

const config: KnowledgeConfig = {
  enabled: true,
  storageDir: "", // set in beforeEach
  maxEntries: 100,
  maxPromptEntries: 3,
};

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kb-test-"));
  const cfg = { ...config, storageDir: path.join(tmpDir, "knowledge") };
  kb = new KnowledgeBase(cfg, tmpDir);
  await kb.init();
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("KnowledgeBase", () => {
  it("should add and retrieve entries", () => {
    const entry = kb.add({
      category: "learned",
      tags: ["coding", "typescript"],
      title: "TypeScript Tip",
      content: "Use strict mode for better type safety",
      source: "agent:test",
    });

    expect(entry.entryId).toBeDefined();
    expect(entry.title).toBe("TypeScript Tip");
    expect(kb.size).toBe(1);
  });

  it("should search by tags", () => {
    kb.add({
      category: "learned",
      tags: ["api", "rest"],
      title: "REST API patterns",
      content: "Use proper HTTP methods",
      source: "agent:test",
    });
    kb.add({
      category: "learned",
      tags: ["api", "graphql"],
      title: "GraphQL tips",
      content: "Use fragments for reuse",
      source: "agent:test",
    });
    kb.add({
      category: "learned",
      tags: ["database"],
      title: "DB indexing",
      content: "Always index foreign keys",
      source: "agent:test",
    });

    const results = kb.search({ tags: ["api"] });
    expect(results).toHaveLength(2);
  });

  it("should search by keyword", () => {
    kb.add({
      category: "learned",
      tags: ["test"],
      title: "Unit testing best practices",
      content: "Mock external dependencies",
      source: "agent:test",
    });
    kb.add({
      category: "learned",
      tags: ["test"],
      title: "Integration testing",
      content: "Test real database connections",
      source: "agent:test",
    });

    const results = kb.search({ keyword: "unit" });
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe("Unit testing best practices");
  });

  it("should remove entries", () => {
    const entry = kb.add({
      category: "learned",
      tags: ["temp"],
      title: "Temporary",
      content: "Will be removed",
      source: "agent:test",
    });

    expect(kb.size).toBe(1);
    const removed = kb.remove(entry.entryId);
    expect(removed).toBe(true);
    expect(kb.size).toBe(0);
  });

  it("should return false when removing nonexistent entry", () => {
    expect(kb.remove("nonexistent")).toBe(false);
  });

  it("should persist and reload from disk", async () => {
    kb.add({
      category: "manual",
      tags: ["persist"],
      title: "Persistent entry",
      content: "Should survive restart",
      source: "manual",
    });

    // create new instance from same directory
    const cfg = { ...config, storageDir: path.join(tmpDir, "knowledge") };
    const kb2 = new KnowledgeBase(cfg, tmpDir);
    await kb2.init();

    expect(kb2.size).toBe(1);
    const results = kb2.search({ tags: ["persist"] });
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe("Persistent entry");
  });

  it("should limit search results", () => {
    for (let i = 0; i < 10; i++) {
      kb.add({
        category: "learned",
        tags: ["bulk"],
        title: `Entry ${i}`,
        content: `Content ${i}`,
        source: "agent:test",
      });
    }

    const results = kb.search({ tags: ["bulk"], limit: 3 });
    expect(results).toHaveLength(3);
  });

  it("should filter by category", () => {
    kb.add({ category: "learned", tags: ["a"], title: "Learned", content: "c", source: "agent" });
    kb.add({ category: "manual", tags: ["a"], title: "Manual", content: "c", source: "human" });
    kb.add({ category: "external", tags: ["a"], title: "External", content: "c", source: "api" });

    const learned = kb.search({ tags: ["a"], category: "learned" });
    expect(learned).toHaveLength(1);
    expect(learned[0].title).toBe("Learned");
  });

  it("should increment access count on search", () => {
    const entry = kb.add({
      category: "learned",
      tags: ["access"],
      title: "Access test",
      content: "content",
      source: "agent:test",
    });

    kb.search({ tags: ["access"] });
    kb.search({ tags: ["access"] });
    kb.search({ tags: ["access"] });

    const all = kb.listAll();
    const found = all.find((e) => e.entryId === entry.entryId)!;
    expect(found.accessCount).toBe(3);
    expect(found.lastAccessedAt).not.toBeNull();
  });

  it("should evict oldest entry when maxEntries reached", () => {
    const smallCfg = { ...config, storageDir: path.join(tmpDir, "knowledge"), maxEntries: 3 };
    const smallKb = new KnowledgeBase(smallCfg, tmpDir);

    kb = smallKb;

    for (let i = 0; i < 4; i++) {
      kb.add({
        category: "learned",
        tags: [`tag${i}`],
        title: `Entry ${i}`,
        content: `Content ${i}`,
        source: "agent:test",
      });
    }

    // should have evicted the first entry
    expect(kb.size).toBe(3);
  });

  it("should getRelevantForPrompt with context hints", () => {
    kb.add({
      category: "learned",
      tags: ["typescript", "coding"],
      title: "TS tips",
      content: "Use generics wisely",
      source: "agent:test",
    });
    kb.add({
      category: "learned",
      tags: ["python"],
      title: "Python tips",
      content: "Use type hints",
      source: "agent:test",
    });

    const relevant = kb.getRelevantForPrompt(["typescript"]);
    expect(relevant).toHaveLength(1);
    expect(relevant[0].title).toBe("TS tips");
  });

  it("should return empty array from getRelevantForPrompt when no entries", () => {
    const relevant = kb.getRelevantForPrompt(["anything"]);
    expect(relevant).toHaveLength(0);
  });
});
