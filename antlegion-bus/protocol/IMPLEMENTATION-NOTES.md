# AntLegion Bus — Implementation Notes

> Recommended defaults and algorithms for the reference Python implementation.
> These are NOT protocol requirements. Other implementations MAY use different values.

中文版本: [IMPLEMENTATION-NOTES.zh-CN.md](IMPLEMENTATION-NOTES.zh-CN.md)

---

## Default Parameters

| Parameter | Value | Rationale |
|-----------|:-----:|-----------|
| Causation depth limit | 16 | Prevents cascade chains. Empirically sufficient for complex workflows |
| Dedup window | 10s | Balances duplicate suppression vs memory |
| Rate limit capacity | 20 tokens | Allows burst without flooding |
| Rate limit refill | 5/s | Sustained throughput for active ants |
| Load breaker window | 5s | Responsive without oscillation |
| Load breaker threshold | 200 facts/window | Sized for ~40 concurrent ants |
| Aging interval | 30s | Reasonable wait before priority boost |
| Aging floor | Priority 1 (HIGH) | CRITICAL reserved for genuine emergencies |
| Fact TTL default | 300s | 5 minutes, sufficient for most tasks |
| TEC degraded threshold | 128 | Mirrors CAN ISO 11898-1 |
| TEC isolated threshold | 256 | Mirrors CAN ISO 11898-1 |
| Consensus quorum | 2 corroborations | Minimal social validation |
| Refutation quorum | 2 contradictions | Minimal social validation |
| GC retain resolved | 600s | Keep resolved facts for 10 minutes |
| GC retain dead | 3600s | Keep dead facts for 1 hour |
| GC max facts | 10,000 | Memory safety |
| Compaction interval | 3600s | Hourly log compaction |
| Replay on reconnect | 50 facts | Recent unresolved facts replayed to reconnecting ants |

## Arbitration Scoring

```
score = (capability_overlap × 10 + domain_overlap × 5 + type_hit × 3)
        × reliability_score
```

Tiebreaker order: score → reliability_score → ant_id (lexicographic).

This formula weights capability match highest because it represents the strongest
signal of fitness. Domain overlap is secondary context, and type pattern hit
is the weakest signal (broadest match).

## Reliability Score Mapping

`reliability_score` is derived from a ant's Transmit Error Counter (TEC), which
maps directly to the ant's state machine thresholds:

| TEC Range | Ant State | reliability_score |
|-----------|:----------:|:-----------------:|
| 0 – 127 | ACTIVE | 1.0 |
| 128 – 255 | DEGRADED | 0.5 |
| ≥ 256 | ISOLATED | 0.0 |

This step function is recommended because it aligns exactly with the ant state
machine boundaries defined in the Fault Confinement extension, making the mapping
easy to verify and reproduce across implementations. An isolated ant scores 0.0
and cannot win exclusive arbitration; a degraded ant competes at half weight.

## TEC Adjustment Rules

| Event | TEC Δ |
|-------|:-----:|
| Fact contradicted | +8 |
| Schema validation failure | +8 |
| Fact expired unresolved | +2 |
| Rate limit exceeded | +1 |
| Fact corroborated | -1 |
| Fact resolved | -1 |
| Heartbeat OK | -1 |

## Content Hash Computation

The `content_hash` field covers the **complete canonical immutable record**, not
just the payload. This ensures tamper detection for all publisher-set fields,
including `fact_type`, `mode`, `priority`, and causation metadata.

### Canonical immutable record

The canonical record for hashing consists of the following fields, with optional
fields included **only when present** (non-null, non-empty):

```python
canonical_record = {
    "fact_type":       fact.fact_type,
    "payload":         fact.payload,          # raw dict, not re-serialised
    "source_ant_id":  fact.source_ant_id,
    "created_at":      fact.created_at,
    "mode":            fact.mode,
    "priority":        fact.priority,
    "ttl_seconds":     fact.ttl_seconds,
    "causation_depth": fact.causation_depth,
}

# Include only when set by publisher
if fact.parent_fact_id:
    canonical_record["parent_fact_id"] = fact.parent_fact_id
if fact.confidence is not None:
    canonical_record["confidence"] = fact.confidence
if fact.domain_tags:
    canonical_record["domain_tags"] = sorted(fact.domain_tags)
if fact.need_capabilities:
    canonical_record["need_capabilities"] = sorted(fact.need_capabilities)
```

> `fact_id` is **excluded** from the canonical record because it may be
> bus-assigned after the publisher constructs the fact. If a publisher
> pre-generates `fact_id`, they SHOULD include it in their own integrity
> checks, but it is NOT part of the cross-implementation canonical record.

### Hash computation

```python
canonical = json.dumps(canonical_record, sort_keys=True, ensure_ascii=False)
content_hash = sha256(canonical.encode()).hexdigest()
```

List-type optional fields (`domain_tags`, `need_capabilities`) are sorted before
serialisation to ensure order-independent hashing.

### Client-supplied `content_hash`

If the publisher sends `content_hash`, it MUST equal the digest of the same canonical
record the bus computes. Because `created_at` is included in that record, clients that
precompute the hash MUST send the same `created_at` in the publish request (or omit both
and let the bus assign `created_at` and compute the hash server-side).

## Bus Signature (Authority Stamp)

```python
message = f"{fact_id}|{content_hash}|{source_ant_id}|{fact_type}|{created_at}"
signature = hmac_sha256(bus_secret, message)
```

The signature proves a fact was verified and accepted by a specific bus instance.
It is NOT part of the core protocol — it is an implementation-level integrity feature.

## Persistence

The reference implementation uses an append-only JSONL fact store:
- Each event (publish, claim, resolve, dead, corroborate, contradict) is one line
- Periodic compaction removes entries for facts no longer in memory
- Recovery on startup replays the log to reconstruct in-memory state

### Tail corruption handling

Append-only logs can be left with a partial final line if the process is killed
mid-write (e.g. OOM kill, disk full, power loss). On startup recovery, the
implementation SHOULD apply the following policy:

1. Read the log line by line using a streaming parser.
2. Skip any line that fails JSON parsing (log a warning with the byte offset).
3. Accept only lines that deserialise into a recognised event schema.
4. After recovery, truncate the file to the last successfully parsed byte
   boundary before appending new events (prevents re-reading corrupt bytes
   on the next restart).

Compaction MUST use a temporary file and atomic rename (`os.replace`) to
prevent a partial compaction from corrupting the primary log.
