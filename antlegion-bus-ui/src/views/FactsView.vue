<script setup lang="ts">
import { ref, computed, onMounted, watch } from "vue";
import { useRouter } from "vue-router";
import { api } from "../api/client";
import type { Fact } from "../api/client";
import { useI18n } from "../i18n";

const { t } = useI18n();
const router = useRouter();
const facts = ref<Fact[]>([]);
const loading = ref(true);
const filterType = ref("");
const filterState = ref("");
const filterSource = ref("");

const states = ["", "published", "claimed", "resolved", "dead"];

// Batch selection
const selectedIds = ref<Set<string>>(new Set());
const batchLoading = ref(false);
const batchMessage = ref("");

const allSelected = computed(() => facts.value.length > 0 && facts.value.every((f) => selectedIds.value.has(f.fact_id)));

function toggleAll() {
  if (allSelected.value) {
    selectedIds.value = new Set();
  } else {
    selectedIds.value = new Set(facts.value.map((f) => f.fact_id));
  }
}

function toggleOne(id: string) {
  const s = new Set(selectedIds.value);
  if (s.has(id)) s.delete(id); else s.add(id);
  selectedIds.value = s;
}

async function batchAction(action: "delete" | "redispatch" | "release") {
  const ids = [...selectedIds.value];
  if (ids.length === 0) return;
  batchLoading.value = true;
  batchMessage.value = "";
  try {
    const res = await api.adminBatchFacts(ids, action);
    batchMessage.value = `${t("facts.batchDone")}: ${res.succeeded}/${res.total}`;
    selectedIds.value = new Set();
    await refresh();
  } catch (err) {
    batchMessage.value = `${t("facts.batchError")}: ${err instanceof Error ? err.message : String(err)}`;
  }
  batchLoading.value = false;
  setTimeout(() => { batchMessage.value = ""; }, 3000);
}

async function refresh() {
  loading.value = true;
  try {
    const params: Record<string, string> = {};
    if (filterType.value) params.fact_type = filterType.value;
    if (filterState.value) params.state = filterState.value;
    if (filterSource.value) params.source_ant_id = filterSource.value;
    facts.value = await api.getFacts(params);
  } catch { facts.value = []; }
  loading.value = false;
}

onMounted(refresh);
watch([filterType, filterState, filterSource], refresh);

function ago(ts: number): string {
  const s = Math.floor(Date.now() / 1000 - ts);
  if (s < 60) return `${s}${t("time.sAgo")}`;
  if (s < 3600) return `${Math.floor(s / 60)}${t("time.mAgo")}`;
  return `${Math.floor(s / 3600)}${t("time.hAgo")}`;
}

function stateLabel(state: string): string {
  const key = `state.${state}` as keyof typeof import("../i18n/zh").default;
  return t(key) || state;
}

const stateBadge: Record<string, string> = {
  published: "bg-blue-600",
  matched: "bg-cyan-600",
  claimed: "bg-yellow-600 text-black",
  processing: "bg-orange-600",
  resolved: "bg-emerald-600",
  dead: "bg-red-600",
  created: "bg-gray-600",
};
</script>

<template>
  <div>
    <div class="flex items-center justify-between mb-6">
      <h1 class="text-2xl font-bold">{{ t("facts.title") }}</h1>
      <button @click="refresh" class="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-sm transition-colors">
        {{ t("common.refresh") }}
      </button>
    </div>

    <!-- Filters -->
    <div class="flex gap-3 mb-4">
      <input v-model="filterType" :placeholder="t('facts.filterType')" class="bg-gray-800 border border-gray-600 rounded px-3 py-1.5 text-sm w-64 focus:border-emerald-500 outline-none" />
      <select v-model="filterState" class="bg-gray-800 border border-gray-600 rounded px-3 py-1.5 text-sm focus:border-emerald-500 outline-none">
        <option value="">{{ t("facts.allStates") }}</option>
        <option v-for="s in states.slice(1)" :key="s" :value="s">{{ stateLabel(s) }}</option>
      </select>
      <input v-model="filterSource" :placeholder="t('facts.filterSource')" class="bg-gray-800 border border-gray-600 rounded px-3 py-1.5 text-sm w-48 focus:border-emerald-500 outline-none" />
    </div>

    <!-- Batch Toolbar -->
    <div v-if="selectedIds.size > 0" class="flex items-center gap-3 mb-4 bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5">
      <span class="text-sm text-gray-300">
        {{ t("facts.selected") }}: <span class="text-emerald-400 font-semibold">{{ selectedIds.size }}</span>
      </span>
      <div class="flex-1"></div>
      <button @click="batchAction('redispatch')" :disabled="batchLoading"
        class="px-3 py-1 bg-blue-700 hover:bg-blue-600 rounded text-xs font-medium transition-colors disabled:opacity-50">
        {{ t("facts.batchRedispatch") }}
      </button>
      <button @click="batchAction('release')" :disabled="batchLoading"
        class="px-3 py-1 bg-yellow-700 hover:bg-yellow-600 rounded text-xs font-medium transition-colors disabled:opacity-50">
        {{ t("facts.batchRelease") }}
      </button>
      <button @click="batchAction('delete')" :disabled="batchLoading"
        class="px-3 py-1 bg-red-700 hover:bg-red-600 rounded text-xs font-medium transition-colors disabled:opacity-50">
        {{ t("facts.batchDelete") }}
      </button>
      <button @click="selectedIds = new Set()" class="px-3 py-1 bg-gray-700 hover:bg-gray-600 rounded text-xs transition-colors">
        {{ t("facts.clearSelection") }}
      </button>
    </div>

    <!-- Batch Message -->
    <div v-if="batchMessage" class="mb-4 px-4 py-2 rounded text-sm"
      :class="batchMessage.includes('Error') || batchMessage.includes(t('facts.batchError')) ? 'bg-red-900/50 border border-red-700 text-red-300' : 'bg-emerald-900/50 border border-emerald-700 text-emerald-300'">
      {{ batchMessage }}
    </div>

    <div v-if="loading" class="text-gray-400">{{ t("common.loading") }}</div>

    <div v-else class="bg-gray-800 rounded-lg border border-gray-700 overflow-hidden">
      <table class="w-full text-sm">
        <thead class="bg-gray-750">
          <tr class="border-b border-gray-700 text-gray-400 text-left">
            <th class="px-3 py-2.5 w-10">
              <input type="checkbox" :checked="allSelected" @change="toggleAll"
                class="rounded bg-gray-700 border-gray-600 text-emerald-500 focus:ring-emerald-500 cursor-pointer" />
            </th>
            <th class="px-4 py-2.5 font-medium">{{ t("facts.id") }}</th>
            <th class="px-4 py-2.5 font-medium">{{ t("facts.type") }}</th>
            <th class="px-4 py-2.5 font-medium">{{ t("facts.state") }}</th>
            <th class="px-4 py-2.5 font-medium">{{ t("facts.epistemic") }}</th>
            <th class="px-4 py-2.5 font-medium">{{ t("facts.priority") }}</th>
            <th class="px-4 py-2.5 font-medium">{{ t("facts.source") }}</th>
            <th class="px-4 py-2.5 font-medium">{{ t("facts.age") }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="f in facts" :key="f.fact_id"
            class="border-b border-gray-700/50 hover:bg-gray-700/50 cursor-pointer transition-colors"
            :class="{ 'bg-emerald-900/10': selectedIds.has(f.fact_id) }">
            <td class="px-3 py-2" @click.stop>
              <input type="checkbox" :checked="selectedIds.has(f.fact_id)" @change="toggleOne(f.fact_id)"
                class="rounded bg-gray-700 border-gray-600 text-emerald-500 focus:ring-emerald-500 cursor-pointer" />
            </td>
            <td class="px-4 py-2 font-mono text-xs text-gray-400" @click="router.push(`/facts/${f.fact_id}`)">{{ f.fact_id?.slice(0, 8) ?? '-' }}</td>
            <td class="px-4 py-2 text-gray-200" @click="router.push(`/facts/${f.fact_id}`)">{{ f.fact_type }}</td>
            <td class="px-4 py-2" @click="router.push(`/facts/${f.fact_id}`)">
              <span :class="[stateBadge[f.state] ?? 'bg-gray-600']" class="px-2 py-0.5 rounded text-xs font-medium">{{ stateLabel(f.state) }}</span>
            </td>
            <td class="px-4 py-2 text-gray-300" @click="router.push(`/facts/${f.fact_id}`)">{{ f.epistemic_state }}</td>
            <td class="px-4 py-2 text-gray-300" @click="router.push(`/facts/${f.fact_id}`)">{{ f.priority }}</td>
            <td class="px-4 py-2 font-mono text-xs text-gray-400" @click="router.push(`/facts/${f.fact_id}`)">{{ f.source_ant_id?.slice(0, 8) ?? '-' }}</td>
            <td class="px-4 py-2 text-gray-400" @click="router.push(`/facts/${f.fact_id}`)">{{ ago(f.created_at) }}</td>
          </tr>
          <tr v-if="facts.length === 0">
            <td colspan="8" class="px-4 py-8 text-center text-gray-500">{{ t("facts.noFacts") }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
