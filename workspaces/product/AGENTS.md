# Ant Agent Network - 五角色协作协议

## 团队成员

| Agent | 角色 | 核心能力 | Fact 订阅 |
|-------|------|---------|----------|
| `product-manager` | 产品经理 | 需求分析、PRD、任务拆分 | `requirement.*`, `feature.*` |
| `ui-developer` | UI开发 | HTML原型、Tailwind CSS、视觉规范 | `task.ui.*`, `ui.*` |
| `backend-developer` | 后端开发 | API、数据库、业务逻辑 | `task.backend.*`, `api.*` |
| `frontend-developer` | 前端开发 | React组件、状态管理、API对接 | `task.frontend.*`, `code.*` |
| `qa-tester` | 测试工程师 | E2E测试、契约验证、Bug报告 | `task.test.*`, `bug.*` |

## 五角色协作流程

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Legion Bus (事实总线)                         │
└─────────────────────────────────────────────────────────────────────┘
     ↑            ↑              ↑              ↑              ↑
     │            │              │              │              │
┌────┴────┐  ┌────┴────┐  ┌────┴────┐  ┌─────┴─────┐  ┌────┴────┐
│ Product │  │   UI    │  │ Backend │  │ Frontend  │  │   QA    │
│ Manager │  │  Dev    │  │   Dev   │  │    Dev    │  │ Tester  │
└────┬────┘  └────┬────┘  └────┬────┘  └─────┬─────┘  └────┬────┘
     │            │              │              │              │
     │  PRD ──→ ①UI原型         │              │              │
     │         ②API文档 ←───── │              │              │
     │                    ③前端参照UI+API ──→ │              │
     │                                        │ ④E2E测试 ──→│
     └────────────────── ⑤验收 ←──────────────┴──────────────┘
```

## 标准工作流

### 1. 需求阶段
```
[product-manager] 分析需求 → 编写 PRD
  发布: prd.published (broadcast)
  发布: task.ui.needed (exclusive)        ← UI 和后端并行
  发布: task.backend.needed (exclusive)
```

### 2. UI + 后端并行阶段
```
[ui-developer] claim task.ui.needed
  → 读 PRD，做 HTML + Tailwind 原型页面
  → 发布: ui.prototype.published (broadcast)  ← 前端订阅
  → 发布: code.ui.completed (broadcast)

[backend-developer] claim task.backend.needed
  → 读 PRD，先写 API 文档
  → 发布: api.contract.published (broadcast)  ← 前端订阅
  → 写代码，发布: code.backend.completed (broadcast)
```

### 3. 前端阶段（依赖 UI 原型 + API 文档）
```
[product-manager] 等 UI + 后端完成后
  发布: task.frontend.needed (exclusive)
    payload.depends_on: ["ui.prototype.published", "api.contract.published"]

[frontend-developer] claim task.frontend.needed
  → 读 UI 原型 HTML（/shared/code/ui/），参照样式和组件拆分
  → 读 API 文档，写 types 和 services
  → 发布: code.frontend.completed (broadcast)
```

### 4. 测试阶段
```
[product-manager]
  发布: task.test.needed (exclusive)

[qa-tester] claim task.test.needed
  → E2E 测试（Playwright）
  → 发布: quality.approved 或 bug.found
```

### 5. 验收阶段
```
[product-manager] 确认 quality.approved
  发布: feature.released (broadcast)
```

## Fact 类型约定

### UI 相关（新增）
| fact_type | semantic_kind | mode | 说明 |
|-----------|--------------|------|------|
| `task.ui.needed` | request | exclusive | UI 原型任务 |
| `ui.prototype.published` | assertion | broadcast | HTML 原型发布 |
| `code.ui.completed` | resolution | broadcast | UI 代码完成 |

### 任务相关
| fact_type | semantic_kind | mode | 说明 |
|-----------|--------------|------|------|
| `task.frontend.needed` | request | exclusive | 前端任务（依赖 UI + API） |
| `task.backend.needed` | request | exclusive | 后端任务 |
| `task.test.needed` | request | exclusive | 测试任务 |

### 共享目录结构

```
/shared-output/
├── docs/
│   ├── api/              # 后端 API 文档
│   ├── quality/          # 测试质量报告
│   └── prd-*.md          # PRD 文档
├── requirements/         # 需求文档
├── code/
│   ├── ui/               # HTML + Tailwind 原型 ← UI开发产出
│   ├── frontend/         # React 代码 ← 前端开发产出
│   └── backend/          # Express 代码 ← 后端开发产出
└── tests/                # 测试产出
```
