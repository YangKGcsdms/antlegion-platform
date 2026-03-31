<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useRouter } from "vue-router";
import { api } from "../api/client";
import type { Fact } from "../api/client";
import { useI18n } from "../i18n";

const { t } = useI18n();
const router = useRouter();
const props = defineProps<{ id: string }>();
const fact = ref<Fact | null>(null);
const chain = ref<Fact[]>([]);
const loading = ref(true);
const message = ref("");
const error = ref("");

onMounted(async () => {
  try {
    fact.value = await api.getFact(props.id);
    try { chain.value = await api.getCausation(props.id); } catch { /* ok */ }
  } catch (e) { error.value = (e as Error).message; }
  loading.value = false;
});

async function deleteFact() {
  if (!confirm(t("factDetail.deleteConfirm"))) return;
  try {
    await api.adminDeleteFact(props.id);
    router.push("/facts");
  } catch (e) { error.value = (e as Error).message; }
}

async function redispatch() {
  try {
    await api.adminRedispatch(props.id);
    message.value = t("factDetail.redispatched");
    fact.value = await api.getFact(props.id);
  } catch (e) { error.value = (e as Error).message; }
}

function formatTs(ts: number | null): string {
  if (!ts) return "-";
  return new Date(ts * 1000).toLocaleString();
}
</script>

<template>
  <div>
    <div class="mb-6">
      <router-link to="/facts" class="text-sm text-gray-400 hover:text-emerald-400">&larr; {{ t("factDetail.backToFacts") }}</router-link>
      <h1 class="text-2xl font-bold mt-2">{{ t("factDetail.title") }}</h1>
    </div>

    <div v-if="error" class="bg-red-900/50 border border-red-700 rounded-lg p-3 mb-4 text-sm">{{ error }}</div>
    <div v-if="message" class="bg-emerald-900/50 border border-emerald-700 rounded-lg p-3 mb-4 text-sm">{{ message }}</div>

    <div v-if="loading" class="text-gray-400">{{ t("common.loading") }}</div>

    <template v-else-if="fact">
      <!-- Header -->
      <div class="bg-gray-800 rounded-lg p-5 border border-gray-700 mb-6">
        <div class="flex items-center gap-3 mb-3">
          <span class="font-mono text-xs text-gray-400">{{ fact.fact_id }}</span>
          <span class="px-2 py-0.5 rounded text-xs font-medium bg-blue-600">{{ fact.state }}</span>
          <span class="px-2 py-0.5 rounded text-xs font-medium bg-gray-600">{{ fact.epistemic_state }}</span>
          <span class="px-2 py-0.5 rounded text-xs font-medium bg-gray-600">{{ fact.mode }}</span>
        </div>
        <h2 class="text-lg font-semibold text-gray-200">{{ fact.fact_type }}</h2>
        <p class="text-sm text-gray-400 mt-1">{{ fact.semantic_kind }} | priority {{ fact.priority }} | seq #{{ fact.sequence_number }}</p>
        <div class="flex gap-2 mt-3">
          <button v-if="fact.state === 'dead'" @click="redispatch" class="px-3 py-1 bg-emerald-700 hover:bg-emerald-600 rounded text-xs">{{ t("factDetail.redispatch") }}</button>
          <button @click="deleteFact" class="px-3 py-1 bg-red-700 hover:bg-red-600 rounded text-xs">{{ t("common.delete") }}</button>
        </div>
      </div>

      <!-- Details grid -->
      <div class="grid md:grid-cols-2 gap-6 mb-6">
        <div class="bg-gray-800 rounded-lg p-5 border border-gray-700">
          <h3 class="text-sm font-semibold text-gray-400 mb-3 uppercase tracking-wider">{{ t("factDetail.payload") }}</h3>
          <pre class="text-sm text-gray-300 whitespace-pre-wrap bg-gray-900 rounded p-3 overflow-auto max-h-64">{{ JSON.stringify(fact.payload, null, 2) }}</pre>
        </div>

        <div class="bg-gray-800 rounded-lg p-5 border border-gray-700">
          <h3 class="text-sm font-semibold text-gray-400 mb-3 uppercase tracking-wider">{{ t("factDetail.metadata") }}</h3>
          <dl class="space-y-2 text-sm">
            <div class="flex justify-between"><dt class="text-gray-400">{{ t("factDetail.sourceAnt") }}</dt><dd class="font-mono text-gray-300">{{ fact.source_ant_id ?? "-" }}</dd></div>
            <div class="flex justify-between"><dt class="text-gray-400">{{ t("factDetail.claimedBy") }}</dt><dd class="font-mono text-gray-300">{{ fact.claimed_by ?? "-" }}</dd></div>
            <div class="flex justify-between"><dt class="text-gray-400">{{ t("factDetail.created") }}</dt><dd class="text-gray-300">{{ formatTs(fact.created_at) }}</dd></div>
            <div class="flex justify-between"><dt class="text-gray-400">{{ t("factDetail.resolved") }}</dt><dd class="text-gray-300">{{ formatTs(fact.resolved_at) }}</dd></div>
            <div class="flex justify-between"><dt class="text-gray-400">{{ t("factDetail.ttl") }}</dt><dd class="text-gray-300">{{ fact.ttl_seconds }}s</dd></div>
            <div class="flex justify-between"><dt class="text-gray-400">{{ t("factDetail.confidence") }}</dt><dd class="text-gray-300">{{ fact.confidence ?? "unspecified" }}</dd></div>
            <div class="flex justify-between"><dt class="text-gray-400">{{ t("factDetail.subjectKey") }}</dt><dd class="text-gray-300">{{ fact.subject_key || "-" }}</dd></div>
            <div class="flex justify-between"><dt class="text-gray-400">{{ t("factDetail.supersedes") }}</dt><dd class="font-mono text-gray-300">{{ fact.supersedes || "-" }}</dd></div>
            <div class="flex justify-between"><dt class="text-gray-400">{{ t("factDetail.supersededBy") }}</dt><dd class="font-mono text-gray-300">{{ fact.superseded_by || "-" }}</dd></div>
          </dl>
        </div>
      </div>

      <!-- Tags -->
      <div class="bg-gray-800 rounded-lg p-5 border border-gray-700 mb-6" v-if="fact.domain_tags?.length || fact.need_capabilities?.length">
        <div class="flex gap-8">
          <div v-if="fact.domain_tags?.length">
            <h3 class="text-sm font-semibold text-gray-400 mb-2">{{ t("factDetail.domainTags") }}</h3>
            <div class="flex gap-1 flex-wrap">
              <span v-for="tag in fact.domain_tags" :key="tag" class="px-2 py-0.5 bg-blue-900/50 text-blue-300 rounded text-xs">{{ tag }}</span>
            </div>
          </div>
          <div v-if="fact.need_capabilities?.length">
            <h3 class="text-sm font-semibold text-gray-400 mb-2">{{ t("factDetail.capabilities") }}</h3>
            <div class="flex gap-1 flex-wrap">
              <span v-for="c in fact.need_capabilities" :key="c" class="px-2 py-0.5 bg-emerald-900/50 text-emerald-300 rounded text-xs">{{ c }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Trust -->
      <div class="bg-gray-800 rounded-lg p-5 border border-gray-700 mb-6" v-if="fact.corroborations?.length || fact.contradictions?.length">
        <h3 class="text-sm font-semibold text-gray-400 mb-3 uppercase tracking-wider">{{ t("factDetail.socialValidation") }}</h3>
        <div class="flex gap-8 text-sm">
          <div>
            <span class="text-emerald-400 font-semibold">{{ fact.corroborations?.length ?? 0 }}</span>
            <span class="text-gray-400 ml-1">{{ t("factDetail.corroborations") }}</span>
          </div>
          <div>
            <span class="text-red-400 font-semibold">{{ fact.contradictions?.length ?? 0 }}</span>
            <span class="text-gray-400 ml-1">{{ t("factDetail.contradictions") }}</span>
          </div>
        </div>
      </div>

      <!-- Causation chain -->
      <div class="bg-gray-800 rounded-lg p-5 border border-gray-700" v-if="chain.length > 1">
        <h3 class="text-sm font-semibold text-gray-400 mb-3 uppercase tracking-wider">{{ t("factDetail.causationChain") }}</h3>
        <div class="space-y-2">
          <div v-for="(f, i) in chain" :key="f.fact_id"
            class="flex items-center gap-2 text-sm">
            <span class="text-gray-500 w-6 text-right">{{ i }}</span>
            <span class="text-gray-500">&rarr;</span>
            <router-link :to="`/facts/${f.fact_id}`" class="font-mono text-xs text-blue-400 hover:underline">{{ f.fact_id.slice(0, 8) }}</router-link>
            <span class="text-gray-300">{{ f.fact_type }}</span>
            <span class="px-1.5 py-0.5 rounded text-xs bg-gray-700 text-gray-400">{{ f.state }}</span>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
