/**
 * FactMemory — 按 fact_id 固化上下文，因果链按需加载
 * 见 DESIGN.md §4
 */

import fs from "node:fs";
import path from "node:path";
import type { BusEvent } from "../types/protocol.js";

export interface FactMemoryRecord {
  factId: string;
  factType: string;
  summary: string;
  payload: Record<string, unknown>;
  resolvedWith?: string[];
  timestamp: number;
}

export class FactMemory {
  private dir: string;

  constructor(dir: string) {
    this.dir = dir;
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  /** 固化一条 fact 的处理记忆 */
  persist(record: FactMemoryRecord): void {
    const filePath = path.join(this.dir, `${record.factId}.json`);
    fs.writeFileSync(filePath, JSON.stringify(record, null, 2));
  }

  /** 加载单条 fact 记忆 */
  load(factId: string): FactMemoryRecord | null {
    const filePath = path.join(this.dir, `${factId}.json`);
    if (!fs.existsSync(filePath)) return null;
    try {
      return JSON.parse(fs.readFileSync(filePath, "utf-8")) as FactMemoryRecord;
    } catch {
      return null;
    }
  }

  /** 根据事件的因果链加载祖先记忆，返回格式化文本 */
  loadForEvents(events: BusEvent[]): string {
    const ancestorIds = new Set<string>();
    for (const event of events) {
      if (event.fact?.causation_chain) {
        for (const id of event.fact.causation_chain) {
          ancestorIds.add(id);
        }
      }
    }

    const lines: string[] = [];
    for (const id of ancestorIds) {
      const record = this.load(id);
      if (record) {
        lines.push(`[Ancestor fact ${id}] ${record.factType}: ${record.summary}`);
      }
    }

    if (lines.length === 0) return "";
    return "## Causation Context\n\n" + lines.join("\n") + "\n";
  }
}
