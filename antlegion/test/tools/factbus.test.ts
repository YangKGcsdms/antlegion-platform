import { describe, it, expect } from "vitest";
import { createLegionBusTools } from "../../src/tools/factbus.js";

describe("createLegionBusTools", () => {
  const tools = createLegionBusTools();

  it("should create 8 tools", () => {
    expect(tools).toHaveLength(8);
  });

  it("should have correct tool names", () => {
    const names = tools.map((t) => t.name);
    expect(names).toContain("legion_bus_publish");
    expect(names).toContain("legion_bus_claim");
    expect(names).toContain("legion_bus_resolve");
    expect(names).toContain("legion_bus_release");
    expect(names).toContain("legion_bus_corroborate");
    expect(names).toContain("legion_bus_contradict");
    expect(names).toContain("legion_bus_sense");
    expect(names).toContain("legion_bus_query");
  });

  it("should have required fields in publish schema", () => {
    const publish = tools.find((t) => t.name === "legion_bus_publish")!;
    const schema = publish.inputSchema as { required?: string[] };
    expect(schema.required).toContain("fact_type");
    expect(schema.required).toContain("payload");
  });

  it("should have required fields in claim schema", () => {
    const claim = tools.find((t) => t.name === "legion_bus_claim")!;
    const schema = claim.inputSchema as { required?: string[] };
    expect(schema.required).toContain("fact_id");
  });

  it("should have required fields in resolve schema", () => {
    const resolve = tools.find((t) => t.name === "legion_bus_resolve")!;
    const schema = resolve.inputSchema as { required?: string[] };
    expect(schema.required).toContain("fact_id");
  });

  it("claim should add to activeClaims on success", async () => {
    const claim = tools.find((t) => t.name === "legion_bus_claim")!;
    const activeClaims = new Set<string>();
    const ctx = {
      channel: { claim: async () => ({ success: true }) } as never,
      workspaceDir: "/tmp",
      agentId: "test",
      activeClaims,
    };

    await claim.execute({ fact_id: "f1" }, ctx);
    expect(activeClaims.has("f1")).toBe(true);
  });

  it("claim should not add to activeClaims on failure", async () => {
    const claim = tools.find((t) => t.name === "legion_bus_claim")!;
    const activeClaims = new Set<string>();
    const ctx = {
      channel: { claim: async () => ({ success: false, error: "already claimed" }) } as never,
      workspaceDir: "/tmp",
      agentId: "test",
      activeClaims,
    };

    await claim.execute({ fact_id: "f1" }, ctx);
    expect(activeClaims.has("f1")).toBe(false);
  });

  it("resolve should remove from activeClaims", async () => {
    const resolve = tools.find((t) => t.name === "legion_bus_resolve")!;
    const activeClaims = new Set(["f1"]);
    const ctx = {
      channel: { resolve: async () => {} } as never,
      workspaceDir: "/tmp",
      agentId: "test",
      activeClaims,
    };

    await resolve.execute({ fact_id: "f1" }, ctx);
    expect(activeClaims.has("f1")).toBe(false);
  });

  it("release should remove from activeClaims", async () => {
    const release = tools.find((t) => t.name === "legion_bus_release")!;
    const activeClaims = new Set(["f1"]);
    const ctx = {
      channel: { release: async () => {} } as never,
      workspaceDir: "/tmp",
      agentId: "test",
      activeClaims,
    };

    await release.execute({ fact_id: "f1" }, ctx);
    expect(activeClaims.has("f1")).toBe(false);
  });
});
