import { access, mkdir, readFile, readdir, unlink } from "node:fs/promises";
import path from "node:path";
import { bundledSampleKnowledgeGraphs, bundledSampleProjectIds, getLocalizedBundledSampleKnowledgeGraphs } from "@/data/samples";
import { writeFileAtomic } from "@/lib/atomic-file";
import { AppLocale, AppSettings } from "@/lib/types";
import { createId, normalizeText, sanitizePlainText, sanitizeOptionalText } from "@/lib/utils";
import { applyKnowledgeGraphBudget } from "@/lib/knowledge/budget";
import { canDeleteKnowledgeGraph, UserKnowledgeGraph, UserKnowledgeGraphSummary } from "@/lib/knowledge/types";
import { getProjectAccessState } from "@/lib/project-access";

const dataRoot = path.join(process.cwd(), "data");
const userGraphsRoot = path.join(dataRoot, "knowledge", "user-graphs");
const profilesRoot = path.join(dataRoot, "profiles");
const SAFE_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;
const MAX_GRAPH_NODES = 60;
const MIN_GRAPH_NODES = 5;
const MAX_GRAPH_RELATIONS = 120;
const DEFAULT_CONVERSATION_WINDOW = 60;
const USER_GRAPH_STALE_MS = 15 * 60 * 1000;
const LOW_SIGNAL_GRAPH_TERMS = [
  "hello",
  "hi",
  "hey",
  "thanks",
  "thank you",
  "ok",
  "okay",
  "sure",
  "got it",
  "sounds good",
  "noted",
  "understood",
  "good morning",
  "good evening",
  "你好",
  "您好",
  "谢谢",
  "好的",
  "收到",
  "明白",
  "嗯",
  "好的谢谢",
  "哈喽",
  "こんにちは",
  "ありがとう",
  "了解",
  "はい",
  "merci",
  "bonjour",
  "d'accord",
  "bien note",
] as const;
const LOW_SIGNAL_GRAPH_TOKEN_SET = new Set(
  LOW_SIGNAL_GRAPH_TERMS.flatMap((term) => normalizeText(term).split(" ").filter(Boolean)),
);
const GENERIC_GRAPH_LABEL_PATTERNS = [
  /untitled discussion workspace/i,
  /名称未設定のディスカッションワークスペース/i,
  /espace de discussion sans titre/i,
  /未命名讨论工作区/i,
];
const QUESTION_PATTERNS = [
  /\?/,
  /(^|\s)(why|how|what|should|can|could|whether|which)\b/i,
  /(为什么|如何|怎么|是否|要不要|能不能|吗|呢|何が|どう|なぜ|何を|quelle|comment|pourquoi|faut-il)/i,
] as const;
const EVIDENCE_PATTERNS = [
  /\b(because|since|data|evidence|research|study|report|metric|results?)\b/i,
  /(因为|根据|数据显示|证据|研究|报告|数据|结果|調査|根拠|報告|donnée|preuve|étude|rapport)/i,
] as const;
const RECOMMENDATION_PATTERNS = [
  /\b(should|need to|must|recommend|next step|action item|plan to)\b/i,
  /(建议|需要|应该|下一步|行动项|待办|方案|建议先|やるべき|次の一手|対応|il faut|recommande|prochaine étape|action à mener)/i,
] as const;
const CONCLUSION_PATTERNS = [
  /\b(therefore|so we should|in conclusion|decided|decision|conclude)\b/i,
  /(因此|所以|结论|决定|最终|结论是|综上|結論|決定|したがって|conclusion|décision|donc)/i,
] as const;
const GOAL_PATTERNS = [
  /\b(goal|objective|target|aim)\b/i,
  /(目标|目的|要达成|目標|目的|objectif|cible)/i,
] as const;
const DEBUG_KNOWLEDGE_GRAPH = process.env.DEBUG_KNOWLEDGE_GRAPH === "true";

type KnowledgeGraphLogPayload = Record<string, string | number | boolean | null | undefined>;

function writeKnowledgeGraphLog(level: "debug" | "error", event: string, payload: KnowledgeGraphLogPayload = {}) {
  const entry = {
    scope: "knowledge-graph",
    event,
    ...payload,
  };
  const serialized = JSON.stringify(entry);
  if (level === "debug") {
    if (DEBUG_KNOWLEDGE_GRAPH) {
      console.debug(serialized);
    }
    return;
  }
  console.error(serialized);
}

function logKnowledgeGraphDebug(event: string, payload?: KnowledgeGraphLogPayload) {
  writeKnowledgeGraphLog("debug", event, payload);
}

function logKnowledgeGraphError(event: string, payload?: KnowledgeGraphLogPayload) {
  writeKnowledgeGraphLog("error", event, payload);
}

function getLoggableErrorName(error: unknown) {
  return error instanceof Error ? error.name : "UnknownError";
}

function localizeGraphText(locale: AppLocale, values: Partial<Record<AppLocale, string>> & { en: string }) {
  return values[locale] ?? values.en;
}

export function resolveGraphOutputLocale(
  interfaceLocale?: AppLocale,
  settings?: Pick<AppSettings, "locale" | "knowledgePreferences"> | null,
) {
  const preferredLocale = settings?.knowledgePreferences?.graphOutputLanguage;
  if (preferredLocale && preferredLocale !== "auto") {
    return preferredLocale;
  }
  if (interfaceLocale) {
    return interfaceLocale;
  }
  if (settings?.locale) {
    return settings.locale;
  }
  return "en";
}

function graphOutputLanguageLabel(locale: AppLocale) {
  return locale === "zh-CN"
    ? "Chinese (Simplified)"
    : locale === "ja"
      ? "Japanese"
      : locale === "ko"
        ? "Korean"
      : locale === "fr"
        ? "French"
        : locale === "ru"
          ? "Russian"
          : "English";
}

type GraphExtractionNode = {
  id: string;
  label: string;
  type: string;
  description: string;
};

type GraphExtractionRelation = {
  source: string;
  target: string;
  label: string;
  type: string;
};

type GraphAiResult = {
  nodes: GraphExtractionNode[];
  relations: GraphExtractionRelation[];
};

type ProcessedGraphNode = {
  rawId: string;
  label: string;
  summary: string;
  type: UserKnowledgeGraph["nodes"][number]["type"];
  score: number;
  normalizedLabel: string;
};

type ProcessedGraphRelation = {
  rawSource: string;
  rawTarget: string;
  note: string;
  type: UserKnowledgeGraph["relations"][number]["type"];
  score: number;
};

function assertSafeId(id: string, label = "id"): void {
  if (!id || !SAFE_ID_PATTERN.test(id)) {
    throw new Error(`Invalid ${label}: contains disallowed characters`);
  }
}

function normalizeGraphText(value: string) {
  return sanitizePlainText(value, 280).replace(/\s+/g, " ").trim();
}

function isGenericGraphLabel(text: string) {
  const trimmed = text.trim();
  if (!trimmed) return true;
  return GENERIC_GRAPH_LABEL_PATTERNS.some((pattern) => pattern.test(trimmed));
}

function isLowSignalGraphText(text: string) {
  const normalized = normalizeText(text);
  if (!normalized) return true;
  if (isGenericGraphLabel(text)) return true;
  if (LOW_SIGNAL_GRAPH_TERMS.some((term) => normalizeText(term) === normalized)) return true;
  const tokens = normalized.split(" ").filter(Boolean);
  if (tokens.length > 0 && tokens.every((token) => LOW_SIGNAL_GRAPH_TOKEN_SET.has(token))) {
    return true;
  }
  if (tokens.length <= 5 && LOW_SIGNAL_GRAPH_TOKEN_SET.has(tokens[0] ?? "")) {
    return true;
  }
  return false;
}

function compactGraphLabel(text: string, maxLength = 64) {
  return normalizeGraphText(text)
    .replace(/[。！？!?.,;:]+$/u, "")
    .slice(0, maxLength)
    .trim();
}

function normalizeGraphNodeType(type: string, label: string, description: string): UserKnowledgeGraph["nodes"][number]["type"] {
  const normalizedType = normalizeText(type);
  const combined = `${label} ${description}`;
  if (normalizedType.includes("viewpoint")) return "viewpoint";
  if (normalizedType.includes("conclusion") || CONCLUSION_PATTERNS.some((pattern) => pattern.test(combined))) return "conclusion";
  if (normalizedType.includes("question") || QUESTION_PATTERNS.some((pattern) => pattern.test(combined))) return "question";
  if (normalizedType.includes("evidence") || EVIDENCE_PATTERNS.some((pattern) => pattern.test(combined))) return "evidence";
  if (normalizedType.includes("argument")) return "argument";
  if (normalizedType.includes("recommendation") || GOAL_PATTERNS.some((pattern) => pattern.test(combined)) || RECOMMENDATION_PATTERNS.some((pattern) => pattern.test(combined))) {
    return "recommendation";
  }
  if (normalizedType.includes("topic")) return "topic";
  return "concept";
}

function scoreGraphNodeCandidate(node: GraphExtractionNode) {
  const label = compactGraphLabel(node.label);
  const summary = normalizeGraphText(node.description || node.label);
  const mappedType = normalizeGraphNodeType(node.type, label, summary);
  const combined = `${label} ${summary}`;
  const normalizedLabel = normalizeText(label);
  const typeBase = mappedType === "conclusion"
    ? 10
    : mappedType === "recommendation"
      ? 9
      : mappedType === "evidence"
        ? 8
        : mappedType === "question"
          ? 7
          : mappedType === "argument"
            ? 7
            : mappedType === "viewpoint"
              ? 6
              : mappedType === "concept"
                ? 5
                : 4;
  const score = typeBase
    + (summary.length >= 40 ? 2 : summary.length >= 18 ? 1 : 0)
    + (QUESTION_PATTERNS.some((pattern) => pattern.test(combined)) ? 1 : 0)
    + (EVIDENCE_PATTERNS.some((pattern) => pattern.test(combined)) ? 1 : 0)
    + (RECOMMENDATION_PATTERNS.some((pattern) => pattern.test(combined)) ? 1 : 0)
    + (CONCLUSION_PATTERNS.some((pattern) => pattern.test(combined)) ? 1 : 0)
    - (isLowSignalGraphText(combined) ? 10 : 0)
    - (label.length < 3 ? 3 : 0)
    - (summary.length < 12 ? 1 : 0);

  const candidate: ProcessedGraphNode = {
    rawId: node.id,
    label,
    summary: summary || label,
    type: mappedType,
    score,
    normalizedLabel,
  };
  return candidate;
}

function selectGraphNodes(nodes: GraphExtractionNode[]) {
  const deduped = new Map<string, ProcessedGraphNode>();

  for (const node of nodes) {
    const candidate = scoreGraphNodeCandidate(node);
    if (!candidate.label || candidate.score < 4 || isGenericGraphLabel(candidate.label)) {
      continue;
    }

    const existing = deduped.get(candidate.normalizedLabel);
    if (!existing || candidate.score > existing.score) {
      deduped.set(candidate.normalizedLabel, candidate);
    }
  }

  const ranked = [...deduped.values()].sort((left, right) => right.score - left.score);
  const targetCount = Math.min(Math.max(MIN_GRAPH_NODES, Math.ceil(ranked.length * 0.75)), MAX_GRAPH_NODES);
  return ranked.slice(0, targetCount);
}

function normalizeGraphRelationType(type: string): UserKnowledgeGraph["relations"][number]["type"] | null {
  const normalized = normalizeText(type);
  if (!normalized) return null;
  if (normalized.includes("support")) return "supports";
  if (normalized.includes("contrad") || normalized.includes("oppos") || normalized.includes("rebut")) return "opposes";
  if (normalized.includes("reference") || normalized.includes("cite")) return "references";
  if (normalized.includes("lead") || normalized.includes("cause") || normalized.includes("result")) return "causes";
  if (normalized.includes("derive") || normalized.includes("summar")) return "derived_from";
  if (normalized.includes("extend") || normalized.includes("clarif") || normalized.includes("depend") || normalized.includes("build")) return "extends";
  if (normalized.includes("question") || normalized.includes("unresolved")) return "unresolved_with";
  if (normalized.includes("related")) return "related_to";
  return null;
}

function relationBaseScore(type: UserKnowledgeGraph["relations"][number]["type"]) {
  switch (type) {
    case "supports":
    case "opposes":
    case "causes":
      return 6;
    case "references":
    case "extends":
    case "unresolved_with":
      return 5;
    case "derived_from":
      return 4;
    case "related_to":
      return 2;
    default:
      return 0;
  }
}

function selectGraphRelations(
  relations: GraphExtractionRelation[],
  keptNodes: ProcessedGraphNode[],
) {
  const nodeByRawId = new Map(keptNodes.map((node) => [node.rawId, node]));
  const seen = new Set<string>();
  const filtered: ProcessedGraphRelation[] = [];

  for (const relation of relations) {
    const source = nodeByRawId.get(relation.source);
    const target = nodeByRawId.get(relation.target);
    if (!source || !target || source.rawId === target.rawId) continue;

    const mappedType = normalizeGraphRelationType(relation.type);
    if (!mappedType) continue;

    if (
      mappedType === "related_to"
      && !["conclusion", "recommendation", "question", "evidence", "argument"].includes(source.type)
      && !["conclusion", "recommendation", "question", "evidence", "argument"].includes(target.type)
    ) {
      continue;
    }

    const note = normalizeGraphText(relation.label || relation.type || "related");
    const score = relationBaseScore(mappedType)
      + Math.min(source.score, target.score) * 0.2
      - (isLowSignalGraphText(note) ? 1 : 0)
      - (mappedType === "related_to" ? 1 : 0);
    if (score < 3) continue;

    const dedupeKey = `${source.rawId}:${mappedType}:${target.rawId}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    filtered.push({
      rawSource: source.rawId,
      rawTarget: target.rawId,
      type: mappedType,
      note: note || mappedType,
      score,
    });
  }

  const limit = Math.min(Math.max(4, Math.ceil(keptNodes.length * 0.9)), MAX_GRAPH_RELATIONS);
  return filtered
    .sort((left, right) => right.score - left.score)
    .slice(0, limit);
}

function isLowSignalConversationMessage(text: string) {
  const cleaned = normalizeGraphText(text);
  if (!cleaned) return true;
  return isLowSignalGraphText(cleaned);
}

async function ensureDir() {
  await mkdir(userGraphsRoot, { recursive: true });
}

function graphFile(graphId: string) {
  assertSafeId(graphId, "graphId");
  return path.join(userGraphsRoot, `${graphId}.json`);
}

function profileSettingsFile(identityId: string) {
  assertSafeId(identityId, "identityId");
  return path.join(profilesRoot, `${identityId}.json`);
}

export type KnowledgeGraphViewer = {
  identityId: string;
  displayName?: string;
};

async function hasProfileSettings(identityId: string) {
  if (!identityId) return false;
  try {
    await access(profileSettingsFile(identityId));
    return true;
  } catch {
    return false;
  }
}

export async function canManageUserGraph(
  graph: Pick<UserKnowledgeGraph, "ownerIdentityId" | "ownerDisplayName" | "sourceProjectIds"> | null | undefined,
  viewer: KnowledgeGraphViewer,
) {
  if (!graph) return false;
  return canDeleteKnowledgeGraph(graph, viewer.identityId, {
    currentDisplayName: viewer.displayName,
    ownerProfileExists: await hasProfileSettings(graph.ownerIdentityId),
  });
}

export function canDeleteUserGraph(
  graph: Pick<UserKnowledgeGraph, "ownerIdentityId" | "ownerDisplayName" | "sourceProjectIds"> | null | undefined,
  requestIdentityId: string,
) {
  return canDeleteKnowledgeGraph(graph, requestIdentityId);
}

function isUserGraphStale(graph: Pick<UserKnowledgeGraph, "status" | "updatedAt">) {
  if (graph.status !== "pending" && graph.status !== "generating") return false;
  const updatedAt = new Date(graph.updatedAt).getTime();
  return Number.isFinite(updatedAt) && Date.now() - updatedAt > USER_GRAPH_STALE_MS;
}

function staleGraphError(locale: AppLocale) {
  return localizeGraphText(locale, {
    "zh-CN": "图谱生成任务已超时。旧数据未被覆盖，请重新生成图谱。",
    en: "Graph generation timed out. Existing data was not overwritten; please generate the graph again.",
    ja: "グラフ生成タスクがタイムアウトしました。既存データは上書きされていません。再度生成してください。",
    ko: "그래프 생성 작업 시간이 초과되었습니다. 기존 데이터는 덮어쓰지 않았으니 그래프를 다시 생성해 주세요.",
    fr: "La generation du graphe a expire. Les donnees existantes n'ont pas ete remplacees ; relancez la generation.",
    ru: "Создание графа превысило время ожидания. Старые данные не были перезаписаны; создайте граф заново.",
  });
}

async function failStaleUserGraphIfNeeded(graph: UserKnowledgeGraph) {
  if (!isUserGraphStale(graph)) {
    return graph;
  }
  const updated: UserKnowledgeGraph = {
    ...graph,
    status: "failed",
    errorMessage: staleGraphError(graph.locale),
    updatedAt: new Date().toISOString(),
  };
  await writeFileAtomic(graphFile(graph.id), JSON.stringify(updated, null, 2), "utf-8");
  return updated;
}

export async function listUserGraphs(viewer: KnowledgeGraphViewer, locale: AppLocale = "zh-CN"): Promise<UserKnowledgeGraphSummary[]> {
  await ensureDir();
  const files = await readdir(userGraphsRoot).catch(() => []);
  const results: UserKnowledgeGraphSummary[] = [];
  const bundledGraphIds = new Set(bundledSampleKnowledgeGraphs.map((graph) => graph.id));
  const localizedBundledGraphs = getLocalizedBundledSampleKnowledgeGraphs(locale);

  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    try {
      const raw = await readFile(path.join(userGraphsRoot, file), "utf-8");
      const graph = await failStaleUserGraphIfNeeded(JSON.parse(raw) as UserKnowledgeGraph);
      if (bundledGraphIds.has(graph.id)) continue;
      const canManage = await canManageUserGraph(graph, viewer);
      if (canManage || graph.visibility === "public") {
        results.push(toSummary(graph, canManage));
      }
    } catch { continue; }
  }

  const bundledResults = localizedBundledGraphs
    .filter((graph) => graph.visibility === "public")
    .map((graph) => toSummary(graph, false));

  return [...results, ...bundledResults].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getUserGraph(graphId: string, viewer: KnowledgeGraphViewer, locale: AppLocale = "zh-CN"): Promise<UserKnowledgeGraph | null> {
  const bundledGraph = getLocalizedBundledSampleKnowledgeGraphs(locale).find((graph) => graph.id === graphId);
  if (bundledGraph) {
    const canManage = await canManageUserGraph(bundledGraph, viewer);
    if (canManage || bundledGraph.visibility === "public") {
      return bundledGraph;
    }
    return null;
  }

  try {
    const raw = await readFile(graphFile(graphId), "utf-8");
    const graph = await failStaleUserGraphIfNeeded(JSON.parse(raw) as UserKnowledgeGraph);
    const canManage = await canManageUserGraph(graph, viewer);
    if (!canManage && graph.visibility !== "public") {
      return null;
    }
    return graph;
  } catch {
    return null;
  }
}

export async function createUserGraph(params: {
  ownerIdentityId: string;
  ownerDisplayName: string;
  title: string;
  description: string;
  sourceProjectIds: string[];
  sourceProjectTitles: string[];
  locale: AppLocale;
  graphMode: "2d" | "3d" | "both";
  visibility: "private" | "public";
}): Promise<UserKnowledgeGraph> {
  await ensureDir();
  const id = createId("graph");
  const now = new Date().toISOString();
  const graph: UserKnowledgeGraph = {
    id,
    ownerIdentityId: params.ownerIdentityId,
    ownerDisplayName: sanitizePlainText(params.ownerDisplayName, 120),
    title: sanitizePlainText(params.title, 200),
    description: sanitizeOptionalText(params.description, 500),
    visibility: params.visibility,
    sourceProjectIds: params.sourceProjectIds,
    sourceProjectTitles: params.sourceProjectTitles,
    locale: params.locale,
    graphMode: params.graphMode,
    status: "pending",
    nodes: [],
    relations: [],
    stats: { nodeCount: 0, relationCount: 0, topicCount: 0 },
    createdAt: now,
    updatedAt: now,
  };

  await writeFileAtomic(graphFile(id), JSON.stringify(graph, null, 2), "utf-8");
  return graph;
}

export async function updateUserGraph(graphId: string, updates: Partial<Pick<UserKnowledgeGraph, "title" | "description" | "visibility" | "status" | "errorMessage" | "nodes" | "relations" | "stats" | "generatedAt" | "generatedProviderId" | "generatedModel" | "locale">>): Promise<UserKnowledgeGraph | null> {
  try {
    const raw = await readFile(graphFile(graphId), "utf-8");
    const graph = JSON.parse(raw) as UserKnowledgeGraph;
    const updated: UserKnowledgeGraph = {
      ...graph,
      ...updates,
      updatedAt: new Date().toISOString(),
    };
    await writeFileAtomic(graphFile(graphId), JSON.stringify(updated, null, 2), "utf-8");
    return updated;
  } catch {
    return null;
  }
}

export async function deleteUserGraph(graphId: string, viewer: KnowledgeGraphViewer): Promise<boolean> {
  try {
    const raw = await readFile(graphFile(graphId), "utf-8");
    const graph = JSON.parse(raw) as UserKnowledgeGraph;
    if (!await canManageUserGraph(graph, viewer)) return false;
    await unlink(graphFile(graphId));
    return true;
  } catch {
    return false;
  }
}

function pruneGraphForDeletedProject(graph: UserKnowledgeGraph, projectId: string): UserKnowledgeGraph | null {
  if (!graph.sourceProjectIds.includes(projectId)) {
    return graph;
  }

  const keptPairs = graph.sourceProjectIds.reduce<Array<{ id: string; title: string }>>((pairs, currentId, index) => {
    if (currentId === projectId) {
      return pairs;
    }
    pairs.push({
      id: currentId,
      title: graph.sourceProjectTitles[index] ?? currentId,
    });
    return pairs;
  }, []);

  if (keptPairs.length === 0) {
    return null;
  }

  const remainingNodes = graph.nodes.filter((node) => node.sourceProjectId !== projectId);
  const remainingNodeIds = new Set(remainingNodes.map((node) => node.id));
  const remainingRelations = graph.relations.filter((relation) => (
    relation.sourceProjectId !== projectId
    && remainingNodeIds.has(relation.sourceNodeId)
    && remainingNodeIds.has(relation.targetNodeId)
  ));
  const remainingTopics = new Set(remainingNodes.flatMap((node) => node.topics));

  return {
    ...graph,
    sourceProjectIds: keptPairs.map((pair) => pair.id),
    sourceProjectTitles: keptPairs.map((pair) => pair.title),
    nodes: remainingNodes,
    relations: remainingRelations,
    stats: {
      nodeCount: remainingNodes.length,
      relationCount: remainingRelations.length,
      topicCount: remainingTopics.size,
    },
    updatedAt: new Date().toISOString(),
  };
}

export async function removeProjectFromUserGraphs(projectId: string) {
  await ensureDir();
  const files = await readdir(userGraphsRoot).catch(() => []);
  const removedGraphIds: string[] = [];
  const updatedGraphIds: string[] = [];

  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    const graphId = file.slice(0, -".json".length);
    try {
      const raw = await readFile(path.join(userGraphsRoot, file), "utf-8");
      const graph = JSON.parse(raw) as UserKnowledgeGraph;
      if (!graph.sourceProjectIds.includes(projectId)) {
        continue;
      }

      const nextGraph = pruneGraphForDeletedProject(graph, projectId);
      if (!nextGraph) {
        await unlink(graphFile(graphId));
        removedGraphIds.push(graphId);
        continue;
      }

      await writeFileAtomic(graphFile(graphId), JSON.stringify(nextGraph, null, 2), "utf-8");
      updatedGraphIds.push(graphId);
    } catch {
      continue;
    }
  }

  return { removedGraphIds, updatedGraphIds };
}

function toSummary(graph: UserKnowledgeGraph, canDelete: boolean): UserKnowledgeGraphSummary {
  return {
    id: graph.id,
    ownerIdentityId: graph.ownerIdentityId,
    ownerDisplayName: graph.ownerDisplayName,
    title: graph.title,
    description: graph.description,
    visibility: graph.visibility,
    sourceProjectIds: graph.sourceProjectIds,
    sourceProjectTitles: graph.sourceProjectTitles,
    graphMode: graph.graphMode,
    status: graph.status,
    errorMessage: graph.errorMessage,
    nodeCount: graph.stats.nodeCount,
    relationCount: graph.stats.relationCount,
    createdAt: graph.createdAt,
    updatedAt: graph.updatedAt,
    canDelete,
    generatedProviderId: graph.generatedProviderId,
    generatedModel: graph.generatedModel,
  };
}

/**
 * Generate graph content by calling the user's AI model.
 * Sends chat messages to AI and asks it to extract structured knowledge nodes + relations.
 */
export async function generateUserGraphContent(graphId: string, locale: AppLocale, callerSettings?: AppSettings): Promise<UserKnowledgeGraph | null> {
  const { getProject, getSettings } = await import("@/lib/data/repository");
  const { getCollaborationState } = await import("@/lib/collaboration/store");
  const { getProvider } = await import("@/lib/providers/registry");
  const { getProviderDescriptor, normalizeProviderModel } = await import("@/lib/providers/provider-catalog");

  const raw = await readFile(graphFile(graphId), "utf-8").catch(() => null);
  if (!raw) return null;
  const graph = JSON.parse(raw) as UserKnowledgeGraph;

  await updateUserGraph(graphId, { status: "generating", errorMessage: undefined });

  try {
    let allNodes: UserKnowledgeGraph["nodes"] = [];
    let allRelations: UserKnowledgeGraph["relations"] = [];
    const topics = new Set<string>();
    const now = new Date().toISOString();
    const settings = callerSettings ?? await getSettings();
    const outputLocale = resolveGraphOutputLocale(locale, settings);

    for (const projectId of graph.sourceProjectIds) {
      let project;
      try {
        project = await getProject(projectId, outputLocale);
      } catch {
        throw new Error(localizeGraphText(outputLocale, {
          "zh-CN": `来源项目「${projectId}」不存在，图谱生成已停止。`,
          en: `Source project "${projectId}" was not found. Graph generation stopped.`,
          ja: `ソースプロジェクト「${projectId}」が見つかりません。グラフ生成を停止しました。`,
          ko: `소스 프로젝트 "${projectId}"를 찾을 수 없어 그래프 생성을 중단했습니다.`,
          fr: `Le projet source « ${projectId} » est introuvable. La generation du graphe est arretee.`,
          ru: `Исходный проект "${projectId}" не найден. Создание графа остановлено.`,
        }));
      }

      if (project.metadata.isSample || bundledSampleProjectIds.has(projectId)) {
        throw new Error(localizeGraphText(outputLocale, {
          "zh-CN": `示例项目「${project.title}」不能生成用户图谱。`,
          en: `Sample project "${project.title}" cannot generate a user graph.`,
          ja: `サンプルプロジェクト「${project.title}」からユーザーグラフは生成できません。`,
          ko: `샘플 프로젝트 "${project.title}"에서는 사용자 그래프를 생성할 수 없습니다.`,
          fr: `Le projet d'exemple « ${project.title} » ne peut pas generer de graphe utilisateur.`,
          ru: `Пример "${project.title}" не может создавать пользовательский граф.`,
        }));
      }

      const projectAccess = getProjectAccessState(project, settings);
      if (!projectAccess.canRead || !projectAccess.canRunAiTasks) {
        throw new Error(localizeGraphText(outputLocale, {
          "zh-CN": `当前身份无权基于「${project.title}」生成知识图谱。`,
          en: `Your current local profile cannot generate a knowledge graph from "${project.title}".`,
          ja: `現在のローカルプロフィールでは「${project.title}」から知識グラフを生成できません。`,
          ko: `현재 로컬 프로필로는 "${project.title}"에서 지식 그래프를 생성할 수 없습니다.`,
          fr: `Votre profil local actuel ne peut pas generer de graphe depuis « ${project.title} ».`,
          ru: `Текущий локальный профиль не может создать граф знаний из "${project.title}".`,
        }));
      }

      try {
        // Collect all chat messages from collaboration events
        const collaboration = await getCollaborationState(project);
        const messages = collaboration.events
          .filter((e) => e.type === "message" && e.message.trim().length > 0)
          .slice(-DEFAULT_CONVERSATION_WINDOW);

        if (messages.length === 0) continue;
        const significantMessages = messages.filter((message) => !isLowSignalConversationMessage(message.message));
        const messagesForExtraction = significantMessages.length > 0 ? significantMessages : messages;

        // Build conversation text for AI
        const conversationText = messagesForExtraction.map((m) => {
          const speaker = m.actorType === "ai" ? "AI" : (m.participantName ?? "User");
          return `[${speaker}]: ${m.message}`;
        }).join("\n");

        // Call AI to extract knowledge graph
        const providerId = settings.provider.activeProviderId;
        const providerConfig = settings.provider.providers[providerId];
        const descriptor = getProviderDescriptor(providerId);
        const model = normalizeProviderModel(providerId, providerConfig.model);
        const provider = getProvider(providerId);

        // Build a strict JSON-only prompt that favors fewer, more meaningful knowledge units.
        const graphPrompt = [
          `{"task":"extract_knowledge_graph","instructions":"You are a JSON-only API. Analyze the conversation and extract only durable, high-value knowledge. Ignore greetings, filler, repetition, politeness, transitional phrases, and low-value small talk. Do not turn every sentence into a node. Merge paraphrases and repeated ideas into one stable knowledge unit. Prioritize goals, key questions, important facts, evidence, major viewpoints, conflicts, conclusions, decisions, and next steps. Relationships should be selective and meaningful rather than dense. Your entire response must be a single valid JSON object starting with { and ending with }. Do NOT include any text, explanation, markdown, or code blocks outside the JSON. All labels, descriptions, and relationship text must be written in ${graphOutputLanguageLabel(outputLocale)} because the target graph language is ${outputLocale}. Do NOT create generic placeholder nodes like 'untitled workspace'.","format":{"nodes":[{"id":"n1","label":"concise knowledge label","type":"concept|viewpoint|conclusion|question|evidence|argument|topic|recommendation","description":"why this idea matters in the overall discussion"}],"relations":[{"source":"n1","target":"n2","label":"relationship description","type":"supports|contradicts|related_to|leads_to|derived_from"}]},"rules":"For short content, extract only the real key points; 8 to 20 nodes can be enough and fewer is acceptable. For long content, cluster repeated ideas first and return at most 60 high-value nodes with selective relations. Node IDs must be n1, n2, n3 etc. Prefer stable knowledge units over raw sentences. Only create a relation when it captures a durable knowledge structure such as support, opposition, causality, derivation, extension, or unresolved tension.","conversation":"`,
          conversationText.replace(/"/g, '\\"').replace(/\n/g, "\\n").slice(0, 4000),
          `"}`,
        ].join("");

        let aiResult: GraphAiResult | null = null;

        logKnowledgeGraphDebug("ai_call_start", {
          providerId,
          modelConfigured: Boolean(model),
          messageCount: messages.length,
          extractionMessageCount: messagesForExtraction.length,
        });

        const attemptAiCall = async (prompt: string, attempt: number): Promise<GraphAiResult | null> => {
          try {
            const response = await provider.respondInConversation(project, {
              locale: outputLocale,
              replyLanguage: outputLocale,
              aiRole: "assistant",
              responseLength: "detailed",
              emphasis: "balanced",
              stage: "final-summary",
              goal: "Return JSON knowledge graph",
              providerConfig: { ...providerConfig, model, mode: descriptor?.mode ?? providerConfig.mode },
              requestTimeoutMs: 60000,
              preferServerKeys: true,
              allowFallbackToScaffold: false,
              attachmentContext: { total: 0, items: [] },
            }, {
              prompt,
              history: [],
            });

            logKnowledgeGraphDebug("ai_call_result", {
              providerId,
              attempt,
              ok: response.ok,
              replyLength: response.reply?.length ?? 0,
            });
            if (!response.ok) {
              logKnowledgeGraphError("ai_call_failed", {
                providerId,
                attempt,
                replyLength: response.reply?.length ?? 0,
              });
              return null;
            }

            if (!response.reply) return null;

            // Clean the reply: strip markdown, find JSON
            const text = response.reply
              .replace(/```json\s*/gi, "")
              .replace(/```\s*/g, "")
              .trim();

            // Extract JSON: try multiple strategies for robustness
            // Strategy 1: Find all complete JSON objects and take the one with "nodes"
            const jsonCandidates: string[] = [];
            let depth = 0;
            let start = -1;
            for (let i = 0; i < text.length; i++) {
              if (text[i] === "{") { if (depth === 0) start = i; depth++; }
              else if (text[i] === "}") { depth--; if (depth === 0 && start >= 0) { jsonCandidates.push(text.slice(start, i + 1)); start = -1; } }
            }

            logKnowledgeGraphDebug("json_candidates_found", {
              attempt,
              candidateCount: jsonCandidates.length,
            });

            // Try each candidate, prefer ones with "nodes" array
            for (const candidate of jsonCandidates.reverse()) { // reverse = try last (most likely the real output) first
              try {
                const parsed = JSON.parse(candidate) as GraphAiResult;
                if (Array.isArray(parsed.nodes) && parsed.nodes.length > 0) {
                  logKnowledgeGraphDebug("json_parse_success", {
                    attempt,
                    nodeCount: parsed.nodes.length,
                    relationCount: parsed.relations?.length ?? 0,
                  });
                  return parsed;
                }
              } catch {
                // Try fixing common issues
                const fixed = candidate.replace(/,\s*}/g, "}").replace(/,\s*]/g, "]").replace(/[\x00-\x1f]/g, " ");
                try {
                  const parsed = JSON.parse(fixed) as GraphAiResult;
                  if (Array.isArray(parsed.nodes) && parsed.nodes.length > 0) {
                    logKnowledgeGraphDebug("json_parse_recovered", {
                      attempt,
                      nodeCount: parsed.nodes.length,
                    });
                    return parsed;
                  }
                } catch { continue; }
              }
            }

            logKnowledgeGraphDebug("json_parse_no_nodes", { attempt });
            return null;
          } catch (err) {
            logKnowledgeGraphError("ai_call_exception", {
              providerId,
              attempt,
              errorName: getLoggableErrorName(err),
            });
            return null;
          }
        };

        // Attempt 1: structured JSON prompt
        aiResult = await attemptAiCall(graphPrompt, 1);

        // Attempt 2: if failed, retry with even stricter prompt
        if (!aiResult || !Array.isArray(aiResult.nodes) || aiResult.nodes.length === 0) {
          logKnowledgeGraphDebug("ai_call_retry", { providerId, nextAttempt: 2 });
          const retryPrompt = `Return ONLY a JSON object. No explanation. No markdown. Start with the { character.

Extract only the most important knowledge from this conversation.
Ignore greetings, filler, repetition, acknowledgements, and low-value small talk.
Merge repeated ideas into stable knowledge units.
Focus on goals, key questions, evidence, major viewpoints, conclusions, decisions, and next steps.
For short content, return only the real key points; do not pad the graph. For long content, cluster repeated ideas and return at most 60 high-value nodes with only meaningful relations.
Write all labels, descriptions, and relationship text in ${graphOutputLanguageLabel(outputLocale)}.
Conversation:
${conversationText.slice(0, 2500)}

{"nodes":[{"id":"n1","label":"knowledge label","type":"concept|viewpoint|conclusion|question|evidence|argument|topic|recommendation","description":"description"}],"relations":[{"source":"n1","target":"n2","label":"relationship","type":"supports|contradicts|related_to|leads_to|derived_from"}]}

Your ENTIRE response must be valid JSON. Start with { and end with }. No other text.`;

          aiResult = await attemptAiCall(retryPrompt, 2);
        }

        logKnowledgeGraphDebug("ai_result_validated", {
          providerId,
          valid: Boolean(aiResult && Array.isArray(aiResult.nodes) && aiResult.nodes.length > 0),
          nodeCount: aiResult?.nodes?.length ?? 0,
          relationCount: aiResult?.relations?.length ?? 0,
        });

        if (aiResult && Array.isArray(aiResult.nodes) && aiResult.nodes.length > 0) {
          const keptNodes = selectGraphNodes(aiResult.nodes);
          if (keptNodes.length === 0) {
            throw new Error(localizeGraphText(outputLocale, {
              "zh-CN": "AI 返回的内容没有可保留的高价值图谱节点，图谱生成失败。请补充更具体的讨论内容后重试。",
              en: "The AI response did not contain any durable high-value graph nodes. Add more specific discussion content and retry.",
              ja: "AI の応答には保持できる高価値のグラフノードがありませんでした。より具体的な議論内容を追加して再試行してください。",
              ko: "AI 응답에 보존할 만한 고가치 그래프 노드가 없습니다. 더 구체적인 토론 내용을 추가한 뒤 다시 시도하세요.",
              fr: "La reponse de l'IA ne contient aucun noeud de graphe durable et pertinent. Ajoutez un contenu de discussion plus precis puis reessayez.",
              ru: "В ответе ИИ нет устойчивых ценных узлов графа. Добавьте более конкретное содержание обсуждения и повторите попытку.",
            }));
          }
          const nodeIdByRawId = new Map(keptNodes.map((node) => [node.rawId, `kg_${projectId}_${node.rawId}`]));

          for (const node of keptNodes) {
            const nodeId = nodeIdByRawId.get(node.rawId) ?? `kg_${projectId}_${node.rawId}`;
            if (!["viewpoint", "evidence"].includes(node.type)) {
              topics.add(node.label);
            }
            allNodes.push({
              id: nodeId,
              title: node.label,
              type: node.type,
              category: "other",
              summary: node.summary,
              sourceProjectId: projectId,
              sourceProjectTitle: project.title,
              sourceDiscussionId: projectId,
              tags: [node.label],
              topics: ["viewpoint", "evidence"].includes(node.type) ? [] : [node.label],
              relatedParticipantIds: [],
              evidenceReferences: [],
              relatedNodeIds: [],
              createdFrom: ["transcript"],
              createdAt: now,
              updatedAt: now,
              provenance: { projectId, projectTitle: project.title, projectLocale: outputLocale, scenario: project.scenario, createdFrom: ["transcript"], generatedAt: now },
            });
          }

          if (Array.isArray(aiResult.relations)) {
            const keptRelations = selectGraphRelations(aiResult.relations, keptNodes);
            for (const relation of keptRelations) {
              const sourceNodeId = nodeIdByRawId.get(relation.rawSource);
              const targetNodeId = nodeIdByRawId.get(relation.rawTarget);
              if (!sourceNodeId || !targetNodeId) continue;
              allRelations.push({
                id: createId("krel"),
                sourceNodeId,
                targetNodeId,
                type: relation.type,
                note: relation.note,
                sourceProjectId: projectId,
                createdAt: now,
              });
            }
          }
        } else {
          throw new Error(localizeGraphText(outputLocale, {
            "zh-CN": `AI 没有返回可用的图谱节点，图谱生成失败。请检查 Provider / 模型设置后重试。`,
            en: "The AI did not return usable graph nodes. Check the provider/model settings and retry.",
            ja: "AI が利用可能なグラフノードを返しませんでした。Provider / モデル設定を確認して再試行してください。",
            ko: "AI가 사용할 수 있는 그래프 노드를 반환하지 않았습니다. Provider / 모델 설정을 확인한 뒤 다시 시도하세요.",
            fr: "L'IA n'a pas renvoye de noeuds de graphe exploitables. Verifiez le provider / modele puis reessayez.",
            ru: "ИИ не вернул пригодные узлы графа. Проверьте provider / model и повторите попытку.",
          }));
        }
      } catch (error) {
        throw error;
      }
    }

    if (allNodes.length === 0) {
      throw new Error(localizeGraphText(outputLocale, {
        "zh-CN": "没有足够的讨论内容可生成知识图谱。",
        en: "There is not enough discussion content to generate a knowledge graph.",
        ja: "知識グラフを生成するための議論内容が不足しています。",
        ko: "지식 그래프를 생성할 토론 내용이 충분하지 않습니다.",
        fr: "Le contenu de discussion est insuffisant pour generer un graphe de connaissances.",
        ru: "Недостаточно содержания обсуждения для создания графа знаний.",
      }));
    }

    const budgetMode = graph.graphMode === "3d" ? "3d" : "2d";
    const budgetedGraph = applyKnowledgeGraphBudget(allNodes, allRelations, budgetMode);
    allNodes = budgetedGraph.nodes;
    allRelations = budgetedGraph.relations;
    topics.clear();
    for (const node of allNodes) {
      for (const topic of node.topics) {
        topics.add(topic);
      }
    }

    return await updateUserGraph(graphId, {
      locale: outputLocale,
      status: "ready",
      errorMessage: undefined,
      nodes: allNodes,
      relations: allRelations,
      stats: {
        nodeCount: allNodes.length,
        relationCount: allRelations.length,
        topicCount: topics.size,
      },
      generatedAt: new Date().toISOString(),
      generatedProviderId: settings.provider.activeProviderId,
      generatedModel: normalizeProviderModel(settings.provider.activeProviderId, settings.provider.providers[settings.provider.activeProviderId]?.model),
    });
  } catch (error) {
    await updateUserGraph(graphId, {
      status: "failed",
      errorMessage: error instanceof Error ? error.message : "Unknown error",
    });
    return null;
  }
}
