# antlegion-bus — Technical Design Document v1.0

**Version:** 1.0.0
**Author:** Carter.Yang
**Date:** 2026-03-31
**Status:** Draft

---

## 1. What It Is

antlegion-bus 是 AntLegion Bus 协议的 **Node.js/TypeScript 服务端实现**，对应 Python 参考实现 `ant_legion_bus`。

目标：与 `antlegion`（Agent Runtime）技术栈统一，整个生态统一为 TypeScript。

```
ant_legion_bus  (Python/FastAPI)  →  antlegion-bus  (Node.js/TypeScript)
    ↑                                     ↑
 协议服务端（总线）                    相同角色，相同协议，Node 实现

antlegion      (TypeScript)      →  不变，直接对接 antlegion-bus
    ↑
 Agent Runtime（节点客户端）
```

### 一句话概括

**`antlegion-bus` 是总线；`antlegion` 是节点客户端。协议不变，技术栈统一。**

---

## 2. 技术栈选型

| 层 | 选型 | 理由 |
|----|------|------|
| 运行时 | Node.js 22+ | 与 antlegion 对齐 |
| 语言 | TypeScript 5.7+ | 类型安全，协议类型零歧义 |
| HTTP 框架 | [Hono](https://hono.dev/) | 轻量、原生 WebSocket、零依赖 |
| WebSocket | `ws` + Hono | 复用 antlegion 依赖 |
| 持久化 | JSONL 追加日志（自研） | 对齐 Python 参考实现，无外部数据库依赖 |
| 加密 | Node.js crypto 内置 | SHA-256 + HMAC，对齐参考实现 |
| 测试 | Vitest | 与 antlegion 对齐 |
| 构建 | tsc | 简洁，无额外打包工具 |

> 不使用 Express/Fastify：Hono 对 WebSocket + HTTP 并存支持更好，bundle size 更小，且 API 简洁。

---

## 3. 架构图

```
┌──────────────────────────────────────────────────────────────────┐
│                        antlegion-bus                              │
│                                                                    │
│  ┌───────────────┐   ┌──────────────────────────────────────┐    │
│  │   HTTP Routes  │   │             BusEngine                 │    │
│  │               │   │                                        │    │
│  │  /ants/*     │──▶│  ┌──────────────┐  ┌──────────────┐  │    │
│  │  /facts/*     │   │  │FactRegistry  │  │AntRegistry  │  │    │
│  │  /health      │   │  │              │  │              │  │    │
│  │  /stats       │   │  │ 内存 Map     │  │ 内存 Map     │  │    │
│  │  /dashboard   │   │  │ + JSONL 持久 │  │ + Token 管理 │  │    │
│  └───────────────┘   │  └──────────────┘  └──────────────┘  │    │
│                       │                                        │    │
│  ┌───────────────┐   │  ┌──────────────┐  ┌──────────────┐  │    │
│  │  WS Endpoint  │   │  │WorkflowSM    │  │EpistemicSM   │  │    │
│  │               │──▶│  │状态机        │  │信任状态机     │  │    │
│  │  /ws          │   │  └──────────────┘  └──────────────┘  │    │
│  │  per-ant ws  │   │                                        │    │
│  └───────────────┘   │  ┌──────────────┐  ┌──────────────┐  │    │
│                       │  │FilterEngine  │  │ReliabilityMgr│  │    │
│                       │  │过滤 + 仲裁   │  │TEC/可靠性    │  │    │
│                       │  └──────────────┘  └──────────────┘  │    │
│                       │                                        │    │
│                       │  ┌──────────────┐  ┌──────────────┐  │    │
│                       │  │FlowControl   │  │JSONLStore    │  │    │
│                       │  │限流 + 去重   │  │持久化 + 恢复 │  │    │
│                       │  └──────────────┘  └──────────────┘  │    │
│                       └──────────────────────────────────────┘    │
│                                                                    │
│  ┌───────────────┐                                                 │
│  │  TTL / GC     │  ← setInterval 后台任务                       │
│  │  Loop         │                                                 │
│  └───────────────┘                                                 │
└──────────────────────────────────────────────────────────────────┘
         │                          │
         ▼                          ▼
  ┌─────────────┐          ┌──────────────────┐
  │ antlegion   │          │  Dashboard (SPA) │
  │ (Agent RT)  │          │  静态 HTML/JS    │
  └─────────────┘          └──────────────────┘
```

---

## 4. 协议类型 (TypeScript)

完整类型定义见 `src/types/protocol.ts`，核心概览：

```typescript
// ──── 枚举 ────

type FactState = "created" | "published" | "matched" | "claimed" | "processing" | "resolved" | "dead"

type EpistemicState = "asserted" | "corroborated" | "consensus"
  | "contested" | "refuted" | "superseded"

type SemanticKind = "observation" | "assertion" | "request"
  | "resolution" | "correction" | "signal"

type FactMode = "broadcast" | "exclusive"

type AntState = "active" | "degraded" | "isolated" | "offline"

// ──── 核心 Fact ────

interface Fact {
  // 不可变记录（发布后冻结）
  fact_id: string
  fact_type: string
  semantic_kind: SemanticKind
  payload: Record<string, unknown>
  domain_tags: string[]
  need_capabilities: string[]
  priority: number
  mode: FactMode
  source_ant_id: string
  causation_chain: string[]
  causation_depth: number
  subject_key?: string
  supersedes?: string
  created_at: number            // 秒级 Unix 时间戳
  ttl_seconds: number
  schema_version: string
  confidence: number | null
  content_hash: string
  signature?: string
  protocol_version: string

  // 可变总线状态（仅 BusEngine 修改）
  state: FactState
  epistemic_state: EpistemicState
  claimed_by: string | null
  resolved_at: number | null
  effective_priority: number | null
  sequence_number: number
  superseded_by?: string
  corroborations: string[]
  contradictions: string[]
}

// ──── Ant 节点 ────

interface AcceptanceFilter {
  capability_offer: string[]
  domain_interests: string[]
  fact_type_patterns: string[]
  priority_range: [number, number]
  modes: FactMode[]
  semantic_kinds: SemanticKind[]
  min_epistemic_rank: number
  min_confidence: number
  exclude_superseded: boolean
}

interface AntIdentity {
  ant_id: string
  name: string
  description: string
  acceptance_filter: AcceptanceFilter
  max_concurrent_claims: number
  state: AntState
  transmit_error_counter: number
  reliability_score: number
  connected_at: number | null
  last_heartbeat: number | null
}

// ──── HTTP API 模型 ────

interface FactCreateRequest {
  fact_type: string
  payload: Record<string, unknown>
  source_ant_id: string
  token: string
  content_hash: string
  created_at: number
  // 可选字段...
}

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

// ──── WebSocket 事件 ────

type BusEventType = "fact_available" | "fact_claimed" | "fact_resolved"
  | "fact_dead" | "fact_trust_changed" | "fact_superseded" | "ant_state_changed"

interface BusEvent {
  event_type: BusEventType
  fact?: Fact
  ant_id?: string
  detail?: string
  timestamp: number
}
```

`parent_fact_id` 是派生属性：`causation_chain.at(-1) ?? ""`。

---

## 5. 状态机

### 5.1 工作流状态机 (WorkflowStateMachine)

```
CREATED → PUBLISHED → MATCHED → CLAIMED → PROCESSING → RESOLVED（终态）
                    ↘ CLAIMED                    ↓
                    ↘ DEAD                   DEAD（终态）
CLAIMED → PUBLISHED （release）
DEAD → PUBLISHED    （管理员重新分发）
```

转换表：

```typescript
const TRANSITIONS: Record<FactState, FactState[]> = {
  created:    ["published", "dead"],
  published:  ["matched", "claimed", "dead"],
  matched:    ["claimed", "dead"],
  claimed:    ["processing", "resolved", "published", "dead"],
  processing: ["resolved", "dead"],
  resolved:   [],           // 终态
  dead:       ["published"], // 管理员重新分发
}
```

### 5.2 认知状态机 (EpistemicStateMachine)

认知状态从证据**派生**，不是显式转换：

```typescript
function recompute(fact: Fact, consensusQ = 2, refuteQ = 2): EpistemicState {
  if (fact.superseded_by)                          return "superseded"
  if (fact.contradictions.length >= refuteQ)       return "refuted"
  if (fact.contradictions.length > 0)              return "contested"
  if (fact.corroborations.length >= consensusQ)    return "consensus"
  if (fact.corroborations.length > 0)              return "corroborated"
  return "asserted"
}
```

认知等级（用于过滤器比较）：

| 状态 | 等级 |
|------|:----:|
| superseded | -3 |
| refuted | -2 |
| contested | -1 |
| asserted | 0 |
| corroborated | +1 |
| consensus | +2 |

---

## 6. BusEngine — 核心引擎

### 6.1 职责

```
BusEngine:
  - 事实存储（内存 Map + JSONL 持久化）
  - Ant 注册表 + Token 认证
  - 发布管道（8步，详见 §6.2）
  - 认领仲裁（原子操作，互斥锁）
  - 解决 + 子事实派生
  - 确认/反驳 → 认知状态重新计算
  - 释放（RELEASE → 返回 published）
  - 事实查询
  - TTL 过期循环
  - GC 循环（内存安全）
  - 日志压缩循环
  - 启动恢复（从 JSONL 重放）
```

### 6.2 发布管道（8步，从最廉价开始）

```
1. content_hash 验证          O(1)   — 必须
2. 因果深度检查               O(1)   — 必须（上限 16）
3. 因果循环检测               O(深度) — 应当
4. 去重窗口                   O(1)   — 应当（10s 窗口）
5. 每 Ant 限流               O(1)   — 应当（令牌桶）
6. 全局负载断路器             O(1)   — 可以
7. Schema 验证                O(payload) — 可以
8. 接受：签名 + 分配 seqno   O(1)   — 必须
```

### 6.3 并发安全

Node.js 是单线程事件循环，**不需要互斥锁**。所有状态修改都是同步的（Promise 异步但顺序执行）。

唯一需要注意的是 CLAIM 的原子性：在同一事件循环 tick 内完成状态检查 + 修改，不 await 中间步骤。

```typescript
// 安全：单 tick 内完成，不被打断
function claimFact(factId: string, antId: string): [boolean, string] {
  const fact = this.facts.get(factId)
  if (!fact) return [false, "fact not found"]
  if (fact.state !== "published" && fact.state !== "matched")
    return [false, `fact is ${fact.state}`]
  // 原子修改（同步，单 tick）
  fact.state = "claimed"
  fact.claimed_by = antId
  this.activeClaims.set(antId, (this.activeClaims.get(antId) ?? 0) + 1)
  this.store.append(fact, "claim")
  return [true, "ok"]
}
```

---

## 7. HTTP API 端点

对齐 Python 参考实现（`ant_legion_bus/server/app.py`）：

| 方法 | 路径 | 功能 |
|------|------|------|
| POST | `/ants/connect` | 注册 Ant |
| POST | `/ants/{id}/disconnect` | 注销 Ant |
| POST | `/ants/{id}/heartbeat` | 心跳 |
| GET | `/ants` | 列出所有 Ant |
| GET | `/ants/{id}` | 获取 Ant 详情 |
| GET | `/ants/{id}/activity` | Ant 活动日志 |
| POST | `/facts` | 发布事实 |
| POST | `/facts/{id}/claim` | 认领事实 |
| POST | `/facts/{id}/release` | 释放事实 |
| POST | `/facts/{id}/resolve` | 解决事实 |
| POST | `/facts/{id}/corroborate` | 确认事实 |
| POST | `/facts/{id}/contradict` | 反驳事实 |
| GET | `/facts` | 查询事实列表 |
| GET | `/facts/{id}` | 获取单个事实 |
| GET | `/facts/{id}/causation` | 获取因果链 |
| GET | `/health` | 健康检查 |
| GET | `/stats` | 总线统计 |
| WS | `/ws` | WebSocket 事件推送（per-ant） |
| POST | `/admin/facts/{id}/redispatch` | 管理员重新分发 dead fact |
| POST | `/admin/facts/cleanup` | 批量清理 resolved/dead facts |
| DELETE | `/admin/facts/{id}` | 强制删除 fact |
| GET | `/admin/dead-letter` | Dead letter 队列 |
| POST | `/admin/ants/{id}/isolate` | 强制隔离 ant |
| POST | `/admin/ants/{id}/restore` | 恢复隔离的 ant |
| GET | `/admin/metrics` | 详细运行指标 |
| POST | `/admin/storage/gc` | 手动 GC |
| POST | `/admin/storage/compact` | 日志压缩 |
| GET | `/admin/storage/stats` | 存储统计 |
| GET | `/admin/causation/broken-chains` | 断链检查 |
| POST | `/admin/causation/repair` | 因果链修复 |

### 认证头

所有需要 ant 身份的操作需传递：

```
X-Ant-Id: {ant_id}
X-Ant-Token: {token}
```

---

## 8. WebSocket 协议

每个 Ant 建立一个 WebSocket 连接，用于接收总线推送的事件。

```
客户端连接：GET /ws?ant_id={id}&token={token}
服务端验证 token，通过后注册 WS 连接
服务端 push BusEvent JSON 到客户端
客户端收到事件后通过 HTTP 操作（claim/resolve/publish）
```

WebSocket 只用于**服务端推送**，不用于客户端请求（客户端请求全走 REST）。

事件格式：

```json
{
  "event_type": "fact_available",
  "fact": { "...完整 Fact 字段..." },
  "timestamp": 1709712000.0
}
```

---

## 9. 过滤引擎 (FilterEngine)

### 9.1 过滤逻辑

当且仅当以下全部条件通过时，事实到达 Ant：

```
门控 0：ant.state ∈ {active, degraded}
门控 1：fact.priority ∈ filter.priority_range
门控 2：fact.mode ∈ filter.modes
门控 3：内容匹配（至少满足一项）
  - fact.need_capabilities ∩ filter.capability_offer ≠ ∅
  - fact.domain_tags ∩ filter.domain_interests ≠ ∅
  - fact.fact_type matches 任意 filter.fact_type_patterns（glob）
  （过滤器全空的 Ant 接收所有事实 — 监控模式）
门控 4（扩展）：
  - fact.epistemic_state rank ≥ filter.min_epistemic_rank
  - fact.confidence ≥ filter.min_confidence（非 null 时）
  - 若 filter.exclude_superseded: fact.epistemic_state ≠ superseded
```

### 9.2 独占仲裁

```
score = (能力重叠数 × 10 + 领域重叠数 × 5 + 类型命中 × 3)
        × reliability_score

平局裁决：score → reliability_score → ant_id（字典序）
```

---

## 10. 可靠性管理器 (ReliabilityManager)

### 10.1 TEC（发送错误计数器）调整

| 事件 | TEC 变化 |
|------|:--------:|
| 事实被矛盾 | +8 |
| Schema 校验失败 | +8 |
| 事实超时未解决 | +2 |
| 超出限流 | +1 |
| 事实被佐证 | -1 |
| 事实已解决 | -1 |
| 心跳正常 | -1 |

TEC 下限 0，无上限。

### 10.2 Ant 状态机

```
ACTIVE（TEC 0-127）→ DEGRADED（TEC 128-255）→ ISOLATED（TEC ≥ 256）
```

降级/隔离后可通过持续正向行为恢复（TEC 自然下降）。

### 10.3 reliability_score 映射

| Ant 状态 | reliability_score |
|:---------:|:-----------------:|
| ACTIVE | 1.0 |
| DEGRADED | 0.5 |
| ISOLATED | 0.0 |

---

## 11. 流量控制 (FlowControl)

### 11.1 令牌桶限流（per-Ant）

```
容量：20 令牌
补充速率：5 令牌/秒
每次 publish 消耗 1 令牌
```

### 11.2 去重窗口

```
时间窗口：10 秒
键：content_hash
同一 content_hash 在 10 秒内重复发布 → 拒绝（去重）
```

### 11.3 全局断路器

```
时间窗口：5 秒
触发阈值：200 条事实/窗口
触发后：拒绝新发布，直到窗口结束
```

---

## 12. 持久化 (JSONLStore)

### 12.1 格式

每个事件一行 JSON：

```json
{"event": "publish", "timestamp": 1709712000.0, "fact": {...}}
{"event": "claim", "timestamp": 1709712001.0, "fact": {...}, "meta": {"claimer": "..."}}
{"event": "resolve", "timestamp": 1709712002.0, "fact": {...}, "meta": {"resolver": "..."}}
```

事件类型：`publish` | `claim` | `resolve` | `dead` | `corroborate` | `contradict` | `supersede` | `causation_repair` | `purge`

### 12.2 启动恢复

```typescript
recover(): void {
  for (const line of readLines(this.path)) {
    try {
      const entry = JSON.parse(line)
      // 按 event 类型重放状态
    } catch {
      // 跳过损坏行，记录 warn
    }
  }
  // 截断到最后一个成功解析位置（防止重复损坏）
}
```

### 12.3 压缩

原子压缩（tmp 文件 + rename）：仅保留内存中仍存在的事实的最新状态条目。

---

## 13. 后台任务

| 任务 | 间隔 | 功能 |
|------|------|------|
| TTL 过期循环 | 10s | 将超过 TTL 的 published/matched 事实标记为 dead |
| GC 循环 | 60s | 清理内存中过期的 resolved/dead 事实 |
| 压缩循环 | 3600s | JSONL 日志压缩 |
| 心跳超时检查 | 30s | 检测断线 Ant（可选） |

所有后台任务用 `setInterval` 实现，启动时注册，进程退出时清理。

---

## 14. 看板 (Dashboard)

与 Python 版本对齐的 Web 看板：

- 事实列表（按状态、类型过滤）
- 事实详情（含因果链、认知状态）
- Ant 列表（健康状态、活动日志）
- 实时事件流（SSE 或 WS）
- 统计数据（总线 stats）
- 管理操作（GC、压缩、因果链修复）

实现为静态 HTML + 原生 JS（无前端框架依赖），内嵌在 `src/server/static/`。

---

## 15. 目录结构

```
antlegion-bus/
├── src/
│   ├── index.ts                     # 入口：启动 HTTP 服务器
│   ├── types/
│   │   └── protocol.ts              # 协议类型定义（完整 Fact、Ant、Filter、Event）
│   ├── engine/
│   │   ├── BusEngine.ts             # 核心引擎（主类）
│   │   ├── WorkflowStateMachine.ts  # 工作流状态机
│   │   ├── EpistemicStateMachine.ts # 认知状态机
│   │   ├── FilterEngine.ts          # 过滤 + 仲裁
│   │   ├── ReliabilityManager.ts    # TEC / Ant 状态
│   │   ├── FlowControl.ts           # 限流 + 去重 + 断路器
│   │   └── ContentHasher.ts         # content_hash + bus signature
│   ├── persistence/
│   │   └── JSONLStore.ts            # JSONL 追加日志 + 恢复 + 压缩
│   └── server/
│       ├── app.ts                   # Hono 路由（HTTP + WS）
│       ├── middleware.ts            # 认证中间件
│       └── static/
│           └── index.html           # 看板 SPA
├── protocol/                        # 协议规范（从 ant_legion_bus 迁移）
│   ├── SPEC.md
│   ├── SPEC.zh-CN.md
│   ├── EXTENSIONS.md
│   ├── EXTENSIONS.zh-CN.md
│   ├── IMPLEMENTATION-NOTES.md
│   └── IMPLEMENTATION-NOTES.zh-CN.md
├── test/
│   ├── engine.test.ts               # BusEngine 单元测试
│   ├── filter.test.ts               # 过滤器测试
│   ├── persistence.test.ts          # JSONL 存储测试
│   └── integration.test.ts          # 完整 HTTP/WS 集成测试
├── DESIGN.md                        # 本文档
├── PROGRESS.md                      # 实现进度追踪
├── package.json
├── tsconfig.json
├── Dockerfile
└── antlegion-bus.json                 # 服务配置
```

---

## 16. 配置

```jsonc
// antlegion-bus.json
{
  "server": {
    "port": 28080,
    "host": "0.0.0.0"
  },
  "data": {
    "dir": ".data"
  },
  "bus": {
    "maxCausationDepth": 16,
    "defaultTtlSeconds": 300,
    "gcRetainResolvedSeconds": 600,
    "gcRetainDeadSeconds": 3600,
    "gcMaxFacts": 10000,
    "replayOnReconnect": 50
  },
  "flow": {
    "dedupeWindowSeconds": 10,
    "rateLimitCapacity": 20,
    "rateLimitRefillRate": 5,
    "circuitBreakerWindowSeconds": 5,
    "circuitBreakerThreshold": 200
  },
  "trust": {
    "consensusQuorum": 2,
    "refutationQuorum": 2
  }
}
```

环境变量覆盖：

| 变量 | 覆盖 |
|------|------|
| `PORT` | `server.port` |
| `ANTLEGION_DATA_DIR` | `data.dir` |
| `ANTLEGION_BUS_SECRET` | bus 签名密钥（不在配置文件中） |

---

## 17. 与 Python 参考实现的对齐说明

| 方面 | Python (`ant_legion_bus`) | Node (`antlegion-bus`) |
|------|--------------------------|------------------------|
| content_hash | SHA-256，规范化 JSON | 相同（Node `crypto`） |
| bus signature | HMAC-SHA256 | 相同 |
| 状态机 | `WorkflowStateMachine` 类 | 相同逻辑，TS 实现 |
| 认知状态 | `EpistemicStateMachine` 类 | 相同逻辑，TS 实现 |
| 过滤仲裁 | `evaluate_filter` + `arbitrate` | 相同算法 |
| JSONL 格式 | 追加写入，行 JSON | 相同格式，互操作 |
| API 路径 | FastAPI `/ants/`, `/facts/` | 相同路径 |
| WS 协议 | per-ant，事件推送 | 相同语义 |
| 看板 | 静态 HTML | 相同功能 |
| TEC/可靠性 | `ReliabilityManager` | 相同算法 |
| 令牌桶 | `PublishGate` | 相同参数 |

**互操作目标**：`antlegion` 客户端可以无感切换 Python 总线和 Node 总线。

---

## 18. 实现阶段

### Phase 1 — 骨架 + 协议类型 + 持久化

| 模块 | 工作 |
|------|------|
| `src/types/protocol.ts` | 完整协议类型定义 |
| `src/engine/ContentHasher.ts` | content_hash + HMAC signature |
| `src/engine/WorkflowStateMachine.ts` | 工作流状态机 |
| `src/engine/EpistemicStateMachine.ts` | 认知状态机 |
| `src/persistence/JSONLStore.ts` | JSONL 追加 + 恢复 + 压缩 |

**验证**：单元测试，状态机转换全覆盖，hash 与 Python 版本一致。

### Phase 2 — 过滤 + 可靠性 + 流控

| 模块 | 工作 |
|------|------|
| `src/engine/FilterEngine.ts` | 过滤评估 + 独占仲裁 |
| `src/engine/ReliabilityManager.ts` | TEC + Ant 状态机 |
| `src/engine/FlowControl.ts` | 令牌桶 + 去重 + 断路器 |

**验证**：过滤仲裁测试，TEC 状态转换测试。

### Phase 3 — BusEngine 核心

| 模块 | 工作 |
|------|------|
| `src/engine/BusEngine.ts` | 发布管道、认领、解决、释放、确认/反驳 |
| 后台任务（TTL/GC/压缩） | 集成进 BusEngine |

**验证**：完整生命周期测试（publish→claim→resolve→child fact）。

### Phase 4 — HTTP/WS 服务器

| 模块 | 工作 |
|------|------|
| `src/server/app.ts` | 全部 REST 路由 |
| `src/server/middleware.ts` | Token 认证中间件 |
| WS 端点 | per-ant 事件推送 |

**验证**：`antlegion` 可以连接并收发事件。

### Phase 5 — 看板 + 部署

| 模块 | 工作 |
|------|------|
| `src/server/static/index.html` | 看板 SPA |
| `Dockerfile` | 多阶段构建 |
| `antlegion-bus.json` | 配置文件 |

**验证**：`docker compose up` 同时启动总线 + 4 个 antlegion 实例正常协作。

---

## 19. 依赖

```json
{
  "dependencies": {
    "hono": "^4",
    "@hono/node-server": "^1",
    "ws": "^8"
  },
  "devDependencies": {
    "typescript": "^5.7",
    "@types/node": "^22",
    "@types/ws": "^8",
    "vitest": "^4"
  }
}
```

运行时零外部数据库依赖。

---

## 20. 测试策略

| 层级 | 工具 | 覆盖 |
|------|------|------|
| 单元 | Vitest | 状态机、过滤器、hash 算法、流控 |
| 集成 | Vitest + `supertest`/`ws` | 完整 HTTP/WS 生命周期 |
| 对齐验证 | 与 Python 实现共享测试向量 | content_hash 一致性 |

关键测试用例：

1. publish → claim（独占仲裁）→ resolve → child fact 因果链
2. publish → TTL 过期 → dead 事件推送
3. corroborate ×2 → epistemic_state = consensus
4. contradict ×2 → epistemic_state = refuted
5. subject_key 自动取代
6. 超出限流 → 拒绝发布
7. 启动恢复（JSONL 重放）
8. WebSocket 断线重连 + 事件回放
