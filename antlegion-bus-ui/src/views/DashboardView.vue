<script setup lang="ts">
import { ref, onMounted, onUnmounted } from "vue";
import { api } from "../api/client";
import type { Stats, Fact } from "../api/client";
import { useEventStream } from "../composables/useEventStream";
import { useI18n } from "../i18n";

const { t } = useI18n();

const stats = ref<Stats | null>(null);
const error = ref("");
const loading = ref(true);

// Pipeline: fetch actual facts by state for kanban columns
const pipelineFacts = ref<Record<string, Fact[]>>({});
const pipelineStates = ["published", "claimed", "processing", "resolved", "dead"] as const;

// Live event stream for recent flow
const { events: recentEvents, connected, connect } = useEventStream(30);

async function refresh() {
  try {
    stats.value = await api.getStats();
    error.value = "";
    // load pipeline facts (top 8 per state for visual)
    const allFacts = await api.getFacts({});
    const grouped: Record<string, Fact[]> = {};
    for (const s of pipelineStates) grouped[s] = [];
    for (const f of allFacts) {
      if (grouped[f.state]) {
        if (grouped[f.state].length < 8) grouped[f.state].push(f);
      }
    }
    pipelineFacts.value = grouped;
  } catch (e) {
    error.value = t("dash.error");
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  refresh();
  connect("dashboard");
});

// Auto-refresh every 5s
let timer: ReturnType<typeof setInterval>;
onMounted(() => { timer = setInterval(refresh, 5000); });
onUnmounted(() => clearInterval(timer));

const stateColors: Record<string, string> = {
  published: "bg-blue-500",
  matched: "bg-cyan-500",
  claimed: "bg-yellow-500",
  processing: "bg-orange-500",
  resolved: "bg-emerald-500",
  dead: "bg-red-500",
  created: "bg-gray-500",
};

const stateBorder: Record<string, string> = {
  published: "border-blue-500/30",
  claimed: "border-yellow-500/30",
  processing: "border-orange-500/30",
  resolved: "border-emerald-500/30",
  dead: "border-red-500/30",
};

const stateHeaderBg: Record<string, string> = {
  published: "bg-blue-500/10",
  claimed: "bg-yellow-500/10",
  processing: "bg-orange-500/10",
  resolved: "bg-emerald-500/10",
  dead: "bg-red-500/10",
};

const epistemicColors: Record<string, string> = {
  asserted: "bg-gray-400",
  corroborated: "bg-blue-400",
  consensus: "bg-emerald-400",
  contested: "bg-yellow-400",
  refuted: "bg-red-400",
  superseded: "bg-purple-400",
};

const eventColor: Record<string, string> = {
  fact_available: "text-blue-400",
  fact_claimed: "text-yellow-400",
  fact_resolved: "text-emerald-400",
  fact_dead: "text-red-400",
  fact_expired: "text-orange-400",
  fact_superseded: "text-purple-400",
  fact_trust_changed: "text-cyan-400",
  ant_state_changed: "text-pink-400",
};

function ago(ts: number): string {
  const s = Math.floor(Date.now() / 1000 - ts);
  if (s < 60) return `${s}${t("time.sAgo")}`;
  if (s < 3600) return `${Math.floor(s / 60)}${t("time.mAgo")}`;
  return `${Math.floor(s / 3600)}${t("time.hAgo")}`;
}

function formatTs(ts: number): string {
  return new Date(ts * 1000).toLocaleTimeString();
}

function stateLabel(state: string): string {
  const key = `state.${state}` as keyof typeof import("../i18n/zh").default;
  return t(key) || state;
}

function epistemicLabel(state: string): string {
  const key = `epistemic.${state}` as keyof typeof import("../i18n/zh").default;
  return t(key) || state;
}

function eventLabel(type: string): string {
  const key = `event.${type}` as keyof typeof import("../i18n/zh").default;
  return t(key) || type;
}
</script>

<template>
  <div>
    <div class="flex items-center justify-between mb-6">
      <h1 class="text-2xl font-bold">{{ t("dash.title") }}</h1>
      <button @click="refresh" class="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-sm transition-colors">
        {{ t("common.refresh") }}
      </button>
    </div>

    <div v-if="error" class="bg-red-900/50 border border-red-700 rounded-lg p-4 mb-6">
      {{ error }}
    </div>

    <div v-if="loading" class="text-gray-400">{{ t("common.loading") }}</div>

    <template v-else-if="stats">
      <!-- Summary cards -->
      <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <div class="bg-gray-800 rounded-lg p-4 border border-gray-700">
          <div class="text-3xl font-bold text-emerald-400">{{ stats.facts.total }}</div>
          <div class="text-sm text-gray-400 mt-1">{{ t("dash.totalFacts") }}</div>
        </div>
        <div class="bg-gray-800 rounded-lg p-4 border border-gray-700">
          <div class="text-3xl font-bold text-blue-400">{{ stats.ants.connected }}</div>
          <div class="text-sm text-gray-400 mt-1">{{ t("dash.connectedAnts") }}</div>
        </div>
        <div class="bg-gray-800 rounded-lg p-4 border border-gray-700">
          <div class="text-3xl font-bold text-yellow-400">{{ stats.store.totalEntries }}</div>
          <div class="text-sm text-gray-400 mt-1">{{ t("dash.journalEntries") }}</div>
        </div>
        <div class="bg-gray-800 rounded-lg p-4 border border-gray-700">
          <div class="text-sm font-mono text-gray-300">{{ stats.protocol_version }}</div>
          <div class="text-sm text-gray-400 mt-1">{{ t("dash.protocolVersion") }}</div>
        </div>
      </div>

      <!-- ===== Fact Pipeline Kanban ===== -->
      <div class="bg-gray-800 rounded-lg p-5 border border-gray-700 mb-8">
        <div class="flex items-center justify-between mb-4">
          <h2 class="text-lg font-semibold">{{ t("dash.pipeline") }}</h2>
          <p class="text-xs text-gray-500">{{ t("dash.pipelineDesc") }}</p>
        </div>

        <!-- Pipeline flow arrows + columns -->
        <div class="flex gap-3 overflow-x-auto pb-2">
          <template v-for="(state, idx) in pipelineStates" :key="state">
            <!-- Column -->
            <div class="flex-1 min-w-[160px]">
              <!-- Column header -->
              <div :class="[stateHeaderBg[state], stateBorder[state]]"
                class="rounded-t-lg border-t-2 px-3 py-2 flex items-center justify-between">
                <div class="flex items-center gap-2">
                  <span :class="stateColors[state]" class="w-2.5 h-2.5 rounded-full"></span>
                  <span class="text-sm font-medium text-gray-200">{{ stateLabel(state) }}</span>
                </div>
                <span class="text-xs font-mono text-gray-400 bg-gray-800/60 px-1.5 py-0.5 rounded">
                  {{ stats.facts.by_state[state] ?? 0 }}
                </span>
              </div>

              <!-- Cards area -->
              <div class="bg-gray-900/50 rounded-b-lg p-2 space-y-1.5 min-h-[120px] border border-gray-700/50 border-t-0">
                <router-link v-for="f in pipelineFacts[state]" :key="f.fact_id"
                  :to="`/facts/${f.fact_id}`"
                  class="block bg-gray-800 rounded px-2.5 py-2 border border-gray-700/50 hover:border-gray-500 transition-colors cursor-pointer">
                  <div class="flex items-center justify-between mb-1">
                    <span class="text-xs font-mono text-gray-500">{{ f.fact_id?.slice(0, 8) }}</span>
                    <span class="text-[10px] text-gray-500">{{ ago(f.created_at) }}</span>
                  </div>
                  <div class="text-xs text-gray-300 truncate">{{ f.fact_type }}</div>
                  <div class="flex items-center gap-1 mt-1">
                    <span v-if="f.source_ant_id" class="text-[10px] text-gray-500 font-mono truncate">{{ f.source_ant_id?.slice(0, 6) }}</span>
                    <span v-if="f.priority <= 2" class="ml-auto text-[10px] px-1 rounded bg-red-900/50 text-red-300">P{{ f.priority }}</span>
                  </div>
                </router-link>
                <div v-if="!pipelineFacts[state]?.length" class="text-center text-gray-600 text-xs py-6">-</div>
              </div>
            </div>

            <!-- Arrow between columns -->
            <div v-if="idx < pipelineStates.length - 1" class="flex items-center text-gray-600 shrink-0 pt-10">
              <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor"><path d="M6 10l6-5v10z"/></svg>
            </div>
          </template>
        </div>
      </div>

      <!-- Two-column: stats + recent events -->
      <div class="grid md:grid-cols-2 gap-6">
        <!-- Facts by State -->
        <div class="bg-gray-800 rounded-lg p-5 border border-gray-700">
          <h2 class="text-lg font-semibold mb-4">{{ t("dash.factsByState") }}</h2>
          <div class="space-y-2">
            <div v-for="(count, state) in stats.facts.by_state" :key="state" class="flex items-center gap-3">
              <span :class="[stateColors[state] ?? 'bg-gray-500']" class="w-3 h-3 rounded-full shrink-0"></span>
              <span class="text-sm text-gray-300 w-24">{{ stateLabel(String(state)) }}</span>
              <div class="flex-1 bg-gray-700 rounded-full h-2">
                <div :class="[stateColors[state] ?? 'bg-gray-500']" class="h-2 rounded-full transition-all"
                  :style="{ width: `${Math.max(2, (count / Math.max(stats!.facts.total, 1)) * 100)}%` }"></div>
              </div>
              <span class="text-sm font-mono text-gray-400 w-8 text-right">{{ count }}</span>
            </div>
            <div v-if="Object.keys(stats.facts.by_state).length === 0" class="text-gray-500 text-sm">{{ t("dash.noFacts") }}</div>
          </div>
        </div>

        <!-- Recent Flow Events (live) -->
        <div class="bg-gray-800 rounded-lg p-5 border border-gray-700">
          <div class="flex items-center justify-between mb-4">
            <h2 class="text-lg font-semibold">{{ t("dash.recentFlow") }}</h2>
            <div class="flex items-center gap-1.5">
              <span class="w-2 h-2 rounded-full" :class="connected ? 'bg-emerald-400 animate-pulse' : 'bg-red-400'"></span>
              <span class="text-xs text-gray-500">{{ connected ? t("common.connected") : t("common.disconnected") }}</span>
            </div>
          </div>
          <div v-if="recentEvents.length === 0" class="text-gray-500 text-sm text-center py-8">{{ t("dash.noEvents") }}</div>
          <div v-else class="space-y-1 max-h-[280px] overflow-auto">
            <div v-for="(e, i) in recentEvents" :key="i"
              class="flex items-center gap-2 text-xs bg-gray-900/50 rounded px-2.5 py-1.5">
              <span class="text-gray-500 font-mono w-16 shrink-0">{{ formatTs(e.timestamp) }}</span>
              <span :class="eventColor[e.event_type] ?? 'text-gray-400'" class="font-medium w-24 shrink-0 truncate">
                {{ eventLabel(e.event_type) }}
              </span>
              <span v-if="e.fact" class="text-gray-400 truncate">
                <router-link :to="`/facts/${e.fact.fact_id}`" class="text-blue-400 hover:underline font-mono">{{ e.fact.fact_id.slice(0, 8) }}</router-link>
                <span class="text-gray-600 ml-1">{{ e.fact.fact_type }}</span>
              </span>
              <span v-if="e.ant_id" class="text-gray-600 font-mono ml-auto shrink-0">{{ e.ant_id.slice(0, 6) }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Epistemic state bar (below) -->
      <div class="bg-gray-800 rounded-lg p-5 border border-gray-700 mt-6">
        <h2 class="text-lg font-semibold mb-4">{{ t("dash.factsByEpistemic") }}</h2>
        <div class="space-y-2">
          <div v-for="(count, state) in stats.facts.by_epistemic" :key="state" class="flex items-center gap-3">
            <span :class="[epistemicColors[state] ?? 'bg-gray-500']" class="w-3 h-3 rounded-full shrink-0"></span>
            <span class="text-sm text-gray-300 w-24">{{ epistemicLabel(String(state)) }}</span>
            <div class="flex-1 bg-gray-700 rounded-full h-2">
              <div :class="[epistemicColors[state] ?? 'bg-gray-500']" class="h-2 rounded-full transition-all"
                :style="{ width: `${Math.max(2, (count / Math.max(stats!.facts.total, 1)) * 100)}%` }"></div>
            </div>
            <span class="text-sm font-mono text-gray-400 w-8 text-right">{{ count }}</span>
          </div>
          <div v-if="Object.keys(stats.facts.by_epistemic).length === 0" class="text-gray-500 text-sm">{{ t("dash.noFacts") }}</div>
        </div>
      </div>
    </template>
  </div>
</template>
