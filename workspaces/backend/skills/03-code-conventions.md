后端代码规范。写代码时遵循这些约定，保持一致性。

## 响应格式（铁律）

所有端点统一响应格式，前端依赖这个结构：

```typescript
// 成功 - 单条
{ success: true, data: { ... }, message?: "..." }

// 成功 - 列表（分页字段在顶层，不要嵌套进 data）
{ success: true, data: [ ... ], total: number, page: number, limit: number }

// 错误
{ success: false, message: "描述", errors?: [{ field, message }] }
```

**分页字段 total/page/limit 必须在顶层**，不要包在 data 对象里。这是和前端的契约。

## 服务层分离

路由层只做：参数解析 → 调服务 → 格式化响应。业务逻辑全部在 services/ 里。

```typescript
// ✅ 正确：路由层薄，服务层厚
router.post('/', validate(createSchema), (req, res) => {
  const todo = TodoService.create(req.body);
  res.status(201).json({ success: true, data: todo });
});

// ❌ 错误：路由层里写 SQL
router.post('/', (req, res) => {
  const stmt = db.prepare('INSERT INTO ...');
  // 不要在这里写数据库操作
});
```

## 错误处理

全局错误中间件兜底，路由里不需要 try-catch 每一行：

```typescript
// middleware/error.ts
app.use((err: Error, req: Request, res: Response, next: Function) => {
  console.error(err.stack);
  res.status(500).json({ success: false, message: 'Internal server error' });
});
```

业务错误直接返回对应状态码，不要抛异常：

```typescript
if (!row) return res.status(404).json({ success: false, message: 'Not found' });
```

## 数据库路径

SQLite 数据库文件放在 `/data/` 目录（Docker volume 挂载点），不要放在代码目录：

```typescript
const DB_PATH = process.env.DB_PATH || '/data/app.db';
```

如果 `/data/` 不存在（本地开发），fallback 到 `./data/app.db`。

## 端口

默认 3001，可通过环境变量覆盖：

```typescript
const PORT = parseInt(process.env.PORT || '3001', 10);
```

## CORS

开发阶段全开：

```typescript
import cors from 'cors';
app.use(cors());
```

## 不要做的事

- 不要用 ORM（就用 better-sqlite3 直接写 SQL）
- 不要引入 Redis/MongoDB（用 SQLite）
- 不要搞微服务（单个 Express app）
- 不要写单元测试（测试由 QA agent 负责）
- 不要创建 .env 文件（环境变量由 Docker 传入）
