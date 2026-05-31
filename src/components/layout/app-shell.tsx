"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ReactNode, startTransition, useCallback, useEffect, useState } from "react";
import { clsx } from "clsx";
import { Bell, BookOpenText, BrainCircuit, LayoutDashboard, Menu, Network, Plus, Settings, X } from "lucide-react";
import { useI18n } from "@/components/providers/i18n-provider";
import { KeyboardShortcuts } from "@/components/providers/keyboard-shortcuts";
import { AppLocale, AppSettings, ThemeMode, ThemePreset } from "@/lib/types";
import { LinkButton } from "@/components/ui/primitives";
import { applyAppearanceSettings, sanitizeThemeCustomization, themeStorageKeys } from "@/lib/theme";
import { patchSettings, primeSettingsSnapshot, SettingsConflictError } from "@/lib/settings-client";

const HEADER_HINT_COUNT = 12;
const HEADER_HINT_INTERVAL_MS = 75_000;

export function AppShell({
  children,
  locale,
}: {
  children: ReactNode;
  locale: AppLocale;
}) {
  const { t } = useI18n();
  const pathname = usePathname();
  type NotificationViewEntry = {
    id: string;
    type: string;
    title: string;
    body: string;
    timestamp: string;
    read: boolean;
    href?: string;
    linkState?: "ready" | "generating" | "deleted";
  };
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifs, setNotifs] = useState<NotificationViewEntry[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifBusy, setNotifBusy] = useState(false);
  const [notifError, setNotifError] = useState<string | null>(null);
  const [notifDoNotDisturb, setNotifDoNotDisturb] = useState(false);
  const [notifPrefBusy, setNotifPrefBusy] = useState(false);
  const [headerHintIndex, setHeaderHintIndex] = useState(0);

  // Close mobile menu on navigation
  useEffect(() => { startTransition(() => setMobileMenuOpen(false)); }, [pathname]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setHeaderHintIndex((index) => (index + 1) % HEADER_HINT_COUNT);
    }, HEADER_HINT_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const devLayoutStoragePrefix = "dialectica.dev-layout.";
    try {
      for (let index = window.localStorage.length - 1; index >= 0; index -= 1) {
        const key = window.localStorage.key(index);
        if (key?.startsWith(devLayoutStoragePrefix)) {
          window.localStorage.removeItem(key);
        }
      }
    } catch {
      // Ignore localStorage cleanup failures for removed internal developer tooling.
    }

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const syncSystemTheme = () => {
      const storedTheme = window.localStorage.getItem(themeStorageKeys.theme);
      const theme = storedTheme === "light" || storedTheme === "dark" || storedTheme === "system" ? (storedTheme as ThemeMode) : "system";
      if (theme !== "system") return;
      const storedPreset = window.localStorage.getItem(themeStorageKeys.preset);
      const preset = storedPreset === "paper" || storedPreset === "midnight" || storedPreset === "dialectica" || storedPreset === "custom" ? (storedPreset as ThemePreset) : "dialectica";
      const reduceMotion = window.localStorage.getItem(themeStorageKeys.motion) === "true";
      const storedCustomTheme = window.localStorage.getItem(themeStorageKeys.custom);
      let customTheme = sanitizeThemeCustomization(undefined);
      if (storedCustomTheme) {
        try {
          customTheme = sanitizeThemeCustomization(JSON.parse(storedCustomTheme));
        } catch {
          customTheme = sanitizeThemeCustomization(undefined);
        }
      }
      applyAppearanceSettings({ theme, preset, reduceMotion, customTheme });
    };

    syncSystemTheme();
    const listener = () => syncSystemTheme();
    if (typeof media.addEventListener === "function") {
      media.addEventListener("change", listener);
      return () => media.removeEventListener("change", listener);
    }
    media.addListener(listener);
    return () => media.removeListener(listener);
  }, []);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const html = document.documentElement;
    const currentPath = pathname ?? "";
    const baseLocalePath = "/" + locale;
    const isHomeRoute = currentPath === baseLocalePath;
    const isHeavyRoute = !isHomeRoute && (
      currentPath.startsWith(baseLocalePath + "/settings")
      || currentPath.startsWith(baseLocalePath + "/knowledge")
      || currentPath.startsWith(baseLocalePath + "/projects")
      || currentPath.startsWith(baseLocalePath + "/assistant")
    );
    const complexity = isHomeRoute ? "home" : isHeavyRoute ? "heavy" : "default";
    html.dataset.routeComplexity = complexity;
    return () => {
      if (html.dataset.routeComplexity === complexity) {
        delete html.dataset.routeComplexity;
      }
    };
  }, [locale, pathname]);

  const navItems = [
    { href: `/${locale}`, label: t("nav.dashboard"), icon: LayoutDashboard, exact: true },
    { href: `/${locale}/assistant`, label: t("nav.assistant"), icon: BrainCircuit, exact: false },
    { href: `/${locale}/knowledge`, label: t("nav.knowledge"), icon: BookOpenText, exact: false },
    { href: `/${locale}/knowledge/graph`, label: t("nav.graph"), icon: Network, exact: false },
    { href: `/${locale}/settings`, label: t("nav.settings"), icon: Settings, exact: false },
  ] as const;

  const isActiveRoute = (href: string, exact: boolean) => {
    if (!pathname) return false;
    if (exact) return pathname === href;
    return pathname === href || pathname.startsWith(`${href}/`);
  };

  const readNotificationError = useCallback(async (response: Response) => {
    const payload = await response.json().catch(() => null) as { error?: string } | null;
    return payload?.error ?? t("errors.unexpected");
  }, [t]);

  const loadNotifications = useCallback(async (options: { showError?: boolean } = {}) => {
    const { showError = false } = options;
    if (showError) {
      setNotifError(null);
    }
    try {
      const response = await fetch("/api/notifications", { cache: "no-store" });
      if (!response.ok) {
        throw new Error(await readNotificationError(response));
      }
      const payload = (await response.json()) as { entries: NotificationViewEntry[]; unreadCount: number };
      setNotifs(payload.entries);
      setUnreadCount(payload.unreadCount);
      if (showError) {
        setNotifError(null);
      }
    } catch (error) {
      if (showError) {
        setNotifError(error instanceof Error ? error.message : t("errors.unexpected"));
      }
    }
  }, [readNotificationError, t]);

  const loadNotificationPreferences = useCallback(async () => {
    try {
      const response = await fetch("/api/settings", { cache: "no-store" });
      if (!response.ok) return;
      const payload = await response.json() as { settings?: AppSettings };
      if (payload.settings) {
        primeSettingsSnapshot(payload.settings);
      }
      setNotifDoNotDisturb(Boolean(payload.settings?.collaborationPreferences?.notificationDoNotDisturb));
    } catch {
      // Ignore preference bootstrap failures and fall back to the default.
    }
  }, []);

  useEffect(() => {
    void loadNotifications({ showError: notifOpen });
    const interval = window.setInterval(() => {
      void loadNotifications({ showError: false });
    }, notifOpen ? 1200 : 2000);
    return () => window.clearInterval(interval);
  }, [loadNotifications, notifOpen]);

  useEffect(() => {
    void loadNotificationPreferences();
  }, [loadNotificationPreferences]);

  const toggleNotificationDoNotDisturb = async () => {
    const nextValue = !notifDoNotDisturb;
    setNotifPrefBusy(true);
    setNotifError(null);
    setNotifDoNotDisturb(nextValue);
    try {
      const saved = await patchSettings({
        collaborationPreferences: {
          notificationDoNotDisturb: nextValue,
        },
      });
      setNotifDoNotDisturb(Boolean(saved.collaborationPreferences.notificationDoNotDisturb));
    } catch (error) {
      if (error instanceof SettingsConflictError) {
        try {
          const latestSettings = error.currentSettings;
          if (latestSettings) {
            primeSettingsSnapshot(latestSettings);
          } else {
            await loadNotificationPreferences();
          }
          const saved = await patchSettings({
            collaborationPreferences: {
              notificationDoNotDisturb: nextValue,
            },
          });
          setNotifDoNotDisturb(Boolean(saved.collaborationPreferences.notificationDoNotDisturb));
        } catch (retryError) {
          setNotifDoNotDisturb(!nextValue);
          setNotifError(retryError instanceof Error ? retryError.message : t("errors.unexpected"));
        }
      } else {
        setNotifDoNotDisturb(!nextValue);
        setNotifError(error instanceof Error ? error.message : t("errors.unexpected"));
      }
    } finally {
      setNotifPrefBusy(false);
    }
  };

  const runNotificationAction = async (
    body: { action?: string; notifId?: string },
    onSuccess: () => void,
  ) => {
    setNotifBusy(true);
    setNotifError(null);
    try {
      const response = await fetch("/api/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        throw new Error(await readNotificationError(response));
      }
      onSuccess();
    } catch (error) {
      setNotifError(error instanceof Error ? error.message : t("errors.unexpected"));
    } finally {
      setNotifBusy(false);
    }
  };
  const visibleNotifications = notifDoNotDisturb ? [] : notifs;
  const visibleUnreadCount = notifDoNotDisturb ? 0 : unreadCount;

  return (
    <div className="min-h-screen bg-app-shell text-[color:var(--foreground)]">
      <header className="no-print sticky top-0 z-30 border-b border-[color:var(--border)] bg-[color:var(--surface-strong)]/80 backdrop-blur-xl backdrop-saturate-[1.4]">
        <div className="mx-auto flex max-w-[88rem] items-center justify-between gap-4 px-4 py-3.5 lg:px-8">
          <div className="flex min-w-0 items-center gap-4 lg:gap-5">
            <Link href={`/${locale}`} prefetch={false} className="inline-flex items-center gap-4">
              <span className="brand-gradient inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-lg font-bold text-white shadow-[0_12px_28px_rgba(24,33,45,0.16),0_4px_8px_rgba(24,33,45,0.06)] ring-1 ring-white/10">
                D
              </span>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-display text-xl font-semibold tracking-tight lg:text-2xl">Dialectica</span>
                  <span className="hidden rounded-full bg-[color:var(--brand-soft)] px-2.5 py-1 text-[11px] font-semibold text-[color:var(--brand-ink)] md:inline-flex">
                    {t("common.aiReady")}
                  </span>
                </div>
                <p className="line-clamp-1 text-sm text-[color:var(--muted)]">{t("meta.tagline")}</p>
              </div>
            </Link>
          </div>

          <nav className="hidden items-center gap-2 lg:flex">
            {navItems.map((item) => {
              const active = isActiveRoute(item.href, item.exact);
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  prefetch={false}
                  aria-current={active ? "page" : undefined}
                  className={clsx("nav-link", active && "nav-link-active")}
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <div className="flex items-center gap-2 lg:gap-3">
            <div
              className="surface-card hidden max-w-[9.5rem] items-center gap-2 overflow-hidden rounded-full px-3 py-2 text-xs font-semibold text-[color:var(--muted)] md:inline-flex"
              title={t(`common.headerHints.${headerHintIndex}`)}
            >
              <BrainCircuit className="h-4 w-4 text-[color:var(--brand-solid)]" />
              <span className="min-w-0 truncate whitespace-nowrap">{t(`common.headerHints.${headerHintIndex}`)}</span>
            </div>
            <div className="relative">
              <button type="button" onClick={() => {
                setNotifOpen((v) => {
                  if (!v) {
                    void loadNotifications({ showError: true });
                  }
                  return !v;
                });
              }} className="relative flex h-10 w-10 items-center justify-center rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] transition hover:bg-[color:var(--surface-hover)]" aria-label={t("nav.notifications")}>
                <Bell className="h-4 w-4" />
                {visibleUnreadCount > 0 ? <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-bold text-white">{visibleUnreadCount}</span> : null}
              </button>
              {notifOpen ? (
                <div className="animate-popover-in absolute right-0 top-full z-50 mt-2 w-80 rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface-strong)] p-4 shadow-2xl">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold">{t("nav.notifications")} {visibleUnreadCount > 0 ? `(${visibleUnreadCount})` : ""}</h3>
                    <div className="flex items-center gap-2">
                      {visibleUnreadCount > 0 ? <button type="button" disabled={notifBusy} className="text-[10px] text-[color:var(--brand-solid)] disabled:opacity-50" onClick={() => { void runNotificationAction({}, () => { setUnreadCount(0); setNotifs((current) => current.map((entry) => ({ ...entry, read: true }))); }); }}>{t("nav.markAllRead")}</button> : null}
                      {visibleNotifications.length > 0 ? <button type="button" disabled={notifBusy} className="text-[10px] text-red-500 disabled:opacity-50" onClick={() => { void runNotificationAction({ action: "clearAll" }, () => { setNotifs([]); setUnreadCount(0); }); }}>{t("nav.clearAll")}</button> : null}
                      <button type="button" onClick={() => setNotifOpen(false)} className="text-xs text-[color:var(--muted)]">{"\u2715"}</button>
                    </div>
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-3 py-2">
                    <div className="min-w-0">
                      <p className="text-[11px] font-semibold">{t("nav.notificationDoNotDisturb")}</p>
                      <p className="text-[10px] leading-5 text-[color:var(--muted)]">{t("nav.notificationDoNotDisturbHint")}</p>
                    </div>
                    <button
                      type="button"
                      disabled={notifPrefBusy}
                      onClick={() => void toggleNotificationDoNotDisturb()}
                      className={`inline-flex h-6 min-w-11 items-center rounded-full border px-1 transition disabled:opacity-50 ${
                        notifDoNotDisturb
                          ? "border-[color:var(--brand-solid)] bg-[color:var(--brand-solid)] justify-end"
                          : "border-[color:var(--border)] bg-[color:var(--surface-strong)] justify-start"
                      }`}
                      aria-pressed={notifDoNotDisturb}
                      aria-label={t("nav.notificationDoNotDisturb")}
                    >
                      <span className="h-4 w-4 rounded-full bg-white shadow-sm" />
                    </button>
                  </div>
                  {notifError ? <p className="mt-3 text-xs text-rose-600 dark:text-rose-300">{notifError}</p> : null}
                  {visibleNotifications.length === 0 ? (
                    <div className="mt-3 rounded-xl border border-dashed border-[color:var(--border)] px-4 py-6 text-center text-xs text-[color:var(--muted)]">{t("nav.noNotifications")}</div>
                  ) : (
                    <div className="mt-3 max-h-72 space-y-1.5 overflow-y-auto scroll-fade-y">
                      {visibleNotifications.slice(0, 20).map((n) => (
                        <div
                          key={n.id}
                          className={`${n.href || !n.read ? "cursor-pointer" : "cursor-default"} rounded-lg border px-3 py-2 text-xs transition ${n.read ? "border-[color:var(--border)] bg-[color:var(--surface-muted)] opacity-70" : "border-[color:var(--brand-solid)]/30 bg-[color:var(--brand-soft)]"}`}
                          onClick={() => {
                            if (notifBusy) return;
                            if (!n.read) {
                              void runNotificationAction({ action: "markRead", notifId: n.id }, () => {
                                setNotifs((prev) => prev.map((item) => item.id === n.id ? { ...item, read: true } : item));
                                setUnreadCount((count) => Math.max(0, count - 1));
                                if (n.href) {
                                  setNotifOpen(false);
                                  window.location.href = n.href;
                                }
                              });
                              return;
                            }
                            if (!n.href) return;
                            setNotifOpen(false);
                            window.location.href = n.href;
                          }}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-semibold">{n.title}</span>
                            <div className="flex shrink-0 items-center gap-1.5">
                              <span className="text-[9px] text-[color:var(--muted)]">{new Date(n.timestamp).toLocaleTimeString()}</span>
                              <button type="button" disabled={notifBusy} className="text-[color:var(--muted)] transition hover:text-red-500 disabled:opacity-50" onClick={(e) => {
                                e.stopPropagation();
                                void runNotificationAction({ action: "delete", notifId: n.id }, () => {
                                  setNotifs((prev) => prev.filter((item) => item.id !== n.id));
                                  if (!n.read) {
                                    setUnreadCount((count) => Math.max(0, count - 1));
                                  }
                                });
                              }}>{"\u2715"}</button>
                            </div>
                          </div>
                          <p className="mt-0.5 text-[color:var(--muted)]">{n.body}</p>
                          {n.href ? (
                            <p className="mt-1 text-[9px] text-[color:var(--brand-solid)]">{t("nav.clickToOpen")}</p>
                          ) : n.linkState === "generating" ? (
                            <p className="mt-1 text-[9px] text-[color:var(--muted)]">{t("knowledge.graphGenerating")}</p>
                          ) : n.linkState === "deleted" ? (
                            <p className="mt-1 text-[9px] text-rose-600 dark:text-rose-300">{t("knowledge.graphDeleted")}</p>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : null}
            </div>
            <LinkButton href={`/${locale}/projects/new`} prefetch={false} className="hidden gap-2 sm:inline-flex">
              <Plus className="h-4 w-4" />
              {t("nav.newProject")}
            </LinkButton>
            <button
              type="button"
              onClick={() => setMobileMenuOpen((v) => !v)}
              className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] lg:hidden"
              aria-label="Menu"
            >
              {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>
        </div>
      </header>

      {/* Mobile navigation drawer */}
      {mobileMenuOpen ? (
        <div className="animate-backdrop-in fixed inset-0 z-40 lg:hidden" onClick={() => setMobileMenuOpen(false)}>
          <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" />
          <nav className="animate-slide-in-right absolute right-0 top-0 h-full w-72 border-l border-[color:var(--border)] bg-[color:var(--surface-strong)] p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <span className="font-display text-lg font-semibold">Dialectica</span>
              <button type="button" onClick={() => setMobileMenuOpen(false)} className="flex h-8 w-8 items-center justify-center rounded-lg text-[color:var(--muted)] hover:bg-[color:var(--surface-hover)]"><X className="h-5 w-5" /></button>
            </div>
            <div className="mt-6 space-y-1">
              {navItems.map((item) => {
                const active = isActiveRoute(item.href, item.exact);
                const Icon = item.icon;
                return (
                  <Link key={item.href} href={item.href} prefetch={false} className={`flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-semibold transition ${active ? "bg-[color:var(--brand-soft)] text-[color:var(--brand-ink)]" : "text-[color:var(--foreground)] hover:bg-[color:var(--surface-hover)]"}`}>
                    <Icon className="h-4 w-4" />{item.label}
                  </Link>
                );
              })}
            </div>
            <div className="mt-6">
              <Link href={`/${locale}/projects/new`} prefetch={false} className="flex items-center justify-center gap-2 rounded-xl bg-[color:var(--brand-solid)] px-4 py-3 text-sm font-semibold text-white">
                <Plus className="h-4 w-4" />{t("nav.newProject")}
              </Link>
            </div>
          </nav>
        </div>
      ) : null}

      <main className="mx-auto max-w-[88rem] px-4 py-6 sm:py-8 lg:px-8 lg:py-10">{children}</main>
      <KeyboardShortcuts locale={locale} />
    </div>
  );
}
