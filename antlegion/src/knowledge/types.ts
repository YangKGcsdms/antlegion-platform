/**
 * 知识库类型
 */

export type KnowledgeCategory = "learned" | "manual" | "external";

export interface KnowledgeEntry {
  entryId: string;
  category: KnowledgeCategory;
  tags: string[];
  title: string;
  content: string;
  source: string;
  confidence: number;
  createdAt: string;
  updatedAt: string;
  accessCount: number;
  lastAccessedAt: string | null;
}

export interface KnowledgeConfig {
  enabled: boolean;
  storageDir: string;
  maxEntries: number;
  maxPromptEntries: number;
}

export const DEFAULT_KNOWLEDGE_CONFIG: KnowledgeConfig = {
  enabled: false,
  storageDir: ".antlegion/knowledge",
  maxEntries: 1000,
  maxPromptEntries: 5,
};
