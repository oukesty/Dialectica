import { AppLocale } from "@/lib/types";

const localeMap: Record<AppLocale, string> = {
  "zh-CN": "zh-CN",
  en: "en-US",
  ja: "ja-JP",
  ko: "ko-KR",
  fr: "fr-FR",
  ru: "ru-RU",
};

const RELATIVE_UNITS: Array<{ max: number; divisor: number; unit: Intl.RelativeTimeFormatUnit }> = [
  { max: 60, divisor: 1, unit: "second" },
  { max: 3600, divisor: 60, unit: "minute" },
  { max: 86400, divisor: 3600, unit: "hour" },
  { max: 604800, divisor: 86400, unit: "day" },
  { max: 2592000, divisor: 604800, unit: "week" },
  { max: 31536000, divisor: 2592000, unit: "month" },
];

function formatRelative(date: Date, locale: AppLocale): string {
  const diffSec = (date.getTime() - Date.now()) / 1000;
  const absDiff = Math.abs(diffSec);
  for (const { max, divisor, unit } of RELATIVE_UNITS) {
    if (absDiff < max) {
      try {
        return new Intl.RelativeTimeFormat(localeMap[locale], { numeric: "auto" })
          .format(Math.round(diffSec / divisor), unit);
      } catch {
        break;
      }
    }
  }
  // Fallback to absolute for dates > 1 year old
  return formatAbsolute(date, locale);
}

function formatAbsolute(date: Date, locale: AppLocale): string {
  return new Intl.DateTimeFormat(localeMap[locale], {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

/** Module-level default — auto-reads from localStorage, settable via setGlobalDatetimeFormat. */
let globalDatetimeFormat: "relative" | "absolute" = "absolute";

// Auto-initialize from localStorage if available (set by root layout script)
if (typeof localStorage !== "undefined") {
  try {
    const stored = localStorage.getItem("dialectica-datetime-format");
    if (stored === "relative") globalDatetimeFormat = "relative";
  } catch { /* SSR or restricted context */ }
}

export function setGlobalDatetimeFormat(mode: "relative" | "absolute") {
  globalDatetimeFormat = mode;
  if (typeof localStorage !== "undefined") {
    try { localStorage.setItem("dialectica-datetime-format", mode); } catch { /* */ }
  }
}

export function formatDateTime(value: string, locale: AppLocale, mode?: "relative" | "absolute") {
  const date = new Date(value);
  const effective = mode ?? globalDatetimeFormat;
  if (effective === "relative") return formatRelative(date, locale);
  return formatAbsolute(date, locale);
}
