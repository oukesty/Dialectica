"use client";

import Link from "next/link";
import { startTransition, useCallback, useEffect, useMemo, useState } from "react";
import { BookOpenText, ChevronDown, Eye, EyeOff, Filter, Layers3, Loader2, Network, Plus, RefreshCcw, Search, Sparkles, Trash2 } from "lucide-react";
import { useI18n } from "@/components/providers/i18n-provider";
import { Badge, Button, LinkButton, Panel } from "@/components/ui/primitives";
import { formatDateTime } from "@/lib/format";
import { AppLocale } from "@/lib/types";
import type { CrossGraphAnalysis, KnowledgeNode, KnowledgeOverview, UserKnowledgeGraphSummary } from "@/lib/knowledge/types";
import { isProtectedSampleKnowledgeGraph } from "@/lib/knowledge/types";
import { getProviderDescriptor } from "@/lib/providers/provider-catalog";

const inputClass = "form-field";

function buildGraphSourceKey(graph: Pick<UserKnowledgeGraphSummary, "id" | "sourceProjectIds">) {
  if (!graph.sourceProjectIds.length) return `graph:${graph.id}`;
  return [...graph.sourceProjectIds].sort().join("|");
}

function formatGraphModelLabel(
  t: (key: string, values?: Record<string, string>) => string,
  graph: Pick<UserKnowledgeGraphSummary, "generatedProviderId" | "generatedModel">,
) {
  const providerId = graph.generatedProviderId?.trim();
  const model = graph.generatedModel?.trim();
  if (!providerId) return null;
  const providerLabel = getProviderDescriptor(providerId as never)?.label ?? providerId;
  if (model) {
    return t("knowledge.generatedWith", { provider: providerLabel, model });
  }
  return t("knowledge.generatedWithProviderOnly", { provider: providerLabel });
}

export function KnowledgeHub({
  locale,
  overview,
  nodes,
  initialProjectId,
  defaultGraphMode = "both",
}: {
  locale: AppLocale;
  overview: KnowledgeOverview;
  nodes: KnowledgeNode[];
  initialProjectId?: string;
  defaultGraphMode?: "2d" | "3d" | "both";
}) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [topic, setTopic] = useState("");
  const [category, setCategory] = useState("");
  const [projectId, setProjectId] = useState(initialProjectId ?? "");
  const [deletedProjectIds] = useState<string[]>([]);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return nodes.filter((node) => {
      if (deletedProjectIds.includes(node.sourceProjectId)) return false;
      const matchesQuery = !normalized || `${node.title} ${node.summary} ${node.tags.join(" ")} ${node.topics.join(" ")}`.toLowerCase().includes(normalized);
      const matchesTopic = !topic || node.topics.includes(topic);
      const matchesCategory = !category || node.category === category;
      const matchesProject = !projectId || node.sourceProjectId === projectId;
      return matchesQuery && matchesTopic && matchesCategory && matchesProject;
    });
  }, [category, deletedProjectIds, nodes, projectId, query, topic]);

  const topics = useMemo(
    () => [...new Set(nodes.filter((node) => !deletedProjectIds.includes(node.sourceProjectId)).flatMap((node) => node.topics))].sort(),
    [deletedProjectIds, nodes],
  );
  const projects = useMemo(
    () => overview.projects.filter((project) => !deletedProjectIds.includes(project.projectId)),
    [deletedProjectIds, overview.projects],
  );
  const selectedProject = projects.find((project) => project.projectId === projectId);
  const visibleNodes = useMemo(() => filtered.slice(0, 12), [filtered]);

  // User-owned graphs
  const [userGraphs, setUserGraphs] = useState<UserKnowledgeGraphSummary[]>([]);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createTitle, setCreateTitle] = useState("");
  const [createProjectIds, setCreateProjectIds] = useState<string[]>([]);
  const [createMode, setCreateMode] = useState<"2d" | "3d" | "both">(defaultGraphMode);
  const [createVisibility, setCreateVisibility] = useState<"private" | "public">("private");
  const [creating, setCreating] = useState(false);
  const [samplesCollapsed, setSamplesCollapsed] = useState(false);
  const [projectSamplesCollapsed, setProjectSamplesCollapsed] = useState(false);
  const [samplesVisibilityTouched, setSamplesVisibilityTouched] = useState(false);
  const [projectSamplesVisibilityTouched, setProjectSamplesVisibilityTouched] = useState(false);
  const [expandedGraphGroups, setExpandedGraphGroups] = useState<Record<string, boolean>>({});
  const [graphMessage, setGraphMessage] = useState<string | null>(null);
  const [graphMessageTone, setGraphMessageTone] = useState<"success" | "danger">("success");
  const [userGraphsLoadError, setUserGraphsLoadError] = useState<string | null>(null);
  const [retryingGraphId, setRetryingGraphId] = useState<string | null>(null);

  // Cross-graph analysis
  const [analyzeGraphIds, setAnalyzeGraphIds] = useState<string[]>([]);
  const [analyzeGoal, setAnalyzeGoal] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<CrossGraphAnalysis | null>(null);

  const readErrorMessage = useCallback(async (response: Response) => {
    const payload = await response.json().catch(() => null) as { error?: string } | null;
    if (payload?.error) return payload.error;
    const text = await response.text().catch(() => "");
    return text || t("errors.unexpected");
  }, [t]);

  const loadUserGraphs = useCallback(async () => {
    const res = await fetch(`/api/knowledge/user-graphs?locale=${encodeURIComponent(locale)}`);
    if (!res.ok) {
      throw new Error(await readErrorMessage(res));
    }
    const data = (await res.json()) as { graphs: UserKnowledgeGraphSummary[] };
    startTransition(() => {
      setUserGraphs(data.graphs);
      setUserGraphsLoadError(null);
    });
  }, [locale, readErrorMessage]);

  useEffect(() => {
    void loadUserGraphs().catch((error) => {
      setUserGraphsLoadError(error instanceof Error ? error.message : t("errors.unexpected"));
    });
  }, [loadUserGraphs, t]);

  useEffect(() => {
    let alive = true;
    fetch(`/api/knowledge/user-graphs/analyze?locale=${encodeURIComponent(locale)}`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) return null;
        return await response.json() as { analysis: CrossGraphAnalysis | null };
      })
      .then((payload) => {
        if (!alive || !payload?.analysis) return;
        setAnalysisResult(payload.analysis);
        setAnalyzeGraphIds(payload.analysis.sourceGraphIds);
        setAnalyzeGoal(payload.analysis.analysisGoal);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [locale]);

  const shouldCollapseGraphSamples = userGraphs.some((graph) => graph.canDelete) || projects.some((project) => !project.isProtectedSample);
  const shouldCollapseProjectSamples = projects.some((project) => !project.isProtectedSample) || userGraphs.some((graph) => graph.canDelete);

  // Apply the default collapse rule only until the user manually changes the section state.
  useEffect(() => {
    if (samplesVisibilityTouched) return;
    setSamplesCollapsed(shouldCollapseGraphSamples);
  }, [samplesVisibilityTouched, shouldCollapseGraphSamples]);

  useEffect(() => {
    if (projectSamplesVisibilityTouched) return;
    setProjectSamplesCollapsed(shouldCollapseProjectSamples);
  }, [projectSamplesVisibilityTouched, shouldCollapseProjectSamples]);

  useEffect(() => {
    if (!userGraphs.some((graph) => graph.status === "pending" || graph.status === "generating")) {
      return undefined;
    }
    const timer = window.setInterval(() => {
      void loadUserGraphs().catch((error) => {
        setUserGraphsLoadError(error instanceof Error ? error.message : t("errors.unexpected"));
      });
    }, 2500);
    return () => window.clearInterval(timer);
  }, [loadUserGraphs, t, userGraphs]);

  useEffect(() => {
    setCreateMode(defaultGraphMode);
  }, [defaultGraphMode]);

  const handleCreateGraph = async () => {
    if (!createTitle.trim() || createProjectIds.length === 0) return;
    setCreating(true);
    setGraphMessage(null);
    try {
      const response = await fetch("/api/knowledge/user-graphs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: createTitle.trim(),
          sourceProjectIds: createProjectIds,
          graphMode: createMode,
          visibility: createVisibility,
          locale,
        }),
      });
      if (!response.ok) {
        throw new Error(await readErrorMessage(response));
      }
      const payload = await response.json() as { graph?: { status?: UserKnowledgeGraphSummary["status"]; errorMessage?: string } };
      setCreateTitle("");
      setCreateProjectIds([]);
      setShowCreateForm(false);
      await loadUserGraphs();
      setGraphMessage(payload.graph?.status === "failed" ? (payload.graph.errorMessage ?? t("knowledge.graphFailed")) : payload.graph?.status === "ready" ? t("knowledge.graphReady") : t("assistant.graphGenerating"));
      setGraphMessageTone(payload.graph?.status === "failed" ? "danger" : "success");
    } catch (error) {
      setGraphMessage(error instanceof Error ? error.message : t("errors.unexpected"));
      setGraphMessageTone("danger");
    } finally {
      setCreating(false);
    }
  };

  const handleRetryGraph = async (graphId: string) => {
    setRetryingGraphId(graphId);
    setGraphMessage(null);
    try {
      const response = await fetch(`/api/knowledge/user-graphs/${graphId}?locale=${encodeURIComponent(locale)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "retry" }),
      });
      if (!response.ok) {
        throw new Error(await readErrorMessage(response));
      }
      const payload = await response.json() as { graph?: { status?: UserKnowledgeGraphSummary["status"]; errorMessage?: string } };
      await loadUserGraphs();
      setGraphMessage(payload.graph?.status === "failed" ? (payload.graph.errorMessage ?? t("knowledge.graphFailed")) : t("knowledge.graphReady"));
      setGraphMessageTone(payload.graph?.status === "failed" ? "danger" : "success");
    } catch (error) {
      setGraphMessage(error instanceof Error ? error.message : t("errors.unexpected"));
      setGraphMessageTone("danger");
    } finally {
      setRetryingGraphId(null);
    }
  };

  const handleDeleteGraphVersion = async (graphId: string) => {
    if (!window.confirm(t("knowledge.deleteGraphVersionConfirm"))) return;
    setGraphMessage(null);
    try {
      const response = await fetch(`/api/knowledge/user-graphs/${graphId}?locale=${encodeURIComponent(locale)}`, { method: "DELETE" });
      if (!response.ok) {
        throw new Error(await readErrorMessage(response));
      }
      setAnalyzeGraphIds((prev) => prev.filter((id) => id !== graphId));
      setAnalysisResult(null);
      await loadUserGraphs();
      setGraphMessage(t("knowledge.graphVersionDeleted"));
      setGraphMessageTone("success");
    } catch (error) {
      setGraphMessage(error instanceof Error ? error.message : t("errors.unexpected"));
      setGraphMessageTone("danger");
    }
  };

  const handleDeleteGraphGroup = async (group: {
    key: string;
    versions: UserKnowledgeGraphSummary[];
  }) => {
    if (!window.confirm(t("knowledge.deleteGraphGroupConfirm", { count: String(group.versions.length) }))) return;
    setGraphMessage(null);
    try {
      const response = await fetch(`/api/knowledge/user-graphs?locale=${encodeURIComponent(locale)}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "delete-versions",
          graphIds: group.versions.map((version) => version.id),
        }),
      });
      if (!response.ok) {
        throw new Error(await readErrorMessage(response));
      }
      const groupIds = new Set(group.versions.map((version) => version.id));
      setAnalyzeGraphIds((prev) => prev.filter((id) => !groupIds.has(id)));
      setAnalysisResult(null);
      setExpandedGraphGroups((current) => {
        const next = { ...current };
        delete next[group.key];
        return next;
      });
      await loadUserGraphs();
      setGraphMessage(t("knowledge.graphGroupDeleted"));
      setGraphMessageTone("success");
    } catch (error) {
      setGraphMessage(error instanceof Error ? error.message : t("errors.unexpected"));
      setGraphMessageTone("danger");
    }
  };

  const handleKeepLatestGraphGroup = async (group: {
    key: string;
    versions: UserKnowledgeGraphSummary[];
  }) => {
    const staleVersions = group.versions.slice(1);
    if (staleVersions.length === 0) return;
    if (!window.confirm(t("knowledge.keepLatestGraphConfirm", { count: String(staleVersions.length) }))) return;
    setGraphMessage(null);
    try {
      const response = await fetch(`/api/knowledge/user-graphs?locale=${encodeURIComponent(locale)}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "keep-latest",
          graphIds: group.versions.map((version) => version.id),
          keepGraphId: group.versions[0]?.id,
        }),
      });
      if (!response.ok) {
        throw new Error(await readErrorMessage(response));
      }
      const staleIds = new Set(staleVersions.map((version) => version.id));
      setAnalyzeGraphIds((prev) => prev.filter((id) => !staleIds.has(id)));
      setAnalysisResult(null);
      await loadUserGraphs();
      setGraphMessage(t("knowledge.keptLatestGraph"));
      setGraphMessageTone("success");
    } catch (error) {
      setGraphMessage(error instanceof Error ? error.message : t("errors.unexpected"));
      setGraphMessageTone("danger");
    }
  };

  const handleToggleVisibility = async (graphId: string, current: "private" | "public") => {
    setGraphMessage(null);
    try {
      const response = await fetch(`/api/knowledge/user-graphs/${graphId}?locale=${encodeURIComponent(locale)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ visibility: current === "private" ? "public" : "private" }),
      });
      if (!response.ok) {
        throw new Error(await readErrorMessage(response));
      }
      await loadUserGraphs();
    } catch (error) {
      setGraphMessage(error instanceof Error ? error.message : t("errors.unexpected"));
      setGraphMessageTone("danger");
    }
  };

  const handleAnalyze = async () => {
    if (analyzeGraphIds.length < 2) return;
    setAnalyzing(true);
    setAnalysisResult(null);
    setGraphMessage(null);
    try {
      const res = await fetch("/api/knowledge/user-graphs/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ graphIds: analyzeGraphIds, analysisGoal: analyzeGoal, locale }),
      });
      if (!res.ok) {
        throw new Error(await readErrorMessage(res));
      }
      const data = await res.json();
      setAnalysisResult(data.analysis);
      setGraphMessageTone("success");
    } catch (error) {
      setGraphMessage(error instanceof Error ? error.message : t("knowledge.crossAnalysisFailed"));
      setGraphMessageTone("danger");
    } finally {
      setAnalyzing(false);
    }
  };

  const toggleAnalyzeGraph = (graphId: string) => {
    setAnalyzeGraphIds((prev) => prev.includes(graphId) ? prev.filter((id) => id !== graphId) : [...prev, graphId]);
  };

  const ownGraphs = userGraphs.filter((graph) => graph.canDelete);
  const sampleGraphs = userGraphs.filter((graph) => isProtectedSampleKnowledgeGraph(graph) && graph.sourceProjectIds.length === 1);
  const creatableProjects = projects.filter((project) => project.canDelete && !project.isProtectedSample);
  const ownProjectClusters = projects.filter((project) => !project.isProtectedSample);
  const sampleProjectClusters = projects.filter((project) => project.isProtectedSample);
  const ownGraphGroups = useMemo(() => {
    const groups = new Map<string, {
      key: string;
      sourceProjectIds: string[];
      sourceProjectTitles: string[];
      latest: UserKnowledgeGraphSummary;
      versions: UserKnowledgeGraphSummary[];
    }>();

    for (const graph of ownGraphs) {
      const key = buildGraphSourceKey(graph);
      const existing = groups.get(key);
      if (existing) {
        existing.versions.push(graph);
        continue;
      }
      groups.set(key, {
        key,
        sourceProjectIds: [...graph.sourceProjectIds],
        sourceProjectTitles: [...graph.sourceProjectTitles],
        latest: graph,
        versions: [graph],
      });
    }

    return [...groups.values()]
      .map((group) => {
        const versions = [...group.versions].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
        return {
          ...group,
          latest: versions[0],
          versions,
        };
      })
      .sort((left, right) => right.latest.updatedAt.localeCompare(left.latest.updatedAt));
  }, [ownGraphs]);

  const buildUserGraphHref = (graph: UserKnowledgeGraphSummary) => {
    if (graph.sourceProjectIds.length === 1) {
      return `/${locale}/knowledge/graph?graphId=${graph.id}&projectId=${graph.sourceProjectIds[0]}&scopeMode=project`;
    }
    return `/${locale}/knowledge/graph?graphId=${graph.id}&projectIds=${graph.sourceProjectIds.join(",")}&scopeMode=cross-project`;
  };

  const clearFilters = () => {
    setQuery("");
    setTopic("");
    setCategory("");
    setProjectId("");
  };

  const graphHref = `/${locale}/knowledge/graph${projectId ? `?projectId=${projectId}` : ""}`;
  const crossProjectGraphHref = `/${locale}/knowledge/graph?scopeMode=cross-project`;

  return (
    <div className="space-y-7 animate-fade-up">
      <Panel className="hero-surface overflow-hidden p-5 sm:p-8 lg:p-10">
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.04fr)_minmax(22rem,0.96fr)] xl:items-end">
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <Badge tone="accent">{t("knowledge.title")}</Badge>
              <Badge>{formatDateTime(overview.generatedAt, locale)}</Badge>
              <Badge>{t(projectId ? "knowledge.scopeProject" : "knowledge.scopeCrossProject")}</Badge>
              {projectId ? <Badge>{selectedProject?.projectTitle ?? projectId}</Badge> : null}
            </div>
            <div>
              <h1 className="font-display text-4xl font-semibold tracking-tight sm:text-5xl">{t("knowledge.title")}</h1>
              <p className="mt-3 max-w-4xl text-sm leading-7 text-[color:var(--muted)] sm:text-base">{t("knowledge.subtitle")}</p>
              <p className="mt-2 max-w-4xl text-sm leading-7 text-[color:var(--muted)]">{t(projectId ? "knowledge.scopeProjectBody" : "knowledge.scopeCrossProjectBody")}</p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Link prefetch={false} href={graphHref} className="inline-flex items-center justify-center rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-4 py-2.5 text-sm font-semibold transition-all duration-200 hover:bg-[color:var(--surface-hover)] hover:shadow-[0_4px_12px_rgba(var(--shadow-color)/0.06)] active:scale-[0.98]">
                <Network className="mr-2 h-4 w-4" />
                {t("knowledge.openGraph")}
              </Link>
              {projectId ? (
                <Link prefetch={false} href={crossProjectGraphHref} className="inline-flex items-center justify-center rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-4 py-2.5 text-sm font-semibold transition-all duration-200 hover:bg-[color:var(--surface-hover)] hover:shadow-[0_4px_12px_rgba(var(--shadow-color)/0.06)] active:scale-[0.98]">
                  <Layers3 className="mr-2 h-4 w-4" />
                  {t("knowledge.openCrossProjectGraph")}
                </Link>
              ) : null}
            </div>
          </div>

          <div className="grid gap-3 rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface-strong)] p-4 shadow-panel">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <div className="rounded-lg border border-[color:var(--brand-solid)]/20 bg-[color:var(--brand-soft)] p-3 text-center">
                <p className="text-2xl font-bold text-[color:var(--brand-ink)]">{overview.totalNodes}</p>
                <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[color:var(--muted)]">{t("knowledge.metrics.nodes")}</p>
              </div>
              <div className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-3 text-center">
                <p className="text-2xl font-bold">{overview.totalRelations}</p>
                <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[color:var(--muted)]">{t("knowledge.metrics.relations")}</p>
              </div>
              <div className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-3 text-center">
                <p className="text-2xl font-bold">{projects.length}</p>
                <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[color:var(--muted)]">{t("knowledge.metrics.projects")}</p>
              </div>
              <div className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-3 text-center">
                <p className="text-2xl font-bold">{overview.categories.length}</p>
                <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[color:var(--muted)]">{t("knowledge.metrics.categories")}</p>
              </div>
            </div>
            <div className="flex items-center gap-3 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-4 py-3">
              <Sparkles className="h-4 w-4 shrink-0 text-[color:var(--brand-solid)]" />
              <div className="min-w-0">
                <p className="text-sm font-semibold">{selectedProject?.projectTitle ?? t("knowledge.crossProject")}</p>
                <p className="mt-0.5 text-xs leading-5 text-[color:var(--muted)]">{t(projectId ? "knowledge.graphIsolatedHint" : "knowledge.graphCrossProjectHint")}</p>
              </div>
            </div>
          </div>
        </div>
      </Panel>

      {/* My Graphs */}
      <Panel className="space-y-5 p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="theme-icon-tile inline-flex h-10 w-10 items-center justify-center rounded-xl">
              <Network className="h-4.5 w-4.5" />
            </div>
            <div>
              <h2 className="font-display text-lg font-semibold">{t("knowledge.myGraphs")}</h2>
              <p className="text-sm text-[color:var(--muted)]">{t("knowledge.myGraphsHint")}</p>
            </div>
          </div>
          <Button className="gap-2" onClick={() => setShowCreateForm((v) => !v)}>
            <Plus className="h-4 w-4" />
            {t("knowledge.createGraph")}
          </Button>
        </div>
        {graphMessage ? (
          <p className={graphMessageTone === "danger" ? "text-sm text-rose-600 dark:text-rose-300" : "text-sm text-emerald-600 dark:text-emerald-300"}>
            {graphMessage}
          </p>
        ) : null}
        {userGraphsLoadError ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-rose-500/20 bg-rose-500/5 px-4 py-3 text-sm text-rose-700 dark:text-rose-200">
            <span>{t("knowledge.userGraphsLoadFailed")}: {userGraphsLoadError}</span>
            <Button variant="ghost" className="h-8 px-3 text-xs" onClick={() => void loadUserGraphs().catch((error) => {
              setUserGraphsLoadError(error instanceof Error ? error.message : t("errors.unexpected"));
            })}>
              {t("common.retry")}
            </Button>
          </div>
        ) : null}

        {showCreateForm ? (
          <div className="animate-popover-in space-y-4 rounded-2xl border border-[color:var(--brand-solid)]/20 bg-[color:var(--surface-muted)] p-5">
            <h3 className="font-semibold">{t("knowledge.createGraph")}</h3>
            <input className={inputClass} value={createTitle} onChange={(e) => setCreateTitle(e.target.value)} placeholder={t("knowledge.graphTitlePlaceholder")} />
            <div className="space-y-2">
              <span className="text-sm font-medium">{t("knowledge.selectProjects")}</span>
              <div className="max-h-40 space-y-1 overflow-y-auto scroll-fade-y">
                {creatableProjects.map((p) => (
                  <label key={p.projectId} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition hover:bg-[color:var(--surface-hover)]">
                    <input type="checkbox" checked={createProjectIds.includes(p.projectId)} onChange={(e) => setCreateProjectIds(e.target.checked ? [...createProjectIds, p.projectId] : createProjectIds.filter((id) => id !== p.projectId))} />
                    <span className="font-semibold">{p.projectTitle}</span>
                    <Badge>{p.nodeCount} {t("knowledge.metrics.nodes")}</Badge>
                  </label>
                ))}
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="space-y-2">
                <span className="text-sm font-medium">{t("knowledge.graphMode")}</span>
                <select className={inputClass} value={createMode} onChange={(e) => setCreateMode(e.target.value as typeof createMode)}>
                  <option value="both">{t("knowledge.graphViewBoth")}</option>
                  <option value="2d">{t("knowledge.graphView2d")}</option>
                  <option value="3d">{t("knowledge.graphView3d")}</option>
                </select>
              </label>
              <label className="space-y-2">
                <span className="text-sm font-medium">{t("knowledge.graphVisibility")}</span>
                <select className={inputClass} value={createVisibility} onChange={(e) => setCreateVisibility(e.target.value as typeof createVisibility)}>
                  <option value="private">{t("knowledge.visibilityPrivate")}</option>
                  <option value="public">{t("knowledge.visibilityPublic")}</option>
                </select>
              </label>
            </div>
            {createProjectIds.length > 0 ? (
              <p className="text-xs text-[color:var(--muted)]">
                {t("knowledge.estimatedTime", { count: String(createProjectIds.length), time: String(Math.max(5, createProjectIds.length * 3)) })}
              </p>
            ) : null}
            <p className="text-xs leading-5 text-[color:var(--muted)]">{t("knowledge.graphQualityHint")}</p>
            {creatableProjects.length === 0 ? (
              <p className="text-xs text-[color:var(--muted)]">{t("knowledge.sampleGraphGenerationDisabled")}</p>
            ) : null}
            <div className="flex gap-3">
              <Button onClick={handleCreateGraph} disabled={creating || !createTitle.trim() || createProjectIds.length === 0 || creatableProjects.length === 0}>
                {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {creating ? `${t("common.loading")}...` : t("knowledge.generateNow")}
              </Button>
              <Button variant="ghost" onClick={() => setShowCreateForm(false)}>{t("common.cancel")}</Button>
            </div>
          </div>
        ) : null}

        {ownGraphGroups.length > 0 ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {ownGraphGroups.map((group) => {
              const graph = group.latest;
              const versionCount = group.versions.length;
              const modelLabel = formatGraphModelLabel(t, graph);
              const versionsExpanded = expandedGraphGroups[group.key] ?? false;
              return (
                <div key={group.key} className="motion-card rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface-soft)] p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{graph.title}</p>
                      <p className="mt-0.5 text-xs text-[color:var(--muted)]">{graph.sourceProjectTitles.join(", ")}</p>
                      {modelLabel ? <p className="mt-1 text-[11px] leading-5 text-[color:var(--muted)]">{modelLabel}</p> : null}
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      {graph.status === "generating" ? <Loader2 className="h-3.5 w-3.5 animate-spin text-[color:var(--brand-solid)]" /> : null}
                      {graph.status === "ready" ? <Badge tone="accent">{t("knowledge.graphReady")}</Badge> : null}
                      {graph.status === "pending" ? <Badge>{t("knowledge.graphPending")}</Badge> : null}
                      {graph.status === "failed" ? <Badge>{t("knowledge.graphFailed")}</Badge> : null}
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <Badge>{graph.nodeCount} {t("knowledge.metrics.nodes")}</Badge>
                    <Badge>{graph.graphMode.toUpperCase()}</Badge>
                    <Badge>{graph.visibility === "public" ? t("knowledge.visibilityPublic") : t("knowledge.visibilityPrivate")}</Badge>
                    {versionCount > 1 ? <Badge>{t("knowledge.versionsCount", { count: String(versionCount) })}</Badge> : <Badge>{t("knowledge.latestVersion")}</Badge>}
                  </div>
                  <div className="mt-3 flex items-center gap-2">
                    {graph.status === "ready" ? (
                      <LinkButton href={buildUserGraphHref(graph)} variant="ghost" className="h-8 px-3 text-xs">
                        {t("knowledge.openGraph")}
                      </LinkButton>
                    ) : graph.status === "pending" || graph.status === "generating" ? (
                      <Button variant="ghost" className="h-8 gap-1.5 px-3 text-xs" disabled>
                        {graph.status === "generating" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                        {graph.status === "generating" ? t("knowledge.graphGenerating") : t("knowledge.graphPending")}
                      </Button>
                    ) : graph.status === "failed" ? (
                      <Button variant="ghost" className="h-8 gap-1.5 px-3 text-xs" disabled={retryingGraphId === graph.id} onClick={() => void handleRetryGraph(graph.id)}>
                        {retryingGraphId === graph.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCcw className="h-3.5 w-3.5" />}
                        {t("common.retry")}
                      </Button>
                    ) : null}
                    <button type="button" onClick={() => void handleToggleVisibility(graph.id, graph.visibility)} className="text-xs text-[color:var(--muted)] hover:text-[color:var(--foreground)]" title={graph.visibility === "public" ? t("knowledge.makePrivate") : t("knowledge.makePublic")}>
                      {graph.visibility === "public" ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </button>
                    {graph.canDelete ? (
                      versionCount > 1 ? (
                        <>
                          <Button
                            variant="ghost"
                            className="h-8 gap-1.5 px-3 text-xs"
                            onClick={() => void handleKeepLatestGraphGroup(group)}
                          >
                            <Layers3 className="h-3.5 w-3.5" />
                            {t("knowledge.keepLatestGraph")}
                          </Button>
                          <Button
                            variant="danger"
                            className="h-8 gap-1.5 px-3 text-xs"
                            onClick={() => void handleDeleteGraphGroup(group)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            {t("knowledge.deleteGraphGroup")}
                          </Button>
                        </>
                      ) : (
                        <Button
                          variant="danger"
                          className="h-8 gap-1.5 px-3 text-xs"
                          onClick={() => void handleDeleteGraphVersion(graph.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          {t("knowledge.deleteGraphVersion")}
                        </Button>
                      )
                    ) : null}
                  </div>
                  {versionCount > 1 ? (
                    <div className="mt-3 rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-3">
                      <button
                        type="button"
                        onClick={() => setExpandedGraphGroups((current) => ({ ...current, [group.key]: !versionsExpanded }))}
                        className="flex items-center gap-2 text-xs font-semibold text-[color:var(--muted)] transition hover:text-[color:var(--foreground)]"
                      >
                        <ChevronDown className={`h-3.5 w-3.5 transition ${versionsExpanded ? "" : "-rotate-90"}`} />
                        {versionsExpanded ? t("knowledge.hideVersions") : t("knowledge.showVersions")}
                      </button>
                      {versionsExpanded ? (
                        <div className="mt-3 space-y-2">
                          {group.versions.map((version, index) => {
                            const versionModelLabel = formatGraphModelLabel(t, version);
                            return (
                              <div key={version.id} className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-soft)] px-3 py-2">
                                <div className="flex items-start justify-between gap-3">
                                  <div className="min-w-0">
                                    <p className="text-xs font-semibold">{index === 0 ? `${t("knowledge.latestVersion")} · ${version.title}` : version.title}</p>
                                    <p className="mt-0.5 text-[11px] text-[color:var(--muted)]">{formatDateTime(version.updatedAt, locale)}</p>
                                    {versionModelLabel ? <p className="mt-1 text-[11px] text-[color:var(--muted)]">{versionModelLabel}</p> : null}
                                  </div>
                                  <div className="flex shrink-0 items-center gap-2">
                                    {version.status === "ready" ? (
                                      <LinkButton href={buildUserGraphHref(version)} variant="ghost" className="h-7 px-2.5 text-[11px]">
                                        {t("knowledge.openGraph")}
                                      </LinkButton>
                                    ) : (
                                      version.status === "failed" ? (
                                        <Button variant="ghost" className="h-7 gap-1 px-2.5 text-[11px]" disabled={retryingGraphId === version.id} onClick={() => void handleRetryGraph(version.id)}>
                                          {retryingGraphId === version.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCcw className="h-3 w-3" />}
                                          {t("common.retry")}
                                        </Button>
                                      ) : (
                                        <Badge>{version.status === "generating" ? t("knowledge.graphGenerating") : t("knowledge.graphPending")}</Badge>
                                      )
                                    )}
                                    {version.canDelete ? (
                                      <Button
                                        variant="danger"
                                        className="h-7 gap-1 px-2.5 text-[11px]"
                                        onClick={() => void handleDeleteGraphVersion(version.id)}
                                      >
                                        <Trash2 className="h-3 w-3" />
                                        {t("knowledge.deleteGraphVersion")}
                                      </Button>
                                    ) : null}
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : !showCreateForm ? (
          <div className="rounded-2xl border border-dashed border-[color:var(--border)] p-6 text-center text-sm text-[color:var(--muted)]">
            {t("knowledge.noUserGraphs")}
          </div>
        ) : null}

        {/* Sample graphs collapse */}
        {sampleGraphs.length > 0 ? (
          ownGraphGroups.length > 0 || ownProjectClusters.length > 0 ? (
            <button
              type="button"
              onClick={() => {
                setSamplesVisibilityTouched(true);
                setSamplesCollapsed((v) => !v);
              }}
              className="flex items-center gap-2 text-xs font-semibold text-[color:var(--muted)] transition hover:text-[color:var(--foreground)]"
            >
              <ChevronDown className={`h-3.5 w-3.5 transition ${samplesCollapsed ? "" : "rotate-180"}`} />
              {samplesCollapsed ? t("knowledge.showSamples", { count: String(sampleGraphs.length) }) : t("knowledge.hideSamples")}
            </button>
          ) : null
        ) : null}
        {sampleGraphs.length > 0 && !samplesCollapsed ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {sampleGraphs.map((graph) => (
              <div key={graph.id} className="motion-card rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface-soft)] p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{graph.title}</p>
                    <p className="mt-0.5 text-xs text-[color:var(--muted)]">{graph.sourceProjectTitles.join(", ")}</p>
                    {formatGraphModelLabel(t, graph) ? <p className="mt-1 text-[11px] leading-5 text-[color:var(--muted)]">{formatGraphModelLabel(t, graph)}</p> : null}
                  </div>
                  <Badge tone="accent">{t("dashboard.sampleBadge")}</Badge>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Badge>{graph.nodeCount} {t("knowledge.metrics.nodes")}</Badge>
                  <Badge>{graph.graphMode.toUpperCase()}</Badge>
                  <Badge>{graph.visibility === "public" ? t("knowledge.visibilityPublic") : t("knowledge.visibilityPrivate")}</Badge>
                </div>
                <div className="mt-3 flex items-center gap-2">
                  {graph.status === "ready" ? (
                    <LinkButton href={buildUserGraphHref(graph)} variant="ghost" className="h-8 px-3 text-xs">
                      {t("knowledge.openGraph")}
                    </LinkButton>
                  ) : graph.status === "pending" || graph.status === "generating" ? (
                    <Button variant="ghost" className="h-8 gap-1.5 px-3 text-xs" disabled>
                      {graph.status === "generating" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                      {graph.status === "generating" ? t("knowledge.graphGenerating") : t("knowledge.graphPending")}
                    </Button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        ) : null}

        {/* Cross-graph analysis */}
        {ownGraphs.filter((g) => g.status === "ready").length >= 2 ? (
          <div className="space-y-4 rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-5">
            <div className="flex items-center gap-3">
              <Layers3 className="h-5 w-5 text-[color:var(--brand-solid)]" />
              <div>
                <h3 className="font-semibold">{t("knowledge.crossAnalysis")}</h3>
                <p className="text-xs text-[color:var(--muted)]">{t("knowledge.crossAnalysisHint")}</p>
              </div>
            </div>
            <div className="space-y-2">
              {ownGraphs.filter((g) => g.status === "ready").map((graph) => (
                <label key={graph.id} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition hover:bg-[color:var(--surface-hover)]">
                  <input type="checkbox" checked={analyzeGraphIds.includes(graph.id)} onChange={() => toggleAnalyzeGraph(graph.id)} />
                  <span className="font-semibold">{graph.title}</span>
                  <Badge>{graph.nodeCount} {t("knowledge.metrics.nodes")}</Badge>
                </label>
              ))}
            </div>
            <input className={inputClass} value={analyzeGoal} onChange={(e) => setAnalyzeGoal(e.target.value)} placeholder={t("knowledge.analysisGoalPlaceholder")} />
            <Button onClick={handleAnalyze} disabled={analyzing || analyzeGraphIds.length < 2}>
              {analyzing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Layers3 className="mr-2 h-4 w-4" />}
              {analyzing ? `${t("common.loading")}...` : t("knowledge.runCrossAnalysis")}
            </Button>

            {analysisResult ? (
              <div className="animate-fade-up space-y-4 rounded-xl border border-[color:var(--brand-solid)]/20 bg-[color:var(--surface-strong)] p-4">
                {analysisResult.sharedConcepts.length > 0 ? (
                  <div>
                    <h4 className="text-sm font-semibold text-[color:var(--brand-ink)]">{t("knowledge.sharedConcepts")} ({analysisResult.sharedConcepts.length})</h4>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {analysisResult.sharedConcepts.slice(0, 15).map((c) => (
                        <Badge key={c.concept} tone="accent">{c.concept}</Badge>
                      ))}
                    </div>
                  </div>
                ) : null}
                {analysisResult.conflictingViewpoints.length > 0 ? (
                  <div>
                    <h4 className="text-sm font-semibold text-amber-700 dark:text-amber-200">{t("knowledge.conflictingViewpoints")} ({analysisResult.conflictingViewpoints.length})</h4>
                    <div className="mt-2 space-y-2">
                      {analysisResult.conflictingViewpoints.slice(0, 5).map((c, i) => (
                        <div key={`conflict-${i}`} className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs">
                          <p className="font-semibold">{c.topic}</p>
                          <p className="mt-1 text-[color:var(--muted)]">{c.note}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
                {analysisResult.supportingConclusions.length > 0 ? (
                  <div>
                    <h4 className="text-sm font-semibold text-emerald-700 dark:text-emerald-300">{t("knowledge.supportingConclusions")} ({analysisResult.supportingConclusions.length})</h4>
                    <div className="mt-2 space-y-2">
                      {analysisResult.supportingConclusions.slice(0, 5).map((c, i) => (
                        <div key={`support-${i}`} className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-xs">
                          <p className="font-semibold">{c.conclusion}</p>
                          <p className="mt-1 text-[color:var(--muted)]">{c.evidence.slice(0, 200)}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
                {analysisResult.unrelatedNodes.length > 0 ? (
                  <p className="text-xs text-[color:var(--muted)]">{t("knowledge.unrelatedCount", { count: String(analysisResult.unrelatedNodes.length) })}</p>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </Panel>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(19rem,0.42fr)] xl:items-start">
        <div className="space-y-4 xl:min-w-0">
          <Panel className="space-y-4 p-5 lg:p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2 className="font-display text-2xl font-semibold">{t("knowledge.resultsTitle")}</h2>
                <p className="mt-1 text-sm text-[color:var(--muted)]">{t("knowledge.resultsCount", { count: String(filtered.length) })}</p>
              </div>
              {projectId ? <Badge tone="accent">{selectedProject?.projectTitle ?? projectId}</Badge> : <Badge>{t("knowledge.crossProject")}</Badge>}
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              {visibleNodes.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-[color:var(--border)] p-6 text-sm text-[color:var(--muted)] md:col-span-2">{t("knowledge.empty")}</div>
              ) : (
                visibleNodes.map((node, idx) => (
                  <Link prefetch={false} key={node.id} href={`/${locale}/knowledge/${encodeURIComponent(node.id)}`} className={`motion-card group animate-fade-up min-h-[12rem] rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-4 transition-all duration-200 hover:border-[color:var(--brand-solid)] stagger-${Math.min(idx + 1, 5)}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone="accent">{t(`knowledge.nodeTypes.${node.type}`)}</Badge>
                        <Badge>{t(`knowledge.categories.${node.category}`)}</Badge>
                      </div>
                    </div>
                    <h3 className="mt-3 text-base font-semibold leading-snug group-hover:text-[color:var(--brand-solid)]">{node.title}</h3>
                    <p className="mt-2 line-clamp-3 text-sm leading-6 text-[color:var(--muted)]">{node.summary}</p>
                    <div className="mt-4 flex flex-wrap gap-1.5">
                      <Badge>{node.sourceProjectTitle}</Badge>
                      {node.topics.slice(0, 2).map((item) => <Badge key={`${node.id}-${item}`}>{item}</Badge>)}
                      {node.tags.slice(0, 2).map((item) => <Badge key={`${node.id}-tag-${item}`}>{item}</Badge>)}
                    </div>
                  </Link>
                ))
              )}
            </div>
          </Panel>

          <Panel className="defer-section mt-6 space-y-3 p-5">
            <div className="flex items-center gap-3">
              <div className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-[color:var(--brand-soft)]">
                <BookOpenText className="h-4 w-4 text-[color:var(--brand-ink)]" />
              </div>
              <h2 className="font-display text-lg font-semibold">{t("knowledge.recentTitle")}</h2>
            </div>
            <div className="grid gap-2 md:grid-cols-2">
              {overview.recentNodes.map((node) => (
                <Link prefetch={false} key={node.id} href={`/${locale}/knowledge/${encodeURIComponent(node.id)}`} className="group block rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-4 py-3 transition-all duration-200 hover:border-[color:var(--brand-solid)]/50">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-semibold group-hover:text-[color:var(--brand-solid)]">{node.title}</p>
                    <Badge>{t(`knowledge.nodeTypes.${node.type}`)}</Badge>
                  </div>
                  <p className="mt-1.5 line-clamp-2 text-xs leading-5 text-[color:var(--muted)]">{node.summary}</p>
                </Link>
              ))}
            </div>
          </Panel>

        </div>

        <div className="flex min-w-0 flex-col gap-4 xl:sticky xl:top-24">
          <Panel className="space-y-4 p-5">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <Filter className="h-5 w-5 text-[color:var(--brand-solid)]" />
                <div>
                  <h2 className="font-display text-lg font-semibold">{t("knowledge.filters.title")}</h2>
                  <p className="text-sm text-[color:var(--muted)]">{t("knowledge.filters.subtitle")}</p>
                </div>
              </div>
              <Button variant="ghost" className="h-8 px-3 text-xs" onClick={clearFilters}>{t("project.timelineCard.clearFilters")}</Button>
            </div>
            <div className="grid gap-3">
              <label className="space-y-2">
                <span className="text-sm font-medium">{t("knowledge.filters.search")}</span>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[color:var(--muted)]" />
                  <input className={`${inputClass} pl-11`} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("knowledge.filters.searchPlaceholder")} />
                </div>
              </label>
              <div className="grid gap-3">
                <label className="space-y-2">
                  <span className="text-sm font-medium">{t("knowledge.filters.topic")}</span>
                  <select className={inputClass} value={topic} onChange={(event) => setTopic(event.target.value)}>
                    <option value="">{t("common.all")}</option>
                    {topics.map((item) => <option key={item} value={item}>{item}</option>)}
                  </select>
                </label>
                <label className="space-y-2">
                  <span className="text-sm font-medium">{t("knowledge.filters.category")}</span>
                  <select className={inputClass} value={category} onChange={(event) => setCategory(event.target.value)}>
                    <option value="">{t("common.all")}</option>
                    {overview.categories.map((item) => <option key={item.category} value={item.category}>{t(`knowledge.categories.${item.category}`)}</option>)}
                  </select>
                </label>
              </div>
              <label className="space-y-2">
                <span className="text-sm font-medium">{t("knowledge.filters.project")}</span>
                <select className={inputClass} value={projectId} onChange={(event) => setProjectId(event.target.value)}>
                  <option value="">{t("knowledge.crossProject")}</option>
                  {projects.map((project) => <option key={project.projectId} value={project.projectId}>{project.projectTitle}</option>)}
                </select>
              </label>
            </div>
          </Panel>

          <Panel className="defer-section space-y-3 p-5">
            <div className="flex items-center gap-3">
              <div className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-[color:var(--brand-soft)]">
                <Sparkles className="h-3.5 w-3.5 text-[color:var(--brand-ink)]" />
              </div>
              <h2 className="font-display text-base font-semibold">{t("knowledge.topicClusters")}</h2>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {overview.topics.map((item) => (
                <button key={item.topic} type="button" className={`rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold transition ${topic === item.topic ? "border-[color:var(--brand-solid)] bg-[color:var(--brand-solid)] text-white" : "border-[color:var(--border)] bg-[color:var(--surface-muted)] text-[color:var(--foreground)] hover:border-[color:var(--brand-solid)]/50"}`} onClick={() => setTopic(topic === item.topic ? "" : item.topic)}>
                  {`${item.topic} ${item.count}`}
                </button>
              ))}
            </div>
            <div className="grid gap-2">
              {overview.categories.map((item) => (
                <button key={item.category} type="button" className={`rounded-lg border px-3 py-2.5 text-left transition ${category === item.category ? "border-[color:var(--brand-solid)] bg-[color:var(--brand-soft)] text-[color:var(--brand-ink)]" : "border-[color:var(--border)] bg-[color:var(--surface-muted)] hover:border-[color:var(--brand-solid)]/50"}`} onClick={() => setCategory(category === item.category ? "" : item.category)}>
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-semibold">{t(`knowledge.categories.${item.category}`)}</p>
                    <span className="text-xs text-[color:var(--muted)]">{item.count}</span>
                  </div>
                </button>
              ))}
            </div>
          </Panel>

          <Panel className="defer-section space-y-3 p-5">
            <div className="flex items-center gap-3">
              <div className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-[color:var(--brand-soft)]">
                <Layers3 className="h-4 w-4 text-[color:var(--brand-ink)]" />
              </div>
              <div>
                <h2 className="font-display text-lg font-semibold">{t("knowledge.projectClustersTitle")}</h2>
                <p className="text-xs text-[color:var(--muted)]">{t("knowledge.projectClustersBody")}</p>
              </div>
            </div>
            <div className="space-y-2">
              <button type="button" onClick={() => setProjectId("")} className={`w-full rounded-xl border px-4 py-3 text-left transition-all duration-200 ${!projectId ? "border-[color:var(--brand-solid)] bg-[color:var(--brand-soft)] text-[color:var(--brand-ink)]" : "border-[color:var(--border)] bg-[color:var(--surface-muted)] hover:border-[color:var(--brand-solid)]/50"}`}>
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold">{t("knowledge.crossProject")}</p>
                  <Badge>{projects.length}</Badge>
                </div>
              </button>
              {ownProjectClusters.map((project) => (
                <div
                  key={project.projectId}
                  className={`w-full rounded-xl border px-4 py-3 transition-all duration-200 ${projectId === project.projectId ? "border-[color:var(--brand-solid)] bg-[color:var(--brand-soft)] text-[color:var(--brand-ink)]" : "border-[color:var(--border)] bg-[color:var(--surface-muted)] hover:border-[color:var(--brand-solid)]/50"}`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <button
                      type="button"
                      onClick={() => setProjectId(project.projectId)}
                      className="min-w-0 flex-1 text-left"
                    >
                      <p className="text-sm font-semibold">{project.projectTitle}</p>
                      <p className="mt-0.5 text-xs text-[color:var(--muted)]">{project.nodeCount} {t("knowledge.metrics.nodes")}</p>
                    </button>
                    <div className="flex shrink-0 items-center gap-2">
                      <Link prefetch={false} href={`/${locale}/knowledge/graph?projectId=${project.projectId}`} className="text-xs font-semibold text-[color:var(--brand-solid)]">
                        {t("knowledge.openGraph")}
                      </Link>
                    </div>
                  </div>
                </div>
              ))}
              {sampleProjectClusters.length > 0 ? (
                <div className="pt-1">
                  {(ownProjectClusters.length > 0 || ownGraphs.length > 0) ? (
                    <button
                      type="button"
                      onClick={() => {
                        setProjectSamplesVisibilityTouched(true);
                        setProjectSamplesCollapsed((value) => !value);
                      }}
                      className="flex items-center gap-2 text-xs font-semibold text-[color:var(--muted)] transition hover:text-[color:var(--foreground)]"
                    >
                      <ChevronDown className={`h-3.5 w-3.5 transition ${projectSamplesCollapsed ? "" : "rotate-180"}`} />
                      {projectSamplesCollapsed ? t("knowledge.showSamples", { count: String(sampleProjectClusters.length) }) : t("knowledge.hideSamples")}
                    </button>
                  ) : null}
                  {!projectSamplesCollapsed ? (
                    <div className="mt-2 space-y-2">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[color:var(--muted)]">{t("knowledge.sampleProjects")}</p>
                      {sampleProjectClusters.map((project) => (
                        <div
                          key={project.projectId}
                          className={`w-full rounded-xl border px-4 py-3 transition-all duration-200 ${projectId === project.projectId ? "border-[color:var(--brand-solid)] bg-[color:var(--brand-soft)] text-[color:var(--brand-ink)]" : "border-[color:var(--border)] bg-[color:var(--surface-muted)] hover:border-[color:var(--brand-solid)]/50"}`}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <button
                              type="button"
                              onClick={() => setProjectId(project.projectId)}
                              className="min-w-0 flex-1 text-left"
                            >
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="text-sm font-semibold">{project.projectTitle}</p>
                                <Badge tone="accent">{t("dashboard.sampleBadge")}</Badge>
                              </div>
                              <p className="mt-0.5 text-xs text-[color:var(--muted)]">{project.nodeCount} {t("knowledge.metrics.nodes")}</p>
                            </button>
                            <div className="flex shrink-0 items-center gap-2">
                              <Link prefetch={false} href={`/${locale}/knowledge/graph?projectId=${project.projectId}`} className="text-xs font-semibold text-[color:var(--brand-solid)]">
                                {t("knowledge.openGraph")}
                              </Link>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          </Panel>

        </div>
      </div>
    </div>
  );
}
