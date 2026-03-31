# AntLegion Bus — 实现注记

> 面向参考 Python 实现的推荐默认值与算法。
> 这些不是协议要求。其他实现可以使用不同的值。

English: [IMPLEMENTATION-NOTES.md](IMPLEMENTATION-NOTES.md)

---

## 默认参数

| 参数 | 值 | 说明 |
|------|:--:|------|
| 因果深度上限 | 16 | 防止级联链无限延伸，对复杂工作流足够用 |
| 去重时间窗口 | 10s | 兼顾去重效果与内存占用 |
| 限流令牌容量 | 20 | 允许突发，不至于打爆 |
| 限流补充速率 | 5/s | 活跃 ant 的持续吞吐 |
| 断路器时间窗口 | 5s | 响应及时，不振荡 |
| 断路器触发阈值 | 200 条事实/窗口 | 按约 40 个并发 ant 设计 |
| 优先级老化间隔 | 30s | 等待合理时长后再提升优先级 |
| 优先级老化下限 | 优先级 1（HIGH） | CRITICAL 留给真正的紧急事件 |
| 事实默认 TTL | 300s | 5 分钟，覆盖大多数任务 |
| TEC 降级阈值 | 128 | 对应 CAN ISO 11898-1 |
| TEC 隔离阈值 | 256 | 对应 CAN ISO 11898-1 |
| 共识法定人数 | 2 次佐证 | 最小社会验证 |
| 反驳法定人数 | 2 次矛盾 | 最小社会验证 |
| GC 保留已解决事实 | 600s | 解决后保留 10 分钟 |
| GC 保留死亡事实 | 3600s | 死亡后保留 1 小时 |
| GC 最大事实数 | 10,000 | 内存安全 |
| 压缩间隔 | 3600s | 每小时压缩一次日志 |
| 重连回放数量 | 50 条事实 | 向重连 ant 回放最近未解决的事实 |

## 仲裁评分

```
score = (能力重叠数 × 10 + 领域重叠数 × 5 + 类型命中 × 3)
        × reliability_score
```

平局裁决顺序：score → reliability_score → ant_id（字典序）。

能力重叠权重最高，因为它是适配度最强的信号。领域重叠是辅助上下文，类型模式命中是最弱信号（最宽泛的匹配）。

## reliability_score 映射

`reliability_score` 由 ant 的发送错误计数器（TEC）派生，与状态机阈值直接对应：

| TEC 范围 | Ant 状态 | reliability_score |
|---------|:---------:|:-----------------:|
| 0 – 127 | ACTIVE | 1.0 |
| 128 – 255 | DEGRADED | 0.5 |
| ≥ 256 | ISOLATED | 0.0 |

推荐使用阶梯函数，原因是它与故障隔离扩展中定义的 ant 状态机边界完全对齐，便于跨实现验证和复现。被隔离的 ant 得分为 0.0，无法赢得独占仲裁；降级中的 ant 以一半权重参与竞争。

## TEC 调整规则

| 事件 | TEC 变化量 |
|------|:---------:|
| 事实被矛盾 | +8 |
| Schema 校验失败 | +8 |
| 事实超时未解决 | +2 |
| 超出限流 | +1 |
| 事实被佐证 | -1 |
| 事实已解决 | -1 |
| 心跳正常 | -1 |

## 内容哈希计算

`content_hash` 字段覆盖**完整的规范不可变记录**，而不仅仅是 payload。这确保了对所有发布方设置字段的篡改检测，包括 `fact_type`、`mode`、`priority` 以及因果链元数据。

### 规范不可变记录

用于哈希计算的规范记录包含以下字段，可选字段**仅在存在时（非 null、非空）** 才纳入：

```python
canonical_record = {
    "fact_type":       fact.fact_type,
    "payload":         fact.payload,          # 原始 dict，不重新序列化
    "source_ant_id":  fact.source_ant_id,
    "created_at":      fact.created_at,
    "mode":            fact.mode,
    "priority":        fact.priority,
    "ttl_seconds":     fact.ttl_seconds,
    "causation_depth": fact.causation_depth,
}

# 仅在发布方设置时包含
if fact.parent_fact_id:
    canonical_record["parent_fact_id"] = fact.parent_fact_id
if fact.confidence is not None:
    canonical_record["confidence"] = fact.confidence
if fact.domain_tags:
    canonical_record["domain_tags"] = sorted(fact.domain_tags)
if fact.need_capabilities:
    canonical_record["need_capabilities"] = sorted(fact.need_capabilities)
```

> `fact_id` **不纳入**规范记录，因为它可能由总线在接收发布请求后分配，发布方构建事实时可能尚不知晓。若发布方预先生成了 `fact_id`，可以在自身完整性校验中包含它，但这不是跨实现规范记录的组成部分。

### 哈希计算

```python
canonical = json.dumps(canonical_record, sort_keys=True, ensure_ascii=False)
content_hash = sha256(canonical.encode()).hexdigest()
```

列表型可选字段（`domain_tags`、`need_capabilities`）在序列化前先排序，确保与顺序无关的哈希结果。

## 总线签名（权威印记）

```python
message = f"{fact_id}|{content_hash}|{source_ant_id}|{fact_type}|{created_at}"
signature = hmac_sha256(bus_secret, message)
```

签名证明某个事实已被特定总线实例验证并接受。这不属于核心协议，而是实现层的完整性特性。

## 持久化

参考实现使用追加写入的 JSONL 事实存储：
- 每个事件（发布、认领、解决、死亡、佐证、矛盾）对应一行
- 定期压缩，清除不再保存在内存中的事实条目
- 启动时通过回放日志重建内存状态

### 尾部损坏处理

追加写日志在进程被强制终止（如 OOM Kill、磁盘满、断电）时，可能在末尾留下一行不完整的 JSON。启动恢复时，实现**应当**执行以下策略：

1. 使用流式解析器逐行读取日志。
2. 跳过任何 JSON 解析失败的行（记录警告，包含字节偏移量）。
3. 仅接受能反序列化为已知事件 Schema 的行。
4. 恢复完成后，在追加新事件之前，将文件截断到最后成功解析的字节边界（防止下次重启时再次读取损坏字节）。

压缩**必须**使用临时文件加原子重命名（`os.replace`），防止部分压缩过程破坏主日志文件。
