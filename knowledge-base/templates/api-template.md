# API 文档模板

## [API 名称]

### 基本信息
- **路径**: `POST /api/v1/resource`
- **描述**: API 功能描述
- **认证**: Bearer Token

### 请求

#### Headers
| 名称 | 类型 | 必填 | 描述 |
|-----|------|-----|------|
| Authorization | string | 是 | Bearer {token} |
| Content-Type | string | 是 | application/json |

#### Body
```json
{
  "field1": "string, 必填, 描述",
  "field2": 123
}
```

#### 参数说明
| 参数 | 类型 | 必填 | 描述 | 示例 |
|-----|------|-----|------|------|
| field1 | string | 是 | 描述 | "example" |
| field2 | number | 否 | 描述 | 123 |

### 响应

#### 成功响应 (200)
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "createdAt": "2024-01-01T00:00:00Z"
  },
  "message": "操作成功"
}
```

#### 错误响应

##### 400 Bad Request
```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "field1 is required"
  }
}
```

##### 401 Unauthorized
```json
{
  "success": false,
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Invalid token"
  }
}
```

### 示例

#### cURL
```bash
curl -X POST https://api.example.com/api/v1/resource \
  -H "Authorization: Bearer {token}" \
  -H "Content-Type: application/json" \
  -d '{"field1": "value"}'
```

#### TypeScript
```typescript
const response = await fetch('/api/v1/resource', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ field1: 'value' }),
});
```
