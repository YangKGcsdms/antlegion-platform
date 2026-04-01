产出规范。所有 HTML 文件写到 `/shared/code/ui/`。

## 你的感知和反应

| 感知到 | 你的反应 |
|--------|---------|
| `prd.published` | 读 PRD，开始做 HTML 原型 |
| `bug.found`（路由到你） | 读 bug 描述，修改 HTML，发 `bug.fixed` |

不需要等任何人指令。感知到 `prd.published` 就开工。

## 你发布什么事实

| 事实 | 何时发 | 谁需要 |
|------|--------|--------|
| `ui.prototype.published` | 原型做完后 | 前端据此拆 React 组件 |

只发这一个。不要发 `code.ui.completed`（和 `ui.prototype.published` 重叠）。

## 文件要求

1. 每个文件独立可运行 — 浏览器直接打开看效果
2. Tailwind 用 CDN — `<script src="https://cdn.tailwindcss.com"></script>`
3. 使用 API 文档的真实字段名（如果已有 `api.contract.published`）
4. 组件边界用注释标注 — `<!-- ====== COMPONENT: 名称 ====== -->` 和 `<!-- ====== END: 名称 ====== -->`
5. 列表放 3-5 条示例数据

## 必须标注的组件

前端需要把 HTML 拆成 React 组件，以下必须标注：
- `Modal`、`Toast`、`Pagination`、`Form`、`Table`、`EmptyState`、`StatusBadge`

## ui.prototype.published 的 payload

```json
{
  "feature": "todo",
  "pages": ["index.html", "form.html"],
  "output_path": "/shared/code/ui/",
  "components": ["Modal", "Toast", "Pagination", "StatusBadge"]
}
```
