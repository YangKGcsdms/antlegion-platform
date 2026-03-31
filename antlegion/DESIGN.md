# antlegion — Technical Design Document v2

**Version:** 0.2.1
**Author:** Carter.Yang
**Date:** 2026-03-30
**Status:** Draft — Pending Review

---

## 1. What It Is

antlegion 是 AntLegion Bus 协议的**独立 Agent 运行时**，架构参考 OpenAnt。

一句话：**OpenAnt 的 Channel 从人类对话换成了 Legion Bus。**

```
OpenAnt:     人类消息 → Agent Turn → LLM + Tools → 回复人类
antlegion: 总线事件 → Agent Turn → LLM + Tools → 发布事实
```

它是一个**完整的 Agent Runtime**，不是一个 while loop。
它支持 SOUL.md、AGENTS.md、Skills、多 LLM 服务商、插件体系。
四角色（PM/Dev/QA/Ops）只是同一个 runtime 的四个实例，加载不同的 SOUL 文件。

### What It Is NOT

- 不是 OpenAnt 的 fork（不包含 Channel 层、Gateway 层、IM 接入逻辑）
- 不是会话服务（没有 per-sender session，只有 per-agent 连续上下文）
- 不依赖 OpenAnt 作为运行时依赖（独立 Node 项目，参考其架构模式）

---

## 2. Architecture

### 2.1 对照 OpenAnt 的组件映射

| OpenAnt 组件 | antlegion 对应 | 说明 |
|--------------|-------------------|------|
| Channel（Discord/Slack/Telegram） | **LegionBusChannel** | 总线 WebSocket 事件 = 入站消息 |
| Gateway（WebSocket Server） | **无** | 不对外暴露服务，自身是总线的客户端 |
| Agent Turn（pi-embedded-runner） | **AgentRunner** | 核心 LLM 循环，处理 tool use |
| Session / Transcript | **Session** | Per-agent 连续上下文 |
| Workspace（SOUL.md/AGENTS.md） | **Workspace** | 相同文件规范，相同加载逻辑 |
| System Prompt Builder | **SystemPromptBuilder** | 组装 SOUL + 工具描述 + 上下文 |
| Tool Registry | **ToolRegistry** | 内置工具 + 插件工具 + legion_bus_* 工具 |
| Plugin System | **PluginLoader** | 相同 manifest 模式 |
| Provider（LLM 服务商） | **LlmProvider** | 多服务商抽象 |
| Skills | **Skills** | 注入到 system prompt 的指令片段 |
| Compaction | **FactMemory** | 按 fact_id 固化上下文，因果链按需加载 |

### 2.2 系统架构图

```
┌──────────────────────────────────────────────────────────────┐
│                       antlegion                            │
│                                                               │
│  ┌──────────────┐   ┌───────────────────────────────────┐    │
│  │LegionBusChannel│   │           AgentRunner              │    │
│  │              │   │                                    │    │
│  │  WebSocket   │──▶│  SystemPrompt + Messages + Tools   │    │
│  │  EventQueue  │   │         │                          │    │
│  │  REST Client │◀──│    LlmProvider.createMessage()     │    │
│  │              │   │         │                          │    │
│  └──────┬───────┘   │    ToolRegistry.execute()          │    │
│         │           │         │                          │    │
│         │           │    loop until end_turn              │    │
│         │           └───────────────────────────────────┘    │
│         │                                                     │
│  ┌──────┴───────┐   ┌──────────────┐   ┌────────────────┐   │
│  │  BusClient   │   │  Workspace   │   │  FactMemory    │   │
│  │  (ws + rest) │   │              │   │                │   │
│  └──────────────┘   │  SOUL.md     │   │  facts/        │   │
│                     │  AGENTS.md   │   │   {id}.jsonl   │   │
│  ┌──────────────┐   │  TOOLS.md    │   │  按因果链加载  │   │
│  │ ToolRegistry │   │  skills/     │   └────────────────┘   │
│  │              │   └──────────────┘                         │
│  │  legion_bus_*  │                                            │
│  │  read/write  │   ┌──────────────┐   ┌────────────────┐   │
│  │  exec        │   │  LlmProvider │   │  PluginLoader  │   │
│  │  plugin tools│   │              │   │                │   │
│  └──────────────┘   │  anthropic   │   │  manifest      │   │
│                     │  openai-compat│   │  tools         │   │
│                     │  ...         │   │  hooks         │   │
│                     └──────────────┘   └────────────────┘   │
└──────────────────────────────────────────────────────────────┘
         │                                        │
         ▼                                        ▼
  ┌─────────────────┐                   ┌──────────────────┐
  │  AntLegion Bus   │                   │  LLM API Server  │
  │  (ws + http)     │                   │  (any provider)  │
  └─────────────────┘                   └──────────────────┘
```

### 2.3 核心循环

与 OpenAnt 的区别：OpenAnt 是**被动的**（等人发消息），antlegion 是**主动的**（持续感知事件）。

```
boot:
  loadConfig()
  loadWorkspace()           → SOUL.md, AGENTS.md, TOOLS.md, skills/
  loadPlugins()             → 注册插件工具和 hooks
  createLlmProvider()       → 根据配置选择服务商
  buildSystemPrompt()       → 组装完整 system prompt
  busClient.connect()       → REST 注册 + WebSocket 订阅
  factMemory.init()         → 初始化 facts/ 目录

loop:
  events = factBusChannel.sense()       → drain EventQueue

  if events.length > 0:
    // 加载因果链记忆
    relatedMemory = factMemory.loadForEvents(events)

    // 格式化为 LLM 可读的 user message
    userMessage = formatEvents(events, relatedMemory)
    session.appendUser(userMessage)

    try:
      agentRunner.run(session)          → LLM + tool loop
    catch (error):
      releaseAllClaims()                → 主动释放
      session.appendUser("[system] LLM 调用失败，已释放所有 claims")

    // 固化本轮处理过的 fact 上下文
    factMemory.persist(session.currentTurn())

    // 清理 session：本轮完成后只保留摘要，细节在 FactMemory 中
    session.sealCurrentTurn()

  heartbeatIfDue()
  sleep(LOOP_INTERVAL)

shutdown:
  agentLoop.stop()                      → 等当前 tick 结束
  releaseAllClaims()
  busClient.disconnect()
  session.flush()
```

---

## 3. Protocol Types

对齐参考实现 `ant_legion_bus` + `ant_legion_bus_plugin`。

```typescript
// ──── 枚举 ────

type FactState = "published" | "claimed" | "resolved" | "dead"

type EpistemicState = "asserted" | "corroborated" | "consensus"
  | "contested" | "refuted" | "superseded"

type SemanticKind = "observation" | "assertion" | "request"
  | "resolution" | "correction" | "signal"

type FactMode = "broadcast" | "exclusive"

type BusEventType = "fact_available" | "fact_claimed"
  | "fact_resolved" | "fact_dead"
  | "fact_trust_changed" | "fact_superseded"
  | "ant_state_changed"

// ──── 核心实体 ────

/** 总线返回的完整 Fact（FactResponse） */
interface Fact {
  fact_id: string
  fact_type: string
  semantic_kind: SemanticKind
  payload: Record<string, unknown>
  domain_tags: string[]
  need_capabilities: string[]
  priority: number                   // 0=CRITICAL … 7=DEBUG
  mode: FactMode
  source_ant_id: string
  causation_chain: string[]          // 祖先 fact_id 列表
  causation_depth: number
  parent_fact_id?: string            // = causation_chain[-1]，只读
  subject_key?: string
  supersedes?: string
  created_at: number                 // 秒级 Unix 时间戳
  ttl_seconds: number
  schema_version: string
  confidence: number | null
  content_hash: string
  signature?: string
  // 可变状态（由 bus 管理）
  state: FactState
  epistemic_state: EpistemicState
  claimed_by: string | null
  resolved_at: number | null
  sequence_number?: number
}

/** WebSocket 推送的事件 */
interface BusEvent {
  event_type: BusEventType
  fact?: Fact                        // fact_available 时携带完整 Fact
  detail?: Record<string, unknown>   // 补充信息（如 claimed_by）
  timestamp: number
}

/** 发布事实请求 */
interface FactCreateRequest {
  fact_type: string
  payload: Record<string, unknown>
  source_ant_id: string
  token: string
  content_hash: string               // 客户端计算，服务端校验
  created_at: number                 // 客户端生成（Date.now() / 1000）
  semantic_kind?: string             // 默认 "observation"
  domain_tags?: string[]
  need_capabilities?: string[]
  priority?: number                  // 默认 3
  mode?: string                      // 默认 "exclusive"
  ttl_seconds?: number               // 默认 300，最小 10
  schema_version?: string            // 默认 "1.0.0"
  confidence?: number | null
  parent_fact_id?: string            // 服务端自动构建因果链
  causation_chain?: string[]         // 或直接传
  causation_depth?: number           // 默认 0
  subject_key?: string
  supersedes?: string
}

/** 节点注册请求 */
interface AntConnectRequest {
  name: string
  description?: string
  capability_offer?: string[]
  domain_interests?: string[]
  fact_type_patterns?: string[]
  priority_range?: [number, number]
  modes?: FactMode[]
  max_concurrent_claims?: number
}

/** 节点注册响应 */
interface AntResponse {
  ant_id: string
  name: string
  state: string
  reliability_score: number
  token?: string                     // 后续操作的认证 token
}

/** 接受过滤器 */
interface AcceptanceFilter {
  capability_offer?: string[]
  domain_interests?: string[]
  fact_type_patterns?: string[]
  priority_range?: [number, number]
  modes?: FactMode[]
  semantic_kinds?: SemanticKind[]
  min_epistemic_rank?: number
  min_confidence?: number
  exclude_superseded?: boolean
}
```

---

## 4. Fact Memory — 按 fact_id 固化上下文

### 4.1 设计动机

传统 Session 会不断增长。OpenAnt 用 Compaction（摘要压缩）解决。
但 Legion Bus 场景有天然的**分段边界**——每个 fact 从 claim 到 resolve 是一个独立工作单元。

核心思路：**fact 结束时固化记忆，因果链到来时按需加载。**

```
事实 A claim → 处理 → resolve
  → 固化为 facts/A.jsonl（包含处理过程中的对话片段）
  → session 中只留一行摘要

事实 B 到达，causation_chain 包含 A
  → 从 facts/A.jsonl 加载摘要注入 user message
  → LLM 拥有 A 的上下文，可以连贯地处理 B
```

### 4.2 FactMemory 接口

```typescript
class FactMemory {
  constructor(private dir: string)  // e.g. ~/.antlegion/facts/

  /**
   * 固化一轮处理的上下文。
   * 在 fact resolve/release 后或 agent turn 结束时调用。
   *
   * 写入 facts/{fact_id}.jsonl：
   *   - fact 元信息（type, payload 摘要, state）
   *   - agent 的处理过程（工具调用摘要、关键决策）
   *   - 结果（resolve 的 result_facts 或 release 的原因）
   */
  persist(turn: TurnRecord): void

  /**
   * 根据事件列表加载相关记忆。
   * 遍历每个事件的 fact.causation_chain，加载祖先的固化记忆。
   *
   * 返回格式化的文本，注入到 user message 中。
   */
  loadForEvents(events: BusEvent[]): string

  /**
   * 加载单个 fact 的固化记忆。
   */
  load(factId: string): FactMemoryRecord | null
}

interface FactMemoryRecord {
  factId: string
  factType: string
  summary: string              // 一句话摘要（agent turn 结束时 LLM 生成）
  payload: Record<string, unknown>
  resolvedWith?: string[]      // result_facts 的 fact_id 列表
  timestamp: number
}

interface TurnRecord {
  /** 本轮处理的 fact_id 列表 */
  factIds: string[]
  /** 本轮对话片段（tool calls + results 摘要） */
  messages: Message[]
  /** LLM 生成的一句话摘要 */
  summary: string
}
```

### 4.3 固化时机

| 事件 | 动作 |
|------|------|
| `legion_bus_resolve` 工具成功 | 固化该 fact 的处理记忆 |
| `legion_bus_release` 工具成功 | 固化该 fact（记录放弃原因） |
| agent turn 结束（end_turn） | 固化本轮涉及的所有 broadcast 事实 |

### 4.4 加载策略

收到新事件时，检查 `fact.causation_chain`：

```typescript
loadForEvents(events: BusEvent[]): string {
  const ancestorIds = new Set<string>()
  for (const event of events) {
    if (event.fact?.causation_chain) {
      for (const id of event.fact.causation_chain) {
        ancestorIds.add(id)
      }
    }
  }

  const memories: string[] = []
  for (const id of ancestorIds) {
    const record = this.load(id)
    if (record) {
      memories.push(`[Ancestor fact ${id}] ${record.factType}: ${record.summary}`)
    }
  }

  if (memories.length === 0) return ""
  return "## Causation Context\n\n" + memories.join("\n") + "\n"
}
```

### 4.5 与 Session 的关系

```
Session（短期）:
  保留最近 2-3 轮未固化的对话
  每轮结束后 sealCurrentTurn() 裁剪已固化部分

FactMemory（长期）:
  按 fact_id 索引的处理记录
  因果链查询时按需加载
  不参与 session 的 token 计数
```

Session 不再无限增长——每轮结束时固化后裁剪。LLM 上下文 = system prompt + 因果链记忆 + 最近 2-3 轮。

---

## 5. Event Formatting — LLM 看到什么

### 5.1 格式化规范

```typescript
function formatEvents(events: BusEvent[], causationMemory: string): string {
  const lines: string[] = []

  // 因果链上下文（来自 FactMemory）
  if (causationMemory) {
    lines.push(causationMemory)
  }

  // 事件头
  const { eventsDropped } = /* from drain */ { eventsDropped: 0 }
  if (eventsDropped > 0) {
    lines.push(`[WARNING] ${eventsDropped} events dropped (queue overflow)\n`)
  }

  lines.push(`## New Events (${events.length})\n`)

  // 逐事件格式化
  for (const event of events) {
    lines.push(`### ${event.event_type}`)

    if (event.fact) {
      const f = event.fact
      lines.push(`- fact_id: ${f.fact_id}`)
      lines.push(`- fact_type: ${f.fact_type}`)
      lines.push(`- mode: ${f.mode}`)
      lines.push(`- state: ${f.state}`)
      lines.push(`- priority: ${f.priority}`)
      if (f.semantic_kind) lines.push(`- semantic_kind: ${f.semantic_kind}`)
      if (f.parent_fact_id) lines.push(`- parent_fact_id: ${f.parent_fact_id}`)
      if (f.causation_depth > 0) lines.push(`- causation_depth: ${f.causation_depth}`)
      if (f.need_capabilities?.length) lines.push(`- need_capabilities: ${f.need_capabilities.join(", ")}`)
      if (f.domain_tags?.length) lines.push(`- domain_tags: ${f.domain_tags.join(", ")}`)
      lines.push(`- payload:`)
      lines.push("```json")
      lines.push(JSON.stringify(f.payload, null, 2))
      lines.push("```")
    }

    if (event.detail) {
      lines.push(`- detail: ${JSON.stringify(event.detail)}`)
    }
    lines.push("")
  }

  lines.push("Decide what action to take based on your SOUL and capabilities.")
  return lines.join("\n")
}
```

### 5.2 示例：LLM 收到的 user message

```markdown
## Causation Context

[Ancestor fact a1b2c3] requirements.feature.defined: 用户要求实现登录功能，包含 OAuth 和邮箱两种方式

## New Events (1)

### fact_available
- fact_id: d4e5f6
- fact_type: code.implement.needed
- mode: exclusive
- state: published
- priority: 2
- semantic_kind: request
- parent_fact_id: a1b2c3
- causation_depth: 1
- need_capabilities: coding, typescript
- domain_tags: code, auth
- payload:
```json
{
  "title": "实现 OAuth 登录模块",
  "description": "基于 a1b2c3 需求，实现 Google OAuth 登录流程",
  "files": ["src/auth/oauth.ts", "src/auth/config.ts"],
  "acceptance_criteria": ["OAuth flow 完整", "单元测试通过"]
}
```

Decide what action to take based on your SOUL and capabilities.
```

---

## 6. Error Handling

### 6.1 分层策略

```
Layer 1 — 工具执行失败
  → 错误作为 tool_result { is_error: true } 返回给 LLM
  → LLM 自行决策（换方案、放弃、release）
  → 不抛出到 AgentRunner

Layer 2 — LLM 调用失败（网络/超时/token超限）
  → AgentRunner 抛出到主循环
  → 主循环 catch：
      1. releaseAllClaims()
      2. session.appendUser("[system] LLM error: {message}")
      3. 继续下一轮（不崩溃）

Layer 3 — Tool loop 超限（MAX_TOOL_ROUNDS）
  → 同 Layer 2 处理

Layer 4 — WebSocket 断线
  → BusWebSocket 自动重连（指数退避 1s→30s + jitter）
  → 断线期间事件丢失是预期行为
  → 主循环继续 tick（sense 返回空）

Layer 5 — Bus REST 调用失败
  → heartbeat 失败：warn 日志，下次重试
  → connect 失败（启动阶段）：process.exit(1)
  → publish/claim/resolve 失败：作为工具执行错误走 Layer 1

Layer 6 — 不可恢复
  → 未捕获异常 → process.exit(1)
  → Docker restart policy 重启
```

### 6.2 不重试的场景

| 场景 | 原因 | 协议依据 |
|------|------|----------|
| claim 失败 | 竞争正常，其他 agent 已认领 | SPEC §12.4: MUST NOT retry |
| publish 被拒（hash 不匹配） | 客户端 bug | §7.1: content integrity |
| publish 被拒（深度超限） | 因果链太深 | §7.1: causation depth |
| publish 被拒（限流） | 应退避 | §7.2: rate limit |

### 6.3 activeClaims 生命周期

`activeClaims: Set<string>` 由 `Runtime` 主类持有，通过 `ToolContext` 传递给工具层。

```
创建：Runtime 构造函数
写入：legion_bus_claim 成功 → add
删除：legion_bus_resolve 成功 → delete
删除：legion_bus_release 成功 → delete
清空：LLM 失败 → releaseAllClaims() → 逐个 release → clear
清空：SIGTERM → releaseAllClaims()
```

```typescript
async releaseAllClaims(): Promise<void> {
  for (const factId of this.activeClaims) {
    try {
      await this.channel.release(factId)
    } catch {
      // 释放失败不阻塞，TTL 兜底
    }
  }
  this.activeClaims.clear()
}
```

### 6.4 ant_id 重连处理

总线重启或网络中断后重连，`/ants/connect` 可能返回新的 `ant_id`：

```
1. BusWebSocket.onclose 触发
2. 重连定时器启动（指数退避）
3. 重连时调用 BusRestClient.connect() 获取新 ant_id + token
4. 如果 ant_id 变化：
   a. 更新 ToolContext 中的 ant_id 和 token
   b. activeClaims.clear()（旧 claims 对新 id 无效）
   c. 用新 ant_id 重建 WebSocket URL
5. 重新 subscribe
```

---

## 7. Workspace — 对齐 OpenAnt 文件规范

每个 agent 实例拥有一个 workspace 目录：

```
workspace/
├── SOUL.md              # 人格和行为准则（= OpenAnt SOUL.md）
├── AGENTS.md            # 多 agent 协作上下文（可选）
├── TOOLS.md             # 工具使用说明（可选）
├── IDENTITY.md          # 身份描述（可选）
├── BOOTSTRAP.md         # 启动时注入的上下文（可选）
├── MEMORY.md            # 持久记忆索引（可选）
├── skills/              # Skill 指令片段（注入 system prompt）
│   ├── code-review.md
│   └── deploy-check.md
└── plugins/             # 本地插件目录（可选）
```

### SOUL.md 示例（Developer Agent）

```markdown
# Developer Agent

你是一个专注于代码实现的开发工程师。你运行在 AntLegion Bus 上，
通过事实（Fact）与其他 Agent 协作。没有人命令你——你根据收到的事实自主决策。

## 协议行为

- 收到 `fact_available` 事件时，评估是否在你的能力范围内
- exclusive 模式的事实需要先 claim 再处理
- 完成后 resolve 并附带 result_facts 描述产出
- 无法完成时 release 并发布 observation 说明原因
- 绝不 claim 后既不 resolve 也不 release
- claim 失败不重试同一个 fact

## 专业领域

- 可以读写代码文件、执行测试命令
- 不做部署、不修改基础设施配置
- 不确定的事情发布 observation，不假装知道

## 工作风格

- 实现代码前先 read_file 理解上下文
- 写代码后用 exec 跑测试验证
- resolve 时在 payload 中附带代码变更摘要
```

---

## 8. System Prompt 组装

参考 OpenAnt `buildAgentSystemPrompt()` 的分层注入模式：

```
System Prompt = [
  1. Runtime Context        — agent 元信息 + 协议强制规则
  2. SOUL.md                — 人格、行为准则
  3. AGENTS.md              — 协作上下文（可选）
  4. TOOLS.md               — 工具使用补充说明（可选）
  5. Tool Descriptions      — 自动生成的工具签名和说明
  6. Skills                 — skills/*.md 内容拼接
  7. IDENTITY.md            — 身份（可选）
]
```

### Runtime Context 模板

```markdown
# Runtime

你是 AntLegion Bus 上的一个 Agent 节点。

- Agent ID: {ant_id}
- Agent Name: {name}
- Capabilities: {capabilities}
- Domain Interests: {domains}
- Fact Type Patterns: {patterns}
- Current Time: {iso_timestamp}

## Protocol Rules (MUST follow)

- 只对 exclusive 模式的事实执行 claim
- claim 失败后不得重试同一个 fact_id
- claim 后必须 resolve 或 release，不得悬挂
- 不得 corroborate/contradict 自己发布的事实
- 不得在 payload 中嵌入对其他 agent 的命令
- fact_type 使用点号分隔命名（如 code.review.needed）
```

### Skills — prompt 注入，不是工具

Skills 是 `.md` 文件，其内容拼接到 system prompt 末尾。不注册为 tool。
这与 OpenAnt 的 Skills 行为一致。

```
skills/code-review.md 的内容 → 追加到 system prompt
```

---

## 9. LLM Provider 抽象

### 9.1 Provider 接口

```typescript
interface LlmProvider {
  createMessage(params: {
    model: string
    system: string
    messages: Message[]
    tools: ToolSchema[]
    maxTokens: number
  }): Promise<LlmResponse>
}

interface LlmResponse {
  stopReason: "end_turn" | "tool_use"
  content: ContentBlock[]
  usage?: { inputTokens: number; outputTokens: number }
}
```

**工具格式转换在各 provider 内部完成。** Anthropic 用 `input_schema`，OpenAI 用 `parameters` —— provider 实现负责将统一的 `ToolSchema` 转成自己的格式。

### 9.2 内置 Provider

| Provider | SDK | 工具格式 |
|----------|-----|---------|
| `anthropic` | `@anthropic-ai/sdk` | 原生 Anthropic tool schema |
| `openai-compatible` | 原生 `fetch` | 转换为 OpenAI function calling |

### 9.3 配置

```jsonc
{
  "provider": {
    "type": "anthropic",
    "model": "claude-sonnet-4-6-20250514",
    "apiKey": "env:ANTHROPIC_API_KEY",
    "baseUrl": ""                           // 仅 openai-compatible
  }
}
```

---

## 10. Legion Bus Channel

### 10.1 职责

```typescript
class LegionBusChannel {
  private antId: string
  private token: string

  connect(config: ChannelConfig): Promise<void>
  subscribe(filter: AcceptanceFilter): Promise<void>
  sense(): { events: BusEvent[]; dropped: number }
  publish(req: Omit<FactCreateRequest, "source_ant_id" | "token" | "content_hash" | "created_at">): Promise<Fact>
  claim(factId: string): Promise<ClaimResult>
  resolve(factId: string, resultFacts?: ChildFact[]): Promise<void>
  release(factId: string): Promise<void>
  query(params?: QueryParams): Promise<Fact[]>
  heartbeat(): Promise<void>
  disconnect(): Promise<void>

  get currentAntId(): string
}
```

`publish()` 内部自动填入 `source_ant_id`、`token`、`created_at`、`content_hash`。LLM/工具层不感知这些字段。

### 10.2 内部结构

```
LegionBusChannel
├── BusRestClient          — fetch 封装，所有 REST 操作
├── BusWebSocket           — WebSocket 连接 + 重连 + subscribe
│   └── 重连逻辑           — 指数退避 1s×2 上限 30s + jitter
│   └── ant_id 变化检测   — 见 §6.4
├── EventQueue             — 有界 FIFO 缓冲（capacity 可配）
│   └── 满时 shift 最旧    — 递增 droppedCount + warn
└── ContentHasher          — 见 §10.3
```

### 10.3 content_hash 计算

对齐 `ant_legion_bus_plugin/src/content-hash.ts`：

```typescript
function computeContentHash(fields: CanonicalFields): string {
  const record: Record<string, unknown> = {
    fact_type: fields.fact_type,
    payload: fields.payload,
    source_ant_id: fields.source_ant_id,
    created_at: fields.created_at,
    mode: fields.mode,
    priority: fields.priority,
    ttl_seconds: fields.ttl_seconds,
    causation_depth: fields.causation_depth,
  }
  if (fields.parent_fact_id) record.parent_fact_id = fields.parent_fact_id
  if (fields.confidence != null) record.confidence = fields.confidence
  if (fields.domain_tags?.length) record.domain_tags = [...fields.domain_tags].sort()
  if (fields.need_capabilities?.length) record.need_capabilities = [...fields.need_capabilities].sort()

  const sorted = Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b)))
  return createHash("sha256").update(JSON.stringify(sorted)).digest("hex")
}
```

`created_at` 使用秒级 Unix 时间戳（`Date.now() / 1000`），对齐 Python `time.time()`。

---

## 11. Agent Runner

参考 OpenAnt `pi-embedded-runner/run.ts`。

```typescript
class AgentRunner {
  constructor(
    private provider: LlmProvider,
    private toolRegistry: ToolRegistry,
    private systemPrompt: string,
    private model: string,
  ) {}

  async run(session: Session): Promise<RunResult> {
    const MAX_TOOL_ROUNDS = 20

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const response = await this.provider.createMessage({
        model: this.model,
        system: this.systemPrompt,
        messages: session.getMessages(),
        tools: this.toolRegistry.schemas(),
        maxTokens: 4096,
      })

      session.appendAssistant(response.content)

      if (response.stopReason === "end_turn") {
        return { content: response.content, usage: response.usage }
      }

      // tool_use: 执行所有工具调用
      const toolUseBlocks = response.content.filter(b => b.type === "tool_use")
      const toolResults = []

      for (const block of toolUseBlocks) {
        try {
          const result = await this.toolRegistry.execute(block.name, block.input)
          toolResults.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: JSON.stringify(result),
          })
        } catch (err) {
          // 工具失败 → 错误返回给 LLM（Layer 1）
          toolResults.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: `Error: ${err instanceof Error ? err.message : String(err)}`,
            is_error: true,
          })
        }
      }

      session.appendToolResults(toolResults)
    }

    throw new Error(`tool loop exceeded ${MAX_TOOL_ROUNDS} rounds`)
  }
}
```

---

## 12. Tool System

### 12.1 工具分类

| 类别 | 工具 | 说明 |
|------|------|------|
| **Legion Bus** | `legion_bus_publish`, `legion_bus_claim`, `legion_bus_resolve`, `legion_bus_release`, `legion_bus_sense`, `legion_bus_query` | 总线操作 |
| **文件系统** | `read_file`, `write_file`, `list_dir` | workspace 范围内 |
| **Shell** | `exec` | workspace cwd，30s 超时 |
| **插件** | 由 plugin 注册 | 自定义 |

### 12.2 ToolRegistry

```typescript
class ToolRegistry {
  private tools = new Map<string, ToolDefinition>()

  register(tool: ToolDefinition): void

  /** 返回 LLM 可用的 tool schema（不含 execute） */
  schemas(): ToolSchema[]

  /** 执行工具，找不到则 throw */
  async execute(name: string, input: unknown): Promise<unknown>
}

interface ToolDefinition {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  execute: (input: unknown, context: ToolContext) => Promise<unknown>
}

interface ToolContext {
  channel: LegionBusChannel
  workspaceDir: string
  agentId: string
  activeClaims: Set<string>
}
```

### 12.3 legion_bus_* 工具 Schema

#### legion_bus_publish

```json
{
  "name": "legion_bus_publish",
  "description": "发布一个事实到 AntLegion Bus。用于报告观察、发起请求或输出工作结果。source_ant_id / token / content_hash / created_at 由 runtime 自动填入。",
  "input_schema": {
    "type": "object",
    "properties": {
      "fact_type": { "type": "string", "description": "点号分隔，如 code.review.needed" },
      "payload": { "type": "object", "description": "事实内容" },
      "semantic_kind": { "type": "string", "enum": ["observation","assertion","request","resolution","correction","signal"], "description": "默认 observation" },
      "priority": { "type": "number", "minimum": 0, "maximum": 7, "description": "默认 3" },
      "mode": { "type": "string", "enum": ["exclusive","broadcast"], "description": "默认 exclusive" },
      "need_capabilities": { "type": "array", "items": { "type": "string" } },
      "domain_tags": { "type": "array", "items": { "type": "string" } },
      "parent_fact_id": { "type": "string", "description": "父事实 ID，自动构建因果链" },
      "ttl_seconds": { "type": "number", "minimum": 10, "description": "默认 300" },
      "confidence": { "type": "number", "minimum": 0, "maximum": 1 },
      "subject_key": { "type": "string", "description": "知识演化分组键" }
    },
    "required": ["fact_type", "payload"]
  }
}
```

#### legion_bus_claim

```json
{
  "name": "legion_bus_claim",
  "description": "独占认领一个 exclusive 事实。claim 失败说明其他 agent 已认领，不得重试同一个 fact_id。claim 后必须 resolve 或 release。",
  "input_schema": {
    "type": "object",
    "properties": {
      "fact_id": { "type": "string" }
    },
    "required": ["fact_id"]
  }
}
```

#### legion_bus_resolve

```json
{
  "name": "legion_bus_resolve",
  "description": "标记已认领的事实为已解决。可附带 result_facts 发布子事实，自动继承因果链。",
  "input_schema": {
    "type": "object",
    "properties": {
      "fact_id": { "type": "string" },
      "result_facts": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "fact_type": { "type": "string" },
            "payload": { "type": "object" },
            "semantic_kind": { "type": "string" },
            "priority": { "type": "number" },
            "mode": { "type": "string" },
            "domain_tags": { "type": "array", "items": { "type": "string" } },
            "need_capabilities": { "type": "array", "items": { "type": "string" } }
          },
          "required": ["fact_type", "payload"]
        }
      }
    },
    "required": ["fact_id"]
  }
}
```

#### legion_bus_release

```json
{
  "name": "legion_bus_release",
  "description": "释放已认领但无法完成的事实，让其他 agent 处理。",
  "input_schema": {
    "type": "object",
    "properties": {
      "fact_id": { "type": "string" }
    },
    "required": ["fact_id"]
  }
}
```

#### legion_bus_sense

```json
{
  "name": "legion_bus_sense",
  "description": "获取当前缓冲的新事件。在 tool loop 中调用可获取处理期间到达的新事件。",
  "input_schema": {
    "type": "object",
    "properties": {
      "limit": { "type": "number", "description": "最多返回几条，默认 10" }
    }
  }
}
```

#### legion_bus_query

```json
{
  "name": "legion_bus_query",
  "description": "按条件查询总线上的事实。可用于了解当前状态或查找相关事实。",
  "input_schema": {
    "type": "object",
    "properties": {
      "fact_type": { "type": "string" },
      "state": { "type": "string", "enum": ["published","claimed","resolved","dead"] },
      "limit": { "type": "number", "description": "默认 20" }
    }
  }
}
```

### 12.4 exec 安全边界

- `cwd` 锁定 workspace 目录
- `maxBuffer` 1MB
- 子进程环境剥离 `*API_KEY*`、`*SECRET*` 变量
- 超时 30s（可配）
- 容器隔离是最终兜底

---

## 13. Session 管理

### 13.1 与 OpenAnt 的区别

| 方面 | OpenAnt | antlegion |
|------|----------|-------------|
| Scope | Per-sender | Per-agent（单一连续 session） |
| 触发 | 人类消息 | 总线事件 |
| 增长 | 慢 | 快（事件可能密集） |
| 压缩 | Compaction（摘要） | FactMemory（按 fact_id 固化） |

### 13.2 Session 结构

```typescript
class Session {
  private messages: Message[] = []

  appendUser(content: string): void
  appendAssistant(content: ContentBlock[]): void
  appendToolResults(results: ToolResultBlock[]): void
  getMessages(): Message[]

  /** 返回当前轮次的消息（最后一次 appendUser 以来的所有消息） */
  currentTurn(): TurnRecord

  /** 裁剪已固化的轮次，只保留最近 N 轮 */
  sealCurrentTurn(): void

  /** 持久化当前状态 */
  flush(): void
}
```

Session 保持轻量——**已固化到 FactMemory 的轮次被裁剪**，只保留最近 2-3 轮。
上下文窗口使用量 ≈ system prompt + 因果链记忆 + 最近 2-3 轮。稳定可控。

---

## 14. Plugin System

参考 OpenAnt manifest 模式，简化版。

```jsonc
// plugins/my-plugin/manifest.json
{
  "name": "my-plugin",
  "version": "1.0.0",
  "entry": "./index.js",
  "tools": ["custom_tool_1"],
  "hooks": ["beforePublish"]
}
```

```typescript
interface AntPlugin {
  setup(api: PluginApi): Promise<void>
}

interface PluginApi {
  registerTool(tool: ToolDefinition): void
  onHook(name: string, handler: HookHandler): void
  getChannel(): LegionBusChannel
  getConfig(): RuntimeConfig
  log: Logger
}
```

加载顺序：`workspace/plugins/` → `~/.antlegion/plugins/` → 内置。

---

## 15. Configuration

### 15.1 配置文件

```jsonc
// antlegion.json
{
  "bus": {
    "url": "http://localhost:28080",
    "name": "ant-developer",
    "description": "Development agent",
    "filter": {
      "capabilityOffer": ["coding", "review"],
      "domainInterests": ["code"],
      "factTypePatterns": ["code.*"],
      "priorityRange": [0, 7],
      "modes": ["exclusive", "broadcast"]
    }
  },
  "provider": {
    "type": "anthropic",
    "model": "claude-sonnet-4-6-20250514",
    "apiKey": "env:ANTHROPIC_API_KEY"
  },
  "workspace": "./workspace",
  "agent": {
    "loopInterval": 1000,
    "heartbeatInterval": 30000,
    "eventQueueCapacity": 100,
    "maxToolRounds": 20,
    "sessionKeepTurns": 3
  },
  "plugins": {
    "roots": ["./plugins"]
  }
}
```

### 15.2 环境变量覆盖

| 变量 | 覆盖 |
|------|------|
| `ANT_BUS_URL` | `bus.url` |
| `ANT_WORKSPACE` | `workspace` |
| `ANTHROPIC_API_KEY` | `provider.apiKey` |
| `LLM_API_KEY` | `provider.apiKey`（通用） |
| `LLM_BASE_URL` | `provider.baseUrl` |
| `LLM_MODEL` | `provider.model` |

---

## 16. Deployment — 四角色矩阵示例

同一镜像，四个实例，不同 workspace + 配置：

```yaml
services:
  ant_pm:
    image: antlegion
    volumes:
      - ./workspaces/product_manager:/workspace
      - ./project:/project
    environment:
      ANT_BUS_URL: http://legion_bus:8080
      ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY}
    configs:
      - source: pm_config
        target: /app/antlegion.json

  ant_dev:
    image: antlegion
    volumes:
      - ./workspaces/developer:/workspace
      - ./project:/project
    environment:
      ANT_BUS_URL: http://legion_bus:8080
      ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY}
    configs:
      - source: dev_config
        target: /app/antlegion.json

  # ant_qa, ant_ops 同理...

  legion_bus:
    image: ant-fact-bus:latest
    ports:
      - "28080:8080"
```

---

## 17. File Structure

```
antlegion/
├── src/
│   ├── index.ts                     # CLI 入口
│   ├── runtime.ts                   # Runtime 主类
│   ├── config/
│   │   ├── config.ts                # 配置加载
│   │   └── types.ts                 # 配置类型
│   ├── channel/
│   │   ├── LegionBusChannel.ts        # Channel 主类
│   │   ├── BusRestClient.ts         # REST 封装
│   │   ├── BusWebSocket.ts          # WebSocket + 重连
│   │   ├── EventQueue.ts            # 有界缓冲
│   │   └── ContentHasher.ts         # content_hash
│   ├── agent/
│   │   ├── AgentRunner.ts           # LLM + tool loop
│   │   ├── Session.ts               # 会话管理
│   │   ├── FactMemory.ts            # fact_id 索引的记忆
│   │   ├── EventFormatter.ts        # 事件 → LLM 文本
│   │   └── SystemPromptBuilder.ts   # prompt 分层组装
│   ├── workspace/
│   │   ├── loader.ts                # SOUL / AGENTS 加载
│   │   └── skills.ts                # skills/*.md
│   ├── tools/
│   │   ├── registry.ts              # ToolRegistry
│   │   ├── factbus.ts               # legion_bus_* 工具
│   │   ├── filesystem.ts            # read / write / list
│   │   └── exec.ts                  # exec
│   ├── providers/
│   │   ├── types.ts                 # LlmProvider 接口
│   │   ├── anthropic.ts             # Anthropic
│   │   └── openai-compatible.ts     # OpenAI 兼容
│   ├── plugins/
│   │   ├── loader.ts                # 发现和加载
│   │   └── types.ts                 # Plugin API
│   └── types/
│       ├── protocol.ts              # 协议类型
│       └── messages.ts              # LLM 消息类型
├── workspace/                       # 默认 workspace
│   ├── SOUL.md
│   └── AGENTS.md
├── package.json
├── tsconfig.json
├── Dockerfile
└── antlegion.json
```

---

## 18. Dependencies

```json
{
  "dependencies": {
    "@anthropic-ai/sdk": "^0.30",
    "ws": "^8"
  },
  "devDependencies": {
    "typescript": "^5.7",
    "@types/node": "^22",
    "@types/ws": "^8"
  }
}
```

---

## 19. Implementation Phases

### Phase 1 — 骨架 + 总线连通

| 模块 | 工作 |
|------|------|
| `types/protocol.ts` | 协议类型定义 |
| `config/` | 配置加载 |
| `channel/` | BusRestClient + BusWebSocket + EventQueue + ContentHasher |
| `runtime.ts` | 启动 + 连接 + 心跳循环 |

**验证：** Dashboard 看到节点上线，日志打印事件。

### Phase 2 — Agent Runner + 工具 + FactMemory

| 模块 | 工作 |
|------|------|
| `providers/anthropic.ts` | Anthropic provider |
| `agent/AgentRunner.ts` | LLM + tool loop |
| `agent/Session.ts` | 基本会话 |
| `agent/EventFormatter.ts` | 事件格式化 |
| `agent/FactMemory.ts` | 按 fact_id 固化 + 因果链加载 |
| `tools/` | ToolRegistry + legion_bus_* + fs + exec |
| `agent/SystemPromptBuilder.ts` | 基本 prompt |

**验证：**
1. 事实 → claim → resolve → 因果链 2 层
2. 子事实到达时，LLM 能看到父事实的处理摘要

### Phase 3 — Workspace + 完整 Prompt

| 模块 | 工作 |
|------|------|
| `workspace/` | SOUL / AGENTS / TOOLS / skills 加载 |
| `agent/SystemPromptBuilder.ts` | 完整分层组装 |

**验证：** 不同 SOUL.md 产生不同行为。

### Phase 4 — 部署 + 多 Provider

| 模块 | 工作 |
|------|------|
| `providers/openai-compatible.ts` | OpenAI 兼容 provider |
| `Dockerfile` | 多阶段构建 |
| `docker-compose.yml` | 四角色矩阵 |

**验证：** `docker-compose up` 四角色通过总线协作。

### Phase 5 — 扩展

- Plugin system
- `/health` 端点
- legion_bus_validate（corroborate / contradict）
- 更多 provider 插件
- JSONL transcript 持久化
