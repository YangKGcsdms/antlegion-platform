/**
 * LLM 可调用的知识库工具
 * knowledge_add, knowledge_search, knowledge_list, knowledge_remove
 */

import type { ToolDefinition, ToolContext } from "./registry.js";
import type { KnowledgeBase } from "../knowledge/KnowledgeBase.js";
import type { KnowledgeCategory } from "../knowledge/types.js";

export function createKnowledgeTools(kb: KnowledgeBase): ToolDefinition[] {
  return [
    {
      name: "knowledge_add",
      description: "Store your own learned experience or useful knowledge for future reference. Knowledge persists across sessions. IMPORTANT: Only store your own experiences and patterns (e.g., coding patterns, tool usage tips). Do NOT store information from other agents' facts or bus events — use the fact bus and shared workspace for cross-agent information.",
      inputSchema: {
        type: "object",
        properties: {
          title: { type: "string", description: "Short descriptive title" },
          content: { type: "string", description: "The knowledge content" },
          tags: { type: "array", items: { type: "string" }, description: "Tags for search/categorization" },
          category: { type: "string", enum: ["learned", "manual", "external"], description: "Category, default 'learned'" },
          confidence: { type: "number", description: "Confidence 0-1, default 0.5" },
        },
        required: ["title", "content", "tags"],
      },
      execute: async (input: unknown, context: ToolContext) => {
        const params = input as {
          title: string;
          content: string;
          tags: string[];
          category?: KnowledgeCategory;
          confidence?: number;
        };
        const entry = kb.add({
          title: params.title,
          content: params.content,
          tags: params.tags,
          category: params.category ?? "learned",
          source: `agent:${context.agentId}`,
          confidence: params.confidence,
        });
        return { entryId: entry.entryId, title: entry.title, tags: entry.tags };
      },
    },
    {
      name: "knowledge_search",
      description: "Search the knowledge base by tags and/or keywords",
      inputSchema: {
        type: "object",
        properties: {
          tags: { type: "array", items: { type: "string" }, description: "Tags to match" },
          keyword: { type: "string", description: "Keyword to search in title and content" },
          category: { type: "string", enum: ["learned", "manual", "external"] },
          limit: { type: "number", description: "Max results, default 10" },
        },
      },
      execute: async (input: unknown, _context: ToolContext) => {
        const params = input as {
          tags?: string[];
          keyword?: string;
          category?: KnowledgeCategory;
          limit?: number;
        };
        const results = kb.search(params);
        return results.map((e) => ({
          entryId: e.entryId,
          title: e.title,
          content: e.content,
          tags: e.tags,
          category: e.category,
          confidence: e.confidence,
        }));
      },
    },
    {
      name: "knowledge_list",
      description: "List all entries in the knowledge base",
      inputSchema: {
        type: "object",
        properties: {},
      },
      execute: async (_input: unknown, _context: ToolContext) => {
        const entries = kb.listAll();
        return entries.map((e) => ({
          entryId: e.entryId,
          title: e.title,
          tags: e.tags,
          category: e.category,
          confidence: e.confidence,
          accessCount: e.accessCount,
        }));
      },
    },
    {
      name: "knowledge_remove",
      description: "Remove a knowledge entry by ID",
      inputSchema: {
        type: "object",
        properties: {
          entryId: { type: "string", description: "The entry ID to remove" },
        },
        required: ["entryId"],
      },
      execute: async (input: unknown, _context: ToolContext) => {
        const params = input as { entryId: string };
        const removed = kb.remove(params.entryId);
        return { removed, entryId: params.entryId };
      },
    },
  ];
}
