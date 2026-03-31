import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createFilesystemTools } from "../../src/tools/filesystem.js";
import type { ToolContext } from "../../src/tools/registry.js";

let tmpDir: string;
let ctx: ToolContext;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fs-tools-"));
  ctx = {
    channel: {} as never,
    workspaceDir: tmpDir,
    agentId: "test",
    activeClaims: new Set(),
  };
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("filesystem tools", () => {
  const tools = createFilesystemTools();
  const readFile = tools.find((t) => t.name === "read_file")!;
  const writeFile = tools.find((t) => t.name === "write_file")!;
  const listDir = tools.find((t) => t.name === "list_dir")!;

  it("should create 3 tools", () => {
    expect(tools).toHaveLength(3);
  });

  describe("read_file", () => {
    it("should read existing file", async () => {
      fs.writeFileSync(path.join(tmpDir, "test.txt"), "hello world");
      const result = await readFile.execute({ path: "test.txt" }, ctx);
      expect(result).toBe("hello world");
    });

    it("should reject path outside workspace", async () => {
      await expect(readFile.execute({ path: "/etc/passwd" }, ctx)).rejects.toThrow("outside workspace");
    });

    it("should reject path traversal", async () => {
      await expect(readFile.execute({ path: "../../etc/passwd" }, ctx)).rejects.toThrow("outside workspace");
    });
  });

  describe("write_file", () => {
    it("should write file", async () => {
      await writeFile.execute({ path: "output.txt", content: "written" }, ctx);
      expect(fs.readFileSync(path.join(tmpDir, "output.txt"), "utf-8")).toBe("written");
    });

    it("should create directories", async () => {
      await writeFile.execute({ path: "sub/dir/file.txt", content: "deep" }, ctx);
      expect(fs.readFileSync(path.join(tmpDir, "sub/dir/file.txt"), "utf-8")).toBe("deep");
    });

    it("should reject path outside workspace", async () => {
      await expect(writeFile.execute({ path: "/tmp/evil.txt", content: "x" }, ctx)).rejects.toThrow("outside workspace");
    });
  });

  describe("list_dir", () => {
    it("should list workspace root", async () => {
      fs.writeFileSync(path.join(tmpDir, "a.txt"), "");
      fs.mkdirSync(path.join(tmpDir, "subdir"));

      const result = await listDir.execute({}, ctx) as Array<{ name: string; type: string }>;
      const names = result.map((e) => e.name);
      expect(names).toContain("a.txt");
      expect(names).toContain("subdir");

      const subdir = result.find((e) => e.name === "subdir");
      expect(subdir?.type).toBe("directory");
    });

    it("should list subdirectory", async () => {
      fs.mkdirSync(path.join(tmpDir, "sub"));
      fs.writeFileSync(path.join(tmpDir, "sub", "file.txt"), "");

      const result = await listDir.execute({ path: "sub" }, ctx) as Array<{ name: string }>;
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("file.txt");
    });
  });
});
