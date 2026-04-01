你的技术栈是 React 18 + TypeScript + Vite + Tailwind CSS。这个 skill 包含项目骨架和关键模式，写代码时直接参照。

## 项目骨架

```
/shared/code/frontend/
├── package.json
├── tsconfig.json
├── vite.config.ts
├── tailwind.config.js
├── postcss.config.js
├── index.html
├── src/
│   ├── main.tsx          # ReactDOM.createRoot
│   ├── App.tsx           # BrowserRouter + Routes
│   ├── index.css         # @tailwind base/components/utilities
│   ├── pages/
│   │   └── {Resource}List.tsx
│   ├── components/
│   │   ├── Modal.tsx
│   │   ├── Pagination.tsx
│   │   └── Toast.tsx
│   ├── services/
│   │   └── api.ts        # fetch 封装（必须基于 API 文档）
│   └── types/
│       └── index.ts      # 所有接口类型
```

## vite.config.ts

开发时反向代理后端 API，避免 CORS 问题：

```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
});
```

有了 proxy，`services/api.ts` 里用相对路径 `/api` 就行，不要硬编码 `http://localhost:3001`：

```typescript
const API_BASE = '/api';  // ✅ 用相对路径，让 Vite proxy 处理
```

## React 组件模式

### 列表页（标准模板）

```tsx
import { useState, useEffect, useCallback } from 'react';

export function TodoList() {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);

  const fetchTodos = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getTodos(page);
      setTodos(res.data);     // ← 这里的字段名必须与 API 文档一致
      setTotal(res.total);    // ← 同上
    } catch (err) {
      // 错误处理
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => { fetchTodos(); }, [fetchTodos]);

  if (loading) return <LoadingSkeleton />;
  if (todos.length === 0) return <EmptyState />;
  return <Table data={todos} />;
}
```

### 表单（受控组件 + zod 校验）

```tsx
const [form, setForm] = useState({ title: '', description: '' });
const [errors, setErrors] = useState<Record<string, string>>({});

function handleChange(field: string, value: string) {
  setForm(prev => ({ ...prev, [field]: value }));
  setErrors(prev => ({ ...prev, [field]: '' }));  // 清除错误
}

async function handleSubmit(e: React.FormEvent) {
  e.preventDefault();
  if (!form.title.trim()) {
    setErrors({ title: '标题不能为空' });
    return;
  }
  await createTodo(form);
}
```

## Tailwind CSS 速查

### 布局

```
flex items-center justify-between    # 水平两端对齐
flex flex-col gap-4                  # 垂直排列，间距 16px
grid grid-cols-2 gap-4              # 两列网格
max-w-6xl mx-auto px-4             # 居中容器
```

### 组件样式

```
# 卡片
bg-white rounded-lg shadow p-6

# 按钮-主要
px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors

# 按钮-危险
px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors

# 输入框
w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500

# 状态徽章
px-2 py-1 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800

# 表格行悬停
hover:bg-gray-50 transition-colors
```

### 响应式断点

```
sm:  640px   (手机横屏)
md:  768px   (平板)
lg:  1024px  (笔记本)
xl:  1280px  (桌面)
```

## package.json

```json
{
  "dependencies": {
    "react": "^18.3.0",
    "react-dom": "^18.3.0",
    "react-router-dom": "^6.28.0"
  },
  "devDependencies": {
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.0",
    "autoprefixer": "^10.4.0",
    "postcss": "^8.4.0",
    "tailwindcss": "^3.4.0",
    "typescript": "^5.7.0",
    "vite": "^6.0.0"
  }
}
```

## 不要做的事

- 不要引入 Redux/Zustand（用 useState/useReducer）
- 不要引入 axios（用 fetch）
- 不要写 CSS 文件（用 Tailwind）
- 不要写单元测试（测试由 QA agent 负责）
- 不要硬编码后端地址（用 Vite proxy + 相对路径）
- 不要创建 .env 文件
