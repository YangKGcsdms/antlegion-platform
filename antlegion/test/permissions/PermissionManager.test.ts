import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PermissionManager } from "../../src/permissions/PermissionManager.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "perm-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("PermissionManager", () => {
  it("should return defaultLevel when no policy file exists", () => {
    const pm = new PermissionManager(
      { enabled: true, policyFile: "PERMISSIONS.md", defaultLevel: "unrestricted" },
      tmpDir,
    );
    expect(pm.check("exec")).toBe("unrestricted");
    expect(pm.check("anything")).toBe("unrestricted");
  });

  it("should load and apply markdown policy", () => {
    const md = `# Permissions

| Tool Pattern   | Level        |
|----------------|-------------|
| exec           | supervised  |
| write_file     | restricted  |
| legion_bus_*   | unrestricted|
| *              | sandboxed   |
`;
    fs.writeFileSync(path.join(tmpDir, "PERMISSIONS.md"), md);

    const pm = new PermissionManager(
      { enabled: true, policyFile: "PERMISSIONS.md", defaultLevel: "unrestricted" },
      tmpDir,
    );

    expect(pm.check("exec")).toBe("supervised");
    expect(pm.check("write_file")).toBe("restricted");
    expect(pm.check("legion_bus_publish")).toBe("unrestricted");
    expect(pm.check("legion_bus_claim")).toBe("unrestricted");
    expect(pm.check("read_file")).toBe("sandboxed"); // matches *
    expect(pm.ruleCount).toBe(4);
  });

  it("should load JSON policy", () => {
    const json = {
      defaultLevel: "sandboxed",
      rules: [
        { pattern: "exec", level: "restricted" },
        { pattern: "read_file", level: "unrestricted" },
      ],
    };
    fs.writeFileSync(path.join(tmpDir, "permissions.json"), JSON.stringify(json));

    const pm = new PermissionManager(
      { enabled: true, policyFile: "permissions.json", defaultLevel: "unrestricted" },
      tmpDir,
    );

    expect(pm.check("exec")).toBe("restricted");
    expect(pm.check("read_file")).toBe("unrestricted");
    expect(pm.check("unknown")).toBe("sandboxed"); // JSON default
  });

  it("should prioritize exact match over wildcard regardless of order", () => {
    const md = `| Tool Pattern | Level |
|---|---|
| * | restricted |
| exec | unrestricted |
`;
    fs.writeFileSync(path.join(tmpDir, "PERMISSIONS.md"), md);

    const pm = new PermissionManager(
      { enabled: true, policyFile: "PERMISSIONS.md", defaultLevel: "restricted" },
      tmpDir,
    );

    // exec: exact match → unrestricted (takes priority over *)
    expect(pm.check("exec")).toBe("unrestricted");
    // other tools only match * → restricted
    expect(pm.check("other")).toBe("restricted");
  });

  it("should handle glob patterns with * suffix", () => {
    const md = `| Tool Pattern | Level |
|---|---|
| task_* | supervised |
| knowledge_* | unrestricted |
`;
    fs.writeFileSync(path.join(tmpDir, "PERMISSIONS.md"), md);

    const pm = new PermissionManager(
      { enabled: true, policyFile: "PERMISSIONS.md", defaultLevel: "sandboxed" },
      tmpDir,
    );

    expect(pm.check("task_create")).toBe("supervised");
    expect(pm.check("task_list")).toBe("supervised");
    expect(pm.check("knowledge_add")).toBe("unrestricted");
    expect(pm.check("exec")).toBe("sandboxed"); // default
  });

  it("should ignore invalid levels in markdown", () => {
    const md = `| Tool Pattern | Level |
|---|---|
| exec | invalid_level |
| read_file | unrestricted |
`;
    fs.writeFileSync(path.join(tmpDir, "PERMISSIONS.md"), md);

    const pm = new PermissionManager(
      { enabled: true, policyFile: "PERMISSIONS.md", defaultLevel: "sandboxed" },
      tmpDir,
    );

    expect(pm.ruleCount).toBe(1); // only read_file parsed
    expect(pm.check("exec")).toBe("sandboxed"); // falls through to default
    expect(pm.check("read_file")).toBe("unrestricted");
  });
});
