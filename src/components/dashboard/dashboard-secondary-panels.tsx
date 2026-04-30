"use client";

import Link from "next/link";
import { BookOpenText, FileUp, FolderKanban, Network, Radar, Settings2, Users } from "lucide-react";
import { useI18n } from "@/components/providers/i18n-provider";
import { Badge, Panel } from "@/components/ui/primitives";
import type { ShowcaseBlueprint } from "@/data/samples";
import type { KnowledgeHomepageSummary } from "@/lib/knowledge/types";
import type { AppLocale, DashboardProjectSummary } from "@/lib/types";

export function DashboardSecondaryPanels({
  locale,
  publicProjectCount,
  inviteProjectCount,
  privateProjectCount,
  publicProjects,
  knowledgeSummary,
  exampleShowcases,
  sampleProjects,
  error,
  onImportRequest,
}: {
  locale: AppLocale;
  publicProjectCount: number;
  inviteProjectCount: number;
  privateProjectCount: number;
  publicProjects: DashboardProjectSummary[];
  knowledgeSummary: KnowledgeHomepageSummary;
  exampleShowcases: ShowcaseBlueprint[];
  sampleProjects: DashboardProjectSummary[];
  error: string | null;
  onImportRequest: () => void;
}) {
  const { t } = useI18n();

  return (
    <div className="dashboard-secondary-panels grid gap-6">
      <Panel className="defer-section space-y-5 p-6">
        <h2 className="font-display text-2xl font-semibold">{t("dashboard.quickActions")}</h2>
        <div className="grid gap-3">
          {[
            [`/${locale}/projects/new`, t("dashboard.actionNewTitle"), t("dashboard.actionNewBody"), FolderKanban],
            [`/${locale}/knowledge/graph`, t("dashboard.actionGraphTitle"), t("dashboard.actionGraphBody"), Network],
            [`/${locale}/settings`, t("dashboard.actionSettingsTitle"), t("dashboard.actionSettingsBody"), Settings2],
          ].map(([href, title, body, Icon]) => (
            <Link prefetch={false} key={href as string} href={href as string} className="motion-card rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface-soft)] p-4">
              <div className="flex items-start gap-3">
                <span className="theme-icon-tile inline-flex h-10 w-10 items-center justify-center rounded-2xl">
                  <Icon className="h-5 w-5" />
                </span>
                <div>
                  <p className="font-semibold">{title as string}</p>
                  <p className="mt-1 text-sm leading-6 text-[color:var(--muted)]">{body as string}</p>
                </div>
              </div>
            </Link>
          ))}
          <button type="button" onClick={onImportRequest} className="motion-card rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface-soft)] p-4 text-left">
            <div className="flex items-start gap-3">
              <span className="theme-icon-tile inline-flex h-10 w-10 items-center justify-center rounded-2xl">
                <FileUp className="h-5 w-5" />
              </span>
              <div>
                <p className="font-semibold">{t("dashboard.actionImportTitle")}</p>
                <p className="mt-1 text-sm leading-6 text-[color:var(--muted)]">{t("dashboard.actionImportBody")}</p>
              </div>
            </div>
          </button>
        </div>
        {error ? <p className="text-sm text-rose-600 dark:text-rose-300">{error}</p> : null}
      </Panel>

      <Panel className="defer-section space-y-5 p-6">
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 text-[color:var(--brand-solid)]" />
          <div>
            <h2 className="font-display text-2xl font-semibold">{t("dashboard.visibilitySummaryTitle")}</h2>
            <p className="mt-1 text-sm leading-6 text-[color:var(--muted)]">{t("dashboard.visibilitySummaryBody")}</p>
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="motion-card rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-5 py-4">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--muted)]">{t("roomVisibility.public")}</p>
            <p className="mt-2.5 text-xl font-semibold">{publicProjectCount}</p>
          </div>
          <div className="motion-card rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-5 py-4">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--muted)]">{t("roomVisibility.invite")}</p>
            <p className="mt-2.5 text-xl font-semibold">{inviteProjectCount}</p>
          </div>
          <div className="motion-card rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-5 py-4">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--muted)]">{t("roomVisibility.private")}</p>
            <p className="mt-2.5 text-xl font-semibold">{privateProjectCount}</p>
          </div>
        </div>
        <div className="grid gap-3">
          {publicProjects.length === 0 ? (
            <div className="rounded-xl border border-dashed border-[color:var(--border)] p-4 text-sm leading-6 text-[color:var(--muted)]">{t("dashboard.publicRoomsEmpty")}</div>
          ) : (
            publicProjects.map((project) => (
              <Link prefetch={false} key={project.id} href={`/${locale}/projects/${project.id}`} className="motion-card rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-soft)] p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-semibold">{project.title}</p>
                  <Badge tone="accent">{t(`roomVisibility.${project.visibility}`)}</Badge>
                </div>
                <p className="mt-2 text-sm leading-6 text-[color:var(--muted)]">{project.description}</p>
                <p className="mt-2 text-xs leading-5 text-[color:var(--muted)]">{`${project.participantCount} ${t("projectList.participants")} · ${project.entryCount} ${t("projectList.entries")}`}</p>
              </Link>
            ))
          )}
        </div>
      </Panel>

      <Panel className="dashboard-panel-wide defer-section space-y-5 p-6">
        <div className="flex items-center gap-2">
          <Radar className="h-4 w-4 text-[color:var(--brand-solid)]" />
          <h2 className="font-display text-xl font-semibold">{t("knowledge.recentTitle")}</h2>
        </div>
        <div className="grid gap-3 lg:grid-cols-2">
          {knowledgeSummary.recentNodes.slice(0, 4).map((node) => (
            <Link prefetch={false} key={node.id} href={`/${locale}/knowledge/${encodeURIComponent(node.id)}`} className="motion-card rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-5 transition-all duration-200 hover:border-[color:var(--brand-solid)]">
              <div className="flex flex-wrap gap-2">
                <p className="font-semibold">{node.title}</p>
                <Badge>{t(`knowledge.nodeTypes.${node.type}`)}</Badge>
              </div>
              <p className="mt-2 text-sm leading-6 text-[color:var(--muted)]">{node.summary}</p>
            </Link>
          ))}
        </div>
      </Panel>

      <Panel className="dashboard-panel-wide defer-section space-y-4 p-6">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <BookOpenText className="h-4 w-4 text-[color:var(--brand-solid)]" />
            <h2 className="font-display text-xl font-semibold">{t("newProject.templatesTitle")}</h2>
          </div>
          <Badge>{exampleShowcases.length}</Badge>
        </div>
        <p className="text-sm leading-6 text-[color:var(--muted)]">{t("newProject.templatesHint")}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          {exampleShowcases.map((item) => (
            <div key={item.id} className="motion-card rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-4">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-semibold">{item.title}</p>
                <Badge>{t(`scenario.${item.scenario}`)}</Badge>
              </div>
              <p className="mt-2 text-sm leading-6 text-[color:var(--muted)]">{item.body}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {item.tags.slice(0, 3).map((tag) => <Badge key={`${item.id}-${tag}`}>{tag}</Badge>)}
              </div>
            </div>
          ))}
        </div>
      </Panel>

      {sampleProjects.length > 0 ? (
        <Panel className="dashboard-panel-wide defer-section space-y-4 p-6">
          <div className="flex items-center gap-2">
            <BookOpenText className="h-4 w-4 text-[color:var(--brand-solid)]" />
            <h2 className="font-display text-xl font-semibold">{t("dashboard.actionSampleTitle")}</h2>
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            {sampleProjects.map((project) => (
              <Link prefetch={false} key={project.id} href={`/${locale}/projects/${project.id}`} className="motion-card rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-4">
                <div className="flex items-center gap-2">
                  <p className="font-semibold">{project.title}</p>
                  <Badge tone="accent">{t("dashboard.sampleBadge")}</Badge>
                </div>
                <p className="mt-1 text-sm leading-6 text-[color:var(--muted)]">{project.description}</p>
              </Link>
            ))}
          </div>
        </Panel>
      ) : null}
    </div>
  );
}
