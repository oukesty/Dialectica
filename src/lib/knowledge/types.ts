import { AppLocale, EvaluationSnapshot, ProviderId } from "@/lib/types";
import { normalizeText } from "@/lib/utils";

export const SAMPLE_USER_GRAPH_OWNER_ID = "__sample__";

export const KNOWLEDGE_NODE_TYPES = [
  "project",
  "concept",
  "topic",
  "viewpoint",
  "argument",
  "evidence",
  "conflict",
  "conclusion",
  "question",
  "recommendation",
  "document",
] as const;
export const KNOWLEDGE_RELATION_TYPES = [
  "supports",
  "opposes",
  "references",
  "extends",
  "causes",
  "related_to",
  "unresolved_with",
  "derived_from",
] as const;
export const KNOWLEDGE_CATEGORIES = [
  "ai-industry",
  "ai-technology",
  "ai-ethics",
  "automation",
  "employment",
  "education",
  "public-policy",
  "operations",
  "research",
  "other",
] as const;

export type KnowledgeNodeType = (typeof KNOWLEDGE_NODE_TYPES)[number];
export type KnowledgeRelationType = (typeof KNOWLEDGE_RELATION_TYPES)[number];
export type KnowledgeCategory = (typeof KNOWLEDGE_CATEGORIES)[number];

export interface KnowledgeReference {
  entryId?: string;
  nodeId?: string;
  attachmentId?: string;
  label: string;
  excerpt?: string;
}

export interface KnowledgeProvenance {
  projectId: string;
  projectTitle: string;
  projectLocale: AppLocale;
  scenario: string;
  createdFrom: Array<"summary" | "argument-node" | "transcript" | "attachment" | "insight">;
  generatedAt: string;
}

export interface KnowledgeNode {
  id: string;
  title: string;
  type: KnowledgeNodeType;
  category: KnowledgeCategory;
  summary: string;
  sourceProjectId: string;
  sourceProjectTitle: string;
  sourceDiscussionId: string;
  tags: string[];
  topics: string[];
  relatedParticipantIds: string[];
  evidenceReferences: KnowledgeReference[];
  relatedNodeIds: string[];
  createdFrom: KnowledgeProvenance["createdFrom"];
  createdAt: string;
  updatedAt: string;
  provenance: KnowledgeProvenance;
}

export interface KnowledgeRelation {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  type: KnowledgeRelationType;
  note: string;
  sourceProjectId: string;
  createdAt: string;
}

export interface StructuredDiscussionAnalysis {
  primaryTopic: string;
  topics: string[];
  viewpoints: Array<{
    participantId?: string;
    participantName: string;
    stance: string;
    summary: string;
  }>;
  arguments: Array<{
    nodeId?: string;
    title: string;
    stance: string;
    summary: string;
    participantId?: string;
  }>;
  evidence: Array<{
    nodeId?: string;
    title: string;
    summary: string;
    participantId?: string;
    attachmentId?: string;
  }>;
  conflicts: Array<{
    sourceNodeId?: string;
    targetNodeId?: string;
    title: string;
    detail: string;
  }>;
  evaluation: EvaluationSnapshot;
  conclusion: string;
  unresolvedQuestions: string[];
  followupQuestions: string[];
  recommendations: string[];
}

export interface KnowledgeProjectSnapshot {
  projectId: string;
  locale: AppLocale;
  projectTitle: string;
  scenario: string;
  generatedAt: string;
  analysis: StructuredDiscussionAnalysis;
  nodes: KnowledgeNode[];
  relations: KnowledgeRelation[];
  stats: {
    nodeCount: number;
    relationCount: number;
    topicCount: number;
    categoryCounts: Record<KnowledgeCategory, number>;
  };
}

/** A user-owned knowledge graph derived from one or more project snapshots. */
export interface UserKnowledgeGraph {
  id: string;
  ownerIdentityId: string;
  ownerDisplayName: string;
  title: string;
  description: string;
  visibility: "private" | "public";
  sourceProjectIds: string[];
  sourceProjectTitles: string[];
  locale: AppLocale;
  graphMode: "2d" | "3d" | "both";
  status: "pending" | "generating" | "ready" | "failed";
  errorMessage?: string;
  nodes: KnowledgeNode[];
  relations: KnowledgeRelation[];
  stats: {
    nodeCount: number;
    relationCount: number;
    topicCount: number;
  };
  createdAt: string;
  updatedAt: string;
  generatedAt?: string;
  generatedProviderId?: ProviderId;
  generatedModel?: string;
}

/** Summary of a user-owned graph for listing. */
export interface UserKnowledgeGraphSummary {
  id: string;
  ownerIdentityId: string;
  ownerDisplayName: string;
  title: string;
  description: string;
  visibility: "private" | "public";
  sourceProjectIds: string[];
  sourceProjectTitles: string[];
  graphMode: "2d" | "3d" | "both";
  status: UserKnowledgeGraph["status"];
  nodeCount: number;
  relationCount: number;
  createdAt: string;
  updatedAt: string;
  canDelete: boolean;
  generatedProviderId?: ProviderId;
  generatedModel?: string;
}

export const PROTECTED_SAMPLE_GRAPH_SOURCE_PROJECT_IDS: string[] = [
  "sample_civic_ai_room",
  "sample_heat_resilience_research",
];

type GraphDeletionTarget = {
  ownerIdentityId?: string;
  ownerDisplayName?: string;
  sourceProjectIds?: string[];
};

type GraphDeletionOptions = {
  currentDisplayName?: string;
  ownerProfileExists?: boolean;
};

export function isProtectedSampleKnowledgeGraph(graph?: GraphDeletionTarget | null) {
  if (!graph) return false;
  if (graph.ownerIdentityId !== SAMPLE_USER_GRAPH_OWNER_ID) return false;
  if (!Array.isArray(graph.sourceProjectIds) || graph.sourceProjectIds.length === 0) return false;
  const protectedSourceIds = new Set(PROTECTED_SAMPLE_GRAPH_SOURCE_PROJECT_IDS);
  return graph.sourceProjectIds.every((projectId) => protectedSourceIds.has(projectId));
}

export function canDeleteKnowledgeGraph(
  graph: GraphDeletionTarget | null | undefined,
  requestIdentityId: string,
  options: GraphDeletionOptions = {},
) {
  if (!graph) return false;
  if (isProtectedSampleKnowledgeGraph(graph)) return false;
  if (
    options.ownerProfileExists === false
    && options.currentDisplayName
    && graph.ownerDisplayName
    && normalizeText(options.currentDisplayName) === normalizeText(graph.ownerDisplayName)
  ) {
    return true;
  }
  return graph.ownerIdentityId === requestIdentityId;
}

/** Cross-graph association analysis result. */
export interface CrossGraphAnalysis {
  id: string;
  ownerIdentityId: string;
  title: string;
  sourceGraphIds: string[];
  analysisGoal: string;
  sharedConcepts: Array<{ concept: string; graphIds: string[]; note: string }>;
  conflictingViewpoints: Array<{ topic: string; viewpoints: Array<{ graphId: string; stance: string }>; note: string }>;
  supportingConclusions: Array<{ conclusion: string; graphIds: string[]; evidence: string }>;
  unrelatedNodes: Array<{ nodeId: string; graphId: string; reason: string }>;
  nodes: KnowledgeNode[];
  relations: KnowledgeRelation[];
  createdAt: string;
}

export interface KnowledgeGraphPayload {
  generatedAt: string;
  mode: "project" | "cross-project";
  scope: {
    locale: AppLocale;
    scopeMode?: "project" | "cross-project";
    projectId?: string;
    projectIds?: string[];
    query?: string;
    topic?: string;
    category?: KnowledgeCategory;
  };
  projects: Array<{
    projectId: string;
    projectTitle: string;
    nodeCount: number;
    relationCount: number;
    topics: string[];
    isProtectedSample: boolean;
    canDelete: boolean;
  }>;
  availableProjects: Array<{
    projectId: string;
    projectTitle: string;
    nodeCount: number;
    relationCount: number;
    topics: string[];
    isProtectedSample: boolean;
    canDelete: boolean;
  }>;
  nodes: KnowledgeNode[];
  relations: KnowledgeRelation[];
}

export interface KnowledgeQuery {
  locale: AppLocale;
  query?: string;
  tag?: string;
  topic?: string;
  category?: KnowledgeCategory;
  projectId?: string;
  projectIds?: string[];
  scopeMode?: "project" | "cross-project";
}

export interface KnowledgeNodeDetail {
  node: KnowledgeNode;
  relations: KnowledgeRelation[];
  connectedNodes: KnowledgeNode[];
}

export interface KnowledgeHomepageSummary {
  generatedAt: string;
  totalNodes: number;
  totalRelations: number;
  recentNodes: KnowledgeNode[];
}

export interface KnowledgeProjectClusterSummary {
  projectId: string;
  projectTitle: string;
  nodeCount: number;
  isProtectedSample: boolean;
  canDelete: boolean;
}

export interface KnowledgeOverview extends KnowledgeHomepageSummary {
  categories: Array<{ category: KnowledgeCategory; count: number }>;
  topics: Array<{ topic: string; count: number }>;
  projects: KnowledgeProjectClusterSummary[];
}
