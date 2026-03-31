# AntLegion Bus 协议规范 v1.0

> 面向自主 AI Agent 集群的事实驱动协调协议。

作者：**Carter.Yang**

English: [SPEC.md](SPEC.md)

---

本文档中的关键词"必须"（MUST）、"不得"（MUST NOT）、"应当"（SHOULD）、"不应"（SHOULD NOT）、"可以"（MAY）和"可选"（OPTIONAL）依照 [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119) 的定义进行解释。

---

## 0. 概述

### 0.1 这个协议是什么

AntLegion Bus 是一个面向自主 AI Agent 集群的**协调协议**。

一句话概括：**Agent 之间共享事实，不传递命令。**

每个 Agent 发布关于已发生的事情、存在的状态或需要处理的任务的不可变陈述。其他 Agent 自行判断是否响应。没有编排器决定谁做什么。工作流从事实的因果链中自发涌现。

### 0.2 两个实现面

协议有且仅有两个实现面：

```
┌──────────────────────────────────────────────────────┐
│                    AntLegion Bus                      │
│                                                      │
│  ┌─────────────┐       事实 / 事件           ┌──────┐ │
│  │    总线      │◀──────────────────────────▶│ 节点 │ │
│  │  (服务端)   │                            │(ant)│ │
│  └─────────────┘                            └──────┘ │
│                                                      │
│  总线：存储事实，强制执行协议不变量，                │
│        分发事件，仲裁独占认领。                      │
│                                                      │
│  节点：携带身份和过滤器连接总线，                    │
│        感知事件，发布/认领/解决事实。                │
└──────────────────────────────────────────────────────┘
```

**总线** — 共享通信介质。每个集群一个总线实例。负责存储事实、强制执行协议不变量、评估过滤器、仲裁独占认领、向连接节点推送事件。参考实现为 `ant_legion_bus`。

**节点（Ant）** — 连接到总线的任意 Agent。每个集群有多个节点。节点在连接时声明身份和接受过滤器，通过发布、认领、解决和验证事实参与协作。节点之间相互解耦，只与总线交互。OpenAnt Agent 的参考节点实现为 `ant_legion_bus_plugin`。

本文档规定两个实现面各自必须（MUST）和应当（SHOULD）完成的事情。§11 覆盖总线，§12 覆盖节点。

### 0.3 范围

本规范覆盖：

- 协议实体：Fact、Ant、AcceptanceFilter、Bus（§2）
- 匹配与仲裁协议（§3）
- 优先级模型（§4）
- 事实生命周期与状态机（§5）
- 总线操作与时序（§6）
- 安全护栏（§7）
- 事件目录（§8）
- 线路格式（§9）
- 扩展目录（§10）
- **总线实现职责**（§11）
- **节点实现职责**（§12）

不在范围内：分布式总线部署、跨总线联邦、传输层绑定（参见 §1.4）。

---

## 1. 哲学基础

### 1.1 核心公理

**事实，不是命令。**

总线传递关于现实的陈述。Ant 永远不会告诉另一个 Ant 该做什么；它只陈述发生了什么、存在什么或需要什么。响应的 Ant 根据自身判断行动。

```
✅  "auth.py 已修改，diff: +23 -5，领域：认证"
✅  "用户请求对 PR #42 进行代码审查"
✅  "ant-B 已认领 fact-0x3A1"
❌  "ant-B，去审查 auth.py"       ← 命令，禁止
```

**为什么不用命令？** 在 AI Agent 集群中，没有任何单一 Agent 具备全局知识或保证可靠性。基于命令的协调要求发送方了解接收方的状态、能力和可用性——这些假设在动态、易故障的环境中随时会被打破。基于事实的协调将"发生了什么"与"谁应该响应"解耦，使系统能够随着 Agent 的加入、离开或故障而自组织。

### 1.2 AI 矩阵组织论

人类组织通过 OKR 层级结构对齐，因为人类通信存在损耗、速度慢且带宽有限。AI Agent 可以直接处理原始事实，并在不损失保真度的情况下维护因果链。

因此：**在 AI 矩阵组织中，事实既是协调媒介，也是组织结构本身。** 事实的因果链是 AI 等价于人类组织架构的东西——它不是自上而下设计的，而是从 Agent 对现实的响应中自然涌现。

### 1.3 公理

这些是定义系统身份的不可妥协属性。移除其中任何一个都会产生本质上不同的系统。

1. **事实，不是命令** — 总线传递关于现实的陈述，永远不是指令。
2. **事实是不可变的** — 已发布事实的内容不能被修改。只有总线对其的评估会演化。新事实可以取代旧事实。
3. **广播介质，本地过滤** — 所有事实存在于共享的全局事实空间中，可全局寻址。总线将事实分发给声明了匹配过滤器的 Ant。每个 Ant 声明自己关心什么。没有中央编排器。
4. **事实可被质疑** — 任何 Ant 都可以确认或反驳任何其他 Ant 的事实。总线记录这些行动，但不裁定真相。消费者自行决定信任什么。
5. **因果链是组织结构** — 事实引用其父事实，在没有预先设计的编排的情况下形成自发工作流。
6. **故障安全降级** — 行为异常的 Ant 被逐步隔离。没有单个 Ant 的故障能够使总线崩溃。

### 1.4 非目标

以下内容明确不在本协议范围之内：

- **共识** — 总线不确定真相。它为消费者判断提供证据（确认、反驳、置信度）。
- **分布式总线部署** — 总线本身的复制、分区和容错是实现层面的问题。
- **跨总线联邦** — 独立总线实例之间的通信留待未来扩展。
- **传输层绑定** — 本规范与传输无关。HTTP、WebSocket、Unix socket 等的绑定是独立文档。

### 1.5 架构传承

| 来源 | 我们借鉴的内容 |
|------|---------------|
| **CAN Bus**（ISO 11898） | 基于内容的寻址、广播+本地过滤、优先级仲裁、错误状态机、无中央主节点 |
| **EDA**（事件驱动架构） | 事件溯源（不可变追加日志）、幂等消费、编排模式 |
| **科学方法** | 同行评审（确认/反驳）、置信度报告、知识取代 |

### 1.6 设计理由

| 决策 | 理由 |
|------|------|
| 事实，不是命令 | AI Agent 缺乏全局知识；将"发生了什么"与"谁响应"解耦能够实现自组织 |
| 不可变事实 | 支持审计、回放、去重和因果推理；可变事实会破坏这四点 |
| 广播+过滤 | 无编排器瓶颈；每个 Agent 的过滤器是其"感知装置" |
| 独占/广播模式 | 根本语义差异："单一处理者"与"共享感知"——不是优化手段 |
| 确认/反驳纳入核心 | AI 输出本质上不可靠；没有协议级别的可质疑性，信任只能私下处理，破坏互操作性 |
| 内容哈希 | 不可变记录的篡改检测；SHA-256 是为了安全性，不是速度 |
| JSON 线路格式 | 人类可读、可调试、通用支持；对性能敏感的部署可以使用二进制编码 |

---

## 2. 协议实体

### 2.1 事实（Fact）

通信的原子单元。类比于 CAN 帧。

事实有两个结构区域：

- **不可变记录** — 由发布者设置，发布后冻结。由 `content_hash` 覆盖。
- **可变总线状态** — 仅由总线管理。随事实在生命周期中的流转而变化。

#### 不可变记录字段

| 字段 | 类型 | 要求 | 描述 |
|------|------|:----:|------|
| `fact_id` | string | 必须 | 全局唯一标识符 |
| `fact_type` | string | 必须 | 点号分隔的分类法（如 `code.review.needed`） |
| `payload` | object | 必须 | 事实数据。Schema 由 `fact_type` 决定 |
| `source_ant_id` | string | 必须 | 发布者的 ant ID |
| `created_at` | float | 必须 | 创建时的 Unix 时间戳 |
| `mode` | enum | 必须 | `exclusive`（单一处理者）或 `broadcast`（所有匹配者） |
| `priority` | int 0-7 | 必须 | 较低值 = 较高优先级（CAN 惯例）。参见 §4 |
| `ttl_seconds` | int | 必须 | 存活时间。超时后 → dead |
| `parent_fact_id` | string | 可选 | 直接因果父事实。根事实为空 |
| `causation_depth` | int | 必须 | 在因果链中的深度。根事实为 0。总线必须强制执行最大值 |
| `confidence` | float 0-1 | 可选 | 发布者自评确定性。缺失 = 未指定（不等于"确定"） |
| `content_hash` | string | 必须 | 规范不可变记录的 SHA-256（字段列表与排序规则见实现注记） |
| `domain_tags` | string[] | 可选 | 内容领域标签（如 `["python", "auth"]`） |
| `need_capabilities` | string[] | 可选 | 处理此事实所需的能力 |

#### 可变总线状态字段

| 字段 | 类型 | 描述 |
|------|------|------|
| `state` | enum | 协议生命周期状态（参见 §5） |
| `claimed_by` | string? | 已认领的 Ant ID（仅独占模式） |
| `resolved_at` | float? | 解决时的时间戳 |
| `corroborations` | string[] | 已确认此事实的 Ant ID 列表 |
| `contradictions` | string[] | 已反驳此事实的 Ant ID 列表 |

实现可以跟踪额外的总线内部状态（如 `effective_priority`、`matched` 标志），但这些不属于协议可见状态。

### 2.2 Ant（节点）

Agent 在总线上的存在。类比于 CAN ECU。Ant 可以是 AI Agent 或人工操作员——协议不作区分。

| 字段 | 类型 | 要求 | 描述 |
|------|------|:----:|------|
| `ant_id` | string | 必须 | 唯一标识符 |
| `name` | string | 必须 | 人类可读名称 |
| `description` | string | 可选 | 此 Ant 的功能描述 |
| `acceptance_filter` | Filter | 必须 | 声明此 Ant 想接收的事实 |
| `max_concurrent_claims` | int | 应当 | 可同时处理的最大独占事实数 |
| `state` | enum | 必须 | `active`、`degraded`、`isolated`、`offline` |

实现可以维护额外的每 Ant 元数据（如可靠性分数、错误计数器），参见故障隔离扩展。

### 2.3 接受过滤器（AcceptanceFilter）

Ant 对其想接收事实的声明。基于内容，不基于目标地址。

总线必须支持对事实属性的基于内容的过滤。以下过滤维度是推荐的：

| 维度 | 类型 | 描述 |
|------|------|------|
| `capability_offer` | string[] | 此 Ant 能做什么（如 `["review", "python"]`） |
| `domain_interests` | string[] | 它订阅哪些领域 |
| `fact_type_patterns` | string[] | Glob 模式（如 `code.*`、`deploy.*.completed`） |
| `priority_range` | (int, int) | 接受的优先级范围（低，高） |
| `modes` | enum[] | 接受哪些事实模式 |

实现可以支持额外的过滤维度（如语义类型、认知状态、置信度阈值），参见协议扩展。

### 2.4 总线（Bus）

共享通信介质。总线不是被动管道——它有义务：

| 义务 | 要求 |
|------|:----:|
| 发布后不得修改事实的不可变记录字段 | 必须 |
| 必须将事实分发给所有匹配的 Ant | 必须 |
| 必须强制执行 `exclusive` 语义（最多一个认领者） | 必须 |
| 必须记录确认和反驳 | 必须 |
| 必须强制执行因果深度限制 | 必须 |
| 必须拒绝 `content_hash` 无效的事实 | 必须 |
| 可以在过载时限流、去重和卸载负载 | 可以 |
| 可以维护 Ant 可靠性状态并隔离故障 Ant | 可以 |
| 可以支持优先级老化以防止饥饿 | 可以 |

---

## 3. 匹配协议

### 3.1 过滤器评估

当且仅当以下所有条件通过时，事实才能到达 Ant：

```
门控 0：ant.state ∈ {active, degraded}               （必须：不是 isolated/offline）
门控 1：fact.priority ∈ ant.filter.priority_range     （必须：优先级掩码）
门控 2：fact.mode ∈ ant.filter.modes                  （必须：模式兼容性）
门控 3：至少一个内容维度匹配                           （必须）
```

门控 3 的内容匹配应至少包括：
- `fact.need_capabilities ∩ ant.capability_offer ≠ ∅`，或
- `fact.domain_tags ∩ ant.domain_interests ≠ ∅`，或
- `fact.fact_type` 匹配任意 `ant.fact_type_patterns`（Glob）

过滤器为空的 Ant（无能力、无领域、无模式）应接收所有事实（监控模式）。

### 3.2 仲裁

| 模式 | 行为 |
|------|------|
| `broadcast` | 所有匹配的 Ant 都接收事实。无仲裁。 |
| `exclusive` | 总线最多选择一个合格的 Ant。给定相同的可见输入，选择必须是确定性的。 |

独占仲裁的具体评分或排名算法是实现选择。参见实现注记中的推荐算法。

---

## 4. 优先级

### 4.1 优先级级别

优先级使用 3 位字段（0-7），遵循 CAN 惯例（较低值 = 较高优先级）：

| 值 | 名称 | 描述 |
|----|------|------|
| 0 | CRITICAL（紧急） | 系统故障、数据丢失防护 |
| 1 | HIGH（高） | 面向用户的阻塞性问题 |
| 2 | ELEVATED（较高） | 重要但不阻塞 |
| 3 | NORMAL（普通） | 大多数事实的默认值 |
| 4 | LOW（低） | 后台任务 |
| 5 | BACKGROUND（背景） | 维护、优化 |
| 6 | IDLE（空闲） | 尽力而为的工作 |
| 7 | BULK（批量） | 批处理 |

### 4.2 防饥饿

总线应实现老化机制，防止低优先级事实被永久饿死。事实不得老化到 CRITICAL（优先级 0）——该级别保留给真正的紧急情况。

参见实现注记中的推荐老化参数。

---

## 5. 事实生命周期

### 5.1 协议可见状态

```
              PUBLISH
  ─────────────────────▶ PUBLISHED（已发布）
                              │
                    ┌─────────┼─────────┐
                    │exclusive│         │broadcast
                    ▼         │         ▼
                 CLAIMED      │     （所有匹配的
                （已认领）     │      Ant 都看到）
                    │         │         │
                    ▼         │         │
                 RESOLVED ◀───┘    RESOLVED（已解决）
                （已解决）
                    │
                    └──▶ 可以发出子事实（因果链延伸）

  任何非终态 ──▶ DEAD（已死亡，TTL 超时或失败）
```

| 状态 | 描述 |
|------|------|
| `published` | 事实已被总线接受，对匹配的 Ant 可见 |
| `claimed` | 一个 Ant 已承担独占责任（仅独占模式） |
| `resolved` | 处理完成。可能产生了子事实 |
| `dead` | 事实无法被处理（TTL 超时、所有 Ant 释放、显式失败） |

实现可以跟踪额外的内部状态（如 `matched`、`processing`），但这些不得出现在协议级别的响应或事件中。

### 5.2 状态转换

| 从 | 到 | 触发器 |
|----|----|--------|
| — | `published` | PUBLISH 被总线接受 |
| `published` | `claimed` | 某 Ant 执行 CLAIM（仅独占模式） |
| `published` | `resolved` | 直接解决（广播模式） |
| `published` | `dead` | TTL 超时，无匹配 |
| `claimed` | `resolved` | 认领 Ant 执行 RESOLVE |
| `claimed` | `published` | 认领 Ant 执行 RELEASE（返回池中） |
| `claimed` | `dead` | 认领超时，Ant 故障 |
| `dead` | `published` | 管理员重新分发（可选） |

---

## 6. 总线操作

### 6.1 操作目录

| 操作码 | 方向 | 描述 |
|--------|------|------|
| `CONNECT` | ant → bus | 携带 Ant 身份加入总线 |
| `DISCONNECT` | ant → bus | 优雅地离开总线 |
| `HEARTBEAT` | ant → bus | 证明存活性 |
| `PUBLISH` | ant → bus | 向总线发出事实 |
| `CLAIM` | ant → bus | 认领独占事实进行处理 |
| `RELEASE` | ant → bus | 将已认领事实释放回池中 |
| `RESOLVE` | ant → bus | 完成处理，可选地发出子事实 |
| `QUERY` | ant → bus | 按过滤器读取事实（只读） |
| `SUBSCRIBE` | ant → bus | 注册以实时接收匹配事实 |
| `CORROBORATE` | ant → bus | 确认另一个 Ant 的事实。总线必须将 ant_id 追加到 `corroborations` |
| `CONTRADICT` | ant → bus | 质疑另一个 Ant 的事实。总线必须将 ant_id 追加到 `contradictions` |

### 6.2 PUBLISH 时序

```
Ant                                总线
  │                                  │
  │──── PUBLISH(fact) ──────────────▶│
  │                                  │── 验证 content_hash
  │                                  │── 运行准入检查
  │                                  │── 如果全部通过：
  │                                  │     设置 state = PUBLISHED
  │                                  │     持久化事实
  │                                  │     对所有 Ant 评估过滤器
  │                                  │     向匹配的 Ant 推送 FACT_AVAILABLE
  │◀─── ACK(fact_id) ───────────────│
  │                                  │
```

准入检查必须包括内容哈希验证和因果深度强制。实现可以添加限流、去重、Schema 验证和可靠性门控。

### 6.3 CLAIM 时序

```
Ant                                总线
  │                                  │
  │──── CLAIM(fact_id) ─────────────▶│
  │                                  │── 验证 fact.mode == EXCLUSIVE
  │                                  │── 验证 fact.state == PUBLISHED
  │                                  │── 验证 ant 并发认领数 < max
  │                                  │── 原子操作：设置 claimed_by = ant_id
  │                                  │            设置 state = CLAIMED
  │                                  │── 向其他匹配的 Ant 推送 FACT_CLAIMED
  │◀─── ACK(success) ───────────────│
  │                                  │
```

CLAIM 是原子的。当多个 Ant 尝试认领同一事实时，总线必须使用与 §3.2 一致的确定性标准最多选择一个。没有仲裁扩展时，默认选择顺序为先到先得。有仲裁扩展时，总线应使用扩展的评分算法。被拒绝的 Ant 必须收到失败响应，不应对同一事实重试。

### 6.4 RESOLVE 时序

```
Ant                                总线
  │                                  │
  │──── RESOLVE(fact_id,             │
  │       result_facts=[...]) ──────▶│
  │                                  │── 验证 ant == fact.claimed_by
  │                                  │── 设置 state = RESOLVED
  │                                  │── 设置 resolved_at = now
  │                                  │── 对每个子事实：
  │                                  │     设置 parent_fact_id = fact_id
  │                                  │     设置 causation_depth = parent + 1
  │                                  │     运行 PUBLISH 时序
  │◀─── ACK ────────────────────────│
  │                                  │
```

### 6.5 CORROBORATE / CONTRADICT

Ant 不得确认或反驳自己的事实。总线必须拒绝此类尝试。

总线必须记录这些操作（将 ant_id 追加到相应列表），但不得基于确认/反驳计数自主更改事实的生命周期状态。信任推导是消费者侧或扩展层面的关注点。

---

## 7. 安全护栏

总线必须强制执行特定安全不变量，以防止级联故障和资源耗尽。

### 7.1 强制护栏

| 护栏 | 要求 |
|------|:----:|
| **内容完整性** — 拒绝 `content_hash` 与规范不可变记录不匹配的事实 | 必须 |
| **因果深度限制** — 拒绝超过配置最大深度的事实 | 必须 |
| **不可变性** — 发布后永不修改事实的不可变记录字段 | 必须 |
| **认领排他性** — 最多一个 Ant 可以认领独占事实 | 必须 |
| **TTL 强制** — 超过存活时间的事实标记为过期 | 必须 |
| **跨领域传播通过派生** — 事实的不可变字段（包括 `fact_type`）不得被修改以改变其领域；跨领域传播必须使用带有 `parent_fact_id` 链接的新派生事实 | 必须 |

### 7.2 推荐护栏

| 护栏 | 要求 |
|------|:----:|
| **因果循环检测** — 拒绝父链中包含循环的事实 | 应当 |
| **去重** — 在时间窗口内抑制重复发布 | 应当 |
| **每 Ant 限流** — 防止单个 Ant 淹没总线 | 应当 |
| **全局负载卸载** — 在极端负载下保护总线 | 可以 |
| **Ant 可靠性跟踪** — 隔离持续故障的 Ant | 可以 |
| **优先级老化** — 提升未认领事实的优先级以防止饥饿 | 可以 |
| **Schema 验证** — 对照已注册 Schema 验证 payload | 可以 |
| **事实归档** — 对超过可配置保留窗口的终态事实（resolved、dead）进行压缩或归档，以限制存储增长 | 可以 |

所有推荐护栏的具体参数在实现注记中定义。

---

## 8. 事件

总线向已订阅的 Ant 推送以下事件：

| 事件 | 触发条件 | 载荷 |
|------|----------|------|
| `fact_available` | 新事实匹配 Ant 的过滤器 | 事实 |
| `fact_claimed` | 有人认领了独占事实 | fact_id、认领者 ant_id |
| `fact_resolved` | 事实被解决 | fact_id |
| `fact_dead` | 事实进入 dead 状态 | fact_id、原因 |

扩展可以定义额外事件（如 `fact_trust_changed`、`fact_superseded`、`ant_state_changed`）。

---

## 9. 线路格式

所有总线通信使用统一的 JSON 信封：

```json
{
  "message_id": "a1b2c3d4e5f6g7h8",
  "op": "publish",
  "ant_id": "abc123def456",
  "timestamp": 1709712000.0,
  "fact": { "...事实字段..." },
  "success": true,
  "error": null
}
```

序列化：JSON。实现可以支持额外编码（MessagePack、Protobuf）作为传输层优化，但必须支持 JSON 作为基准。

---

## 10. 扩展

本核心规范设计为可扩展的。扩展独立版本化，均为可选。

| 扩展 | 范围 |
|------|------|
| **认知状态** | 信任生命周期（asserted → corroborated → consensus → contested → refuted）、法定人数规则、信任推导 |
| **语义分类** | `semantic_kind` 字段（observation、assertion、request、resolution、correction、signal） |
| **知识演化** | `subject_key` 字段、自动和显式取代、`SUPERSEDED` 状态 |
| **Schema 治理** | Schema 注册表、payload 验证、Schema 版本控制和演化 |
| **故障隔离** | TEC/REC 错误计数器、基于阈值的降级、恢复协议 |
| **高级仲裁** | 评分公式、可靠性加权选择 |
| **风暴防护** | 限流、去重、负载卸载的具体参数 |

完整定义见 [EXTENSIONS.zh-CN.md](EXTENSIONS.zh-CN.md)。
推荐默认值见 [IMPLEMENTATION-NOTES.zh-CN.md](IMPLEMENTATION-NOTES.zh-CN.md)。

---

## 11. 总线实现职责

本节规定符合规范的**总线**实现必须（MUST）、应当（SHOULD）和可以（MAY）做的事情。参考实现为 `ant_legion_bus`（Python / FastAPI）。

### 11.1 核心引擎

| 职责 | 要求 |
|------|:----:|
| 维护按 `fact_id` 索引的内存事实存储 | 必须 |
| 强制执行 WorkflowStateMachine 转换表（§5） | 必须 |
| 对每次 PUBLISH 计算并验证 `content_hash` | 必须 |
| 用总线权威 HMAC 印章签名已接受的事实 | 应当 |
| 为每个已接受事实分配单调递增的 `sequence_number` | 应当 |
| 将每个改变状态的事件持久化到追加日志 | 应当 |
| 启动时从持久化日志恢复内存状态 | 应当 |
| 定期压缩日志以限制磁盘增长 | 可以 |

### 11.2 Ant 注册表

| 职责 | 要求 |
|------|:----:|
| 接受 CONNECT 请求并分配唯一 `ant_id` | 必须 |
| 签发并验证每 Ant 的认证令牌 | 必须 |
| 注册每个 Ant 的 `AcceptanceFilter` | 必须 |
| 接受 DISCONNECT 请求并从注册表中移除 Ant | 必须 |
| 接受 HEARTBEAT 请求并跟踪存活性 | 必须 |
| 在 Ant 重连时回放最近的未解决事实 | 应当 |

### 11.3 发布准入管道

总线必须对每次 PUBLISH 按此顺序（从最廉价开始）运行所有强制检查：

```
1. 因果深度检查        （必须）  O(1)
2. 因果循环检测        （应当）  O(深度)
3. 去重窗口            （应当）  O(1) 摊销
4. 每 Ant 限流        （应当）  O(1)
5. 全局负载断路器      （可以）  O(1) 摊销
6. 可靠性门控          （可以）  O(1)
7. Schema 验证         （可以）  O(payload)
```

任何检查失败的事实必须被拒绝并返回错误；不得接受其 `content_hash`。

### 11.4 分发与仲裁

| 职责 | 要求 |
|------|:----:|
| 对每次 PUBLISH 为每个已连接 Ant 评估 `AcceptanceFilter` | 必须 |
| 向所有匹配的 Ant 分发 `fact_available`（`broadcast` 模式） | 必须 |
| 对 `exclusive` 模式：使用确定性仲裁最多选择一个 Ant | 必须 |
| 仲裁在相同可见输入下必须是确定性的 | 必须 |
| 认领被接受时向其他匹配的 Ant 推送 `fact_claimed` | 必须 |
| 事实被解决时向匹配的 Ant 推送 `fact_resolved` | 必须 |
| 事实过期或失败时向匹配的 Ant 推送 `fact_dead` | 必须 |

### 11.5 独占认领不变量

CLAIM 是原子的。总线必须保证：

- 任何时刻最多一个 Ant 持有对任意独占事实的认领。
- 如果两个 Ant 同时尝试 CLAIM，恰好一个成功。
- 被拒绝的认领者收到失败响应。
- 总线不得接受来自当前认领者之外的任何 Ant 的 RESOLVE。

### 11.6 生命周期强制

| 职责 | 要求 |
|------|:----:|
| 运行 TTL 过期循环；将过期事实标记为 `dead` | 必须 |
| 对每次 PUBLISH 强制执行因果深度限制 | 必须 |
| 永远不修改事实的不可变记录字段（发布后） | 必须 |
| 运行 GC 遍历以驱逐超出保留窗口的终态事实 | 应当 |

### 11.7 信任与可靠性（扩展级别）

这些职责在启用相应扩展时生效：

| 职责 | 扩展 | 要求 |
|------|------|:----:|
| 每次确认/反驳后重新计算 `epistemic_state` | 认知状态 | 必须（如启用） |
| 认知状态变化时推送 `fact_trust_changed` | 认知状态 | 必须（如启用） |
| 发布时处理 `subject_key` 自动取代 | 知识演化 | 必须（如启用） |
| 事实被取代时推送 `fact_superseded` | 知识演化 | 必须（如启用） |
| 在错误/成功事件时递增/递减 TEC | 故障隔离 | 必须（如启用） |
| 在 TEC 阈值时将 Ant 转换为 `degraded`/`isolated` | 故障隔离 | 必须（如启用） |
| 源 Ant 为 `degraded` 时降低发布事实的置信度 | 故障隔离 | 必须（如启用） |
| 发布时对照已注册 Schema 验证 payload | Schema 治理 | 必须（如启用） |
| 使用评分公式进行独占仲裁 | 高级仲裁 | 必须（如启用） |
| 对未认领事实应用优先级老化 | 风暴防护 | 应当（如启用） |

---

## 12. 节点实现职责

本节规定符合规范的**节点**（Ant）实现必须（MUST）、应当（SHOULD）和可以（MAY）做的事情。参考实现为 `ant_legion_bus_plugin`（TypeScript / OpenAnt 插件）。

节点是任何连接到总线并参与事实协调的进程——AI Agent、人工操作网关、监控工具或自动化脚本。

### 12.1 连接生命周期

| 职责 | 要求 |
|------|:----:|
| 携带名称、描述和 `AcceptanceFilter` 连接到总线 | 必须 |
| 保留总线返回的 `ant_id` 和认证令牌 | 必须 |
| 定期发送 HEARTBEAT 以维持存活性 | 必须 |
| 总线不可达时带退避重试 CONNECT | 应当 |
| 优雅关闭时发送 DISCONNECT | 应当 |
| 在生产环境中声明有意义的 `AcceptanceFilter`（能力、领域或类型模式），而不是使用空的监控模式 | 应当 |

### 12.2 事件订阅与感知

| 职责 | 要求 |
|------|:----:|
| 连接后打开实时事件通道（WebSocket 或等效方式） | 必须 |
| 接收 `fact_available`、`fact_claimed`、`fact_resolved`、`fact_dead` 事件 | 必须 |
| 接收 `fact_trust_changed`、`fact_superseded` 事件（如启用扩展） | 应当 |
| 带指数退避自动重连事件通道 | 应当 |
| `ant_id` 变化时（如总线重启后）重启事件通道 | 必须 |
| 在有界队列中缓冲传入事件供 Agent 消费 | 应当 |
| 事件队列溢出时发出警告（事件正在被丢弃） | 应当 |
| 提供一个 `sense` 操作，取出缓冲事件并返回操作建议 | 应当 |

**事件队列溢出处理：** 队列满时，节点应丢弃最旧的事件（FIFO 驱逐），并在下一次 `sense` 响应中报告丢弃数量，让 Agent 可以通过 QUERY 补全。

### 12.3 发布事实

| 职责 | 要求 |
|------|:----:|
| 以点号分隔的形式设置 `fact_type`（`<领域>.<实体>.<事件>`） | 必须 |
| 将 `source_ant_id` 设置为自身的 `ant_id` | 必须 |
| 根据预期语义将 `mode` 设置为 `exclusive` 或 `broadcast` | 必须 |
| 正确设置 `content_hash`（规范不可变记录的 SHA-256，见实现注记） | 必须 |
| 发布子事实时设置 `causation_chain` 和 `causation_depth` | 必须 |
| 将 `semantic_kind` 设置为对事实分类（`observation`、`request`、`resolution` 等） | 应当 |
| 确定性低于 1.0 时设置 `confidence` | 应当 |
| 将 `ttl_seconds` 设置为与事实紧迫性相符的值 | 应当 |
| 永远不发布命令形状的事实（如 `ant-B.do.review`） | 不得 |

### 12.4 认领与解决

| 职责 | 要求 |
|------|:----:|
| 只对 `exclusive` 模式的事实尝试 CLAIM | 必须 |
| 成功 CLAIM 后，必须 RESOLVE 或 RELEASE 事实 | 必须 |
| 通过 RESOLVE 的 `result_facts` 派生子事实，让总线自动延伸因果链 | 应当 |
| 无法完成工作时执行 RELEASE | 必须 |
| CLAIM 失败后不对同一事实重试 | 不得 |
| 在没有进展的情况下无限期持有认领 | 不得 |

### 12.5 社会验证

| 职责 | 要求 |
|------|:----:|
| 仅在独立验证时 CORROBORATE 事实 | 应当 |
| 当证据与内容冲突时 CONTRADICT 事实 | 应当 |
| 永远不确认或反驳自己的事实 | 不得 |
| 在依赖传入事实之前按 `min_epistemic_rank` 过滤 | 应当 |

### 12.6 参考节点实现：ant_legion_bus_plugin

`ant_legion_bus_plugin` 是参考 OpenAnt 节点实现。它将协议映射为 Agent 可调用的工具：

| 协议操作 | 工具 |
|----------|------|
| 取出缓冲事件 | `legion_bus_sense` |
| PUBLISH | `legion_bus_publish` |
| QUERY | `legion_bus_query` |
| CLAIM | `legion_bus_claim` |
| RELEASE | `legion_bus_release` |
| RESOLVE | `legion_bus_resolve` |
| CORROBORATE / CONTRADICT | `legion_bus_validate` |
| 获取 payload Schema | `legion_bus_get_schema` |

**`legion_bus_sense`** 是主要的事件接口。它取出缓冲的 WebSocket 事件，并为每个事实返回结构化的操作建议（`claim it`、`observe and react`、`re-evaluate trust` 等），引导 Agent 的下一步决策，无需理解原始协议事件。

插件处理连接生命周期（CONNECT、HEARTBEAT、带服务端通知的 DISCONNECT）、WebSocket 管理（带退避重连、`ant_id` 变化时重启）以及事件队列管理（有界缓冲区、溢出警告、`sense` 响应中的 `events_dropped` 计数器）。

---

## 附录 A：与 CAN Bus 的比较

| 方面 | CAN Bus | AntLegion Bus |
|------|---------|---------------|
| 帧/消息单元 | CAN 帧（8-64 字节） | 事实（JSON 对象） |
| 寻址 | 消息 ID（基于内容） | fact_type + 标签（基于内容） |
| 过滤 | 硬件掩码+过滤寄存器 | AcceptanceFilter（基于内容） |
| 仲裁 | 消息 ID 的按位仲裁 | 实现定义的评分 |
| 错误处理 | TEC/REC 计数器，3 状态机 | 3 状态机（active/degraded/isolated），详见扩展 |
| 流控制 | 过载帧 | 限速器+负载卸载（实现定义） |
| 拓扑 | 单总线，无主节点 | 单总线，无编排器 |
| 交付 | 广播 | 广播（所有）或独占（一个） |
| 信任模型 | 不适用（物理传感器） | 确认/反驳（AI Agent 本质上不可靠） |

## 附录 B：术语表

| 术语 | 定义 |
|------|------|
| **Ant** | 连接到事实总线的自主 Agent（AI 或人类） |
| **Fact（事实）** | 关于现实的不可变陈述，协调的原子单元 |
| **Bus（总线）** | 连接所有 Ant 的共享通信介质 |
| **AcceptanceFilter（接受过滤器）** | Ant 对其想接收事实的声明 |
| **Causation Depth（因果深度）** | 导致此事实的祖先事实数量 |
| **Parent Fact（父事实）** | 某事实的直接因果前驱 |
| **Corroboration（确认）** | 另一个 Ant 确认事实的有效性 |
| **Contradiction（反驳）** | 另一个 Ant 质疑事实的有效性 |
| **Dead（已死亡）** | 无法被处理的事实（已过期、失败、无人认领） |
| **Exclusive（独占）** | 最多一个 Ant 处理事实的交付模式 |
| **Broadcast（广播）** | 所有匹配的 Ant 都看到事实的交付模式 |

---

## 附录 C：Agent 决策指南

> **§12 的规范性补充。** 本附录将 §12 中的节点职责转化为自主 Agent（**Ant**）在运行时应遵循的具体决策逻辑。使用与规范其余部分相同的 MUST/SHOULD 语言。对于 OpenAnt 集成，使用 **`ant_legion_bus_plugin`**（工具如 `legion_bus_sense`、`legion_bus_publish`、`legion_bus_claim`、`legion_bus_resolve`、`legion_bus_validate` 等），它实现了 §12 的所有职责并将其暴露为 Agent 可调用的工具。

### C.1 核心公理

**事实，不是命令。** Ant 永远不告诉另一个 Ant 该做什么。它陈述发生了什么、存在什么或需要什么。其他 Ant 自行决定是否以及如何响应。

```
正确：发布 fact_type "code.review.needed"，payload 为 { file, pr }
错误：发布 fact_type "ant-B.do.review"  ← 伪装成事实的命令
```

### C.2 架构心智模型

没有中央编排器。没有命令链。工作流**从事实因果链中涌现**。

- 事实被广播或路由到 **AcceptanceFilter** 匹配的 Ant。
- Ant **感知**匹配的事实（通常通过 WebSocket 推送），**认领**独占工作，**处理**，然后**解决**——可能发出**子事实**延伸因果链。
- 下游的其他 Ant 独立响应这些新事实。

### C.3 连接与感知

**`POST /ants/connect`** 后，保留 `ant_id` 和 `token` 用于认证操作。打开 **WebSocket** 订阅（参见服务端文档）以接收 `fact_available`、`fact_claimed`、`fact_resolved`、`fact_superseded`、`fact_trust_changed` 等事件。

总线只分发通过 Ant 的 **AcceptanceFilter** 的事实。匹配使用能力提供、领域兴趣、事实类型模式、优先级范围、模式、语义类型、认知等级、置信度和取代规则（参见 **EXTENSIONS.zh-CN.md**）。

**典型事件响应**

| 事件 | 含义 | 典型响应 |
|------|------|----------|
| `fact_available` | 新事实匹配过滤器 | 决定是否认领（如果是独占模式）或响应（如果是广播模式） |
| `fact_claimed` | 另一个 Ant 拥有此事实 | 不要认领同一个独占事实 |
| `fact_trust_changed` | 认知状态已变化 | 重新评估依赖；考虑确认/反驳 |
| `fact_dead` | 已过期或终止 | 停止跟踪 |
| `fact_superseded` | 被较新的知识替代 | 对于同一主题优先使用最新事实 |

### C.4 理解事实

**不可变记录**（发布后内容固定）：`fact_type`、`semantic_kind`、`payload`、`domain_tags`、`need_capabilities`、`priority`、`mode`、`source_ant_id`、`causation_chain`/`causation_depth`（及作为链最后条目的 `parent_fact_id`）、`confidence`、`subject_key`、`supersedes`（适用时）。

**可变总线状态**：`state`、`epistemic_state`、`claimed_by`、`corroborations`、`contradictions`。

**语义类型**

| 类型 | 含义 | 示例 `fact_type` |
|------|------|-----------------|
| `observation` | 原始数据 | `build.failed`、`cpu.usage.high` |
| `assertion` | 推断 | `root_cause.suspected` |
| `request` | 需要完成的工作 | `code.review.needed` |
| `resolution` | 处理结果 | `code.review.completed` |
| `correction` | 取代先前知识 | 更新的诊断 |
| `signal` | 状态/心跳 | `progress.60pct` |

**传入事实的决策框架**

```
收到 fact_available（或等效事件）
  │
  ├─ mode == broadcast？
  │    └─ 是 → 阅读并响应（发布新事实）；不要认领
  │
  ├─ mode == exclusive？
  │    ├─ 我能处理吗？（need_capabilities vs 我的能力）
  │    │    └─ 否 → 忽略
  │    ├─ 认知状态对我的策略可接受吗？
  │    │    └─ 否 → 忽略或反驳/发布反证
  │    └─ 尝试认领
  │
  └─ 认领成功？
       ├─ 是 → 处理 → 解决（可选的子事实/结果事实）
       └─ 否 → 另一个 Ant 拥有它；继续
```

### C.5 发布、认领、解决、释放

- **发布**：`POST /facts`，带 `source_ant_id`、`token`、按 Schema 的 payload 字段。
- **认领**：`POST /facts/{id}/claim`，用于将处理的**独占**事实。
- **解决**：`POST /facts/{id}/resolve`，关闭工作流；可选的 **result_facts** 成为子事实，带有延伸的因果链。
- **释放**：`POST /facts/{id}/release`，如果认领后无法完成工作。

**模式**：`exclusive` = 一个处理者；`broadcast` = 所有匹配的 Ant 可以观察并发布跟进内容，无需认领。

**优先级**（0–7，较低 = 更紧急）：中断用 CRITICAL，服务降级用 HIGH，例行工作用 NORMAL（参见 **实现注记** 中的默认值）。

**事实类型命名**（约定）：`<领域>.<实体>.<事件>`（如 `code.review.needed`、`deploy.production.failed`）。

### C.6 社会验证

- **确认**：`POST /facts/{id}/corroborate`，当你独立确认某事实时。
- **反驳**：`POST /facts/{id}/contradict`，当你的证据与之冲突时。

使用过滤器（如最低认知等级、最低置信度、排除已取代的）忽略不可信事实。

### C.7 知识演化（取代）

发布带有相同 **`subject_key`**（及按实现兼容的 `fact_type`）的新事实，以替换过时的读数。被取代的事实移动到 `epistemic_state: superseded`，当过滤器中 `exclude_superseded` 为 true 时应被忽略。

### C.8 故障与恢复

| 情况 | 指导 |
|------|------|
| 发布被拒绝（哈希、深度、限流、Schema、隔离） | 修复 payload，退避，或按服务端消息恢复 Ant 健康 |
| 认领失败 | 在竞争下正常；不要对同一事实无限重试 |
| Ant 降级/隔离 | 通常与可靠性/TEC 相关；心跳和干净行为恢复信任 |
| 你的事实被反驳 | 同行评审；发布纠正或确认更好的证据 |

### C.9 可观测性

使用服务端暴露的 **`GET /stats`**、**`GET /ants`**、**`GET /facts`**（查询）和 **`GET /ants/{ant_id}/activity`** 进行调试和仪表板。

### C.10 反模式

| 不要 | 替代做法 |
|------|----------|
| 发布命令形状的事实类型 | 发布需求和观察 |
| 认领广播事实 | 观察并发布派生事实 |
| 忽略 `epistemic_state` | 过滤或重新评估有争议/被反驳的事实 |
| 认领后不推进处理 | 及时解决或释放 |
| 硬编码对等 Ant ID | 使用能力、领域和事实类型进行路由 |

---

*协议由 Carter.Yang 设计。Architecture Sovereignty Notice 适用。*
