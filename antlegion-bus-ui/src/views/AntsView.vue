<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { useRouter } from "vue-router";
import { api } from "../api/client";
import type { Ant } from "../api/client";
import { useI18n } from "../i18n";

const { t } = useI18n();
const router = useRouter();

const ants = ref<Ant[]>([]);
const loading = ref(true);
const error = ref("");

async function refresh() {
  loading.value = true;
  try {
    ants.value = await api.getAnts();
    error.value = "";
  } catch (e) {
    error.value = (e as Error).message;
    ants.value = [];
  }
  loading.value = false;
}

onMounted(refresh);

// Split ants into top row and bottom row
const topRow = computed(() => ants.value.filter((_, i) => i % 2 === 0));
const bottomRow = computed(() => ants.value.filter((_, i) => i % 2 === 1));

function ago(ts: number | null): string {
  if (!ts) return "-";
  const s = Math.floor(Date.now() / 1000 - ts);
  if (s < 60) return `${s}${t("time.sAgo")}`;
  if (s < 3600) return `${Math.floor(s / 60)}${t("time.mAgo")}`;
  return `${Math.floor(s / 3600)}${t("time.hAgo")}`;
}

function antStateLabel(state: string): string {
  const key = `ants.state.${state}` as keyof typeof import("../i18n/zh").default;
  return t(key) || state;
}

// Connection line style per state
function lineClass(state: string): string {
  switch (state) {
    case "active": return "ant-line-active";
    case "degraded": return "ant-line-degraded";
    case "isolated": return "ant-line-isolated";
    default: return "ant-line-offline";
  }
}

// Ant glow per state
function glowClass(state: string): string {
  switch (state) {
    case "active": return "ant-glow-active";
    case "degraded": return "ant-glow-degraded";
    case "isolated": return "ant-glow-isolated";
    default: return "ant-glow-offline";
  }
}

const dotColor: Record<string, string> = {
  active: "bg-emerald-400",
  degraded: "bg-yellow-400",
  isolated: "bg-red-400",
  offline: "bg-gray-500",
};

const reliabilityColor = (score: number) =>
  score > 0.7 ? "text-emerald-400" : score > 0.3 ? "text-yellow-400" : "text-red-400";
</script>

<template>
  <div>
    <div class="flex items-center justify-between mb-6">
      <h1 class="text-2xl font-bold flex items-center gap-2">
        <span class="text-3xl">🐜</span> {{ t("ants.title") }}
      </h1>
      <button @click="refresh" class="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-sm transition-colors">
        {{ t("common.refresh") }}
      </button>
    </div>

    <div v-if="error" class="bg-red-900/50 border border-red-700 rounded-lg p-3 mb-4 text-sm">{{ error }}</div>
    <div v-if="loading" class="text-gray-400">{{ t("common.loading") }}</div>

    <!-- Empty state -->
    <div v-else-if="ants.length === 0" class="text-center py-20">
      <div class="text-6xl mb-4 opacity-30">🐜</div>
      <div class="text-gray-500">{{ t("ants.noAnts") }}</div>
    </div>

    <!-- Bus topology view -->
    <div v-else class="ant-topology">

      <!-- Top row ants -->
      <div class="ant-row ant-row-top">
        <div v-for="ant in topRow" :key="ant.ant_id" class="ant-column">
          <!-- Card -->
          <div @click="router.push(`/ants/${ant.ant_id}`)"
            class="ant-card group" :class="glowClass(ant.state)">
            <!-- Ant avatar + reliability ring -->
            <div class="ant-avatar-wrap">
              <svg class="ant-ring" viewBox="0 0 44 44">
                <circle cx="22" cy="22" r="20" fill="none" stroke="#374151" stroke-width="2.5" />
                <circle cx="22" cy="22" r="20" fill="none"
                  :stroke="ant.reliability_score > 0.7 ? '#34d399' : ant.reliability_score > 0.3 ? '#fbbf24' : '#f87171'"
                  stroke-width="2.5" stroke-linecap="round"
                  :stroke-dasharray="`${ant.reliability_score * 125.6} 125.6`"
                  transform="rotate(-90 22 22)" />
              </svg>
              <span class="ant-emoji" :class="{ 'opacity-30': ant.state === 'offline', 'grayscale': ant.state === 'offline' }">🐜</span>
            </div>

            <!-- Name + state -->
            <div class="mt-1.5 text-center">
              <div class="font-bold text-sm text-gray-100 group-hover:text-emerald-300 transition-colors truncate max-w-[120px]">
                {{ ant.name || ant.ant_id.slice(0, 8) }}
              </div>
              <div class="flex items-center justify-center gap-1 mt-0.5">
                <span class="w-1.5 h-1.5 rounded-full" :class="dotColor[ant.state] ?? 'bg-gray-500'"
                  :style="ant.state === 'active' ? 'animation: pulse 2s infinite' : ''"></span>
                <span class="text-[10px]" :class="dotColor[ant.state]?.replace('bg-', 'text-') ?? 'text-gray-500'">
                  {{ antStateLabel(ant.state) }}
                </span>
                <span class="text-[10px] font-mono" :class="reliabilityColor(ant.reliability_score)">
                  {{ (ant.reliability_score * 100).toFixed(0) }}%
                </span>
              </div>
            </div>

            <!-- Compact info -->
            <div class="mt-2 space-y-0.5 text-[10px] text-gray-500 w-full">
              <div class="flex justify-between">
                <span>{{ t("ants.tec") }}</span>
                <span class="font-mono text-gray-400">{{ ant.transmit_error_counter }}</span>
              </div>
              <div class="flex justify-between">
                <span>{{ t("ants.lastHeartbeat") }}</span>
                <span class="text-gray-400">{{ ago(ant.last_heartbeat) }}</span>
              </div>
            </div>

            <!-- Capabilities -->
            <div class="mt-1.5 flex gap-0.5 flex-wrap justify-center" v-if="ant.capabilities.length">
              <span v-for="cap in ant.capabilities.slice(0, 3)" :key="cap"
                class="px-1.5 py-0 bg-emerald-900/50 text-emerald-400 rounded text-[9px]">{{ cap }}</span>
              <span v-if="ant.capabilities.length > 3"
                class="px-1.5 py-0 bg-gray-700 text-gray-500 rounded text-[9px]">+{{ ant.capabilities.length - 3 }}</span>
            </div>
          </div>

          <!-- Connection line (downward to bus) -->
          <div class="ant-line-segment" :class="lineClass(ant.state)">
            <div v-if="ant.state === 'active'" class="ant-data-dot ant-data-dot-down"></div>
            <div v-if="ant.state === 'isolated'" class="ant-line-break">✕</div>
          </div>
        </div>
      </div>

      <!-- ═══ BUS LINE ═══ -->
      <div class="bus-line">
        <div class="bus-line-inner"></div>
        <div class="bus-label">
          <span class="bus-pulse"></span>
          {{ t("ants.bus") }}
        </div>
      </div>

      <!-- Bottom row ants -->
      <div class="ant-row ant-row-bottom">
        <div v-for="ant in bottomRow" :key="ant.ant_id" class="ant-column">
          <!-- Connection line (upward to bus) -->
          <div class="ant-line-segment" :class="lineClass(ant.state)">
            <div v-if="ant.state === 'active'" class="ant-data-dot ant-data-dot-up"></div>
            <div v-if="ant.state === 'isolated'" class="ant-line-break">✕</div>
          </div>

          <!-- Card -->
          <div @click="router.push(`/ants/${ant.ant_id}`)"
            class="ant-card group" :class="glowClass(ant.state)">
            <div class="ant-avatar-wrap">
              <svg class="ant-ring" viewBox="0 0 44 44">
                <circle cx="22" cy="22" r="20" fill="none" stroke="#374151" stroke-width="2.5" />
                <circle cx="22" cy="22" r="20" fill="none"
                  :stroke="ant.reliability_score > 0.7 ? '#34d399' : ant.reliability_score > 0.3 ? '#fbbf24' : '#f87171'"
                  stroke-width="2.5" stroke-linecap="round"
                  :stroke-dasharray="`${ant.reliability_score * 125.6} 125.6`"
                  transform="rotate(-90 22 22)" />
              </svg>
              <span class="ant-emoji" :class="{ 'opacity-30': ant.state === 'offline', 'grayscale': ant.state === 'offline' }">🐜</span>
            </div>
            <div class="mt-1.5 text-center">
              <div class="font-bold text-sm text-gray-100 group-hover:text-emerald-300 transition-colors truncate max-w-[120px]">
                {{ ant.name || ant.ant_id.slice(0, 8) }}
              </div>
              <div class="flex items-center justify-center gap-1 mt-0.5">
                <span class="w-1.5 h-1.5 rounded-full" :class="dotColor[ant.state] ?? 'bg-gray-500'"
                  :style="ant.state === 'active' ? 'animation: pulse 2s infinite' : ''"></span>
                <span class="text-[10px]" :class="dotColor[ant.state]?.replace('bg-', 'text-') ?? 'text-gray-500'">
                  {{ antStateLabel(ant.state) }}
                </span>
                <span class="text-[10px] font-mono" :class="reliabilityColor(ant.reliability_score)">
                  {{ (ant.reliability_score * 100).toFixed(0) }}%
                </span>
              </div>
            </div>
            <div class="mt-2 space-y-0.5 text-[10px] text-gray-500 w-full">
              <div class="flex justify-between">
                <span>{{ t("ants.tec") }}</span>
                <span class="font-mono text-gray-400">{{ ant.transmit_error_counter }}</span>
              </div>
              <div class="flex justify-between">
                <span>{{ t("ants.lastHeartbeat") }}</span>
                <span class="text-gray-400">{{ ago(ant.last_heartbeat) }}</span>
              </div>
            </div>
            <div class="mt-1.5 flex gap-0.5 flex-wrap justify-center" v-if="ant.capabilities.length">
              <span v-for="cap in ant.capabilities.slice(0, 3)" :key="cap"
                class="px-1.5 py-0 bg-emerald-900/50 text-emerald-400 rounded text-[9px]">{{ cap }}</span>
              <span v-if="ant.capabilities.length > 3"
                class="px-1.5 py-0 bg-gray-700 text-gray-500 rounded text-[9px]">+{{ ant.capabilities.length - 3 }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* ═══ Topology layout ═══ */
.ant-topology {
  position: relative;
  padding: 0 1rem;
}

.ant-row {
  display: flex;
  justify-content: center;
  gap: 1rem;
  flex-wrap: wrap;
}

.ant-column {
  display: flex;
  flex-direction: column;
  align-items: center;
  min-width: 140px;
  max-width: 160px;
}

.ant-row-top {
  padding-bottom: 0;
}
.ant-row-bottom {
  padding-top: 0;
}

/* ═══ Ant card ═══ */
.ant-card {
  background: #1f2937;
  border: 1px solid #374151;
  border-radius: 12px;
  padding: 12px 10px 10px;
  cursor: pointer;
  transition: all 0.25s ease;
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 100%;
}
.ant-card:hover {
  transform: translateY(-3px) scale(1.03);
  border-color: #6ee7b7;
  box-shadow: 0 8px 24px rgba(16, 185, 129, 0.15);
}

/* State glows */
.ant-glow-active {
  box-shadow: 0 0 0 1px rgba(52, 211, 153, 0.15);
}
.ant-glow-active:hover {
  box-shadow: 0 0 20px rgba(52, 211, 153, 0.25);
}
.ant-glow-degraded {
  box-shadow: 0 0 0 1px rgba(251, 191, 36, 0.2);
  animation: degraded-blink 2s ease-in-out infinite;
}
.ant-glow-isolated {
  box-shadow: 0 0 0 1px rgba(248, 113, 113, 0.3);
  border-color: #7f1d1d;
}
.ant-glow-offline {
  opacity: 0.5;
}

@keyframes degraded-blink {
  0%, 100% { box-shadow: 0 0 0 1px rgba(251, 191, 36, 0.15); }
  50% { box-shadow: 0 0 12px rgba(251, 191, 36, 0.3); }
}

/* ═══ Ant avatar ═══ */
.ant-avatar-wrap {
  position: relative;
  width: 48px;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.ant-ring {
  position: absolute;
  inset: 0;
  width: 48px;
  height: 48px;
}
.ant-emoji {
  font-size: 24px;
  line-height: 1;
  filter: drop-shadow(0 0 3px rgba(52, 211, 153, 0.3));
}

/* ═══ Bus line ═══ */
.bus-line {
  position: relative;
  height: 32px;
  margin: 4px 0;
  display: flex;
  align-items: center;
  justify-content: center;
}
.bus-line-inner {
  position: absolute;
  left: 0;
  right: 0;
  top: 50%;
  height: 4px;
  transform: translateY(-50%);
  background: linear-gradient(90deg, #064e3b, #10b981, #06b6d4, #10b981, #064e3b);
  border-radius: 2px;
  box-shadow: 0 0 12px rgba(16, 185, 129, 0.4), 0 0 4px rgba(6, 182, 212, 0.3);
  animation: bus-glow 3s ease-in-out infinite;
}
.bus-label {
  position: relative;
  z-index: 10;
  display: flex;
  align-items: center;
  gap: 6px;
  background: #111827;
  border: 1px solid #10b981;
  border-radius: 20px;
  padding: 2px 14px;
  font-size: 11px;
  font-weight: 600;
  color: #6ee7b7;
  letter-spacing: 0.05em;
  text-transform: uppercase;
}
.bus-pulse {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #34d399;
  animation: pulse 2s infinite;
}

@keyframes bus-glow {
  0%, 100% { box-shadow: 0 0 8px rgba(16, 185, 129, 0.3), 0 0 3px rgba(6, 182, 212, 0.2); }
  50% { box-shadow: 0 0 20px rgba(16, 185, 129, 0.5), 0 0 8px rgba(6, 182, 212, 0.4); }
}

@keyframes pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.5; transform: scale(0.7); }
}

/* ═══ Connection lines ═══ */
.ant-line-segment {
  width: 2px;
  height: 28px;
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* Active: solid green + flowing dot */
.ant-line-active {
  background: #34d399;
  box-shadow: 0 0 6px rgba(52, 211, 153, 0.4);
}

/* Degraded: dashed yellow */
.ant-line-degraded {
  background: repeating-linear-gradient(
    to bottom,
    #fbbf24 0px, #fbbf24 4px,
    transparent 4px, transparent 8px
  );
}

/* Isolated: red with break */
.ant-line-isolated {
  background: repeating-linear-gradient(
    to bottom,
    #f87171 0px, #f87171 3px,
    transparent 3px, transparent 7px
  );
  opacity: 0.6;
}
.ant-line-break {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  font-size: 8px;
  color: #f87171;
  background: #111827;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid #f87171;
  font-weight: bold;
}

/* Offline: gray dashed */
.ant-line-offline {
  background: repeating-linear-gradient(
    to bottom,
    #4b5563 0px, #4b5563 3px,
    transparent 3px, transparent 7px
  );
  opacity: 0.4;
}

/* ═══ Data flow dot animation ═══ */
.ant-data-dot {
  position: absolute;
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: #6ee7b7;
  box-shadow: 0 0 6px #34d399;
}
.ant-data-dot-down {
  animation: flow-down 1.5s linear infinite;
}
.ant-data-dot-up {
  animation: flow-up 1.5s linear infinite;
}

@keyframes flow-down {
  0% { top: 0; opacity: 0; }
  20% { opacity: 1; }
  80% { opacity: 1; }
  100% { top: 100%; opacity: 0; }
}
@keyframes flow-up {
  0% { bottom: 0; opacity: 0; }
  20% { opacity: 1; }
  80% { opacity: 1; }
  100% { bottom: 100%; opacity: 0; }
}

/* Grayscale for offline */
.grayscale {
  filter: grayscale(1) brightness(0.5);
}
</style>
