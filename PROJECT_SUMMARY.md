# AntLegion Bus 项目总结

**扫描日期**：2026年4月3日
**项目规模**：5,130+ 行 TypeScript 代码 | 178 个测试通过 | 5 个完整阶段

---

## 项目概述

**AntLegion Bus** 是一个**事实总线驱动的多智能体协作系统**，核心设计颠覆了传统 Agent 间通信模式。

### 核心创新

| 维度 | 传统方式 | AntLegion |
|------|--------|----------|
| **通信模式** | Agent 直接调用 (A→B→C) | Agent 发布/订阅事实 (A→Bus←B←C) |
| **耦合度** | 高耦合（需知道对方地址/接口） | 零耦合（只关心事实类型） |
| **协调方式** | 中央调度器编排 | 自发涌现（Agent 自主感知和决策） |
| **溯源性** | 难以追踪调用链 | 完整因果链（谁在何时因何发布了什么） |

**简化类比**：
```
传统：产品经理 调用→ 前端开发 调用→ 测试工程师
AntLegion：产品经理 发布 requirement.created → [Bus] → 自动路由给前端和测试
```

---

## 系统架构

```
┌─────────────────────────────────────────────────┐
│         AntLegion Platform (Docker)              │
├─────────────────────────────────────────────────┤
│                                                 │
│  [Legion Bus :28080]  ←→  [Bus UI :3000]       │
│   事实存储 + WebSocket       实时看板             │
│       推送                                       │
│         │  ▲                                     │
│    ┌────┼──┼───────────────────────┐           │
│    │    │  │                       │           │
│  ┌─▼─┐ ┌─▼──┐ ┌─────┐ ┌───────┐ │           │
│  │产品│ │后端 │ │前端  │ │测试   │ │           │
│  │经理 │ │开发 │ │开发  │ │工程   │ │           │
│  │    │ │    │ │     │ │      │ │           │
│  │Agent│ │Agent│ │Agent │ │Agent │ │           │
│  │    │ │    │ │     │ │      │ │           │
│  └────┘ └────┘ └─────┘ └───────┘ │           │
│                                   │           │
│    shared-output/ (volume mount)  │           │
│    ├── docs/                      │           │
│    ├── requirements/              │           │
│    ├── code/backend/              │           │
│    ├── code/frontend/             │           │
│    └── tests/                     │           │
│                                   │           │
└───────────────────────────────────┘           │
      ↓ (Docker volume)                         │
  [宿主机 - Host]                               │
  ./shared-output/  ← 所有产出文件可见         │
  ./workspaces/     ← Agent SOUL.md 配置      │
```

---

## 项目结构

### 三大核心模块

#### 1. **antlegion-bus** (事实总线引擎)
```
src/engine/
├── BusEngine.ts              # 核心引擎（publish/claim/resolve/release 生命周期）
├── ContentHasher.ts          # 内容哈希（与 Python 实现对齐）
├── FilterEngine.ts           # 过滤仲裁（capability offer 匹配）
├── ReliabilityManager.ts     # TEC 状态机（事实可靠性管理）
├── WorkflowStateMachine.ts   # 工作流状态转移
├── EpistemicStateMachine.ts  # 认知状态机（confidence 演变）
└── FlowControl.ts            # 令牌桶 + 去重 + 断路器

src/persistence/
└── JSONLStore.ts             # JSONL 持久化（追加/恢复/压缩）

src/server/
├── app.ts                    # Hono HTTP 服务
├── middleware.ts             # Token 认证
└── ws.ts                     # WebSocket per-ant 推送

src/types/
└── protocol.ts               # 事实协议定义
```

**关键特性**：
- ✅ 事实的完整生命周期管理（PENDING → CLAIMED → RESOLVED/SUPERSEDED）
- ✅ 过滤仲裁算法（多个 Agent 竞争同一事实时的公平分配）
- ✅ TTL 过期管理 + 垃圾回收
- ✅ JSONL 日志压缩与恢复（可从任意时间点重放）
- ✅ 后台任务（GC、压缩、TTL 检查）

#### 2. **antlegion** (Agent 运行时)
```
src/
├── runtime.ts                # 运行时主循环（sense→decide→act→persist）
├── agent/
│   ├── AgentRunner.ts        # LLM + Tool 循环（最多 20 轮工具调用）
│   ├── Session.ts            # 连续上下文管理（per-agent）
│   ├── FactMemory.ts         # 按因果链加载历史（避免上下文爆炸）
│   ├── SystemPromptBuilder.ts # 分层 Prompt 组装
│   └── EventFormatter.ts      # 事实→LLM 消息转换
├── tools/
│   ├── factbus.ts            # 6 个总线操作（publish/claim/resolve/release/sense/query）
│   ├── filesystem.ts         # read_file/write_file/list_dir
│   ├── exec.ts               # 命令执行（30s 超时）
│   └── registry.ts           # 工具注册表
├── workspace/
│   ├── loader.ts             # SOUL.md + Skills 加载
│   └── skills.ts             # Skills 文件解析
├── providers/
│   ├── anthropic.ts          # Anthropic Claude 支持
│   └── openai-compatible.ts  # OpenAI 兼容接口
├── channel/
│   └── LegionBusChannel.ts   # Bus 通信层（REST + WebSocket）
└── plugins/
    └── loader.ts             # 插件系统
```

**关键特性**：
- ✅ 自动工具调用循环（支持串联多个工具）
- ✅ Session 管理（连续对话上下文）
- ✅ FactMemory（按需加载相关历史，避免无限增长）
- ✅ 多 LLM 服务商支持（Anthropic、OpenAI 兼容）
- ✅ SOUL.md 驱动行为（修改 SOUL 即可改变 Agent 人格）

#### 3. **antlegion-bus-ui** (可视化看板)
```
src/
├── views/
│   ├── Dashboard.vue          # 首页（Ants 在线状态、Facts 实时流）
│   ├── FactDetail.vue         # 事实详情（payload/history/状态转移）
│   ├── FactTimeline.vue       # 因果链可视化
│   └── MetricsView.vue        # 系统指标
├── components/
│   ├── FactTable.vue          # 事实列表（实时更新）
│   ├── AntCard.vue            # Agent 卡片
│   └── StateTimeline.vue      # 状态机可视化
└── stores/
    └── bus.ts                 # Pinia + WebSocket 实时同步
```

**特色**：
- ✅ WebSocket 实时推送（无需轮询）
- ✅ 事实因果链图示化
- ✅ Agent 能力/状态看板
- ✅ 系统监控指标

---

## 核心设计

### 1. 事实（Fact）模型

```typescript
interface Fact {
  fact_id: string;              // 唯一标识
  type: string;                 // 事实类型（如 requirement.created）
  payload: any;                 // 事实内容
  created_by: string;           // 发布者
  created_at: ISO8601;          // 发布时间

  parent_facts: string[];       // 因果关系（父事实）
  child_facts: string[];        // 因果关系（子事实）

  status: 'PENDING' | 'CLAIMED' | 'RESOLVED' | 'SUPERSEDED';
  claimed_by?: string;          // claim 者
  resolution?: any;             // 解决结果

  tec_state: 'UNVERIFIED' | 'VERIFIED' | 'FALSIFIED';
  confidence: number;           // [0, 1] 认知置信度

  ttl_minutes: number;          // 生命周期
  expires_at: ISO8601;
}
```

### 2. Agent 自发协作流程示例

```
[外部] 发布 requirement.created
  ↓
[产品 Agent] 感知到，分析需求
  • 从 payload 读需求文本
  • claim 该 fact，处理
  • resolve 发布 task.backend.needed + task.frontend.needed
    ↓
    [后端 Agent] 看到 task.backend.needed
      • 竞争 claim（若多个 Agent 也想处理，Bus 会仲裁）
      • 读 API 接口定义
      • 实现代码
      • resolve 发布 api.contract.published
        ↓
        [前端 Agent] 看到 api.contract.published
          • claim 并读 API 文档
          • 实现页面
          • resolve 发布 frontend.implemented
            ↓
            [产品 Agent] 检测到前后端都完成
              • 发布 task.test.needed
                ↓
                [测试 Agent] 看到，设计用例，运行测试
                  • 发布 quality.approved（或 quality.rejected）
```

**无需中央编排，全部由事实驱动自发涌现。**

### 3. 分层 System Prompt

Agent 的行为由多层 Prompt 组成（优先级从高到低）：

1. **Runtime Context**（系统注入）
   - Bus 连接信息、当前 Session ID、工具列表
2. **SOUL.md**（Agent 人格）
   - 身份角色、工作风格、决策规则
3. **Skills**（能力定义）
   - 可选技能的输入/输出规范
4. **工具描述**（动态生成）
   - 每个可用工具的参数和用途

修改 SOUL.md 即可在运行时改变 Agent 行为，**无需重新编译代码**。

---

## 实现进度

### antlegion-bus（事实总线）

```
Phase 1: 骨架 + 协议类型 + 持久化          ✅ DONE (5/5)
Phase 2: 过滤 + 可靠性 + 流控              ✅ DONE (3/3)
Phase 3: BusEngine 核心                    ✅ DONE (9/9)
Phase 4: HTTP/WS 服务器                   ✅ DONE (4/4)
Phase 5: 看板 + 部署                      ✅ DONE (3/3)

总计：74 个单元测试 + 35 个集成测试 = 109 个测试全部通过
```

### antlegion（Agent 运行时）

```
Phase 1: 骨架 + 总线连通                   ✅ DONE (10/10)
Phase 2: Agent Runner + 工具 + FactMemory ✅ DONE (10/10)
Phase 3: Workspace + System Prompt         ✅ DONE (3/3)
Phase 4: 部署 + 扩展                      ✅ DONE (5/5)

总计：69 个单元测试全部通过
```

---

## 快速开始

### 一键启动

```bash
# 1. 配置环境
cp .env.example .env
# 编辑 .env，填入 LLM API Key

# 2. 启动系统
./start.sh

# 3. 查看 Agent 状态
curl http://localhost:28080/ants | python3 -m json.tool

# 4. 发布演示任务（默认是 Todo CRUD 应用）
./submit-task.sh

# 5. 监控进度
./watch.sh                  # 快照查看
docker compose logs -f      # 实时日志
open http://localhost:3000  # 看板 (Dashboard)
```

### 发布自定义任务

```bash
# 方式 1：直接指定需求
./submit-task.sh "开发一个用户管理系统，支持增删改查和角色权限"

# 方式 2：从文件加载
./submit-task.sh --file my-requirement.md
```

### 修改 Agent 行为

编辑 Agent 的 SOUL.md，然后重启：

```bash
vim workspaces/product/SOUL.md    # 修改产品经理
docker compose restart ant-product

# 不需要重新编译，Agent 会自动采用新的 SOUL 定义
```

---

## 输出产物

所有产出实时映射到宿主机 `./shared-output/` 目录：

```
shared-output/
├── docs/
│   ├── prd-todo-crud.md         ← 产品经理输出的 PRD
│   ├── api/todo-crud-api.md     ← 后端输出的 API 文档
│   ├── components/              ← 前端输出的组件文档
│   └── quality/                 ← 测试输出的质量报告
├── requirements/
│   └── todo-crud.md             ← 需求规格
├── code/
│   ├── backend/                 ← 后端代码（可直接运行）
│   └── frontend/                ← 前端代码（可直接运行）
└── tests/
    ├── cases/                   ← 测试用例设计
    ├── test-todo-crud-api.sh    ← API 测试脚本（可执行）
    └── bugs/                    ← Bug 报告
```

所有文件通过 Docker volume 映射，可直接在宿主机查看和使用。

---

## 技术亮点

### 1. 事实驱动 vs 消息驱动
- **消息队列**：A 需要知道 B 的地址，B 需要知道 C 的地址 → 硬耦合
- **事实总线**：A 发布事实，B 和 C 根据兴趣订阅 → 松耦合

### 2. 自发涌现 vs 中央编排
- **传统方式**：有一个 Orchestrator 负责调度 → 易成为瓶颈
- **AntLegion**：每个 Agent 独立运行，根据事实自主决策 → 高度可扩展

### 3. 完整溯源链
- 每条事实记录因果关系，支持**向上追溯**（这条事实为什么被创建）和**向下追踪**（它导致了什么）
- 适合调试、审计、合规

### 4. LLM 友好的持久化
- JSONL 格式（一行一条记录），易于日志压缩和恢复
- Fact Memory（按需加载相关历史），避免上下文无限增长
- 支持从任意时间点**快照恢复**，不需要从头重放整个日志

### 5. 零配置 Agent 定制
- 修改 SOUL.md，无需改代码，无需重新编译
- Agent 的「人格」完全由 Prompt 定义，支持运行时动态修改

---

## 依赖与技术栈

| 层级 | 技术 | 用途 |
|------|------|------|
| **Backend** | Node.js + TypeScript | 基础运行环境 |
| **HTTP** | Hono | 轻量级 Web 框架 |
| **WebSocket** | ws | 实时通信 |
| **LLM** | Anthropic Claude / OpenAI | AI 推理 |
| **持久化** | JSONL | 事实存储 |
| **容器化** | Docker + Docker Compose | 部署和编排 |
| **前端** | Vue 3 + Tailwind v3 | 看板 UI |
| **监控** | 内置 Logger/MetricsCollector | 可观测性 |

---

## 典型场景

### 场景 1：开发流水线（Demo 示例）
**需求** → **PRD** → **API 定义** → **前端实现** → **测试** → **发布**

所有角色并行工作，自动协调，无需手动沟通。

### 场景 2：运维应急响应
- 告警系统发布 `alert.fired` 事实
- 值班工程师 Agent 感知，诊断问题
- 自动化 Agent claim `mitigation.needed`，执行补救
- 恢复后发布 `incident.resolved`，触发事后分析

### 场景 3：企业知识库协作
- 产品经理发布 `feature.planned`
- 文档 Agent 自动生成需求文档
- 测试 Agent 设计用例
- 所有产出自动发送到知识库

---

## 扩展点

### 添加新 Agent
```bash
# 1. 创建 workspace
mkdir workspaces/my-role
cat > workspaces/my-role/SOUL.md << EOF
# My Custom Role
你是一个...
EOF

# 2. 启动 antlegion 容器指向该 workspace
docker run -v ./workspaces/my-role:/workspace antlegion
```

### 添加新工具
在 `antlegion` 项目的 `src/tools/` 下新增工具文件，注册到 ToolRegistry，重新编译。

### 自定义过滤规则
修改 `antlegion-bus` 的 `FilterEngine.ts`，重新部署 Bus。

---

## 总结

**AntLegion Bus** 是一个**生产就绪的多智能体协作平台**：

- ✅ 完整的事实生命周期管理
- ✅ 零耦合的 Agent 间通信模型
- ✅ 自发涌现的协作流程（无需中央编排）
- ✅ 完整的因果链溯源
- ✅ 可视化看板和实时监控
- ✅ Docker 一键部署
- ✅ 大规模测试覆盖（178+ 测试）

**适用于**：企业协作、自动化工作流、分布式决策、应急响应等需要多角色联动的复杂场景。

---

**项目仓库**：已在本地 `antlegion-platform/` 目录
**文档齐全**：README + PROGRESS + SOUL 均已就位
**可立即运行**：`./start.sh` 一键启动
