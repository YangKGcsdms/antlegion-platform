# antlegion-bus — Implementation Progress

---

## Phase 1 — 骨架 + 协议类型 + 持久化

目标：类型定义完整，hash 算法与 Python 对齐，JSONL 存储可读写可恢复。

| # | 任务 | 文件 | 状态 |
|:-:|------|------|:----:|
| 1.1 | 协议类型定义 | `src/types/protocol.ts` | ✅ DONE |
| 1.2 | content_hash + bus signature | `src/engine/ContentHasher.ts` | ✅ DONE |
| 1.3 | 工作流状态机 | `src/engine/WorkflowStateMachine.ts` | ✅ DONE |
| 1.4 | 认知状态机 | `src/engine/EpistemicStateMachine.ts` | ✅ DONE |
| 1.5 | JSONL 持久化（追加 + 恢复 + 压缩） | `src/persistence/JSONLStore.ts` | ✅ DONE |

**验证条件：** ✅ 单元测试 74 通过，hash 输出与 Python 实现 3 个向量对齐一致。

---

## Phase 2 — 过滤 + 可靠性 + 流控

目标：过滤仲裁算法完整，TEC 状态机可用，令牌桶/去重/断路器就位。

| # | 任务 | 文件 | 状态 |
|:-:|------|------|:----:|
| 2.1 | 过滤评估 + 独占仲裁 | `src/engine/FilterEngine.ts` | ✅ DONE |
| 2.2 | TEC / Ant 状态机 | `src/engine/ReliabilityManager.ts` | ✅ DONE |
| 2.3 | 令牌桶 + 去重 + 断路器 | `src/engine/FlowControl.ts` | ✅ DONE |

**验证条件：** ✅ 过滤仲裁 20 测试，可靠性 13 测试，流控 21 测试，全部通过。

---

## Phase 3 — BusEngine 核心

目标：完整事实生命周期，后台任务（TTL/GC/压缩）。

| # | 任务 | 文件 | 状态 |
|:-:|------|------|:----:|
| 3.1 | BusEngine 主类（发布管道） | `src/engine/BusEngine.ts` | ✅ DONE |
| 3.2 | 认领（原子操作） | `src/engine/BusEngine.ts` | ✅ DONE |
| 3.3 | 解决 + 子事实派生 | `src/engine/BusEngine.ts` | ✅ DONE |
| 3.4 | 释放（RELEASE） | `src/engine/BusEngine.ts` | ✅ DONE |
| 3.5 | 确认/反驳 + 认知状态重算 | `src/engine/BusEngine.ts` | ✅ DONE |
| 3.6 | TTL 过期循环 | `src/engine/BusEngine.ts` | ✅ DONE |
| 3.7 | GC 循环 | `src/engine/BusEngine.ts` | ✅ DONE |
| 3.8 | 日志压缩循环 | `src/engine/BusEngine.ts` | ✅ DONE |
| 3.9 | 启动恢复（JSONL 重放） | `src/engine/BusEngine.ts` | ✅ DONE |

**验证条件：** ✅ 35 个集成测试，完整生命周期（publish→claim→resolve→child fact）、认知状态演变、supersede、recovery 全部通过。

---

## Phase 4 — HTTP/WS 服务器

目标：`antlegion` 可以连接，收发事件，完整协作。

| # | 任务 | 文件 | 状态 |
|:-:|------|------|:----:|
| 4.1 | Hono 应用 + 全部 REST 路由 | `src/server/app.ts` | ✅ DONE |
| 4.2 | Token 认证中间件 | `src/server/middleware.ts` | ✅ DONE |
| 4.3 | WebSocket 端点（per-ant 事件推送） | `src/server/ws.ts` | ✅ DONE |
| 4.4 | 入口 + 服务器启动 | `src/index.ts` | ✅ DONE |

**验证条件：** ✅ 15 个 HTTP 集成测试通过。WebSocket 推送已实现。

---

## Phase 5 — 看板 + 部署

目标：可视化看板（独立 Vue 3 项目），Docker 一键部署。

| # | 任务 | 文件 / 项目 | 状态 |
|:-:|------|-------------|:----:|
| 5.1 | 看板 SPA（Vue 3 + Tailwind v3） | `antlegion-bus-ui/` 独立项目 | ✅ DONE |
| 5.2 | Dockerfile（多阶段构建） | `Dockerfile` | ✅ DONE |
| 5.3 | docker-compose（bus + ui） | `docker-compose.yml` | ✅ DONE |

**验证条件：** ✅ UI 构建成功（107KB），docker-compose 同时启动 bus + ui。

---

## 当前进度

```
Phase 1: ██████████ 100% (5/5) ✅
Phase 2: ██████████ 100% (3/3) ✅
Phase 3: ██████████ 100% (9/9) ✅
Phase 4: ██████████ 100% (4/4) ✅
Phase 5: ██████████ 100% (3/3) ✅
```

**全部完成。** 178 个测试通过。
