# AntLegion Bus — 多智能体协作系统

## 设计思想

### 为什么是"事实总线"而非"消息队列"

传统多 Agent 系统通常依赖直接调用或消息传递：Agent A 调用 Agent B，B 返回结果给 A。这种方式带来的问题是**硬耦合**——每个 Agent 需要知道其他 Agent 的存在、位置和接口。

AntLegion 的核心设计不同：Agent 之间**不直接通信，只通过发布和消费"事实（Fact）"来协作**。

```
传统方式:  产品经理 ──调用──> 前端开发 ──调用──> 测试工程师
AntLegion: 产品经理 ──发布 prd.published──> [Bus] ──推送──> 前端/后端（按订阅自动路由）
```

事实（Fact）是不可变的、带因果链的知识单元。每一条事实都记录了"谁、在什么时候、因为什么、产生了什么结论"，构成完整的协作溯源链。

### 自发涌现而非中央编排

没有调度器，没有 Orchestrator，没有流程引擎。四个 Agent 各自运行独立的主循环，监听 Bus 上与自己相关的事实，自主决定是否介入、如何处理。

一个典型的协作流程是这样自然涌现的：

```
[外部] 发布 requirement.created
  → [产品] 感知到，分析需求，写PRD，发布 task.backend.needed + task.frontend.needed
    → [后端] 抢先 claim task.backend.needed，写代码，发布 api.contract.published
    → [前端] claim task.frontend.needed，读取 API 契约，实现页面
      → [产品] 检测到前后端都完成，发布 task.test.needed
        → [测试] claim task.test.needed，设计用例，执行测试，发布 quality.approved
          → [产品] 确认验收，发布 feature.released
```

整个流程没有任何硬编码的调度逻辑，完全由事实的发布和订阅关系驱动。

### SOUL.md — Agent 的人格定义

每个 Agent 的行为由其工作目录下的 `SOUL.md` 决定，这是注入 LLM 系统提示词的核心文件。它定义了：

- **身份**：角色定位、经验背景、性格特征
- **工作流程**：感知哪类事实 → 如何处理 → 输出什么
- **输出规范**：文件写到哪里、发布什么类型的事实
- **协作规则**：与其他角色的接口约定

修改 `SOUL.md` 即可改变 Agent 的行为，无需改动任何代码。

### 共享文件系统作为"长期记忆"

Bus 上的事实是短暂的（有TTL），而 `shared-output/` 目录作为持久化的协作记忆：

- 后端写完 API 文档到 `/shared/docs/api/`，前端读取后对接
- 产品写完需求规格到 `/shared/requirements/`，测试根据它设计用例
- 所有产出通过 Docker volume 映射到宿主机，方便查看和使用

---

## 系统架构

```
┌─────────────────────────────────────────────────────────┐
│                    宿主机 (Host)                          │
│                                                         │
│  ./shared-output/          ./workspaces/                │
│  ├── docs/                 ├── product/SOUL.md          │
│  ├── requirements/         ├── backend/SOUL.md          │
│  ├── code/frontend/        ├── frontend/SOUL.md         │
│  ├── code/backend/         └── tester/SOUL.md           │
│  └── tests/                                             │
│        ↑ volume mount              ↑ volume mount       │
│  ──────┼────────────────────────────┼─────────────────  │
│        │         Docker Network     │                   │
│  ┌─────┴─────────────────────────────┴──────────────┐   │
│  │           Legion Bus :28080                       │   │
│  │        (事实存储 + WebSocket 推送)                  │   │
│  └──────┬──────────┬──────────┬──────────┬───────────┘   │
│         │          │          │          │               │
│  ┌──────┴──┐ ┌─────┴──┐ ┌────┴───┐ ┌────┴────┐          │
│  │产品经理  │ │后端开发 │ │前端开发 │ │测试工程 │          │
│  │ant-prod │ │ant-back│ │ant-frt │ │ant-test │          │
│  └─────────┘ └────────┘ └────────┘ └─────────┘          │
│                                                         │
│  Bus UI :3000  (实时监控 Dashboard)                      │
└─────────────────────────────────────────────────────────┘
```

---

## 快速开始

### 前置要求

- Docker + Docker Compose
- LLM API Key（支持 Anthropic 或 OpenAI 兼容接口）

### 第一步：配置 .env

```bash
cp .env.example .env
```

编辑 `.env`，根据你使用的 LLM 服务填入配置：

**方式A — 使用 Anthropic Claude：**
```env
ANTLEGION_BUS_SECRET=any-random-string

LLM_PROVIDER_TYPE=anthropic
ANTHROPIC_API_KEY=sk-ant-xxxxxxxx
LLM_MODEL=claude-sonnet-4-6-20250514
```

**方式B — 使用 OpenAI 兼容接口（SiliconFlow、OpenRouter 等）：**
```env
ANTLEGION_BUS_SECRET=any-random-string

LLM_PROVIDER_TYPE=openai-compatible
LLM_BASE_URL=https://api.siliconflow.cn/v1
LLM_API_KEY=sk-xxxxxxxx
LLM_MODEL=Pro/MiniMaxAI/MiniMax-M2.5
```

### 第二步：一键启动

```bash
./start.sh
```

首次运行会构建 Docker 镜像，约需 3-5 分钟。启动完成后输出：

```
服务地址：
  Bus API:    http://localhost:28080
  Dashboard:  http://localhost:3000
```

### 第三步：确认 Agent 已连接

```bash
curl http://localhost:28080/ants | python3 -m json.tool
```

应看到 4 个 Agent（`product-manager` / `backend-developer` / `frontend-developer` / `qa-tester`）已连接。

### 第四步：发布任务，启动协作流水线

```bash
./submit-task.sh
```

默认发布 **Todo CRUD** 演示任务，触发四个 Agent 协作完成一个前后端应用的开发。

### 监控进度

```bash
./watch.sh                                          # 状态快照（Agent/Facts/产出文件）
docker compose logs -f                              # 所有容器实时日志
docker compose logs -f ant-product ant-backend      # 只看指定 Agent
open http://localhost:3000                          # 可视化 Dashboard
```

---

## 查看产出

所有产出文件实时映射到宿主机 `./shared-output/` 目录：

```
shared-output/
├── docs/
│   ├── prd-todo-crud.md          ← 产品经理输出的 PRD
│   ├── api/todo-crud-api.md      ← 后端输出的 API 文档
│   ├── components/               ← 前端输出的组件文档
│   └── quality/                  ← 测试输出的质量报告
├── requirements/
│   └── todo-crud.md              ← 需求规格
├── code/
│   ├── backend/                  ← 后端代码（可直接运行）
│   └── frontend/                 ← 前端代码（可直接运行）
└── tests/
    ├── cases/                    ← 测试用例
    ├── test-todo-crud-api.sh     ← API 测试脚本
    └── bugs/                     ← Bug 报告
```

---

## 自定义 Agent 行为

修改对应的 `SOUL.md` 文件即可改变 Agent 行为，重启生效：

```bash
vim workspaces/product/SOUL.md    # 修改产品经理的工作方式
docker compose restart ant-product
```

## 发布自定义任务

```bash
./submit-task.sh "开发一个用户管理系统，支持增删改查和角色权限"
./submit-task.sh --file my-requirement.md
```

## 常用命令

```bash
./start.sh                        # 一键启动
./submit-task.sh                  # 发布演示任务
./watch.sh                        # 查看系统状态

docker compose down               # 停止所有服务
docker compose down -v            # 停止并清除 Bus 数据（重置状态）
docker compose restart ant-product  # 重启单个 Agent
docker exec -it ant-backend sh    # 进入容器调试
```
