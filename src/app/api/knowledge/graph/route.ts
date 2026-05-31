export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getSettings } from "@/lib/data/repository";
import { isLocale } from "@/lib/i18n";
import { buildKnowledgeGraph } from "@/lib/knowledge/service";
import { KNOWLEDGE_CATEGORIES, KnowledgeCategory } from "@/lib/knowledge/types";
import { getUserGraph } from "@/lib/knowledge/user-graphs";

function parseProjectIds(value?: string | null) {
  return value?.split(",").map((item) => item.trim()).filter(Boolean);
}

export async function GET(request: Request) {
  const settings = await getSettings();
  const url = new URL(request.url);
  const locale = isLocale(url.searchParams.get("locale") ?? "") ? (url.searchParams.get("locale") as typeof settings.locale) : settings.locale;
  const rawCategory = url.searchParams.get("category") ?? undefined;
  const category = rawCategory && KNOWLEDGE_CATEGORIES.includes(rawCategory as KnowledgeCategory)
    ? (rawCategory as KnowledgeCategory)
    : undefined;
  const scopeMode = url.searchParams.get("scopeMode") === "project" ? "project" : url.searchParams.get("scopeMode") === "cross-project" ? "cross-project" : undefined;
  const projectId = url.searchParams.get("projectId") ?? undefined;
  const projectIds = parseProjectIds(url.searchParams.get("projectIds"));
  const graphId = url.searchParams.get("graphId") ?? undefined;

  const baseGraph = await buildKnowledgeGraph({
    locale,
    query: url.searchParams.get("query") ?? undefined,
    topic: url.searchParams.get("topic") ?? undefined,
    category,
    projectId: scopeMode === "cross-project" ? undefined : projectId,
    projectIds: projectIds && projectIds.length > 0 ? projectIds : undefined,
    scopeMode,
  });

  if (!graphId) {
    return NextResponse.json({ graph: baseGraph });
  }

  const viewer = {
    identityId: settings.profile.localIdentityId,
    displayName: settings.profile.displayName,
  };
  const userGraph = await getUserGraph(graphId, viewer, locale);
  if (!userGraph) {
    return NextResponse.json({ error: "The requested user graph was not found or is not accessible." }, { status: 404 });
  }
  if (userGraph.status !== "ready") {
    return NextResponse.json({ error: `The requested user graph is not ready yet (current status: ${userGraph.status}).` }, { status: 409 });
  }

  const nodeIds = new Set(userGraph.nodes.map((node) => node.id));
  const relations = userGraph.relations.filter((relation) => (
    nodeIds.has(relation.sourceNodeId) && nodeIds.has(relation.targetNodeId)
  ));
  const graph = {
    ...baseGraph,
    scope: {
      ...baseGraph.scope,
      graphId: userGraph.id,
    },
    nodes: userGraph.nodes,
    relations,
    projects: baseGraph.projects.map((project) => {
      if (!userGraph.sourceProjectIds.includes(project.projectId)) return project;
      const nodes = userGraph.nodes.filter((node) => node.sourceProjectId === project.projectId);
      const projectNodeIds = new Set(nodes.map((node) => node.id));
      return {
        ...project,
        nodeCount: nodes.length,
        relationCount: relations.filter((relation) => (
          projectNodeIds.has(relation.sourceNodeId) && projectNodeIds.has(relation.targetNodeId)
        )).length,
        topics: [...new Set(nodes.flatMap((node) => node.topics))],
      };
    }),
  };

  return NextResponse.json({ graph });
}
