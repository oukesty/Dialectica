"use client";

import { startTransition, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useI18n } from "@/components/providers/i18n-provider";
import { Panel } from "@/components/ui/primitives";
import type { ShowcaseBlueprint } from "@/data/samples";
import type { KnowledgeHomepageSummary } from "@/lib/knowledge/types";
import type { AppLocale, DashboardProjectSummary } from "@/lib/types";

function detectFormat(fileName: string) {
  if (fileName.endsWith(".json")) return "json";
  if (fileName.endsWith(".md") || fileName.endsWith(".markdown")) return "markdown";
  return "txt";
}

const DashboardSecondaryPanels = dynamic(
  () => import("@/components/dashboard/dashboard-secondary-panels").then((module) => module.DashboardSecondaryPanels),
  {
    ssr: false,
    loading: () => (
      <div className="dashboard-secondary-panels grid gap-6">
        <Panel className="defer-section min-h-[14rem] p-6">
          <div className="space-y-4">
            <div className="skeleton-shimmer h-4 w-1/3" />
            <div className="skeleton-shimmer h-3 w-2/3" />
            <div className="skeleton-shimmer h-3 w-1/2" />
            <div className="skeleton-shimmer mt-6 h-20 w-full" />
          </div>
        </Panel>
        <Panel className="defer-section min-h-[16rem] p-6">
          <div className="space-y-4">
            <div className="skeleton-shimmer h-4 w-1/4" />
            <div className="skeleton-shimmer h-3 w-3/4" />
            <div className="skeleton-shimmer mt-6 h-24 w-full" />
          </div>
        </Panel>
        <Panel className="defer-section min-h-[14rem] p-6">
          <div className="space-y-4">
            <div className="skeleton-shimmer h-4 w-2/5" />
            <div className="skeleton-shimmer h-3 w-1/2" />
            <div className="skeleton-shimmer mt-6 h-20 w-full" />
          </div>
        </Panel>
      </div>
    ),
  },
);

function DashboardSecondaryPanelsPlaceholder() {
  return (
    <div className="dashboard-secondary-panels grid gap-6">
      <Panel className="defer-section min-h-[14rem] p-6">
        <div className="space-y-4">
          <div className="skeleton-shimmer h-4 w-1/3" />
          <div className="skeleton-shimmer h-3 w-2/3" />
          <div className="skeleton-shimmer mt-6 h-20 w-full" />
        </div>
      </Panel>
      <Panel className="defer-section min-h-[16rem] p-6">
        <div className="space-y-4">
          <div className="skeleton-shimmer h-4 w-1/4" />
          <div className="skeleton-shimmer h-3 w-3/4" />
          <div className="skeleton-shimmer mt-6 h-24 w-full" />
        </div>
      </Panel>
      <Panel className="defer-section min-h-[14rem] p-6">
        <div className="space-y-4">
          <div className="skeleton-shimmer h-4 w-2/5" />
          <div className="skeleton-shimmer h-3 w-1/2" />
          <div className="skeleton-shimmer mt-6 h-20 w-full" />
        </div>
      </Panel>
    </div>
  );
}

export function DashboardDeferredSecondaryPanels({
  locale,
  publicProjectCount,
  inviteProjectCount,
  privateProjectCount,
  publicProjects,
  knowledgeSummary,
  exampleShowcases,
  sampleProjects,
  collapseSamples,
}: {
  locale: AppLocale;
  publicProjectCount: number;
  inviteProjectCount: number;
  privateProjectCount: number;
  publicProjects: DashboardProjectSummary[];
  knowledgeSummary: KnowledgeHomepageSummary;
  exampleShowcases: ShowcaseBlueprint[];
  sampleProjects: DashboardProjectSummary[];
  collapseSamples?: boolean;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const importRef = useRef<HTMLInputElement | null>(null);
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const [renderPanels, setRenderPanels] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSamples, setShowSamples] = useState(false);

  useEffect(() => {
    if (renderPanels) return undefined;
    const target = anchorRef.current;
    if (!target || typeof window === "undefined" || !("IntersectionObserver" in window)) {
      setRenderPanels(true);
      return undefined;
    }
    const observer = new window.IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setRenderPanels(true);
          observer.disconnect();
        }
      },
      { rootMargin: "420px 0px" },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [renderPanels]);

  return (
    <div ref={anchorRef} className="dashboard-secondary-shell">
      {renderPanels ? (
        <>
          {collapseSamples && !showSamples ? (
            <button type="button" onClick={() => setShowSamples(true)} className="mb-4 rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-4 py-2.5 text-xs font-semibold text-[color:var(--muted)] transition hover:bg-[color:var(--surface-hover)]">
              {t("dashboard.showSamples")}
            </button>
          ) : null}
          <DashboardSecondaryPanels
            locale={locale}
            publicProjectCount={publicProjectCount}
            inviteProjectCount={inviteProjectCount}
            privateProjectCount={privateProjectCount}
            publicProjects={publicProjects}
            knowledgeSummary={knowledgeSummary}
            exampleShowcases={collapseSamples && !showSamples ? [] : exampleShowcases}
            sampleProjects={collapseSamples && !showSamples ? [] : sampleProjects}
            error={error}
            onImportRequest={() => importRef.current?.click()}
          />
        </>
      ) : (
        <DashboardSecondaryPanelsPlaceholder />
      )}
      <input
        ref={importRef}
        type="file"
        className="hidden"
        accept=".json,.txt,.md,.markdown"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (!file) {
            return;
          }
          setError(null);
          setImporting(true);
          startTransition(async () => {
            try {
              const content = await file.text();
              const format = detectFormat(file.name);
              const response = await fetch("/api/projects/import", {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({ format, content, locale }),
              });
              if (!response.ok) {
                throw new Error(t("errors.importFailed"));
              }
              const data = (await response.json()) as { project: { id: string } };
              router.push(`/${locale}/projects/${data.project.id}`);
            } catch (caught) {
              setError(caught instanceof Error ? caught.message : t("errors.importFailed"));
            } finally {
              setImporting(false);
              if (event.target) {
                event.target.value = "";
              }
            }
          });
        }}
      />
      {importing ? <p className="mt-3 text-sm text-[color:var(--muted)]">{t("common.loading")}...</p> : null}
    </div>
  );
}
