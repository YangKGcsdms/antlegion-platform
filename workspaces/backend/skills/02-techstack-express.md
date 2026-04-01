你的技术栈是 Express.js + TypeScript + better-sqlite3。这个 skill 包含关键 API 和容易踩的坑，写代码时直接参照，不用反复查文档。

## Express 项目结构标准

```
/shared/code/backend/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts              # app 入口，挂载路由和中间件
│   ├── db/
│   │   └── setup.ts          # better-sqlite3 初始化 + 建表
│   ├── routes/
│   │   └── {resource}.ts     # Router 导出，一个资源一个文件
│   ├── services/
│   │   └── {resource}.ts     # 纯业务逻辑，不碰 req/res
│   ├── types/
│   │   └── index.ts          # 所有接口类型
│   └── middleware/
│       ├── error.ts          # 全局错误处理
│       └── validate.ts       # zod 校验中间件
```

## better-sqlite3 关键 API

better-sqlite3 是**同步**的，不是 Promise，不要 await。

```typescript
import Database from 'better-sqlite3';

const db = new Database('/data/app.db');
db.pragma('journal_mode = WAL');  // 并发读写性能

// 建表
db.exec(`
  CREATE TABLE IF NOT EXISTS todos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT DEFAULT '',
    status TEXT DEFAULT 'pending' CHECK(status IN ('pending','in_progress','completed')),
    priority TEXT DEFAULT 'medium' CHECK(priority IN ('low','medium','high')),
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )
`);

// 查一条
const row = db.prepare('SELECT * FROM todos WHERE id = ?').get(id);

// 查多条
const rows = db.prepare('SELECT * FROM todos LIMIT ? OFFSET ?').all(limit, offset);

// 计数
const { total } = db.prepare('SELECT COUNT(*) as total FROM todos').get() as { total: number };

// 插入
const info = db.prepare('INSERT INTO todos (title, description) VALUES (?, ?)').run(title, desc);
// info.lastInsertRowid 是新行 ID（bigint 类型，用 Number() 转）
const newId = Number(info.lastInsertRowid);

// 更新
const info = db.prepare('UPDATE todos SET title = ? WHERE id = ?').run(newTitle, id);
// info.changes 是影响行数

// 删除
const info = db.prepare('DELETE FROM todos WHERE id = ?').run(id);
```

### 常见坑

1. **lastInsertRowid 是 bigint** — 必须 `Number(info.lastInsertRowid)` 转换，否则 JSON.stringify 会报错
2. **datetime('now') 只能在 SQL 里用** — 不能放在 JS 侧当默认值
3. **没有 db.run()** — better-sqlite3 用 `prepare().run()`，不是 `db.run(sql, params)`
4. **prepare 返回 Statement** — `.get()` 单条, `.all()` 多条, `.run()` 写操作
5. **参数是位置参数** — `prepare('... WHERE id = ?').get(id)`，不是对象

## Express 路由模式

```typescript
import { Router, Request, Response } from 'express';
const router = Router();

// 列表（带分页）
router.get('/', (req: Request, res: Response) => {
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 10));
  const offset = (page - 1) * limit;
  
  const data = db.prepare('SELECT * FROM todos LIMIT ? OFFSET ?').all(limit, offset);
  const { total } = db.prepare('SELECT COUNT(*) as total FROM todos').get() as { total: number };
  
  res.json({ success: true, data, total, page, limit });
});

// 详情
router.get('/:id', (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ success: false, message: 'Invalid ID' });
  
  const row = db.prepare('SELECT * FROM todos WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ success: false, message: 'Not found' });
  
  res.json({ success: true, data: row });
});

export default router;
```

## Zod 校验

```typescript
import { z } from 'zod';

const createSchema = z.object({
  title: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  status: z.enum(['pending', 'in_progress', 'completed']).optional(),
  priority: z.enum(['low', 'medium', 'high']).optional(),
});

// 中间件
function validate(schema: z.ZodSchema) {
  return (req: Request, res: Response, next: Function) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: result.error.issues.map(i => ({ field: i.path.join('.'), message: i.message })),
      });
    }
    req.body = result.data;
    next();
  };
}
```

## package.json 依赖

```json
{
  "dependencies": {
    "express": "^4.21.0",
    "better-sqlite3": "^11.7.0",
    "cors": "^2.8.5",
    "zod": "^3.24.0"
  },
  "devDependencies": {
    "@types/express": "^5.0.0",
    "@types/better-sqlite3": "^7.6.12",
    "@types/cors": "^2.8.17",
    "typescript": "^5.7.0",
    "ts-node": "^10.9.0"
  },
  "scripts": {
    "dev": "ts-node src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js"
  }
}
```

## tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "declaration": true
  },
  "include": ["src"]
}
```
