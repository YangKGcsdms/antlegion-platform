写 React 组件时参照 UI 开发的 HTML 原型（`/shared/code/ui/`）。原型里有完整的 Tailwind class 和组件边界标注。

## 怎么用

1. 读 `/shared/code/ui/README.md` 了解页面清单
2. 找 `<!-- ====== COMPONENT: 名称 ====== -->` 标注，每个标注拆成一个 `.tsx`
3. Tailwind class 直接复制，不要重写

## 你发布什么事实

| 事实 | 何时发 | 谁需要 |
|------|--------|--------|
| `code.frontend.completed` | 代码写完后 | 测试据此开始 E2E |
| `bug.fixed` | 修完 bug 后 | 测试据此回归 |
