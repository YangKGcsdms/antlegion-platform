<script setup lang="ts">
import { onMounted } from "vue";
import { useEventStream } from "../composables/useEventStream";
import { useI18n } from "../i18n";

const { t } = useI18n();
const { events, connected, connect } = useEventStream(200);

onMounted(() => connect("dashboard-events"));

function formatTs(ts: number): string {
  return new Date(ts * 1000).toLocaleTimeString();
}

function eventLabel(type: string): string {
  const key = `event.${type}` as keyof typeof import("../i18n/zh").default;
  return t(key) || type;
}

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
</script>

<template>
  <div>
    <div class="flex items-center justify-between mb-6">
      <h1 class="text-2xl font-bold">{{ t("events.title") }}</h1>
      <div class="flex items-center gap-2">
        <span class="w-2 h-2 rounded-full" :class="connected ? 'bg-emerald-400' : 'bg-red-400'"></span>
        <span class="text-sm text-gray-400">{{ connected ? t("common.connected") : t("common.disconnected") }}</span>
      </div>
    </div>

    <div v-if="events.length === 0" class="text-gray-500 text-center py-16">
      {{ t("events.waiting") }}
    </div>

    <div v-else class="space-y-1">
      <div v-for="(e, i) in events" :key="i"
        class="bg-gray-800 rounded px-4 py-2.5 border border-gray-700/50 flex items-center gap-4 text-sm">
        <span class="text-gray-500 font-mono text-xs w-20 shrink-0">{{ formatTs(e.timestamp) }}</span>
        <span :class="eventColor[e.event_type] ?? 'text-gray-400'" class="font-medium w-40 shrink-0">{{ eventLabel(e.event_type) }}</span>
        <span v-if="e.fact" class="text-gray-300">
          <router-link :to="`/facts/${e.fact.fact_id}`" class="text-blue-400 hover:underline font-mono text-xs">{{ e.fact.fact_id.slice(0, 8) }}</router-link>
          <span class="text-gray-500 ml-2">{{ e.fact.fact_type }}</span>
        </span>
        <span v-if="e.ant_id" class="text-gray-500 font-mono text-xs">ant:{{ e.ant_id.slice(0, 8) }}</span>
        <span v-if="e.detail" class="text-gray-500 text-xs ml-auto">{{ e.detail }}</span>
      </div>
    </div>
  </div>
</template>
