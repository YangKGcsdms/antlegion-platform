/**
 * SystemPromptBuilder — 分层组装 system prompt
 * 见 DESIGN.md §8
 *
 * 层次：Runtime Context → SOUL → AGENTS → TOOLS → Tool Descriptions → Skills → IDENTITY → Protocol Rules
 */

import type { ToolSchema } from "../types/messages.js";
import type { WorkspaceData } from "../workspace/loader.js";
import type { KnowledgeEntry } from "../knowledge/types.js";

export interface SystemPromptParams {
  antId: string;
  name: string;
  capabilities: string[];
  domainInterests: string[];
  factTypePatterns: string[];
  workspace: WorkspaceData;
  skillsPrompt: string;
  toolSchemas: ToolSchema[];
  knowledgeEntries?: KnowledgeEntry[];
}

export function buildSystemPrompt(params: SystemPromptParams): string {
  const sections: string[] = [];

  // 1. Runtime Context
  sections.push(buildRuntimeContext(params));

  // 2. SOUL.md
  if (params.workspace.files["SOUL.md"]) {
    sections.push(params.workspace.files["SOUL.md"]);
  }

  // 3. AGENTS.md
  if (params.workspace.files["AGENTS.md"]) {
    sections.push(params.workspace.files["AGENTS.md"]);
  }

  // 4. TOOLS.md
  if (params.workspace.files["TOOLS.md"]) {
    sections.push(params.workspace.files["TOOLS.md"]);
  }

  // 5. Tool Descriptions (auto-generated)
  sections.push(buildToolDescriptions(params.toolSchemas));

  // 6. Skills
  if (params.skillsPrompt) {
    sections.push(params.skillsPrompt);
  }

  // 6b. Learned Knowledge
  if (params.knowledgeEntries && params.knowledgeEntries.length > 0) {
    sections.push(buildKnowledgeSection(params.knowledgeEntries));
  }

  // 7. IDENTITY.md
  if (params.workspace.files["IDENTITY.md"]) {
    sections.push(params.workspace.files["IDENTITY.md"]);
  }

  // 8. BOOTSTRAP.md
  if (params.workspace.files["BOOTSTRAP.md"]) {
    sections.push(params.workspace.files["BOOTSTRAP.md"]);
  }

  // 9. Protocol Rules (always last — hard rules)
  sections.push(PROTOCOL_RULES);

  return sections.join("\n\n---\n\n");
}

function buildRuntimeContext(params: SystemPromptParams): string {
  return [
    "# Runtime",
    "",
    "你是 Ant Legion Bus 上的一个 Agent 节点。",
    "你通过事实（Fact）与其他 Agent 协作。没有人命令你——你根据收到的事实自主决策。",
    "",
    `- Agent ID: ${params.antId}`,
    `- Agent Name: ${params.name}`,
    `- Capabilities: ${params.capabilities.join(", ") || "general"}`,
    `- Domain Interests: ${params.domainInterests.join(", ") || "all"}`,
    `- Fact Type Patterns: ${params.factTypePatterns.join(", ") || "*"}`,
    `- Current Time: ${new Date().toISOString()}`,
  ].join("\n");
}

function buildToolDescriptions(tools: ToolSchema[]): string {
  if (tools.length === 0) return "";

  const lines = ["## Available Tools", ""];
  for (const tool of tools) {
    lines.push(`### ${tool.name}`);
    lines.push(tool.description);
    lines.push("");
  }
  return lines.join("\n");
}

function buildKnowledgeSection(entries: KnowledgeEntry[]): string {
  const lines = ["## Learned Knowledge", ""];
  for (const entry of entries) {
    lines.push(`- **${entry.title}** [${entry.tags.join(", ")}] (confidence: ${entry.confidence})`);
    lines.push(`  ${entry.content}`);
    lines.push("");
  }
  return lines.join("\n");
}

const PROTOCOL_RULES = `## Protocol Rules (MUST follow)

- 只对 exclusive 模式的事实执行 legion_bus_claim
- claim 失败后不得重试同一个 fact_id
- claim 后必须 legion_bus_resolve 或 legion_bus_release，不得悬挂
- 不得 corroborate/contradict 自己发布的事实
- 不得在 payload 中嵌入对其他 agent 的命令
- fact_type 使用点号分隔命名（如 code.review.needed）
- resolve 时尽量附带 result_facts 描述产出
- 不确定的事情发布 observation，不假装知道`;
