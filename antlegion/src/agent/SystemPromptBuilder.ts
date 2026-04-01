/**
 * SystemPromptBuilder — 分层组装 system prompt
 *
 * 层次（按 order 排序）：
 *   10  Runtime Context
 *   20  SOUL.md
 *   30  AGENTS.md
 *   40  TOOLS.md
 *   50  Tool Descriptions (auto-generated)
 *   60  Skills
 *   65  (插件片段默认插入区间)
 *   70  IDENTITY.md
 *   75  BOOTSTRAP.md
 *   80  MEMORY.md
 *   90  Protocol Rules (hard rules, always last)
 *
 * 插件通过 addPromptSection() 注入自定义片段。
 */

import type { ToolSchema } from "../types/messages.js";
import type { WorkspaceData } from "../workspace/loader.js";
import type { PromptSection, PromptBuildContext } from "../plugins/types.js";

export interface SystemPromptParams {
  antId: string;
  name: string;
  capabilities: string[];
  domainInterests: string[];
  factTypePatterns: string[];
  workspace: WorkspaceData;
  skillsPrompt: string;
  toolSchemas: ToolSchema[];
  /** 插件注入的动态片段 */
  pluginSections?: PromptSection[];
}

export function buildSystemPrompt(params: SystemPromptParams): string {
  // 将所有内容统一为 { order, content } 片段，最终按 order 排序拼接
  const fragments: Array<{ order: number; content: string }> = [];

  // 1. Runtime Context (order: 10)
  fragments.push({ order: 10, content: buildRuntimeContext(params) });

  // 2. SOUL.md (order: 20)
  if (params.workspace.files["SOUL.md"]) {
    fragments.push({ order: 20, content: params.workspace.files["SOUL.md"] });
  }

  // 3. AGENTS.md (order: 30)
  if (params.workspace.files["AGENTS.md"]) {
    fragments.push({ order: 30, content: params.workspace.files["AGENTS.md"] });
  }

  // 4. TOOLS.md (order: 40)
  if (params.workspace.files["TOOLS.md"]) {
    fragments.push({ order: 40, content: params.workspace.files["TOOLS.md"] });
  }

  // 5. Tool Descriptions (order: 50)
  const toolDesc = buildToolDescriptions(params.toolSchemas);
  if (toolDesc) {
    fragments.push({ order: 50, content: toolDesc });
  }

  // 6. Skills (order: 60)
  if (params.skillsPrompt) {
    fragments.push({ order: 60, content: params.skillsPrompt });
  }

  // 7. Plugin sections (dynamic)
  if (params.pluginSections) {
    const buildCtx: PromptBuildContext = {
      agentId: params.antId,
      name: params.name,
      domainInterests: params.domainInterests,
      factTypePatterns: params.factTypePatterns,
    };
    for (const section of params.pluginSections) {
      const content = section.build(buildCtx);
      if (content) {
        fragments.push({ order: section.order, content });
      }
    }
  }

  // 8. IDENTITY.md (order: 70)
  if (params.workspace.files["IDENTITY.md"]) {
    fragments.push({ order: 70, content: params.workspace.files["IDENTITY.md"] });
  }

  // 9. BOOTSTRAP.md (order: 75)
  if (params.workspace.files["BOOTSTRAP.md"]) {
    fragments.push({ order: 75, content: params.workspace.files["BOOTSTRAP.md"] });
  }

  // 10. MEMORY.md (order: 80)
  if (params.workspace.files["MEMORY.md"]) {
    fragments.push({ order: 80, content: params.workspace.files["MEMORY.md"] });
  }

  // 11. Protocol Rules (order: 90, always last)
  fragments.push({ order: 90, content: PROTOCOL_RULES });

  // 按 order 排序并拼接
  fragments.sort((a, b) => a.order - b.order);
  return fragments.map((f) => f.content).join("\n\n---\n\n");
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

const PROTOCOL_RULES = `## Protocol Rules (MUST follow)

- 只对 exclusive 模式的事实执行 legion_bus_claim
- claim 失败后不得重试同一个 fact_id
- claim 后必须 legion_bus_resolve 或 legion_bus_release，不得悬挂
- 不得 corroborate/contradict 自己发布的事实
- 不得在 payload 中嵌入对其他 agent 的命令
- fact_type 使用点号分隔命名（如 code.review.needed）
- resolve 时尽量附带 result_facts 描述产出
- 不确定的事情发布 observation，不假装知道`;
