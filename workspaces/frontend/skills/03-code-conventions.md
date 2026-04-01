前端代码规范。写代码时遵循这些约定，保持一致性。

## 文件命名

- 页面组件：`PascalCase` + 功能后缀 → `TodoList.tsx`, `TodoForm.tsx`
- 通用组件：`PascalCase` → `Modal.tsx`, `Pagination.tsx`, `Toast.tsx`
- 服务/工具：`camelCase` → `api.ts`
- 类型：统一放 `types/index.ts`

## 组件规范

### Props 类型必须显式定义

```tsx
interface PaginationProps {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}

export function Pagination({ currentPage, totalPages, onPageChange }: PaginationProps) {
  // ...
}
```

### 状态放在最近需要它的组件

不要为了"万一以后需要"就把状态提升到顶层。列表页的 filter/page 状态就放在列表页里。

### 事件处理命名

```
handle{Event}       → handleSubmit, handleDelete, handlePageChange
on{Event}           → 作为 Props 传递的回调命名
```

## API 对接层规范

### request 函数的两个要点

1. **错误统一从 `json.message` 取**（与后端约定一致）
2. **列表和单条接口用不同的解包方式**

```typescript
// 通用请求
async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${url}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const json = await res.json();
  if (!res.ok || !json.success) {
    throw new Error(json.message || '请求失败');
  }
  return json as T;  // 返回完整 JSON，调用方按需取 .data
}
```

### 每个 API 函数的返回类型必须与后端文档一致

```typescript
// ✅ 返回完整响应，调用方知道结构
export async function getTodos(page: number): Promise<TodoListResponse> {
  return request<TodoListResponse>(`/todos?page=${page}&limit=10`);
}
// 调用方：const res = await getTodos(1); setTodos(res.data); setTotal(res.total);

// ✅ 单条接口可以解包
export async function createTodo(input: CreateInput): Promise<Todo> {
  const res = await request<{ success: boolean; data: Todo }>('/todos', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return res.data;
}
```

## UI 交互规范

### 加载状态

每个数据加载都要有 loading 态，用骨架屏或 spinner：

```tsx
if (loading) return (
  <div className="animate-pulse space-y-3">
    {[...Array(5)].map((_, i) => (
      <div key={i} className="h-12 bg-gray-200 rounded" />
    ))}
  </div>
);
```

### 空状态

列表为空时展示引导：

```tsx
if (items.length === 0) return (
  <div className="text-center py-12 text-gray-500">
    <p>暂无数据</p>
    <button onClick={onCreate} className="mt-2 text-blue-600">创建第一个</button>
  </div>
);
```

### 操作反馈

- 创建/更新/删除成功 → Toast 提示
- 失败 → Toast 错误提示 + 保留用户输入
- 删除 → 二次确认

### 表单验证

必填项在提交前客户端校验，不要全依赖后端：

```tsx
if (!form.title.trim()) {
  setErrors({ title: '标题不能为空' });
  return;
}
```

## 色彩系统

- 主操作：`blue-600`（按钮、链接、focus ring）
- 成功：`green-600`
- 警告：`yellow-600`
- 危险：`red-600`
- 文本主色：`gray-800`
- 文本辅助：`gray-500`
- 背景：`gray-50`（页面）、`white`（卡片）
- 边框：`gray-200`（默认）、`gray-300`（hover）
