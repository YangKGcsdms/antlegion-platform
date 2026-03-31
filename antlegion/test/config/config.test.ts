import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "../../src/config/config.js";

let tmpDir: string;
const savedEnv: Record<string, string | undefined> = {};

function saveEnv(...keys: string[]) {
  for (const k of keys) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
}

function restoreEnv() {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cfg-"));
  saveEnv("ANT_BUS_URL", "ANTHROPIC_API_KEY", "LLM_API_KEY", "LLM_MODEL", "LLM_BASE_URL", "ANT_WORKSPACE", "ANTLEGION_CONFIG");
});

afterEach(() => {
  restoreEnv();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("loadConfig", () => {
  it("should load from config file", () => {
    const cfgPath = path.join(tmpDir, "antlegion.json");
    fs.writeFileSync(cfgPath, JSON.stringify({
      bus: { url: "http://bus:8080", name: "test", filter: {} },
      provider: { type: "anthropic", model: "claude-test", apiKey: "sk-test" },
      workspace: "/workspace",
    }));

    const config = loadConfig(cfgPath);
    expect(config.bus.url).toBe("http://bus:8080");
    expect(config.bus.name).toBe("test");
    expect(config.provider.model).toBe("claude-test");
    expect(config.provider.apiKey).toBe("sk-test");
  });

  it("should override with env vars", () => {
    const cfgPath = path.join(tmpDir, "antlegion.json");
    fs.writeFileSync(cfgPath, JSON.stringify({
      bus: { url: "http://file:8080", name: "file-agent", filter: {} },
      provider: { type: "anthropic", model: "file-model", apiKey: "file-key" },
    }));

    process.env.ANT_BUS_URL = "http://env:9090";
    process.env.LLM_MODEL = "env-model";
    process.env.ANTHROPIC_API_KEY = "env-key";

    const config = loadConfig(cfgPath);
    expect(config.bus.url).toBe("http://env:9090");
    expect(config.provider.model).toBe("env-model");
    expect(config.provider.apiKey).toBe("env-key");
  });

  it("should resolve env: references in apiKey", () => {
    const cfgPath = path.join(tmpDir, "antlegion.json");
    fs.writeFileSync(cfgPath, JSON.stringify({
      bus: { url: "http://bus:8080", name: "test", filter: {} },
      provider: { type: "anthropic", model: "m", apiKey: "env:MY_SECRET_KEY" },
    }));

    process.env.MY_SECRET_KEY = "resolved-secret";

    const config = loadConfig(cfgPath);
    expect(config.provider.apiKey).toBe("resolved-secret");
  });

  it("should throw when env: reference is missing", () => {
    const cfgPath = path.join(tmpDir, "antlegion.json");
    fs.writeFileSync(cfgPath, JSON.stringify({
      bus: { url: "http://bus:8080", name: "test", filter: {} },
      provider: { type: "anthropic", model: "m", apiKey: "env:MISSING_VAR" },
    }));

    expect(() => loadConfig(cfgPath)).toThrow("MISSING_VAR");
  });

  it("should throw when no API key at all", () => {
    const cfgPath = path.join(tmpDir, "antlegion.json");
    fs.writeFileSync(cfgPath, JSON.stringify({
      bus: { url: "http://bus:8080", name: "test", filter: {} },
      provider: { type: "anthropic", model: "m" },
    }));

    expect(() => loadConfig(cfgPath)).toThrow("No LLM API key");
  });

  it("should apply default agent config", () => {
    const cfgPath = path.join(tmpDir, "antlegion.json");
    fs.writeFileSync(cfgPath, JSON.stringify({
      bus: { url: "http://bus:8080", name: "test", filter: {} },
      provider: { type: "anthropic", apiKey: "sk-test" },
    }));

    const config = loadConfig(cfgPath);
    expect(config.agent.loopInterval).toBe(1000);
    expect(config.agent.heartbeatInterval).toBe(30000);
    expect(config.agent.maxToolRounds).toBe(20);
  });

  it("should handle missing config file gracefully", () => {
    process.env.ANTHROPIC_API_KEY = "sk-from-env";
    const config = loadConfig(path.join(tmpDir, "nonexistent.json"));
    expect(config.bus.url).toBe("http://localhost:28080");
    expect(config.provider.apiKey).toBe("sk-from-env");
  });
});
