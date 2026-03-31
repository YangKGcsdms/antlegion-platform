<script setup lang="ts">
import { ref, onMounted } from "vue";
import { api } from "../api/client";
import type { Ant } from "../api/client";
import { useI18n } from "../i18n";

const { t } = useI18n();
const props = defineProps<{ id: string }>();
const ant = ref<Ant | null>(null);
const activity = ref<Array<Record<string, unknown>>>([]);
const error = ref("");
const message = ref("");

async function refresh() {
  try {
    ant.value = await api.getAnt(props.id);
    const res = await api.getAntActivity(props.id);
    activity.value = res.activity;
    error.value = "";
  } catch (e) {
    error.value = (e as Error).message;
  }
}

onMounted(refresh);

async function isolate() {
  try {
    await api.adminIsolateAnt(props.id);
    message.value = t("antDetail.isolated");
    await refresh();
  } catch (e) { error.value = (e as Error).message; }
}

async function restore() {
  try {
    await api.adminRestoreAnt(props.id);
    message.value = t("antDetail.restored");
    await refresh();
  } catch (e) { error.value = (e as Error).message; }
}

function formatTs(ts: number | null): string {
  if (!ts) return "-";
  return new Date(ts * 1000).toLocaleString();
}

const stateColor: Record<string, string> = {
  active: "text-emerald-400",
  degraded: "text-yellow-400",
  isolated: "text-red-400",
  offline: "text-gray-500",
};
</script>

<template>
  <div>
    <div class="mb-6">
      <router-link to="/ants" class="text-sm text-gray-400 hover:text-emerald-400">&larr; {{ t("antDetail.backToAnts") }}</router-link>
      <h1 class="text-2xl font-bold mt-2">{{ t("antDetail.title") }}</h1>
    </div>

    <div v-if="error" class="bg-red-900/50 border border-red-700 rounded-lg p-3 mb-4 text-sm">{{ error }}</div>
    <div v-if="message" class="bg-emerald-900/50 border border-emerald-700 rounded-lg p-3 mb-4 text-sm">{{ message }}</div>

    <template v-if="ant">
      <div class="bg-gray-800 rounded-lg p-5 border border-gray-700 mb-6">
        <div class="flex items-center justify-between mb-3">
          <div>
            <h2 class="text-lg font-semibold text-gray-200">{{ ant.name || ant.ant_id }}</h2>
            <p class="text-xs font-mono text-gray-500">{{ ant.ant_id }}</p>
          </div>
          <span :class="stateColor[ant.state]" class="text-lg font-bold">{{ ant.state }}</span>
        </div>
        <p v-if="ant.description" class="text-sm text-gray-400 mb-4">{{ ant.description }}</p>

        <div class="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm mb-4">
          <div><span class="text-gray-400">{{ t("ants.reliability") }}</span><div class="font-mono text-lg">{{ ant.reliability_score.toFixed(2) }}</div></div>
          <div><span class="text-gray-400">{{ t("ants.tec") }}</span><div class="font-mono text-lg">{{ ant.transmit_error_counter }}</div></div>
          <div><span class="text-gray-400">{{ t("ants.maxClaims") }}</span><div class="font-mono text-lg">{{ ant.max_concurrent_claims }}</div></div>
          <div><span class="text-gray-400">{{ t("antDetail.connected") }}</span><div class="text-sm">{{ formatTs(ant.connected_at) }}</div></div>
        </div>

        <div v-if="ant.capabilities.length" class="mb-4">
          <span class="text-sm text-gray-400">{{ t("antDetail.capabilities") }}: </span>
          <span v-for="c in ant.capabilities" :key="c" class="px-2 py-0.5 bg-emerald-900/50 text-emerald-300 rounded text-xs mr-1">{{ c }}</span>
        </div>

        <!-- Admin actions -->
        <div class="flex gap-2 pt-3 border-t border-gray-700">
          <button v-if="ant.state !== 'isolated'" @click="isolate" class="px-3 py-1.5 bg-red-700 hover:bg-red-600 rounded text-sm">{{ t("antDetail.isolate") }}</button>
          <button v-if="ant.state === 'isolated'" @click="restore" class="px-3 py-1.5 bg-emerald-700 hover:bg-emerald-600 rounded text-sm">{{ t("antDetail.restore") }}</button>
        </div>
      </div>

      <!-- Activity Log -->
      <div class="bg-gray-800 rounded-lg p-5 border border-gray-700">
        <h3 class="text-lg font-semibold mb-4">{{ t("antDetail.activityLog") }}</h3>
        <div v-if="activity.length === 0" class="text-gray-500 text-sm">{{ t("antDetail.noActivity") }}</div>
        <div v-else class="space-y-1 max-h-96 overflow-auto">
          <div v-for="(a, i) in activity" :key="i" class="flex items-center gap-3 text-sm bg-gray-900/50 rounded px-3 py-2">
            <span class="text-gray-500 font-mono text-xs w-20 shrink-0">{{ formatTs(a.timestamp as number) }}</span>
            <span class="text-emerald-400 font-medium w-20 shrink-0">{{ a.action }}</span>
            <span v-if="a.fact_id" class="font-mono text-xs text-blue-400">
              <router-link :to="`/facts/${a.fact_id}`" class="hover:underline">{{ (a.fact_id as string).slice(0, 8) }}</router-link>
            </span>
            <span v-if="a.detail" class="text-gray-500 text-xs">{{ a.detail }}</span>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
