import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Logger } from "../../src/observability/Logger.js";

describe("Logger", () => {
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    stderrSpy.mockRestore();
  });

  it("should log info to stderr as JSON", () => {
    const logger = new Logger("test", "info");
    logger.info("hello world");

    expect(stderrSpy).toHaveBeenCalledOnce();
    const output = stderrSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(output.trim());
    expect(parsed.level).toBe("info");
    expect(parsed.component).toBe("test");
    expect(parsed.msg).toBe("hello world");
    expect(parsed.ts).toBeDefined();
  });

  it("should include data field when provided", () => {
    const logger = new Logger("test", "info");
    logger.info("with data", { key: "value", count: 42 });

    const output = stderrSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(output.trim());
    expect(parsed.data).toEqual({ key: "value", count: 42 });
  });

  it("should filter by log level", () => {
    const logger = new Logger("test", "warn");
    logger.debug("hidden");
    logger.info("hidden");
    logger.warn("visible");
    logger.error("visible");

    expect(stderrSpy).toHaveBeenCalledTimes(2);
  });

  it("should create child logger with component prefix", () => {
    const parent = new Logger("runtime", "info");
    const child = parent.child("scheduler");
    child.info("tick");

    const output = stderrSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(output.trim());
    expect(parsed.component).toBe("runtime.scheduler");
  });

  it("should not log below minimum level", () => {
    const logger = new Logger("test", "error");
    logger.debug("no");
    logger.info("no");
    logger.warn("no");

    expect(stderrSpy).not.toHaveBeenCalled();
  });
});
