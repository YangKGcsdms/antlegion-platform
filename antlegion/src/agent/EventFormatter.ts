/**
 * EventFormatter — BusEvent[] → LLM user message
 * 见 DESIGN.md §5
 */

import type { BusEvent } from "../types/protocol.js";

export function formatEvents(
  events: BusEvent[],
  dropped: number,
  causationMemory: string,
): string {
  const lines: string[] = [];

  if (causationMemory) {
    lines.push(causationMemory);
  }

  if (dropped > 0) {
    lines.push(`[WARNING] ${dropped} events dropped (queue overflow)\n`);
  }

  lines.push(`## New Events (${events.length})\n`);

  for (const event of events) {
    lines.push(`### ${event.event_type}`);

    if (event.fact) {
      const f = event.fact;
      lines.push(`- fact_id: ${f.fact_id}`);
      lines.push(`- fact_type: ${f.fact_type}`);
      lines.push(`- mode: ${f.mode}`);
      lines.push(`- state: ${f.state}`);
      lines.push(`- priority: ${f.priority}`);
      if (f.semantic_kind) lines.push(`- semantic_kind: ${f.semantic_kind}`);
      if (f.parent_fact_id) lines.push(`- parent_fact_id: ${f.parent_fact_id}`);
      if (f.causation_depth > 0) lines.push(`- causation_depth: ${f.causation_depth}`);
      if (f.need_capabilities?.length) lines.push(`- need_capabilities: ${f.need_capabilities.join(", ")}`);
      if (f.domain_tags?.length) lines.push(`- domain_tags: ${f.domain_tags.join(", ")}`);
      lines.push(`- payload:`);
      lines.push("```json");
      lines.push(JSON.stringify(f.payload, null, 2));
      lines.push("```");
    }

    if (event.detail) {
      lines.push(`- detail: ${event.detail}`);
    }

    lines.push("");
  }

  lines.push("Decide what action to take based on your SOUL and capabilities.");
  return lines.join("\n");
}
