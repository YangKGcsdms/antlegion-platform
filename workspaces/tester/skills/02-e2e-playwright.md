你必须使用 Playwright 做 E2E 测试，不要再用裸 fetch 写手工断言脚本。Playwright 能测完整的用户流程：打开浏览器 → 操作页面 → 验证结果，比 API 瞎调靠谱得多。

## 为什么不用 fetch 手写测试

上一次你用 fetch 写了个 test-todo-crud-api.js，50 多个手写断言，看着全 PASS，但前端打开直接白屏。因为你只测了后端 API 返回值，没测前端能不能正确消费这些数据。E2E 测试直接在浏览器里跑，前后端一起验，才能真正发现问题。

## 测试项目结构

```
/workspace/e2e-tests/
├── package.json
├── playwright.config.ts
├── tests/
│   ├── {feature}.spec.ts     # 测试文件
│   └── helpers.ts            # 共享工具
└── test-results/             # Playwright 自动生成
```

## 初始化项目

每次拿到新的测试任务，先设置 E2E 环境：

```bash
# 1. 创建测试项目
mkdir -p /workspace/e2e-tests
cd /workspace/e2e-tests

# 2. 写 package.json
cat > package.json << 'EOF'
{
  "name": "e2e-tests",
  "private": true,
  "devDependencies": {
    "@playwright/test": "^1.49.0"
  },
  "scripts": {
    "test": "npx playwright test",
    "test:headed": "npx playwright test --headed"
  }
}
EOF

# 3. 安装 Playwright（只装 Chromium，Alpine 下够用）
npm install
npx playwright install chromium

# 4. 写配置
cat > playwright.config.ts << 'EOF'
import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests',
  timeout: 30000,
  retries: 1,
  use: {
    baseURL: 'http://localhost:5173',
    headless: true,
    screenshot: 'only-on-failure',
  },
  reporter: [['list'], ['json', { outputFile: 'test-results/results.json' }]],
});
EOF
```

## 启动被测应用

E2E 测试需要前后端同时运行：

```bash
# 1. 复制并启动后端
cp -r /shared/code/backend /workspace/backend-under-test
cd /workspace/backend-under-test
npm install
PORT=3001 node src/index.ts &   # 或 npx ts-node src/index.ts &
BACKEND_PID=$!

# 2. 复制并启动前端（dev server 带 proxy）
cp -r /shared/code/frontend /workspace/frontend-under-test
cd /workspace/frontend-under-test
npm install
npx vite --host 0.0.0.0 --port 5173 &
FRONTEND_PID=$!

# 3. 等待两个服务就绪
for i in $(seq 1 20); do
  wget -q -O /dev/null http://localhost:3001/api/todos 2>/dev/null && \
  wget -q -O /dev/null http://localhost:5173 2>/dev/null && break
  sleep 1
done
```

## 测试编写模式

### 标准 CRUD 测试

```typescript
import { test, expect } from '@playwright/test';

test.describe('Todo CRUD', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('页面能正常加载，不白屏', async ({ page }) => {
    // 最基本的检查：页面标题存在，没有 JS 错误
    await expect(page.locator('h1')).toBeVisible();
    // 确认没有"Cannot read properties of undefined"之类的崩溃
    await expect(page.locator('table, [class*="empty"]')).toBeVisible();
  });

  test('创建待办后列表中可见', async ({ page }) => {
    // 点击新建按钮
    await page.click('button:has-text("新建")');
    
    // 填写表单
    await page.fill('input[name="title"], input[placeholder*="标题"]', '测试待办');
    
    // 提交
    await page.click('button:has-text("提交"), button:has-text("保存"), button[type="submit"]');
    
    // 验证列表中出现
    await expect(page.locator('text=测试待办')).toBeVisible({ timeout: 5000 });
  });

  test('删除待办后从列表消失', async ({ page }) => {
    // 先创建一条
    // ...创建逻辑...
    
    // 点击删除
    page.on('dialog', dialog => dialog.accept());  // 处理 confirm 弹窗
    await page.click('button[title="删除"], button:has-text("删除")');
    
    // 验证消失
    await expect(page.locator('text=测试待办')).not.toBeVisible({ timeout: 5000 });
  });

  test('分页正常工作', async ({ page }) => {
    // 创建超过一页的数据
    // ...批量创建...
    
    await page.reload();
    
    // 验证分页控件存在且可交互
    const pagination = page.locator('[class*="pagination"], nav >> button');
    if (await pagination.count() > 0) {
      await pagination.last().click();
      await expect(page.locator('table tbody tr')).toHaveCount({ min: 1 });
    }
  });

  test('表单验证：空标题不能提交', async ({ page }) => {
    await page.click('button:has-text("新建")');
    await page.click('button:has-text("提交"), button[type="submit"]');
    
    // 应该有错误提示，不应该关闭 modal
    await expect(page.locator('text=/不能为空|required|必填/')).toBeVisible();
  });
});
```

### API 契约验证测试

除了 UI 测试，也要验证前后端数据传输链路：

```typescript
test.describe('API 契约验证', () => {
  test('列表接口：前端正确解析分页数据', async ({ page }) => {
    await page.goto('/');
    
    // 拦截 API 请求，检查前端如何处理响应
    const response = await page.waitForResponse(resp => 
      resp.url().includes('/api/todos') && resp.request().method() === 'GET'
    );
    
    const json = await response.json();
    
    // 后端确实返回了 data 数组和 total
    expect(json).toHaveProperty('success', true);
    expect(json).toHaveProperty('data');
    expect(Array.isArray(json.data)).toBe(true);
    expect(json).toHaveProperty('total');
    expect(typeof json.total).toBe('number');
    
    // 前端页面没崩溃，说明正确解析了
    await expect(page.locator('table, [class*="empty"]')).toBeVisible();
  });

  test('创建接口：提交后数据正确展示', async ({ page }) => {
    await page.goto('/');
    await page.click('button:has-text("新建")');
    
    const title = `E2E-${Date.now()}`;
    await page.fill('input[name="title"], input[placeholder*="标题"]', title);
    
    // 监听创建请求
    const [response] = await Promise.all([
      page.waitForResponse(resp => 
        resp.url().includes('/api/todos') && resp.request().method() === 'POST'
      ),
      page.click('button:has-text("提交"), button[type="submit"]'),
    ]);
    
    expect(response.status()).toBe(201);
    
    // 创建成功后，列表中能看到
    await expect(page.locator(`text=${title}`)).toBeVisible({ timeout: 5000 });
  });
});
```

## 运行测试

```bash
cd /workspace/e2e-tests
npx playwright test

# 失败时查看截图
ls test-results/
```

## 结果上报

测试完成后读取 `test-results/results.json`，提取通过/失败数，发布到 bus：

```bash
# 读取结果
node -e "
const r = require('./test-results/results.json');
const passed = r.suites.flatMap(s => s.specs).filter(s => s.ok).length;
const failed = r.suites.flatMap(s => s.specs).filter(s => !s.ok).length;
console.log(JSON.stringify({ passed, failed, total: passed + failed }));
"
```

## 测试优先级

1. **页面能加载不白屏** — 最基本的冒烟测试
2. **CRUD 完整流程** — 创建 → 查看 → 编辑 → 删除
3. **API 契约验证** — 拦截请求验证前后端数据格式一致
4. **分页和筛选** — 数据多了以后的交互
5. **表单验证** — 边界输入
6. **对抗性测试** — XSS、超长输入、特殊字符

前 3 个是必须的，后面的按时间做。

## Alpine 环境注意事项

容器是 node:22-alpine，Playwright 需要额外依赖。如果 `npx playwright install chromium` 报错缺依赖：

```bash
apk add --no-cache chromium nss freetype harfbuzz ca-certificates ttf-freefont
export PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium-browser
```

如果实在装不上 Playwright（Alpine 兼容问题），退回到 API 测试但必须用 Node.js test runner（node:test）而不是裸 fetch：

```typescript
import { describe, it } from 'node:test';
import assert from 'node:assert';
```
