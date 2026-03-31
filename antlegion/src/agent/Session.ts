/**
 * Session — per-agent 连续会话管理
 * 保留最近 N 轮对话，已固化到 FactMemory 的轮次被裁剪
 * JSONL transcript 持久化
 */

import fs from "node:fs";
import path from "node:path";
import type { Message, ContentBlock, ToolResultBlock } from "../types/messages.js";

export interface TurnRecord {
  factIds: string[];
  messages: Message[];
  summary: string;
}

export class Session {
  private messages: Message[] = [];
  private turnStartIndex = 0;
  private keepTurns: number;
  private turnCount = 0;
  private transcriptStream: fs.WriteStream | null = null;

  /** tool_result 单条内容超过此字符数时自动裁剪 */
  private toolResultMaxChars: number;
  /** 触发 auto-compact 的 token 估算阈值 */
  readonly compactThreshold: number;

  constructor(keepTurns = 3, options?: { toolResultMaxChars?: number; compactThreshold?: number }) {
    this.keepTurns = keepTurns;
    this.toolResultMaxChars = options?.toolResultMaxChars ?? 8000;
    this.compactThreshold = options?.compactThreshold ?? 30000;
  }

  /** 初始化 JSONL transcript 持久化 */
  initTranscript(dir: string, agentId: string): void {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const filePath = path.join(dir, `${agentId}.jsonl`);
    this.transcriptStream = fs.createWriteStream(filePath, { flags: "a" });
    console.log(`[session] transcript: ${filePath}`);
  }

  appendUser(content: string): void {
    this.turnStartIndex = this.messages.length;
    const msg: Message = { role: "user", content };
    this.messages.push(msg);
    this.writeTranscript(msg);
  }

  appendAssistant(content: ContentBlock[]): void {
    const msg: Message = { role: "assistant", content };
    this.messages.push(msg);
    this.writeTranscript(msg);
  }

  appendToolResults(results: ToolResultBlock[]): void {
    // ── 轻量层防御：裁剪大 tool_result ──
    const trimmed = results.map((r) => this.trimToolResult(r));
    const msg: Message = { role: "user", content: trimmed };
    this.messages.push(msg);
    this.writeTranscript(msg);
  }

  /** 裁剪单条 tool_result 的大输出 */
  private trimToolResult(result: ToolResultBlock): ToolResultBlock {
    if (typeof result.content !== "string") return result;
    if (result.content.length <= this.toolResultMaxChars) return result;

    const kept = result.content.slice(0, this.toolResultMaxChars);
    const dropped = result.content.length - this.toolResultMaxChars;
    return {
      ...result,
      content: kept + `\n\n... [输出过大，已裁剪 ${dropped} 字符。如需完整内容请用 read_file 查看文件]`,
    };
  }

  /** 检查是否需要触发 auto-compact */
  get needsCompaction(): boolean {
    return this.estimatedTokens > this.compactThreshold;
  }

  /**
   * Auto-compact：将旧消息压缩为摘要（重量层防御）
   * 保留最近 keepTurns 轮完整消息，更早的全部替换为一行摘要。
   * 如果提供了 compactFn，用它生成摘要（可以调 LLM）；否则用静态摘要。
   */
  async autoCompact(compactFn?: (messages: Message[]) => Promise<string>): Promise<boolean> {
    if (!this.needsCompaction) return false;

    const trimTo = this.findTrimPoint();
    if (trimTo <= 1) return false;

    const oldMessages = this.messages.slice(0, trimTo);
    let summary: string;

    if (compactFn) {
      try {
        summary = await compactFn(oldMessages);
      } catch {
        summary = this.buildStaticCompactSummary(oldMessages);
      }
    } else {
      summary = this.buildStaticCompactSummary(oldMessages);
    }

    this.messages = [
      { role: "user", content: `[Auto-compact] ${summary}` },
      ...this.messages.slice(trimTo),
    ];
    this.turnStartIndex = Math.max(0, this.turnStartIndex - trimTo + 1);
    return true;
  }

  /** 从旧消息中提取静态摘要 */
  private buildStaticCompactSummary(oldMessages: Message[]): string {
    const toolNames: string[] = [];
    const factTypes: string[] = [];

    for (const msg of oldMessages) {
      if (typeof msg.content === "string") {
        const matches = msg.content.match(/fact_type:\s*(\S+)/g);
        if (matches) factTypes.push(...matches.map((m: string) => m.replace("fact_type: ", "")));
      } else if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if ("name" in block && block.type === "tool_use") {
            toolNames.push((block as { name: string }).name);
          }
        }
      }
    }

    const uniqueTools = [...new Set(toolNames)];
    const uniqueFacts = [...new Set(factTypes)];

    let summary = `已压缩 ${oldMessages.length} 条历史消息。`;
    if (uniqueTools.length > 0) summary += ` 使用过的工具: ${uniqueTools.join(", ")}。`;
    if (uniqueFacts.length > 0) summary += ` 涉及的事实类型: ${uniqueFacts.join(", ")}。`;
    summary += ` 详细历史已记录在 transcript 中。`;

    return summary;
  }

  getMessages(): Message[] {
    return this.messages;
  }

  /** 当前轮次的消息（从最后一次 appendUser 开始） */
  currentTurnMessages(): Message[] {
    return this.messages.slice(this.turnStartIndex);
  }

  /**
   * 封存当前轮次：
   * 用一行摘要替换已完成的早期轮次，保持 session 不膨胀。
   */
  sealCurrentTurn(summary?: string): void {
    this.turnCount++;

    if (this.turnCount <= this.keepTurns) return;

    const trimTo = this.findTrimPoint();
    if (trimTo <= 0) return;

    const trimmedSummary = this.buildTrimSummary(trimTo, summary);
    this.messages = [
      { role: "user", content: trimmedSummary },
      ...this.messages.slice(trimTo),
    ];
    this.turnStartIndex = Math.max(0, this.turnStartIndex - trimTo + 1);
  }

  /** 关闭 transcript 流 */
  flush(): void {
    this.transcriptStream?.end();
    this.transcriptStream = null;
  }

  get messageCount(): number {
    return this.messages.length;
  }

  /** 粗略估算 token 数（按字符数 / 3.5） */
  get estimatedTokens(): number {
    let chars = 0;
    for (const msg of this.messages) {
      if (typeof msg.content === "string") {
        chars += msg.content.length;
      } else if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if ("text" in block) chars += block.text.length;
          else if ("content" in block) chars += block.content.length;
          else if ("input" in block) chars += JSON.stringify(block.input).length;
        }
      }
    }
    return Math.ceil(chars / 3.5);
  }

  private writeTranscript(msg: Message): void {
    if (!this.transcriptStream) return;
    const entry = { ts: Date.now(), ...msg };
    this.transcriptStream.write(JSON.stringify(entry) + "\n");
  }

  private findTrimPoint(): number {
    let userCount = 0;
    for (let i = this.messages.length - 1; i >= 0; i--) {
      if (this.messages[i].role === "user" && typeof this.messages[i].content === "string") {
        userCount++;
        if (userCount >= this.keepTurns) return i;
      }
    }
    return 0;
  }

  private buildTrimSummary(trimTo: number, explicitSummary?: string): string {
    if (explicitSummary) {
      return `[Previous context summary] ${explicitSummary}`;
    }
    return `[${trimTo} earlier messages trimmed — context preserved in FactMemory]`;
  }
}
