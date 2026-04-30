"use client";

import { startTransition, useEffect, useRef, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { Search } from "lucide-react";
import { useI18n } from "@/components/providers/i18n-provider";
import {
  getShortcutForAction,
  matchesShortcutAction,
  shortcutDefinitions,
  SHORTCUT_SETTINGS_UPDATED_EVENT,
  type ShortcutAction,
} from "@/lib/keyboard-shortcuts";

type SearchResult = { title: string; type: string; href: string };

export function KeyboardShortcuts({ locale }: { locale: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const { t } = useI18n();
  const [showHelp, setShowHelp] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [customShortcuts, setCustomShortcuts] = useState<Record<string, string>>({});
  const searchInputRef = useRef<HTMLInputElement>(null);
  const customShortcutsRef = useRef<Record<string, string>>({});

  // Load custom shortcuts and keep them in sync when Settings is saved in this tab.
  useEffect(() => {
    const applyShortcuts = (shortcuts?: Record<string, string>) => {
      const nextShortcuts = shortcuts ?? {};
      customShortcutsRef.current = nextShortcuts;
      setCustomShortcuts(nextShortcuts);
    };
    const refreshShortcuts = () => {
      fetch("/api/settings").then(r => r.json()).then((d: { settings?: { customShortcuts?: Record<string, string> } }) => {
        applyShortcuts(d.settings?.customShortcuts);
      }).catch(() => {});
    };
    const handleSettingsUpdate = (event: Event) => {
      const detail = (event as CustomEvent<{ settings?: { customShortcuts?: Record<string, string> } }>).detail;
      applyShortcuts(detail?.settings?.customShortcuts);
    };

    refreshShortcuts();
    window.addEventListener(SHORTCUT_SETTINGS_UPDATED_EVENT, handleSettingsUpdate);
    window.addEventListener("focus", refreshShortcuts);
    return () => {
      window.removeEventListener(SHORTCUT_SETTINGS_UPDATED_EVENT, handleSettingsUpdate);
      window.removeEventListener("focus", refreshShortcuts);
    };
  }, []);

  // Fetch search results
  useEffect(() => {
    if (!showSearch || !searchQuery.trim()) { startTransition(() => setSearchResults([])); return; }
    const q = searchQuery.trim().toLowerCase();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/projects?locale=${locale}`);
        const data = (await res.json()) as { projects: Array<{ id: string; title: string; description: string; scenario: string }> };
        const matches: SearchResult[] = data.projects
          .filter((p) => p.title.toLowerCase().includes(q) || p.description.toLowerCase().includes(q))
          .slice(0, 8)
          .map((p) => ({ title: p.title, type: p.scenario, href: `/${locale}/projects/${p.id}` }));
        // Also add static pages
        const pages = [
          { title: t("nav.dashboard"), type: "page", href: `/${locale}` },
          { title: t("nav.settings"), type: "page", href: `/${locale}/settings` },
          { title: t("nav.knowledge"), type: "page", href: `/${locale}/knowledge` },
          { title: t("nav.graph"), type: "page", href: `/${locale}/knowledge/graph` },
          { title: t("nav.assistant"), type: "page", href: `/${locale}/assistant` },
        ].filter((p) => p.title.toLowerCase().includes(q));
        setSearchResults([...pages, ...matches]);
      } catch { setSearchResults([]); }
    }, 200);
    return () => clearTimeout(timer);
  }, [searchQuery, showSearch, locale, t]);

  useEffect(() => {
    if (showSearch) searchInputRef.current?.focus();
  }, [showSearch]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const cs = customShortcutsRef.current;
      const matchesAction = (action: ShortcutAction) => matchesShortcutAction(e, action, cs);

      // Global search and close work even in inputs so overlays remain reachable.
      if (matchesAction("globalSearch")) {
        e.preventDefault();
        setShowSearch((v) => !v);
        setSearchQuery("");
        return;
      }
      if (matchesAction("close")) {
        if (showSearch || showHelp) {
          e.preventDefault();
          setShowSearch(false);
          setShowHelp(false);
          return;
        }
      }

      // Don't trigger other shortcuts in inputs/textareas
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
        if (matchesAction("close")) {
          (e.target as HTMLElement).blur();
        }
        return;
      }

      if (matchesAction("newProject")) {
        e.preventDefault();
        router.push(`/${locale}/projects/new`);
      } else if (matchesAction("search")) {
        e.preventDefault();
        // Focus the first search input on the page
        const searchInput = document.querySelector<HTMLInputElement>('input[type="text"][placeholder*="搜索"], input[type="text"][placeholder*="Search"], input[type="text"][placeholder*="検索"], input[type="text"][placeholder*="Rechercher"]');
        if (searchInput) searchInput.focus();
      } else if (matchesAction("help")) {
        e.preventDefault();
        setShowHelp((v) => !v);
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [locale, pathname, router, showHelp, showSearch]);

  if (!showHelp && !showSearch) return null;

  if (showSearch) {
    return (
      <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[15vh] bg-black/40 backdrop-blur-sm" onClick={() => setShowSearch(false)}>
        <div className="animate-popover-in mx-4 w-full max-w-lg rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface-strong)] shadow-2xl" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center gap-3 border-b border-[color:var(--border)] px-4 py-3">
            <Search className="h-4 w-4 shrink-0 text-[color:var(--muted)]" />
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t("shortcuts.globalSearchPlaceholder")}
              className="flex-1 bg-transparent text-sm text-[color:var(--foreground)] outline-none placeholder:text-[color:var(--muted)]"
              onKeyDown={(e) => { if (e.key === "Escape") setShowSearch(false); }}
            />
            <kbd className="rounded border border-[color:var(--border)] px-1.5 py-0.5 text-[10px] font-mono text-[color:var(--muted)]">ESC</kbd>
          </div>
          {searchResults.length > 0 ? (
            <div className="max-h-72 overflow-y-auto py-2">
              {searchResults.map((r, i) => (
                <button key={`${r.href}-${i}`} type="button" className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left transition hover:bg-[color:var(--surface-hover)]" onClick={() => { router.push(r.href); setShowSearch(false); }}>
                  <span className="text-sm font-semibold text-[color:var(--foreground)]">{r.title}</span>
                  <span className="shrink-0 rounded-md bg-[color:var(--surface-muted)] px-1.5 py-0.5 text-[10px] text-[color:var(--muted)]">{r.type}</span>
                </button>
              ))}
            </div>
          ) : searchQuery.trim() ? (
            <div className="px-4 py-6 text-center text-xs text-[color:var(--muted)]">{t("shortcuts.noResults")}</div>
          ) : (
            <div className="px-4 py-6 text-center text-xs text-[color:var(--muted)]">{t("shortcuts.globalSearchHint")}</div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/40 px-3 py-3 backdrop-blur-sm sm:items-center sm:px-4 sm:py-6" onClick={() => setShowHelp(false)}>
      <div className="animate-popover-in max-h-[calc(100svh-1.5rem)] w-full max-w-md overflow-y-auto rounded-t-2xl border border-[color:var(--border)] bg-[color:var(--surface-strong)] p-5 shadow-2xl sm:rounded-2xl sm:p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="font-display text-lg font-semibold text-[color:var(--foreground)]">{t("shortcuts.title")}</h2>
        <p className="mt-1 text-sm text-[color:var(--muted)]">{t("shortcuts.description")}</p>
        <div className="mt-4 space-y-2">
          {shortcutDefinitions.map((s) => (
            <div key={s.action} className="flex items-center justify-between rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-4 py-2.5">
              <span className="text-sm text-[color:var(--foreground)]">{t(s.label)}</span>
              <kbd className="rounded-md border border-[color:var(--border)] bg-[color:var(--surface-strong)] px-2 py-0.5 text-xs font-mono text-[color:var(--muted)]">
                {getShortcutForAction(s.action, customShortcuts)}
              </kbd>
            </div>
          ))}
        </div>
        <button type="button" onClick={() => setShowHelp(false)} className="mt-4 w-full rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] py-2 text-sm font-semibold text-[color:var(--foreground)] transition hover:bg-[color:var(--surface-hover)]">
          {t("shortcuts.close")}
        </button>
      </div>
    </div>
  );
}
