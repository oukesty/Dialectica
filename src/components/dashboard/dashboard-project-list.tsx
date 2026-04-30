"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, DragEndEvent } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy, arrayMove } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { CheckSquare, GripVertical, Square, Trash2 } from "lucide-react";
import { useI18n } from "@/components/providers/i18n-provider";
import { Badge, Button } from "@/components/ui/primitives";
import { DashboardProjectDeleteControl } from "@/components/dashboard/dashboard-project-delete-control";
import { deleteDashboardProjectAction } from "@/components/dashboard/dashboard-actions";
import { formatDateTime } from "@/lib/format";
import { patchSettings } from "@/lib/settings-client";
import { AppLocale, DashboardProjectSummary } from "@/lib/types";

function SortableCard({ id, children }: { id: string; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }} className="flex gap-0">
      <button type="button" className="flex w-7 shrink-0 cursor-grab items-center justify-center rounded-l-2xl border border-r-0 border-[color:var(--border)] bg-[color:var(--surface-muted)] text-[color:var(--muted)] active:cursor-grabbing" {...attributes} {...listeners}>
        <GripVertical className="h-3.5 w-3.5" />
      </button>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

function StaticCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-0">
      <button
        type="button"
        disabled
        aria-hidden="true"
        tabIndex={-1}
        className="flex w-7 shrink-0 items-center justify-center rounded-l-2xl border border-r-0 border-[color:var(--border)] bg-[color:var(--surface-muted)] text-[color:var(--muted)] opacity-70"
      >
        <GripVertical className="h-3.5 w-3.5" />
      </button>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

const INITIAL_VISIBLE_PROJECT_COUNT = 10;
const PROJECT_LOAD_MORE_COUNT = 10;

function canDeleteWorkspaceFromDashboard(project: DashboardProjectSummary) {
  return !project.isSample && project.visibility === "private" && project.participantCount <= 1;
}

export function DashboardProjectList({
  projects,
  locale,
  initialOrder,
  sampleProjects = [],
}: {
  projects: DashboardProjectSummary[];
  locale: AppLocale;
  initialOrder?: string[];
  sampleProjects?: DashboardProjectSummary[];
}) {
  const { t } = useI18n();
  const router = useRouter();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchDeleting, setBatchDeleting] = useState(false);
  const [batchConfirm, setBatchConfirm] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [dndReady, setDndReady] = useState(false);
  const [visibleProjectCount, setVisibleProjectCount] = useState(INITIAL_VISIBLE_PROJECT_COUNT);
  const hasUserProjects = projects.some((project) => !project.isSample);
  const [showSamples, setShowSamples] = useState(() => sampleProjects.length > 0 && !hasUserProjects);
  const [sampleVisibilityTouched, setSampleVisibilityTouched] = useState(false);

  useEffect(() => {
    setDndReady(true);
  }, []);

  useEffect(() => {
    setVisibleProjectCount(INITIAL_VISIBLE_PROJECT_COUNT);
  }, [showArchived]);

  useEffect(() => {
    if (sampleProjects.length === 0) return;
    if (sampleVisibilityTouched) return;
    setShowSamples(!hasUserProjects);
  }, [hasUserProjects, sampleProjects.length, sampleVisibilityTouched]);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleBatchDelete = async () => {
    setBatchDeleting(true);
    for (const id of selectedIds) {
      await deleteDashboardProjectAction(locale, id);
    }
    setBatchDeleting(false);
    setBatchConfirm(false);
    setSelectedIds(new Set());
    setSelectMode(false);
    router.refresh();
  };

  // Sort projects by saved order
  const [order, setOrder] = useState<string[]>(() => {
    if (initialOrder?.length) return initialOrder;
    return projects.map((p) => p.id);
  });

  const sorted = order
    .map((id) => projects.find((p) => p.id === id))
    .filter(Boolean) as DashboardProjectSummary[];
  // Add any new projects not in the saved order
  for (const p of projects) {
    if (!order.includes(p.id)) sorted.push(p);
  }

  const archivedCount = sorted.filter((p) => p.status === "archived" || p.status === "completed").length;
  const displayProjects = showArchived ? sorted.filter((p) => p.status === "archived" || p.status === "completed") : sorted.filter((p) => p.status !== "archived" && p.status !== "completed");
  const visibleProjects = displayProjects.slice(0, visibleProjectCount);
  const hiddenProjectCount = Math.max(0, displayProjects.length - visibleProjects.length);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIdx = sorted.findIndex((p) => p.id === active.id);
    const newIdx = sorted.findIndex((p) => p.id === over.id);
    const reordered = arrayMove(sorted, oldIdx, newIdx);
    const newIds = reordered.map((p) => p.id);
    setOrder(newIds);
    void patchSettings({ projectOrder: newIds }, { base: { projectOrder: order } }).catch(() => {});
  };

  if (sorted.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-[color:var(--border)] bg-[color:var(--surface-muted)]/50 p-10 text-center">
        <h3 className="text-lg font-semibold">{t("dashboard.emptyTitle")}</h3>
        <p className="mx-auto mt-3 max-w-md text-sm leading-7 text-[color:var(--muted)]">{t("dashboard.emptyBody")}</p>
      </div>
    );
  }

  return (
    <>
      <div className="mb-3 flex items-center gap-3">
        <button type="button" onClick={() => { setSelectMode((v) => !v); setSelectedIds(new Set()); setBatchConfirm(false); }} className="inline-flex items-center gap-1.5 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-strong)] px-3 py-1.5 text-xs font-semibold text-[color:var(--foreground)] transition hover:bg-[color:var(--surface-hover)]">
          {selectMode ? <CheckSquare className="h-3.5 w-3.5" /> : <Square className="h-3.5 w-3.5" />}
          {selectMode ? t("dashboard.exitSelect") : t("dashboard.selectMode")}
        </button>
        {archivedCount > 0 ? (
          <button type="button" onClick={() => setShowArchived((v) => !v)} className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${showArchived ? "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-200" : "border-[color:var(--border)] bg-[color:var(--surface-strong)] text-[color:var(--foreground)] hover:bg-[color:var(--surface-hover)]"}`}>
            {showArchived ? t("dashboard.showActive") : t("dashboard.showArchived", { count: String(archivedCount) })}
          </button>
        ) : null}
        {selectMode && selectedIds.size > 0 ? (
          batchConfirm ? (
            <span className="animate-popover-in inline-flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-xs">
              <span className="font-semibold text-red-600 dark:text-red-300">{t("dashboard.batchDeleteConfirm", { count: String(selectedIds.size) })}</span>
              <button type="button" className="font-bold text-red-600 hover:underline dark:text-red-300" disabled={batchDeleting} onClick={() => void handleBatchDelete()}>{batchDeleting ? "..." : t("common.delete")}</button>
              <button type="button" className="text-[color:var(--muted)] hover:underline" onClick={() => setBatchConfirm(false)}>{t("common.cancel")}</button>
            </span>
          ) : (
            <Button variant="danger" className="gap-1.5 px-3 py-1.5 text-xs" onClick={() => setBatchConfirm(true)}>
              <Trash2 className="h-3.5 w-3.5" />
              {t("dashboard.batchDelete", { count: String(selectedIds.size) })}
            </Button>
          )
        ) : null}
      </div>
    {dndReady ? (
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={visibleProjects.map((p) => p.id)} strategy={verticalListSortingStrategy}>
          <div className="dashboard-project-grid grid gap-5">
            {visibleProjects.map((project, idx) => (
              <SortableCard key={project.id} id={project.id}>
                <article className={`motion-card animate-fade-up rounded-r-2xl rounded-l-none border border-l-0 border-[color:var(--border)] bg-[color:var(--surface-soft)] p-6 stagger-${Math.min(idx + 1, 5)}`}>
                  <div className="flex items-start justify-between gap-3">
                    {selectMode && !project.isSample ? (
                      <button type="button" onClick={() => toggleSelect(project.id)} className="mt-1 shrink-0">
                        {selectedIds.has(project.id)
                          ? <CheckSquare className="h-5 w-5 text-[color:var(--brand-solid)]" />
                          : <Square className="h-5 w-5 text-[color:var(--muted)]" />}
                      </button>
                    ) : null}
                    <div className="space-y-2">
                      <div className="flex flex-wrap gap-2">
                        <h3 className="text-lg font-semibold">{project.title}</h3>
                        {project.isSample ? <Badge tone="accent">{t("dashboard.sampleBadge")}</Badge> : <Badge>{t("project.userProjectBadge")}</Badge>}
                      </div>
                      <p className="text-sm leading-6 text-[color:var(--muted)]">{project.description}</p>
                    </div>
                    <div className="flex flex-wrap justify-end gap-2">
                      <Badge>{t(`scenario.${project.scenario}`)}</Badge>
                      <Badge>{t(`roomVisibility.${project.visibility}`)}</Badge>
                    </div>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Badge>{t(`languages.${project.language}`)}</Badge>
                    <Badge>{`${project.participantCount} ${t("projectList.participants")}`}</Badge>
                    <Badge>{`${project.entryCount} ${t("projectList.entries")}`}</Badge>
                    <Badge>{formatDateTime(project.updatedAt, locale)}</Badge>
                  </div>
                  <div className="mt-5 flex flex-wrap gap-3">
                    <Link prefetch={false} href={`/${locale}/projects/${project.id}`} className="inline-flex items-center justify-center rounded-[1rem] border border-[color:var(--border)] bg-[color:var(--surface-strong)] px-4 py-2.5 text-sm font-semibold transition-all duration-200 hover:bg-[color:var(--surface-hover)] active:scale-[0.98]">
                      {t("project.openWorkspace")}
                    </Link>
                    <Link prefetch={false} href={`/${locale}/knowledge?projectId=${project.id}`} className="inline-flex items-center justify-center rounded-[1rem] border border-[color:var(--border)] bg-[color:var(--surface-strong)] px-4 py-2.5 text-sm font-semibold transition-all duration-200 hover:bg-[color:var(--surface-hover)] active:scale-[0.98]">
                      {t("knowledge.openHub")}
                    </Link>
                    {canDeleteWorkspaceFromDashboard(project) ? (
                      <DashboardProjectDeleteControl locale={locale} projectId={project.id} />
                    ) : project.isSample ? (
                      <Badge>{t("project.sampleProtected")}</Badge>
                    ) : null}
                  </div>
                </article>
              </SortableCard>
            ))}
          </div>
        </SortableContext>
      </DndContext>
    ) : (
      <div className="dashboard-project-grid grid gap-5">
        {visibleProjects.map((project, idx) => (
          <StaticCard key={project.id}>
            <article className={`motion-card animate-fade-up rounded-r-2xl rounded-l-none border border-l-0 border-[color:var(--border)] bg-[color:var(--surface-soft)] p-6 stagger-${Math.min(idx + 1, 5)}`}>
              <div className="flex items-start justify-between gap-3">
                {selectMode && !project.isSample ? (
                  <button type="button" onClick={() => toggleSelect(project.id)} className="mt-1 shrink-0">
                    {selectedIds.has(project.id)
                      ? <CheckSquare className="h-5 w-5 text-[color:var(--brand-solid)]" />
                      : <Square className="h-5 w-5 text-[color:var(--muted)]" />}
                  </button>
                ) : null}
                <div className="space-y-2">
                  <div className="flex flex-wrap gap-2">
                    <h3 className="text-lg font-semibold">{project.title}</h3>
                    {project.isSample ? <Badge tone="accent">{t("dashboard.sampleBadge")}</Badge> : <Badge>{t("project.userProjectBadge")}</Badge>}
                  </div>
                  <p className="text-sm leading-6 text-[color:var(--muted)]">{project.description}</p>
                </div>
                <div className="flex flex-wrap justify-end gap-2">
                  <Badge>{t(`scenario.${project.scenario}`)}</Badge>
                  <Badge>{t(`roomVisibility.${project.visibility}`)}</Badge>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <Badge>{t(`languages.${project.language}`)}</Badge>
                <Badge>{`${project.participantCount} ${t("projectList.participants")}`}</Badge>
                <Badge>{`${project.entryCount} ${t("projectList.entries")}`}</Badge>
                <Badge>{formatDateTime(project.updatedAt, locale)}</Badge>
              </div>
              <div className="mt-5 flex flex-wrap gap-3">
                <Link prefetch={false} href={`/${locale}/projects/${project.id}`} className="inline-flex items-center justify-center rounded-[1rem] border border-[color:var(--border)] bg-[color:var(--surface-strong)] px-4 py-2.5 text-sm font-semibold transition-all duration-200 hover:bg-[color:var(--surface-hover)] active:scale-[0.98]">
                  {t("project.openWorkspace")}
                </Link>
                <Link prefetch={false} href={`/${locale}/knowledge?projectId=${project.id}`} className="inline-flex items-center justify-center rounded-[1rem] border border-[color:var(--border)] bg-[color:var(--surface-strong)] px-4 py-2.5 text-sm font-semibold transition-all duration-200 hover:bg-[color:var(--surface-hover)] active:scale-[0.98]">
                  {t("knowledge.openHub")}
                </Link>
                {canDeleteWorkspaceFromDashboard(project) ? (
                  <DashboardProjectDeleteControl locale={locale} projectId={project.id} />
                ) : project.isSample ? (
                  <Badge>{t("project.sampleProtected")}</Badge>
                ) : null}
              </div>
            </article>
          </StaticCard>
        ))}
      </div>
    )}
    {hiddenProjectCount > 0 ? (
      <div className="mt-4 flex justify-center">
        <Button
          variant="ghost"
          className="px-4 py-2 text-sm"
          onClick={() => setVisibleProjectCount((current) => current + PROJECT_LOAD_MORE_COUNT)}
        >
          {t("dashboard.loadMoreProjects", { count: String(Math.min(PROJECT_LOAD_MORE_COUNT, hiddenProjectCount)) })}
        </Button>
      </div>
    ) : null}
    {sampleProjects.length > 0 ? (
      <div className="mt-4">
        <button
          type="button"
          onClick={() => {
            setSampleVisibilityTouched(true);
            setShowSamples((v) => !v);
          }}
          className="inline-flex items-center gap-1.5 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-strong)] px-3 py-1.5 text-xs font-semibold text-[color:var(--muted)] transition hover:bg-[color:var(--surface-hover)] hover:text-[color:var(--foreground)]"
        >
          {showSamples ? t("dashboard.hideSamples") : t("dashboard.showSamples", { count: String(sampleProjects.length) })}
        </button>
        {showSamples ? (
          <div className="mt-3 grid gap-3 opacity-70">
            {sampleProjects.map((p) => (
              <Link key={p.id} prefetch={false} href={`/${locale}/projects/${p.id}`} className="flex items-center justify-between rounded-xl border border-dashed border-[color:var(--border)] bg-[color:var(--surface-muted)] px-4 py-3 text-sm transition hover:border-[color:var(--brand-solid)]/30">
                <div className="flex items-center gap-2">
                  <Badge tone="accent">{t("dashboard.sampleBadge")}</Badge>
                  <span className="font-semibold">{p.title}</span>
                </div>
                <span className="text-xs text-[color:var(--muted)]">{p.entryCount} {t("projectList.entries")}</span>
              </Link>
            ))}
          </div>
        ) : null}
      </div>
    ) : null}
    </>
  );
}
