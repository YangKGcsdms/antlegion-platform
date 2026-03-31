import { describe, it, expect } from "vitest";
import { nextCronMatch } from "../../src/scheduler/cron.js";

describe("cron parser", () => {
  it("should match every minute (* * * * *)", () => {
    const after = new Date("2026-01-01T12:00:00.000Z");
    const next = nextCronMatch("* * * * *", after);
    // next minute after 12:00 is 12:01 (local time matters, just check it's 1 minute later)
    expect(next.getTime() - after.getTime()).toBeLessThanOrEqual(60_000);
    expect(next.getTime()).toBeGreaterThan(after.getTime());
  });

  it("should match specific minute", () => {
    const after = new Date(2026, 0, 1, 12, 0, 0); // local time
    const next = nextCronMatch("30 * * * *", after);
    expect(next.getMinutes()).toBe(30);
    expect(next.getHours()).toBe(12);
  });

  it("should match specific hour and minute", () => {
    const after = new Date(2026, 0, 1, 12, 0, 0);
    const next = nextCronMatch("0 14 * * *", after);
    expect(next.getMinutes()).toBe(0);
    expect(next.getHours()).toBe(14);
  });

  it("should wrap to next day if past the time", () => {
    const after = new Date(2026, 0, 1, 15, 0, 0);
    const next = nextCronMatch("0 14 * * *", after);
    expect(next.getHours()).toBe(14);
    expect(next.getDate()).toBe(2);
  });

  it("should match comma-separated values", () => {
    const after = new Date(2026, 0, 1, 12, 0, 0);
    const next = nextCronMatch("0,15,30,45 * * * *", after);
    expect(next.getMinutes()).toBe(15);
  });

  it("should match specific day of month", () => {
    const after = new Date(2026, 0, 15, 0, 0, 0);
    const next = nextCronMatch("0 0 20 * *", after);
    expect(next.getDate()).toBe(20);
  });

  it("should throw on invalid cron expression", () => {
    expect(() => nextCronMatch("invalid", new Date())).toThrow("invalid cron expression");
  });

  it("should throw on wrong field count", () => {
    expect(() => nextCronMatch("* * *", new Date())).toThrow("expected 5 fields");
  });
});
