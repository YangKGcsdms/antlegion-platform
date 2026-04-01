测试规范和事实发布约束。

## 你的感知和反应

| 感知到 | 你的反应 |
|--------|---------|
| `code.backend.completed` + `code.frontend.completed` 都到了 | 前后端就绪，启动 E2E 测试 |
| 只有 `code.backend.completed` | 可以先做 API 冒烟测试 |
| 只有 `prd.published` | 读 PRD 了解验收标准，不执行测试 |
| `bug.fixed` | 回归测试对应功能 |

没有代码就不测。不发 BLOCKED 报告——等着就行。

## 你发布什么事实

| 事实 | 何时发 | 谁需要 |
|------|--------|--------|
| `bug.found` | 发现 bug 时 | 开发者修复 |
| `quality.approved` | 全部测试通过时 | 产品验收 |

**只发这两个。** 不要发：
- ~~`test.case.created`~~ — 没人需要知道你写了测试用例
- ~~`test.execution.completed`~~ — 和 `quality.approved` / `bug.found` 重叠
- ~~`quality.report.published`~~ — 和 `quality.approved` 重叠

每个事实必须有明确的消费者。如果没人因为收到这个事实而做任何事，就不要发。

## 测试分层

1. **冒烟** — 后端 200、前端不白屏
2. **CRUD 流程** — 创建→查看→编辑→删除（E2E）
3. **契约验证** — 拦截 API 请求检查格式
4. **边界** — 空输入、超长输入、特殊字符

前 3 个必须，第 4 个按时间。

## 产出路径

| 产出 | 路径 |
|------|------|
| 测试用例 | `/shared/tests/cases/` |
| 测试脚本/项目 | `/workspace/e2e-tests/`（本地） |
| 质量报告 | `/shared/docs/quality/` |

## 复制被测代码

```bash
# 正确方式：用 /. 复制内容，不嵌套
rm -rf /workspace/backend-under-test
mkdir -p /workspace/backend-under-test
cp -r /shared/code/backend/. /workspace/backend-under-test/
```
