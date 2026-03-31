# antlegion-bus

> AntLegion Bus 协议的 Node.js/TypeScript 服务端实现。

与 [antlegion](../antlegion)（Agent Runtime）技术栈统一：整个生态统一为 TypeScript。

---

## 项目定位

```
antlegion-bus  ←  总线服务端（本项目）
antlegion      ←  Agent Runtime / 节点客户端
```

两者共用相同的协议规范，实现完整闭环：

```
[antlegion Agent]  →  WebSocket/HTTP  →  [antlegion-bus]
      ↑                                         ↑
  发布/认领/解决/查询事实               存储事实、分发事件、仲裁认领
```

对应 Python 参考实现 `ant_legion_bus`，协议对齐，可互操作。

---

## 协议文档

| 文档 | 内容 |
|------|------|
| [protocol/SPEC.zh-CN.md](protocol/SPEC.zh-CN.md) | 完整协议规范 |
| [protocol/EXTENSIONS.zh-CN.md](protocol/EXTENSIONS.zh-CN.md) | 可选扩展（认知状态、语义分类、故障隔离等） |
| [protocol/IMPLEMENTATION-NOTES.zh-CN.md](protocol/IMPLEMENTATION-NOTES.zh-CN.md) | 推荐默认值与算法 |

## 设计文档

[DESIGN.md](DESIGN.md) — 架构、状态机、API 设计、实现阶段规划。

## 实现进度

[PROGRESS.md](PROGRESS.md) — 各 Phase 任务清单与完成状态。

---

## 快速开始（规划中）

```bash
npm install
npm run build
npm start
```

- 看板：http://localhost:28080
- API：http://localhost:28080/facts

---

## 技术栈

| 层 | 选型 |
|----|------|
| 运行时 | Node.js 22+ |
| 语言 | TypeScript 5.7+ |
| HTTP/WS | Hono + @hono/node-server |
| 持久化 | JSONL 追加日志（自研） |
| 测试 | Vitest |

---

## License

MIT
