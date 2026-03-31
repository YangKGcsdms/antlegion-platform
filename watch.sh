#!/bin/bash
# ══════════════════════════════════════════════════════════════════════════════
# AntLegion MVP 状态监控脚本
# 实时查看多智能体系统的运行状态和产出
# ══════════════════════════════════════════════════════════════════════════════

BUS_URL="${BUS_URL:-http://localhost:28080}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

clear
echo -e "${CYAN}════════════════════════════════════════════════════════${NC}"
echo -e "${CYAN}  AntLegion Multi-Agent MVP — 状态面板${NC}"
echo -e "${CYAN}  $(date '+%Y-%m-%d %H:%M:%S')${NC}"
echo -e "${CYAN}════════════════════════════════════════════════════════${NC}"
echo ""

# ── Bus 状态 ──
echo -e "${BLUE}[Bus 状态]${NC}"
HEALTH=$(curl -s "$BUS_URL/health" 2>/dev/null)
if [ -n "$HEALTH" ]; then
  echo -e "  状态: ${GREEN}在线${NC}"
else
  echo -e "  状态: ${RED}离线${NC}"
  exit 1
fi

STATS=$(curl -s "$BUS_URL/stats" 2>/dev/null)
if [ -n "$STATS" ]; then
  echo "  $STATS" | python3 -c "
import sys,json
s = json.load(sys.stdin)
print(f\"  Facts: {s.get('total_facts', 0)}  Ants: {s.get('total_ants', 0)}\")
" 2>/dev/null || true
fi
echo ""

# ── Agent 状态 ──
echo -e "${BLUE}[Agent 连接]${NC}"
curl -s "$BUS_URL/ants" | python3 -c "
import sys, json
ants = json.load(sys.stdin)
if not ants:
    print('  (无 Agent 连接)')
for a in ants:
    state_icon = '🟢' if a['state'] == 'idle' else '🔵' if a['state'] == 'busy' else '⚪'
    print(f\"  {state_icon} {a['name']:20s} state={a['state']:8s} reliability={a.get('reliability_score', 0):.1f}\")
" 2>/dev/null || echo "  (无法获取)"
echo ""

# ── Facts 概览 ──
echo -e "${BLUE}[最近 Facts]${NC}"
curl -s "$BUS_URL/facts?limit=15" | python3 -c "
import sys, json
facts = json.load(sys.stdin)
if not facts:
    print('  (无 Facts)')
for f in facts:
    state = f.get('state', '?')
    icon = {'published': '📤', 'claimed': '🔒', 'resolved': '✅', 'dead': '💀'}.get(state, '❓')
    ft = f.get('fact_type', '?')
    src = f.get('source_ant_id', '?')[:8]
    print(f\"  {icon} [{state:10s}] {ft:30s} by={src}...\")
" 2>/dev/null || echo "  (无法获取)"
echo ""

# ── 产出文件 ──
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
echo -e "${BLUE}[产出文件 — shared-output/]${NC}"
if [ -d "$SCRIPT_DIR/shared-output" ]; then
  find "$SCRIPT_DIR/shared-output" -type f -name "*.md" -o -name "*.ts" -o -name "*.tsx" -o -name "*.json" -o -name "*.sql" -o -name "*.sh" -o -name "*.css" -o -name "*.html" 2>/dev/null | while read f; do
    REL=$(echo "$f" | sed "s|$SCRIPT_DIR/shared-output/||")
    SIZE=$(wc -c < "$f" | tr -d ' ')
    echo "  📄 $REL  (${SIZE}B)"
  done
  FILE_COUNT=$(find "$SCRIPT_DIR/shared-output" -type f 2>/dev/null | wc -l | tr -d ' ')
  echo "  ── 共 $FILE_COUNT 个文件"
else
  echo "  (目录不存在)"
fi
echo ""
echo -e "${CYAN}════════════════════════════════════════════════════════${NC}"
echo "  Dashboard: http://localhost:3000"
echo "  实时日志:  docker compose logs -f ant-product ant-backend ant-frontend ant-tester"
echo -e "${CYAN}════════════════════════════════════════════════════════${NC}"
