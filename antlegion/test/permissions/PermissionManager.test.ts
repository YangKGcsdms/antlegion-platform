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
      { enabled: true, policyFile: "PERMISSIONS.md", defaultLevel: "allow" },
      tmpDir,
    );
    expect(pm.check("exec")).toBe("allow");
    expect(pm.check("anything")).toBe("allow");
    expect(pm.isAllowed("anything")).toBe(true);
  });

  it("should load and apply markdown policy with allow/deny", () => {
    const md = `# Permissions

| Tool Pattern   | Level |
|----------------|-------|
| exec           | allow |
| write_file     | deny  |
| legion_bus_*   | allow |
| *              | deny  |
`;
    fs.writeFileSync(path.join(tmpDir, "PERMISSIONS.md"), md);

    const pm = new PermissionManager(
      { enabled: true, policyFile: "PERMISSIONS.md", defaultLevel: "allow" },
      tmpDir,
    );

    expect(pm.check("exec")).toBe("allow");
    expect(pm.check("write_file")).toBe("deny");
    expect(pm.check("legion_bus_publish")).toBe("allow");
    expect(pm.check("legion_bus_claim")).toBe("allow");
    expect(pm.check("read_file")).toBe("deny"); // matches *
    expect(pm.isAllowed("exec")).toBe(true);
    expect(pm.isAllowed("write_file")).toBe(false);
    expect(pm.ruleCount).toBe(4);
  });

  it("should normalize legacy levels (unrestricted→allow, restricted→deny)", () => {
    const md = `| Tool Pattern   | Level        |
|----------------|-------------|
| exec           | supervised  |
| write_file     | restricted  |
| legion_bus_*   | unrestricted|
| *              | sandboxed   |
`;
    fs.writeFileSync(path.join(tmpDir, "PERMISSIONS.md"), md);

    const pm = new PermissionManager(
      { enabled: true, policyFile: "PERMISSIONS.md", defaultLevel: "allow" },
      tmpDir,
    );

    expect(pm.check("exec")).toBe("allow");        // supervised → allow
    expect(pm.check("write_file")).toBe("deny");    // restricted → deny
    expect(pm.check("legion_bus_publish")).toBe("allow"); // unrestricted → allow
    expect(pm.check("read_file")).toBe("deny");     // sandboxed → deny
  });

  it("should load JSON policy", () => {
    const json = {
      defaultLevel: "deny",
      rules: [
        { pattern: "exec", level: "deny" },
        { pattern: "read_file", level: "allow" },
      ],
    };
    fs.writeFileSync(path.join(tmpDir, "permissions.json"), JSON.stringify(json));

    const pm = new PermissionManager(
      { enabled: true, policyFile: "permissions.json", defaultLevel: "allow" },
      tmpDir,
    );

    expect(pm.check("exec")).toBe("deny");
    expect(pm.check("read_file")).toBe("allow");
    expect(pm.check("unknown")).toBe("deny"); // JSON default
  });

  it("should prioritize exact match over wildcard regardless of order", () => {
    const md = `| Tool Pattern | Level |
|---|---|
| * | deny |
| exec | allow |
`;
    fs.writeFileSync(path.join(tmpDir, "PERMISSIONS.md"), md);

    const pm = new PermissionManager(
      { enabled: true, policyFile: "PERMISSIONS.md", defaultLevel: "deny" },
      tmpDir,
    );

    expect(pm.check("exec")).toBe("allow");
    expect(pm.check("other")).toBe("deny");
  });

  it("should handle glob patterns with * suffix", () => {
    const md = `| Tool Pattern | Level |
|---|---|
| task_* | allow |
| danger_* | deny |
`;
    fs.writeFileSync(path.join(tmpDir, "PERMISSIONS.md"), md);

    const pm = new PermissionManager(
      { enabled: true, policyFile: "PERMISSIONS.md", defaultLevel: "deny" },
      tmpDir,
    );

    expect(pm.check("task_create")).toBe("allow");
    expect(pm.check("task_list")).toBe("allow");
    expect(pm.check("danger_tool")).toBe("deny");
    expect(pm.check("exec")).toBe("deny"); // default
  });

  it("should ignore invalid levels in markdown", () => {
    const md = `| Tool Pattern | Level |
|---|---|
| exec | invalid_level |
| read_file | allow |
`;
    fs.writeFileSync(path.join(tmpDir, "PERMISSIONS.md"), md);

    const pm = new PermissionManager(
      { enabled: true, policyFile: "PERMISSIONS.md", defaultLevel: "deny" },
      tmpDir,
    );

    expect(pm.ruleCount).toBe(1); // only read_file parsed
    expect(pm.check("exec")).toBe("deny"); // falls through to default
    expect(pm.check("read_file")).toBe("allow");
  });
});
