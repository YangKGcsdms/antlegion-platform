import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadWorkspace } from "../../src/workspace/loader.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ws-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("loadWorkspace", () => {
  it("should load SOUL.md", () => {
    fs.writeFileSync(path.join(tmpDir, "SOUL.md"), "# Dev Agent\nI code.");
    const ws = loadWorkspace(tmpDir);
    expect(ws.files["SOUL.md"]).toBe("# Dev Agent\nI code.");
  });

  it("should load multiple files", () => {
    fs.writeFileSync(path.join(tmpDir, "SOUL.md"), "soul");
    fs.writeFileSync(path.join(tmpDir, "AGENTS.md"), "agents");
    fs.writeFileSync(path.join(tmpDir, "TOOLS.md"), "tools");

    const ws = loadWorkspace(tmpDir);
    expect(Object.keys(ws.files)).toHaveLength(3);
    expect(ws.files["AGENTS.md"]).toBe("agents");
  });

  it("should strip YAML front matter", () => {
    fs.writeFileSync(path.join(tmpDir, "SOUL.md"), "---\ntitle: test\n---\n# Actual content");
    const ws = loadWorkspace(tmpDir);
    expect(ws.files["SOUL.md"]).toBe("# Actual content");
  });

  it("should ignore non-workspace files", () => {
    fs.writeFileSync(path.join(tmpDir, "SOUL.md"), "soul");
    fs.writeFileSync(path.join(tmpDir, "README.md"), "readme");
    fs.writeFileSync(path.join(tmpDir, "random.txt"), "random");

    const ws = loadWorkspace(tmpDir);
    expect(Object.keys(ws.files)).toHaveLength(1);
    expect(ws.files["SOUL.md"]).toBe("soul");
  });

  it("should handle missing directory", () => {
    const ws = loadWorkspace(path.join(tmpDir, "nonexistent"));
    expect(Object.keys(ws.files)).toHaveLength(0);
  });

  it("should return resolved dir path", () => {
    const ws = loadWorkspace(tmpDir);
    expect(path.isAbsolute(ws.dir)).toBe(true);
  });
});
