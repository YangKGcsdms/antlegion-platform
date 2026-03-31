import { ref, computed } from "vue";
import zh from "./zh";
import en from "./en";

export type Locale = "zh" | "en";
type Key = keyof typeof zh;

const messages: Record<Locale, Record<string, string>> = { zh, en };

// 默认从 localStorage 读取，fallback 到中文
const stored = (typeof localStorage !== "undefined" && localStorage.getItem("locale")) as Locale | null;
const locale = ref<Locale>(stored === "en" ? "en" : "zh");

export function useI18n() {
  function t(key: Key): string {
    return messages[locale.value][key] ?? key;
  }

  function setLocale(l: Locale) {
    locale.value = l;
    localStorage.setItem("locale", l);
  }

  return {
    t,
    locale: computed(() => locale.value),
    setLocale,
    isZh: computed(() => locale.value === "zh"),
  };
}
