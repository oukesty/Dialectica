import { mkdir, readFile, readdir, unlink } from "node:fs/promises";
import path from "node:path";
import { bundledSampleProjectIds, getBundledSampleKnowledgeProject } from "@/data/samples";
import { writeFileAtomic } from "@/lib/atomic-file";
import { getCollaborationState } from "@/lib/collaboration/store";
import { getProject, getSettings } from "@/lib/data/repository";
import { AppLocale, AppSettings } from "@/lib/types";
import { applyKnowledgeGraphBudget } from "@/lib/knowledge/budget";
import { extractKnowledgeSnapshot } from "@/lib/knowledge/extract";
import {
  KnowledgeGraphPayload,
  KnowledgeNode,
  KnowledgeNodeDetail,
  KnowledgeHomepageSummary,
  KnowledgeOverview,
  KnowledgeProjectClusterSummary,
  KnowledgeProjectSnapshot,
  KnowledgeQuery,
  KnowledgeCategory,
} from "@/lib/knowledge/types";
import { getProjectAccessState, isSharedProjectWorkspace } from "@/lib/project-access";
import { normalizeText, slugify } from "@/lib/utils";

const dataRoot = path.join(process.cwd(), "data");
const knowledgeRoot = path.join(dataRoot, "knowledge");
const SAFE_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

function assertSafeId(id: string, label = "id"): void {
  if (!id || !SAFE_ID_PATTERN.test(id)) {
    throw new Error(`Invalid ${label}: contains disallowed characters`);
  }
}
const garbledSnapshotPattern = /\?{3,}|锘|娑堟|鏈|澶栭|褰撳墠|\uFFFD/u;
const KNOWLEDGE_CACHE_TTL_MS = 6000;
const snapshotListCache = new Map<AppLocale, { expiresAt: number; snapshots: KnowledgeProjectSnapshot[] }>();
const homepageSummaryCache = new Map<string, { expiresAt: number; summary: KnowledgeHomepageSummary }>();
const overviewCache = new Map<string, { expiresAt: number; overview: KnowledgeOverview }>();

function viewerCacheKey(locale: AppLocale, identityId: string) {
  return `${locale}:${identityId || "anonymous"}`;
}

function deleteViewerCacheEntriesForLocale<T>(cache: Map<string, T>, locale: AppLocale) {
  for (const key of cache.keys()) {
    if (key === locale || key.startsWith(`${locale}:`)) {
      cache.delete(key);
    }
  }
}

export function invalidateKnowledgeCaches(locale?: AppLocale) {
  if (locale) {
    snapshotListCache.delete(locale);
    deleteViewerCacheEntriesForLocale(homepageSummaryCache, locale);
    deleteViewerCacheEntriesForLocale(overviewCache, locale);
    return;
  }
  snapshotListCache.clear();
  homepageSummaryCache.clear();
  overviewCache.clear();
}

async function ensureKnowledgeRoot() {
  await mkdir(knowledgeRoot, { recursive: true });
}

async function removeFileIfExists(filePath: string) {
  try {
    await unlink(filePath);
  } catch (error) {
    if ((error as { code?: string }).code !== "ENOENT") {
      throw error;
    }
  }
}

function getSnapshotFile(projectId: string, locale: AppLocale) {
  assertSafeId(projectId, "projectId");
  return path.join(knowledgeRoot, `${projectId}.${locale}.json`);
}

async function readSnapshotFile(projectId: string, locale: AppLocale) {
  await ensureKnowledgeRoot();
  try {
    const raw = await readFile(getSnapshotFile(projectId, locale), "utf-8");
    if (garbledSnapshotPattern.test(raw)) {
      return null;
    }
    return JSON.parse(raw) as KnowledgeProjectSnapshot;
  } catch {
    return null;
  }
}

async function writeSnapshot(snapshot: KnowledgeProjectSnapshot) {
  await ensureKnowledgeRoot();
  await writeFileAtomic(getSnapshotFile(snapshot.projectId, snapshot.locale), `${JSON.stringify(snapshot, null, 2)}\n`, "utf-8");
  invalidateKnowledgeCaches(snapshot.locale);
  return snapshot;
}

function getSnapshotProjectId(fileName: string, locale: AppLocale) {
  const suffix = `.${locale}.json`;
  return fileName.endsWith(suffix) ? fileName.slice(0, -suffix.length) : null;
}

async function buildBundledSampleSnapshot(projectId: string, locale: AppLocale) {
  const [workspaceProject, settings] = await Promise.all([getProject(projectId, locale), getSettings()]);
  const project = getBundledSampleKnowledgeProject(projectId, locale) ?? workspaceProject;
  const collaboration = await getCollaborationState(project);
  return extractKnowledgeSnapshot(project, collaboration.attachments, settings, {
    locale,
    generateGraphLinks: true,
  });
}

async function readProjectSnapshot(projectId: string, locale: AppLocale) {
  if (bundledSampleProjectIds.has(projectId)) {
    return buildBundledSampleSnapshot(projectId, locale);
  }
  return readSnapshotFile(projectId, locale);
}

function matchesQuery(node: KnowledgeNode, query: KnowledgeQuery) {
  const normalized = normalizeText(query.query ?? "");
  const matchesText = !normalized || normalizeText(`${node.title} ${node.summary} ${node.tags.join(" ")} ${node.topics.join(" ")}`).includes(normalized);
  const matchesTag = !query.tag || node.tags.includes(query.tag);
  const matchesTopic = !query.topic || node.topics.includes(query.topic);
  const matchesCategory = !query.category || node.category === query.category;
  const matchesProject = !query.projectId || node.sourceProjectId === query.projectId;
  const matchesProjectList = !query.projectIds || query.projectIds.length === 0 || query.projectIds.includes(node.sourceProjectId);
  return matchesText && matchesTag && matchesTopic && matchesCategory && matchesProject && matchesProjectList;
}

async function ensureProjectSnapshot(projectId: string, locale: AppLocale, force = false, options: { generateGraphLinks?: boolean } = {}) {
  if (!force) {
    return readProjectSnapshot(projectId, locale);
  }
  const [project, settings] = await Promise.all([getProject(projectId, locale), getSettings()]);
  const collaboration = await getCollaborationState(project);
  const snapshot = extractKnowledgeSnapshot(project, collaboration.attachments, settings, {
    ...options,
    locale,
  });
  return writeSnapshot(snapshot);
}

async function loadAllSnapshots(locale: AppLocale) {
  const cached = snapshotListCache.get(locale);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.snapshots;
  }

  await ensureKnowledgeRoot();
  const files = await readdir(knowledgeRoot).catch(() => []);
  const storedProjectIds = files
    .map((file) => getSnapshotProjectId(file, locale))
    .filter((projectId): projectId is string => projectId !== null)
    .filter((projectId) => !bundledSampleProjectIds.has(projectId));
  const storedSnapshots = await Promise.all(storedProjectIds.map(async (projectId) => readSnapshotFile(projectId, locale)));
  const sampleSnapshots = await Promise.all([...bundledSampleProjectIds].map(async (projectId) => buildBundledSampleSnapshot(projectId, locale)));
  const snapshots = [...storedSnapshots, ...sampleSnapshots].filter((snapshot): snapshot is KnowledgeProjectSnapshot => Boolean(snapshot));

  const sortedSnapshots = snapshots.sort((left, right) => right.generatedAt.localeCompare(left.generatedAt));
  snapshotListCache.set(locale, {
    expiresAt: Date.now() + KNOWLEDGE_CACHE_TTL_MS,
    snapshots: sortedSnapshots,
  });
  return sortedSnapshots;
}

type ReadableSnapshotRecord = {
  snapshot: KnowledgeProjectSnapshot;
  isProtectedSample: boolean;
  canDeleteKnowledge: boolean;
  canDeleteGraphCluster: boolean;
};

async function loadReadableSnapshotRecords(
  locale: AppLocale,
  settings?: AppSettings,
): Promise<ReadableSnapshotRecord[]> {
  const effectiveSettings = settings ?? await getSettings({ includeSecrets: false });
  const snapshots = await loadAllSnapshots(locale);
  const records = await Promise.all(snapshots.map(async (snapshot): Promise<ReadableSnapshotRecord | null> => {
    if (bundledSampleProjectIds.has(snapshot.projectId)) {
      return {
        snapshot,
        isProtectedSample: true,
        canDeleteKnowledge: false,
        canDeleteGraphCluster: false,
      };
    }

    try {
      const project = await getProject(snapshot.projectId, locale);
      const access = getProjectAccessState(project, effectiveSettings);
      if (!access.canRead) {
        return null;
      }
      return {
        snapshot,
        isProtectedSample: Boolean(project.metadata.isSample),
        canDeleteKnowledge: access.canEditWorkspace,
        canDeleteGraphCluster: access.canEditWorkspace && !isSharedProjectWorkspace(project),
      };
    } catch {
      return null;
    }
  }));

  return records.filter((record): record is ReadableSnapshotRecord => Boolean(record));
}

function resolveRequestedProjectIds(query: KnowledgeQuery) {
  if (query.projectIds && query.projectIds.length > 0) {
    return [...new Set(query.projectIds.filter(Boolean))];
  }
  if (query.projectId) {
    return [query.projectId];
  }
  return undefined;
}

function resolveNodeIdCandidates(nodeId: string) {
  const candidates = new Set<string>();
  const slugCandidates = new Set<string>();
  const add = (value: string | undefined) => {
    if (!value) return;
    candidates.add(value);
    slugCandidates.add(slugify(value));
    try {
      const decoded = decodeURIComponent(value);
      candidates.add(decoded);
      slugCandidates.add(slugify(decoded));
    } catch {
      // ignore malformed encoding and keep the raw id
    }
  };
  add(nodeId);
  return {
    candidates: [...candidates],
    slugCandidates: [...slugCandidates].filter(Boolean),
  };
}

function matchesNodeIdCandidate(node: KnowledgeNode, requested: ReturnType<typeof resolveNodeIdCandidates>) {
  if (requested.candidates.includes(node.id)) {
    return true;
  }
  return requested.slugCandidates.some((slug) => node.id.endsWith(`_${slug}`));
}

export async function getProjectKnowledgeSnapshot(projectId: string, locale: AppLocale, force = false) {
  return ensureProjectSnapshot(projectId, locale, force);
}

export async function extractAndSaveProjectKnowledge(projectId: string, locale: AppLocale, options: { generateGraphLinks?: boolean } = {}) {
  return ensureProjectSnapshot(projectId, locale, true, options);
}

export interface KnowledgeNodeMutationTarget {
  projectId: string;
  locale: AppLocale;
  nodeId: string;
  node: KnowledgeNode;
  snapshot: KnowledgeProjectSnapshot;
  isProtectedSample: boolean;
}

export async function findKnowledgeNodeMutationTarget(nodeId: string, locale: AppLocale): Promise<KnowledgeNodeMutationTarget | null> {
  const localesToTry: AppLocale[] = locale === "en" ? ["en"] : [locale, "en"];
  const requestedNodeId = resolveNodeIdCandidates(nodeId);

  for (const candidateLocale of localesToTry) {
    const snapshots = await loadAllSnapshots(candidateLocale);
    for (const snapshot of snapshots) {
      const node = snapshot.nodes.find((candidate) => matchesNodeIdCandidate(candidate, requestedNodeId));
      if (!node) continue;
      return {
        projectId: snapshot.projectId,
        locale: candidateLocale,
        nodeId: node.id,
        node,
        snapshot,
        isProtectedSample: bundledSampleProjectIds.has(snapshot.projectId),
      };
    }
  }

  return null;
}

export async function listKnowledgeNodes(query: KnowledgeQuery) {
  const records = await loadReadableSnapshotRecords(query.locale);
  return records
    .map((record) => record.snapshot)
    .flatMap((snapshot) => snapshot.nodes)
    .filter((node) => matchesQuery(node, query))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export async function getKnowledgeNodeDetail(nodeId: string, locale: AppLocale): Promise<KnowledgeNodeDetail | null> {
  const localesToTry: AppLocale[] = locale === "en" ? ["en"] : [locale, "en"];
  const requestedNodeId = resolveNodeIdCandidates(nodeId);

  for (const candidateLocale of localesToTry) {
    const records = await loadReadableSnapshotRecords(candidateLocale);
    const snapshots = records.map((record) => record.snapshot);
    for (const snapshot of snapshots) {
      const node = snapshot.nodes.find((candidate) => matchesNodeIdCandidate(candidate, requestedNodeId));
      if (!node) continue;
      const relations = snapshot.relations.filter((relation) => relation.sourceNodeId === node.id || relation.targetNodeId === node.id);
      const connectedIds = new Set(relations.flatMap((relation) => [relation.sourceNodeId, relation.targetNodeId]).filter((candidate) => candidate !== node.id));
      return {
        node,
        relations,
        connectedNodes: snapshot.nodes.filter((candidate) => connectedIds.has(candidate.id)),
      };
    }
  }

  return null;
}

export async function updateKnowledgeNode(
  nodeId: string,
  locale: AppLocale,
  updates: { title?: string; summary?: string; type?: string },
): Promise<boolean> {
  const target = await findKnowledgeNodeMutationTarget(nodeId, locale);
  if (!target || target.isProtectedSample) return false;

  const idx = target.snapshot.nodes.findIndex((n) => n.id === target.nodeId);
  if (idx === -1) return false;
  const node = target.snapshot.nodes[idx];
  target.snapshot.nodes[idx] = {
    ...node,
    title: updates.title ?? node.title,
    summary: updates.summary ?? node.summary,
    type: (updates.type as typeof node.type) ?? node.type,
    updatedAt: new Date().toISOString(),
  };
  await writeSnapshot(target.snapshot);
  return true;
}

export async function deleteKnowledgeNode(nodeId: string, locale: AppLocale): Promise<boolean> {
  const target = await findKnowledgeNodeMutationTarget(nodeId, locale);
  if (!target || target.isProtectedSample) return false;

  const idx = target.snapshot.nodes.findIndex((n) => n.id === target.nodeId);
  if (idx === -1) return false;
  target.snapshot.nodes.splice(idx, 1);
  target.snapshot.relations = target.snapshot.relations.filter(
    (r) => r.sourceNodeId !== target.nodeId && r.targetNodeId !== target.nodeId,
  );
  await writeSnapshot(target.snapshot);
  return true;
}

export async function buildKnowledgeGraph(query: KnowledgeQuery): Promise<KnowledgeGraphPayload> {
  const records = await loadReadableSnapshotRecords(query.locale);
  const snapshots = records.map((record) => record.snapshot);
  const requestedProjectIds = resolveRequestedProjectIds(query);
  const projectDeletionState = new Map<string, { isProtectedSample: boolean; canDelete: boolean }>();

  for (const record of records) {
    projectDeletionState.set(record.snapshot.projectId, {
      isProtectedSample: record.isProtectedSample,
      canDelete: record.canDeleteGraphCluster,
    });
  }

  const scopeMode = query.scopeMode ?? (query.projectId && !query.projectIds?.length ? "project" : requestedProjectIds && requestedProjectIds.length > 1 ? "cross-project" : query.projectId ? "project" : "cross-project");
  const selectedSnapshots = requestedProjectIds
    ? snapshots.filter((snapshot) => requestedProjectIds.includes(snapshot.projectId))
    : snapshots;
  const matchedNodes = selectedSnapshots.flatMap((snapshot) => snapshot.nodes).filter((node) => matchesQuery(node, query));
  const matchedNodeIds = new Set(matchedNodes.map((node) => node.id));
  const matchedRelations = selectedSnapshots
    .flatMap((snapshot) => snapshot.relations)
    .filter((relation) => matchedNodeIds.has(relation.sourceNodeId) && matchedNodeIds.has(relation.targetNodeId));
  const budgetedGraph = applyKnowledgeGraphBudget(matchedNodes, matchedRelations, "2d");
  const nodes = budgetedGraph.nodes;
  const relations = budgetedGraph.relations;

  const availableProjects = snapshots
    .map((snapshot) => {
      const deletionState = projectDeletionState.get(snapshot.projectId) ?? {
        isProtectedSample: false,
        canDelete: false,
      };
      return {
        projectId: snapshot.projectId,
        projectTitle: snapshot.projectTitle,
        nodeCount: snapshot.nodes.length,
        relationCount: snapshot.relations.length,
        topics: [...new Set(snapshot.nodes.flatMap((node) => node.topics))].slice(0, 4),
        ...deletionState,
      };
    })
    .sort((left, right) => right.nodeCount - left.nodeCount);

  const projects = selectedSnapshots
    .map((snapshot) => {
      const projectNodes = nodes.filter((node) => node.sourceProjectId === snapshot.projectId);
      const projectNodeIds = new Set(projectNodes.map((node) => node.id));
      const projectRelations = relations.filter((relation) => projectNodeIds.has(relation.sourceNodeId) || relation.sourceProjectId === snapshot.projectId);
      const deletionState = projectDeletionState.get(snapshot.projectId) ?? {
        isProtectedSample: false,
        canDelete: false,
      };
      return {
        projectId: snapshot.projectId,
        projectTitle: snapshot.projectTitle,
        nodeCount: projectNodes.length,
        relationCount: projectRelations.length,
        topics: [...new Set(projectNodes.flatMap((node) => node.topics))].slice(0, 4),
        ...deletionState,
      };
    })
    .filter((project) => project.nodeCount > 0)
    .sort((left, right) => right.nodeCount - left.nodeCount);

  const scopeProjectId = scopeMode === "project" ? (query.projectId ?? (requestedProjectIds?.length === 1 ? requestedProjectIds[0] : undefined)) : undefined;
  const scopedProjectIds = scopeMode === "cross-project"
    ? requestedProjectIds && requestedProjectIds.length > 0
      ? requestedProjectIds
      : undefined
    : undefined;

  return {
    generatedAt: new Date().toISOString(),
    mode: scopeMode === "cross-project" ? "cross-project" : scopeProjectId ? "project" : "cross-project",
    scope: {
      locale: query.locale,
      scopeMode,
      projectId: scopeProjectId,
      projectIds: scopedProjectIds,
      query: query.query,
      topic: query.topic,
      category: query.category,
    },
    projects,
    availableProjects,
    nodes,
    relations,
  };
}

export async function getKnowledgeHomepageSummary(locale: AppLocale): Promise<KnowledgeHomepageSummary> {
  const settings = await getSettings({ includeSecrets: false });
  const cacheKey = viewerCacheKey(locale, settings.profile.localIdentityId);
  const cached = homepageSummaryCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.summary;
  }

  const records = await loadReadableSnapshotRecords(locale, settings);
  const snapshots = records.map((record) => record.snapshot);
  const nodes = snapshots.flatMap((snapshot) => snapshot.nodes).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  const relations = snapshots.flatMap((snapshot) => snapshot.relations);

  const summary = {
    generatedAt: new Date().toISOString(),
    totalNodes: nodes.length,
    totalRelations: relations.length,
    recentNodes: nodes.slice(0, 8),
  } satisfies KnowledgeHomepageSummary;

  homepageSummaryCache.set(cacheKey, {
    expiresAt: Date.now() + KNOWLEDGE_CACHE_TTL_MS,
    summary,
  });
  return summary;
}

export async function getKnowledgeOverview(locale: AppLocale): Promise<KnowledgeOverview> {
  const settings = await getSettings({ includeSecrets: false });
  const cacheKey = viewerCacheKey(locale, settings.profile.localIdentityId);
  const cached = overviewCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.overview;
  }

  const records = await loadReadableSnapshotRecords(locale, settings);
  const snapshots = records.map((record) => record.snapshot);
  const nodes = snapshots.flatMap((snapshot) => snapshot.nodes).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  const relations = snapshots.flatMap((snapshot) => snapshot.relations);
  const categories = new Map<string, number>();
  const topics = new Map<string, number>();
  const projects: KnowledgeProjectClusterSummary[] = records.map((record) => ({
    projectId: record.snapshot.projectId,
    projectTitle: record.snapshot.projectTitle,
    nodeCount: record.snapshot.nodes.length,
    isProtectedSample: record.isProtectedSample,
    canDelete: record.canDeleteKnowledge,
  }));

  for (const node of nodes) {
    categories.set(node.category, (categories.get(node.category) ?? 0) + 1);
    for (const topic of node.topics) {
      topics.set(topic, (topics.get(topic) ?? 0) + 1);
    }
  }

  const overview = {
    generatedAt: new Date().toISOString(),
    totalNodes: nodes.length,
    totalRelations: relations.length,
    recentNodes: nodes.slice(0, 8),
    categories: [...categories.entries()].sort((left, right) => right[1] - left[1]).slice(0, 6).map(([category, count]) => ({ category: category as KnowledgeCategory, count })),
    topics: [...topics.entries()].sort((left, right) => right[1] - left[1]).slice(0, 8).map(([topic, count]) => ({ topic, count })),
    projects,
  } satisfies KnowledgeOverview;

  overviewCache.set(cacheKey, {
    expiresAt: Date.now() + KNOWLEDGE_CACHE_TTL_MS,
    overview,
  });
  return overview;
}

export async function deleteProjectKnowledge(projectId: string) {
  await ensureKnowledgeRoot();
  const files = await readdir(knowledgeRoot);
  await Promise.all(
    files
      .filter((file) => file.startsWith(`${projectId}.`) && file.endsWith(".json"))
      .map((file) => removeFileIfExists(path.join(knowledgeRoot, file))),
  );
  invalidateKnowledgeCaches();
}
