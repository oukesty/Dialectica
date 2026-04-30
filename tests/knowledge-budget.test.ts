import { describe, expect, it } from "vitest";
import { applyKnowledgeGraphBudget, KNOWLEDGE_GRAPH_BUDGETS } from "@/lib/knowledge/budget";
import { KnowledgeNode, KnowledgeRelation } from "@/lib/knowledge/types";

function makeNode(index: number, overrides: Partial<KnowledgeNode> = {}): KnowledgeNode {
  const now = new Date(Date.UTC(2026, 0, 1, 0, index % 60)).toISOString();
  return {
    id: `node-${index}`,
    title: `Knowledge node ${index}`,
    type: "concept",
    category: "other",
    summary: `Knowledge summary ${index}`,
    sourceProjectId: "project-budget",
    sourceProjectTitle: "Budget project",
    sourceDiscussionId: "project-budget",
    tags: [],
    topics: [],
    relatedParticipantIds: [],
    evidenceReferences: [],
    relatedNodeIds: [],
    createdFrom: ["transcript"],
    createdAt: now,
    updatedAt: now,
    provenance: {
      projectId: "project-budget",
      projectTitle: "Budget project",
      projectLocale: "en",
      scenario: "discussion",
      createdFrom: ["transcript"],
      generatedAt: now,
    },
    ...overrides,
  };
}

function makeRelation(index: number, sourceNodeId: string, targetNodeId: string, overrides: Partial<KnowledgeRelation> = {}): KnowledgeRelation {
  return {
    id: `relation-${index}`,
    sourceNodeId,
    targetNodeId,
    type: "related_to",
    note: `Relation ${index}`,
    sourceProjectId: "project-budget",
    createdAt: new Date(Date.UTC(2026, 0, 1, 1, index % 60)).toISOString(),
    ...overrides,
  };
}

describe("knowledge graph budget", () => {
  it("caps 2D graphs while keeping high-priority knowledge", () => {
    const nodes = [
      makeNode(0, {
        id: "node-critical",
        title: "Critical unresolved release risk",
        type: "conflict",
        summary: "This risk blocks the release decision and must remain visible.",
        createdFrom: ["summary", "argument-node"],
      }),
      ...Array.from({ length: 139 }, (_, index) => makeNode(index + 1)),
    ];
    const relations = Array.from({ length: 240 }, (_, index) => makeRelation(
      index,
      nodes[1 + (index % 100)].id,
      nodes[1 + ((index + 1) % 100)].id,
      { type: index % 3 === 0 ? "supports" : "related_to" },
    ));

    const budgeted = applyKnowledgeGraphBudget(nodes, relations, "2d");

    expect(budgeted.nodes).toHaveLength(KNOWLEDGE_GRAPH_BUDGETS["2d"].maxNodes);
    expect(budgeted.relations.length <= KNOWLEDGE_GRAPH_BUDGETS["2d"].maxRelations).toBe(true);
    expect(budgeted.nodes.some((node) => node.id === "node-critical")).toBe(true);
    expect(budgeted.nodes.some((node) => node.id === "node-139")).toBe(false);
    expect(budgeted.relations.every((relation) => (
      budgeted.nodes.some((node) => node.id === relation.sourceNodeId)
      && budgeted.nodes.some((node) => node.id === relation.targetNodeId)
    ))).toBe(true);
  });

  it("does not pad short graphs", () => {
    const nodes = [makeNode(1), makeNode(2), makeNode(3)];
    const relations = [makeRelation(1, "node-1", "node-2")];

    const budgeted = applyKnowledgeGraphBudget(nodes, relations, "2d");

    expect(budgeted.nodes).toHaveLength(3);
    expect(budgeted.relations).toHaveLength(1);
  });

  it("uses the larger shared semantic budget for 3D-only graphs", () => {
    const nodes = Array.from({ length: 140 }, (_, index) => makeNode(index));
    const relations = Array.from({ length: 260 }, (_, index) => makeRelation(
      index,
      nodes[index % nodes.length].id,
      nodes[(index + 1) % nodes.length].id,
    ));

    const budgeted = applyKnowledgeGraphBudget(nodes, relations, "3d");

    expect(budgeted.nodes).toHaveLength(KNOWLEDGE_GRAPH_BUDGETS["3d"].maxNodes);
    expect(budgeted.relations.length <= KNOWLEDGE_GRAPH_BUDGETS["3d"].maxRelations).toBe(true);
  });
});
