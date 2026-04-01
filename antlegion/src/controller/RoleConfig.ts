/**
 * RoleConfig — 从 role.yaml 加载角色配置
 *
 * 定义每个 Agent 的行为边界：
 * - 可以 claim 哪些 fact type
 * - 可以 publish 哪些 fact type（白名单）
 * - 关注哪些 broadcast fact 作为上下文
 * - 失败重试策略
 */

import fs from "node:fs";
import path from "node:path";

export interface RoleConfigData {
  role: string;
  /** glob patterns — 匹配哪些 exclusive facts 可以 claim */
  claims: string[];
  /** 允许 LLM publish 的 fact_type patterns */
  allowed_publish: string[];
  /** 关注的 broadcast fact types（收入 ContextBuffer） */
  context_interests: string[];
  /** 最大重试次数 */
  max_retries: number;
  /** 最大工具调用轮次 (覆盖 DEFAULT_AGENT_CONFIG) */
  max_tool_rounds: number;
}

const DEFAULT_ROLE_CONFIG: RoleConfigData = {
  role: "generic-agent",
  claims: ["*"],
  allowed_publish: ["*"],
  context_interests: [],
  max_retries: 2,
  max_tool_rounds: 50,
};

export class RoleConfig {
  readonly data: RoleConfigData;

  constructor(data: Partial<RoleConfigData>) {
    this.data = { ...DEFAULT_ROLE_CONFIG, ...data };
  }

  /** 判断一个 exclusive fact 是否应该被此角色 claim */
  shouldClaim(factType: string): boolean {
    return this.data.claims.some((p) => matchPattern(p, factType));
  }

  /** 判断一个 fact_type 是否允许 publish */
  canPublish(factType: string): boolean {
    return this.data.allowed_publish.some((p) => matchPattern(p, factType));
  }

  /** 判断一个 broadcast fact_type 是否在此角色的关注范围内 */
  isContextInterest(factType: string): boolean {
    if (this.data.context_interests.length === 0) return true; // 未配置则全部接收
    return this.data.context_interests.some((p) => matchPattern(p, factType));
  }

  get maxRetries(): number {
    return this.data.max_retries;
  }

  get maxToolRounds(): number {
    return this.data.max_tool_rounds;
  }

  get role(): string {
    return this.data.role;
  }
}

/**
 * 从 workspace 目录加载 role.yaml
 * 支持 YAML（简易解析）和 JSON 两种格式
 */
export function loadRoleConfig(workspaceDir: string): RoleConfig {
  const yamlPath = path.join(workspaceDir, "role.yaml");
  const jsonPath = path.join(workspaceDir, "role.json");

  if (fs.existsSync(jsonPath)) {
    const raw = fs.readFileSync(jsonPath, "utf-8");
    return new RoleConfig(JSON.parse(raw));
  }

  if (fs.existsSync(yamlPath)) {
    const raw = fs.readFileSync(yamlPath, "utf-8");
    return new RoleConfig(parseSimpleYaml(raw));
  }

  // 无配置文件 → 使用默认
  return new RoleConfig({});
}

/**
 * 简易 YAML 解析器（只支持 role.yaml 的扁平结构 + 数组）
 * 不引入第三方 YAML 库，保持零依赖
 */
function parseSimpleYaml(content: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  let currentKey = "";
  let currentArray: unknown[] | null = null;
  let currentObject: Record<string, unknown> | null = null;
  let objectArray: Record<string, unknown>[] | null = null;

  for (const rawLine of content.split("\n")) {
    const line = rawLine.replace(/#.*$/, ""); // strip comments
    if (line.trim() === "") continue;

    // Top-level key: value
    const kvMatch = line.match(/^(\w[\w_]*):\s*(.*)$/);
    if (kvMatch) {
      // flush previous array/object
      if (currentArray && currentKey) {
        result[currentKey] = currentArray;
      }
      if (objectArray && currentKey) {
        result[currentKey] = objectArray;
      }

      const [, key, value] = kvMatch;
      currentKey = key;
      currentArray = null;
      currentObject = null;
      objectArray = null;

      if (value.trim()) {
        // Inline value
        result[key] = parseValue(value.trim());
      }
      continue;
    }

    // Array item with object: "  - key: value"
    const objectItemMatch = line.match(/^\s+-\s+(\w+):\s*(.+)$/);
    if (objectItemMatch && currentKey) {
      const [, k, v] = objectItemMatch;
      if (!currentObject) {
        currentObject = {};
        if (!objectArray) objectArray = [];
      }
      // Check if this is a new object in the array
      if (currentObject[k] !== undefined) {
        objectArray!.push(currentObject);
        currentObject = {};
      }
      currentObject[k] = parseValue(v.trim());
      continue;
    }

    // Object continuation: "    key: value"
    const nestedKvMatch = line.match(/^\s{2,}(\w+):\s*(.+)$/);
    if (nestedKvMatch && currentObject) {
      const [, k, v] = nestedKvMatch;
      currentObject[k] = parseValue(v.trim());
      continue;
    }

    // Array item: "  - value"
    const arrayMatch = line.match(/^\s+-\s+(.+)$/);
    if (arrayMatch && currentKey) {
      // Flush current object if switching from object to simple array
      if (currentObject && objectArray) {
        objectArray.push(currentObject);
        currentObject = null;
      }
      if (!currentArray) currentArray = [];
      currentArray.push(parseValue(arrayMatch[1].trim()));
      continue;
    }
  }

  // flush trailing
  if (currentArray && currentKey) {
    result[currentKey] = currentArray;
  }
  if (currentObject && objectArray && currentKey) {
    objectArray.push(currentObject);
    result[currentKey] = objectArray;
  }

  return result;
}

function parseValue(s: string): string | number | boolean {
  if (s === "true") return true;
  if (s === "false") return false;
  const num = Number(s);
  if (!isNaN(num) && s !== "") return num;
  // Strip quotes
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

/**
 * 简单的 glob 匹配（只支持 * 和 prefix.* 模式）
 */
function matchPattern(pattern: string, value: string): boolean {
  if (pattern === "*") return true;
  if (pattern === value) return true;
  if (pattern.endsWith(".*")) {
    const prefix = pattern.slice(0, -2);
    return value.startsWith(prefix + ".");
  }
  if (pattern.endsWith("*")) {
    return value.startsWith(pattern.slice(0, -1));
  }
  return false;
}

export { matchPattern };
