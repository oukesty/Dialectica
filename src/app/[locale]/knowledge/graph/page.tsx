import { notFound, redirect } from "next/navigation";
import { KnowledgeGraphView } from "@/components/knowledge/knowledge-graph-view";
import { buildKnowledgeGraph } from "@/lib/knowledge/service";
import { getSettings } from "@/lib/data/repository";
import { canManageUserGraph, getUserGraph, listUserGraphs } from "@/lib/knowledge/user-graphs";
import { isLocale } from "@/lib/i18n";
import { KNOWLEDGE_CATEGORIES, KnowledgeCategory } from "@/lib/knowledge/types";

function parseProjectIds(value?: string) {
  return value?.split(",").map((item) => item.trim()).filter(Boolean);
}

const BUNDLED_CROSS_GRAPH_SAMPLE_ID = "sample_cross_civic_heat_resilience_governance";

export default async function KnowledgeGraphPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ projectId?: string; projectIds?: string; graphId?: string; query?: string; topic?: string; category?: string; scopeMode?: string }>;
}) {
  const { locale } = await params;
  const { projectId, projectIds, graphId, query, topic, category, scopeMode } = await searchParams;
  if (!isLocale(locale)) {
    notFound();
  }

  const settings = await getSettings({ includeSecrets: false });
  const { bundledSampleProjectIds: sampleIds } = await import("@/data/samples");
  const sampleProjectIds = [...sampleIds];
  const defaultSampleProjectId = sampleProjectIds[0];
  if (!graphId && !projectId && !projectIds && scopeMode === undefined && defaultSampleProjectId) {
    redirect(`/${locale}/knowledge/graph?projectId=${defaultSampleProjectId}&scopeMode=project`);
  }

  const viewer = {
    identityId: settings.profile.localIdentityId,
    displayName: settings.profile.displayName,
  };
  const shouldUseBundledCrossGraphSample = !graphId
    && !projectId
    && !projectIds
    && scopeMode === "cross-project";
  const graphSummaries = shouldUseBundledCrossGraphSample ? await listUserGraphs(viewer, locale) : [];
  const hasUserCrossGraph = graphSummaries.some((graph) => (
    graph.canDelete && graph.status === "ready" && graph.sourceProjectIds.length > 1
  ));
  const bundledCrossGraphSample = shouldUseBundledCrossGraphSample && !hasUserCrossGraph
    ? await getUserGraph(BUNDLED_CROSS_GRAPH_SAMPLE_ID, viewer, locale)
    : null;
  const activeUserGraph = graphId ? await getUserGraph(graphId, viewer, locale) : bundledCrossGraphSample;
  if (activeUserGraph && activeUserGraph.status !== "ready") {
    redirect(`/${locale}/knowledge`);
  }
  const canDeleteActiveUserGraph = await canManageUserGraph(activeUserGraph, viewer);
  const normalizedProjectIds = parseProjectIds(projectIds) ?? (activeUserGraph?.sourceProjectIds.length ? activeUserGraph.sourceProjectIds : undefined);
  const resolvedProjectId = scopeMode === "cross-project"
    ? undefined
    : projectId ?? (normalizedProjectIds?.length === 1 ? normalizedProjectIds[0] : undefined);
  const baseGraph = await buildKnowledgeGraph({
    locale,
    projectId: resolvedProjectId,
    projectIds: normalizedProjectIds && normalizedProjectIds.length > 0 ? normalizedProjectIds : undefined,
    scopeMode: scopeMode === "project" || scopeMode === "cross-project" ? scopeMode : undefined,
    query,
    topic,
    category: KNOWLEDGE_CATEGORIES.includes(category as KnowledgeCategory)
      ? (category as KnowledgeCategory)
      : undefined,
  });
  const activeGraphNodeIds = new Set(activeUserGraph?.nodes.map((node) => node.id) ?? []);
  const activeGraphRelations = activeUserGraph?.relations.filter((relation) => (
    activeGraphNodeIds.has(relation.sourceNodeId) && activeGraphNodeIds.has(relation.targetNodeId)
  )) ?? [];
  const graph = activeUserGraph?.status === "ready" && activeUserGraph.nodes.length > 0
    ? {
        ...baseGraph,
        scope: {
          ...baseGraph.scope,
          graphId: activeUserGraph.id,
        },
        nodes: activeUserGraph.nodes,
        relations: activeGraphRelations,
        projects: baseGraph.projects.map((project) => {
          if (!activeUserGraph.sourceProjectIds.includes(project.projectId)) return project;
          const projectNodes = activeUserGraph.nodes.filter((node) => node.sourceProjectId === project.projectId);
          const projectNodeIds = new Set(projectNodes.map((node) => node.id));
          return {
            ...project,
            nodeCount: projectNodes.length,
            relationCount: activeGraphRelations.filter((relation) => (
              projectNodeIds.has(relation.sourceNodeId) && projectNodeIds.has(relation.targetNodeId)
            )).length,
            topics: [...new Set(projectNodes.flatMap((node) => node.topics))],
          };
        }),
      }
    : baseGraph;

  const defaultGraphMode: "2d" | "3d" = activeUserGraph?.graphMode === "3d" ? "3d" : "2d";

  return (
    <KnowledgeGraphView
      locale={locale}
      graph={graph}
      defaultGraphMode={defaultGraphMode}
      sampleProjectIds={sampleProjectIds}
      activeUserGraph={activeUserGraph ? {
        id: activeUserGraph.id,
        ownerIdentityId: activeUserGraph.ownerIdentityId,
        title: activeUserGraph.title,
        description: activeUserGraph.description,
        visibility: activeUserGraph.visibility,
        status: activeUserGraph.status,
        errorMessage: activeUserGraph.errorMessage,
        sourceProjectIds: activeUserGraph.sourceProjectIds,
        sourceProjectTitles: activeUserGraph.sourceProjectTitles,
        generatedProviderId: activeUserGraph.generatedProviderId,
        generatedModel: activeUserGraph.generatedModel,
      } : null}
      canDeleteActiveUserGraph={canDeleteActiveUserGraph}
    />
  );
}
