"use client";

import { startTransition, useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type ComponentType } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  BookOpenText,
  BrainCircuit,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  KeyRound,
  Languages,
  Palette,
  RefreshCcw,
  Shield,
  SlidersHorizontal,
  Sparkles,
  Users,
} from "lucide-react";
import { Avatar, ProfileAvatar } from "@/components/ui/avatar";
import { Badge, Button, Panel } from "@/components/ui/primitives";
import { avatarPresetStyles, sanitizeAvatarDataUrl } from "@/lib/avatar";
import { createDefaultSettings, getDefaultProfileDisplayName } from "@/lib/factories";
import { dictionaries, getNestedValue } from "@/lib/i18n";
import { formatDateTime, setGlobalDatetimeFormat } from "@/lib/format";
import { getImplementedConversationInputCapabilities } from "@/lib/providers/provider-catalog";
import { primeSettingsSnapshot, saveSettingsChanges, SettingsConflictError } from "@/lib/settings-client";
import { shortcutDefinitions, SHORTCUT_SETTINGS_UPDATED_EVENT } from "@/lib/keyboard-shortcuts";
import { applyAppearanceSettings, defaultCustomTheme, normalizeHexColor, sanitizeThemeCustomization } from "@/lib/theme";
import { AppLocale, AppSettings, AVATAR_PRESETS, AvatarPreset, DISPLAY_LOCALE_ORDER, LOCALE_AUTONYMS, ProviderId, ProviderRuntimeConfig, ThemeMode, ThemePreset } from "@/lib/types";
import { createScopedId } from "@/lib/utils";

const fieldClass = "form-field";
const helperCardClass =
  "settings-helper-card motion-card contain-paint rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-5 transition-all duration-200";
const assistantSessionCleanupDayOptions: Array<AppSettings["privacy"]["assistantSessionCleanup"]["maxIdleDays"]> = [30, 90, 180, 365];

type SettingsUpdater = AppSettings | ((current: AppSettings) => AppSettings);
type MessageTone = "default" | "success" | "danger";

const baseThemePreviewStyles: Record<Exclude<ThemePreset, "custom">, string[]> = {
  dialectica: ["#355f7b", "#557593", "#b38457"],
  paper: ["#556276", "#c8b8a8", "#ece6dd"],
  midnight: ["#2563eb", "#0891b2", "#14b8a6"],
};

function applyAppearance(
  theme: ThemeMode,
  preset: ThemePreset,
  reduceMotion: boolean,
  customTheme: AppSettings["appearancePreferences"]["customTheme"],
  persist = false,
) {
  applyAppearanceSettings({
    theme,
    preset,
    reduceMotion,
    customTheme: sanitizeThemeCustomization(customTheme),
    persist,
  });
}

function translateFromDictionary(locale: AppLocale, path: string, params?: Record<string, string>) {
  const dictionary = dictionaries[locale] ?? dictionaries.en;
  const found = getNestedValue(dictionary, path);
  if (typeof found !== "string") {
    return path;
  }
  if (!params) {
    return found;
  }
  return Object.entries(params).reduce(
    (value, [key, replacement]) => value.replaceAll(`{${key}}`, replacement),
    found,
  );
}

function switchLocalePath(pathname: string, locale: AppLocale) {
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length === 0) return `/${locale}`;
  segments[0] = locale;
  return `/${segments.join("/")}`;
}

function serializeComparableSettings(settings: AppSettings) {
  const comparableProviders = Object.fromEntries(
    (Object.entries(settings.provider.providers) as [ProviderId, ProviderRuntimeConfig][]).map(([providerId, config]) => [
      providerId,
      {
        mode: config.mode,
        model: config.model,
        baseUrl: config.baseUrl,
        apiKey: config.apiKey,
        organization: config.organization,
        temperature: config.temperature,
        notes: config.notes,
        hasStoredApiKey: Boolean(config.hasStoredApiKey && !config.clearStoredApiKey),
        clearStoredApiKey: Boolean(config.clearStoredApiKey),
      },
    ]),
  );

  return JSON.stringify({
    locale: settings.locale,
    theme: settings.theme,
    datetimeFormat: settings.datetimeFormat,
    profile: settings.profile,
    appearancePreferences: {
      themePreset: settings.appearancePreferences.themePreset,
      reduceMotion: settings.appearancePreferences.reduceMotion,
      customTheme: settings.appearancePreferences.customTheme,
      customThemeName: settings.appearancePreferences.customThemeName,
      savedThemes: settings.appearancePreferences.savedThemes,
    },
    defaultScenario: settings.defaultScenario,
    defaultExportFormat: settings.defaultExportFormat,
    provider: {
      activeProviderId: settings.provider.activeProviderId,
      activeMode: settings.provider.activeMode,
      mockEmphasis: settings.provider.mockEmphasis,
      autoSummary: settings.provider.autoSummary,
      autoEvaluation: settings.provider.autoEvaluation,
      enableStreaming: settings.provider.enableStreaming,
      requestTimeoutMs: settings.provider.requestTimeoutMs,
      preferServerKeys: settings.provider.preferServerKeys,
      allowFallbackToScaffold: settings.provider.allowFallbackToScaffold,
      providers: comparableProviders,
    },
    discussionPreferences: settings.discussionPreferences,
    collaborationPreferences: settings.collaborationPreferences,
    knowledgePreferences: settings.knowledgePreferences,
    aiPreferences: settings.aiPreferences,
    uploadPreferences: settings.uploadPreferences,
    participantNicknames: settings.participantNicknames,
    tagColors: settings.tagColors,
    customShortcuts: settings.customShortcuts,
    quickReplies: settings.quickReplies,
    projectOrder: settings.projectOrder,
    savedTemplates: settings.savedTemplates,
    emailNotifications: settings.emailNotifications,
    privacy: settings.privacy,
  });
}

function SectionHeader({ title, body, icon: Icon }: { title: string; body: string; icon: ComponentType<{ className?: string }> }) {
  return (
    <div className="flex items-start gap-3">
      <span className="theme-icon-tile inline-flex h-11 w-11 items-center justify-center rounded-2xl">
        <Icon className="h-5 w-5" />
      </span>
      <div>
        <h2 className="font-display text-2xl font-semibold tracking-tight">{title}</h2>
        <p className="mt-1 text-sm leading-6 text-[color:var(--muted)]">{body}</p>
      </div>
    </div>
  );
}

function ToggleRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-4 rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-4 py-3 text-sm font-medium">
      <span>{label}</span>
      <input type="checkbox" className="h-4 w-4 accent-[color:var(--brand-solid)]" checked={checked} onChange={(event) => onChange(event.target.checked)} />
    </label>
  );
}

function preferredExportLabel(format: AppSettings["defaultExportFormat"], t: (key: string) => string) {
  if (format === "markdown") return t("importExport.markdown");
  if (format === "txt") return t("importExport.txt");
  return t("importExport.json");
}

function messageToneClass(tone: MessageTone) {
  if (tone === "danger") return "text-sm text-rose-600 dark:text-rose-300";
  if (tone === "success") return "text-sm text-emerald-600 dark:text-emerald-300";
  return "text-sm text-[color:var(--muted)]";
}

export function SettingsPage({
  locale,
  initialSettings,
}: {
  locale: AppLocale;
  initialSettings: AppSettings;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [settings, setSettings] = useState(initialSettings);
  const [savedSettings, setSavedSettings] = useState(initialSettings);
  const [message, setMessage] = useState<string | null>(null);
  const [messageTone, setMessageTone] = useState<MessageTone>("default");
  const [saving, setSaving] = useState(false);
  const [dataManagementBusy, setDataManagementBusy] = useState(false);
  const [testingProviderId, setTestingProviderId] = useState<ProviderId | null>(null);
  const [revealedProviderKeys, setRevealedProviderKeys] = useState<Partial<Record<ProviderId, boolean>>>({});
  const [avatarEditorOpen, setAvatarEditorOpen] = useState(false);
  const [appearanceAdvancedOpen, setAppearanceAdvancedOpen] = useState(
    initialSettings.appearancePreferences.themePreset === "custom" || initialSettings.appearancePreferences.savedThemes.length > 0,
  );
  const [defaultsAdvancedOpen, setDefaultsAdvancedOpen] = useState(false);
  const [providerCatalogOpen, setProviderCatalogOpen] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement | null>(null);
  const appearancePreviewInitializedRef = useRef(false);
  const savedSettingsRef = useRef(savedSettings);
  const previewLocale = settings.locale ?? locale;
  const t = useCallback((path: string, params?: Record<string, string>) => translateFromDictionary(previewLocale, path, params), [previewLocale]);
  const translateWithLocale = useCallback((targetLocale: AppLocale, path: string, params?: Record<string, string>) => translateFromDictionary(targetLocale, path, params), []);

  useEffect(() => {
    setSettings(initialSettings);
    setSavedSettings(initialSettings);
    setAvatarEditorOpen(false);
  }, [initialSettings]);

  const recommendedSettings = useMemo(() => {
    const defaults = createDefaultSettings(settings.locale ?? locale);
    return {
      ...defaults,
      profile: {
        ...defaults.profile,
        localIdentityId: settings.profile.localIdentityId,
      },
      appearancePreferences: {
        ...defaults.appearancePreferences,
        savedThemes: settings.appearancePreferences.savedThemes,
      },
    };
  }, [locale, settings.appearancePreferences.savedThemes, settings.locale, settings.profile.localIdentityId]);

  const themePreviewStyles = useMemo(
    () => ({
      ...baseThemePreviewStyles,
      custom: [
        settings.appearancePreferences.customTheme.light.primary,
        settings.appearancePreferences.customTheme.light.secondary,
        settings.appearancePreferences.customTheme.light.accent,
      ],
    }),
    [settings.appearancePreferences.customTheme],
  );

  const comparableSettings = useMemo(() => serializeComparableSettings(settings), [settings]);
  const comparableSavedSettings = useMemo(() => serializeComparableSettings(savedSettings), [savedSettings]);
  const dirty = useMemo(() => comparableSettings !== comparableSavedSettings, [comparableSavedSettings, comparableSettings]);
  const [activeTab, setActiveTab] = useState<"profile" | "appearance" | "provider" | "preferences" | "privacy">("profile");

  const visibleProviderDescriptors = useMemo(
    () => settings.provider.descriptors.filter((descriptor) => descriptor.id !== "mock"),
    [settings.provider.descriptors],
  );
  const activeProviderId = visibleProviderDescriptors.some((descriptor) => descriptor.id === settings.provider.activeProviderId)
    ? settings.provider.activeProviderId
    : (visibleProviderDescriptors[0]?.id ?? settings.provider.activeProviderId);
  const activeConfig = settings.provider.providers[activeProviderId];
  const savedActiveConfig = savedSettings.provider.providers[activeProviderId];
  const activeDescriptor = settings.provider.descriptors.find((descriptor) => descriptor.id === activeProviderId);
  const activeProviderDisabled = activeProviderId === "disabled" || activeConfig.mode === "disabled";
  const activeModelDisplay = activeProviderDisabled ? t("settings.disabledAdapterNoModel") : activeConfig.model;
  const providerUsesServerConfig = activeConfig.mode === "api";
  const providerSecretVisible = Boolean(revealedProviderKeys[activeProviderId]);
  const providerHasStoredKey = Boolean(activeConfig.hasStoredApiKey && !activeConfig.clearStoredApiKey);
  const hasCustomAvatar = Boolean(settings.profile.avatarImageDataUrl);
  const providerStatusTone = activeProviderDisabled ? "danger" : activeConfig.testState === "ready" ? "success" : activeConfig.testState === "error" ? "danger" : activeConfig.testState === "testing" ? "accent" : "default";
  const activeProviderStatusLabel = activeProviderDisabled ? t("providerModes.disabled") : t(`connectionStates.${activeConfig.testState}`);
  const providerTestResultStaged = Boolean(savedActiveConfig && (
    activeConfig.testState !== savedActiveConfig.testState
    || activeConfig.lastCheckedAt !== savedActiveConfig.lastCheckedAt
  ));

  const restoreSavedAppearancePreview = useCallback(() => {
    applyAppearance(
      savedSettings.theme,
      savedSettings.appearancePreferences.themePreset,
      savedSettings.appearancePreferences.reduceMotion,
      savedSettings.appearancePreferences.customTheme,
      false,
    );
  }, [
    savedSettings.appearancePreferences.customTheme,
    savedSettings.appearancePreferences.reduceMotion,
    savedSettings.appearancePreferences.themePreset,
    savedSettings.theme,
  ]);

  useEffect(() => {
    if (!appearancePreviewInitializedRef.current) {
      appearancePreviewInitializedRef.current = true;
      return undefined;
    }
    applyAppearance(
      settings.theme,
      settings.appearancePreferences.themePreset,
      settings.appearancePreferences.reduceMotion,
      settings.appearancePreferences.customTheme,
      false,
    );
    return undefined;
  }, [
    settings.appearancePreferences.customTheme,
    settings.appearancePreferences.reduceMotion,
    settings.appearancePreferences.themePreset,
    settings.theme,
  ]);

  useEffect(() => {
    savedSettingsRef.current = savedSettings;
  }, [savedSettings]);

  useEffect(() => () => {
    const nextSavedSettings = savedSettingsRef.current;
    applyAppearance(
      nextSavedSettings.theme,
      nextSavedSettings.appearancePreferences.themePreset,
      nextSavedSettings.appearancePreferences.reduceMotion,
      nextSavedSettings.appearancePreferences.customTheme,
      false,
    );
  }, []);
  const setDraftMessage = (nextMessage: string | null, tone: MessageTone = "default") => {
    setMessage(nextMessage);
    setMessageTone(tone);
  };

  const readErrorMessage = async (response: Response) => {
    const payload = await response.json().catch(() => null) as { error?: string } | null;
    return payload?.error ?? t("errors.unexpected");
  };

  const stageSettings = (updater: SettingsUpdater, nextMessage?: string, tone: MessageTone = "default") => {
    setSettings((current) => (typeof updater === "function" ? (updater as (value: AppSettings) => AppSettings)(current) : updater));
    setDraftMessage(nextMessage ?? null, tone);
  };

  const setProviderConfig = (providerId: ProviderId, updater: (config: ProviderRuntimeConfig) => ProviderRuntimeConfig, nextMessage?: string) => {
    stageSettings((current) => ({
      ...current,
      provider: {
        ...current.provider,
        providers: {
          ...current.provider.providers,
          [providerId]: updater(current.provider.providers[providerId]),
        },
      },
    }), nextMessage);
  };

  const updateDiscussionPreferences = (patch: Partial<AppSettings["discussionPreferences"]>, nextMessage?: string) => {
    stageSettings((current) => ({
      ...current,
      discussionPreferences: {
        ...current.discussionPreferences,
        ...patch,
      },
    }), nextMessage);
  };

  const updateKnowledgePreferences = (patch: Partial<AppSettings["knowledgePreferences"]>, nextMessage?: string) => {
    stageSettings((current) => ({
      ...current,
      knowledgePreferences: {
        ...current.knowledgePreferences,
        ...patch,
      },
    }), nextMessage);
  };

  useEffect(() => {
    if (!dirty || saving) return undefined;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = t("settings.unsavedLeavePrompt");
      return t("settings.unsavedLeavePrompt");
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [dirty, saving, t]);

  useEffect(() => {
    if (!dirty || saving) return undefined;
    const handleDocumentClick = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest("a[href]") as HTMLAnchorElement | null;
      if (!anchor) return;
      if (anchor.target && anchor.target !== "_self") return;
      if (anchor.hasAttribute("download")) return;
      const href = anchor.getAttribute("href") ?? "";
      if (!href || href.startsWith("#") || href.startsWith("javascript:")) return;
      const currentUrl = new URL(window.location.href);
      const nextUrl = new URL(anchor.href, currentUrl.href);
      if (nextUrl.origin !== currentUrl.origin) return;
      if (nextUrl.pathname === currentUrl.pathname && nextUrl.search === currentUrl.search) return;
      if (window.confirm(t("settings.unsavedLeavePrompt"))) {
        restoreSavedAppearancePreview();
        return;
      }
      event.preventDefault();
      event.stopPropagation();
    };
    document.addEventListener("click", handleDocumentClick, true);
    return () => document.removeEventListener("click", handleDocumentClick, true);
  }, [dirty, restoreSavedAppearancePreview, saving, t]);

  useEffect(() => {
    primeSettingsSnapshot(savedSettings);
  }, [savedSettings]);

  const persistSettings = (nextSettings: AppSettings, successMessage = t("settings.saved")) => {
    setSaving(true);
    setDraftMessage(null);
    startTransition(async () => {
      try {
        const saved = await saveSettingsChanges(savedSettings, nextSettings);
        setSettings(saved);
        setSavedSettings(saved);
        window.dispatchEvent(new CustomEvent(SHORTCUT_SETTINGS_UPDATED_EVENT, { detail: { settings: saved } }));
        applyAppearance(
          saved.theme,
          saved.appearancePreferences.themePreset,
          saved.appearancePreferences.reduceMotion,
          saved.appearancePreferences.customTheme,
          true,
        );
        setGlobalDatetimeFormat(saved.datetimeFormat);
        setDraftMessage(successMessage, "success");
        if (saved.locale !== locale) {
          window.location.assign(switchLocalePath(pathname, saved.locale));
        }
      } catch (caught) {
        if (caught instanceof SettingsConflictError && caught.currentSettings) {
          setSettings(caught.currentSettings);
          setSavedSettings(caught.currentSettings);
          applyAppearance(
            caught.currentSettings.theme,
            caught.currentSettings.appearancePreferences.themePreset,
            caught.currentSettings.appearancePreferences.reduceMotion,
            caught.currentSettings.appearancePreferences.customTheme,
            true,
          );
          setGlobalDatetimeFormat(caught.currentSettings.datetimeFormat);
        }
        setDraftMessage(caught instanceof Error ? caught.message : t("errors.saveFailed"), "danger");
      } finally {
        setSaving(false);
      }
    });
  };

  const saveSettings = () => {
    if (!dirty) {
      setDraftMessage(t("settings.saved"), "success");
      return;
    }
    persistSettings(settings, t("settings.saved"));
  };

  const discardChanges = () => {
    restoreSavedAppearancePreview();
    setSettings(savedSettings);
    setDraftMessage(translateWithLocale(savedSettings.locale, "settings.changesDiscarded"));
    if (avatarInputRef.current) avatarInputRef.current.value = "";
  };

  const restoreRecommended = () => {
    stageSettings(recommendedSettings, t("settings.changesPending"));
  };

  const exportAllData = async () => {
    setDataManagementBusy(true);
    setDraftMessage(null);
    try {
      const response = await fetch("/api/data-management");
      if (!response.ok) {
        throw new Error(await readErrorMessage(response));
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `dialectica-backup-${Date.now()}.json`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (caught) {
      setDraftMessage(caught instanceof Error ? caught.message : t("errors.unexpected"), "danger");
    } finally {
      setDataManagementBusy(false);
    }
  };

  const importAllData = async (file: File) => {
    setDataManagementBusy(true);
    setDraftMessage(null);
    try {
      const text = await file.text();
      const payload = JSON.parse(text);
      const response = await fetch("/api/data-management", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        throw new Error(await readErrorMessage(response));
      }
      const result = (await response.json().catch(() => null)) as { skippedSampleProjectIds?: string[] } | null;
      if ((result?.skippedSampleProjectIds?.length ?? 0) > 0) {
        window.alert(
          previewLocale === "zh-CN"
            ? "备份中的示例项目已被自动跳过，避免恢复为无效的本地副本。"
            : previewLocale === "ja"
              ? "バックアップ内のサンプルプロジェクトは無効なローカルコピーを防ぐため自動的にスキップされました。"
              : previewLocale === "fr"
                ? "Les projets d'exemple presents dans cette sauvegarde ont ete ignores automatiquement afin d'eviter des copies locales invalides."
                : "Sample projects in this backup were skipped automatically to avoid invalid local copies.",
        );
      }
      window.location.reload();
    } catch (caught) {
      setDraftMessage(caught instanceof Error ? caught.message : t("errors.unexpected"), "danger");
    } finally {
      setDataManagementBusy(false);
    }
  };

  const updateCustomThemeColor = (mode: "light" | "dark", key: "primary" | "secondary" | "accent", value: string) => {
    stageSettings((current) => {
      const fallback = defaultCustomTheme[mode][key];
      const sanitized = normalizeHexColor(value, fallback);
      return {
        ...current,
        appearancePreferences: {
          ...current.appearancePreferences,
          customTheme: {
            ...current.appearancePreferences.customTheme,
            [mode]: {
              ...current.appearancePreferences.customTheme[mode],
              [key]: sanitized,
            },
          },
        },
      };
    });
  };

  const updateAvatarPreset = (preset: AvatarPreset) => {
    stageSettings((current) => ({
      ...current,
      profile: { ...current.profile, avatarPreset: preset },
    }), t("settings.changesPending"));
  };

  const saveCurrentCustomTheme = () => {
    const nextName = settings.appearancePreferences.customThemeName.trim() || t("settings.customThemeDefaultName");
    const existing = settings.appearancePreferences.savedThemes.find((theme) => theme.name.toLowerCase() === nextName.toLowerCase());
    const nextTheme = {
      id: existing?.id ?? createScopedId("theme", 10),
      name: nextName,
      customTheme: sanitizeThemeCustomization(settings.appearancePreferences.customTheme),
      updatedAt: new Date().toISOString(),
    };
    const savedThemes = [
      nextTheme,
      ...settings.appearancePreferences.savedThemes.filter((theme) => theme.id !== nextTheme.id && theme.name.toLowerCase() !== nextName.toLowerCase()),
    ].slice(0, 6);
    stageSettings((current) => ({
      ...current,
      appearancePreferences: {
        ...current.appearancePreferences,
        themePreset: "custom",
        customThemeName: nextName,
        customTheme: sanitizeThemeCustomization(current.appearancePreferences.customTheme),
        savedThemes,
      },
    }), t("settings.changesPending"));
  };

  const applySavedCustomTheme = (themeId: string) => {
    const savedTheme = settings.appearancePreferences.savedThemes.find((theme) => theme.id === themeId);
    if (!savedTheme) return;
    stageSettings((current) => ({
      ...current,
      appearancePreferences: {
        ...current.appearancePreferences,
        themePreset: "custom",
        customThemeName: savedTheme.name,
        customTheme: sanitizeThemeCustomization(savedTheme.customTheme),
      },
    }), t("settings.changesPending"));
  };

  const removeSavedCustomTheme = (themeId: string) => {
    stageSettings((current) => ({
      ...current,
      appearancePreferences: {
        ...current.appearancePreferences,
        savedThemes: current.appearancePreferences.savedThemes.filter((theme) => theme.id !== themeId),
      },
    }), t("settings.changesPending"));
  };

  const removeAvatarImage = () => {
    stageSettings((current) => ({
      ...current,
      profile: {
        ...current.profile,
        avatarImageDataUrl: "",
      },
    }), t("settings.avatarRemoved"));
    if (avatarInputRef.current) avatarInputRef.current.value = "";
  };

  const clearStoredProviderKey = () => {
    setProviderConfig(activeProviderId, (config) => ({
      ...config,
      apiKey: "",
      hasStoredApiKey: false,
      maskedApiKey: "",
      clearStoredApiKey: true,
    }), t("settings.providerKeyClearPending"));
  };

  const normalizeAvatarUpload = async (file: File) => {
    const raw = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
      reader.onerror = () => reject(new Error("avatar-read-failed"));
      reader.readAsDataURL(file);
    });
    const direct = sanitizeAvatarDataUrl(raw);
    if (direct) return direct;
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const nextImage = new window.Image();
      nextImage.onload = () => resolve(nextImage);
      nextImage.onerror = () => reject(new Error("avatar-image-invalid"));
      nextImage.src = raw;
    });
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) return "";
    for (const size of [320, 256, 192]) {
      const scale = Math.min(1, size / Math.max(image.width, image.height));
      const width = Math.max(1, Math.round(image.width * scale));
      const height = Math.max(1, Math.round(image.height * scale));
      canvas.width = width;
      canvas.height = height;
      context.clearRect(0, 0, width, height);
      context.drawImage(image, 0, 0, width, height);
      for (const quality of [0.92, 0.82, 0.72, 0.62]) {
        const candidate = canvas.toDataURL("image/webp", quality);
        const safeCandidate = sanitizeAvatarDataUrl(candidate);
        if (safeCandidate) return safeCandidate;
      }
    }
    return "";
  };

  const handleAvatarUpload = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const allowedTypes = new Set(["image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif"]);
    if (!allowedTypes.has(file.type)) {
      setDraftMessage(t("settings.avatarInvalidType"), "danger");
      event.target.value = "";
      return;
    }
    if (file.size > 512 * 1024) {
      setDraftMessage(t("settings.avatarTooLarge"), "danger");
      event.target.value = "";
      return;
    }
    startTransition(async () => {
      try {
        const safeImage = await normalizeAvatarUpload(file);
        if (!safeImage) {
          setDraftMessage(t("settings.avatarInvalidType"), "danger");
          event.target.value = "";
          return;
        }
        stageSettings((current) => ({
          ...current,
          profile: { ...current.profile, avatarImageDataUrl: safeImage },
        }), t("settings.avatarUpdated"));
        if (avatarInputRef.current) avatarInputRef.current.value = "";
      } catch {
        setDraftMessage(t("errors.unexpected"), "danger");
        event.target.value = "";
      }
    });
  };

  const testProviderConnection = () => {
    setTestingProviderId(activeProviderId);
    setProviderConfig(activeProviderId, (config) => ({ ...config, testState: "testing" }));
    setDraftMessage(null);
    startTransition(async () => {
      try {
        const response = await fetch("/api/providers/test", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            providerId: activeProviderId,
            config: settings.provider.providers[activeProviderId],
            locale: settings.locale,
            preferServerKeys: settings.provider.preferServerKeys,
            requestTimeoutMs: settings.provider.requestTimeoutMs,
          }),
        });
        const payload = (await response.json().catch(() => null)) as { error?: string; result?: { ok: boolean; message: string; checkedAt: string } } | null;
        if (!response.ok || !payload?.result) {
          throw new Error(payload?.error ?? t("errors.unexpected"));
        }
        setProviderConfig(activeProviderId, (config) => ({
          ...config,
          testState: payload.result!.ok ? "ready" : "error",
          lastCheckedAt: payload.result!.checkedAt,
        }));
        setDraftMessage(payload.result.message, payload.result.ok ? "success" : "danger");
      } catch (caught) {
        setProviderConfig(activeProviderId, (config) => ({ ...config, testState: "error" }));
        setDraftMessage(caught instanceof Error ? caught.message : t("errors.unexpected"), "danger");
      } finally {
        setTestingProviderId(null);
      }
    });
  };

  const handleGoBack = () => {
    if (dirty && !window.confirm(t("settings.unsavedLeavePrompt"))) return;
    restoreSavedAppearancePreview();
    router.push(`/${locale}`);
  };

  return (
    <div className="settings-page space-y-7 animate-fade-up">
      <Panel className="hero-surface overflow-hidden p-5 sm:p-8 lg:p-10">
        <div className="settings-hero-grid grid gap-6 xl:items-end">
          <div className="space-y-5">
            <div className="flex flex-wrap gap-2">
              <Badge tone="accent">{t("settings.title")}</Badge>
              <Badge>{t(`languages.${settings.locale}`)}</Badge>
              <Badge>{t(`providerImplementation.${activeDescriptor?.implementationStage ?? "scaffold"}`)}</Badge>
              <Badge>{t(`themePresets.${settings.appearancePreferences.themePreset}`)}</Badge>
              <Badge tone={dirty ? "danger" : "success"}>{dirty ? t("common.unsavedState") : t("common.savedState")}</Badge>
            </div>
            <div className="space-y-3">
              <h1 className="max-w-4xl font-display text-4xl font-semibold tracking-tight sm:text-5xl">{t("settings.title")}</h1>
              <p className="max-w-3xl text-sm leading-7 text-[color:var(--muted)] sm:text-base">{t("settings.subtitle")}</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className={helperCardClass}>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--muted)]">{t("settings.profile")}</p>
                <p className="mt-2 text-lg font-semibold">{settings.profile.displayName}</p>
              </div>
              <div className={helperCardClass}>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--muted)]">{t("settings.provider")}</p>
                <p className="mt-2 text-lg font-semibold">{t(`providersCatalog.${activeProviderId}.label`)}</p>
              </div>
              <div className={helperCardClass}>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--muted)]">{t("common.model")}</p>
                <p className="mt-2 break-all text-lg font-semibold">{activeModelDisplay}</p>
              </div>
            </div>
          </div>

          <div className="grid gap-4 rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface-strong)] p-5 shadow-panel">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-4">
                <p className="text-xs uppercase tracking-[0.18em] text-[color:var(--muted)]">{t("common.status")}</p>
                <p className="mt-2 text-lg font-semibold">{dirty ? t("common.unsavedState") : t("common.savedState")}</p>
                <p className="mt-1 text-sm text-[color:var(--muted)]">{t("settings.saveHelper")}</p>
              </div>
              <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-4">
                <p className="text-xs uppercase tracking-[0.18em] text-[color:var(--muted)]">{t("settings.appearance")}</p>
                <p className="mt-2 font-semibold">{t(settings.theme === "system" ? "common.system" : settings.theme === "dark" ? "common.dark" : "common.light")}</p>
                <p className="mt-1 text-sm text-[color:var(--muted)]">{t(`themePresets.${settings.appearancePreferences.themePreset}`)}</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-3">
              <Button className="gap-2" disabled={!dirty || saving} onClick={saveSettings}>
                {saving ? `${t("common.loading")}...` : t("settings.save")}
              </Button>
              <Button variant="ghost" disabled={!dirty || saving} onClick={discardChanges}>
                {t("settings.discardChanges")}
              </Button>
              <Button variant="ghost" onClick={handleGoBack}>{t("common.goBack")}</Button>
            </div>
            {message ? <p className={messageToneClass(messageTone)}>{message}</p> : null}
          </div>
        </div>
      </Panel>

      <div className="flex flex-wrap gap-2 rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface-strong)] p-2">
        {(["profile", "appearance", "provider", "preferences", "privacy"] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            className={`rounded-xl px-4 py-2.5 text-sm font-semibold transition ${activeTab === tab ? "bg-[color:var(--brand-soft)] text-[color:var(--brand-ink)] shadow-sm" : "text-[color:var(--muted)] hover:bg-[color:var(--surface-muted)] hover:text-[color:var(--foreground)]"}`}
          >
            {t(`settings.tab${tab.charAt(0).toUpperCase() + tab.slice(1)}`)}
          </button>
        ))}
      </div>

      <div style={{ display: activeTab === "profile" ? undefined : "none" }}>
        <Panel className="space-y-5 self-start p-6">
          <SectionHeader title={t("settings.profile")} body={t("settings.profileHint")} icon={Languages} />
          <div className="grid gap-5 lg:grid-cols-[0.72fr_0.28fr] lg:items-start">
            <div className="space-y-4">
              <label className="space-y-2">
                <span className="text-sm font-medium">{t("settings.displayName")}</span>
                <input
                  className={fieldClass}
                  value={settings.profile.displayName}
                  onChange={(event) => stageSettings({
                    ...settings,
                    profile: {
                      ...settings.profile,
                      displayName: event.target.value,
                      displayNameIsDefault: false,
                    },
                  })}
                  placeholder={t("settings.displayName")}
                />
              </label>

              <div className={helperCardClass}>
                <button type="button" className="flex w-full items-start justify-between gap-3 text-left" onClick={() => setAvatarEditorOpen((current) => !current)}>
                  <div>
                    <p className="text-sm font-semibold">{t("settings.avatar")}</p>
                    <p className="mt-1 text-xs leading-6 text-[color:var(--muted)]">{t("settings.avatarHint")}</p>
                  </div>
                  <span className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-[color:var(--border)] bg-[color:var(--surface-strong)] text-[color:var(--muted)]">
                    {avatarEditorOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  </span>
                </button>
                <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-strong)] p-4">
                  <ProfileAvatar profile={settings.profile} className="h-16 w-16 rounded-2xl text-sm" />
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{settings.profile.displayName}</p>
                    <p className="mt-1 text-sm text-[color:var(--muted)]">{hasCustomAvatar ? t("settings.customAvatarActive") : t(`avatars.${settings.profile.avatarPreset}`)}</p>
                    {hasCustomAvatar ? <p className="mt-1 text-xs leading-5 text-[color:var(--muted)]">{t("settings.avatarCustomLockHint")}</p> : null}
                  </div>
                </div>
                {avatarEditorOpen ? (
                  <div className="mt-4 space-y-4">
                    <div className="grid gap-3 md:grid-cols-2">
                      {AVATAR_PRESETS.map((preset) => {
                        const active = settings.profile.avatarPreset === preset;
                        const tone = avatarPresetStyles[preset];
                        const disabled = hasCustomAvatar;
                        return (
                          <button
                            key={preset}
                            type="button"
                            disabled={disabled}
                            aria-disabled={disabled}
                            className={active
                              ? `rounded-xl border border-[color:var(--brand-solid)] bg-[color:var(--brand-soft)] p-3 text-left text-[color:var(--brand-ink)] transition ${disabled ? "cursor-not-allowed opacity-55" : ""}`
                              : `rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-3 text-left transition ${disabled ? "cursor-not-allowed opacity-45" : "hover:border-[color:var(--brand-solid)] hover:bg-[color:var(--surface-hover)]"}`}
                            onClick={() => {
                              if (!disabled) updateAvatarPreset(preset);
                            }}
                          >
                            <div className="flex items-center gap-3">
                              <Avatar name={settings.profile.displayName} preset={preset} className="h-11 w-11 rounded-2xl text-xs" />
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                  <p className="font-semibold">{t(`avatars.${preset}`)}</p>
                                  {active ? <Badge tone="accent">{t("common.yes")}</Badge> : null}
                                </div>
                                <p className="mt-1 text-[11px] leading-5 text-[color:var(--muted)]">{t(`avatarDescriptions.${preset}`)}</p>
                                <span className="mt-2 block h-2 rounded-full" style={{ background: tone.background }} />
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                      <input ref={avatarInputRef} type="file" accept="image/png,image/jpeg,image/jpg,image/webp,image/gif" className="hidden" onChange={handleAvatarUpload} />
                      <Button variant="ghost" onClick={() => avatarInputRef.current?.click()}>
                        {settings.profile.avatarImageDataUrl ? t("settings.replaceAvatar") : t("settings.uploadAvatar")}
                      </Button>
                      {settings.profile.avatarImageDataUrl ? <Button variant="ghost" onClick={removeAvatarImage}>{t("settings.removeAvatar")}</Button> : null}
                      <span className="text-xs leading-6 text-[color:var(--muted)]">{t("settings.avatarUploadHint")}</span>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>

            <div className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface-soft)] p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-[color:var(--muted)]">{t("settings.profile")}</p>
              <div className="mt-4 flex flex-col items-center gap-3 text-center">
                <ProfileAvatar profile={settings.profile} className="h-20 w-20 rounded-2xl text-lg" />
                <div>
                  <p className="text-lg font-semibold">{settings.profile.displayName}</p>
                  <p className="mt-1 text-sm text-[color:var(--muted)]">{hasCustomAvatar ? t("settings.customAvatarActive") : t(`avatars.${settings.profile.avatarPreset}`)}</p>
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <span className="text-sm font-medium">{t("settings.locale")}</span>
            <div className="grid gap-3 sm:grid-cols-2">
              {DISPLAY_LOCALE_ORDER.map((item) => (
                <button
                  key={item}
                  type="button"
                  className={`rounded-xl border px-4 py-3 text-left text-sm font-semibold transition ${settings.locale === item ? "border-[color:var(--brand-solid)] bg-[color:var(--brand-soft)] text-[color:var(--brand-ink)]" : "border-[color:var(--border)] bg-[color:var(--surface-muted)] hover:border-[color:var(--brand-solid)]"}`}
                  onClick={() => stageSettings({
                    ...settings,
                    locale: item,
                    profile: settings.profile.displayNameIsDefault
                      ? {
                          ...settings.profile,
                          displayName: getDefaultProfileDisplayName(item),
                          displayNameIsDefault: true,
                        }
                      : settings.profile,
                  })}
                >
                  {LOCALE_AUTONYMS[item]}
                </button>
              ))}
            </div>
          </div>

          <label className="space-y-2">
            <span className="text-sm font-medium">{t("settings.datetime")}</span>
            <select className={fieldClass} value={settings.datetimeFormat} onChange={(event) => stageSettings({ ...settings, datetimeFormat: event.target.value as AppSettings["datetimeFormat"] })}>
              <option value="absolute">{t("datetime.absolute")}</option>
              <option value="relative">{t("datetime.relative")}</option>
            </select>
          </label>
        </Panel>
      </div>

      <div style={{ display: activeTab === "appearance" ? undefined : "none" }}>
        <Panel className="space-y-5 self-start p-6">
          <SectionHeader title={t("settings.appearance")} body={t("settings.appearanceHint")} icon={Palette} />
          <div className="grid gap-3 sm:grid-cols-3">
            {(["light", "dark", "system"] as ThemeMode[]).map((theme) => (
              <button
                key={theme}
                type="button"
                className={`rounded-xl border px-4 py-4 text-left transition ${settings.theme === theme ? "border-[color:var(--brand-solid)] bg-[color:var(--brand-soft)] text-[color:var(--brand-ink)]" : "border-[color:var(--border)] bg-[color:var(--surface-muted)] hover:border-[color:var(--brand-solid)] hover:bg-[color:var(--surface-hover)]"}`}
                onClick={() => stageSettings({ ...settings, theme })}
              >
                <p className="font-semibold">{t(theme === "light" ? "common.light" : theme === "dark" ? "common.dark" : "common.system")}</p>
              </button>
            ))}
          </div>

          <div className="space-y-2">
            <span className="text-sm font-medium">{t("settings.themePreset")}</span>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {(["dialectica", "paper", "midnight", "custom"] as ThemePreset[]).map((preset) => (
                <button
                  key={preset}
                  type="button"
                  className={settings.appearancePreferences.themePreset === preset
                    ? "rounded-xl border border-[color:var(--brand-solid)] bg-[color:var(--brand-soft)] p-4 text-left text-[color:var(--brand-ink)] transition"
                    : "rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-4 text-left transition hover:border-[color:var(--brand-solid)] hover:bg-[color:var(--surface-hover)]"}
                  onClick={() => stageSettings({ ...settings, appearancePreferences: { ...settings.appearancePreferences, themePreset: preset } })}
                >
                  <p className="font-semibold">{t(`themePresets.${preset}`)}</p>
                  <p className="mt-1 text-xs leading-5 text-[color:var(--muted)]">{t(`themePresetDescriptions.${preset}`)}</p>
                  <div className="mt-3 flex gap-2">
                    {themePreviewStyles[preset].map((tone) => (
                      <span key={`${preset}-${tone}`} className="h-3 flex-1 rounded-full border border-white/50" style={{ background: tone }} />
                    ))}
                  </div>
                </button>
              ))}
            </div>
          </div>

          <ToggleRow label={t("settings.reduceMotion")} checked={settings.appearancePreferences.reduceMotion} onChange={(checked) => stageSettings({ ...settings, appearancePreferences: { ...settings.appearancePreferences, reduceMotion: checked } })} />

          <div className={helperCardClass}>
            <button type="button" className="flex w-full items-start justify-between gap-3 text-left" onClick={() => setAppearanceAdvancedOpen((current) => !current)}>
              <div>
                <p className="text-sm font-semibold">{t("settings.customTheme")}</p>
                <p className="mt-1 text-xs leading-6 text-[color:var(--muted)]">{t("settings.customThemeHint")}</p>
              </div>
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-[color:var(--border)] bg-[color:var(--surface-strong)] text-[color:var(--muted)]">
                {appearanceAdvancedOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </span>
            </button>
            {appearanceAdvancedOpen ? (
              <div className="mt-4 space-y-4">
                <div className="grid gap-4 lg:grid-cols-[1fr_auto] lg:items-end">
                  <label className="space-y-2">
                    <span className="text-xs font-medium uppercase tracking-[0.18em] text-[color:var(--muted)]">{t("settings.customThemeName")}</span>
                    <input className={fieldClass} value={settings.appearancePreferences.customThemeName} onChange={(event) => stageSettings({ ...settings, appearancePreferences: { ...settings.appearancePreferences, customThemeName: event.target.value } })} placeholder={t("settings.customThemeDefaultName")} />
                  </label>
                  <Button variant="ghost" onClick={saveCurrentCustomTheme}>{t("settings.saveCurrentThemePreset")}</Button>
                </div>
                <div className="grid gap-4 lg:grid-cols-2">
                  {(["light", "dark"] as const).map((mode) => (
                    <div key={mode} className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-strong)] p-4">
                      <p className="font-semibold">{t(mode === "light" ? "settings.customThemeLight" : "settings.customThemeDark")}</p>
                      <div className="mt-4 grid gap-3">
                        {(["primary", "secondary", "accent"] as const).map((key) => (
                          <label key={`${mode}-${key}`} className="space-y-2">
                            <span className="text-xs font-medium uppercase tracking-[0.18em] text-[color:var(--muted)]">{t(`settings.customThemeColors.${key}`)}</span>
                            <div className="flex items-center gap-3">
                              <input type="color" className="h-11 w-14 rounded-xl border border-[color:var(--border)] bg-transparent p-1" value={settings.appearancePreferences.customTheme[mode][key]} onChange={(event) => updateCustomThemeColor(mode, key, event.target.value)} />
                              <input className={fieldClass} value={settings.appearancePreferences.customTheme[mode][key]} onChange={(event) => updateCustomThemeColor(mode, key, event.target.value)} />
                            </div>
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="flex flex-wrap gap-3">
                  <Button variant="ghost" onClick={() => stageSettings({ ...settings, appearancePreferences: { ...settings.appearancePreferences, themePreset: "custom", customTheme: sanitizeThemeCustomization(settings.appearancePreferences.customTheme) } }, t("settings.changesPending"))}>{t("settings.applyCustomTheme")}</Button>
                  <Button variant="ghost" onClick={() => stageSettings({ ...settings, appearancePreferences: { ...settings.appearancePreferences, customTheme: defaultCustomTheme, customThemeName: recommendedSettings.appearancePreferences.customThemeName } }, t("settings.changesPending"))}>{t("settings.resetCustomTheme")}</Button>
                </div>
                {settings.appearancePreferences.savedThemes.length > 0 ? (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-semibold">{t("settings.savedCustomThemes")}</p>
                      <Badge>{settings.appearancePreferences.savedThemes.length}</Badge>
                    </div>
                    <div className="grid gap-3">
                      {settings.appearancePreferences.savedThemes.map((theme) => (
                        <div key={theme.id} className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-strong)] p-4">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <p className="font-semibold">{theme.name}</p>
                              <p className="mt-1 text-xs leading-5 text-[color:var(--muted)]">{new Date(theme.updatedAt).toLocaleString()}</p>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              <Button variant="ghost" onClick={() => applySavedCustomTheme(theme.id)}>{t("settings.applySavedTheme")}</Button>
                              <Button variant="ghost" onClick={() => removeSavedCustomTheme(theme.id)}>{t("settings.removeSavedTheme")}</Button>
                            </div>
                          </div>
                          <div className="mt-3 flex gap-2">
                            {[theme.customTheme.light.primary, theme.customTheme.light.secondary, theme.customTheme.light.accent].map((tone) => (
                              <span key={`${theme.id}-${tone}`} className="h-3 flex-1 rounded-full border border-white/50" style={{ background: tone }} />
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
          <p className="text-xs leading-6 text-[color:var(--muted)]">{t("settings.appliedImmediately")}</p>
        </Panel>
      </div>
      <div className="grid gap-6" style={{ display: activeTab === "preferences" ? undefined : "none" }}>
        <Panel className="defer-section space-y-5 self-start p-6">
          <SectionHeader title={t("settings.defaults")} body={t("settings.defaultsHint")} icon={SlidersHorizontal} />
          <label className="space-y-2">
            <span className="text-sm font-medium">{t("settings.defaultScenario")}</span>
            <select className={fieldClass} value={settings.defaultScenario} onChange={(event) => stageSettings({ ...settings, defaultScenario: event.target.value as AppSettings["defaultScenario"] })}>
              <option value="debate">{t("scenario.debate")}</option>
              <option value="discussion">{t("scenario.discussion")}</option>
              <option value="meeting">{t("scenario.meeting")}</option>
              <option value="negotiation">{t("scenario.negotiation")}</option>
              <option value="document-driven-discussion">{t("scenario.document-driven-discussion")}</option>
            </select>
          </label>
          <label className="space-y-2">
            <span className="text-sm font-medium">{t("settings.defaultExport")}</span>
            <select className={fieldClass} value={settings.defaultExportFormat} onChange={(event) => stageSettings({ ...settings, defaultExportFormat: event.target.value as AppSettings["defaultExportFormat"] })}>
              <option value="markdown">{t("importExport.markdown")}</option>
              <option value="txt">{t("importExport.txt")}</option>
              <option value="json">{t("importExport.json")}</option>
            </select>
            <p className="text-xs leading-6 text-[color:var(--muted)]">{preferredExportLabel(settings.defaultExportFormat, t)}</p>
          </label>
          <div className={helperCardClass}>
            <button type="button" className="flex w-full items-start justify-between gap-3 text-left" onClick={() => setDefaultsAdvancedOpen((current) => !current)}>
              <div>
                <p className="text-sm font-semibold">{t("settings.restoreRecommended")}</p>
                <p className="mt-1 text-xs leading-6 text-[color:var(--muted)]">{t("settings.restoreRecommendedHint")}</p>
              </div>
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-[color:var(--border)] bg-[color:var(--surface-strong)] text-[color:var(--muted)]">
                {defaultsAdvancedOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </span>
            </button>
            {defaultsAdvancedOpen ? (
              <div className="mt-4 flex flex-wrap gap-3">
                <Button variant="ghost" className="gap-2" onClick={restoreRecommended}>
                  <RefreshCcw className="h-4 w-4" />
                  {t("settings.restoreRecommended")}
                </Button>
                <p className="text-xs leading-6 text-[color:var(--muted)]">{t("settings.defaultBehaviorHint")}</p>
              </div>
            ) : null}
          </div>
        </Panel>
        <Panel className="defer-section space-y-5 self-start p-6">
          <SectionHeader title={t("settings.collaboration")} body={t("settings.collaborationHint")} icon={Users} />
          <label className="space-y-2">
            <span className="text-sm font-medium">{t("settings.defaultVisibility")}</span>
            <select className={fieldClass} value={settings.collaborationPreferences.defaultVisibility} onChange={(event) => stageSettings({ ...settings, collaborationPreferences: { ...settings.collaborationPreferences, defaultVisibility: event.target.value as AppSettings["collaborationPreferences"]["defaultVisibility"] } })}>
              <option value="private">{t("roomVisibility.private")}</option>
              <option value="invite">{t("roomVisibility.invite")}</option>
              <option value="public">{t("roomVisibility.public")}</option>
            </select>
          </label>
          <ToggleRow label={t("settings.sessionAutoStart")} checked={settings.collaborationPreferences.sessionAutoStart} onChange={(checked) => stageSettings({ ...settings, collaborationPreferences: { ...settings.collaborationPreferences, sessionAutoStart: checked } })} />
          <ToggleRow label={t("settings.sessionAutoArchive")} checked={settings.collaborationPreferences.sessionAutoArchive} onChange={(checked) => stageSettings({ ...settings, collaborationPreferences: { ...settings.collaborationPreferences, sessionAutoArchive: checked } })} />
          <ToggleRow label={t("settings.allowInvites")} checked={settings.collaborationPreferences.allowInvites} onChange={(checked) => stageSettings({ ...settings, collaborationPreferences: { ...settings.collaborationPreferences, allowInvites: checked } })} />
          <ToggleRow label={t("settings.showSystemEvents")} checked={settings.collaborationPreferences.showSystemEvents} onChange={(checked) => stageSettings({ ...settings, collaborationPreferences: { ...settings.collaborationPreferences, showSystemEvents: checked } })} />
          <label className="space-y-2">
            <span className="text-sm font-medium">{t("settings.syncPollingMs")}</span>
            <input type="number" min="1000" step="1000" className={fieldClass} value={settings.collaborationPreferences.syncPollingMs} onChange={(event) => stageSettings({ ...settings, collaborationPreferences: { ...settings.collaborationPreferences, syncPollingMs: Number(event.target.value) } })} />
          </label>
          <label className="space-y-2">
            <span className="text-sm font-medium">{t("settings.eventHistoryLimit")}</span>
            <input type="number" min="10" max="400" step="10" className={fieldClass} value={settings.collaborationPreferences.eventHistoryLimit} onChange={(event) => stageSettings({ ...settings, collaborationPreferences: { ...settings.collaborationPreferences, eventHistoryLimit: Number(event.target.value) } })} />
          </label>
        </Panel>
        <Panel className="defer-section space-y-5 self-start p-6">
          <SectionHeader title={t("settings.knowledge")} body={t("settings.knowledgeHint")} icon={BookOpenText} />
          <div className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-4 py-3 text-sm leading-6 text-[color:var(--muted)]">
            {t("settings.manualGraphGenerationHint")}
          </div>
          <ToggleRow label={t("settings.includeAttachmentsAsEvidence")} checked={settings.knowledgePreferences.includeAttachmentsAsEvidence} onChange={(checked) => updateKnowledgePreferences({ includeAttachmentsAsEvidence: checked })} />
          <ToggleRow label={t("settings.includeUnresolvedQuestions")} checked={settings.knowledgePreferences.includeUnresolvedQuestions} onChange={(checked) => updateKnowledgePreferences({ includeUnresolvedQuestions: checked })} />
          <label className="space-y-2">
            <span className="text-sm font-medium">{t("settings.knowledgeDefaultView")}</span>
            <select className={fieldClass} value={settings.knowledgePreferences.defaultView} onChange={(event) => updateKnowledgePreferences({ defaultView: event.target.value as AppSettings["knowledgePreferences"]["defaultView"] })}>
              <option value="hub">{t("knowledge.defaultViews.hub")}</option>
              <option value="graph">{t("knowledge.defaultViews.graph")}</option>
            </select>
          </label>
          <label className="space-y-2">
            <span className="text-sm font-medium">{t("settings.graphOutputLanguage")}</span>
            <select
              className={fieldClass}
              value={settings.knowledgePreferences.graphOutputLanguage ?? "auto"}
              onChange={(event) => stageSettings({
                ...settings,
                knowledgePreferences: {
                  ...settings.knowledgePreferences,
                  graphOutputLanguage: event.target.value as "auto" | AppLocale,
                },
              })}
            >
              <option value="auto">{t("settings.graphOutputLanguageAuto")}</option>
              {DISPLAY_LOCALE_ORDER.map((item) => (
                <option key={`graph-lang-${item}`} value={item}>{LOCALE_AUTONYMS[item]}</option>
              ))}
            </select>
          </label>
        </Panel>
      </div>

      <div style={{ display: activeTab === "provider" ? undefined : "none" }}>
        <Panel className="settings-provider-panel defer-section space-y-6 self-start p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <SectionHeader title={t("settings.provider")} body={t("settings.providerHint")} icon={BrainCircuit} />
            <div className="flex flex-wrap gap-2">
              <Badge tone="accent">{t(`providersCatalog.${activeProviderId}.label`)}</Badge>
              <Badge>{activeConfig.model}</Badge>
              <Badge>{t(`connectionStates.${activeConfig.testState}`)}</Badge>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {visibleProviderDescriptors.map((descriptor) => {
              const runtime = settings.provider.providers[descriptor.id];
              const active = descriptor.id === activeProviderId;
              return (
                <button
                  key={descriptor.id}
                  type="button"
                  className={`motion-card rounded-2xl border p-5 text-left transition-all duration-200 ${active ? "border-[color:var(--brand-solid)]/30 bg-[color:var(--brand-soft)] text-[color:var(--brand-ink)] shadow-sm ring-1 ring-[color:var(--brand-solid)]/20" : "border-[color:var(--border)] bg-[color:var(--surface-muted)] hover:border-[color:var(--brand-solid)]/30"}`}
                  onClick={() => stageSettings({ ...settings, provider: { ...settings.provider, activeProviderId: descriptor.id, activeMode: runtime.mode } })}
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-semibold">{t(`providersCatalog.${descriptor.id}.label`)}</p>
                    {active ? <CheckCircle2 className="h-4 w-4" /> : null}
                  </div>
                  <p className="mt-2 text-sm leading-6 text-[color:var(--muted)]">{t(`providersCatalog.${descriptor.id}.description`)}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Badge>{t(`providerModes.${runtime.mode}`)}</Badge>
                    <Badge>{descriptor.id === "disabled" || runtime.mode === "disabled" ? t("settings.disabledAdapterNoModel") : runtime.model}</Badge>
                  </div>
                </button>
              );
            })}
          </div>

          {activeDescriptor ? (
            <div className="grid gap-5 xl:grid-cols-[1.02fr_0.98fr]">
              <div className="space-y-4 rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-5">
                <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-strong)] px-4 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-xs uppercase tracking-[0.18em] text-[color:var(--muted)]">{t("common.status")}</p>
                      <p className="mt-1 text-sm font-semibold">{activeProviderStatusLabel}</p>
                    </div>
                    <Badge tone={providerStatusTone}>{activeProviderStatusLabel}</Badge>
                  </div>
                  <p className="mt-2 text-xs leading-6 text-[color:var(--muted)]">
                    {activeProviderDisabled
                      ? t("settings.disabledAdapterHint")
                      : activeConfig.lastCheckedAt
                      ? `${t("common.updatedAt")}: ${formatDateTime(activeConfig.lastCheckedAt, previewLocale)}`
                      : providerUsesServerConfig
                        ? settings.privacy.storeApiKeysLocally
                          ? t("settings.credentialsPersisted")
                          : t("settings.credentialsNotPersisted")
                        : t("settings.localProviderConfigHint")}
                  </p>
                  <p className="mt-2 text-xs leading-6 text-[color:var(--muted)]">{t("settings.providerDraftHint")}</p>
                  {providerTestResultStaged ? <p className="mt-2 text-xs leading-6 text-[color:var(--brand-solid)]">{t("settings.providerTestStagedHint")}</p> : null}
                </div>

                <div className="space-y-2">
                  <span className="text-sm font-medium">{t("settings.providerMode")}</span>
                  <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--brand-soft)] px-4 py-3 text-sm text-[color:var(--brand-ink)]">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <span className="font-semibold">{t(`providerModes.${activeConfig.mode}`)}</span>
                      <Badge>{t(`providerImplementation.${activeDescriptor.implementationStage}`)}</Badge>
                    </div>
                    <p className="mt-2 text-xs leading-5 text-[color:var(--brand-ink)]/85">{t("settings.providerModeLockedHint")}</p>
                  </div>
                </div>

                {providerUsesServerConfig ? (
                  <>
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <span className="text-sm font-medium">{t("settings.apiKey")}</span>
                        <div className="flex flex-wrap gap-2">
                          {providerHasStoredKey && !activeConfig.apiKey.trim() ? <Badge tone="success">{t("settings.providerKeySaved")}</Badge> : null}
                          {activeConfig.clearStoredApiKey ? <Badge tone="danger">{t("settings.providerKeyClearPending")}</Badge> : null}
                        </div>
                      </div>
                      <div className="relative">
                        <KeyRound className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[color:var(--muted)]" />
                        {providerHasStoredKey && !activeConfig.apiKey.trim() && !activeConfig.clearStoredApiKey ? (
                          <input
                            type="text"
                            className={`${fieldClass} pl-11 pr-24`}
                            value={providerSecretVisible ? (activeConfig.maskedApiKey || "••••••••••••") : "••••••••••••"}
                            readOnly
                            placeholder={t("settings.keySavedPlaceholder", { maskedKey: activeConfig.maskedApiKey || "••••" })}
                          />
                        ) : (
                          <input
                            type={providerSecretVisible ? "text" : "password"}
                            className={`${fieldClass} pl-11 pr-24`}
                            value={activeConfig.apiKey}
                            onChange={(event) => setProviderConfig(activeProviderId, (config) => ({ ...config, apiKey: event.target.value, clearStoredApiKey: false }))}
                            placeholder={t("settings.keyPlaceholder")}
                          />
                        )}
                        <button
                          type="button"
                          className="absolute right-3 top-1/2 inline-flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full border border-[color:var(--border)] bg-[color:var(--surface-muted)] text-[color:var(--muted)] transition hover:border-[color:var(--brand-solid)] hover:text-[color:var(--brand-solid)]"
                          onClick={() => setRevealedProviderKeys((current) => ({ ...current, [activeProviderId]: !current[activeProviderId] }))}
                          aria-label={providerSecretVisible ? t("settings.hideApiKey") : t("settings.showApiKey")}
                        >
                          {providerSecretVisible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                      </div>
                      {providerHasStoredKey && !activeConfig.apiKey.trim() && !activeConfig.clearStoredApiKey ? <p className="text-xs leading-6 text-[color:var(--muted)]">{t("settings.providerKeyStoredHint", { maskedKey: activeConfig.maskedApiKey || "••••" })}</p> : null}
                    </div>
                    <div className="grid gap-4 md:grid-cols-2">
                      <label className="space-y-2">
                        <span className="text-sm font-medium">{t("settings.baseUrl")}</span>
                        <input className={fieldClass} value={activeConfig.baseUrl} onChange={(event) => setProviderConfig(activeProviderId, (config) => ({ ...config, baseUrl: event.target.value }))} />
                      </label>
                      <label className="space-y-2">
                        <span className="text-sm font-medium">{t("settings.organization")}</span>
                        <input className={fieldClass} value={activeConfig.organization} onChange={(event) => setProviderConfig(activeProviderId, (config) => ({ ...config, organization: event.target.value }))} />
                      </label>
                    </div>
                  </>
                ) : (
                  <div className="rounded-xl border border-dashed border-[color:var(--border)] bg-[color:var(--surface-muted)] px-4 py-3 text-sm leading-6 text-[color:var(--muted)]">{t("settings.localProviderConfigHint")}</div>
                )}

                <div className="grid gap-4 md:grid-cols-2">
                  <label className="space-y-2">
                    <span className="text-sm font-medium">{t("settings.temperature")}</span>
                    <input type="number" min="0" max="2" step="0.1" className={fieldClass} value={activeConfig.temperature} onChange={(event) => setProviderConfig(activeProviderId, (config) => ({ ...config, temperature: Number(event.target.value) }))} />
                  </label>
                  <label className="space-y-2">
                    <span className="text-sm font-medium">{t("settings.requestTimeoutMs")}</span>
                    <input type="number" min="1000" step="1000" className={fieldClass} value={settings.provider.requestTimeoutMs} onChange={(event) => stageSettings({ ...settings, provider: { ...settings.provider, requestTimeoutMs: Number(event.target.value) } })} />
                  </label>
                </div>

                <label className="space-y-2">
                  <span className="text-sm font-medium">{t("settings.notes")}</span>
                  <textarea className={`${fieldClass} min-h-28`} value={activeConfig.notes} onChange={(event) => setProviderConfig(activeProviderId, (config) => ({ ...config, notes: event.target.value }))} />
                </label>

                <div className="grid gap-3">
                  <ToggleRow label={t("settings.autoSummary")} checked={settings.provider.autoSummary} onChange={(checked) => stageSettings({ ...settings, provider: { ...settings.provider, autoSummary: checked } })} />
                  <ToggleRow label={t("settings.autoEvaluation")} checked={settings.provider.autoEvaluation} onChange={(checked) => stageSettings({ ...settings, provider: { ...settings.provider, autoEvaluation: checked } })} />
                  <ToggleRow label={t("settings.streaming")} checked={settings.provider.enableStreaming} onChange={(checked) => stageSettings({ ...settings, provider: { ...settings.provider, enableStreaming: checked } })} />
                  <ToggleRow label={t("settings.preferServerKeys")} checked={settings.provider.preferServerKeys} onChange={(checked) => stageSettings({ ...settings, provider: { ...settings.provider, preferServerKeys: checked } })} />
                  <ToggleRow label={t("settings.allowFallbackToScaffold")} checked={settings.provider.allowFallbackToScaffold} onChange={(checked) => stageSettings({ ...settings, provider: { ...settings.provider, allowFallbackToScaffold: checked } })} />
                </div>
                <p className="text-xs leading-6 text-[color:var(--muted)]">{t("project.roomCard.autoAnalysisGuide")}</p>

                <div className="flex flex-wrap gap-3">
                  {!activeProviderDisabled ? <Button className="gap-2" onClick={testProviderConnection}>{testingProviderId === activeProviderId ? `${t("common.loading")}...` : t("settings.testConnection")}</Button> : null}
                  {providerUsesServerConfig && (providerHasStoredKey || activeConfig.apiKey.trim()) ? <Button variant="ghost" className="gap-2" onClick={clearStoredProviderKey}>{t("settings.clearStoredKey")}</Button> : null}
                </div>
              </div>

              <div className="space-y-4 rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-5">
                <button type="button" className="flex w-full items-start justify-between gap-3 text-left" onClick={() => setProviderCatalogOpen((current) => !current)}>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--muted)]">{activeProviderDisabled ? t("providerModes.disabled") : t("settings.modelCatalog")}</p>
                    <p className="mt-2 text-sm leading-6 text-[color:var(--muted)]">{activeProviderDisabled ? t("settings.disabledAdapterHint") : t("settings.providerStageHint")}</p>
                    <p className="mt-2 text-xs leading-5 text-[color:var(--muted)]">{activeProviderDisabled ? t("settings.disabledAdapterNoModel") : t("settings.modelScopeHint")}</p>
                  </div>
                  <span className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-[color:var(--border)] bg-[color:var(--surface-strong)] text-[color:var(--muted)]">
                    {providerCatalogOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  </span>
                </button>
                {providerCatalogOpen ? (
                  activeProviderDisabled ? (
                    <div className="rounded-xl border border-amber-500/25 bg-amber-500/10 p-4 text-sm text-amber-800 dark:text-amber-200">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone="danger">{t("providerModes.disabled")}</Badge>
                        <span className="font-semibold">{t(`providersCatalog.${activeProviderId}.label`)}</span>
                      </div>
                      <p className="mt-3 leading-6">{t("settings.disabledAdapterHint")}</p>
                      <p className="mt-2 text-xs font-semibold uppercase tracking-[0.16em] opacity-80">{t("settings.disabledAdapterNoModel")}</p>
                    </div>
                  ) : (
                    <div className="grid gap-3">
                      {activeDescriptor.models.map((model) => {
                        const selected = activeConfig.model === model.id;
                        const implementedCapabilities = getImplementedConversationInputCapabilities(activeProviderId, model.id);
                        return (
                          <button key={model.id} type="button" className={`rounded-xl border p-4 text-left transition ${selected ? "border-[color:var(--brand-solid)] bg-[color:var(--brand-soft)] text-[color:var(--brand-ink)]" : "border-[color:var(--border)] bg-[color:var(--surface-muted)] hover:border-[color:var(--brand-solid)]"}`} onClick={() => setProviderConfig(activeProviderId, (config) => ({ ...config, model: model.id }))}>
                            <div className="flex flex-wrap items-center justify-between gap-3">
                              <div>
                                <p className="font-semibold">{model.label}</p>
                                <p className="mt-1 text-xs text-[color:var(--muted)]">{model.id}</p>
                              </div>
                              <div className="flex flex-wrap gap-1.5">
                                <Badge>{t(`modelStages.${model.status}`)}</Badge>
                                {model.recommended ? <Badge tone="accent">{t("common.recommended")}</Badge> : null}
                              </div>
                            </div>
                            <div className="mt-2 flex flex-wrap gap-1.5 text-[10px]">
                              <span className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 ${implementedCapabilities.text ? "border-emerald-500/30 text-emerald-600 dark:text-emerald-400" : "border-[color:var(--border)] text-[color:var(--muted)]"}`}>
                                {implementedCapabilities.text ? "\u2713" : "\u2717"} {t("settings.capText")}
                              </span>
                              <span className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 ${implementedCapabilities.image ? "border-emerald-500/30 text-emerald-600 dark:text-emerald-400" : "border-[color:var(--border)] text-[color:var(--muted)]"}`}>
                                {implementedCapabilities.image ? "\u2713" : "\u2717"} {t("settings.capImage")}
                              </span>
                              <span className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 ${implementedCapabilities.document ? "border-emerald-500/30 text-emerald-600 dark:text-emerald-400" : "border-[color:var(--border)] text-[color:var(--muted)]"}`}>
                                {implementedCapabilities.document ? "\u2713" : "\u2717"} {t("settings.capDocument")}
                              </span>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )
                ) : null}
              </div>
            </div>
          ) : null}
        </Panel>
      </div>

      <div className="grid gap-6" style={{ display: activeTab === "preferences" ? undefined : "none" }}>
        <Panel className="defer-section space-y-5 self-start p-6">
          <SectionHeader title={t("settings.preferences")} body={t("settings.preferencesHint")} icon={SlidersHorizontal} />
          <ToggleRow label={t("settings.compactTimeline")} checked={settings.discussionPreferences.compactTimeline} onChange={(checked) => stageSettings({ ...settings, discussionPreferences: { ...settings.discussionPreferences, compactTimeline: checked } })} />
          <ToggleRow label={t("settings.highlightKeywords")} checked={settings.discussionPreferences.highlightKeywords} onChange={(checked) => stageSettings({ ...settings, discussionPreferences: { ...settings.discussionPreferences, highlightKeywords: checked } })} />
          <ToggleRow label={t("settings.showPresenceIndicators")} checked={settings.collaborationPreferences.showPresenceIndicators} onChange={(checked) => stageSettings({ ...settings, collaborationPreferences: { ...settings.collaborationPreferences, showPresenceIndicators: checked } })} />
          <label className="space-y-2">
            <span className="text-sm font-medium">{t("settings.defaultWorkspaceTab")}</span>
            <select className={fieldClass} value={settings.discussionPreferences.defaultWorkspaceTab} onChange={(event) => stageSettings({ ...settings, discussionPreferences: { ...settings.discussionPreferences, defaultWorkspaceTab: event.target.value as AppSettings["discussionPreferences"]["defaultWorkspaceTab"] } })}>
              <option value="capture">{t("project.tabs.capture")}</option>
              <option value="overview">{t("project.tabs.overview")}</option>
              <option value="structure">{t("project.tabs.structure")}</option>
              <option value="insights">{t("project.tabs.insights")}</option>
              <option value="knowledge">{t("project.tabs.knowledge")}</option>
              <option value="settings">{t("project.tabs.settings")}</option>
            </select>
          </label>
          <label className="space-y-2">
            <span className="text-sm font-medium">{t("settings.graphDensity")}</span>
            <select className={fieldClass} value={settings.discussionPreferences.graphDensity} onChange={(event) => stageSettings({ ...settings, discussionPreferences: { ...settings.discussionPreferences, graphDensity: event.target.value as AppSettings["discussionPreferences"]["graphDensity"] } })}>
              <option value="comfortable">{t("density.comfortable")}</option>
              <option value="dense">{t("density.dense")}</option>
            </select>
          </label>
          <label className="space-y-2">
            <span className="text-sm font-medium">{t("settings.defaultGraphMode")}</span>
            <select className={fieldClass} value={settings.knowledgePreferences.defaultGraphMode ?? "both"} onChange={(event) => updateKnowledgePreferences({ defaultGraphMode: event.target.value as "2d" | "3d" | "both" })}>
              <option value="2d">{t("knowledge.graphView2d")}</option>
              <option value="3d">{t("knowledge.graphView3d")}</option>
              <option value="both">{t("knowledge.graphViewBoth")}</option>
            </select>
          </label>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-2">
              <span className="text-sm font-medium">{t("settings.singleUserAutoSummaryThreshold")}</span>
              <input
                type="number"
                min="5"
                max="100"
                className={fieldClass}
                value={settings.discussionPreferences.singleUserAutoSummaryThreshold}
                onChange={(event) => updateDiscussionPreferences({ singleUserAutoSummaryThreshold: Number(event.target.value) })}
              />
              <p className="text-xs leading-6 text-[color:var(--muted)]">{t("settings.autoSummaryThresholdHint")}</p>
            </label>
            <label className="space-y-2">
              <span className="text-sm font-medium">{t("settings.multiUserAutoSummaryThreshold")}</span>
              <input
                type="number"
                min="5"
                max="100"
                className={fieldClass}
                value={settings.discussionPreferences.multiUserAutoSummaryThreshold}
                onChange={(event) => updateDiscussionPreferences({ multiUserAutoSummaryThreshold: Number(event.target.value) })}
              />
              <p className="text-xs leading-6 text-[color:var(--muted)]">{t("settings.autoSummaryThresholdHint")}</p>
            </label>
          </div>
          <label className="space-y-2">
            <span className="text-sm font-medium">{t("settings.assistiveSummaryThreshold")}</span>
            <input
              type="number"
              min="5"
              max="100"
              className={fieldClass}
              value={settings.discussionPreferences.assistiveSummaryThreshold}
              onChange={(event) => updateDiscussionPreferences({ assistiveSummaryThreshold: Number(event.target.value) })}
            />
            <p className="text-xs leading-6 text-[color:var(--muted)]">{t("settings.assistiveSummaryThresholdHint")}</p>
          </label>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-2">
              <span className="text-sm font-medium">{t("settings.latestAiHistoryMode")}</span>
              <select
                className={fieldClass}
                value={settings.discussionPreferences.latestAiHistoryMode}
                onChange={(event) => updateDiscussionPreferences({ latestAiHistoryMode: event.target.value as "latest-only" | "retain" })}
              >
                <option value="latest-only">{t("settings.latestAiHistoryModeLatestOnly")}</option>
                <option value="retain">{t("settings.latestAiHistoryModeRetain")}</option>
              </select>
            </label>
            <label className="space-y-2">
              <span className="text-sm font-medium">{t("settings.latestAiHistoryLimit")}</span>
              <input
                type="number"
                min="1"
                max="50"
                className={fieldClass}
                value={settings.discussionPreferences.latestAiHistoryLimit}
                disabled={settings.discussionPreferences.latestAiHistoryMode !== "retain"}
                onChange={(event) => updateDiscussionPreferences({ latestAiHistoryLimit: Number(event.target.value) })}
              />
              <p className="text-xs leading-6 text-[color:var(--muted)]">{t("settings.latestAiHistoryLimitHint")}</p>
            </label>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-2">
              <span className="text-sm font-medium">{t("settings.summaryHistoryRetentionMode")}</span>
              <select
                className={fieldClass}
                value={settings.discussionPreferences.summaryHistoryRetentionMode}
                onChange={(event) => updateDiscussionPreferences({ summaryHistoryRetentionMode: event.target.value as "unlimited" | "capped" })}
              >
                <option value="unlimited">{t("settings.summaryHistoryRetentionUnlimited")}</option>
                <option value="capped">{t("settings.summaryHistoryRetentionCapped")}</option>
              </select>
            </label>
            <label className="space-y-2">
              <span className="text-sm font-medium">{t("settings.summaryHistoryRetentionLimit")}</span>
              <input
                type="number"
                min="1"
                max="100"
                className={fieldClass}
                value={settings.discussionPreferences.summaryHistoryRetentionLimit}
                disabled={settings.discussionPreferences.summaryHistoryRetentionMode !== "capped"}
                onChange={(event) => updateDiscussionPreferences({ summaryHistoryRetentionLimit: Number(event.target.value) })}
              />
              <p className="text-xs leading-6 text-[color:var(--muted)]">{t("settings.summaryHistoryRetentionHint")}</p>
            </label>
          </div>
          <label className="space-y-2">
            <span className="text-sm font-medium">{t("settings.aiReplyLanguage")}</span>
            <select className={fieldClass} value={settings.aiPreferences?.replyLanguage ?? "auto"} onChange={(event) => stageSettings({ ...settings, aiPreferences: { ...settings.aiPreferences, replyLanguage: event.target.value as "auto" | AppLocale } as NonNullable<typeof settings.aiPreferences> })}>
              <option value="auto">{t("settings.aiReplyLanguageAuto")}</option>
              {DISPLAY_LOCALE_ORDER.map((item) => (
                <option key={`reply-lang-${item}`} value={item}>{LOCALE_AUTONYMS[item]}</option>
              ))}
            </select>
          </label>
          <label className="space-y-2">
            <span className="text-sm font-medium">{t("settings.aiRole")}</span>
            <select className={fieldClass} value={settings.aiPreferences?.aiRole ?? "assistant"} onChange={(event) => stageSettings({ ...settings, aiPreferences: { ...settings.aiPreferences, aiRole: event.target.value } as NonNullable<typeof settings.aiPreferences> })}>
              <option value="assistant">{t("settings.aiRoleAssistant")}</option>
              <option value="moderator">{t("settings.aiRoleModerator")}</option>
              <option value="note-taker">{t("settings.aiRoleNoteTaker")}</option>
              <option value="debate-judge">{t("settings.aiRoleDebateJudge")}</option>
            </select>
          </label>
          <label className="space-y-2">
            <span className="text-sm font-medium">{t("settings.aiResponseLength")}</span>
            <select className={fieldClass} value={settings.aiPreferences?.responseLength ?? "standard"} onChange={(event) => stageSettings({ ...settings, aiPreferences: { ...settings.aiPreferences, responseLength: event.target.value } as NonNullable<typeof settings.aiPreferences> })}>
              <option value="brief">{t("settings.aiLengthBrief")}</option>
              <option value="standard">{t("settings.aiLengthStandard")}</option>
              <option value="detailed">{t("settings.aiLengthDetailed")}</option>
            </select>
          </label>
          <label className="space-y-2">
            <span className="text-sm font-medium">{t("settings.aiFocusTopics")}</span>
            <input type="text" className={fieldClass} value={settings.aiPreferences?.focusTopics ?? ""} onChange={(event) => stageSettings({ ...settings, aiPreferences: { ...settings.aiPreferences, focusTopics: event.target.value } as NonNullable<typeof settings.aiPreferences> })} placeholder={t("settings.aiFocusTopicsPlaceholder")} />
          </label>
          <ToggleRow label={t("settings.aiAutoTagging")} checked={settings.aiPreferences?.autoTagging ?? true} onChange={(checked) => stageSettings({ ...settings, aiPreferences: { ...settings.aiPreferences, autoTagging: checked } as NonNullable<typeof settings.aiPreferences> })} />
          <label className="space-y-2">
            <span className="text-sm font-medium">{t("settings.defaultMemberRole")}</span>
            <select className={fieldClass} value={settings.collaborationPreferences.defaultMemberRole ?? "participant"} onChange={(event) => stageSettings({ ...settings, collaborationPreferences: { ...settings.collaborationPreferences, defaultMemberRole: event.target.value as AppSettings["collaborationPreferences"]["defaultMemberRole"] } })}>
              <option value="participant">{t("collaborationRoles.participant")}</option>
              <option value="observer">{t("collaborationRoles.observer")}</option>
              <option value="facilitator">{t("collaborationRoles.facilitator")}</option>
            </select>
          </label>
          <ToggleRow label={t("settings.notificationsEnabled")} checked={settings.collaborationPreferences.notificationsEnabled ?? true} onChange={(checked) => stageSettings({ ...settings, collaborationPreferences: { ...settings.collaborationPreferences, notificationsEnabled: checked } })} />
          <div className="space-y-3 border-t border-[color:var(--border)] pt-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold">{t("settings.keyboardShortcuts")}</p>
              {settings.customShortcuts && Object.keys(settings.customShortcuts).length > 0 ? (
                <button type="button" className="text-xs text-[color:var(--brand-solid)]" onClick={() => stageSettings({ ...settings, customShortcuts: {} })}>{t("settings.restoreDefaults")}</button>
              ) : null}
            </div>
            <div className="space-y-2 text-xs">
              {shortcutDefinitions.map((s) => {
                const currentKeys = settings.customShortcuts?.[s.action] ?? s.defaultKeys;
                return (
                  <div key={s.action} className="flex items-center justify-between rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-3 py-2">
                    <span className="text-[color:var(--foreground)]">{t(s.label)}</span>
                    <button type="button" className="rounded border border-[color:var(--border)] bg-[color:var(--surface-strong)] px-2 py-0.5 font-mono text-[color:var(--muted)] transition hover:border-[color:var(--brand-solid)]" title={t("settings.clickToChange")} onKeyDown={(e) => {
                      if (["Tab", "Shift", "Control", "Alt", "Meta"].includes(e.key)) return;
                      e.preventDefault();
                      const parts = [];
                      if (e.ctrlKey || e.metaKey) parts.push("Ctrl");
                      if (e.altKey) parts.push("Alt");
                      if (e.shiftKey) parts.push("Shift");
                      parts.push(e.key === " " ? "Space" : e.key.length === 1 ? e.key.toUpperCase() : e.key);
                      const combo = parts.join("+");
                      stageSettings({ ...settings, customShortcuts: { ...settings.customShortcuts, [s.action]: combo } });
                    }}>{currentKeys}</button>
                  </div>
                );
              })}
            </div>
            <p className="text-[10px] text-[color:var(--muted)]">{t("settings.clickToChange")}</p>
          </div>
        </Panel>

        <Panel className="defer-section space-y-5 p-6">
          <SectionHeader title={t("settings.quickReplies")} body={t("settings.quickRepliesHint")} icon={SlidersHorizontal} />
          <div className="space-y-2">
            {(settings.quickReplies ?? []).map((reply, idx) => (
              <div key={idx} className="flex items-center gap-2 rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-4 py-2.5">
                <span className="min-w-0 flex-1 truncate text-sm">{reply}</span>
                <button type="button" className="shrink-0 text-xs text-red-500 hover:underline" onClick={() => stageSettings({ ...settings, quickReplies: (settings.quickReplies ?? []).filter((_, i) => i !== idx) })}>{t("common.delete")}</button>
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <input id="new-quick-reply" className={fieldClass} placeholder={t("settings.quickReplyPlaceholder")} onKeyDown={(e) => {
              if (e.key === "Enter") {
                const input = e.currentTarget;
                const val = input.value.trim();
                if (val) {
                  stageSettings({ ...settings, quickReplies: [...(settings.quickReplies ?? []), val] });
                  input.value = "";
                }
              }
            }} />
            <Button onClick={() => {
              const input = document.getElementById("new-quick-reply") as HTMLInputElement | null;
              const val = input?.value.trim();
              if (val) {
                stageSettings({ ...settings, quickReplies: [...(settings.quickReplies ?? []), val] });
                if (input) input.value = "";
              }
            }}>{t("common.add")}</Button>
          </div>
        </Panel>
      </div>

      <div className="grid gap-6" style={{ display: activeTab === "privacy" ? undefined : "none" }}>
        <Panel className="defer-section space-y-5 p-6">
          <SectionHeader title={t("settings.privacy")} body={t("settings.privacyHint")} icon={Shield} />
          <ToggleRow label={t("settings.storeApiKeysLocally")} checked={settings.privacy.storeApiKeysLocally} onChange={(checked) => stageSettings({ ...settings, privacy: { ...settings.privacy, storeApiKeysLocally: checked } })} />
          <ToggleRow label={t("settings.shareDiagnostics")} checked={settings.privacy.shareDiagnostics} onChange={(checked) => stageSettings({ ...settings, privacy: { ...settings.privacy, shareDiagnostics: checked } })} />
          <label className="space-y-2">
            <span className="text-sm font-medium">{t("settings.analyticsMode")}</span>
            <select className={fieldClass} value={settings.privacy.analyticsMode} onChange={(event) => stageSettings({ ...settings, privacy: { ...settings.privacy, analyticsMode: event.target.value as AppSettings["privacy"]["analyticsMode"] } })}>
              <option value="local-only">{t("analyticsModes.local-only")}</option>
              <option value="manual-export">{t("analyticsModes.manual-export")}</option>
            </select>
          </label>
          <div className="grid gap-3">
            <ToggleRow label={t("settings.allowDocuments")} checked={settings.uploadPreferences.allowDocuments} onChange={(checked) => stageSettings({ ...settings, uploadPreferences: { ...settings.uploadPreferences, allowDocuments: checked } })} />
            <ToggleRow label={t("settings.allowImages")} checked={settings.uploadPreferences.allowImages} onChange={(checked) => stageSettings({ ...settings, uploadPreferences: { ...settings.uploadPreferences, allowImages: checked } })} />
            <ToggleRow label={t("settings.allowVideos")} checked={settings.uploadPreferences.allowVideos} onChange={(checked) => stageSettings({ ...settings, uploadPreferences: { ...settings.uploadPreferences, allowVideos: checked } })} />
            <ToggleRow label={t("settings.retainLocalFiles")} checked={settings.uploadPreferences.retainLocalFiles} onChange={(checked) => stageSettings({ ...settings, uploadPreferences: { ...settings.uploadPreferences, retainLocalFiles: checked } })} />
          </div>
          <label className="space-y-2">
            <span className="text-sm font-medium">{t("settings.maxUploadMb")}</span>
            <input type="number" min="1" max="512" className={fieldClass} value={settings.uploadPreferences.maxUploadMb} onChange={(event) => stageSettings({ ...settings, uploadPreferences: { ...settings.uploadPreferences, maxUploadMb: Number(event.target.value) } })} />
          </label>
        </Panel>
      <Panel className="defer-section space-y-5 p-6">
        <SectionHeader title={t("settings.dataManagement")} body={t("settings.dataManagementHint")} icon={Shield} />
        <div className="grid gap-4 sm:grid-cols-2">
          <button type="button" disabled={dataManagementBusy} className="motion-card rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-5 text-left transition hover:border-[color:var(--brand-solid)]/30 disabled:cursor-not-allowed disabled:opacity-60" onClick={() => void exportAllData()}>
            <p className="font-semibold">{t("settings.exportAllData")}</p>
            <p className="mt-1 text-xs leading-5 text-[color:var(--muted)]">{t("settings.exportAllDataHint")}</p>
          </button>
          <label className={`motion-card rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-5 text-left transition hover:border-[color:var(--brand-solid)]/30 ${dataManagementBusy ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}>
            <input type="file" accept=".json" className="hidden" disabled={dataManagementBusy} onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              if (!confirm(t("settings.importConfirm"))) {
                e.target.value = "";
                return;
              }
              await importAllData(file);
              e.target.value = "";
            }} />
            <p className="font-semibold">{t("settings.importData")}</p>
            <p className="mt-1 text-xs leading-5 text-[color:var(--muted)]">{t("settings.importDataHint")}</p>
          </label>
        </div>
        <div className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-5">
          <div className="space-y-2">
            <p className="text-sm font-semibold">{t("settings.aiSessionCleanup")}</p>
            <p className="text-xs leading-5 text-[color:var(--muted)]">{t("settings.aiSessionCleanupHint")}</p>
          </div>
          <div className="mt-4">
            <ToggleRow
              label={t("settings.aiSessionCleanupEnabled")}
              checked={settings.privacy.assistantSessionCleanup.enabled}
              onChange={(checked) => stageSettings({
                ...settings,
                privacy: {
                  ...settings.privacy,
                  assistantSessionCleanup: {
                    ...settings.privacy.assistantSessionCleanup,
                    enabled: checked,
                  },
                },
              })}
            />
          </div>
          <p className="mt-3 text-xs leading-5 text-[color:var(--muted)]">{t("settings.aiSessionCleanupScope")}</p>
          <label className="mt-4 block space-y-2">
            <span className="text-sm font-medium">{t("settings.aiSessionCleanupDays")}</span>
            <select
              className={fieldClass}
              value={settings.privacy.assistantSessionCleanup.maxIdleDays}
              disabled={!settings.privacy.assistantSessionCleanup.enabled}
              onChange={(event) => stageSettings({
                ...settings,
                privacy: {
                  ...settings.privacy,
                  assistantSessionCleanup: {
                    ...settings.privacy.assistantSessionCleanup,
                    maxIdleDays: Number(event.target.value) as AppSettings["privacy"]["assistantSessionCleanup"]["maxIdleDays"],
                  },
                },
              })}
            >
              {assistantSessionCleanupDayOptions.map((days) => (
                <option key={days} value={days}>
                  {t("settings.aiSessionCleanupDaysOption", { count: String(days) })}
                </option>
              ))}
            </select>
          </label>
        </div>
      </Panel>

      <Panel className="defer-section space-y-5 p-6">
        <SectionHeader title={t("settings.about")} body={t("settings.aboutHint")} icon={Sparkles} />
        <div className="grid gap-4 md:grid-cols-3">
          <div className={helperCardClass}>
            <p className="text-xs uppercase tracking-[0.18em] text-[color:var(--muted)]">{t("settings.projectLabel")}</p>
            <p className="mt-2 font-semibold">{settings.about.projectName} V1</p>
          </div>
          <div className={helperCardClass}>
            <p className="text-xs uppercase tracking-[0.18em] text-[color:var(--muted)]">{t("settings.repository")}</p>
            <p className="mt-2 break-all text-sm leading-6">{settings.about.repositoryUrl || t("common.none")}</p>
          </div>
          <div className={helperCardClass}>
            <p className="text-xs uppercase tracking-[0.18em] text-[color:var(--muted)]">{t("settings.license")}</p>
            <p className="mt-2 font-semibold">{settings.about.license}</p>
          </div>
        </div>
      </Panel>
      </div>
    </div>
  );
}
