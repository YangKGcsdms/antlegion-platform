# antlegion — Implementation Progress

---

## Phase 1 — 骨架 + 总线连通

目标：连上 Legion Bus，收发事件，心跳保活。

| # | 任务 | 文件 | 状态 |
|:-:|------|------|:----:|
| 1.1 | 协议类型定义 | `src/types/protocol.ts` | DONE |
| 1.2 | LLM 消息类型 | `src/types/messages.ts` | DONE |
| 1.3 | 配置类型 + 加载 | `src/config/types.ts`, `config.ts` | DONE |
| 1.4 | EventQueue | `src/channel/EventQueue.ts` | DONE |
| 1.5 | ContentHasher | `src/channel/ContentHasher.ts` | DONE |
| 1.6 | BusRestClient | `src/channel/BusRestClient.ts` | DONE |
| 1.7 | BusWebSocket | `src/channel/BusWebSocket.ts` | DONE |
| 1.8 | LegionBusChannel | `src/channel/LegionBusChannel.ts` | DONE |
| 1.9 | Runtime 启动 + 心跳循环 | `src/runtime.ts` | DONE |
| 1.10 | CLI 入口 | `src/index.ts` | DONE |

**验证条件：** Dashboard 看到节点上线，日志打印收到的事件。

---

## Phase 2 — Agent Runner + 工具 + FactMemory

目标：LLM 驱动的完整 sense→decide→act 循环。

| # | 任务 | 文件 | 状态 |
|:-:|------|------|:----:|
| 2.1 | Anthropic Provider | `src/providers/anthropic.ts` | DONE |
| 2.2 | ToolRegistry | `src/tools/registry.ts` | DONE |
| 2.3 | legion_bus_* 工具（6个） | `src/tools/factbus.ts` | DONE |
| 2.4 | read_file / write_file / list_dir | `src/tools/filesystem.ts` | DONE |
| 2.5 | exec 工具 | `src/tools/exec.ts` | DONE |
| 2.6 | Session | `src/agent/Session.ts` | DONE |
| 2.7 | EventFormatter | `src/agent/EventFormatter.ts` | DONE |
| 2.8 | AgentRunner（LLM + tool loop） | `src/agent/AgentRunner.ts` | DONE |
| 2.9 | FactMemory（固化 + 因果链加载） | `src/agent/FactMemory.ts` | DONE |
| 2.10 | Runtime 主循环集成 | `src/runtime.ts` | DONE |

**验证条件：**
1. 发布事实 → Agent claim → 处理 → resolve
2. resolve 附带 child fact，因果链 2 层
3. 子事实到达时 LLM 能看到父事实的处理摘要

---

## Phase 3 — Workspace + 完整 System Prompt

目标：SOUL.md 驱动 agent 行为。

| # | 任务 | 文件 | 状态 |
|:-:|------|------|:----:|
| 3.1 | Workspace 文件加载 | `src/workspace/loader.ts` | DONE |
| 3.2 | Skills 加载 | `src/workspace/skills.ts` | DONE |
| 3.3 | SystemPromptBuilder | `src/agent/SystemPromptBuilder.ts` | DONE |

**验证条件：** 修改 SOUL.md 后 agent 行为随之变化。

---

## Phase 4 — 部署 + 扩展

| # | 任务 | 文件 | 状态 |
|:-:|------|------|:----:|
| 4.1 | OpenAI-compatible Provider | `src/providers/openai-compatible.ts` | DONE |
| 4.2 | Dockerfile | `Dockerfile` | DONE |
| 4.3 | Plugin system | `src/plugins/loader.ts` | DONE |
| 4.4 | /health 端点 | `src/runtime.ts` | DONE |
| 4.5 | JSONL transcript 持久化 | `src/agent/Session.ts` | DONE |

---

## 当前进度

```
Phase 1: ██████████ 100% (10/10)
Phase 2: ██████████ 100% (10/10)
Phase 3: ██████████ 100% (3/3)
Phase 4: ██████████ 100% (5/5)
```

**全部 Phase 完成。**
