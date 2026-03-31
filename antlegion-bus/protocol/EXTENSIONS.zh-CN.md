# AntLegion Bus 协议扩展

> 核心规范的可选独立版本化扩展。

每个扩展是自包含的。实现可以支持任意子集。

English: [EXTENSIONS.md](EXTENSIONS.md)

---

## 扩展 1：认知状态（Epistemic States）

**状态**：稳定
**依赖**：核心（确认/反驳操作）

### 概述

为事实添加从确认和反驳证据中派生的正式信任生命周期。

### 新增事实字段

| 字段 | 类型 | 描述 |
|------|------|------|
| `epistemic_state` | enum | 信任评估：`asserted`、`corroborated`、`consensus`、`contested`、`refuted`、`superseded` |

### 认知状态机

与工作流状态机（显式转换）不同，认知状态是从积累的证据中**派生**的——类似于科学共识的形成方式。

```
  ASSERTED（已断言）──（确认数）──▶ CORROBORATED（已确认）──（法定人数）──▶ CONSENSUS（共识）
      │                               │
      └──（反驳数）──▶ CONTESTED（争议中）──（法定人数）──▶ REFUTED（已反驳）
                           │
                           └──（superseded_by 已设置）──▶ SUPERSEDED（已取代）
```

### 重新计算规则

```
如果 fact.superseded_by 已设置      → SUPERSEDED
否则如果 |contradictions| ≥ refute_q → REFUTED
否则如果 contradictions 存在         → CONTESTED
否则如果 |corroborations| ≥ consensus_q → CONSENSUS
否则如果 corroborations 存在         → CORROBORATED
否则                                 → ASSERTED
```

`consensus_q` 和 `refute_q` 是实现定义的法定人数值（推荐：2）。

> **设计说明 — `superseded` 置于认知状态枚举中**：`corroborated`、`contested`、`refuted` 反映的是**真值/置信度**维度；`superseded` 反映的是**新鲜度/版本**维度。将它们放入同一个枚举是有意为之的工程权衡：它允许用单一字段同时驱动过滤评估和事件路由，而无需引入额外的 `knowledge_state` 字段。
>
> 契约如下：**新鲜度优先于置信度**。一个曾经达到 `consensus` 但随后被取代的事实，在所有过滤和路由决策中都被视为过时知识。实现者和消费者必须将 `SUPERSEDED` 视为重新计算规则中优先级最高的终态条件（在 `REFUTED` 或任何信任等级之前评估）。

### 认知等级（用于过滤器比较）

| 状态 | 等级 | 含义 |
|------|:----:|------|
| SUPERSEDED | -3 | 被较新的事实替代 |
| REFUTED | -2 | 被法定人数质疑 |
| CONTESTED | -1 | 处于争议中 |
| ASSERTED | 0 | 默认，未验证 |
| CORROBORATED | +1 | 至少一个同伴确认 |
| CONSENSUS | +2 | 法定人数确认 |

### 额外过滤器维度

| 维度 | 类型 | 描述 |
|------|------|------|
| `min_epistemic_rank` | int | 接受的最低信任等级（默认：-3 = 接受所有） |
| `min_confidence` | float | 接受的最低发布者置信度 |
| `exclude_superseded` | bool | 跳过已取代的事实（默认：true） |

### 因果链信任传播

当事实的认知状态转换为 `REFUTED` 或 `CONTESTED` 时，其因果链中的后代事实可能基于不可靠的基础。但是，总线不得自动将认知状态变化级联到后代——这样做会违反不裁决原则（核心 §1.4）。

取而代之的做法是：

1. 总线应在 `fact_trust_changed` 事件载荷中包含 `parent_fact_id`，使感兴趣的 Ant 能够追踪受影响的因果链。
2. 观察到被反驳祖先的 Ant 可以对其判断为无效的后代事实发布 `CONTRADICT`，并在反驳载荷中提供理由。
3. 执行因果链查询的消费者在评估后代信任时应检查祖先的认知状态。

这保留了信任推导是消费者侧关注点的原则，同时确保因果链完整性不会被悄悄丢失。

### 额外事件

| 事件 | 触发条件 | 载荷 |
|------|----------|------|
| `fact_trust_changed` | 认知状态因确认/反驳而变化 | fact_id、old_state、new_state、parent_fact_id |

---

## 扩展 2：语义分类（Semantic Classification）

**状态**：稳定
**依赖**：核心

### 概述

添加一个 `semantic_kind` 字段，分类事实在**认知上代表**的内容。

### 新增事实字段

| 字段 | 类型 | 描述 |
|------|------|------|
| `semantic_kind` | enum | 可选。以下类型之一 |

### 推荐词汇表

| 类型 | 含义 | 示例 |
|------|------|------|
| `observation` | 直接感知数据 | `build.failed`、`cpu.usage.high` |
| `assertion` | 推断或判断 | `root_cause.suspected` |
| `request` | 需要完成的事情 | `code.review.needed` |
| `resolution` | 处理结果 | `code.review.completed` |
| `correction` | 取代先前事实 | 更新的诊断 |
| `signal` | 即发即弃的状态 | `heartbeat`、`progress.60pct` |

### 额外过滤器维度

| 维度 | 类型 | 描述 |
|------|------|------|
| `semantic_kinds` | enum[] | 接受哪些类型。空 = 全部 |

---

## 扩展 3：知识演化（Knowledge Evolution）

**状态**：稳定
**依赖**：核心，认知状态（可选）

### 概述

添加对同一主题事实的自动和显式取代。

### 新增事实字段

| 字段 | 类型 | 描述 |
|------|------|------|
| `subject_key` | string | 可选。对同一实体的事实分组（如 `host:web-01/cpu-temp`） |
| `supersedes` | string | 可选。此事实替代的显式 `fact_id` |

### 总线管理字段

| 字段 | 类型 | 描述 |
|------|------|------|
| `superseded_by` | string | 当较新事实取代此事实时由总线设置 |

### 取代规则

1. **显式取代**：如果 `fact.supersedes` 已设置且目标存在，将目标标记为已取代。
2. **自动取代**：如果 `fact.subject_key` 已设置且另一个非终态事实共享相同的 `(subject_key, fact_type)`，将较旧的那个标记为已取代。

> **自动取代适用范围**：自动取代专为**最新值胜出**型事实设计——即只有最新值有意义的场景，例如传感器读数、部署状态或资源占用率。
>
> 对于以下情形，自动取代**不适用**：同一类型下多个并发事实应当并存，例如：
> - 多来源诊断观测
> - 积累性分析结论
> - 来自独立评审者的并行建议
>
> 为将自动取代限制在合适的事实类型上，实现**应当**要求满足以下条件之一才触发该规则：
> - 该 `fact_type` 的注册 Schema 声明了 `"auto_supersede": true`，**或**
> - 事实的 `semantic_kind` ∈ `{observation, signal, correction}`（如果语义分类扩展已激活）。
>
> 希望在单个事实层面阻止自动取代的发布方，**应当**省略 `subject_key` 字段，改用显式的 `supersedes` 链接。

当事实被取代时：
- 设置 `old_fact.superseded_by = new_fact.fact_id`
- 如果认知状态扩展已激活：设置 `old_fact.epistemic_state = SUPERSEDED`
- 向感兴趣的 Ant 推送 `fact_superseded` 事件

### 额外事件

| 事件 | 触发条件 |
|------|----------|
| `fact_superseded` | 事实被较新的事实取代 |

---

## 扩展 4：Schema 治理（Schema Governance）

**状态**：实验性
**依赖**：核心

### 概述

为事实 payload 验证添加 Schema 注册表。

### 概念

- **FactSchema**：`fact_type` payload 的命名版本化 Schema。
- **SchemaRegistry**：总线管理的 Schema 注册表。
- **强制模式**：`OPEN`（无验证）、`WARN`（记录日志但接受）、`STRICT`（拒绝无效）。

### 新增事实字段

| 字段 | 类型 | 描述 |
|------|------|------|
| `schema_version` | string | 可选。此 `fact_type` 的 Schema 版本 |

### 总线行为

- 在 PUBLISH 时，如果 `fact_type` 存在 Schema，总线会对照其验证 `payload`。
- 在 STRICT 模式下，无效的 payload 会被拒绝。
- Schema 违规可以增加发布者的错误计数器（如果故障隔离扩展已激活）。

### Schema 演化

Schema 应支持向后兼容的演化：
- 添加可选字段：允许
- 删除必填字段：破坏性变更，需要新的 `fact_type` 或主版本号升级
- 更改字段类型：破坏性变更

---

## 扩展 5：故障隔离（Fault Confinement）

**状态**：稳定
**依赖**：核心

### 概述

添加 CAN 风格的错误计数器和基于阈值的 Ant 降级。

### Ant 字段

| 字段 | 类型 | 描述 |
|------|------|------|
| `transmit_error_counter` | int | TEC — 错误时增加，成功时减少 |
| `reliability_score` | float 0-1 | 从 TEC 派生（见下方映射表）。如果高级仲裁扩展已激活，则用于仲裁 |

### reliability_score 映射

`reliability_score` 直接从 TEC 阈值映射到 ant 状态边界：

| TEC 范围 | Ant 状态 | `reliability_score` |
|---------|:---------:|:-------------------:|
| 0 – 127 | ACTIVE | 1.0 |
| 128 – 255 | DEGRADED | 0.5 |
| ≥ 256 | ISOLATED | 0.0 |

实现**应当**使用此阶梯函数（或实现注记中推荐的等效函数），以确保同一总线上各节点的 `reliability_score` 具有可比性。被隔离的 ant 得分为 0.0，无法赢得独占仲裁；降级中的 ant 以一半权重参与竞争。

### 错误状态机

```
              TEC < threshold_1        TEC ≥ threshold_1         TEC ≥ threshold_2
  ┌─────────────────────┐    ┌─────────────────────┐    ┌──────────────────┐
  │       ACTIVE         │───▶│      DEGRADED        │───▶│     ISOLATED      │
  │     正常运行         │◀───│     降低置信度        │◀───│     不能发布      │
  └─────────────────────┘    └─────────────────────┘    └──────────────────┘
```

`threshold_1` 和 `threshold_2` 是实现定义的（推荐：128 和 256）。

### 错误计数器事件

| 事件 | TEC 变化 |
|------|:--------:|
| 事实被另一个 Ant 反驳 | 增加（推荐：+8） |
| 事实被 Schema 验证拒绝 | 增加（推荐：+8） |
| 事实未解决即过期 | 增加（推荐：+2） |
| 超过限流阈值 | 增加（推荐：+1） |
| 事实被另一个 Ant 确认 | 减少（推荐：-1） |
| 事实成功解决 | 减少（推荐：-1） |
| 心跳成功 | 减少（推荐：-1） |

TEC 下限为 0（永不为负）。

### 恢复

处于 `isolated` 状态的 Ant 通过积累心跳减量恢复，直到 TEC 降至 `threshold_1` 以下。

### 额外事件

| 事件 | 触发条件 |
|------|----------|
| `ant_state_changed` | Ant 在 active/degraded/isolated 之间转换 |

---

## 扩展 6：高级仲裁（Advanced Arbitration）

**状态**：稳定
**依赖**：核心，故障隔离（可选）

### 概述

为独占事实仲裁定义评分算法。

### 推荐评分公式

```
score = (capability_overlap × 10 + domain_overlap × 5 + type_pattern_hit × 3)
        × reliability_score
```

其中：
- `capability_overlap` = |fact.need_capabilities ∩ ant.capability_offer|
- `domain_overlap` = |fact.domain_tags ∩ ant.domain_interests|
- `type_pattern_hit` = 如果 fact_type 匹配任意模式则为 1，否则为 0
- `reliability_score` = Ant 的可靠性（如果故障隔离扩展未激活则为 1.0）

### 平局处理

平局应按以下顺序处理：`reliability_score` → `ant_id`（字典序，确定性）。

---

## 扩展 7：风暴防护（Storm Protection）

**状态**：稳定
**依赖**：核心

### 概述

为核心 §7.2 中描述的安全护栏定义具体参数。

### 推荐参数

| 护栏 | 参数 | 推荐值 |
|------|------|:------:|
| 因果深度限制 | 最大深度 | 16 |
| 因果循环检测 | 检查 | 验证 fact_id 不在祖先链中 |
| 去重 | 键 | `(source_ant_id, fact_type, content_hash)` |
| 去重 | 窗口 | 10 秒 |
| 每 Ant 限流 | 算法 | 令牌桶 |
| 每 Ant 限流 | 容量 | 20 |
| 每 Ant 限流 | 补充速率 | 每秒 5 个 |
| 全局负载断路器 | 窗口 | 5 秒 |
| 全局负载断路器 | 阈值 | 每窗口 200 个事实 |
| 全局负载断路器 | 行为 | 只接受优先级 ≤ 1（HIGH）的事实 |
| 优先级老化 | 间隔 | 30 秒 |
| 优先级老化 | 步长 | −1（数值递减，向更高优先级方向推进） |
| 优先级老化 | 下限 | 1（HIGH）— 永不老化到 CRITICAL |

> **方向说明**：优先级数值越小代表优先级越高（`1 = HIGH … N = LOW`）。老化的目的是提升低优先级事实的优先级，因此每经过一个间隔，数值**减少** 1，直到达到下限。若步长为 +1 则方向相反，会使优先级越来越低，与防饥饿机制的意图完全相悖。

### 准入检查顺序

所有检查在 PUBLISH 时按顺序运行，按计算成本排序：

```
1. 因果深度检查         O(1)
2. 因果循环检测         O(深度)
3. 去重窗口             O(1) 摊销
4. 每 Ant 限流         O(1)
5. 全局总线负载断路器   O(1) 摊销
6. 可靠性门控           O(1)
7. Schema 验证          O(payload 大小)
```
