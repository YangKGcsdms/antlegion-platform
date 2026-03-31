#!/usr/bin/env node

/**
 * antlegion — Agent runtime for Ant Legion Bus
 */

import { loadConfig } from "./config/config.js";
import { Runtime } from "./runtime.js";

async function main() {
  const configPath = process.argv.includes("--config")
    ? process.argv[process.argv.indexOf("--config") + 1]
    : undefined;

  try {
    const config = loadConfig(configPath);
    console.log(`[antlegion] bus=${config.bus.url} name=${config.bus.name} workspace=${config.workspace}`);

    const runtime = new Runtime(config);
    await runtime.start();
  } catch (err) {
    console.error("[antlegion] fatal:", err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

main();
