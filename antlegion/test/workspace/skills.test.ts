import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadSkills } from "../../src/workspace/skills.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "skills-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("loadSkills", () => {
  it("should return empty string when no skills dir", () => {
    expect(loadSkills(tmpDir)).toBe("");
  });

  it("should load .md files from skills/", () => {
    const skillsDir = path.join(tmpDir, "skills");
    fs.mkdirSync(skillsDir);
    fs.writeFileSync(path.join(skillsDir, "code-review.md"), "Review code carefully.");
    fs.writeFileSync(path.join(skillsDir, "testing.md"), "Write unit tests.");

    const result = loadSkills(tmpDir);
    expect(result).toContain("## Skills");
    expect(result).toContain("### Skill: code-review");
    expect(result).toContain("Review code carefully.");
    expect(result).toContain("### Skill: testing");
    expect(result).toContain("Write unit tests.");
  });

  it("should ignore non-.md files", () => {
    const skillsDir = path.join(tmpDir, "skills");
    fs.mkdirSync(skillsDir);
    fs.writeFileSync(path.join(skillsDir, "readme.txt"), "not a skill");
    fs.writeFileSync(path.join(skillsDir, "skill.md"), "real skill");

    const result = loadSkills(tmpDir);
    expect(result).toContain("### Skill: skill");
    expect(result).not.toContain("readme");
  });

  it("should skip empty .md files", () => {
    const skillsDir = path.join(tmpDir, "skills");
    fs.mkdirSync(skillsDir);
    fs.writeFileSync(path.join(skillsDir, "empty.md"), "");
    fs.writeFileSync(path.join(skillsDir, "real.md"), "content");

    const result = loadSkills(tmpDir);
    expect(result).toContain("### Skill: real");
    expect(result).not.toContain("### Skill: empty");
  });

  it("should sort skills alphabetically", () => {
    const skillsDir = path.join(tmpDir, "skills");
    fs.mkdirSync(skillsDir);
    fs.writeFileSync(path.join(skillsDir, "zebra.md"), "z");
    fs.writeFileSync(path.join(skillsDir, "alpha.md"), "a");

    const result = loadSkills(tmpDir);
    const alphaIdx = result.indexOf("### Skill: alpha");
    const zebraIdx = result.indexOf("### Skill: zebra");
    expect(alphaIdx).toBeLessThan(zebraIdx);
  });
});
