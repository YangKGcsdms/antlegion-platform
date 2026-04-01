/**
 * Builtin Plugin: Knowledge Base
 *
 * 提供：
 * - 4 个知识工具（knowledge_add/search/list/remove）
 * - 动态 system prompt 注入（已学习的知识）
 *
 * 约束：Knowledge 仅用于存储 agent 自身的个人经验（如编码模式、工具用法），
 * 不能用于缓存其他 agent 通过总线发布的事实内容。
 * 跨 agent 信息交换必须通过事实总线和共享工作区进行。
 */

import type { AntPlugin } from "../types.js";
import { KnowledgeBase } from "../../knowledge/KnowledgeBase.js";
import { DEFAULT_KNOWLEDGE_CONFIG, type KnowledgeEntry } from "../../knowledge/types.js";
import { createKnowledgeTools } from "../../tools/knowledge.js";

export const knowledgePlugin: AntPlugin = {
  name: "builtin:knowledge",

  async setup(api) {
    const config = api.getConfig().knowledge;
    if (!config?.enabled) return;

    const kb = new KnowledgeBase(
      { ...DEFAULT_KNOWLEDGE_CONFIG, ...config },
      api.getConfig().workspace,
    );
    await kb.init();

    // 注册知识工具
    for (const tool of createKnowledgeTools(kb)) {
      api.registerTool(tool);
    }

    // 注入知识到 system prompt
    api.addPromptSection({
      id: "knowledge",
      order: 65, // Skills(60) 之后, IDENTITY(70) 之前
      build: (ctx) => {
        const entries = kb.getRelevantForPrompt(ctx.domainInterests);
        if (!entries || entries.length === 0) return null;
        return buildKnowledgeSection(entries);
      },
    });

    api.log.info("knowledge plugin ready", { entries: kb.size });
  },
};

function buildKnowledgeSection(entries: KnowledgeEntry[]): string {
  const lines = ["## Learned Knowledge", ""];
  for (const entry of entries) {
    lines.push(`- **${entry.title}** [${entry.tags.join(", ")}] (confidence: ${entry.confidence})`);
    lines.push(`  ${entry.content}`);
    lines.push("");
  }
  return lines.join("\n");
}
