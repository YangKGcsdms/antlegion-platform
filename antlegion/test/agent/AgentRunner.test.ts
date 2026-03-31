import { describe, it, expect, vi } from "vitest";
import { AgentRunner } from "../../src/agent/AgentRunner.js";
import { ToolRegistry, type ToolContext } from "../../src/tools/registry.js";
import { Session } from "../../src/agent/Session.js";
import type { LlmProvider } from "../../src/providers/types.js";
import type { LlmResponse } from "../../src/types/messages.js";

function makeProvider(responses: LlmResponse[]): LlmProvider {
  let callIndex = 0;
  return {
    createMessage: vi.fn(async () => {
      if (callIndex >= responses.length) throw new Error("no more responses");
      return responses[callIndex++];
    }),
  };
}

const mockContext: ToolContext = {
  channel: {} as never,
  workspaceDir: "/tmp",
  agentId: "test",
  activeClaims: new Set(),
};

describe("AgentRunner", () => {
  it("should return on end_turn", async () => {
    const provider = makeProvider([
      { stopReason: "end_turn", content: [{ type: "text", text: "done" }] },
    ]);
    const registry = new ToolRegistry();
    const runner = new AgentRunner(provider, registry, mockContext, "test-model", 20);
    const session = new Session();
    session.appendUser("hello");

    const result = await runner.run("system prompt", session);
    expect(result.content).toHaveLength(1);
    expect(result.content[0]).toEqual({ type: "text", text: "done" });
  });

  it("should execute tool calls and continue", async () => {
    const provider = makeProvider([
      {
        stopReason: "tool_use",
        content: [
          { type: "tool_use", id: "t1", name: "echo", input: { msg: "hi" } },
        ],
      },
      { stopReason: "end_turn", content: [{ type: "text", text: "got result" }] },
    ]);

    const registry = new ToolRegistry();
    registry.register({
      name: "echo",
      description: "echo",
      inputSchema: { type: "object" },
      execute: async (input) => ({ echoed: (input as Record<string, unknown>).msg }),
    });

    const runner = new AgentRunner(provider, registry, mockContext, "m", 20);
    const session = new Session();
    session.appendUser("test");

    const result = await runner.run("sys", session);
    expect(result.content[0]).toEqual({ type: "text", text: "got result" });

    // session should have: user, assistant(tool_use), user(tool_result), assistant(end)
    expect(session.messageCount).toBe(4);
  });

  it("should return tool error as is_error result", async () => {
    const provider = makeProvider([
      {
        stopReason: "tool_use",
        content: [{ type: "tool_use", id: "t1", name: "fail_tool", input: {} }],
      },
      { stopReason: "end_turn", content: [{ type: "text", text: "handled error" }] },
    ]);

    const registry = new ToolRegistry();
    registry.register({
      name: "fail_tool",
      description: "always fails",
      inputSchema: { type: "object" },
      execute: async () => { throw new Error("broken"); },
    });

    const runner = new AgentRunner(provider, registry, mockContext, "m", 20);
    const session = new Session();
    session.appendUser("test");

    const result = await runner.run("sys", session);
    expect(result.content[0]).toEqual({ type: "text", text: "handled error" });

    // check that tool_result has is_error
    const msgs = session.getMessages();
    const toolResultMsg = msgs[2]; // user message with tool_results
    const content = toolResultMsg.content as Array<{ is_error?: boolean; content: string }>;
    expect(content[0].is_error).toBe(true);
    expect(content[0].content).toContain("broken");
  });

  it("should throw when max rounds exceeded", async () => {
    // always returns tool_use, never end_turn
    const infiniteProvider: LlmProvider = {
      createMessage: vi.fn(async () => ({
        stopReason: "tool_use" as const,
        content: [{ type: "tool_use" as const, id: "t1", name: "noop", input: {} }],
      })),
    };

    const registry = new ToolRegistry();
    registry.register({
      name: "noop",
      description: "noop",
      inputSchema: { type: "object" },
      execute: async () => ({}),
    });

    const runner = new AgentRunner(infiniteProvider, registry, mockContext, "m", 3);
    const session = new Session();
    session.appendUser("test");

    await expect(runner.run("sys", session)).rejects.toThrow("tool loop exceeded 3 rounds");
  });
});
