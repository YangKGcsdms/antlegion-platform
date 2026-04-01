#!/bin/bash
# ══════════════════════════════════════════════════════════════════════════════
# AntLegion MVP 一键启动脚本
# 启动 Legion Bus + UI + 4个Agent（产品/后端/前端/测试）
# ══════════════════════════════════════════════════════════════════════════════

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

echo "============================================"
echo "  AntLegion Multi-Agent MVP 启动器"
echo "============================================"
echo ""

# ── 1. 检查环境 ──
if ! command -v docker &> /dev/null; then
  echo "[ERROR] 未安装 Docker，请先安装 Docker"
  exit 1
fi

if ! docker compose version &> /dev/null && ! docker-compose version &> /dev/null; then
  echo "[ERROR] 未安装 Docker Compose"
  exit 1
fi

# 选择 compose 命令
if docker compose version &> /dev/null 2>&1; then
  COMPOSE="docker compose"
else
  COMPOSE="docker-compose"
fi

# ── 2. 检查 .env ──
if [ ! -f .env ]; then
  echo ""
  echo "[ERROR] 缺少 .env 文件，请先配置 LLM API Key"
  echo ""
  echo "  执行以下命令创建配置文件："
  echo "    cp .env.example .env"
  echo ""
  echo "  然后编辑 .env，填入你的 LLM 配置："
  echo ""
  echo "  方式A — Anthropic："
  echo "    LLM_PROVIDER_TYPE=anthropic"
  echo "    ANTHROPIC_API_KEY=sk-ant-xxxxxx"
  echo "    LLM_MODEL=claude-sonnet-4-6-20250514"
  echo ""
  echo "  方式B — OpenAI 兼容（SiliconFlow/OpenRouter 等）："
  echo "    LLM_PROVIDER_TYPE=openai-compatible"
  echo "    LLM_BASE_URL=https://api.siliconflow.cn/v1"
  echo "    LLM_API_KEY=sk-xxxxxx"
  echo "    LLM_MODEL=Pro/MiniMaxAI/MiniMax-M2.5"
  echo ""
  exit 1
fi

# 安全读取 .env（跳过注释行和空行）
_env_get() {
  grep -E "^${1}=" .env 2>/dev/null | tail -1 | cut -d'=' -f2- | tr -d '"' | tr -d "'"
}

_PROVIDER_TYPE=$(_env_get LLM_PROVIDER_TYPE)
_ANTHROPIC_KEY=$(_env_get ANTHROPIC_API_KEY)
_LLM_KEY=$(_env_get LLM_API_KEY)
_LLM_BASE_URL=$(_env_get LLM_BASE_URL)
_LLM_MODEL=$(_env_get LLM_MODEL)

# 检查 API Key
if [ -z "$_ANTHROPIC_KEY" ] && [ -z "$_LLM_KEY" ]; then
  echo "[ERROR] .env 中未填写 API Key，请设置 LLM_API_KEY 或 ANTHROPIC_API_KEY"
  exit 1
fi

# openai-compatible 必须有 BASE_URL
if [ "$_PROVIDER_TYPE" = "openai-compatible" ] && [ -z "$_LLM_BASE_URL" ]; then
  echo "[ERROR] LLM_PROVIDER_TYPE=openai-compatible 时必须设置 LLM_BASE_URL"
  echo "  例如: LLM_BASE_URL=https://api.siliconflow.cn/v1"
  exit 1
fi

echo "  Provider: ${_PROVIDER_TYPE:-anthropic}  Model: ${_LLM_MODEL:-claude-sonnet-4-6-20250514}"

echo "[1/4] 检查环境... OK"

# ── 3. 创建共享输出目录 ──
echo "[2/4] 创建共享目录..."
mkdir -p shared-output/docs/api
mkdir -p shared-output/docs/components
mkdir -p shared-output/docs/quality
mkdir -p shared-output/requirements
mkdir -p shared-output/code/frontend
mkdir -p shared-output/code/backend
mkdir -p shared-output/tests/cases
mkdir -p shared-output/tests/bugs
mkdir -p knowledge-base/standards
mkdir -p knowledge-base/templates
mkdir -p knowledge-base/examples

# 确保工作空间存在
mkdir -p workspaces/product
mkdir -p workspaces/frontend
mkdir -p workspaces/backend
mkdir -p workspaces/tester

echo "  共享目录结构就绪"

# ── 4. 构建并启动（--build 确保每次用最新代码）──
echo "[3/3] 构建并启动所有服务（--build）..."
$COMPOSE up -d --build

echo ""
echo "============================================"
echo "  启动完成！"
echo "============================================"
echo ""
echo "  服务地址："
echo "    Bus API:    http://localhost:28080"
echo "    Dashboard:  http://localhost:3000"
echo ""
echo "  Agent 状态："

# 等待 bus 就绪
echo -n "  等待 Bus 就绪"
for i in $(seq 1 30); do
  if curl -s http://localhost:28080/health > /dev/null 2>&1; then
    echo " OK"
    break
  fi
  echo -n "."
  sleep 2
done

echo ""
echo "  查看日志:     $COMPOSE logs -f"
echo "  查看Agent:    curl http://localhost:28080/ants | jq"
echo "  停止服务:     $COMPOSE down"
echo ""
echo "  发布任务:     ./submit-task.sh"
echo ""
