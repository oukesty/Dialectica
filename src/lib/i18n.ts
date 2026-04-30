import en from "@/locales/en.json";
import fr from "@/locales/fr.json";
import ja from "@/locales/ja.json";
import ko from "@/locales/ko.json";
import ru from "@/locales/ru.json";
import zhCN from "@/locales/zh-CN.json";
import { APP_LOCALES, AppLocale } from "@/lib/types";

export type Dictionary = typeof en;

export const dictionaries: Record<AppLocale, Dictionary> = {
  en,
  fr,
  ja,
  ko,
  ru,
  "zh-CN": zhCN,
};

export function isLocale(value: string): value is AppLocale {
  return (APP_LOCALES as readonly string[]).includes(value);
}

export function resolveInitialLocaleFromAcceptLanguage(value?: string | null): AppLocale {
  const candidates = (value ?? "")
    .split(",")
    .map((part) => part.trim().split(";")[0]?.trim().toLowerCase())
    .filter((part): part is string => Boolean(part));

  for (const candidate of candidates) {
    if (candidate.startsWith("zh")) {
      return "zh-CN";
    }
    if (candidate.startsWith("en")) {
      return "en";
    }
    if (candidate.startsWith("ja")) {
      return "ja";
    }
    if (candidate.startsWith("ko")) {
      return "ko";
    }
    if (candidate.startsWith("fr")) {
      return "fr";
    }
    if (candidate.startsWith("ru")) {
      return "ru";
    }
  }

  return "en";
}

export async function getDictionary(locale: AppLocale) {
  return dictionaries[locale] ?? dictionaries.en;
}

export function getNestedValue(dictionary: Dictionary, path: string) {
  return path.split(".").reduce<unknown>((current, segment) => {
    if (!current || typeof current !== "object") {
      return undefined;
    }
    return (current as Record<string, unknown>)[segment];
  }, dictionary);
}
