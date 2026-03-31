# 🐜 Ant Agent Network - 团队协作协议

## 团队成员

| Agent | 角色 | 核心能力 | Fact 订阅 |
|-------|------|---------|----------|
| `product-manager` | 产品经理 | 需求分析、PRD、任务拆分 | `requirement.*`, `feature.*` |
| `frontend-developer` | 前端开发 | UI组件、页面、交互 | `code.frontend.*`, `ui.*` |
| `backend-developer` | 后端开发 | API、数据库、业务逻辑 | `code.backend.*`, `api.*` |
| `qa-tester` | 测试工程师 | 测试用例、自动化、Bug | `test.*`, `bug.*` |

## 协作流程

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Legion Bus (事实总线)                           │
└─────────────────────────────────────────────────────────────────────┘
        ↑                    ↑                    ↑                ↑
        │                    │                    │                │
   ┌────┴────┐         ┌────┴────┐         ┌────┴────┐      ┌────┴────┐
   │ Product │ ──PRD──→│Frontend │         │ Backend │      │  QA     │
   │ Manager │         │   Dev   │←──API──→│   Dev   │      │ Tester  │
   └─────────┘         └─────────┘         └─────────┘      └────┬────┘
        │                    │                    │                │
        │                    └────────────────────┴────────────────┘
        │                                  ↓
        └──────────────────────────→ 验收测试 ←────────────────────┘
```

## 标准工作流

### 1. 需求阶段
```
User Request
    ↓
[product-manager] 分析需求
    ↓
发布: requirement.created (broadcast)
    ↓
[product-manager] 编写 PRD
    ↓
发布: prd.published (broadcast)
    ↓
[product-manager] 拆分任务
    ↓
发布: task.frontend.needed (exclusive)
发布: task.backend.needed (exclusive)
```

### 2. 开发阶段
```
[frontend-developer] claim task.frontend.needed
    ↓
实现 UI 组件/页面
    ↓
发布: code.frontend.completed (broadcast)
发布: code.review.needed (exclusive)

[backend-developer] claim task.backend.needed
    ↓
实现 API/数据库
    ↓
发布: api.contract.published (broadcast)  ← 前端订阅
发布: code.backend.completed (broadcast)
```

### 3. 测试阶段
```
[qa-tester] 监听 code.*.completed
    ↓
设计测试用例
    ↓
发布: test.case.created (broadcast)
    ↓
执行测试
    ↓
发布: test.execution.completed (broadcast)
    或
发布: bug.found (exclusive) → 开发认领修复
```

### 4. 验收阶段
```
[qa-tester] 验收测试通过
    ↓
发布: quality.approved (broadcast)
    ↓
[product-manager] 确认验收
    ↓
发布: feature.released (broadcast)
```

## Fact 类型约定

### 需求相关
| fact_type | semantic_kind | mode | 说明 |
|-----------|--------------|------|------|
| `requirement.created` | observation | broadcast | 新需求创建 |
| `requirement.updated` | observation | broadcast | 需求变更 |
| `prd.published` | resolution | broadcast | PRD 发布 |

### 任务相关
| fact_type | semantic_kind | mode | 说明 |
|-----------|--------------|------|------|
| `task.frontend.needed` | request | exclusive | 前端任务 |
| `task.backend.needed` | request | exclusive | 后端任务 |
| `task.test.needed` | request | exclusive | 测试任务 |

### 代码相关
| fact_type | semantic_kind | mode | 说明 |
|-----------|--------------|------|------|
| `code.frontend.completed` | resolution | broadcast | 前端代码完成 |
| `code.backend.completed` | resolution | broadcast | 后端代码完成 |
| `api.contract.published` | assertion | broadcast | API 契约发布 |
| `code.review.needed` | request | exclusive | 需要代码审查 |

### 测试相关
| fact_type | semantic_kind | mode | 说明 |
|-----------|--------------|------|------|
| `test.case.created` | observation | broadcast | 测试用例创建 |
| `test.execution.completed` | resolution | broadcast | 测试执行完成 |
| `bug.found` | observation | exclusive | 发现 Bug |
| `bug.fixed` | resolution | broadcast | Bug 已修复 |

### 质量相关
| fact_type | semantic_kind | mode | 说明 |
|-----------|--------------|------|------|
| `quality.report.published` | assertion | broadcast | 质量报告 |
| `quality.approved` | resolution | broadcast | 质量验收通过 |
| `feature.released` | resolution | broadcast | 功能发布 |

## 共享目录结构

```
/knowledge-base/          # 只读知识库
├── architecture/         # 架构文档
├── standards/            # 编码规范
├── templates/            # 模板文件
└── examples/             # 示例代码

/shared-output/           # 共享输出
├── docs/                 # 文档输出
│   ├── api/              # API 文档
│   ├── components/       # 组件文档
│   └── quality/          # 质量报告
├── requirements/         # 需求文档
├── code/                 # 代码输出
│   ├── frontend/         # 前端代码
│   └── backend/          # 后端代码
└── tests/                # 测试输出
    ├── cases/            # 测试用例
    └── bugs/             # Bug 报告
```

## 冲突解决

1. **任务冲突**: exclusive 模式确保只有一个 Agent 处理
2. **代码冲突**: 通过 code.review.needed 请求审查
3. **需求歧义**: 发布 clarification.needed 请求产品澄清
