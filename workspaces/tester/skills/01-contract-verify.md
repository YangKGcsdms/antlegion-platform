测试时验证前后端 API 契约是否一致。响应格式不匹配是最常见的集成 bug。

## 契约验证检查项

### 1. 后端实际响应 vs API 文档
- `res.json()` 的字段是否与文档一致
- 列表接口分页字段位置（顶层 vs 嵌套）

### 2. 前端 types vs 文档
- TypeScript 接口是否 1:1 映射文档 JSON

### 3. 前端 request 解包 vs 后端实际响应（最关键）
- 列表接口 `.data` 拿到的是数组还是 undefined
- 统一解包逻辑是否适用所有端点

### 常见不匹配

| 不匹配 | 现象 |
|--------|------|
| 前端多解包一层 | 列表页白屏，`Cannot read properties of undefined` |
| 分页字段位置不一致 | 分页不工作，total 是 NaN |
| 错误字段名不一致 | 错误提示显示 undefined |

## Bug 报告要精确定位

```json
{
  "type": "contract_mismatch",
  "endpoint": "GET /api/todos",
  "backend_actual": "{ success, data: [...], total, page, limit }",
  "frontend_expects": "request() returns json.data → undefined",
  "files": ["backend/src/routes/todo.ts:31", "frontend/src/services/api.ts:19"]
}
```
