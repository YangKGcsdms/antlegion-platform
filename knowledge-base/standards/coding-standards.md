# 编码规范

## 通用规范

### 命名约定
- **文件名**: kebab-case (`user-profile.ts`)
- **类名**: PascalCase (`UserProfile`)
- **函数/变量**: camelCase (`getUserProfile`)
- **常量**: SCREAMING_SNAKE_CASE (`MAX_RETRY_COUNT`)
- **类型/接口**: PascalCase，接口不加 `I` 前缀

### 注释规范
- 代码应该自解释，避免无意义注释
- 复杂逻辑需要注释说明"为什么"
- 公共 API 需要 JSDoc/docstring

## TypeScript/JavaScript

```typescript
// 使用 const 优先
const value = 'immutable';

// 明确类型
function process(input: string): Result {
  // ...
}

// 使用可选链和空值合并
const name = user?.profile?.name ?? 'Anonymous';

// 避免 any，使用 unknown
function parse(data: unknown): ParsedData {
  // 类型守卫
}
```

## Python

```python
# 类型注解
def process(input: str) -> Result:
    pass

# 使用 dataclass
@dataclass
class User:
    id: int
    name: str

# 异步优先
async def fetch_data() -> Data:
    pass
```

## Git 提交规范

```
<type>(<scope>): <subject>

<body>

<footer>
```

Types: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`
