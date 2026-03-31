/**
 * Skills 加载 — skills/*.md 拼接为 prompt 片段
 * Skills 是注入到 system prompt 的指令，不是 tool
 */

import fs from "node:fs";
import path from "node:path";

export function loadSkills(workspaceDir: string): string {
  const skillsDir = path.join(workspaceDir, "skills");

  if (!fs.existsSync(skillsDir)) return "";

  const entries = fs.readdirSync(skillsDir).filter((f) => f.endsWith(".md")).sort();
  if (entries.length === 0) return "";

  const sections: string[] = [];

  for (const filename of entries) {
    const filePath = path.join(skillsDir, filename);
    const content = fs.readFileSync(filePath, "utf-8").trim();
    if (!content) continue;
    const skillName = filename.replace(/\.md$/, "");
    sections.push(`### Skill: ${skillName}\n\n${content}`);
    console.log(`[workspace] loaded skill: ${skillName}`);
  }

  if (sections.length === 0) return "";
  return "## Skills\n\n" + sections.join("\n\n") + "\n";
}
