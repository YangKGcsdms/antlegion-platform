import { describe, it, expect } from "vitest";
import { Session } from "../../src/agent/Session.js";

describe("Session", () => {
  it("should append and retrieve messages", () => {
    const s = new Session();
    s.appendUser("hello");
    s.appendAssistant([{ type: "text", text: "hi" }]);

    const msgs = s.getMessages();
    expect(msgs).toHaveLength(2);
    expect(msgs[0]).toEqual({ role: "user", content: "hello" });
    expect(msgs[1]).toEqual({ role: "assistant", content: [{ type: "text", text: "hi" }] });
  });

  it("should append tool results", () => {
    const s = new Session();
    s.appendUser("do something");
    s.appendToolResults([
      { type: "tool_result", tool_use_id: "t1", content: '{"ok":true}' },
    ]);

    expect(s.messageCount).toBe(2);
  });

  it("should track current turn messages", () => {
    const s = new Session();
    s.appendUser("turn 1");
    s.appendAssistant([{ type: "text", text: "response 1" }]);
    s.appendUser("turn 2");
    s.appendAssistant([{ type: "text", text: "response 2" }]);

    const current = s.currentTurnMessages();
    expect(current).toHaveLength(2);
    expect(current[0].content).toBe("turn 2");
  });

  it("should not trim within keepTurns", () => {
    const s = new Session(3);
    s.appendUser("turn 1");
    s.sealCurrentTurn();
    s.appendUser("turn 2");
    s.sealCurrentTurn();
    s.appendUser("turn 3");
    s.sealCurrentTurn();

    // 3 turns, keepTurns=3 — no trimming
    expect(s.messageCount).toBe(3);
  });

  it("should trim when exceeding keepTurns", () => {
    const s = new Session(2);

    s.appendUser("turn 1");
    s.appendAssistant([{ type: "text", text: "r1" }]);
    s.sealCurrentTurn();

    s.appendUser("turn 2");
    s.appendAssistant([{ type: "text", text: "r2" }]);
    s.sealCurrentTurn();

    s.appendUser("turn 3");
    s.appendAssistant([{ type: "text", text: "r3" }]);
    s.sealCurrentTurn(); // turnCount=3 > keepTurns=2 → trims

    const msgs = s.getMessages();
    // first message should be a trim summary
    expect(typeof msgs[0].content).toBe("string");
    expect(msgs[0].content as string).toContain("trimmed");
  });

  it("should seal with explicit summary", () => {
    const s = new Session(1);

    s.appendUser("turn 1");
    s.sealCurrentTurn();

    s.appendUser("turn 2");
    s.sealCurrentTurn("handled code review");

    const msgs = s.getMessages();
    expect(msgs[0].content as string).toContain("handled code review");
  });

  it("should estimate tokens", () => {
    const s = new Session();
    s.appendUser("hello world"); // 11 chars
    expect(s.estimatedTokens).toBeGreaterThan(0);
    expect(s.estimatedTokens).toBeLessThan(10);
  });

  it("should estimate tokens for content blocks", () => {
    const s = new Session();
    s.appendAssistant([{ type: "text", text: "a".repeat(350) }]);
    // 350 / 3.5 = 100
    expect(s.estimatedTokens).toBe(100);
  });
});
