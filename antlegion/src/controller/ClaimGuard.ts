/**
 * ClaimGuard — 防止 claim 泄漏
 *
 * 对标 Claude Code 的 orphan cleanup 机制：
 * 当 AgentRunner.run() 结束后（无论成功或失败），
 * 检查 activeClaims 中是否有未 resolve 的 fact，自动 release。
 *
 * 这确保了即使 LLM 忘记调用 legion_bus_resolve，
 * claim 也不会永远占着不释放。
 */

import type { LegionBusChannel } from "../channel/FactBusChannel.js";
import type { Logger } from "../observability/Logger.js";

export class ClaimGuard {
  constructor(
    private channel: LegionBusChannel,
    private activeClaims: Set<string>,
    private logger: Logger,
  ) {}

  /**
   * 在每次 AgentRunner.run() 结束后调用。
   * 如果 LLM 正确 resolve 了所有 claim，这里什么都不做。
   * 如果有遗留的 claim，自动 release 并记录警告。
   */
  async cleanup(): Promise<number> {
    if (this.activeClaims.size === 0) return 0;

    let released = 0;
    for (const factId of this.activeClaims) {
      try {
        await this.channel.release(factId);
        this.logger.warn("ClaimGuard: orphan claim released", { factId });
        released++;
      } catch {
        // TTL 兜底，忽略错误
        this.logger.warn("ClaimGuard: release failed (TTL will handle)", { factId });
      }
    }
    this.activeClaims.clear();
    return released;
  }

  /**
   * 当前有未 resolve 的 claim 数量
   */
  get pendingCount(): number {
    return this.activeClaims.size;
  }
}
