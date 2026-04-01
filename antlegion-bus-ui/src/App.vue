<script setup lang="ts">
import { RouterLink, RouterView } from "vue-router";
import { useI18n } from "./i18n";

const { t, locale, setLocale } = useI18n();

function toggleLocale() {
  setLocale(locale.value === "zh" ? "en" : "zh");
}
</script>

<template>
  <div class="min-h-screen bg-gray-900 text-gray-100">
    <!-- Nav -->
    <nav class="bg-gray-800 border-b border-gray-700">
      <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div class="flex h-14 items-center justify-between">
          <div class="flex items-center gap-2">
            <span class="text-lg font-semibold text-emerald-400">{{ t("nav.brand") }}</span>
          </div>
          <div class="flex items-center gap-4 text-sm">
            <RouterLink to="/" class="hover:text-emerald-400 transition-colors" active-class="text-emerald-400">{{ t("nav.dashboard") }}</RouterLink>
            <RouterLink to="/facts" class="hover:text-emerald-400 transition-colors" active-class="text-emerald-400">{{ t("nav.facts") }}</RouterLink>
            <RouterLink to="/ants" class="hover:text-emerald-400 transition-colors" active-class="text-emerald-400">{{ t("nav.ants") }}</RouterLink>
            <RouterLink to="/events" class="hover:text-emerald-400 transition-colors" active-class="text-emerald-400">{{ t("nav.events") }}</RouterLink>
            <RouterLink to="/kanban" class="hover:text-emerald-400 transition-colors" active-class="text-emerald-400">{{ t("nav.kanban") }}</RouterLink>
            <RouterLink to="/admin" class="hover:text-orange-400 transition-colors" active-class="text-orange-400">{{ t("nav.admin") }}</RouterLink>
            <button @click="toggleLocale"
              class="ml-2 px-2 py-0.5 rounded bg-gray-700 hover:bg-gray-600 text-xs font-medium transition-colors">
              {{ locale === "zh" ? "EN" : "中" }}
            </button>
          </div>
        </div>
      </div>
    </nav>

    <!-- Content -->
    <main class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      <RouterView />
    </main>
  </div>
</template>
