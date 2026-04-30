import { KnowledgeNode, KnowledgeRelation } from "@/lib/knowledge/types";
import { normalizeText } from "@/lib/utils";

export type KnowledgeGraphBudgetMode = "2d" | "3d";

export const KNOWLEDGE_GRAPH_BUDGETS: Record<KnowledgeGraphBudgetMode, {
  maxNodes: number;
  maxRelations: number;
  relationMultiplier: number;
}> = {
  "2d": {
    maxNodes: 80,
    maxRelations: 160,
    relationMultiplier: 2,
  },
  "3d": {
    maxNodes: 120,
    maxRelations: 220,
    relationMultiplier: 2,
  },
};

const NODE_TYPE_WEIGHT: Record<KnowledgeNode["type"], number> = {
  conclusion: 100,
  recommendation: 96,
  conflict: 92,
  question: 88,
  evidence: 84,
  argument: 78,
  viewpoint: 70,
  topic: 62,
  concept: 56,
  project: 52,
  document: 48,
};

const RELATION_TYPE_WEIGHT: Record<KnowledgeRelation["type"], number> = {
  opposes: 100,
  supports: 96,
  causes: 90,
  unresolved_with: 86,
  references: 80,
  extends: 72,
  derived_from: 68,
  related_to: 48,
};

function nodeDedupeKey(node: KnowledgeNode) {
  const normalizedTitle = normalizeText(node.title);
  return `${node.sourceProjectId}:${normalizedTitle || node.id}`;
}

function scoreNode(node: KnowledgeNode, relationDegree: Map<string, number>) {
  return NODE_TYPE_WEIGHT[node.type]
    + Math.min(20, (relationDegree.get(node.id) ?? 0) * 4)
    + Math.min(12, node.evidenceReferences.length * 4)
    + Math.min(8, node.relatedParticipantIds.length * 2)
    + Math.min(8, node.topics.length + node.tags.length)
    + (node.summary.trim().length >= 80 ? 6 : node.summary.trim().length >= 32 ? 3 : 0)
    + (node.createdFrom.includes("summary") ? 4 : 0)
    + (node.createdFrom.includes("argument-node") ? 3 : 0)
    + (node.createdFrom.includes("attachment") ? 2 : 0);
}

function scoreRelation(
  relation: KnowledgeRelation,
  nodeScores: Map<string, number>,
) {
  return RELATION_TYPE_WEIGHT[relation.type]
    + ((nodeScores.get(relation.sourceNodeId) ?? 0) + (nodeScores.get(relation.targetNodeId) ?? 0)) * 0.08
    + (relation.note.trim().length >= 24 ? 4 : 0);
}

export function applyKnowledgeGraphBudget(
  nodes: KnowledgeNode[],
  relations: KnowledgeRelation[],
  mode: KnowledgeGraphBudgetMode = "2d",
) {
  const budget = KNOWLEDGE_GRAPH_BUDGETS[mode];
  const relationDegree = new Map<string, number>();
  for (const relation of relations) {
    relationDegree.set(relation.sourceNodeId, (relationDegree.get(relation.sourceNodeId) ?? 0) + 1);
    relationDegree.set(relation.targetNodeId, (relationDegree.get(relation.targetNodeId) ?? 0) + 1);
  }

  const dedupedNodes = new Map<string, { node: KnowledgeNode; score: number }>();
  for (const node of nodes) {
    const score = scoreNode(node, relationDegree);
    const key = nodeDedupeKey(node);
    const existing = dedupedNodes.get(key);
    if (!existing || score > existing.score) {
      dedupedNodes.set(key, { node, score });
    }
  }

  const rankedNodes = [...dedupedNodes.values()]
    .sort((left, right) => right.score - left.score || right.node.updatedAt.localeCompare(left.node.updatedAt));
  const keptNodes = rankedNodes.slice(0, budget.maxNodes).map((entry) => entry.node);
  const keptNodeIds = new Set(keptNodes.map((node) => node.id));
  const nodeScores = new Map(rankedNodes.map((entry) => [entry.node.id, entry.score]));
  const relationLimit = Math.min(
    budget.maxRelations,
    Math.floor(keptNodes.length * budget.relationMultiplier),
  );
  const seenRelations = new Set<string>();
  const keptRelations = relations
    .filter((relation) => keptNodeIds.has(relation.sourceNodeId) && keptNodeIds.has(relation.targetNodeId))
    .map((relation) => ({ relation, score: scoreRelation(relation, nodeScores) }))
    .sort((left, right) => right.score - left.score || right.relation.createdAt.localeCompare(left.relation.createdAt))
    .filter(({ relation }) => {
      const key = `${relation.sourceNodeId}:${relation.type}:${relation.targetNodeId}`;
      if (seenRelations.has(key)) return false;
      seenRelations.add(key);
      return true;
    })
    .slice(0, relationLimit)
    .map((entry) => entry.relation);

  return {
    nodes: keptNodes,
    relations: keptRelations,
    budget,
  };
}
