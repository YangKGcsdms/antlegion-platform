#!/bin/bash
# ══════════════════════════════════════════════════════════════════════════════
# AntLegion MVP 任务发布脚本
# 向 Legion Bus 发布一个需求 fact，触发多智能体协作流水线
#
# 用法:
#   ./submit-task.sh                     # 使用内置的 CRUD Demo 任务
#   ./submit-task.sh "你的需求描述"        # 自定义需求
#   ./submit-task.sh --file task.md      # 从文件读取需求
# ══════════════════════════════════════════════════════════════════════════════

set -e

BUS_URL="${BUS_URL:-http://localhost:28080}"

# ── 颜色定义 ──
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# ── 检查 Bus 是否可用 ──
echo -e "${BLUE}[检查] 连接 Legion Bus ($BUS_URL)...${NC}"
if ! curl -s "$BUS_URL/health" > /dev/null 2>&1; then
  echo -e "${RED}[ERROR] Legion Bus 未运行，请先执行 ./start.sh${NC}"
  exit 1
fi
echo -e "${GREEN}[OK] Bus 在线${NC}"

# ── 检查 Agent 连接数 ──
ANT_COUNT=$(curl -s "$BUS_URL/ants" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))" 2>/dev/null || echo "0")
echo -e "${BLUE}[INFO] 当前连接 Agent 数: ${ANT_COUNT}${NC}"

if [ "$ANT_COUNT" -lt 1 ]; then
  echo -e "${YELLOW}[WARN] 没有 Agent 在线，任务可能无法被处理${NC}"
  echo -e "${YELLOW}       请先运行 ./start.sh 并等待 Agent 连接${NC}"
fi

# ── 确定需求内容 ──
if [ "$1" = "--file" ] && [ -n "$2" ]; then
  # 从文件读取
  if [ ! -f "$2" ]; then
    echo -e "${RED}[ERROR] 文件不存在: $2${NC}"
    exit 1
  fi
  REQUIREMENT=$(cat "$2")
  FEATURE_NAME=$(basename "$2" .md | tr '[:upper:]' '[:lower:]' | tr ' ' '-')
elif [ -n "$1" ]; then
  # 从命令行参数
  REQUIREMENT="$1"
  FEATURE_NAME="custom-feature"
else
  # ── 默认: CRUD Demo 任务 ──
  FEATURE_NAME="todo-crud"
  REQUIREMENT='开发一个 Todo 待办事项管理系统的前后端 CRUD 应用。

## 功能需求

### 数据模型 - Todo
- id: 自增主键
- title: 标题（必填，最大100字符）
- description: 描述（可选，最大500字符）
- status: 状态（pending/in_progress/completed，默认pending）
- priority: 优先级（low/medium/high，默认medium）
- created_at: 创建时间
- updated_at: 更新时间

### API 端点
1. GET /api/todos - 获取待办列表（支持分页 ?page=1&limit=10，支持按status筛选）
2. GET /api/todos/:id - 获取单个待办详情
3. POST /api/todos - 创建新待办
4. PUT /api/todos/:id - 更新待办
5. DELETE /api/todos/:id - 删除待办

### 前端页面
1. 待办列表页 - 表格展示，支持分页，可按状态筛选，有新建/编辑/删除操作
2. 新建/编辑表单 - 模态框形式，表单验证
3. 状态切换 - 可直接在列表中切换待办状态

### 技术要求
- 后端: Node.js + Express + SQLite + TypeScript
- 前端: React + TypeScript + Tailwind CSS + Vite
- 后端端口: 3001
- 前端端口: 5173

### 验收标准
- [ ] 能创建待办，必填字段验证生效
- [ ] 能查看待办列表，分页正常
- [ ] 能编辑待办的所有字段
- [ ] 能删除待办
- [ ] 能按状态筛选
- [ ] 前端有加载状态和错误提示
- [ ] API 有统一错误处理'
fi

echo ""
echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  发布需求: ${FEATURE_NAME}${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# ── 先注册一个临时 ant 用于发布 fact ──
echo -e "${BLUE}[1/3] 注册任务发布者...${NC}"
CONNECT_RESP=$(curl -s -X POST "$BUS_URL/ants/connect" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "task-submitter",
    "description": "外部任务发布者",
    "capability_offer": ["task-submission"],
    "domain_interests": ["requirement"],
    "fact_type_patterns": ["*"]
  }')

ANT_ID=$(echo "$CONNECT_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin)['ant_id'])" 2>/dev/null)
TOKEN=$(echo "$CONNECT_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('token',''))" 2>/dev/null)

if [ -z "$ANT_ID" ]; then
  echo -e "${RED}[ERROR] 注册失败: $CONNECT_RESP${NC}"
  exit 1
fi
echo -e "${GREEN}[OK] 发布者 ID: ${ANT_ID}${NC}"

# ── 发布 requirement.submitted fact (DDD 入口事实) ──
echo -e "${BLUE}[2/3] 发布需求 fact (requirement.submitted)...${NC}"

# 转义JSON中的特殊字符
PAYLOAD_JSON=$(python3 -c "
import json, sys
req = sys.stdin.read()
payload = {
    'feature_name': '$FEATURE_NAME',
    'requirement': req,
    'output_dirs': {
        'docs': '/shared/docs/',
        'requirements': '/shared/requirements/',
        'backend_code': '/shared/code/',
        'frontend_code': '/shared/code/',
        'tests': '/shared/tests/',
        'api_docs': '/shared/docs/api/'
    }
}
print(json.dumps(payload))
" <<< "$REQUIREMENT")

FACT_RESP=$(curl -s -X POST "$BUS_URL/facts" \
  -H "Content-Type: application/json" \
  -d "{
    \"fact_type\": \"requirement.submitted\",
    \"semantic_kind\": \"observation\",
    \"payload\": $PAYLOAD_JSON,
    \"domain_tags\": [\"requirement\", \"$FEATURE_NAME\"],
    \"need_capabilities\": [\"requirement-analysis\"],
    \"priority\": 5,
    \"mode\": \"exclusive\",
    \"source_ant_id\": \"$ANT_ID\",
    \"token\": \"$TOKEN\",
    \"ttl_seconds\": 3600
  }")

FACT_ID=$(echo "$FACT_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('fact_id',''))" 2>/dev/null)

if [ -z "$FACT_ID" ]; then
  echo -e "${RED}[ERROR] 发布失败: $FACT_RESP${NC}"
  exit 1
fi

echo -e "${GREEN}[OK] Fact ID: ${FACT_ID}${NC}"

# ── 断开临时连接 ──
echo -e "${BLUE}[3/3] 清理临时连接...${NC}"
curl -s -X POST "$BUS_URL/ants/$ANT_ID/disconnect" \
  -H "Content-Type: application/json" \
  -d "{\"token\": \"$TOKEN\"}" > /dev/null 2>&1

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  需求已发布！多智能体流水线已触发${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo "  DDD 事实流（5域自发协作）："
echo "  1. [产品·需求域]   claim requirement.submitted → 写PRD → prd.published"
echo "  2. [UI·设计域]     感知 prd.published → 出HTML原型 → design.published"
echo "  3. [后端·后端域]   感知 prd.published → API契约 → api.published → backend.done"
echo "  4. [前端·前端域]   等待 design.published + api.published → 实现 → frontend.done"
echo "  5. [测试·质量域]   等待 backend.done + frontend.done → 测试 → quality.approved"
echo "  6. [产品·需求域]   感知 quality.approved → release.approved (终态)"
echo ""
echo "  监控："
echo "    Dashboard:  http://localhost:3000"
echo "    查看Facts:  curl $BUS_URL/facts | python3 -m json.tool"
echo "    查看Agents: curl $BUS_URL/ants | python3 -m json.tool"
echo "    实时日志:   docker compose logs -f"
echo ""
echo "  产出文件（在 ./shared-output/ 目录下）："
echo "    docs/prd-${FEATURE_NAME}.md      — PRD文档"
echo "    requirements/${FEATURE_NAME}.md  — 需求规格"
echo "    docs/api/                        — API文档"
echo "    code/backend/                    — 后端代码"
echo "    code/frontend/                   — 前端代码"
echo "    tests/cases/                     — 测试用例"
echo "    tests/                           — 测试脚本"
echo "    docs/quality/                    — 质量报告"
echo ""
