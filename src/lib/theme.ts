import { ThemeMode } from "@/lib/types";

export interface ThemePalette {
  primary: string;
  secondary: string;
  accent: string;
}

export interface ThemeCustomization {
  light: ThemePalette;
  dark: ThemePalette;
}

export const themeStorageKeys = {
  theme: "dialectica-theme",
  preset: "dialectica-theme-preset",
  motion: "dialectica-reduce-motion",
  custom: "dialectica-theme-custom",
} as const;

export const defaultCustomTheme: ThemeCustomization = {
  light: {
    primary: "#355f7b",
    secondary: "#557593",
    accent: "#b38457",
  },
  dark: {
    primary: "#7da5c3",
    secondary: "#6f8eb1",
    accent: "#d4a16c",
  },
};

const hexColorPattern = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

function expandHex(value: string) {
  const normalized = value.trim();
  if (normalized.length === 4) {
    return `#${normalized[1]}${normalized[1]}${normalized[2]}${normalized[2]}${normalized[3]}${normalized[3]}`.toLowerCase();
  }
  return normalized.toLowerCase();
}

function parseHex(value: string) {
  const normalized = expandHex(value);
  const hex = normalized.replace("#", "");
  const numeric = Number.parseInt(hex, 16);
  return {
    r: (numeric >> 16) & 255,
    g: (numeric >> 8) & 255,
    b: numeric & 255,
  };
}

function toHex(value: number) {
  return value.toString(16).padStart(2, "0");
}

function mixHex(source: string, target: string, ratio: number) {
  const left = parseHex(source);
  const right = parseHex(target);
  const mix = (channel: number, other: number) => Math.round(channel + (other - channel) * ratio);
  return `#${toHex(mix(left.r, right.r))}${toHex(mix(left.g, right.g))}${toHex(mix(left.b, right.b))}`;
}

function withAlpha(hex: string, alpha: number) {
  const { r, g, b } = parseHex(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function normalizeHexColor(value: unknown, fallback: string) {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  if (!hexColorPattern.test(trimmed)) return fallback;
  return expandHex(trimmed);
}

export function sanitizeThemeCustomization(value: unknown): ThemeCustomization {
  const candidate = value && typeof value === "object" ? (value as Partial<ThemeCustomization>) : {};
  return {
    light: {
      primary: normalizeHexColor(candidate.light?.primary, defaultCustomTheme.light.primary),
      secondary: normalizeHexColor(candidate.light?.secondary, defaultCustomTheme.light.secondary),
      accent: normalizeHexColor(candidate.light?.accent, defaultCustomTheme.light.accent),
    },
    dark: {
      primary: normalizeHexColor(candidate.dark?.primary, defaultCustomTheme.dark.primary),
      secondary: normalizeHexColor(candidate.dark?.secondary, defaultCustomTheme.dark.secondary),
      accent: normalizeHexColor(candidate.dark?.accent, defaultCustomTheme.dark.accent),
    },
  };
}

export function resolveThemeMode(theme: ThemeMode, prefersDark = false): "light" | "dark" {
  if (theme === "system") {
    return prefersDark ? "dark" : "light";
  }
  return theme;
}

export function getCustomThemeVariables(customTheme: ThemeCustomization, mode: "light" | "dark") {
  const palette = customTheme[mode];
  const isDark = mode === "dark";
  return {
    "--brand-solid": palette.primary,
    "--brand-strong": `linear-gradient(135deg, ${palette.primary}, ${palette.secondary} 56%, ${palette.accent} 100%)`,
    "--brand-soft": withAlpha(palette.primary, isDark ? 0.18 : 0.12),
    "--brand-ink": mixHex(palette.primary, isDark ? "#ffffff" : "#18212d", isDark ? 0.72 : 0.44),
    "--hero-orb-a": withAlpha(palette.secondary, isDark ? 0.2 : 0.16),
    "--hero-orb-b": withAlpha(palette.accent, isDark ? 0.16 : 0.12),
    "--hero-orb-c": withAlpha(mixHex(palette.secondary, palette.accent, 0.45), isDark ? 0.16 : 0.11),
    "--nav-active-bg": withAlpha(palette.primary, isDark ? 0.24 : 0.14),
    "--nav-active-fg": isDark ? "#ffffff" : "#18212d",
  } as const;
}

const customThemeVariableKeys = [
  "--brand-solid",
  "--brand-strong",
  "--brand-soft",
  "--brand-ink",
  "--hero-orb-a",
  "--hero-orb-b",
  "--hero-orb-c",
  "--nav-active-bg",
  "--nav-active-fg",
] as const;

export function applyAppearanceSettings({
  theme,
  preset,
  reduceMotion,
  customTheme,
  persist = true,
}: {
  theme: ThemeMode;
  preset: string;
  reduceMotion: boolean;
  customTheme: ThemeCustomization;
  persist?: boolean;
}) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const prefersDark = typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;
  const resolved = resolveThemeMode(theme, prefersDark);
  const documentWithTransition = document as Document & {
    startViewTransition?: (callback: () => void) => { finished?: Promise<unknown> };
  };

  const commitAppearance = () => {
    if (persist && typeof window !== "undefined") {
      window.localStorage.setItem(themeStorageKeys.theme, theme);
      window.localStorage.setItem(themeStorageKeys.preset, preset);
      window.localStorage.setItem(themeStorageKeys.motion, String(reduceMotion));
      window.localStorage.setItem(themeStorageKeys.custom, JSON.stringify(sanitizeThemeCustomization(customTheme)));
    }

    root.classList.toggle("dark", resolved === "dark");
    root.dataset.themePreset = preset;
    root.dataset.motion = reduceMotion ? "reduce" : "full";

    if (preset === "custom") {
      const variables = getCustomThemeVariables(sanitizeThemeCustomization(customTheme), resolved);
      for (const [name, value] of Object.entries(variables)) {
        root.style.setProperty(name, value);
      }
    } else {
      for (const key of customThemeVariableKeys) {
        root.style.removeProperty(key);
      }
    }
  };

  const routeComplexity = root.dataset.routeComplexity;

  if (!persist || reduceMotion || routeComplexity === "heavy" || typeof window === "undefined" || typeof documentWithTransition.startViewTransition !== "function") {
    commitAppearance();
    return;
  }

  if (root.dataset.themeTransition === "active") {
    commitAppearance();
    return;
  }

  root.dataset.themeTransition = "active";
  const transition = documentWithTransition.startViewTransition(() => {
    commitAppearance();
  });
  (transition.finished ?? Promise.resolve()).finally(() => {
    if (root.dataset.themeTransition === "active") {
      delete root.dataset.themeTransition;
    }
  });
}


