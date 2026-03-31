# AntLegion Bus Protocol Extensions

> Optional, independently versioned extensions to the Core Specification.

中文版本: [EXTENSIONS.zh-CN.md](EXTENSIONS.zh-CN.md)

Each extension is self-contained. Implementations MAY support any subset.

---

## Extension 1: Epistemic States

**Status**: Stable
**Depends on**: Core (corroborate / contradict operations)

### Overview

Adds a formal trust lifecycle to facts, derived from corroboration and contradiction evidence.

### New Fact Field

| Field | Type | Description |
|-------|------|-------------|
| `epistemic_state` | enum | Trust assessment: `asserted`, `corroborated`, `consensus`, `contested`, `refuted`, `superseded` |

### Epistemic State Machine

Unlike the workflow state machine (explicit transitions), epistemic state is **derived** from accumulated evidence — mirroring how scientific consensus works.

```
  ASSERTED ──(corroborations)──▶ CORROBORATED ──(quorum)──▶ CONSENSUS
      │                               │
      └──(contradictions)──▶ CONTESTED ──(quorum)──▶ REFUTED
                                  │
                                  └──(superseded_by set)──▶ SUPERSEDED
```

### Recomputation Rules

```
if fact.superseded_by is set       → SUPERSEDED
elif |contradictions| ≥ refute_q   → REFUTED
elif contradictions exist          → CONTESTED
elif |corroborations| ≥ consensus_q → CONSENSUS
elif corroborations exist          → CORROBORATED
else                               → ASSERTED
```

`consensus_q` and `refute_q` are implementation-defined quorum values (RECOMMENDED: 2).

> **Design note — `superseded` in the epistemic state enum**: `corroborated`,
> `contested`, and `refuted` represent positions on the *truth / confidence*
> axis; `superseded` represents a position on the *freshness / version* axis.
> Placing them in the same enum is an intentional pragmatic trade-off: it lets
> a single field drive both filter evaluation and event routing without
> introducing a separate `knowledge_state` field.
>
> The contract is: **freshness takes precedence over confidence**. A fact that
> once reached `consensus` but has since been superseded is treated as stale
> knowledge in all filter and routing decisions. Implementations and consumers
> MUST treat `SUPERSEDED` as the highest-priority terminating condition in the
> recomputation rule (evaluated before `REFUTED` or any trust rank).

### Epistemic Rank (for filter comparison)

| State | Rank | Meaning |
|-------|:----:|---------|
| SUPERSEDED | -3 | Replaced by newer fact |
| REFUTED | -2 | Disputed by quorum |
| CONTESTED | -1 | Under dispute |
| ASSERTED | 0 | Default, unverified |
| CORROBORATED | +1 | Confirmed by at least one peer |
| CONSENSUS | +2 | Confirmed by quorum |

### Additional Filter Dimensions

| Dimension | Type | Description |
|-----------|------|-------------|
| `min_epistemic_rank` | int | Minimum trust level to accept (default: -3 = accept all) |
| `min_confidence` | float | Minimum publisher confidence to accept |
| `exclude_superseded` | bool | Skip superseded facts (default: true) |

### Causal Chain Trust Propagation

When a fact's epistemic state transitions to `REFUTED` or `CONTESTED`, descendant facts in its causal chain may rest on an unsound basis. However, the bus MUST NOT automatically cascade epistemic state changes to descendants — doing so would violate the non-adjudication principle (Core §1.4).

Instead:

1. The bus SHOULD include `parent_fact_id` in the `fact_trust_changed` event payload, enabling interested ants to trace affected causal chains.
2. A ant that observes a refuted ancestor MAY publish a `CONTRADICT` against descendant facts it judges to be invalidated, providing its reasoning in the contradiction payload.
3. Consumers performing causal chain queries SHOULD check ancestor epistemic states when evaluating descendant trust.

This preserves the principle that trust derivation is a consumer-side concern while ensuring causal chain integrity is not silently lost.

### Additional Event

| Event | Trigger | Payload |
|-------|---------|---------|
| `fact_trust_changed` | Epistemic state changed due to corroboration/contradiction | fact_id, old_state, new_state, parent_fact_id |

---

## Extension 2: Semantic Classification

**Status**: Stable
**Depends on**: Core

### Overview

Adds a `semantic_kind` field that classifies what a fact *epistemically represents*.

### New Fact Field

| Field | Type | Description |
|-------|------|-------------|
| `semantic_kind` | enum | OPTIONAL. One of the kinds below |

### Recommended Vocabulary

| Kind | Meaning | Example |
|------|---------|---------|
| `observation` | Direct sensory data | `build.failed`, `cpu.usage.high` |
| `assertion` | Inference or judgment | `root_cause.suspected` |
| `request` | Something needs doing | `code.review.needed` |
| `resolution` | Result of processing | `code.review.completed` |
| `correction` | Supersedes a previous fact | Updated diagnosis |
| `signal` | Fire-and-forget status | `heartbeat`, `progress.60pct` |

### Additional Filter Dimension

| Dimension | Type | Description |
|-----------|------|-------------|
| `semantic_kinds` | enum[] | Which kinds to accept. Empty = all |

---

## Extension 3: Knowledge Evolution

**Status**: Stable
**Depends on**: Core, Epistemic States (optional)

### Overview

Adds automatic and explicit supersession of facts about the same subject.

### New Fact Fields

| Field | Type | Description |
|-------|------|-------------|
| `subject_key` | string | OPTIONAL. Groups facts about the same entity (e.g. `host:web-01/cpu-temp`) |
| `supersedes` | string | OPTIONAL. Explicit `fact_id` this fact replaces |

### Bus-Managed Field

| Field | Type | Description |
|-------|------|-------------|
| `superseded_by` | string | Set by bus when a newer fact supersedes this one |

### Supersession Rules

1. **Explicit**: If `fact.supersedes` is set and the target exists, mark the target as superseded.
2. **Automatic**: If `fact.subject_key` is set and another non-terminal fact shares the same `(subject_key, fact_type)`, mark the older one as superseded.

> **Auto-supersede scope**: Automatic supersession is designed for *latest-wins*
> fact types — situations where only the most recent value is meaningful, such as
> sensor readings, deployment status, or current resource utilisation.
>
> It is **not appropriate** when multiple concurrent facts of the same type
> should coexist, such as:
> - multi-source diagnostic observations
> - accumulated analysis conclusions
> - parallel suggestions from independent reviewers
>
> To limit automatic supersession to suitable fact types, implementations SHOULD
> require one of the following conditions to be met before triggering the rule:
> - The `fact_type`'s registered schema declares `"auto_supersede": true`, OR
> - The fact's `semantic_kind` ∈ `{observation, signal, correction}` (if the
>   Semantic Classification extension is active).
>
> Publishers wishing to prevent auto-supersession on a per-fact basis SHOULD
> omit `subject_key` and use explicit `supersedes` links instead.

When a fact is superseded:
- Set `old_fact.superseded_by = new_fact.fact_id`
- If Epistemic States extension is active: set `old_fact.epistemic_state = SUPERSEDED`
- Push `fact_superseded` event to interested ants

### Additional Event

| Event | Trigger |
|-------|---------|
| `fact_superseded` | A fact was superseded by a newer one |

---

## Extension 4: Schema Governance

**Status**: Experimental
**Depends on**: Core

### Overview

Adds a schema registry for fact payload validation.

### Concepts

- **FactSchema**: A named, versioned schema for a `fact_type`'s payload.
- **SchemaRegistry**: A bus-managed registry of schemas.
- **Enforcement modes**: `OPEN` (no validation), `WARN` (log but accept), `STRICT` (reject invalid).

### New Fact Field

| Field | Type | Description |
|-------|------|-------------|
| `schema_version` | string | OPTIONAL. Schema version for this `fact_type` |

### Bus Behavior

- On PUBLISH, if a schema exists for the `fact_type`, bus validates `payload` against it.
- In STRICT mode, invalid payloads are rejected.
- Schema violations MAY increase the publisher's error counter (if Fault Confinement extension is active).

### Schema Evolution

Schemas SHOULD support backward-compatible evolution:
- Adding optional fields: allowed
- Removing required fields: breaking change, requires new `fact_type` or major version bump
- Changing field types: breaking change

---

## Extension 5: Fault Confinement

**Status**: Stable
**Depends on**: Core

### Overview

Adds CAN-style error counters and threshold-based ant degradation.

### Ant Fields

| Field | Type | Description |
|-------|------|-------------|
| `transmit_error_counter` | int | TEC — incremented on errors, decremented on successes |
| `reliability_score` | float 0-1 | Derived from TEC (see mapping table below). Used in arbitration if Advanced Arbitration extension is active |

### Reliability Score Mapping

`reliability_score` maps directly from TEC thresholds to ant state boundaries:

| TEC Range | Ant State | `reliability_score` |
|-----------|:----------:|:-------------------:|
| 0 – 127 | ACTIVE | 1.0 |
| 128 – 255 | DEGRADED | 0.5 |
| ≥ 256 | ISOLATED | 0.0 |

Implementations SHOULD use this step function (or an equivalent recommended in
the Implementation Notes) so that `reliability_score` values are comparable
across nodes on the same bus. An ISOLATED ant scores 0.0 and cannot win
exclusive arbitration; a DEGRADED ant competes at half weight.

### Error State Machine

```
              TEC < threshold_1          TEC ≥ threshold_1          TEC ≥ threshold_2
  ┌─────────────────────┐    ┌─────────────────────┐    ┌──────────────────┐
  │       ACTIVE         │───▶│      DEGRADED        │───▶│     ISOLATED      │
  │  Normal operation    │◀───│  Reduced confidence  │◀───│  Cannot publish   │
  └─────────────────────┘    └─────────────────────┘    └──────────────────┘
```

`threshold_1` and `threshold_2` are implementation-defined (RECOMMENDED: 128 and 256).

### Error Counter Events

| Event | TEC Change |
|-------|-----------|
| Fact contradicted by another ant | Increase (RECOMMENDED: +8) |
| Fact rejected by schema validation | Increase (RECOMMENDED: +8) |
| Fact expired without resolution | Increase (RECOMMENDED: +2) |
| Rate limit exceeded | Increase (RECOMMENDED: +1) |
| Fact corroborated by another ant | Decrease (RECOMMENDED: -1) |
| Fact successfully resolved | Decrease (RECOMMENDED: -1) |
| Successful heartbeat | Decrease (RECOMMENDED: -1) |

TEC floor is 0 (never negative).

### Recovery

A ant in `isolated` state recovers by accumulating heartbeat decrements until TEC drops below `threshold_1`.

### Additional Event

| Event | Trigger |
|-------|---------|
| `ant_state_changed` | Ant transitioned between active/degraded/isolated |

---

## Extension 6: Advanced Arbitration

**Status**: Stable
**Depends on**: Core, Fault Confinement (optional)

### Overview

Defines a scoring algorithm for exclusive fact arbitration.

### Recommended Scoring Formula

```
score = (capability_overlap × 10 + domain_overlap × 5 + type_pattern_hit × 3)
        × reliability_score
```

Where:
- `capability_overlap` = |fact.need_capabilities ∩ ant.capability_offer|
- `domain_overlap` = |fact.domain_tags ∩ ant.domain_interests|
- `type_pattern_hit` = 1 if fact_type matches any pattern, else 0
- `reliability_score` = ant's reliability (1.0 if Fault Confinement extension is not active)

### Tiebreaking

Ties SHOULD be broken by: `reliability_score` → `ant_id` (lexicographic, deterministic).

---

## Extension 7: Storm Protection

**Status**: Stable
**Depends on**: Core

### Overview

Defines specific parameters for the safety guardrails described in Core §7.2.

### Recommended Parameters

| Guardrail | Parameter | Recommended Value |
|-----------|-----------|:-----------------:|
| Causation depth limit | max depth | 16 |
| Causation cycle detection | check | Verify fact_id not in ancestor chain |
| Deduplication | key | `(source_ant_id, fact_type, content_hash)` |
| Deduplication | window | 10 seconds |
| Per-ant rate limit | algorithm | Token bucket |
| Per-ant rate limit | capacity | 20 |
| Per-ant rate limit | refill rate | 5 per second |
| Global load breaker | window | 5 seconds |
| Global load breaker | threshold | 200 facts per window |
| Global load breaker | behavior | Only accept priority ≤ 1 (HIGH) |
| Priority aging | interval | 30 seconds |
| Priority aging | step | −1 (decrements numeric value toward higher priority) |
| Priority aging | floor | 1 (HIGH) — never age into CRITICAL |

> **Direction note**: The priority scale is `1 = HIGH … N = LOW`. Aging raises
> priority by **decrementing** the numeric value by 1 each interval until
> the floor is reached. A step of +1 would decrease priority — the opposite
> of the intended anti-starvation behaviour.

### Admission Check Order

All checks run in sequence on PUBLISH, ordered by computational cost:

```
1. Causation depth check         O(1)
2. Causation cycle detection     O(depth)
3. Deduplication window          O(1) amortized
4. Per-ant rate limit           O(1)
5. Global bus load breaker       O(1) amortized
6. Reliability gate              O(1)
7. Schema validation             O(payload_size)
```
