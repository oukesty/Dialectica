"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { LocateFixed, Minus, Move, Pencil, Plus, RotateCcw, Search, Trash2, X } from "lucide-react";
import { useI18n } from "@/components/providers/i18n-provider";
import { Badge, Button, Panel } from "@/components/ui/primitives";
import { KnowledgeGraph3DView, type GraphPointerDebugEvent } from "@/components/knowledge/knowledge-graph-3d-view";
import { AppLocale } from "@/lib/types";
import { KnowledgeGraphPayload, KnowledgeNodeType } from "@/lib/knowledge/types";
import { getProviderDescriptor } from "@/lib/providers/provider-catalog";

const order = ["project", "concept", "topic", "viewpoint", "argument", "evidence", "conflict", "conclusion", "question", "recommendation", "document"] as const;
const nodeWidth = 344;
const columnGap = 432;
const relationMarkerOffsets: Array<{ x: number; y: number }> = [
  { x: 0, y: 0 },
  { x: 0, y: -18 },
  { x: 0, y: 18 },
  { x: -16, y: 0 },
  { x: 16, y: 0 },
  { x: -18, y: -14 },
  { x: 18, y: 14 },
  { x: -22, y: 16 },
  { x: 22, y: -16 },
];

const GRAPH_INPUT_DRAGGING_CLASS = "graph-input-dragging";

type GraphPointerDebugSnapshot = {
  view: "2d" | "3d";
  dragging: boolean;
  pointerX: number | null;
  pointerY: number | null;
  pointerPerSecond: number;
  framePerSecond: number;
  lastDelayMs: number | null;
  lastFrameMs: number | null;
  longFrames32: number;
  longFrames50: number;
  elementTag: string;
  elementClass: string;
  elementData: string;
  cursor: string;
  listener: string;
  pointerCapture: boolean;
  autoRotate: boolean | null;
  nodeCount: number;
  relationCount: number;
  layerWidth: number | null;
  layerHeight: number | null;
  bufferWidth: number | null;
  bufferHeight: number | null;
  dpr: number | null;
};

function setGraphInputDragging(enabled: boolean) {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle(GRAPH_INPUT_DRAGGING_CLASS, enabled);
}

function setGraphViewportDragging(element: HTMLElement | null, enabled: boolean) {
  if (!element) return;
  if (enabled) {
    element.dataset.graphDragging = "true";
    return;
  }
  delete element.dataset.graphDragging;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function estimateNodeHeight(title: string, summary: string) {
  const titleLines = Math.min(3, Math.max(1, Math.ceil(title.length / 16)));
  const summaryLines = Math.min(4, Math.max(2, Math.ceil(summary.length / 48)));
  return 156 + titleLines * 16 + summaryLines * 18;
}

function normalizeGraphText(value?: string) {
  return (value ?? "")
    .replace(/\s+/g, " ")
    .replace(/^(项目|问题|主题|分类|来源项目|topic|project|question|source project)\s*[:：-]?\s*/i, "")
    .replace(/[?？!！。．、,:：;；]+$/g, "")
    .trim()
    .toLowerCase();
}

function graphTextEquivalent(left?: string, right?: string) {
  const normalizedLeft = normalizeGraphText(left);
  const normalizedRight = normalizeGraphText(right);
  if (!normalizedLeft || !normalizedRight) return false;
  if (normalizedLeft === normalizedRight) return true;
  const shortText = normalizedLeft.length <= normalizedRight.length ? normalizedLeft : normalizedRight;
  const longText = normalizedLeft.length <= normalizedRight.length ? normalizedRight : normalizedLeft;
  return shortText.length >= 6 && (longText.startsWith(shortText) || shortText.startsWith(longText));
}

function stripDuplicateSummaryLead(line: string, duplicateCandidates: string[]) {
  let nextLine = line.trim();
  let changed = true;

  while (changed && nextLine) {
    changed = false;
    for (const candidate of duplicateCandidates) {
      const trimmedCandidate = candidate.trim();
      if (!trimmedCandidate) continue;
      if (graphTextEquivalent(nextLine, trimmedCandidate)) {
        return "";
      }
      if (nextLine.startsWith(trimmedCandidate) && nextLine.length > trimmedCandidate.length) {
        nextLine = nextLine.slice(trimmedCandidate.length).replace(/^[\s\-–—:：,，.。!?！？]+/, "").trim();
        changed = true;
      }
    }
  }

  return nextLine;
}

function getRenderableNodeSummary(node: KnowledgeGraphPayload["nodes"][number], metaLabels: string[] = []) {
  const duplicateCandidates = [node.title, node.sourceProjectTitle, node.provenance?.projectTitle, ...node.topics, ...node.tags, ...metaLabels]
    .map((candidate) => candidate?.trim())
    .filter(Boolean) as string[];

  const lines = (node.summary ?? "")
    .split(/\r?\n+/)
    .map((line) => stripDuplicateSummaryLead(line, duplicateCandidates))
    .map((line) => line.replace(/^[•·\-–—:：,，.。!?！？]+/, "").trim())
    .filter(Boolean)
    .filter((line) => !duplicateCandidates.some((candidate) => graphTextEquivalent(line, candidate)));

  const summary = lines.join("\n").trim();
  if (!summary) return "";
  const firstSentence = summary.split(/[。．.!！？?\n]/)[0]?.trim() ?? "";
  if (duplicateCandidates.some((candidate) => graphTextEquivalent(summary, candidate) || graphTextEquivalent(firstSentence, candidate))) {
    return "";
  }
  return summary;
}

function getNodeMetaLabels(node: KnowledgeGraphPayload["nodes"][number]) {
  const labels: string[] = [];
  const seen = new Set<string>();

  const push = (value?: string) => {
    const trimmed = value?.trim();
    const normalized = normalizeGraphText(trimmed);
    if (!trimmed || !normalized || seen.has(normalized) || graphTextEquivalent(trimmed, node.title)) return;
    seen.add(normalized);
    labels.push(trimmed);
  };

  push(node.sourceProjectTitle);
  node.topics.forEach((topic) => push(topic));
  node.tags.forEach((tag) => push(tag));
  return labels.slice(0, 4);
}

function nodeTone(type: KnowledgeNodeType) {
  if (type === "project") return "border-sky-500/30 bg-sky-500/10";
  if (type === "topic") return "border-violet-500/30 bg-violet-500/10";
  if (type === "viewpoint") return "border-indigo-500/30 bg-indigo-500/10";
  if (type === "argument") return "border-amber-500/35 bg-amber-500/10";
  if (type === "evidence") return "border-emerald-500/35 bg-emerald-500/10";
  if (type === "conflict") return "border-rose-500/35 bg-rose-500/10";
  if (type === "conclusion") return "border-cyan-500/35 bg-cyan-500/10";
  if (type === "question") return "border-fuchsia-500/35 bg-fuchsia-500/10";
  if (type === "recommendation") return "border-orange-500/35 bg-orange-500/10";
  return "border-[color:var(--border)] bg-[color:var(--surface-soft)]";
}

const NODE_TYPE_RING_COLORS: Record<string, string> = {
  project: "rgba(14,165,233,0.45)",
  topic: "rgba(139,92,246,0.45)",
  viewpoint: "rgba(99,102,241,0.45)",
  argument: "rgba(245,158,11,0.45)",
  evidence: "rgba(16,185,129,0.45)",
  conflict: "rgba(239,68,68,0.45)",
  conclusion: "rgba(6,182,212,0.45)",
  question: "rgba(217,70,239,0.45)",
  recommendation: "rgba(249,115,22,0.45)",
  document: "rgba(148,163,184,0.45)",
};
const NODE_TYPE_GLOW_COLORS: Record<string, string> = {
  project: "rgba(14,165,233,0.12)",
  topic: "rgba(139,92,246,0.12)",
  viewpoint: "rgba(99,102,241,0.12)",
  argument: "rgba(245,158,11,0.12)",
  evidence: "rgba(16,185,129,0.12)",
  conflict: "rgba(239,68,68,0.12)",
  conclusion: "rgba(6,182,212,0.12)",
  question: "rgba(217,70,239,0.12)",
  recommendation: "rgba(249,115,22,0.12)",
  document: "rgba(148,163,184,0.12)",
};

function buildGraphHref(
  locale: AppLocale,
  options: { projectId?: string; projectIds?: string[]; scopeMode?: "project" | "cross-project" } = {},
) {
  const params = new URLSearchParams();
  if (options.scopeMode) params.set("scopeMode", options.scopeMode);
  if (options.projectId) params.set("projectId", options.projectId);
  if (options.projectIds && options.projectIds.length > 0) params.set("projectIds", [...new Set(options.projectIds)].join(","));
  const query = params.toString();
  return `/${locale}/knowledge/graph${query ? `?${query}` : ""}`;
}

function buildGraphExportHref(
  locale: AppLocale,
  graph: KnowledgeGraphPayload,
  activeUserGraph: { id: string; sourceProjectIds: string[] } | null,
) {
  const params = new URLSearchParams();
  params.set("locale", locale);
  const graphId = graph.scope.graphId ?? activeUserGraph?.id;
  if (graphId) params.set("graphId", graphId);
  if (graph.scope.scopeMode) params.set("scopeMode", graph.scope.scopeMode);
  if (graph.scope.projectId) params.set("projectId", graph.scope.projectId);
  const scopedProjectIds = graph.scope.projectIds?.length
    ? graph.scope.projectIds
    : activeUserGraph?.sourceProjectIds;
  if (scopedProjectIds && scopedProjectIds.length > 0) {
    params.set("projectIds", [...new Set(scopedProjectIds)].join(","));
  }
  if (graph.scope.query) params.set("query", graph.scope.query);
  if (graph.scope.topic) params.set("topic", graph.scope.topic);
  if (graph.scope.category) params.set("category", graph.scope.category);
  return `/api/knowledge/graph?${params.toString()}`;
}

function buildUserGraphGroupKey(sourceProjectIds: string[], graphId: string) {
  return sourceProjectIds.length > 0 ? [...sourceProjectIds].sort().join("|") : `graph:${graphId}`;
}

function buildUserGraphVersionHref(
  locale: AppLocale,
  graph: { id: string; sourceProjectIds: string[] },
) {
  const params = new URLSearchParams();
  params.set("graphId", graph.id);
  if (graph.sourceProjectIds.length > 0) {
    params.set("projectIds", [...new Set(graph.sourceProjectIds)].join(","));
    params.set("scopeMode", graph.sourceProjectIds.length === 1 ? "project" : "cross-project");
    if (graph.sourceProjectIds.length === 1) {
      params.set("projectId", graph.sourceProjectIds[0]);
    }
  }
  return `/${locale}/knowledge/graph?${params.toString()}`;
}

const PROJECT_CLUSTER_PREVIEW_COUNT = 4;
const PROJECT_CLUSTER_DELETE_PREF_KEY = "dialectica:knowledge:project-cluster-delete-confirm";
const KNOWLEDGE_GRAPH_STAGE_MIN_HEIGHT_PX = 1040;
const KNOWLEDGE_GRAPH_STAGE_TOP_PADDING_PX = 18;
const KNOWLEDGE_GRAPH_STAGE_BOTTOM_PADDING_PX = 8;
const KNOWLEDGE_GRAPH_LANE_STRETCH = 0.98;
const KNOWLEDGE_GRAPH_DEFAULT_PAN_X = 40;
const KNOWLEDGE_GRAPH_DEFAULT_PAN_Y = 88;
const KNOWLEDGE_GRAPH_NODE_FOCUS_MIN_REM = 18;
const KNOWLEDGE_GRAPH_RELATION_INSPECTOR_MIN_REM = 16;
const KNOWLEDGE_GRAPH_PROJECT_CLUSTERS_MIN_REM = 20;
const PROJECT_CLUSTER_DELETE_SNOOZE_MS = {
  "24h": 24 * 60 * 60 * 1000,
  "1w": 7 * 24 * 60 * 60 * 1000,
  "1m": 30 * 24 * 60 * 60 * 1000,
} as const;

type ProjectClusterDeleteSnoozeOption = "always" | "24h" | "1w" | "1m" | "forever";
type ProjectClusterDeletePreference =
  | { mode: "always" }
  | { mode: "until"; until: number }
  | { mode: "forever" };

function readProjectClusterDeletePreference(): ProjectClusterDeletePreference {
  if (typeof window === "undefined") {
    return { mode: "always" };
  }

  try {
    const raw = window.localStorage.getItem(PROJECT_CLUSTER_DELETE_PREF_KEY);
    if (!raw) return { mode: "always" };
    const parsed = JSON.parse(raw) as ProjectClusterDeletePreference;
    if (parsed.mode === "forever") return parsed;
    if (parsed.mode === "until" && Number.isFinite(parsed.until) && parsed.until > Date.now()) {
      return parsed;
    }
  } catch {
    // Ignore malformed persisted preferences and fall back to prompting again.
  }

  window.localStorage.removeItem(PROJECT_CLUSTER_DELETE_PREF_KEY);
  return { mode: "always" };
}

function writeProjectClusterDeletePreference(preference: ProjectClusterDeletePreference) {
  if (typeof window === "undefined") return;
  if (preference.mode === "always") {
    window.localStorage.removeItem(PROJECT_CLUSTER_DELETE_PREF_KEY);
    return;
  }
  window.localStorage.setItem(PROJECT_CLUSTER_DELETE_PREF_KEY, JSON.stringify(preference));
}

function shouldSkipProjectClusterDeleteConfirm(preference: ProjectClusterDeletePreference) {
  if (preference.mode === "forever") return true;
  if (preference.mode === "until") return preference.until > Date.now();
  return false;
}

function resolveProjectClusterDeletePreference(
  option: ProjectClusterDeleteSnoozeOption,
): ProjectClusterDeletePreference {
  if (option === "forever") {
    return { mode: "forever" };
  }
  if (option === "always") {
    return { mode: "always" };
  }
  return {
    mode: "until",
    until: Date.now() + PROJECT_CLUSTER_DELETE_SNOOZE_MS[option],
  };
}

function buildGraphScopeKey(graph: KnowledgeGraphPayload) {
  const scope = graph.scope.scopeMode ?? graph.mode;
  const ids = graph.scope.projectIds?.length
    ? [...graph.scope.projectIds].sort().join(",")
    : graph.scope.projectId ?? "all";
  return `dialectica-graph-v3:${scope}:${graph.scope.locale}:${graph.scope.graphId ?? "base"}:${ids}`;
}

function formatGeneratedWithLabel(
  t: (key: string, values?: Record<string, string>) => string,
  graph: { generatedProviderId?: string; generatedModel?: string } | null | undefined,
) {
  const providerId = graph?.generatedProviderId?.trim();
  const model = graph?.generatedModel?.trim();
  if (!providerId) return null;
  const providerLabel = getProviderDescriptor(providerId as never)?.label ?? providerId;
  if (model) {
    return t("knowledge.generatedWith", { provider: providerLabel, model });
  }
  return t("knowledge.generatedWithProviderOnly", { provider: providerLabel });
}

function normalizeGraphViewMode(value: string | null | undefined): "2d" | "3d" | null {
  if (value === "2d" || value === "3d") return value;
  return null;
}

export function KnowledgeGraphView({
  locale,
  graph: rawGraph,
  defaultGraphMode = "2d",
  sampleProjectIds = [],
  activeUserGraph = null,
  canDeleteActiveUserGraph = false,
}: {
  locale: AppLocale;
  graph: KnowledgeGraphPayload;
  defaultGraphMode?: "2d" | "3d";
  sampleProjectIds?: string[];
  activeUserGraph?: {
    id: string;
    ownerIdentityId: string;
    title: string;
    description: string;
    visibility: "private" | "public";
    status: "pending" | "generating" | "ready" | "failed";
    errorMessage?: string;
    sourceProjectIds: string[];
    sourceProjectTitles: string[];
    generatedProviderId?: string;
    generatedModel?: string;
  } | null;
  canDeleteActiveUserGraph?: boolean;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const transformFrameRef = useRef<number | null>(null);
  const debugFollowerRef = useRef<HTMLDivElement | null>(null);
  const debugStatsRef = useRef({
    pointerX: null as number | null,
    pointerY: null as number | null,
    pointerCount: 0,
    frameCount: 0,
    longFrames32: 0,
    longFrames50: 0,
    lastPointerTime: 0,
    lastDelayMs: null as number | null,
    lastFrameMs: null as number | null,
    lastProbeTime: 0,
    elementTag: "-",
    elementClass: "-",
    elementData: "-",
    cursor: "-",
    dragging: false,
    listener: "-",
    pointerCapture: false,
    autoRotate: null as boolean | null,
    nodeCount: 0,
    relationCount: 0,
    layerWidth: null as number | null,
    layerHeight: null as number | null,
    bufferWidth: null as number | null,
    bufferHeight: null as number | null,
    dpr: null as number | null,
    lastTick: 0,
  });
  // ── Viewport state: ALL interaction uses refs only. React state synced on idle. ──
  const vp = useRef({ panX: KNOWLEDGE_GRAPH_DEFAULT_PAN_X, panY: KNOWLEDGE_GRAPH_DEFAULT_PAN_Y, zoom: 1 });
  const dragState = useRef<{ pid: number; mx0: number; my0: number; px0: number; py0: number; nodeId?: string; moved: boolean; painted: boolean } | null>(null);
  const dragCleanupRef = useRef<(() => void) | null>(null);
  const [activeNodeId, setActiveNodeId] = useState<string | undefined>(undefined);
  const [activeRelationId, setActiveRelationId] = useState<string | undefined>(undefined);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 40, y: 32 });
  const [focusMode, setFocusMode] = useState(false);
  const [graphNodeQuery, setGraphNodeQuery] = useState("");
  const graphModeFromUrl = normalizeGraphViewMode(searchParams.get("graphMode"));
  const debugGraphPointer = searchParams.get("debugGraphPointer") === "1";
  const [graphViewMode, setGraphViewMode] = useState<"2d" | "3d">(graphModeFromUrl ?? defaultGraphMode);
  const [viewStateReady, setViewStateReady] = useState(false);
  const [compareSelection, setCompareSelection] = useState<string[]>(() => rawGraph.scope.projectIds?.length ? [...rawGraph.scope.projectIds] : rawGraph.scope.projectId ? [rawGraph.scope.projectId] : []);
  const [editingNode, setEditingNode] = useState<{ id: string; title: string; summary: string; type: string } | null>(null);
  const [nodeActionBusy, setNodeActionBusy] = useState(false);
  const [nodeActionMessage, setNodeActionMessage] = useState<string | null>(null);
  const [graphActionBusy, setGraphActionBusy] = useState(false);
  const [graphActionMessage, setGraphActionMessage] = useState<string | null>(null);
  const [graphActionTone, setGraphActionTone] = useState<"success" | "danger">("danger");
  const [debugSnapshot, setDebugSnapshot] = useState<GraphPointerDebugSnapshot | null>(null);
  const [dragOverlayActive, setDragOverlayActive] = useState(false);
  const [projectClustersExpanded, setProjectClustersExpanded] = useState(false);
  const [selectedProjectIds, setSelectedProjectIds] = useState<string[]>([]);
  const setGraphViewModeWithUrl = useCallback((mode: "2d" | "3d") => {
    setGraphViewMode(mode);
    const params = new URLSearchParams(searchParams.toString());
    params.set("graphMode", mode);
    const query = params.toString();
    router.replace(`${pathname}${query ? `?${query}` : ""}`, { scroll: false });
  }, [pathname, router, searchParams]);

  useEffect(() => {
    const nextMode = graphModeFromUrl ?? defaultGraphMode;
    setGraphViewMode((current) => current === nextMode ? current : nextMode);
  }, [defaultGraphMode, graphModeFromUrl]);
  const [projectClusterDeletePreference, setProjectClusterDeletePreference] = useState<ProjectClusterDeletePreference>({ mode: "always" });
  const [projectClusterDeleteSnoozeOption, setProjectClusterDeleteSnoozeOption] = useState<ProjectClusterDeleteSnoozeOption>("always");
  const [projectClusterDeleteTarget, setProjectClusterDeleteTarget] = useState<{ projectIds: string[]; titles: string[] } | null>(null);
  // Auto-hide sample nodes when user has their own data
  const hasUserNodes = rawGraph.nodes.some((n) => !sampleProjectIds.includes(n.sourceProjectId));
  const [showSamples] = useState(!hasUserNodes);
  // Filter graph data based on sample visibility
  const graph = useMemo(() => {
    if (showSamples || sampleProjectIds.length === 0) return rawGraph;
    const filteredNodes = rawGraph.nodes.filter((n) => !sampleProjectIds.includes(n.sourceProjectId));
    const nodeIds = new Set(filteredNodes.map((n) => n.id));
    return {
      ...rawGraph,
      nodes: filteredNodes,
      relations: rawGraph.relations.filter((r) => nodeIds.has(r.sourceNodeId) && nodeIds.has(r.targetNodeId)),
      projects: rawGraph.projects.filter((p) => !sampleProjectIds.includes(p.projectId)),
      availableProjects: rawGraph.availableProjects,
    };
  }, [rawGraph, showSamples, sampleProjectIds]);

  const availableProjects = graph.availableProjects.length > 0 ? graph.availableProjects : graph.projects;
  const scopeKey = useMemo(() => buildGraphScopeKey(graph), [graph]);
  const activeUserGraphGenerating = activeUserGraph?.status === "pending" || activeUserGraph?.status === "generating";
  const activeUserGraphModelLabel = formatGeneratedWithLabel(t, activeUserGraph);
  const activeCrossGraphInfo = activeUserGraph && graph.mode === "cross-project" && activeUserGraph.sourceProjectIds.length > 1
    ? activeUserGraph
    : null;
  const recordDebugPointerEvent = useCallback((event: GraphPointerDebugEvent) => {
    if (!debugGraphPointer) return;
    const stats = debugStatsRef.current;
    const now = performance.now();
    stats.nodeCount = event.nodeCount ?? graph.nodes.length;
    stats.relationCount = event.relationCount ?? graph.relations.length;
    stats.layerWidth = event.layerWidth ?? canvasRef.current?.offsetWidth ?? stats.layerWidth;
    stats.layerHeight = event.layerHeight ?? canvasRef.current?.offsetHeight ?? stats.layerHeight;
    stats.bufferWidth = event.bufferWidth ?? stats.bufferWidth;
    stats.bufferHeight = event.bufferHeight ?? stats.bufferHeight;
    stats.dpr = event.dpr ?? stats.dpr;
    stats.listener = event.listener ?? stats.listener;
    stats.dragging = event.dragging ?? stats.dragging;
    stats.pointerCapture = event.pointerCapture ?? stats.pointerCapture;
    stats.autoRotate = event.autoRotate ?? stats.autoRotate;
    if (event.kind === "pointer") {
      stats.pointerCount += 1;
      stats.pointerX = event.clientX ?? stats.pointerX;
      stats.pointerY = event.clientY ?? stats.pointerY;
      stats.lastPointerTime = event.pointerTime ?? now;
      if (typeof event.clientX === "number" && typeof event.clientY === "number") {
        const follower = debugFollowerRef.current;
        if (follower) {
          follower.style.transform = `translate3d(${Math.round(event.clientX)}px, ${Math.round(event.clientY)}px, 0) translate(-50%, -50%)`;
        }
        if (now - stats.lastProbeTime > 140) {
          stats.lastProbeTime = now;
          const element = document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | SVGElement | null;
          if (element) {
            stats.elementTag = element.tagName.toLowerCase();
            const classAttr = typeof element.className === "string" ? element.className : element.getAttribute("class") ?? "";
            stats.elementClass = classAttr ? classAttr.slice(0, 120) : "-";
            const dataAttrs = Array.from(element.attributes)
              .filter((attr) => attr.name.startsWith("data-graph"))
              .map((attr) => `${attr.name}=${attr.value}`)
              .join(" ");
            stats.elementData = dataAttrs || "-";
            stats.cursor = window.getComputedStyle(element).cursor;
          } else {
            stats.elementTag = "-";
            stats.elementClass = "-";
            stats.elementData = "-";
            stats.cursor = "-";
          }
        }
      }
    } else {
      stats.frameCount += 1;
      const frameTime = event.frameTime ?? now;
      stats.lastFrameMs = event.durationMs ?? null;
      stats.lastDelayMs = stats.lastPointerTime > 0 ? frameTime - stats.lastPointerTime : null;
      if ((event.durationMs ?? 0) > 32) stats.longFrames32 += 1;
      if ((event.durationMs ?? 0) > 50) stats.longFrames50 += 1;
    }
  }, [debugGraphPointer, graph.nodes.length, graph.relations.length]);
  useEffect(() => {
    if (!debugGraphPointer) {
      setDebugSnapshot(null);
      return undefined;
    }
    debugStatsRef.current.lastTick = performance.now();
    const timer = window.setInterval(() => {
      const stats = debugStatsRef.current;
      const now = performance.now();
      const elapsed = Math.max(0.001, (now - stats.lastTick) / 1000);
      stats.lastTick = now;
      const snapshot: GraphPointerDebugSnapshot = {
        view: graphViewMode,
        dragging: graphViewMode === "2d" ? Boolean(dragState.current) : stats.dragging,
        pointerX: stats.pointerX,
        pointerY: stats.pointerY,
        pointerPerSecond: Math.round(stats.pointerCount / elapsed),
        framePerSecond: Math.round(stats.frameCount / elapsed),
        lastDelayMs: stats.lastDelayMs,
        lastFrameMs: stats.lastFrameMs,
        longFrames32: stats.longFrames32,
        longFrames50: stats.longFrames50,
        elementTag: stats.elementTag,
        elementClass: stats.elementClass,
        elementData: stats.elementData,
        cursor: stats.cursor,
        listener: stats.listener,
        pointerCapture: stats.pointerCapture,
        autoRotate: stats.autoRotate,
        nodeCount: stats.nodeCount || graph.nodes.length,
        relationCount: stats.relationCount || graph.relations.length,
        layerWidth: stats.layerWidth,
        layerHeight: stats.layerHeight,
        bufferWidth: stats.bufferWidth,
        bufferHeight: stats.bufferHeight,
        dpr: stats.dpr,
      };
      stats.pointerCount = 0;
      stats.frameCount = 0;
      setDebugSnapshot(snapshot);
    }, 500);
    return () => window.clearInterval(timer);
  }, [debugGraphPointer, graph.nodes.length, graph.relations.length, graphViewMode]);
  const projectClusterItems = useMemo(
    () => (graph.mode === "cross-project" ? [] : availableProjects),
    [availableProjects, graph.mode],
  );
  const visibleProjectClusterItems = useMemo(
    () => projectClustersExpanded ? projectClusterItems : projectClusterItems.slice(0, PROJECT_CLUSTER_PREVIEW_COUNT),
    [projectClusterItems, projectClustersExpanded],
  );
  const hasMoreProjectClusters = projectClusterItems.length > PROJECT_CLUSTER_PREVIEW_COUNT;
  const selectedProjectSet = useMemo(() => new Set(selectedProjectIds), [selectedProjectIds]);
  const selectedProjectItems = useMemo(
    () => projectClusterItems.filter((project) => selectedProjectSet.has(project.projectId)),
    [projectClusterItems, selectedProjectSet],
  );
  const projectClusterConfirmSuppressed = shouldSkipProjectClusterDeleteConfirm(projectClusterDeletePreference);

  const readErrorMessage = useCallback(async (response: Response) => {
    const payload = await response.json().catch(() => null) as { error?: string } | null;
    if (payload?.error) return payload.error;
    const text = await response.text().catch(() => "");
    return text || t("errors.unexpected");
  }, [t]);

  useEffect(() => {
    setProjectClusterDeletePreference(readProjectClusterDeletePreference());
  }, []);

  useEffect(() => {
    setSelectedProjectIds((current) => current.filter((projectId) => projectClusterItems.some((project) => project.projectId === projectId && project.canDelete)));
  }, [projectClusterItems]);

  const handleDeleteActiveGraph = useCallback(async () => {
    if (!activeUserGraph || !canDeleteActiveUserGraph) return;
    if (!window.confirm(t("knowledge.deleteGraphVersionConfirm"))) return;
    setGraphActionBusy(true);
    setGraphActionMessage(null);
    setGraphActionTone("danger");
    try {
      const response = await fetch(`/api/knowledge/user-graphs/${activeUserGraph.id}`, { method: "DELETE" });
      if (!response.ok) {
        throw new Error(await readErrorMessage(response));
      }
      let replacementGraphHref: string | null = null;
      try {
        const listResponse = await fetch("/api/knowledge/user-graphs", { cache: "no-store" });
        if (listResponse.ok) {
          const payload = await listResponse.json() as {
            graphs?: Array<{ id: string; status: "pending" | "generating" | "ready" | "failed"; updatedAt: string; sourceProjectIds: string[] }>;
          };
          const targetKey = buildUserGraphGroupKey(activeUserGraph.sourceProjectIds, activeUserGraph.id);
          const candidates = (payload.graphs ?? [])
            .filter((graph) => graph.id !== activeUserGraph.id)
            .filter((graph) => buildUserGraphGroupKey(graph.sourceProjectIds, graph.id) === targetKey)
            .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
          const replacement =
            candidates.find((graph) => graph.status === "ready")
            ?? candidates[0]
            ?? null;
          if (replacement) {
            replacementGraphHref = buildUserGraphVersionHref(locale, replacement);
          }
        }
      } catch {
        replacementGraphHref = null;
      }
      if (replacementGraphHref) {
        router.replace(replacementGraphHref);
      } else if (activeUserGraph.sourceProjectIds.length === 1) {
        router.replace(buildGraphHref(locale, { projectId: activeUserGraph.sourceProjectIds[0], scopeMode: "project" }));
      } else if (activeUserGraph.sourceProjectIds.length > 1) {
        router.replace(buildGraphHref(locale, { projectIds: activeUserGraph.sourceProjectIds, scopeMode: "cross-project" }));
      } else {
        router.replace(`/${locale}/knowledge`);
      }
      setGraphActionTone("success");
      setGraphActionMessage(t("knowledge.graphDeleted"));
      router.refresh();
    } catch (error) {
      setGraphActionTone("danger");
      setGraphActionMessage(error instanceof Error ? error.message : t("errors.unexpected"));
    } finally {
      setGraphActionBusy(false);
    }
  }, [activeUserGraph, canDeleteActiveUserGraph, locale, readErrorMessage, router, t]);

  const persistProjectClusterDeletePreference = useCallback((nextPreference: ProjectClusterDeletePreference) => {
    setProjectClusterDeletePreference(nextPreference);
    writeProjectClusterDeletePreference(nextPreference);
  }, []);

  const executeProjectClusterDelete = useCallback(async (
    target: { projectIds: string[]; titles: string[] },
    snoozeOption: ProjectClusterDeleteSnoozeOption = "always",
  ) => {
    if (target.projectIds.length === 0) return;
    if (snoozeOption !== "always") {
      persistProjectClusterDeletePreference(resolveProjectClusterDeletePreference(snoozeOption));
    }

    setGraphActionBusy(true);
    setGraphActionMessage(null);
    setGraphActionTone("danger");
    try {
      const results = await Promise.allSettled(
        target.projectIds.map(async (projectId) => {
          const response = await fetch(`/api/projects/${projectId}?locale=${encodeURIComponent(locale)}`, { method: "DELETE" });
          if (!response.ok) {
            throw new Error(await readErrorMessage(response));
          }
        }),
      );
      const firstFailure = results.find((result) => result.status === "rejected");
      if (firstFailure && firstFailure.status === "rejected") {
        throw firstFailure.reason;
      }

      const deletedIds = new Set(target.projectIds);
      setSelectedProjectIds((current) => current.filter((projectId) => !deletedIds.has(projectId)));
      setProjectClusterDeleteTarget(null);

      if (graph.scope.scopeMode === "project" && graph.scope.projectId && deletedIds.has(graph.scope.projectId)) {
        router.replace(buildGraphHref(locale, { scopeMode: "cross-project" }));
      } else if (graph.scope.scopeMode === "cross-project" && graph.scope.projectIds?.length) {
        const remainingIds = graph.scope.projectIds.filter((projectId) => !deletedIds.has(projectId));
        if (remainingIds.length === 1) {
          router.replace(buildGraphHref(locale, { projectId: remainingIds[0], scopeMode: "project" }));
        } else if (remainingIds.length > 1) {
          router.replace(buildGraphHref(locale, { projectIds: remainingIds, scopeMode: "cross-project" }));
        } else {
          router.replace(buildGraphHref(locale, { scopeMode: "cross-project" }));
        }
      }

      setGraphActionTone("success");
      setGraphActionMessage(
        target.projectIds.length === 1
          ? t("knowledge.projectClusterDeleted", { title: target.titles[0] ?? "" })
          : t("knowledge.projectClustersDeletedSelected", { count: String(target.projectIds.length) }),
      );
      router.refresh();
    } catch (error) {
      setGraphActionTone("danger");
      setGraphActionMessage(error instanceof Error ? error.message : t("errors.unexpected"));
    } finally {
      setGraphActionBusy(false);
      setProjectClusterDeleteTarget(null);
    }
  }, [graph.scope.projectId, graph.scope.projectIds, graph.scope.scopeMode, locale, persistProjectClusterDeletePreference, readErrorMessage, router, t]);

  const requestProjectClusterDelete = useCallback((target: { projectIds: string[]; titles: string[] }) => {
    if (target.projectIds.length === 0) return;
    if (projectClusterConfirmSuppressed) {
      void executeProjectClusterDelete(target);
      return;
    }
    setProjectClusterDeleteSnoozeOption("always");
    setProjectClusterDeleteTarget(target);
  }, [executeProjectClusterDelete, projectClusterConfirmSuppressed]);

  const toggleProjectClusterSelection = useCallback((projectId: string) => {
    setSelectedProjectIds((current) => current.includes(projectId)
      ? current.filter((candidate) => candidate !== projectId)
      : [...current, projectId]);
  }, []);

  useEffect(() => {
    if (!activeUserGraphGenerating) return undefined;
    const timer = window.setInterval(() => {
      router.refresh();
    }, 2500);
    return () => window.clearInterval(timer);
  }, [activeUserGraphGenerating, router]);

  // ── Single function to push ref state to CSS. No React state involved. ──
  const applyTransform = useCallback(() => {
    const c = canvasRef.current;
    if (!c) return;
    const start = debugGraphPointer ? performance.now() : 0;
    c.style.transform = `translate3d(${Math.round(vp.current.panX)}px, ${Math.round(vp.current.panY)}px, 0) scale(${vp.current.zoom.toFixed(3)})`;
    if (debugGraphPointer) {
      const end = performance.now();
      recordDebugPointerEvent({
        view: "2d",
        kind: "frame",
        phase: "apply",
        frameTime: start,
        durationMs: end - start,
        dragging: Boolean(dragState.current),
        listener: "transform-apply",
        pointerCapture: false,
        nodeCount: graph.nodes.length,
        relationCount: graph.relations.length,
        layerWidth: c.offsetWidth,
        layerHeight: c.offsetHeight,
      });
    }
  }, [debugGraphPointer, graph.nodes.length, graph.relations.length, recordDebugPointerEvent]);

  const scheduleTransform = useCallback(() => {
    if (typeof window === "undefined") {
      applyTransform();
      return;
    }
    if (transformFrameRef.current !== null) return;
    transformFrameRef.current = window.requestAnimationFrame(() => {
      transformFrameRef.current = null;
      applyTransform();
    });
  }, [applyTransform]);

  useEffect(() => () => {
    if (transformFrameRef.current !== null) {
      window.cancelAnimationFrame(transformFrameRef.current);
      transformFrameRef.current = null;
    }
  }, []);

  // Sync React state from refs (for UI display like zoom %). Called only on idle.
  const syncReactState = useCallback(() => {
    setZoom(vp.current.zoom);
    setPan({ x: vp.current.panX, y: vp.current.panY });
  }, []);


  useEffect(() => {
    if (typeof window === "undefined") return;
    const nextSelection = graph.scope.projectIds?.length ? [...graph.scope.projectIds] : graph.scope.projectId ? [graph.scope.projectId] : [];
    const frame = window.requestAnimationFrame(() => {
      setCompareSelection(nextSelection);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [graph.scope.projectId, graph.scope.projectIds]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    startTransition(() => setViewStateReady(false));
    const frame = window.requestAnimationFrame(() => {
      const raw = window.localStorage.getItem(scopeKey);
      if (raw) {
        try {
          const parsed = JSON.parse(raw) as { zoom?: number; pan?: { x?: number; y?: number } };
          vp.current.zoom = clamp(parsed.zoom ?? 1, 0.45, 3);
          vp.current.panX = parsed.pan?.x ?? KNOWLEDGE_GRAPH_DEFAULT_PAN_X;
          vp.current.panY = parsed.pan?.y ?? KNOWLEDGE_GRAPH_DEFAULT_PAN_Y;
        } catch { /* use defaults */ }
      } else {
        vp.current = { panX: KNOWLEDGE_GRAPH_DEFAULT_PAN_X, panY: KNOWLEDGE_GRAPH_DEFAULT_PAN_Y, zoom: 1 };
      }
      applyTransform();
      startTransition(() => { syncReactState(); setViewStateReady(true); });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [applyTransform, scopeKey, syncReactState]);

  useEffect(() => {
    if (typeof window === "undefined" || !viewStateReady) return undefined;
    const timer = window.setTimeout(() => {
      window.localStorage.setItem(scopeKey, JSON.stringify({ zoom, pan }));
    }, 180);
    return () => window.clearTimeout(timer);
  }, [scopeKey, viewStateReady, zoom, pan]);

  // Only clear stale references — do NOT auto-select when undefined (user deselected)
  useEffect(() => {
    if (!activeNodeId) return;
    if (graph.nodes.some((node) => node.id === activeNodeId)) return;
    startTransition(() => setActiveNodeId(undefined));
  }, [activeNodeId, graph.nodes]);

  useEffect(() => {
    if (!activeRelationId) return;
    if (graph.relations.some((relation) => relation.id === activeRelationId)) return;
    startTransition(() => setActiveRelationId(undefined));
  }, [activeRelationId, graph.relations]);

  const layout = useMemo(() => {
    const positions = new Map<string, { x: number; y: number; height: number }>();
    const relationCounts = new Map<string, number>();
    graph.relations.forEach((relation) => {
      relationCounts.set(relation.sourceNodeId, (relationCounts.get(relation.sourceNodeId) ?? 0) + 1);
      relationCounts.set(relation.targetNodeId, (relationCounts.get(relation.targetNodeId) ?? 0) + 1);
    });

    const visibleTypes = order.filter((type) => graph.nodes.some((node) => node.type === type));
    const lanes = visibleTypes.map((type, index) => {
      const laneNodes = graph.nodes
        .filter((node) => node.type === type)
        .sort((left, right) => {
          if (graph.mode === "cross-project" && left.sourceProjectTitle !== right.sourceProjectTitle) {
            return left.sourceProjectTitle.localeCompare(right.sourceProjectTitle);
          }
          const countDiff = (relationCounts.get(right.id) ?? 0) - (relationCounts.get(left.id) ?? 0);
          return countDiff !== 0 ? countDiff : left.title.localeCompare(right.title);
        });

      let cursorY = 110;
      let previousProjectId: string | undefined;
      const separators: Array<{ label: string; y: number }> = [];
      const lanePositions: Array<{ id: string; y: number; height: number }> = [];
      const x = 78 + index * columnGap;
      laneNodes.forEach((node) => {
        const height = estimateNodeHeight(node.title, node.summary);
        if (graph.mode === "cross-project" && previousProjectId && previousProjectId !== node.sourceProjectId) {
          cursorY += 52;
          separators.push({ label: node.sourceProjectTitle, y: cursorY - 22 });
        }
        lanePositions.push({ id: node.id, y: cursorY, height });
        cursorY += height + (graph.mode === "cross-project" ? 58 : 48) + Math.min(24, (relationCounts.get(node.id) ?? 0) * 3);
        previousProjectId = node.sourceProjectId;
      });

      return { type, x, count: laneNodes.length, separators, positions: lanePositions, height: cursorY + 40 };
    });

    const width = Math.max(980, visibleTypes.length * columnGap + 224);
    const height = Math.max(KNOWLEDGE_GRAPH_STAGE_MIN_HEIGHT_PX, ...lanes.map((lane) => lane.height));
    const adjustedLanes = lanes.map((lane) => {
      const slack = Math.max(0, height - lane.height);
      if (slack <= 0) {
        lane.positions.forEach((point) => {
          positions.set(point.id, { x: lane.x, y: point.y, height: point.height });
        });
        return { ...lane, positions: undefined };
      }

      const stretchFactor = clamp(KNOWLEDGE_GRAPH_LANE_STRETCH, 0.7, 0.98);
      const stretchBase = Math.max(1, lane.height - 150);
      lane.positions.forEach((point, pointIndex) => {
        const ratio = lane.positions.length <= 1
          ? 0.44
          : clamp(pointIndex / Math.max(1, lane.positions.length - 1), 0, 1);
        positions.set(point.id, {
          x: lane.x,
          y: point.y + slack * stretchFactor * ratio,
          height: point.height,
        });
      });

      return {
        ...lane,
        positions: undefined,
        separators: lane.separators.map((separator) => {
          const ratio = clamp((separator.y - 110) / stretchBase, 0, 1);
          return {
            ...separator,
            y: separator.y + slack * stretchFactor * ratio,
          };
        }),
      };
    });
    return { positions, lanes: adjustedLanes, width, height };
  }, [graph.mode, graph.nodes, graph.relations]);

  useEffect(() => {
    // Sync CSS when React state changes (e.g. from localStorage restore)
    if (!dragState.current) applyTransform();
  }, [applyTransform, layout.height, layout.width, pan, zoom]);

  const activeNode = activeNodeId ? graph.nodes.find((node) => node.id === activeNodeId) : undefined;
  const activeProject = graph.projects.find((project) => project.projectId === activeNode?.sourceProjectId) ?? graph.projects[0];

  // Viewport-based node culling for large graphs (100+ nodes).
  // Uses a debounced tick driven by refs (not React state) to avoid lag during rapid zoom.
  const NODE_CULL_THRESHOLD = 60;
  const VIEWPORT_PADDING = 400;
  const [viewportTick, setViewportTick] = useState(0);
  const viewportTickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bumpViewportTick = useCallback(() => {
    if (viewportTickTimer.current) clearTimeout(viewportTickTimer.current);
    viewportTickTimer.current = setTimeout(() => setViewportTick((t) => t + 1), 80);
  }, []);
  const [visibleNodeIds, setVisibleNodeIds] = useState<Set<string> | null>(null);
  useEffect(() => {
    void viewportTick;
    if (graph.nodes.length < NODE_CULL_THRESHOLD) { startTransition(() => setVisibleNodeIds(null)); return; }
    const viewport = viewportRef.current;
    if (!viewport) { startTransition(() => setVisibleNodeIds(null)); return; }
    const rect = viewport.getBoundingClientRect();
    const z = vp.current.zoom;
    const px = vp.current.panX;
    const py = vp.current.panY;
    const wl = (-px / z) - VIEWPORT_PADDING;
    const wt = (-py / z) - VIEWPORT_PADDING;
    const wr = ((rect.width - px) / z) + VIEWPORT_PADDING;
    const wb = ((rect.height - py) / z) + VIEWPORT_PADDING;
    const ids = new Set<string>();
    layout.positions.forEach((point, nodeId) => {
      if (point.x + nodeWidth >= wl && point.x <= wr && point.y + point.height >= wt && point.y <= wb) ids.add(nodeId);
    });
    startTransition(() => setVisibleNodeIds(ids));
  }, [graph.nodes.length, layout.positions, viewportTick]);

  const connectedNodeIds = useMemo(() => {
    const ids = new Set<string>();
    if (!activeNode) return ids;
    ids.add(activeNode.id);
    graph.relations.forEach((relation) => {
      if (relation.sourceNodeId === activeNode.id) ids.add(relation.targetNodeId);
      if (relation.targetNodeId === activeNode.id) ids.add(relation.sourceNodeId);
    });
    return ids;
  }, [activeNode, graph.relations]);

  const connectedRelations = useMemo(
    () => graph.relations.filter((relation) => relation.sourceNodeId === activeNode?.id || relation.targetNodeId === activeNode?.id),
    [activeNode, graph.relations],
  );
  const normalizedGraphNodeQuery = graphNodeQuery.trim().toLowerCase();
  const graphNodeMatches = useMemo(() => {
    if (!normalizedGraphNodeQuery) return [];
    return graph.nodes
      .filter((node) => {
        const haystack = [
          node.title,
          getRenderableNodeSummary(node, getNodeMetaLabels(node)),
          node.sourceProjectTitle,
          node.category,
          node.type,
          ...node.tags,
          ...node.topics,
        ].join(" ").toLowerCase();
        return haystack.includes(normalizedGraphNodeQuery);
      })
      .slice(0, 6);
  }, [graph.nodes, normalizedGraphNodeQuery]);
  const effectiveRelationId = graph.relations.some((relation) => relation.id === activeRelationId)
    ? activeRelationId
    : connectedRelations[0]?.id ?? graph.relations[0]?.id;
  const activeRelation = graph.relations.find((relation) => relation.id === effectiveRelationId);
  const hasGraphFocus = Boolean(activeNode);

  const relationMarkers = useMemo(() => {
    const buckets = new Map<string, number>();
    return graph.relations.flatMap((relation) => {
      const source = layout.positions.get(relation.sourceNodeId);
      const target = layout.positions.get(relation.targetNodeId);
      if (!source || !target) return [];
      const sourceY = source.y + source.height / 2;
      const targetY = target.y + target.height / 2;
      const midX = (source.x + nodeWidth + target.x) / 2;
      const midY = (sourceY + targetY) / 2;
      const bucketKey = `${Math.round(midX / 88)}:${Math.round(midY / 64)}`;
      const index = buckets.get(bucketKey) ?? 0;
      buckets.set(bucketKey, index + 1);
      const offset = relationMarkerOffsets[index % relationMarkerOffsets.length];
      return [{ relation, left: midX - 10 + offset.x, top: midY - 10 + offset.y }];
    });
  }, [graph.relations, layout.positions]);

  /* ════════════════════════════════════════════════════════════════
   *  DRAG + ZOOM — pure ref + CSS, zero setState during interaction
   * ════════════════════════════════════════════════════════════════ */

  // Zoom with anchor point (used by buttons and range slider only — not during drag)
  const zoomAtPoint = useCallback((nextZoom: number, anchorX: number, anchorY: number) => {
    const bounded = clamp(Number(nextZoom.toFixed(3)), 0.45, 3);
    const worldX = (anchorX - vp.current.panX) / vp.current.zoom;
    const worldY = (anchorY - vp.current.panY) / vp.current.zoom;
    vp.current.panX = anchorX - worldX * bounded;
    vp.current.panY = anchorY - worldY * bounded;
    vp.current.zoom = bounded;
    applyTransform();
  }, [applyTransform]);

  // Simple zoom without drag correction (for buttons)
  const zoomCenter = useCallback((factor: number) => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const rect = viewport.getBoundingClientRect();
    zoomAtPoint(vp.current.zoom * factor, rect.width / 2, rect.height / 2);
    syncReactState();
  }, [zoomAtPoint, syncReactState]);

  // Wheel handler — attached as native event for passive:false
  useEffect(() => {
    const el = viewportRef.current;
    if (!el || graphViewMode !== "2d") return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      recordDebugPointerEvent({
        view: "2d",
        kind: "pointer",
        phase: "wheel",
        clientX: e.clientX,
        clientY: e.clientY,
        pointerTime: performance.now(),
        dragging: Boolean(dragState.current),
        listener: "wheel",
        pointerCapture: false,
        nodeCount: graph.nodes.length,
        relationCount: graph.relations.length,
        layerWidth: canvasRef.current?.offsetWidth,
        layerHeight: canvasRef.current?.offsetHeight,
      });
      const rect = el.getBoundingClientRect();
      const ax = e.clientX - rect.left;
      const ay = e.clientY - rect.top;
      const step = Math.max(0.03, vp.current.zoom * 0.07);
      const next = vp.current.zoom + (e.deltaY < 0 ? step : -step);
      const bounded = clamp(Number(next.toFixed(3)), 0.45, 3);
      // Zoom with anchor
      const worldX = (ax - vp.current.panX) / vp.current.zoom;
      const worldY = (ay - vp.current.panY) / vp.current.zoom;
      vp.current.panX = ax - worldX * bounded;
      vp.current.panY = ay - worldY * bounded;
      vp.current.zoom = bounded;
      // If mid-drag, fix origin so drag stays continuous
      if (dragState.current) {
        const dx = e.clientX - dragState.current.mx0;
        const dy = e.clientY - dragState.current.my0;
        dragState.current.px0 = vp.current.panX - dx;
        dragState.current.py0 = vp.current.panY - dy;
      }
      applyTransform();
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, [graph.nodes.length, graph.relations.length, graphViewMode, applyTransform, recordDebugPointerEvent]);

  // Sync React state after interaction ends (for zoom badge display)
  const idleSyncRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleSync = useCallback(() => {
    if (idleSyncRef.current) clearTimeout(idleSyncRef.current);
    idleSyncRef.current = setTimeout(() => { syncReactState(); bumpViewportTick(); }, 600);
  }, [syncReactState, bumpViewportTick]);

  const resetView = useCallback(() => {
    vp.current = { panX: KNOWLEDGE_GRAPH_DEFAULT_PAN_X, panY: KNOWLEDGE_GRAPH_DEFAULT_PAN_Y, zoom: 1 };
    applyTransform();
    syncReactState();
    bumpViewportTick();
  }, [applyTransform, syncReactState, bumpViewportTick]);

  const focusGraphNode = useCallback((nodeId: string) => {
    setActiveNodeId(nodeId);
    setActiveRelationId(undefined);
    if (graphViewMode !== "2d" || !viewportRef.current) return;
    const point = layout.positions.get(nodeId);
    if (!point) return;
    const rect = viewportRef.current.getBoundingClientRect();
    const z = graph.mode === "project" ? 1.28 : 1.12;
    vp.current.panX = rect.width / 2 - (point.x + nodeWidth / 2) * z;
    vp.current.panY = rect.height / 3 - (point.y + point.height / 2) * z;
    vp.current.zoom = z;
    applyTransform();
    syncReactState();
    bumpViewportTick();
  }, [applyTransform, bumpViewportTick, graph.mode, graphViewMode, layout.positions, syncReactState]);

  const fitSelection = useCallback(() => {
    if (!activeNode) return;
    focusGraphNode(activeNode.id);
  }, [activeNode, focusGraphNode]);

  const handleNativePointerMove = useCallback((event: PointerEvent) => {
    const ds = dragState.current;
    if (!ds || ds.pid !== event.pointerId) return;
    recordDebugPointerEvent({
      view: "2d",
      kind: "pointer",
      phase: "move",
      clientX: event.clientX,
      clientY: event.clientY,
      pointerTime: performance.now(),
      dragging: true,
      listener: "document",
      pointerCapture: false,
      nodeCount: graph.nodes.length,
      relationCount: graph.relations.length,
      layerWidth: canvasRef.current?.offsetWidth,
      layerHeight: canvasRef.current?.offsetHeight,
    });
    const dx = event.clientX - ds.mx0;
    const dy = event.clientY - ds.my0;
    if (!ds.moved && Math.hypot(dx, dy) < 5) return;
    ds.moved = true;
    ds.nodeId = undefined;
    // Coalesce pointermove writes into one compositor-friendly transform per frame.
    vp.current.panX = ds.px0 + dx;
    vp.current.panY = ds.py0 + dy;
    if (!ds.painted) {
      ds.painted = true;
      if (transformFrameRef.current !== null) {
        window.cancelAnimationFrame(transformFrameRef.current);
        transformFrameRef.current = null;
      }
      applyTransform();
      return;
    }
    scheduleTransform();
  }, [applyTransform, graph.nodes.length, graph.relations.length, recordDebugPointerEvent, scheduleTransform]);

  const cleanupDragInput = useCallback(() => {
    if (dragCleanupRef.current) {
      dragCleanupRef.current();
      dragCleanupRef.current = null;
    }
    setGraphViewportDragging(viewportRef.current, false);
    setGraphInputDragging(false);
    setDragOverlayActive(false);
  }, []);

  const finishPointerDrag = useCallback((event?: (Pick<PointerEvent, "pointerId"> & Partial<Pick<PointerEvent, "clientX" | "clientY">>) | ReactPointerEvent<HTMLDivElement>, cancelled = false) => {
    const ds = dragState.current;
    if (!ds || (event && ds.pid !== event.pointerId)) return;
    recordDebugPointerEvent({
      view: "2d",
      kind: "pointer",
      phase: cancelled ? "cancel" : "up",
      clientX: event?.clientX,
      clientY: event?.clientY,
      pointerTime: performance.now(),
      dragging: false,
      listener: "document",
      pointerCapture: false,
      nodeCount: graph.nodes.length,
      relationCount: graph.relations.length,
      layerWidth: canvasRef.current?.offsetWidth,
      layerHeight: canvasRef.current?.offsetHeight,
    });
    dragState.current = null;
    cleanupDragInput();
    if (!cancelled && !ds.moved && ds.nodeId) {
      setActiveNodeId(ds.nodeId === activeNodeId ? undefined : ds.nodeId);
      setActiveRelationId(undefined);
    } else if (!cancelled && !ds.moved && !ds.nodeId) {
      setActiveNodeId(undefined);
      setActiveRelationId(undefined);
    }
    // Sync React state now that interaction ended
    if (transformFrameRef.current !== null) {
      window.cancelAnimationFrame(transformFrameRef.current);
      transformFrameRef.current = null;
    }
    applyTransform();
    syncReactState();
    bumpViewportTick();
    scheduleSync();
  }, [activeNodeId, applyTransform, bumpViewportTick, cleanupDragInput, graph.nodes.length, graph.relations.length, recordDebugPointerEvent, scheduleSync, syncReactState]);

  useEffect(() => () => {
    cleanupDragInput();
  }, [cleanupDragInput]);

  // ── Pointer handlers ──
  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest("[data-graph-stop='true']")) return;
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    recordDebugPointerEvent({
      view: "2d",
      kind: "pointer",
      phase: "down",
      clientX: event.clientX,
      clientY: event.clientY,
      pointerTime: performance.now(),
      dragging: true,
      listener: "react-pointerdown + document-drag-listeners",
      pointerCapture: false,
      nodeCount: graph.nodes.length,
      relationCount: graph.relations.length,
      layerWidth: canvasRef.current?.offsetWidth,
      layerHeight: canvasRef.current?.offsetHeight,
    });
    const nodeEl = (event.target as HTMLElement).closest<HTMLElement>("[data-graph-node-id]");
    dragState.current = {
      pid: event.pointerId,
      mx0: event.clientX,
      my0: event.clientY,
      px0: vp.current.panX,
      py0: vp.current.panY,
      nodeId: nodeEl?.dataset.graphNodeId,
      moved: false,
      painted: false,
    };
    cleanupDragInput();
    setDragOverlayActive(true);
    setGraphInputDragging(true);
    setGraphViewportDragging(event.currentTarget, true);
    const ownerDocument = event.currentTarget.ownerDocument;
    const ownerWindow = ownerDocument.defaultView;
    const handleNativePointerUp = (nativeEvent: PointerEvent) => finishPointerDrag(nativeEvent);
    const handleNativePointerCancel = (nativeEvent: PointerEvent) => finishPointerDrag(nativeEvent, true);
    const handleWindowBlur = () => finishPointerDrag(undefined, true);
    ownerDocument.addEventListener("pointermove", handleNativePointerMove, { passive: true });
    ownerDocument.addEventListener("pointerup", handleNativePointerUp, { passive: true });
    ownerDocument.addEventListener("pointercancel", handleNativePointerCancel, { passive: true });
    ownerWindow?.addEventListener("blur", handleWindowBlur, { passive: true });
    dragCleanupRef.current = () => {
      ownerDocument.removeEventListener("pointermove", handleNativePointerMove);
      ownerDocument.removeEventListener("pointerup", handleNativePointerUp);
      ownerDocument.removeEventListener("pointercancel", handleNativePointerCancel);
      ownerWindow?.removeEventListener("blur", handleWindowBlur);
    };
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    finishPointerDrag(event);
  };

  const hubHref = `/${locale}/knowledge${graph.scope.projectId ? `?projectId=${graph.scope.projectId}` : ""}`;
  const crossProjectHref = buildGraphHref(locale, { scopeMode: "cross-project" });
  const primaryProjectGraphId = graph.scope.projectId ?? graph.scope.projectIds?.[0] ?? availableProjects[0]?.projectId ?? graph.projects[0]?.projectId;
  const primaryProjectGraphHref = primaryProjectGraphId
    ? buildGraphHref(locale, { projectId: primaryProjectGraphId, scopeMode: "project" })
    : `/${locale}/knowledge/graph`;
  const relationSource = activeRelation ? graph.nodes.find((node) => node.id === activeRelation.sourceNodeId) : undefined;
  const relationTarget = activeRelation ? graph.nodes.find((node) => node.id === activeRelation.targetNodeId) : undefined;
  const graphViewportStyle: CSSProperties = focusMode
    ? { minHeight: "74vh", maxHeight: "74vh", height: "74vh" }
    : {
        minHeight: "44rem",
        height: "100%",
      };
  const toggleCompareProject = (projectId: string) => {
    setCompareSelection((current) => {
      const exists = current.includes(projectId);
      const next = exists ? current.filter((candidate) => candidate !== projectId) : [...current, projectId];
      if (graph.mode === "project" && graph.scope.projectId && !next.includes(graph.scope.projectId)) {
        return [graph.scope.projectId, ...next];
      }
      return [...new Set(next)];
    });
  };

  const applyCompareSelection = () => {
    const next = [...new Set(compareSelection.filter(Boolean))];
    if (next.length === 0) {
      router.replace(graph.scope.projectId ? buildGraphHref(locale, { projectId: graph.scope.projectId, scopeMode: "project" }) : crossProjectHref);
      return;
    }
    if (next.length === 1) {
      router.replace(buildGraphHref(locale, { projectId: next[0], scopeMode: "project" }));
      return;
    }
    router.replace(buildGraphHref(locale, { projectIds: next, scopeMode: "cross-project" }));
  };

  const restoreScopedSelection = () => {
    setCompareSelection(graph.scope.projectIds?.length ? [...graph.scope.projectIds] : graph.scope.projectId ? [graph.scope.projectId] : []);
  };

  return (
    <div className="space-y-7 animate-fade-up">
      <Panel className="hero-surface overflow-hidden p-5 sm:p-8 lg:p-10">
        <div className="grid gap-6 xl:grid-cols-[1.08fr_0.92fr] xl:items-end">
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <Badge tone="accent">{t("knowledge.graphTitle")}</Badge>
              <Badge>{t(graph.mode === "project" ? "knowledge.scopeProject" : "knowledge.scopeCrossProject")}</Badge>
              {graph.scope.projectId ? <Badge>{activeProject?.projectTitle ?? graph.scope.projectId}</Badge> : null}
              {graph.scope.projectIds?.length ? <Badge>{`${graph.scope.projectIds.length} ${t("knowledge.metrics.projects")}`}</Badge> : null}
            </div>
            <h1 className="font-display text-4xl font-semibold tracking-tight sm:text-5xl">{t("knowledge.graphTitle")}</h1>
            <p className="max-w-4xl text-sm leading-7 text-[color:var(--muted)] sm:text-base">{t("knowledge.graphSubtitle")}</p>
            <p className="max-w-4xl text-sm leading-7 text-[color:var(--muted)]">{t(graph.mode === "project" ? "knowledge.scopeProjectBody" : "knowledge.scopeCrossProjectBody")}</p>
            <div className="flex flex-wrap gap-3">
              <Link prefetch={false} href={hubHref} className="inline-flex items-center justify-center rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-4 py-2.5 text-sm font-semibold transition hover:bg-[color:var(--surface-hover)]">
                {t("knowledge.backToHub")}
              </Link>
              {graph.mode === "project" ? (
                <Link prefetch={false} href={crossProjectHref} className="inline-flex items-center justify-center rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-4 py-2.5 text-sm font-semibold transition hover:bg-[color:var(--surface-hover)]">
                  {t("knowledge.openCrossProjectGraph")}
                </Link>
              ) : (
                <Link prefetch={false} href={primaryProjectGraphHref} className="inline-flex items-center justify-center rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-4 py-2.5 text-sm font-semibold transition hover:bg-[color:var(--surface-hover)]">
                  {t("knowledge.scopeProject")}
                </Link>
              )}
            </div>
          </div>

          <div className="grid gap-4 rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface-strong)] p-5 shadow-panel">
            <div className="grid gap-4 sm:grid-cols-2">
              <div><p className="text-xs uppercase tracking-[0.18em] text-[color:var(--muted)]">{t("knowledge.metrics.nodes")}</p><p className="mt-2 text-3xl font-semibold">{graph.nodes.length}</p></div>
              <div><p className="text-xs uppercase tracking-[0.18em] text-[color:var(--muted)]">{t("knowledge.metrics.relations")}</p><p className="mt-2 text-3xl font-semibold">{graph.relations.length}</p></div>
            </div>
            <div className="graph-panel-surface rounded-2xl p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-[color:var(--muted)]">{t("knowledge.projectClustersTitle")}</p>
              <p className="mt-2 text-sm leading-6 text-[color:var(--muted)]">{t(graph.mode === "project" ? "knowledge.graphIsolatedHint" : "knowledge.graphCrossProjectHint")}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {graph.projects.slice(0, 5).map((project) => (
                  <Link prefetch={false} key={project.projectId} href={buildGraphHref(locale, { projectId: project.projectId, scopeMode: "project" })} className={`rounded-full border px-3 py-2 text-xs font-semibold transition ${graph.scope.projectId === project.projectId ? "border-[color:var(--brand-solid)] bg-[color:var(--brand-soft)] text-[color:var(--brand-ink)]" : "border-[color:var(--border)] bg-[color:var(--surface-muted)] hover:border-[color:var(--brand-solid)] hover:bg-[color:var(--surface-hover)]"}`}>
                    {project.projectTitle}
                  </Link>
                ))}
                {graph.mode === "project" ? (
                  <Link prefetch={false} href={crossProjectHref} className="rounded-full border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-3 py-2 text-xs font-semibold transition hover:border-[color:var(--brand-solid)] hover:bg-[color:var(--surface-hover)]">
                    {t("knowledge.crossProject")}
                  </Link>
                ) : (
                  <Link prefetch={false} href={primaryProjectGraphHref} className="rounded-full border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-3 py-2 text-xs font-semibold transition hover:border-[color:var(--brand-solid)] hover:bg-[color:var(--surface-hover)]">
                    {t("knowledge.scopeProject")}
                  </Link>
                )}
              </div>
            </div>
            {activeUserGraph && graph.mode !== "cross-project" ? (
              <div className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs uppercase tracking-[0.18em] text-[color:var(--muted)]">{t("knowledge.savedGraphLabel")}</p>
                    <p className="mt-2 truncate text-sm font-semibold">{activeUserGraph.title}</p>
                    {activeUserGraph.description ? (
                      <p className="mt-1 text-xs leading-5 text-[color:var(--muted)]">{activeUserGraph.description}</p>
                    ) : null}
                    {activeUserGraphModelLabel ? (
                      <p className="mt-1 text-[11px] leading-5 text-[color:var(--muted)]">{activeUserGraphModelLabel}</p>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                    <Badge>{activeUserGraph.visibility === "public" ? t("knowledge.visibilityPublic") : t("knowledge.visibilityPrivate")}</Badge>
                    {activeUserGraph.status === "ready" ? <Badge tone="accent">{t("knowledge.graphReady")}</Badge> : null}
                    {activeUserGraph.status === "pending" ? <Badge>{t("knowledge.graphPending")}</Badge> : null}
                    {activeUserGraph.status === "generating" ? <Badge>{t("knowledge.graphGenerating")}</Badge> : null}
                    {activeUserGraph.status === "failed" ? <Badge tone="danger">{t("knowledge.graphFailed")}</Badge> : null}
                    {canDeleteActiveUserGraph ? (
                      <Button variant="danger" className="h-8 px-3 text-xs" onClick={() => void handleDeleteActiveGraph()} disabled={graphActionBusy}>
                        <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                        {graphActionBusy ? `${t("common.loading")}...` : t("common.delete")}
                      </Button>
                    ) : null}
                  </div>
                </div>
                {activeUserGraphGenerating ? (
                  <div className="mt-3 rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-strong)] px-4 py-3 text-xs leading-6 text-[color:var(--muted)]">
                    {t("knowledge.graphGeneratingBody")}
                  </div>
                ) : null}
                {activeUserGraph.status === "failed" && activeUserGraph.errorMessage ? (
                  <div className="mt-3 rounded-xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-xs leading-6 text-rose-700 dark:text-rose-200">
                    {activeUserGraph.errorMessage}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      </Panel>

      {graphActionMessage ? (
        <p className={`text-sm ${graphActionTone === "success" ? "text-emerald-600 dark:text-emerald-300" : "text-rose-600 dark:text-rose-300"}`}>{graphActionMessage}</p>
      ) : null}
      {nodeActionMessage ? (
        <p className="text-sm text-rose-600 dark:text-rose-300">{nodeActionMessage}</p>
      ) : null}

      <div className={focusMode ? "space-y-6" : "grid gap-5 xl:min-h-[56rem] xl:grid-cols-[1.26fr_0.74fr] xl:items-stretch"}>
        <Panel className={graphViewMode === "2d" && !focusMode ? "flex h-full min-h-[38rem] flex-col overflow-hidden p-0 sm:min-h-[44rem] xl:min-h-[56rem]" : "h-full space-y-0 overflow-hidden p-0"}>
          {/* ── Row 1: Toolbar — all controls on one line ── */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[color:var(--border)] px-5 py-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex shrink-0 overflow-hidden rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-muted)]">
                <button type="button" onClick={() => setGraphViewModeWithUrl("2d")}
                  className={`whitespace-nowrap px-4 py-2 text-xs font-semibold transition ${graphViewMode === "2d" ? "bg-[color:var(--brand-solid)] text-white" : "text-[color:var(--muted)] hover:bg-[color:var(--surface-hover)]"}`}>
                  {t("knowledge.graphView2d")}
                </button>
                <button type="button" onClick={() => setGraphViewModeWithUrl("3d")}
                  className={`whitespace-nowrap px-4 py-2 text-xs font-semibold transition ${graphViewMode === "3d" ? "bg-[color:var(--brand-solid)] text-white" : "text-[color:var(--muted)] hover:bg-[color:var(--surface-hover)]"}`}>
                  {t("knowledge.graphView3d")}
                </button>
              </div>
              {graphViewMode === "2d" ? (
                <div className="flex items-center gap-0.5 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-muted)]/60 px-1 py-0.5">
                  <button type="button" onClick={() => zoomCenter(0.88)} className="flex h-6 w-6 items-center justify-center rounded text-[color:var(--muted)] transition hover:bg-[color:var(--surface-hover)] hover:text-[color:var(--foreground)]"><Minus className="h-3.5 w-3.5" /></button>
                  <span className="w-9 text-center text-[11px] font-semibold tabular-nums text-[color:var(--muted)]">{`${Math.round(zoom * 100)}%`}</span>
                  <button type="button" onClick={() => zoomCenter(1.12)} className="flex h-6 w-6 items-center justify-center rounded text-[color:var(--muted)] transition hover:bg-[color:var(--surface-hover)] hover:text-[color:var(--foreground)]"><Plus className="h-3.5 w-3.5" /></button>
                  <span className="mx-0.5 h-3.5 w-px bg-[color:var(--border)]" />
                  <button type="button" onClick={resetView} className="flex h-6 w-6 items-center justify-center rounded text-[color:var(--muted)] transition hover:bg-[color:var(--surface-hover)] hover:text-[color:var(--foreground)]" title={t("knowledge.graphResetView")}><RotateCcw className="h-3 w-3" /></button>
                  <button type="button" onClick={fitSelection} className="flex h-6 w-6 items-center justify-center rounded text-[color:var(--muted)] transition hover:bg-[color:var(--surface-hover)] hover:text-[color:var(--foreground)]" title={t("knowledge.graphFitSelection")}><LocateFixed className="h-3 w-3" /></button>
                </div>
              ) : null}
              <Button variant="ghost" className="h-8 shrink-0 whitespace-nowrap px-3 text-xs" onClick={() => setFocusMode((current) => !current)}>{focusMode ? t("knowledge.exitFocusMode") : t("knowledge.focusMode")}</Button>
              <div className="relative min-w-[14rem] flex-1 sm:max-w-sm">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[color:var(--muted)]" />
                <input
                  className="h-8 w-full rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-strong)] pl-9 pr-8 text-xs outline-none transition focus:border-[color:var(--brand-solid)]"
                  value={graphNodeQuery}
                  onChange={(event) => setGraphNodeQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && graphNodeMatches[0]) {
                      event.preventDefault();
                      focusGraphNode(graphNodeMatches[0].id);
                    }
                  }}
                  placeholder={t("knowledge.filters.searchPlaceholder")}
                  aria-label={t("knowledge.filters.search")}
                />
                {graphNodeQuery ? (
                  <button
                    type="button"
                    onClick={() => setGraphNodeQuery("")}
                    className="absolute right-2 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded text-[color:var(--muted)] transition hover:bg-[color:var(--surface-hover)] hover:text-[color:var(--foreground)]"
                    aria-label={t("project.timelineCard.clearFilters")}
                  >
                    <X className="h-3 w-3" />
                  </button>
                ) : null}
                {normalizedGraphNodeQuery ? (
                  <div className="absolute left-0 right-0 top-[calc(100%+0.4rem)] z-30 max-h-80 overflow-y-auto rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-strong)] p-2 shadow-xl">
                    {graphNodeMatches.length > 0 ? (
                      <div className="space-y-1">
                        <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[color:var(--muted)]">
                          {t("knowledge.resultsCount", { count: String(graphNodeMatches.length) })}
                        </p>
                        {graphNodeMatches.map((node) => (
                          <button
                            key={node.id}
                            type="button"
                            onClick={() => focusGraphNode(node.id)}
                            className="w-full rounded-lg px-2 py-2 text-left transition hover:bg-[color:var(--surface-hover)]"
                          >
                            <span className="block truncate text-xs font-semibold">{node.title}</span>
                            <span className="mt-0.5 block truncate text-[11px] text-[color:var(--muted)]">
                              {`${t(`knowledge.nodeTypes.${node.type}`)} / ${node.sourceProjectTitle}`}
                            </span>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <p className="px-2 py-2 text-xs text-[color:var(--muted)]">{t("knowledge.empty")}</p>
                    )}
                  </div>
                ) : null}
              </div>
            </div>
              <a href={buildGraphExportHref(locale, graph, activeUserGraph)} download={`knowledge-graph-${locale}.json`} className="inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-strong)] px-3 text-xs font-semibold text-[color:var(--foreground)] transition hover:bg-[color:var(--surface-hover)]">{t("knowledge.exportGraph")}</a>
          </div>

          {/* ── Row 2: Type badges + legend — same px-5, compact ── */}
          <div className="flex items-center justify-between gap-2 border-b border-[color:var(--border)] bg-[color:var(--surface-muted)]/40 px-5 py-2">
            <div className="flex flex-wrap items-center gap-1">
              {layout.lanes.map((lane) => <Badge key={lane.type}>{`${t(`knowledge.nodeTypes.${lane.type}`)} (${lane.count})`}</Badge>)}
              <Badge>{graph.mode === "project" ? t("knowledge.currentProjectOnly") : t("knowledge.compareSelection", { count: String(compareSelection.length || graph.scope.projectIds?.length || 0) })}</Badge>
            </div>
            <div className="flex shrink-0 items-center gap-2 text-[10px] text-[color:var(--muted)]">
              <span className="inline-flex items-center gap-1"><span className="block h-px w-3 bg-[color:var(--graph-connected)]" />{t("knowledge.graphLegendSolid")}</span>
              <span className="inline-flex items-center gap-1"><span className="block h-px w-3 border-t border-dashed border-[color:var(--graph-relation)]" />{t("knowledge.graphLegendDashed")}</span>
            </div>
          </div>

          {/* ── Row 3: Zoom slider (2D only) + compare projects ── */}
          <div className="px-5 py-3">
            {graphViewMode === "2d" ? (
              <div className="flex items-center gap-3 pb-3">
                <input type="range" min="45" max="300" step="1" value={Math.round(zoom * 100)} onChange={(event) => { const z = Number(event.target.value) / 100; const el = viewportRef.current; if (!el) return; const r = el.getBoundingClientRect(); zoomAtPoint(z, r.width / 2, r.height / 2); syncReactState(); }} className="h-1 w-full max-w-[16rem] accent-[color:var(--brand-solid)]" />
                <span className="text-[10px] tabular-nums text-[color:var(--muted)]">{`${Math.round(zoom * 100)}%`}</span>
              </div>
            ) : null}

            {availableProjects.length > 1 ? (
              <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-muted)]/50 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold">{t("knowledge.compareProjectsTitle")}</h3>
                    <p className="mt-0.5 text-xs leading-5 text-[color:var(--muted)]">{t(graph.mode === "project" ? "knowledge.selectionHintProject" : "knowledge.selectionHintCrossProject")}</p>
                  </div>
                  <div className="flex shrink-0 gap-1.5">
                    <Badge>{t("knowledge.compareSelection", { count: String(compareSelection.length) })}</Badge>
                    <Badge>{graph.mode === "project" ? t("knowledge.currentProjectOnly") : t("knowledge.scopeCrossProject")}</Badge>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {availableProjects.map((project) => {
                    const selected = compareSelection.includes(project.projectId);
                    return (
                      <button
                        key={project.projectId}
                        type="button"
                        data-graph-stop="true"
                        onClick={() => toggleCompareProject(project.projectId)}
                        className={`rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold transition ${selected ? "border-[color:var(--brand-solid)] bg-[color:var(--brand-solid)] text-white" : "border-[color:var(--border)] bg-[color:var(--surface-soft)] text-[color:var(--foreground)] hover:border-[color:var(--brand-solid)]/50"}`}
                      >
                        {project.projectTitle}
                      </button>
                    );
                  })}
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <Button variant="ghost" className="h-7 px-3 text-[11px]" onClick={applyCompareSelection}>{t("common.apply")}</Button>
                  <Button variant="ghost" className="h-7 px-3 text-[11px]" onClick={restoreScopedSelection}>{t("knowledge.clearSelection")}</Button>
                </div>
              </div>
            ) : null}
          </div>

        <div className={graphViewMode === "2d" && !focusMode ? "relative flex min-h-[34rem] flex-1 sm:min-h-[44rem]" : "relative"}>
{/* -- 2D / 3D crossfade: both views always mounted -- */}
          <div
            style={{
              opacity: graphViewMode === "2d" ? 1 : 0,
              pointerEvents: graphViewMode === "2d" ? "auto" : "none",
              transition: "opacity 300ms ease-in-out",
              position: graphViewMode === "2d" ? "relative" : "absolute",
              inset: graphViewMode === "2d" ? undefined : 0,
              height: graphViewMode === "2d" && !focusMode ? "100%" : undefined,
              width: graphViewMode === "2d" && !focusMode ? "100%" : undefined,
            }}
          >
          <div
            ref={viewportRef}
            data-graph-viewport="2d"
            className={`animate-scale-in graph-grid soft-scrollbar relative select-none ${focusMode ? "h-[68svh] sm:h-[74vh]" : "h-full min-h-[34rem] sm:min-h-[44rem]"} overflow-hidden rounded-[1.9rem] border border-[color:var(--border)] bg-[color:var(--graph-canvas)] cursor-grab active:cursor-grabbing`}
            style={{ ...graphViewportStyle, overscrollBehavior: "contain", touchAction: "none", WebkitUserSelect: "none", contain: "layout paint style", isolation: "isolate" }}
            draggable={false}
            onDragStart={(event) => event.preventDefault()}
            onPointerDown={handlePointerDown}
            onPointerUp={handlePointerUp}
            onPointerCancel={(event) => finishPointerDrag(event, true)}
            onLostPointerCapture={(event) => finishPointerDrag(event, true)}
          >
            <div ref={canvasRef} className="graph-canvas-layer pointer-events-none absolute left-0 top-0" draggable={false} style={{ width: layout.width, height: layout.height, transformOrigin: "0 0" }}>
              {layout.lanes.map((lane) => (
                <div
                  key={lane.type}
                  className="graph-lane-surface pointer-events-none absolute rounded-[1.7rem] p-4"
                  style={{
                    left: lane.x - 24,
                    top: KNOWLEDGE_GRAPH_STAGE_TOP_PADDING_PX,
                    width: nodeWidth + 48,
                    height: layout.height - KNOWLEDGE_GRAPH_STAGE_TOP_PADDING_PX - KNOWLEDGE_GRAPH_STAGE_BOTTOM_PADDING_PX,
                  }}
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--muted)]">{t(`knowledge.nodeTypes.${lane.type}`)}</p>
                    <Badge>{lane.count}</Badge>
                  </div>
                  {lane.separators.map((separator) => (
                    <div key={`${lane.type}-${separator.label}-${separator.y}`} className="pointer-events-none absolute left-5 right-5 border-t border-dashed border-[color:var(--border)] opacity-70" style={{ top: separator.y }} />
                  ))}
                </div>
              ))}

              <svg width={layout.width} height={layout.height} className="pointer-events-none absolute left-0 top-0 overflow-visible">
                <defs>
                  <filter id="graph-edge-glow" x="-20%" y="-20%" width="140%" height="140%">
                    <feGaussianBlur stdDeviation="3" result="blur" />
                    <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
                  </filter>
                </defs>
                {graph.relations.map((relation) => {
                  const source = layout.positions.get(relation.sourceNodeId);
                  const target = layout.positions.get(relation.targetNodeId);
                  if (!source || !target) return null;
                  const sourceY = source.y + source.height / 2;
                  const targetY = target.y + target.height / 2;
                  const isActive = relation.id === effectiveRelationId;
                  const isConnected = relation.sourceNodeId === activeNode?.id || relation.targetNodeId === activeNode?.id;
                  const cpOffset = Math.min(80, Math.abs(target.x - source.x) * 0.25 + 30);
                  const pathD = `M ${source.x + nodeWidth} ${sourceY} C ${source.x + nodeWidth + cpOffset} ${sourceY}, ${target.x - cpOffset} ${targetY}, ${target.x} ${targetY}`;
                  return (
                    <g key={relation.id}>
                      {(isActive || isConnected) && (
                        <path
                          d={pathD} fill="none"
                          style={{ stroke: isActive ? "var(--graph-active-glow)" : "var(--graph-connected)" }}
                          strokeWidth={isActive ? "6" : "4"} strokeLinecap="round"
                          opacity={isActive ? 0.3 : 0.15} filter="url(#graph-edge-glow)"
                        />
                      )}
                      <path
                        d={pathD} fill="none"
                        style={{ stroke: isActive ? "var(--graph-active)" : isConnected ? "var(--graph-connected)" : "var(--graph-relation)" }}
                        strokeWidth={isActive ? "2.5" : isConnected ? "2" : "1.5"}
                        strokeLinecap="round"
                        strokeDasharray={relation.type === "unresolved_with" ? "6 5" : undefined}
                        opacity={hasGraphFocus ? (isConnected || isActive ? 1 : 0.65) : 0.8}
                      />
                    </g>
                  );
                })}
              </svg>

              {relationMarkers.map(({ relation, left, top }) => {
                const isActive = relation.id === effectiveRelationId;
                const isConnected = relation.sourceNodeId === activeNode?.id || relation.targetNodeId === activeNode?.id;
                // Cull off-viewport relation markers
                if (visibleNodeIds && !isActive && !isConnected && !visibleNodeIds.has(relation.sourceNodeId) && !visibleNodeIds.has(relation.targetNodeId)) return null;
                return (
                  <div key={`${relation.id}-marker`} className="absolute z-20" style={{ left, top }}>
                    <button
                      type="button"
                      data-graph-stop="true"
                      onClick={() => { setActiveRelationId(relation.id); setActiveNodeId(relation.sourceNodeId); }}

                      className={`graph-interactive pointer-events-auto flex h-4 w-4 items-center justify-center rounded-full border transition-[border-color,background-color,opacity,transform] duration-150 hover:scale-150 ${isActive ? "graph-marker-active" : isConnected ? "graph-marker-connected" : "border-[color:var(--border)] bg-[color:var(--surface-strong)]/56 opacity-50"}`}
                      aria-label={`${t(`knowledge.relationTypes.${relation.type}`)} / ${relation.note}`}
                      title={`${t(`knowledge.relationTypes.${relation.type}`)}: ${relation.note}`}
                      draggable={false}
                    >
                      <span className={isActive ? "graph-marker-dot-active" : isConnected ? "graph-marker-dot-connected" : "h-0.5 w-0.5 rounded-full bg-[color:var(--muted)]/26"} />
                      <span className="sr-only">{t(`knowledge.relationTypes.${relation.type}`)}</span>
                    </button>
                    {isActive ? (
                      <div className="graph-floating-surface pointer-events-none absolute bottom-full left-1/2 mb-2 -translate-x-1/2 z-30 w-56 rounded-xl border border-[color:var(--graph-active-ring)] p-3 text-left shadow-lg">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[color:var(--brand-solid)]">
                          {t(`knowledge.relationTypes.${relation.type}`)}
                        </p>
                        {relation.note ? (
                          <p className="mt-1.5 line-clamp-3 text-[11px] leading-4 text-[color:var(--foreground)]">{relation.note}</p>
                        ) : null}
                        <div className="mt-2 flex flex-wrap gap-1">
                          <Badge>{graph.nodes.find((n) => n.id === relation.sourceNodeId)?.title?.slice(0, 20) ?? "?"}</Badge>
                          <span className="text-[10px] text-[color:var(--muted)]">{"\u2192"}</span>
                          <Badge>{graph.nodes.find((n) => n.id === relation.targetNodeId)?.title?.slice(0, 20) ?? "?"}</Badge>
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })}

              {graph.nodes.map((node) => {
                const point = layout.positions.get(node.id);
                if (!point) return null;
                const isActive = activeNode?.id === node.id;
                const isConnected = !activeNode || connectedNodeIds.has(node.id);
                // Viewport culling: skip nodes outside visible area (unless active/connected)
                if (visibleNodeIds && !isActive && !isConnected && !visibleNodeIds.has(node.id)) return null;
                const metaLabels = getNodeMetaLabels(node);
                const summaryText = getRenderableNodeSummary(node, metaLabels);
                return (
                  <div
                    key={node.id}
                    role="button"
                    tabIndex={isActive ? 0 : -1}
                    data-graph-node-id={node.id}
                    draggable={false}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setActiveNodeId(node.id);
                      }
                    }}
                    style={{ left: point.x, top: point.y, width: nodeWidth, minHeight: point.height, "--graph-active-ring": NODE_TYPE_RING_COLORS[node.type] ?? "rgba(148,163,184,0.45)", "--graph-active-glow": NODE_TYPE_GLOW_COLORS[node.type] ?? "rgba(148,163,184,0.12)" } as CSSProperties}
                    className={`graph-interactive graph-node-surface absolute rounded-[1.55rem] border p-4 text-left shadow-[0_4px_24px_rgba(0,0,0,0.06)] transition-[border-color,background-color,box-shadow] duration-150 ${nodeTone(node.type)} ${isActive ? "z-20 graph-node-active" : isConnected ? "z-10" : hasGraphFocus ? "z-0" : "z-10"}`}
                  >
                    <div className="pointer-events-none relative min-h-full">
                      <aside className="absolute right-0 top-0 flex w-[10rem] min-w-0 flex-col items-end gap-1.5 text-right">
                        <span className="inline-flex w-full items-start justify-end self-end rounded-[1rem] border border-[color:var(--border)] bg-[color:var(--graph-float)] px-2.5 py-1 text-[10px] font-semibold leading-4 text-[color:var(--muted)] line-clamp-2 [overflow-wrap:anywhere] break-words text-right">{t(`knowledge.categories.${node.category}`)}</span>
                        {metaLabels.map((label) => (
                          <span
                            key={`${node.id}-${label}`}
                            title={label}
                            className="inline-flex w-full items-start justify-end self-end rounded-[1rem] border border-[color:var(--border)] bg-[color:var(--graph-float)] px-2.5 py-1 text-[10px] font-semibold leading-4 text-[color:var(--muted)] line-clamp-2 [overflow-wrap:anywhere] break-words text-right"
                          >
                            {label}
                          </span>
                        ))}
                      </aside>
                      <div className="min-w-0 space-y-3 pr-[11.25rem]">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[color:var(--muted)]">{t(`knowledge.nodeTypes.${node.type}`)}</p>
                        <div className="min-w-0 space-y-2">
                          <h3 className="line-clamp-3 text-[15px] font-semibold leading-5 [word-break:break-word]">{node.title}</h3>
                          {summaryText ? <p className="line-clamp-4 text-xs leading-5 text-[color:var(--muted)] [word-break:break-word]">{summaryText}</p> : null}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="graph-floating-surface pointer-events-none absolute bottom-4 right-4 inline-flex items-center gap-2 rounded-full px-3 py-2 text-xs font-semibold text-[color:var(--muted)] shadow-lg">
              <Move className="h-4 w-4" />
              {t("knowledge.graphWheelHint")}
            </div>
          </div>
          </div>
          <div
            style={{
              opacity: graphViewMode === "3d" ? 1 : 0,
              pointerEvents: graphViewMode === "3d" ? "auto" : "none",
              transition: "opacity 300ms ease-in-out",
              position: graphViewMode === "3d" ? "relative" : "absolute",
              inset: graphViewMode === "3d" ? undefined : 0,
            }}
          >
            <KnowledgeGraph3DView
              key={`graph3d:${scopeKey}`}
              graph={graph}
              active={graphViewMode === "3d"}
              activeNodeId={activeNode?.id}
              activeRelationId={effectiveRelationId}
              focusMode={focusMode}
              debugGraphPointer={debugGraphPointer}
              onDebugGraphPointer={recordDebugPointerEvent}
              onSelectNode={(nodeId) => {
                if (!nodeId) { setActiveNodeId(undefined); setActiveRelationId(undefined); }
                else {
                  // Toggle: click same node again to deselect
                  const next = nodeId === activeNodeId ? undefined : nodeId;
                  setActiveNodeId(next);
                  setActiveRelationId(undefined);
                }
              }}
              onSelectRelation={(relationId, nodeId) => {
                setActiveRelationId(relationId);
                setActiveNodeId(nodeId);
              }}
            />
          </div>
        </div>
        </Panel>

        <div className={focusMode ? "grid gap-5 lg:grid-cols-3" : "flex h-full flex-col gap-5"}>
          <div>
          <div style={{ minHeight: `${KNOWLEDGE_GRAPH_NODE_FOCUS_MIN_REM}rem` }}>
          <Panel className="flex flex-1 flex-col space-y-4 p-5">
            {activeNode ? (
              <>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex flex-wrap gap-1.5">
                    <Badge tone="accent">{t(`knowledge.nodeTypes.${activeNode.type}`)}</Badge>
                    <Badge>{t(`knowledge.categories.${activeNode.category}`)}</Badge>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <button type="button" onClick={() => setEditingNode({ id: activeNode.id, title: activeNode.title, summary: getRenderableNodeSummary(activeNode, getNodeMetaLabels(activeNode)), type: activeNode.type })} className="flex h-6 w-6 items-center justify-center rounded text-[color:var(--muted)] transition hover:bg-[color:var(--surface-hover)] hover:text-[color:var(--foreground)]" title={t("common.edit")}><Pencil className="h-3 w-3" /></button>
                    <button type="button" disabled={nodeActionBusy} onClick={async () => {
                      if (!window.confirm(t("knowledge.deleteNodeConfirm"))) return;
                      setNodeActionBusy(true);
                      setNodeActionMessage(null);
                      try {
                        const response = await fetch(`/api/knowledge/${encodeURIComponent(activeNode.id)}?locale=${locale}`, { method: "DELETE" });
                        if (!response.ok) {
                          throw new Error(await readErrorMessage(response));
                        }
                        router.refresh();
                        setActiveNodeId(undefined);
                      } catch (error) {
                        setNodeActionMessage(error instanceof Error ? error.message : t("errors.unexpected"));
                      } finally {
                        setNodeActionBusy(false);
                      }
                    }} className="flex h-6 w-6 items-center justify-center rounded text-red-500 transition hover:bg-red-500/10" title={t("common.delete")}><Trash2 className="h-3 w-3" /></button>
                    <Link prefetch={false} href={`/${locale}/knowledge/${encodeURIComponent(activeNode.id)}`} className="text-xs font-semibold text-[color:var(--brand-solid)]">
                      {t("knowledge.viewDetail")}
                    </Link>
                  </div>
                </div>
                <div>
                  <h2 className="font-display text-lg font-semibold leading-snug">{activeNode.title}</h2>
                  {getRenderableNodeSummary(activeNode, getNodeMetaLabels(activeNode)) ? <p className="mt-1.5 text-sm leading-6 text-[color:var(--muted)]">{getRenderableNodeSummary(activeNode, getNodeMetaLabels(activeNode))}</p> : null}
                </div>
                <div className="flex items-center gap-3 rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-4 py-3">
                  <div className="flex-1">
                    <p className="text-[11px] uppercase tracking-[0.14em] text-[color:var(--muted)]">{t("knowledge.sourceProject")}</p>
                    <Link prefetch={false} href={`/${locale}/projects/${activeNode.sourceProjectId}`} className="mt-1 inline-flex text-sm font-semibold text-[color:var(--brand-solid)]">
                      {activeNode.sourceProjectTitle}
                    </Link>
                  </div>
                  <div className="border-l border-[color:var(--border)] pl-3">
                    <p className="text-[11px] uppercase tracking-[0.14em] text-[color:var(--muted)]">{t("knowledge.connectedRelations")}</p>
                    <p className="mt-1 text-xl font-semibold">{connectedRelations.length}</p>
                  </div>
                </div>
                {activeNode.topics.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {activeNode.topics.map((topic) => <Badge key={topic}>{topic}</Badge>)}
                  </div>
                ) : null}
                <div className="space-y-2">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[color:var(--muted)]">{t("knowledge.connectedRelations")}</p>
                  {connectedRelations.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-[color:var(--border)] px-4 py-3 text-xs text-[color:var(--muted)]">{t("knowledge.empty")}</div>
                  ) : connectedRelations.slice(0, 6).map((relation) => {
                    const counterpartId = relation.sourceNodeId === activeNode.id ? relation.targetNodeId : relation.sourceNodeId;
                    const counterpart = graph.nodes.find((node) => node.id === counterpartId);
                    const selected = relation.id === effectiveRelationId;
                    return (
                      <button key={relation.id} type="button" className={`w-full rounded-xl border px-3.5 py-3 text-left transition ${selected ? "border-[color:var(--brand-solid)] bg-[color:var(--brand-soft)] text-[color:var(--brand-ink)]" : "border-[color:var(--border)] bg-[color:var(--graph-panel)] hover:border-[color:var(--brand-solid)]/50"}`} onClick={() => setActiveRelationId(relation.id)}>
                        <div className="flex flex-wrap gap-1.5">
                          <Badge tone="accent">{t(`knowledge.relationTypes.${relation.type}`)}</Badge>
                          {counterpart ? <span className="text-xs font-semibold">{counterpart.title}</span> : null}
                        </div>
                        {relation.note ? <p className="mt-1.5 line-clamp-2 text-xs leading-5 text-[color:var(--muted)]">{relation.note}</p> : null}
                      </button>
                    );
                  })}
                </div>
              </>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="accent">{t(graph.mode === "project" ? "knowledge.scopeProject" : "knowledge.scopeCrossProject")}</Badge>
                  {graph.mode === "project" && activeProject ? <Badge>{activeProject.projectTitle}</Badge> : null}
                  {activeCrossGraphInfo ? <Badge>{t("knowledge.savedGraphLabel")}</Badge> : null}
                  {activeUserGraphModelLabel ? <Badge>{activeUserGraphModelLabel}</Badge> : null}
                </div>
                <div>
                  <h2 className="font-display text-lg font-semibold leading-snug">
                    {graph.mode === "project"
                      ? (activeProject?.projectTitle ?? t("knowledge.scopeProject"))
                      : (activeCrossGraphInfo?.title ?? t("knowledge.crossProject"))}
                  </h2>
                  <p className="mt-1.5 text-sm leading-6 text-[color:var(--muted)]">
                    {activeCrossGraphInfo?.description || t(graph.mode === "project" ? "knowledge.scopeProjectBody" : "knowledge.scopeCrossProjectBody")}
                  </p>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-4 py-3">
                    <p className="text-[10px] uppercase tracking-[0.14em] text-[color:var(--muted)]">{t("knowledge.metrics.nodes")}</p>
                    <p className="mt-1 text-sm font-semibold">{graph.nodes.length}</p>
                  </div>
                  <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-4 py-3">
                    <p className="text-[10px] uppercase tracking-[0.14em] text-[color:var(--muted)]">{t("knowledge.metrics.relations")}</p>
                    <p className="mt-1 text-sm font-semibold">{graph.relations.length}</p>
                  </div>
                </div>
                {activeCrossGraphInfo ? (
                  <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-4 py-3">
                    <p className="text-[10px] uppercase tracking-[0.14em] text-[color:var(--muted)]">{t("knowledge.sourceProject")}</p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {(activeCrossGraphInfo.sourceProjectTitles.length > 0
                        ? activeCrossGraphInfo.sourceProjectTitles
                        : graph.projects.map((project) => project.projectTitle)
                      ).map((title) => (
                        <Badge key={title}>{title}</Badge>
                      ))}
                    </div>
                  </div>
                ) : null}
                <div className="rounded-xl border border-dashed border-[color:var(--border)] px-4 py-6 text-center text-xs leading-6 text-[color:var(--muted)]">
                  {t("knowledge.nodeFocusIdleHint")}
                </div>
              </>
            )}
          </Panel>
          </div>
          </div>

          <div>
          <div style={{ minHeight: `${KNOWLEDGE_GRAPH_RELATION_INSPECTOR_MIN_REM}rem` }}>
          <Panel className="space-y-4 p-5">
            <div>
              <h2 className="text-sm font-semibold">{t("knowledge.relationInspectorTitle")}</h2>
              <p className="mt-0.5 text-xs leading-5 text-[color:var(--muted)]">{t("knowledge.relationInspectorBody")}</p>
            </div>
            {activeRelation && relationSource && relationTarget ? (
              <div className="space-y-3">
                <div className="flex flex-wrap gap-1.5">
                  <Badge tone="accent">{t(`knowledge.relationTypes.${activeRelation.type}`)}</Badge>
                  <Badge>{relationSource.title}</Badge>
                  <Badge>{relationTarget.title}</Badge>
                </div>
                <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-4 py-3">
                  <p className="text-[10px] uppercase tracking-[0.14em] text-[color:var(--muted)]">{t("knowledge.relationTypeLabel")}</p>
                  <p className="mt-1 text-sm font-semibold">{t(`knowledge.relationTypes.${activeRelation.type}`)}</p>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-4 py-3">
                    <p className="text-[10px] uppercase tracking-[0.14em] text-[color:var(--muted)]">{t("knowledge.relationSourceLabel")}</p>
                    <p className="mt-1 text-sm font-semibold">{relationSource.title}</p>
                  </div>
                  <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-4 py-3">
                    <p className="text-[10px] uppercase tracking-[0.14em] text-[color:var(--muted)]">{t("knowledge.relationTargetLabel")}</p>
                    <p className="mt-1 text-sm font-semibold">{relationTarget.title}</p>
                  </div>
                </div>
                <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-4 py-3">
                  <p className="text-[10px] uppercase tracking-[0.14em] text-[color:var(--muted)]">{t("knowledge.relationReasonLabel")}</p>
                  <p className="mt-1 text-sm leading-6 text-[color:var(--foreground)]">{activeRelation.note}</p>
                  <p className="mt-2 text-[10px] leading-4 text-[color:var(--muted)]">{t("knowledge.relationDerivedLabel")}</p>
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-[color:var(--border)] px-4 py-6 text-center text-xs text-[color:var(--muted)]">{t("knowledge.relationInspectorEmpty")}</div>
            )}
          </Panel>
          </div>
          </div>

          <div>
          <div style={{ minHeight: `${KNOWLEDGE_GRAPH_PROJECT_CLUSTERS_MIN_REM}rem` }}>
          <Panel className="space-y-4 p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold">{t("knowledge.projectClustersTitle")}</h2>
                <p className="mt-0.5 text-xs leading-5 text-[color:var(--muted)]">{t(graph.mode === "project" ? "knowledge.graphIsolatedHint" : "knowledge.graphCrossProjectHint")}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {projectClusterConfirmSuppressed ? (
                  <Button
                    variant="ghost"
                    className="h-8 px-3 text-xs"
                    onClick={() => {
                      persistProjectClusterDeletePreference({ mode: "always" });
                      setGraphActionTone("success");
                      setGraphActionMessage(t("knowledge.projectClustersDeleteConfirmRestored"));
                    }}
                  >
                    {t("knowledge.projectClustersRestoreDeleteConfirm")}
                  </Button>
                ) : null}
                {hasMoreProjectClusters ? (
                  <Button
                    variant="ghost"
                    className="h-8 px-3 text-xs"
                    onClick={() => setProjectClustersExpanded((current) => !current)}
                  >
                    {projectClustersExpanded
                      ? t("knowledge.projectClustersShowLess")
                      : t("knowledge.projectClustersViewAll", { count: String(projectClusterItems.length) })}
                  </Button>
                ) : null}
              </div>
            </div>
            {projectClusterItems.some((project) => project.canDelete) ? (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-4 py-3">
                <span className="text-xs font-semibold text-[color:var(--muted)]">
                  {t("knowledge.projectClustersSelection", { count: String(selectedProjectIds.length) })}
                </span>
                {selectedProjectItems.length > 0 ? (
                  <Button
                    variant="danger"
                    className="h-8 gap-1.5 px-3 text-xs"
                    disabled={graphActionBusy}
                    onClick={() => requestProjectClusterDelete({
                      projectIds: selectedProjectItems.map((project) => project.projectId),
                      titles: selectedProjectItems.map((project) => project.projectTitle),
                    })}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    {t("knowledge.projectClustersDeleteSelected")}
                  </Button>
                ) : null}
              </div>
            ) : null}
            <div className="soft-scrollbar min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
              {visibleProjectClusterItems.map((project) => (
                <div key={project.projectId} className={`rounded-xl border px-4 py-3 transition ${activeProject?.projectId === project.projectId ? "border-[color:var(--brand-solid)] bg-[color:var(--brand-soft)] text-[color:var(--brand-ink)]" : "border-[color:var(--border)] bg-[color:var(--surface-muted)]"}`}>
                  <div className="flex items-start gap-3">
                    {project.canDelete ? (
                      <label className="mt-1 inline-flex shrink-0 items-center">
                        <input
                          type="checkbox"
                          className="h-4 w-4 accent-[color:var(--brand-solid)]"
                          checked={selectedProjectSet.has(project.projectId)}
                          onChange={() => toggleProjectClusterSelection(project.projectId)}
                        />
                      </label>
                    ) : null}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-sm font-semibold">{project.projectTitle}</p>
                            {project.isProtectedSample ? <Badge tone="accent">{t("dashboard.sampleBadge")}</Badge> : null}
                          </div>
                          <div className="mt-1 flex items-center gap-1.5 text-[11px] text-[color:var(--muted)]">
                            <span>{project.nodeCount} {t("knowledge.metrics.nodes")}</span>
                            <span className="text-[color:var(--border)]">/</span>
                            <span>{project.relationCount} {t("knowledge.metrics.relations")}</span>
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <Link prefetch={false} href={buildGraphHref(locale, { projectId: project.projectId, scopeMode: "project" })} className="text-xs font-semibold text-[color:var(--brand-solid)]" onClick={(e) => e.stopPropagation()}>
                            {t("knowledge.openGraph")}
                          </Link>
                          {project.canDelete ? (
                            <button
                              type="button"
                              className="flex h-7 w-7 items-center justify-center rounded-lg text-red-500 transition hover:bg-red-500/10"
                              title={t("common.delete")}
                              disabled={graphActionBusy}
                              onClick={() => requestProjectClusterDelete({
                                projectIds: [project.projectId],
                                titles: [project.projectTitle],
                              })}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          ) : null}
                        </div>
                      </div>
                      {project.topics.length > 0 ? (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {project.topics.map((topic) => <Badge key={`${project.projectId}-${topic}`}>{topic}</Badge>)}
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </Panel>
          </div>
          </div>
        </div>
      </div>

      {dragOverlayActive ? <div className="graph-drag-overlay" aria-hidden="true" /> : null}

      {debugGraphPointer ? (
        <>
          <div
            ref={debugFollowerRef}
            aria-hidden="true"
            className="pointer-events-none fixed left-0 top-0 z-[80] h-3 w-3 rounded-full border border-white bg-rose-500 shadow-[0_0_0_4px_rgba(244,63,94,0.24)]"
            style={{ transform: "translate3d(-999px, -999px, 0)" }}
          />
          <div className="pointer-events-none fixed bottom-4 left-4 z-[80] max-w-[calc(100vw-2rem)] rounded-2xl border border-cyan-400/30 bg-slate-950/88 p-3 text-[11px] leading-5 text-cyan-50 shadow-2xl backdrop-blur">
            <div className="flex flex-wrap items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-cyan-200">
              <span>Graph Pointer Debug</span>
              <span className="rounded-full border border-cyan-400/30 px-2 py-0.5">{graphViewMode.toUpperCase()}</span>
              <span className="rounded-full border border-cyan-400/30 px-2 py-0.5">capture: {debugSnapshot?.pointerCapture ? "yes" : "no"}</span>
            </div>
            {debugSnapshot ? (
              <div className="mt-2 grid gap-x-4 gap-y-1 sm:grid-cols-2">
                <span>dragging: {debugSnapshot.dragging ? "yes" : "no"}</span>
                <span>listener: {debugSnapshot.listener}</span>
                <span>pointer/s: {debugSnapshot.pointerPerSecond}</span>
                <span>rAF/s: {debugSnapshot.framePerSecond}</span>
                <span>delay: {debugSnapshot.lastDelayMs === null ? "-" : `${debugSnapshot.lastDelayMs.toFixed(1)}ms`}</span>
                <span>frame: {debugSnapshot.lastFrameMs === null ? "-" : `${debugSnapshot.lastFrameMs.toFixed(1)}ms`}</span>
                <span>long 32/50: {debugSnapshot.longFrames32}/{debugSnapshot.longFrames50}</span>
                <span>auto: {debugSnapshot.autoRotate === null ? "-" : debugSnapshot.autoRotate ? "on" : "off"}</span>
                <span>pointer: {debugSnapshot.pointerX === null ? "-" : `${Math.round(debugSnapshot.pointerX)}, ${Math.round(debugSnapshot.pointerY ?? 0)}`}</span>
                <span>cursor: {debugSnapshot.cursor}</span>
                <span className="sm:col-span-2">element: {debugSnapshot.elementTag} {debugSnapshot.elementData !== "-" ? `[${debugSnapshot.elementData}]` : ""}</span>
                <span className="sm:col-span-2 truncate">class: {debugSnapshot.elementClass}</span>
                <span>nodes/rels: {debugSnapshot.nodeCount}/{debugSnapshot.relationCount}</span>
                <span>layer: {debugSnapshot.layerWidth ?? "-"} x {debugSnapshot.layerHeight ?? "-"}</span>
                <span>buffer: {debugSnapshot.bufferWidth ?? "-"} x {debugSnapshot.bufferHeight ?? "-"}</span>
                <span>dpr: {debugSnapshot.dpr ?? "-"}</span>
              </div>
            ) : (
              <p className="mt-2 text-cyan-100/80">Waiting for pointer data...</p>
            )}
          </div>
        </>
      ) : null}

      {/* Edit node modal */}
      {editingNode ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 px-3 py-3 backdrop-blur-sm sm:items-center sm:px-4 sm:py-6" onClick={() => setEditingNode(null)}>
          <div className="max-h-[calc(100svh-1.5rem)] w-full max-w-md overflow-y-auto rounded-t-2xl border border-[color:var(--border)] bg-[color:var(--surface-strong)] p-5 shadow-2xl sm:rounded-2xl sm:p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-display text-lg font-semibold">{t("knowledge.editNodeTitle")}</h3>
            <div className="mt-4 space-y-3">
              <label className="block space-y-1">
                <span className="text-xs font-semibold text-[color:var(--muted)]">{t("knowledge.nodeTitle")}</span>
                <input type="text" value={editingNode.title} onChange={(e) => setEditingNode({ ...editingNode, title: e.target.value })} className="form-field w-full" />
              </label>
              <label className="block space-y-1">
                <span className="text-xs font-semibold text-[color:var(--muted)]">{t("knowledge.nodeSummary")}</span>
                <textarea value={editingNode.summary} onChange={(e) => setEditingNode({ ...editingNode, summary: e.target.value })} className="form-field min-h-24 w-full" />
              </label>
            </div>
            <div className="mt-5 flex items-center justify-end gap-2">
              <button type="button" onClick={() => setEditingNode(null)} className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-4 py-2 text-sm font-semibold">{t("common.cancel")}</button>
              <button type="button" disabled={nodeActionBusy} onClick={async () => {
                setNodeActionBusy(true);
                setNodeActionMessage(null);
                try {
                  const response = await fetch(`/api/knowledge/${encodeURIComponent(editingNode.id)}?locale=${locale}`, {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ title: editingNode.title, summary: editingNode.summary }),
                  });
                  if (!response.ok) {
                    throw new Error(await readErrorMessage(response));
                  }
                  router.refresh();
                  setEditingNode(null);
                } catch (error) {
                  setNodeActionMessage(error instanceof Error ? error.message : t("errors.unexpected"));
                } finally { setNodeActionBusy(false); }
              }} className="rounded-xl bg-[color:var(--brand-solid)] px-4 py-2 text-sm font-semibold text-white">{nodeActionBusy ? "..." : t("common.save")}</button>
            </div>
          </div>
        </div>
      ) : null}

      {projectClusterDeleteTarget ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 px-3 py-3 backdrop-blur-sm sm:items-center sm:px-4 sm:py-6" onClick={() => setProjectClusterDeleteTarget(null)}>
          <div className="max-h-[calc(100svh-1.5rem)] w-full max-w-lg overflow-y-auto rounded-t-2xl border border-[color:var(--border)] bg-[color:var(--surface-strong)] p-5 shadow-2xl sm:rounded-2xl sm:p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-display text-lg font-semibold">{t("knowledge.projectClustersDeleteDialogTitle")}</h3>
            <p className="mt-3 text-sm leading-6 text-[color:var(--muted)]">
              {projectClusterDeleteTarget.projectIds.length === 1
                ? t("knowledge.deleteProjectClusterConfirm", { title: projectClusterDeleteTarget.titles[0] ?? "" })
                : t("knowledge.projectClustersDeleteSelectedConfirm", { count: String(projectClusterDeleteTarget.projectIds.length) })}
            </p>
            <label className="mt-5 block space-y-2">
              <span className="text-xs font-semibold uppercase tracking-[0.14em] text-[color:var(--muted)]">
                {t("knowledge.projectClustersDeleteDontAsk")}
              </span>
              <select
                className="form-field w-full"
                value={projectClusterDeleteSnoozeOption}
                onChange={(event) => setProjectClusterDeleteSnoozeOption(event.target.value as ProjectClusterDeleteSnoozeOption)}
              >
                <option value="always">{t("knowledge.projectClustersDeleteAskEveryTime")}</option>
                <option value="24h">{t("knowledge.projectClustersDeleteSnooze24h")}</option>
                <option value="1w">{t("knowledge.projectClustersDeleteSnooze1w")}</option>
                <option value="1m">{t("knowledge.projectClustersDeleteSnooze1m")}</option>
                <option value="forever">{t("knowledge.projectClustersDeleteSnoozeForever")}</option>
              </select>
              <p className="text-xs leading-5 text-[color:var(--muted)]">{t("knowledge.projectClustersDeleteSnoozeHint")}</p>
            </label>
            <div className="mt-6 flex justify-end gap-3">
              <Button variant="ghost" onClick={() => setProjectClusterDeleteTarget(null)}>{t("common.cancel")}</Button>
              <Button
                variant="danger"
                onClick={() => void executeProjectClusterDelete(projectClusterDeleteTarget, projectClusterDeleteSnoozeOption)}
                disabled={graphActionBusy}
              >
                {graphActionBusy ? `${t("common.loading")}...` : t("common.delete")}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
