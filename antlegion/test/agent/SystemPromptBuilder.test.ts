import { describe, it, expect } from "vitest";
import { buildSystemPrompt, type SystemPromptParams } from "../../src/agent/SystemPromptBuilder.js";

function makeParams(overrides: Partial<SystemPromptParams> = {}): SystemPromptParams {
  return {
    antId: "ant-123",
    name: "test-agent",
    capabilities: ["coding", "review"],
    domainInterests: ["code"],
    factTypePatterns: ["code.*"],
    workspace: { files: {}, dir: "/workspace" },
    skillsPrompt: "",
    toolSchemas: [],
    ...overrides,
  };
}

describe("SystemPromptBuilder", () => {
  it("should include runtime context", () => {
    const prompt = buildSystemPrompt(makeParams());
    expect(prompt).toContain("# Runtime");
    expect(prompt).toContain("Agent ID: ant-123");
    expect(prompt).toContain("Agent Name: test-agent");
    expect(prompt).toContain("coding, review");
  });

  it("should always include protocol rules", () => {
    const prompt = buildSystemPrompt(makeParams());
    expect(prompt).toContain("Protocol Rules (MUST follow)");
    expect(prompt).toContain("claim 失败后不得重试");
  });

  it("should include SOUL.md when present", () => {
    const prompt = buildSystemPrompt(makeParams({
      workspace: { files: { "SOUL.md": "# Developer\nI am a dev agent." }, dir: "/w" },
    }));
    expect(prompt).toContain("# Developer");
    expect(prompt).toContain("I am a dev agent.");
  });

  it("should include AGENTS.md when present", () => {
    const prompt = buildSystemPrompt(makeParams({
      workspace: { files: { "AGENTS.md": "# Network\nFour agents." }, dir: "/w" },
    }));
    expect(prompt).toContain("# Network");
  });

  it("should include tool descriptions", () => {
    const prompt = buildSystemPrompt(makeParams({
      toolSchemas: [
        { name: "read_file", description: "Read a file", input_schema: {} },
        { name: "exec", description: "Run command", input_schema: {} },
      ],
    }));
    expect(prompt).toContain("## Available Tools");
    expect(prompt).toContain("### read_file");
    expect(prompt).toContain("### exec");
  });

  it("should include skills prompt", () => {
    const prompt = buildSystemPrompt(makeParams({
      skillsPrompt: "## Skills\n\n### Skill: code-review\nReview code carefully.",
    }));
    expect(prompt).toContain("## Skills");
    expect(prompt).toContain("### Skill: code-review");
  });

  it("should separate sections with ---", () => {
    const prompt = buildSystemPrompt(makeParams({
      workspace: { files: { "SOUL.md": "soul content" }, dir: "/w" },
    }));
    expect(prompt).toContain("\n\n---\n\n");
  });

  it("should handle empty capabilities", () => {
    const prompt = buildSystemPrompt(makeParams({ capabilities: [] }));
    expect(prompt).toContain("Capabilities: general");
  });

  it("should include all workspace files in order", () => {
    const prompt = buildSystemPrompt(makeParams({
      workspace: {
        files: {
          "SOUL.md": "SOUL_CONTENT",
          "AGENTS.md": "AGENTS_CONTENT",
          "TOOLS.md": "TOOLS_CONTENT",
          "IDENTITY.md": "IDENTITY_CONTENT",
          "BOOTSTRAP.md": "BOOTSTRAP_CONTENT",
        },
        dir: "/w",
      },
    }));

    const soulIdx = prompt.indexOf("SOUL_CONTENT");
    const agentsIdx = prompt.indexOf("AGENTS_CONTENT");
    const toolsIdx = prompt.indexOf("TOOLS_CONTENT");
    const identityIdx = prompt.indexOf("IDENTITY_CONTENT");
    const bootstrapIdx = prompt.indexOf("BOOTSTRAP_CONTENT");
    const protocolIdx = prompt.indexOf("Protocol Rules");

    // verify ordering
    expect(soulIdx).toBeLessThan(agentsIdx);
    expect(agentsIdx).toBeLessThan(toolsIdx);
    expect(toolsIdx).toBeLessThan(identityIdx);
    expect(identityIdx).toBeLessThan(bootstrapIdx);
    expect(bootstrapIdx).toBeLessThan(protocolIdx);
  });
});
