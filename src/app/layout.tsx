import type { Metadata } from "next";

export const dynamic = "force-dynamic";
import { ReactNode } from "react";
import "@/app/globals.css";
import { LocalIdentitySync } from "@/components/providers/local-identity-sync";
import { getSettings } from "@/lib/data/repository";
import { sanitizeThemeCustomization } from "@/lib/theme";

export const metadata: Metadata = {
  title: "Dialectica",
  description: "AI-ready platform for structured multi-party debate, discussion, meeting capture, collaboration, knowledge extraction, and graph-aware analysis.",
};

function buildThemeScript(
  defaultTheme: "light" | "dark" | "system",
  defaultPreset: string,
  defaultReduceMotion: boolean,
  defaultCustomTheme: string,
) {
  return `
(function(){
  const storageKeys = {
    theme: 'dialectica-theme',
    preset: 'dialectica-theme-preset',
    motion: 'dialectica-reduce-motion',
    custom: 'dialectica-theme-custom'
  };

  function normalizeHexColor(value, fallback) {
    if (typeof value !== 'string') return fallback;
    const trimmed = value.trim();
    if (!/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(trimmed)) return fallback;
    if (trimmed.length === 4) {
      return ('#' + trimmed[1] + trimmed[1] + trimmed[2] + trimmed[2] + trimmed[3] + trimmed[3]).toLowerCase();
    }
    return trimmed.toLowerCase();
  }

  function parseHex(value) {
    const hex = normalizeHexColor(value, '#355f7b').replace('#', '');
    const numeric = parseInt(hex, 16);
    return { r: (numeric >> 16) & 255, g: (numeric >> 8) & 255, b: numeric & 255 };
  }

  function toHex(value) {
    return value.toString(16).padStart(2, '0');
  }

  function mixHex(source, target, ratio) {
    const left = parseHex(source);
    const right = parseHex(target);
    const mix = (channel, other) => Math.round(channel + (other - channel) * ratio);
    return '#' + toHex(mix(left.r, right.r)) + toHex(mix(left.g, right.g)) + toHex(mix(left.b, right.b));
  }

  function withAlpha(hex, alpha) {
    const rgb = parseHex(hex);
    return 'rgba(' + rgb.r + ', ' + rgb.g + ', ' + rgb.b + ', ' + alpha + ')';
  }

  function sanitizeCustomTheme(value) {
    const fallback = JSON.parse(${JSON.stringify(defaultCustomTheme)});
    const input = value && typeof value === 'object' ? value : {};
    return {
      light: {
        primary: normalizeHexColor(input.light && input.light.primary, fallback.light.primary),
        secondary: normalizeHexColor(input.light && input.light.secondary, fallback.light.secondary),
        accent: normalizeHexColor(input.light && input.light.accent, fallback.light.accent)
      },
      dark: {
        primary: normalizeHexColor(input.dark && input.dark.primary, fallback.dark.primary),
        secondary: normalizeHexColor(input.dark && input.dark.secondary, fallback.dark.secondary),
        accent: normalizeHexColor(input.dark && input.dark.accent, fallback.dark.accent)
      }
    };
  }

  function applyCustomTheme(root, customTheme, mode) {
    const palette = customTheme[mode];
    const isDark = mode === 'dark';
    const variables = {
      '--brand-solid': palette.primary,
      '--brand-strong': 'linear-gradient(135deg, ' + palette.primary + ', ' + palette.secondary + ' 56%, ' + palette.accent + ' 100%)',
      '--brand-soft': withAlpha(palette.primary, isDark ? 0.18 : 0.12),
      '--brand-ink': mixHex(palette.primary, isDark ? '#ffffff' : '#18212d', isDark ? 0.72 : 0.44),
      '--hero-orb-a': withAlpha(palette.secondary, isDark ? 0.2 : 0.16),
      '--hero-orb-b': withAlpha(palette.accent, isDark ? 0.16 : 0.12),
      '--hero-orb-c': withAlpha(mixHex(palette.secondary, palette.accent, 0.45), isDark ? 0.16 : 0.11),
      '--nav-active-bg': withAlpha(palette.primary, isDark ? 0.24 : 0.14),
      '--nav-active-fg': isDark ? '#ffffff' : '#18212d'
    };
    Object.keys(variables).forEach((name) => root.style.setProperty(name, variables[name]));
  }

  function clearCustomTheme(root) {
    ['--brand-solid','--brand-strong','--brand-soft','--brand-ink','--hero-orb-a','--hero-orb-b','--hero-orb-c','--nav-active-bg','--nav-active-fg'].forEach((name) => root.style.removeProperty(name));
  }

  try {
    const storedTheme = localStorage.getItem(storageKeys.theme);
    const storedPreset = localStorage.getItem(storageKeys.preset);
    const storedMotion = localStorage.getItem(storageKeys.motion);
    const storedCustomTheme = localStorage.getItem(storageKeys.custom);
    const theme = storedTheme === 'light' || storedTheme === 'dark' || storedTheme === 'system' ? storedTheme : '${defaultTheme}';
    const preset = ['paper', 'midnight', 'dialectica', 'custom'].includes(storedPreset || '') ? storedPreset : '${defaultPreset}';
    const reduceMotion = storedMotion === null ? ${defaultReduceMotion ? 'true' : 'false'} : storedMotion === 'true';
    const customTheme = sanitizeCustomTheme(storedCustomTheme ? JSON.parse(storedCustomTheme) : JSON.parse(${JSON.stringify(defaultCustomTheme)}));
    localStorage.setItem(storageKeys.theme, theme);
    localStorage.setItem(storageKeys.preset, preset);
    localStorage.setItem(storageKeys.motion, String(reduceMotion));
    localStorage.setItem(storageKeys.custom, JSON.stringify(customTheme));
    const root = document.documentElement;
    const media = window.matchMedia('(prefers-color-scheme: dark)');

    function applyResolvedTheme() {
      const systemDark = media.matches;
      const resolved = theme === 'system' ? (systemDark ? 'dark' : 'light') : theme;
      root.classList.toggle('dark', resolved === 'dark');
      root.dataset.themePreset = preset;
      root.dataset.motion = reduceMotion ? 'reduce' : 'full';
      if (preset === 'custom') {
        applyCustomTheme(root, customTheme, resolved);
      } else {
        clearCustomTheme(root);
      }
    }

    applyResolvedTheme();
    if (theme === 'system') {
      const listener = function() {
        applyResolvedTheme();
      };
      if (typeof media.addEventListener === 'function') {
        media.addEventListener('change', listener);
      } else if (typeof media.addListener === 'function') {
        media.addListener(listener);
      }
    }
  } catch (error) {
    document.documentElement.classList.remove('dark');
    document.documentElement.dataset.themePreset = '${defaultPreset}';
    document.documentElement.dataset.motion = '${defaultReduceMotion ? 'reduce' : 'full'}';
  }
})();`;
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const settings = await getSettings({ includeSecrets: false });
  const customTheme = sanitizeThemeCustomization(settings.appearancePreferences.customTheme);

  return (
    <html suppressHydrationWarning>
      <body>
        <script
          dangerouslySetInnerHTML={{
            __html: buildThemeScript(
              settings.theme,
              settings.appearancePreferences.themePreset,
              settings.appearancePreferences.reduceMotion,
              JSON.stringify(customTheme),
            ),
          }}
        />
        <script dangerouslySetInnerHTML={{ __html: `try{localStorage.setItem('dialectica-datetime-format','${settings.datetimeFormat === "relative" ? "relative" : "absolute"}')}catch(e){}` }} />
        <LocalIdentitySync serverIdentityId={settings.profile.localIdentityId} />
        {children}
      </body>
    </html>
  );
}

