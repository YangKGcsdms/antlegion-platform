<script setup lang="ts">
import { ref, reactive, onMounted, onUnmounted, computed } from "vue";
import { api } from "../api/client";
import type { Ant } from "../api/client";
import { useI18n } from "../i18n";

const { t } = useI18n();

// ---------------------------------------------------------------------------
// Agent session port mapping (docker-compose host-mapped ports)
// ---------------------------------------------------------------------------
const AGENT_SESSION_PORTS: Record<string, number> = {
  "product-manager": 9091,
  "backend-developer": 9092,
  "frontend-developer": 9093,
  "qa-tester": 9094,
  "ui-developer": 9095,
};

function getSessionUrl(antName: string): string | null {
  const port = AGENT_SESSION_PORTS[antName];
  if (!port) return null;
  return `http://localhost:${port}/session/api`;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface SessionMessage {
  idx: number;
  role: string;
  type: string;
  text?: string;
  blocks?: Array<{
    type: string;
    text?: string;
    name?: string;
    input?: unknown;
    content?: string;
    is_error?: boolean;
  }>;
}

interface SessionData {
  antId: string;
  name: string;
  role: string;
  connected: boolean;
  uptime: number;
  ticks: number;
  activeClaims: string[];
  estimatedTokens: number;
  messageCount: number;
  messages: SessionMessage[];
  timestamp: number;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
const ants = ref<Ant[]>([]);
const sessions = reactive<Record<string, SessionData | null>>({});
const sessionErrors = reactive<Record<string, string>>({});
const loading = ref(true);
let refreshTimer: ReturnType<typeof setInterval> | null = null;

// Expanded session panel (ant_id or null)
const expandedAnt = ref<string | null>(null);

async function loadAnts() {
  try {
    ants.value = await api.getAnts();
  } catch { ants.value = []; }
  loading.value = false;
}

async function loadSession(ant: Ant) {
  const url = getSessionUrl(ant.name);
  if (!url) {
    sessionErrors[ant.ant_id] = "no port mapping";
    return;
  }
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    sessions[ant.ant_id] = await res.json() as SessionData;
    delete sessionErrors[ant.ant_id];
  } catch (err) {
    sessionErrors[ant.ant_id] = err instanceof Error ? err.message : "fetch failed";
    sessions[ant.ant_id] = null;
  }
}

async function loadAllSessions() {
  await Promise.allSettled(ants.value.map(loadSession));
}

async function refreshAll() {
  await loadAnts();
  await loadAllSessions();
}

// Pagination: 3 rows × 2 cols = 6 per page
const PAGE_SIZE = 6;
const page = ref(0);
const totalPages = computed(() => Math.max(1, Math.ceil(ants.value.length / PAGE_SIZE)));
const visibleAnts = computed(() => ants.value.slice(page.value * PAGE_SIZE, (page.value + 1) * PAGE_SIZE));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function ago(ts: number): string {
  const s = Math.floor(Date.now() / 1000 - ts);
  if (s < 60) return `${s}${t("time.sAgo")}`;
  if (s < 3600) return `${Math.floor(s / 60)}${t("time.mAgo")}`;
  return `${Math.floor(s / 3600)}${t("time.hAgo")}`;
}

function formatUptime(sec: number): string {
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ${sec % 60}s`;
  return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`;
}

function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}K`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

const stateDot: Record<string, string> = {
  active: "bg-emerald-400", degraded: "bg-yellow-400", isolated: "bg-red-400", offline: "bg-gray-500",
};
const stateColor: Record<string, string> = {
  active: "text-emerald-400", degraded: "text-yellow-400", isolated: "text-red-400", offline: "text-gray-500",
};
const phaseLabel: Record<string, string> = {
  idle: "Idle", tick_handlers: "Handlers", sense: "Sensing", triage: "Triaging", format: "Formatting", llm_run: "LLM Running",
};

function toggleExpand(antId: string) {
  expandedAnt.value = expandedAnt.value === antId ? null : antId;
}

/** Get last N meaningful messages for compact view */
function getRecentMessages(antId: string, count = 6): SessionMessage[] {
  const s = sessions[antId];
  if (!s?.messages) return [];
  return s.messages.slice(-count);
}

/** Summarize a message for the compact activity stream */
function summarizeMessage(msg: SessionMessage): { icon: string; color: string; text: string } {
  if (msg.role === "user") {
    const text = msg.text || (msg.blocks?.find(b => b.type === "text")?.text) || "";
    const preview = text.slice(0, 80).replace(/\n/g, " ");
    return { icon: "U", color: "text-blue-400", text: preview || "[user message]" };
  }
  if (msg.role === "assistant") {
    if (msg.type === "blocks" && msg.blocks) {
      const toolUse = msg.blocks.find(b => b.type === "tool_use");
      if (toolUse) {
        return { icon: "T", color: "text-yellow-400", text: `${toolUse.name}(${JSON.stringify(toolUse.input ?? {}).slice(0, 60)})` };
      }
      const textBlock = msg.blocks.find(b => b.type === "text");
      if (textBlock?.text) {
        return { icon: "A", color: "text-emerald-400", text: textBlock.text.slice(0, 80).replace(/\n/g, " ") };
      }
    }
    const text = msg.text || "";
    return { icon: "A", color: "text-emerald-400", text: text.slice(0, 80).replace(/\n/g, " ") || "[assistant]" };
  }
  return { icon: "?", color: "text-gray-500", text: "[unknown]" };
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------
onMounted(() => {
  refreshAll();
  refreshTimer = setInterval(refreshAll, 4000);
});
onUnmounted(() => {
  if (refreshTimer) clearInterval(refreshTimer);
});
</script>

<template>
  <div>
    <!-- Header -->
    <div class="flex items-center justify-between mb-6">
      <h1 class="text-2xl font-bold">{{ t("kanban.title") }}</h1>
      <div class="flex items-center gap-3">
        <div v-if="totalPages > 1" class="flex items-center gap-2 text-sm text-gray-400">
          <button @click="page = Math.max(0, page - 1)" :disabled="page === 0"
            class="px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded disabled:opacity-30 transition-colors">&lt;</button>
          <span>{{ page + 1 }}/{{ totalPages }}</span>
          <button @click="page = Math.min(totalPages - 1, page + 1)" :disabled="page >= totalPages - 1"
            class="px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded disabled:opacity-30 transition-colors">&gt;</button>
        </div>
        <button @click="refreshAll" class="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-sm transition-colors">
          {{ t("common.refresh") }}
        </button>
      </div>
    </div>

    <div v-if="loading" class="text-gray-400">{{ t("common.loading") }}</div>
    <div v-else-if="ants.length === 0" class="text-center text-gray-500 py-12">{{ t("kanban.noAnts") }}</div>

    <!-- 3×2 Grid -->
    <div v-else class="grid grid-cols-2 gap-4">
      <div v-for="ant in visibleAnts" :key="ant.ant_id"
        class="bg-gray-800 rounded-lg border border-gray-700 flex flex-col overflow-hidden transition-all"
        :class="{ 'col-span-2 row-span-2': expandedAnt === ant.ant_id }"
        :style="expandedAnt === ant.ant_id ? 'min-height: 500px' : 'min-height: 280px'">

        <!-- Card Header -->
        <div class="px-4 py-3 border-b border-gray-700 flex items-center justify-between cursor-pointer hover:bg-gray-750 transition-colors"
          @click="toggleExpand(ant.ant_id)">
          <div class="flex items-center gap-2">
            <span :class="stateDot[ant.state] ?? 'bg-gray-500'" class="w-2.5 h-2.5 rounded-full inline-block"
              :style="ant.state === 'active' ? 'animation: pulse 2s infinite' : ''"></span>
            <span class="font-semibold text-gray-100">{{ ant.name || ant.ant_id.slice(0, 8) }}</span>
            <span class="text-xs font-mono text-gray-500">{{ ant.ant_id.slice(0, 8) }}</span>
          </div>
          <div class="flex items-center gap-3 text-xs">
            <!-- Session stats -->
            <template v-if="sessions[ant.ant_id]">
              <span class="text-gray-500">{{ sessions[ant.ant_id]!.ticks }} ticks</span>
              <span class="text-gray-500">{{ formatTokens(sessions[ant.ant_id]!.estimatedTokens) }} tok</span>
              <span v-if="sessions[ant.ant_id]!.activeClaims.length" class="text-yellow-400">
                {{ sessions[ant.ant_id]!.activeClaims.length }} claims
              </span>
            </template>
            <span :class="stateColor[ant.state]" class="font-medium">{{ t(`ants.state.${ant.state}` as keyof typeof import("../i18n/zh").default) }}</span>
            <span v-if="ant.last_heartbeat" class="text-gray-500">{{ ago(ant.last_heartbeat) }}</span>
            <span class="text-gray-600">{{ expandedAnt === ant.ant_id ? '▲' : '▼' }}</span>
          </div>
        </div>

        <!-- Status Bar -->
        <div class="px-4 py-1.5 bg-gray-800/50 border-b border-gray-700/50 text-xs flex items-center gap-4">
          <div class="flex items-center gap-1.5">
            <span class="text-gray-500">{{ t("kanban.phase") }}:</span>
            <span class="font-medium" :class="ant.current_action === 'llm_run' ? 'text-orange-400' : 'text-emerald-400'">
              {{ phaseLabel[ant.current_action] || ant.current_action || "idle" }}
            </span>
          </div>
          <div v-if="ant.status_text" class="text-gray-400 truncate flex-1">{{ ant.status_text }}</div>
          <div v-if="sessions[ant.ant_id]" class="text-gray-500 flex-shrink-0">
            up {{ formatUptime(sessions[ant.ant_id]!.uptime) }}
          </div>
        </div>

        <!-- Session Error -->
        <div v-if="sessionErrors[ant.ant_id]" class="px-4 py-1 bg-red-900/30 text-red-400 text-xs">
          session: {{ sessionErrors[ant.ant_id] }}
        </div>

        <!-- Compact View: Recent Messages -->
        <div v-if="expandedAnt !== ant.ant_id" class="flex-1 overflow-y-auto px-4 py-2 space-y-0.5" style="max-height: 180px;">
          <div v-for="(msg, i) in getRecentMessages(ant.ant_id)" :key="i" class="flex items-start gap-2 text-xs py-0.5">
            <span class="font-mono font-bold w-4 flex-shrink-0" :class="summarizeMessage(msg).color">
              {{ summarizeMessage(msg).icon }}
            </span>
            <span class="text-gray-300 truncate">{{ summarizeMessage(msg).text }}</span>
          </div>
          <div v-if="!sessions[ant.ant_id] || getRecentMessages(ant.ant_id).length === 0"
            class="text-gray-500 text-xs py-2">
            {{ sessionErrors[ant.ant_id] ? t("kanban.sessionUnavailable") : t("kanban.noActivity") }}
          </div>
        </div>

        <!-- Expanded View: Full Session -->
        <div v-else class="flex-1 overflow-y-auto px-4 py-3 space-y-3" style="max-height: 600px;">
          <template v-if="sessions[ant.ant_id]?.messages">
            <div v-for="msg in sessions[ant.ant_id]!.messages" :key="msg.idx"
              class="rounded-lg px-3 py-2 text-xs"
              :class="{
                'bg-blue-900/30 border border-blue-800/50': msg.role === 'user',
                'bg-gray-700/50 border border-gray-600/50': msg.role === 'assistant',
              }">
              <!-- Role label -->
              <div class="flex items-center gap-2 mb-1">
                <span class="font-bold text-xs"
                  :class="msg.role === 'user' ? 'text-blue-400' : 'text-emerald-400'">
                  {{ msg.role === 'user' ? 'BUS →' : 'AGENT →' }}
                </span>
                <span class="text-gray-500">#{{ msg.idx }}</span>
              </div>

              <!-- Text content -->
              <div v-if="msg.type === 'text' && msg.text" class="text-gray-300 whitespace-pre-wrap break-words max-h-48 overflow-y-auto">
                {{ msg.text }}
              </div>

              <!-- Block content -->
              <div v-if="msg.type === 'blocks' && msg.blocks" class="space-y-1.5">
                <div v-for="(block, bi) in msg.blocks" :key="bi">
                  <!-- Text block -->
                  <div v-if="block.type === 'text'" class="text-gray-300 whitespace-pre-wrap break-words max-h-48 overflow-y-auto">
                    {{ block.text }}
                  </div>
                  <!-- Tool use -->
                  <div v-if="block.type === 'tool_use'" class="bg-yellow-900/20 border border-yellow-800/30 rounded px-2 py-1">
                    <span class="text-yellow-400 font-mono font-bold">{{ block.name }}</span>
                    <pre class="text-gray-400 mt-0.5 text-xs overflow-x-auto max-h-24 overflow-y-auto">{{ JSON.stringify(block.input, null, 2) }}</pre>
                  </div>
                  <!-- Tool result -->
                  <div v-if="block.type === 'tool_result'"
                    class="rounded px-2 py-1"
                    :class="block.is_error ? 'bg-red-900/20 border border-red-800/30' : 'bg-gray-800 border border-gray-700'">
                    <span class="font-mono" :class="block.is_error ? 'text-red-400' : 'text-gray-500'">result:</span>
                    <pre class="text-gray-400 mt-0.5 text-xs overflow-x-auto max-h-24 overflow-y-auto">{{ block.content }}</pre>
                  </div>
                </div>
              </div>
            </div>
          </template>
          <div v-else class="text-gray-500 text-sm py-4 text-center">
            {{ t("kanban.sessionUnavailable") }}
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}
</style>
