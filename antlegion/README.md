# antlegion

[AntLegion Bus](https://github.com/YangKGcsdms/ant_legion_bus) 协议的 **独立 Agent 运行时**。

## 一句话概括

**OpenAnt 的 Channel 从人类对话换成了 Legion Bus。**

```
OpenAnt:     人类消息 → Agent Turn → LLM + Tools → 回复人类
antlegion:     总线事件 → Agent Turn → LLM + Tools → 发布事实
```

## 这是什么

antlegion 是一个通用的 Agent Runtime，让你的 AI agent 能够接入 AntLegion Bus 协议。

**它可以根据你引入的 workspace（SOUL.md、skills）变成任意角色**——开发者、测试、运维、产品，或者其他任何你能定义的角色。没有预设的四角色限制。

## 为什么用 Agent Runtime

| 方案 | 问题 |
|------|------|
| 简单 while loop | 无法管理复杂状态、工具调用、错误恢复 |
| 手写 LLM 调用 | 缺少 system prompt 组装、tool loop、session 管理 |
| Agent Runtime | **内建完整生命周期**：sense → decide → act → persist |

antlegion 提供：

1. **LLM + Tool 循环**：自动处理 tool_use、tool_result，支持最多 20 轮工具调用
2. **Session 管理**：per-agent 连续上下文，按 fact_id 固化记忆
3. **System Prompt 分层组装**：Runtime Context + SOUL + Skills + Tool 描述
4. **错误恢复**：LLM 失败时自动释放 claims，WebSocket 断线自动重连
5. **Fact Memory**：按因果链按需加载历史上下文，避免 session 无限增长

## 为什么去掉很多 OpenAnt 的东西

antlegion **不是** OpenAnt 的 fork，而是一个**精简重构**：

| 去掉的组件 | 原因 |
|------------|------|
| **Channel 层**（Discord/Slack/Telegram） | Legion Bus 场景不需要 IM 接入 |
| **Gateway 层**（WebSocket Server） | antlegion 是总线的客户端，不是服务端 |
| **Per-sender Session** | 没有人类对话，只有 agent 的连续上下文 |
| **人类消息处理** | 专注机器对机器的 fact 驱动协作 |

保留的核心：

- Agent Turn（LLM + tool loop）
- Workspace（SOUL.md/AGENTS.md/Skills）
- System Prompt Builder
- Tool Registry
- Plugin System
- Provider 抽象

**本质差异**：OpenAnt 服务人类对话，antlegion 服务机器协作。

## 快速开始

```bash
# 安装依赖
npm install

# 构建
npm run build

# 配置
cp antlegion.json.example antlegion.json
# 编辑 antlegion.json，设置 bus.url 和 provider.apiKey

# 运行
npm start
```

## 配置

```jsonc
{
  "bus": {
    "url": "http://localhost:28080",
    "name": "my-agent",
    "filter": {
      "capabilityOffer": ["coding"],
      "domainInterests": ["code"],
      "factTypePatterns": ["code.*"]
    }
  },
  "provider": {
    "type": "anthropic",
    "model": "claude-sonnet-4-6-20250514",
    "apiKey": "env:ANTHROPIC_API_KEY"
  },
  "workspace": "./workspace"
}
```

## 部署

```yaml
services:
  antlegion:
    image: antlegion
    volumes:
      - ./workspace:/workspace
    environment:
      ANT_BUS_URL: http://legion_bus:8080
      ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY}

  legion_bus:
    image: ant-fact-bus:latest
    ports:
      - "28080:8080"
```

## 工具

| 类别 | 工具 | 说明 |
|------|------|------|
| **Legion Bus** | `legion_bus_publish`, `legion_bus_claim`, `legion_bus_resolve`, `legion_bus_release`, `legion_bus_sense`, `legion_bus_query` | 总线操作 |
| **文件系统** | `read_file`, `write_file`, `list_dir` | workspace 范围内 |
| **Shell** | `exec` | workspace cwd，30s 超时 |
| **插件** | 由 plugin 注册 | 自定义 |

## 项目结构

```
src/
├── index.ts              # CLI 入口
├── runtime.ts            # Runtime 主类
├── config/               # 配置加载
├── channel/              # Legion Bus 通信层
├── agent/                # Agent Runner + Session + FactMemory
├── workspace/            # SOUL/AGENTS/Skills 加载
├── tools/                # 工具注册和执行
├── providers/            # LLM 服务商抽象
├── plugins/              # 插件系统
└── types/                # 协议和消息类型
```

## 开发

```bash
# 开发模式（watch）
npm run dev

# 运行测试
npm test

# 类型检查
npx tsc --noEmit
```

## 许可证与致谢

antlegion 采用 **MIT License**，与源项目 [OpenClaw](https://github.com/openclaw/openclaw) 保持一致。

### 致谢

本项目的核心架构受 [OpenClaw](https://github.com/openclaw/openclaw)（由 Peter Steinberger 创建）的启发，包括：
- Agent Runner（LLM + tool loop）的设计思想
- Session 和 Transcript 管理的概念
- Workspace（SOUL.md / Skills）配置框架

详见 [ATTRIBUTION.md](./ATTRIBUTION.md)

### License

MIT
