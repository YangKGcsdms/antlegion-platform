<script setup lang="ts">
import { ref, onMounted } from "vue";
import { api } from "../api/client";
import type { Metrics, Fact } from "../api/client";
import { useI18n } from "../i18n";

const { t } = useI18n();

const metrics = ref<Metrics | null>(null);
const storageStats = ref<{ store: { totalEntries: number; logSizeBytes: number }; facts_total: number } | null>(null);
const deadLetter = ref<Fact[]>([]);
const brokenChains = ref<Array<Record<string, unknown>>>([]);
const message = ref("");
const error = ref("");

async function refresh() {
  try {
    [metrics.value, storageStats.value, deadLetter.value] = await Promise.all([
      api.adminMetrics(),
      api.adminStorageStats(),
      api.adminDeadLetter(),
    ]);
    const bc = await api.adminBrokenChains();
    brokenChains.value = bc.broken;
    error.value = "";
  } catch (e) {
    error.value = (e as Error).message;
  }
}

onMounted(refresh);

async function runAction(name: string, fn: () => Promise<unknown>) {
  try {
    const result = await fn();
    message.value = `${name}: ${JSON.stringify(result)}`;
    error.value = "";
    await refresh();
  } catch (e) {
    error.value = `${name} failed: ${(e as Error).message}`;
  }
}

function fmtBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1048576) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1048576).toFixed(1)} MB`;
}
</script>

<template>
  <div>
    <div class="flex items-center justify-between mb-6">
      <h1 class="text-2xl font-bold">{{ t("admin.title") }}</h1>
      <button @click="refresh" class="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-sm">{{ t("common.refresh") }}</button>
    </div>

    <div v-if="error" class="bg-red-900/50 border border-red-700 rounded-lg p-3 mb-4 text-sm">{{ error }}</div>
    <div v-if="message" class="bg-emerald-900/50 border border-emerald-700 rounded-lg p-3 mb-4 text-sm font-mono text-xs">{{ message }}</div>

    <!-- Metrics -->
    <div v-if="metrics" class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
      <div class="bg-gray-800 rounded-lg p-4 border border-gray-700">
        <div class="text-2xl font-bold text-emerald-400">{{ (metrics.computed.resolution_rate * 100).toFixed(1) }}%</div>
        <div class="text-xs text-gray-400 mt-1">{{ t("admin.resolutionRate") }}</div>
      </div>
      <div class="bg-gray-800 rounded-lg p-4 border border-gray-700">
        <div class="text-2xl font-bold text-red-400">{{ (metrics.computed.dead_letter_rate * 100).toFixed(1) }}%</div>
        <div class="text-xs text-gray-400 mt-1">{{ t("admin.deadLetterRate") }}</div>
      </div>
      <div class="bg-gray-800 rounded-lg p-4 border border-gray-700">
        <div class="text-2xl font-bold text-yellow-400">{{ metrics.computed.active_claims }}</div>
        <div class="text-xs text-gray-400 mt-1">{{ t("admin.activeClaims") }}</div>
      </div>
      <div class="bg-gray-800 rounded-lg p-4 border border-gray-700">
        <div class="text-2xl font-bold text-blue-400">{{ metrics.computed.pending_facts }}</div>
        <div class="text-xs text-gray-400 mt-1">{{ t("admin.pendingFacts") }}</div>
      </div>
    </div>

    <div class="grid md:grid-cols-2 gap-6 mb-6">
      <!-- Storage -->
      <div class="bg-gray-800 rounded-lg p-5 border border-gray-700">
        <h2 class="text-lg font-semibold mb-4">{{ t("admin.storage") }}</h2>
        <div v-if="storageStats" class="space-y-2 text-sm mb-4">
          <div class="flex justify-between"><span class="text-gray-400">{{ t("admin.factsInMemory") }}</span><span class="font-mono">{{ storageStats.facts_total }}</span></div>
          <div class="flex justify-between"><span class="text-gray-400">{{ t("admin.journalEntries") }}</span><span class="font-mono">{{ storageStats.store.totalEntries }}</span></div>
          <div class="flex justify-between"><span class="text-gray-400">{{ t("admin.logSize") }}</span><span class="font-mono">{{ fmtBytes(storageStats.store.logSizeBytes) }}</span></div>
        </div>
        <div class="flex gap-2">
          <button @click="runAction('GC', api.adminGc)" class="px-3 py-1.5 bg-yellow-700 hover:bg-yellow-600 rounded text-sm">{{ t("admin.runGc") }}</button>
          <button @click="runAction('Compact', api.adminCompact)" class="px-3 py-1.5 bg-blue-700 hover:bg-blue-600 rounded text-sm">{{ t("admin.compactLog") }}</button>
          <button @click="runAction('Cleanup', () => api.adminCleanup({ dry_run: false }))" class="px-3 py-1.5 bg-red-700 hover:bg-red-600 rounded text-sm">{{ t("admin.cleanup") }}</button>
        </div>
      </div>

      <!-- Causation -->
      <div class="bg-gray-800 rounded-lg p-5 border border-gray-700">
        <h2 class="text-lg font-semibold mb-4">{{ t("admin.causationHealth") }}</h2>
        <div class="text-sm mb-4">
          <span class="text-gray-400">{{ t("admin.brokenChains") }}: </span>
          <span :class="brokenChains.length > 0 ? 'text-red-400 font-bold' : 'text-emerald-400'">{{ brokenChains.length }}</span>
        </div>
        <div v-if="brokenChains.length > 0" class="mb-3 max-h-32 overflow-auto">
          <div v-for="bc in brokenChains" :key="String(bc.fact_id)" class="text-xs font-mono text-gray-400">
            {{ bc.fact_id }} — missing: {{ (bc.missing_ancestors as string[]).join(', ') }}
          </div>
        </div>
        <button @click="runAction('Repair', () => api.adminRepairCausation())" class="px-3 py-1.5 bg-orange-700 hover:bg-orange-600 rounded text-sm">{{ t("admin.repairAll") }}</button>
      </div>
    </div>

    <!-- Dead Letter Queue -->
    <div class="bg-gray-800 rounded-lg p-5 border border-gray-700">
      <h2 class="text-lg font-semibold mb-4">{{ t("admin.deadLetterQueue") }} ({{ deadLetter.length }})</h2>
      <div v-if="deadLetter.length === 0" class="text-gray-500 text-sm">{{ t("admin.noDeadFacts") }}</div>
      <div v-else class="space-y-1 max-h-64 overflow-auto">
        <div v-for="f in deadLetter" :key="f.fact_id" class="flex items-center gap-3 text-sm bg-gray-900/50 rounded px-3 py-2">
          <router-link :to="`/facts/${f.fact_id}`" class="font-mono text-xs text-blue-400 hover:underline w-20 shrink-0">{{ f.fact_id.slice(0, 8) }}</router-link>
          <span class="text-gray-300 flex-1">{{ f.fact_type }}</span>
          <button @click="runAction('Redispatch', () => api.adminRedispatch(f.fact_id))" class="px-2 py-0.5 bg-emerald-700 hover:bg-emerald-600 rounded text-xs">{{ t("admin.redispatch") }}</button>
          <button @click="runAction('Delete', () => api.adminDeleteFact(f.fact_id))" class="px-2 py-0.5 bg-red-700 hover:bg-red-600 rounded text-xs">{{ t("common.delete") }}</button>
        </div>
      </div>
    </div>
  </div>
</template>
