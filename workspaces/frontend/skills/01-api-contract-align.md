写 `services/api.ts` 和 `types/index.ts` 之前，必须先读后端的 API 文档。禁止无文档猜格式。

上次没读 API 文档，`request` 函数统一 `return data.data`，但后端列表接口的分页字段是平铺在顶层的，`response.data` 变成 `undefined`，页面白屏。

## 你的感知和反应

| 感知到 | 你的反应 |
|--------|---------|
| `ui.prototype.published` + `api.contract.published` 都到了 | 两个前置条件满足，开始写代码 |
| 只收到 `prd.published` | 读 PRD 了解需求，但不写 API 对接代码（等 API 文档） |
| 只收到 `ui.prototype.published` | 可以先搭项目骨架和组件结构，API 层留 TODO |
| 只收到 `api.contract.published` | 可以先写 types 和 services，页面样式等 UI 原型 |
| `bug.found`（路由到你） | 读 bug 描述，修复，发 `bug.fixed` |

## API 对接规则

types 必须 1:1 映射 API 文档的 JSON 结构。request 封装区分列表和单条接口的解包方式。

```typescript
// 列表接口返回完整 JSON（含 total/page/limit）
export async function getTodos(params): Promise<TodoListResponse> {
  return request<TodoListResponse>(`/todos?...`);
}
// 调用方：res.data 拿数组，res.total 拿总数

// 单条接口解包 .data
export async function createTodo(input): Promise<Todo> {
  const res = await request<{ success: boolean; data: Todo }>('/todos', ...);
  return res.data;
}
```
