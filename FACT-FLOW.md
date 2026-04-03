# AntLegion DDD 事实流治理

> 版本: v2.0 — DDD 职能域治理
> 约束: 每个 Agent 最多接受 3 种事实，最多发出 2 种事实

---

## 事实词汇表

| 事实类型 | 语义 | 模式 | 发布者 | 说明 |
|----------|------|------|--------|------|
| `requirement.submitted` | observation | exclusive | 外部 | 用户需求入口，触发整条流水线 |
| `prd.published` | resolution | broadcast | 产品经理 | PRD + 任务拆解完成 |
| `design.published` | resolution | broadcast | UI设计师 | 设计规范 + HTML 原型完成 |
| `api.published` | resolution | broadcast | 后端开发 | API 契约文档发布 |
| `backend.done` | resolution | broadcast | 后端开发 | 后端代码实现完成 |
| `frontend.done` | resolution | broadcast | 前端开发 | 前端代码实现完成 |
| `bug.found` | observation | exclusive | 测试工程师 | Bug 报告（按 need_capabilities 路由） |
| `quality.approved` | resolution | broadcast | 测试工程师 | 质量验收通过 |
| `release.approved` | resolution | broadcast | 产品经理 | 功能发布确认（终态） |

---

## Agent 事实契约

### 产品经理 — 需求域

```
┌─────────────────────────────────────────────────┐
│  产品经理 (product-manager)                      │
│  Bounded Context: 需求域                         │
├─────────────────────────────────────────────────┤
│  IN  (2/3):                                     │
│    ▸ requirement.submitted  [claim]              │
│    ▸ quality.approved       [context]            │
│                                                 │
│  OUT (2/2):                                     │
│    ◂ prd.published          [broadcast]          │
│    ◂ release.approved       [broadcast]          │
└─────────────────────────────────────────────────┘
```

### UI 设计师 — 设计域

```
┌─────────────────────────────────────────────────┐
│  UI 设计师 (ui-designer)                         │
│  Bounded Context: 设计域                         │
├─────────────────────────────────────────────────┤
│  IN  (1/3):                                     │
│    ▸ prd.published          [context → 触发]     │
│                                                 │
│  OUT (1/2):                                     │
│    ◂ design.published       [broadcast]          │
└─────────────────────────────────────────────────┘
```

### 后端开发 — 后端实现域

```
┌─────────────────────────────────────────────────┐
│  后端开发 (backend-developer)                    │
│  Bounded Context: 后端实现域                     │
├─────────────────────────────────────────────────┤
│  IN  (3/3):                                     │
│    ▸ prd.published          [context → 触发]     │
│    ▸ design.published       [context]            │
│    ▸ bug.found              [claim]              │
│                                                 │
│  OUT (2/2):                                     │
│    ◂ api.published          [broadcast]          │
│    ◂ backend.done           [broadcast]          │
└─────────────────────────────────────────────────┘
```

### 前端开发 — 前端实现域

```
┌─────────────────────────────────────────────────┐
│  前端开发 (frontend-developer)                   │
│  Bounded Context: 前端实现域                     │
├─────────────────────────────────────────────────┤
│  IN  (3/3):                                     │
│    ▸ design.published       [context → 触发]     │
│    ▸ api.published          [context → 触发]     │
│    ▸ bug.found              [claim]              │
│                                                 │
│  OUT (1/2):                                     │
│    ◂ frontend.done          [broadcast]          │
└─────────────────────────────────────────────────┘
```

### 测试工程师 — 质量域

```
┌─────────────────────────────────────────────────┐
│  测试工程师 (qa-tester)                          │
│  Bounded Context: 质量域                         │
├─────────────────────────────────────────────────┤
│  IN  (3/3):                                     │
│    ▸ prd.published          [context]            │
│    ▸ backend.done           [context → 触发]     │
│    ▸ frontend.done          [context → 触发]     │
│                                                 │
│  OUT (2/2):                                     │
│    ◂ bug.found              [exclusive]          │
│    ◂ quality.approved       [broadcast]          │
└─────────────────────────────────────────────────┘
```

---

## 流转拓扑

```
                requirement.submitted (外部)
                        │
                        ▼
               ┌─────────────────┐
               │    产品 (需求域)   │
               └────────┬────────┘
                        │ prd.published
          ┌─────────────┼─────────────────────┐
          ▼             ▼                     ▼
  ┌──────────────┐ ┌──────────────┐  ┌──────────────┐
  │  UI (设计域)   │ │ 后端 (后端域)  │  │  测试 (质量域) │
  └──────┬───────┘ └──────┬───────┘  └──────────────┘
         │                │                 ▲  ▲
         │ design         │ api             │  │
         │ .published     │ .published      │  │
         │     │          │                 │  │
         │     ▼          ▼                 │  │
         │  ┌──────────────┐                │  │
         └→ │ 前端 (前端域)  │                │  │
            └──────┬───────┘                │  │
                   │                        │  │
                   │ frontend.done ─────────┘  │
                   │                           │
                   │ backend.done ─────────────┘
                   │  (from 后端)
                   ▼
          ┌──────────────┐
          │  测试 (质量域)  │──→ bug.found ──→ 后端/前端
          └──────┬───────┘
                 │ quality.approved
                 ▼
        ┌─────────────────┐
        │    产品 (需求域)   │──→ release.approved (终态)
        └─────────────────┘
```

---

## 依赖门控规则

### 前端启动门控
前端需要 `design.published` **和** `api.published` 都到达后才开始实现。
先到的事实触发 agent turn，LLM 检查另一个是否已到达，未到达则等待。

### 测试执行门控
测试需要 `backend.done` **和** `frontend.done` 都到达后才执行测试。
先到的事实触发 agent turn，LLM 检查另一个是否已到达，未到达则等待。

### Bug 路由规则
`bug.found` 通过 `need_capabilities` 字段路由：
- 后端 Bug → `need_capabilities: ["backend-development"]`
- 前端 Bug → `need_capabilities: ["frontend-development"]`

---

## 与旧版对比

| 维度 | v1 (旧) | v2 (DDD) |
|------|---------|----------|
| 事实类型数 | 15+ (含 task.*) | 9 |
| Agent 发布约束 | 无限制 | ≤2 种/Agent |
| Agent 接收约束 | 无限制 | ≤3 种/Agent |
| 任务分发机制 | 产品发 task.* exclusive | 领域产出物自动触发 |
| 耦合度 | 产品知道所有下游 | 每个域只知道自己的输入输出 |
| Orchestration | 产品隐式充当 orchestrator | 完全去中心化 |
