"use client";

import { startTransition, useCallback, useEffect, useState } from "react";
import { useI18n } from "@/components/providers/i18n-provider";
import { AppLocale } from "@/lib/types";

type ProjectSummary = { id: string; title: string };

export function ProjectLinker({ projectId, linkedIds, locale, onLink }: { projectId: string; linkedIds: string[]; locale: AppLocale; onLink: (id: string) => void }) {
  const { t } = useI18n();
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects?locale=${locale}`);
      const data = (await res.json()) as { projects: ProjectSummary[] };
      startTransition(() => setProjects(data.projects.filter((p) => p.id !== projectId && !linkedIds.includes(p.id))));
    } catch { startTransition(() => setProjects([])); }
  }, [locale, projectId, linkedIds]);

  useEffect(() => { if (open) void load(); }, [open, load]);

  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen((v) => !v)} className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-strong)] px-3 py-1.5 text-xs font-semibold text-[color:var(--foreground)] transition hover:bg-[color:var(--surface-hover)]">
        + {t("project.linkProject")}
      </button>
      {open ? (
        <div className="animate-popover-in absolute left-0 top-full z-20 mt-1 max-h-48 w-64 overflow-y-auto rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-strong)] py-1 shadow-lg">
          {projects.length === 0 ? (
            <p className="px-3 py-3 text-center text-xs text-[color:var(--muted)]">{t("project.noProjectsToLink")}</p>
          ) : projects.map((p) => (
            <button key={p.id} type="button" className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition hover:bg-[color:var(--surface-hover)]" onClick={() => { onLink(p.id); setOpen(false); }}>
              <span className="truncate font-semibold">{p.title}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
