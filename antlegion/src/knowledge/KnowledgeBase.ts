/**
 * KnowledgeBase — 跨 session 知识库
 * 文件持久化 + 标签/关键词搜索
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { KnowledgeEntry, KnowledgeCategory, KnowledgeConfig } from "./types.js";

interface IndexEntry {
  entryId: string;
  category: KnowledgeCategory;
  tags: string[];
  title: string;
  confidence: number;
  updatedAt: string;
  accessCount: number;
}

export class KnowledgeBase {
  private index = new Map<string, IndexEntry>();
  private storageDir: string;
  private indexPath: string;

  constructor(
    private config: KnowledgeConfig,
    workspaceDir: string,
  ) {
    this.storageDir = path.isAbsolute(config.storageDir)
      ? config.storageDir
      : path.join(workspaceDir, config.storageDir);
    this.indexPath = path.join(this.storageDir, "_index.json");
  }

  async init(): Promise<void> {
    fs.mkdirSync(this.storageDir, { recursive: true });

    if (fs.existsSync(this.indexPath)) {
      try {
        const raw = JSON.parse(fs.readFileSync(this.indexPath, "utf-8"));
        if (Array.isArray(raw)) {
          for (const entry of raw) {
            this.index.set(entry.entryId, entry);
          }
        }
      } catch {
        // 索引损坏，重建
      }
    }
  }

  add(input: {
    category: KnowledgeCategory;
    tags: string[];
    title: string;
    content: string;
    source: string;
    confidence?: number;
  }): KnowledgeEntry {
    if (this.index.size >= this.config.maxEntries) {
      this.evictOldest();
    }

    const now = new Date().toISOString();
    const entry: KnowledgeEntry = {
      entryId: crypto.randomUUID(),
      category: input.category,
      tags: input.tags,
      title: input.title,
      content: input.content,
      source: input.source,
      confidence: input.confidence ?? 0.5,
      createdAt: now,
      updatedAt: now,
      accessCount: 0,
      lastAccessedAt: null,
    };

    this.persistEntry(entry);
    this.index.set(entry.entryId, {
      entryId: entry.entryId,
      category: entry.category,
      tags: entry.tags,
      title: entry.title,
      confidence: entry.confidence,
      updatedAt: entry.updatedAt,
      accessCount: 0,
    });
    this.persistIndex();

    return entry;
  }

  remove(entryId: string): boolean {
    if (!this.index.has(entryId)) return false;
    this.index.delete(entryId);

    const filePath = path.join(this.storageDir, `${entryId}.json`);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    this.persistIndex();
    return true;
  }

  search(query: {
    tags?: string[];
    keyword?: string;
    category?: KnowledgeCategory;
    limit?: number;
  }): KnowledgeEntry[] {
    const limit = query.limit ?? 10;
    const candidates: Array<{ entry: KnowledgeEntry; score: number }> = [];

    for (const idx of this.index.values()) {
      if (query.category && idx.category !== query.category) continue;

      let score = 0;

      // 标签匹配
      if (query.tags) {
        const matched = query.tags.filter((t) =>
          idx.tags.some((it) => it.toLowerCase() === t.toLowerCase())
        ).length;
        if (matched === 0 && !query.keyword) continue;
        score += matched * 10;
      }

      // 关键词匹配 (标题)
      if (query.keyword) {
        const kw = query.keyword.toLowerCase();
        if (idx.title.toLowerCase().includes(kw)) {
          score += 5;
        } else if (!query.tags || score === 0) {
          // 需要读取完整内容做匹配
          const full = this.loadEntry(idx.entryId);
          if (full && full.content.toLowerCase().includes(kw)) {
            score += 2;
          } else {
            continue;
          }
        }
      }

      if (score === 0 && (query.tags || query.keyword)) continue;

      // 加载完整条目
      const entry = this.loadEntry(idx.entryId);
      if (!entry) continue;

      // 访问频率加分
      score += Math.min(idx.accessCount * 0.1, 3);
      // 置信度加分
      score += idx.confidence * 2;

      candidates.push({ entry, score });
    }

    candidates.sort((a, b) => b.score - a.score);

    // 更新访问计数
    const results = candidates.slice(0, limit).map((c) => {
      c.entry.accessCount++;
      c.entry.lastAccessedAt = new Date().toISOString();
      this.persistEntry(c.entry);

      const idx = this.index.get(c.entry.entryId);
      if (idx) idx.accessCount++;

      return c.entry;
    });

    if (results.length > 0) this.persistIndex();
    return results;
  }

  /** 获取适合注入到 system prompt 的知识条目 */
  getRelevantForPrompt(contextHints: string[]): KnowledgeEntry[] {
    if (this.index.size === 0) return [];

    // 用 hints 作为 tags + keywords 搜索
    return this.search({
      tags: contextHints,
      limit: this.config.maxPromptEntries,
    });
  }

  listAll(): KnowledgeEntry[] {
    const entries: KnowledgeEntry[] = [];
    for (const idx of this.index.values()) {
      const entry = this.loadEntry(idx.entryId);
      if (entry) entries.push(entry);
    }
    return entries;
  }

  get size(): number {
    return this.index.size;
  }

  // ──── private ────

  private loadEntry(entryId: string): KnowledgeEntry | null {
    const filePath = path.join(this.storageDir, `${entryId}.json`);
    if (!fs.existsSync(filePath)) return null;
    try {
      return JSON.parse(fs.readFileSync(filePath, "utf-8"));
    } catch {
      return null;
    }
  }

  private persistEntry(entry: KnowledgeEntry): void {
    const filePath = path.join(this.storageDir, `${entry.entryId}.json`);
    fs.writeFileSync(filePath, JSON.stringify(entry, null, 2));
  }

  private persistIndex(): void {
    const entries = Array.from(this.index.values());
    fs.writeFileSync(this.indexPath, JSON.stringify(entries, null, 2));
  }

  private evictOldest(): void {
    // 淘汰 accessCount 最低的条目
    let oldest: IndexEntry | null = null;
    for (const entry of this.index.values()) {
      if (!oldest || entry.accessCount < oldest.accessCount) {
        oldest = entry;
      }
    }
    if (oldest) {
      this.remove(oldest.entryId);
    }
  }
}
