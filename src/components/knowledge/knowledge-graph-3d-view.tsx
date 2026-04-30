"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Minus, Move, Plus, RotateCcw } from "lucide-react";
import { useI18n } from "@/components/providers/i18n-provider";
import { Button } from "@/components/ui/primitives";
import { KnowledgeGraphPayload } from "@/lib/knowledge/types";

/* ─── constants ─── */
const TAU = Math.PI * 2;
const TYPE_ORDER = [
  "project", "concept", "topic", "viewpoint", "argument", "evidence",
  "conflict", "conclusion", "question", "recommendation", "document",
] as const;
const TYPE_COLORS: Record<string, string> = {
  project: "#0ea5e9", concept: "#3b82f6", topic: "#8b5cf6", viewpoint: "#6366f1",
  argument: "#f59e0b", evidence: "#10b981", conflict: "#ef4444",
  conclusion: "#06b6d4", question: "#d946ef", recommendation: "#64748b",
  document: "#94a3b8",
};
const NODE_W = 180;
const NODE_H = 72;
const NODE_R = 14;
const MARKER_R = 6;
const MAX_CANVAS_DPR = 1.2;
const AUTO_ROTATE_FRAME_INTERVAL_MS = 34;
const AUTO_ROTATE_IDLE_RESUME_MS = 15_000;
const GRAPH_INPUT_DRAGGING_CLASS = "graph-input-dragging";

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

/* ─── types ─── */
type Vec3 = [number, number, number];
interface LNode {
  id: string; title: string; type: string; summary: string;
  pos: Vec3; sx: number; sy: number; ss: number; depth: number;
}
interface LRelation {
  id: string; sourceId: string; targetId: string; type: string; note: string;
}

/* ─── layout: spread nodes in a spherical shell, grouped by type ─── */
function buildLayout(nodes: KnowledgeGraphPayload["nodes"]): LNode[] {
  const active = TYPE_ORDER.filter((t) => nodes.some((n) => n.type === t));
  if (active.length === 0) return [];

  // Use a larger sphere and more vertical spread to avoid crowding
  const layerCount = active.length;
  const verticalSpread = Math.max(500, layerCount * 130);
  const baseRadius = Math.max(280, 200 + nodes.length * 8);

  const byType = new Map<string, KnowledgeGraphPayload["nodes"]>();
  for (const n of nodes) {
    const l = byType.get(n.type) ?? [];
    l.push(n);
    byType.set(n.type, l);
  }

  const result: LNode[] = [];
  active.forEach((type, li) => {
    const group = byType.get(type) ?? [];
    // Distribute layers evenly across vertical range
    const y = layerCount === 1 ? 0 : -verticalSpread / 2 + (li / (layerCount - 1)) * verticalSpread;
    const count = group.length;
    // Alternate radius per layer to create visual depth
    const layerRadius = baseRadius + (li % 3) * 60;
    // Offset starting angle per layer to stagger nodes
    const angleOffset = li * 0.7;

    group.forEach((n, ni) => {
      const angle = count === 1 ? angleOffset : (ni / count) * TAU + angleOffset;
      result.push({
        id: n.id, title: n.title, type: n.type, summary: n.summary,
        pos: [Math.cos(angle) * layerRadius, y, Math.sin(angle) * layerRadius],
        sx: 0, sy: 0, ss: 1, depth: 0,
      });
    });
  });
  return result;
}

/* ─── 3D projection ─── */
const CAM_DIST = 1100;
const PERSP = 700;

function projectNode(n: LNode, cy: number, sy: number, cx: number, sx: number, hw: number, hh: number, zoom: number) {
  const [x, y, z] = n.pos;
  const x1 = x * cy - z * sy;
  const z1 = x * sy + z * cy;
  const y2 = y * cx - z1 * sx;
  const z2 = y * sx + z1 * cx;
  const d = Math.max(400, CAM_DIST + z2 + PERSP);
  const f = (CAM_DIST / d) * zoom;
  n.sx = hw + x1 * f;
  n.sy = hh + y2 * f;
  n.ss = f;
  n.depth = z2;
}

/* ─── drawing helpers ─── */
function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

function truncText(ctx: CanvasRenderingContext2D, text: string, max: number): string {
  if (ctx.measureText(text).width <= max) return text;
  let lo = 0, hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (ctx.measureText(text.slice(0, mid) + "\u2026").width <= max) lo = mid; else hi = mid - 1;
  }
  return text.slice(0, lo) + "\u2026";
}

/* ─── hit testing ─── */
function hitTestNode(nodes: LNode[], mx: number, my: number): string | null {
  for (let i = nodes.length - 1; i >= 0; i--) {
    const n = nodes[i];
    const hw = (NODE_W * n.ss) / 2, hh = (NODE_H * n.ss) / 2;
    if (mx >= n.sx - hw && mx <= n.sx + hw && my >= n.sy - hh && my <= n.sy + hh) return n.id;
  }
  return null;
}

function hitTestMarker(midpoints: Map<string, [number, number]>, relations: LRelation[], mx: number, my: number): LRelation | null {
  for (const r of relations) {
    const mp = midpoints.get(r.id);
    if (!mp) continue;
    if (Math.hypot(mx - mp[0], my - mp[1]) < 14) return r;
  }
  return null;
}

/* ─── component ─── */
export type GraphPointerDebugEvent = {
  view: "2d" | "3d";
  kind: "pointer" | "frame";
  phase?: "down" | "move" | "up" | "cancel" | "blur" | "wheel" | "apply" | "render";
  clientX?: number;
  clientY?: number;
  pointerTime?: number;
  frameTime?: number;
  durationMs?: number;
  dragging?: boolean;
  listener?: string;
  pointerCapture?: boolean;
  autoRotate?: boolean;
  nodeCount?: number;
  relationCount?: number;
  layerWidth?: number;
  layerHeight?: number;
  bufferWidth?: number;
  bufferHeight?: number;
  dpr?: number;
};

export function KnowledgeGraph3DView({
  graph, active = true, activeNodeId, activeRelationId, focusMode, onSelectNode, onSelectRelation,
  debugGraphPointer = false, onDebugGraphPointer,
}: {
  graph: KnowledgeGraphPayload;
  active?: boolean;
  activeNodeId?: string;
  activeRelationId?: string;
  focusMode: boolean;
  onSelectNode: (nodeId: string) => void;
  onSelectRelation: (relationId: string, nodeId: string) => void;
  debugGraphPointer?: boolean;
  onDebugGraphPointer?: (event: GraphPointerDebugEvent) => void;
}) {
  const { t } = useI18n();
  const boxRef = useRef<HTMLDivElement>(null);
  const cvsRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number | null>(null);
  const frameRunnerRef = useRef<(now: number) => void>(() => {});
  const lastFrameRef = useRef(0);
  const activeViewRef = useRef(active);
  const orbitRef = useRef({ yaw: -0.35, pitch: -0.15, zoom: 0.85 });
  const autoRef = useRef(true);
  const dragRef = useRef<{ pid: number; sx: number; sy: number; yaw0: number; pitch0: number; moved: boolean } | null>(null);
  const dragCleanupRef = useRef<(() => void) | null>(null);
  const [dragOverlayActive, setDragOverlayActive] = useState(false);
  const idleResumeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nodesRef = useRef<LNode[]>([]);
  const sortedNodesRef = useRef<LNode[]>([]);
  const nodeByIdRef = useRef(new Map<string, LNode>());
  const relsRef = useRef<LRelation[]>([]);
  const midsRef = useRef(new Map<string, [number, number]>());
  const connRef = useRef(new Set<string>());
  const connRelRef = useRef(new Set<string>());
  const dprRef = useRef(1);
  const sizeRef = useRef({ w: 0, h: 0 });
  const textCacheRef = useRef(new Map<string, string>());
  const reportDebug = useCallback((event: Omit<GraphPointerDebugEvent, "view">) => {
    if (!debugGraphPointer) return;
    const box = boxRef.current;
    const canvas = cvsRef.current;
    onDebugGraphPointer?.({
      view: "3d",
      nodeCount: graph.nodes.length,
      relationCount: graph.relations.length,
      layerWidth: box?.clientWidth,
      layerHeight: box?.clientHeight,
      bufferWidth: canvas?.width,
      bufferHeight: canvas?.height,
      dpr: dprRef.current,
      ...event,
    });
  }, [debugGraphPointer, graph.nodes.length, graph.relations.length, onDebugGraphPointer]);
  const typeLabelCache = useMemo(() => {
    const labels = new Map<string, string>();
    for (const type of TYPE_ORDER) labels.set(type, t(`knowledge.nodeTypes.${type}`).toUpperCase());
    return labels;
  }, [t]);
  // Keep local copies of active state for the render callback (avoid stale closures)
  const activeNodeRef = useRef(activeNodeId);
  const activeRelRef = useRef(activeRelationId);
  useEffect(() => { activeNodeRef.current = activeNodeId; }, [activeNodeId]);
  useEffect(() => { activeRelRef.current = activeRelationId; }, [activeRelationId]);

  // Rebuild layout
  useEffect(() => {
    const nodes = buildLayout(graph.nodes);
    nodesRef.current = nodes;
    sortedNodesRef.current = [...nodes];
    nodeByIdRef.current = new Map(nodes.map((node) => [node.id, node]));
    relsRef.current = graph.relations.map((r) => ({
      id: r.id, sourceId: r.sourceNodeId, targetId: r.targetNodeId, type: r.type, note: r.note,
    }));
    textCacheRef.current.clear();
  }, [graph.nodes, graph.relations]);

  // Rebuild connected sets
  useEffect(() => {
    const ns = new Set<string>();
    const rs = new Set<string>();
    if (activeNodeId) {
      ns.add(activeNodeId);
      for (const r of graph.relations) {
        if (r.sourceNodeId === activeNodeId || r.targetNodeId === activeNodeId) {
          ns.add(r.sourceNodeId);
          ns.add(r.targetNodeId);
          rs.add(r.id);
        }
      }
    }
    connRef.current = ns;
    connRelRef.current = rs;
  }, [activeNodeId, graph.relations]);

  /* ── render ── */
  const truncTextCached = useCallback((ctx: CanvasRenderingContext2D, text: string, max: number): string => {
    const roundedMax = Math.max(0, Math.round(max));
    const key = `${ctx.font}|${roundedMax}|${text}`;
    const cached = textCacheRef.current.get(key);
    if (cached) return cached;
    const next = truncText(ctx, text, roundedMax);
    if (textCacheRef.current.size > 900) textCacheRef.current.clear();
    textCacheRef.current.set(key, next);
    return next;
  }, []);

  const render = useCallback(() => {
    const c = cvsRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const dpr = dprRef.current;
    const w = sizeRef.current.w, h = sizeRef.current.h;
    if (!w || !h) return;

    const { yaw, pitch, zoom } = orbitRef.current;
    const cy = Math.cos(yaw), sy = Math.sin(yaw), cx = Math.cos(pitch), sx = Math.sin(pitch);
    const hw = w / 2, hh = h / 2;
    const nodes = nodesRef.current;
    const rels = relsRef.current;
    const posMap = nodeByIdRef.current;
    const connected = connRef.current;
    const connRels = connRelRef.current;
    const curActive = activeNodeRef.current;
    const curActiveRel = activeRelRef.current;
    const hasActive = Boolean(curActive);
    const isDark = typeof document !== "undefined" && document.documentElement.classList.contains("dark");

    for (const n of nodes) projectNode(n, cy, sy, cx, sx, hw, hh, zoom);
    let sorted = sortedNodesRef.current;
    if (sorted.length !== nodes.length) {
      sorted = [...nodes];
      sortedNodesRef.current = sorted;
    }
    sorted.sort((a, b) => a.depth - b.depth);

    const mids = midsRef.current;
    mids.clear();
    for (const r of rels) {
      const s = posMap.get(r.sourceId), tg = posMap.get(r.targetId);
      if (s && tg) mids.set(r.id, [(s.sx + tg.sx) / 2, (s.sy + tg.sy) / 2]);
    }

    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    // ── Relations ──
    for (const r of rels) {
      const s = posMap.get(r.sourceId), tg = posMap.get(r.targetId);
      if (!s || !tg) continue;
      // Only show relation as "active" if it actually connects to the active node
      const isActR = r.id === curActiveRel && hasActive && (r.sourceId === curActive || r.targetId === curActive);
      const isConnR = hasActive && connRels.has(r.id);
      const baseAlpha = hasActive ? (isActR ? 1 : isConnR ? 0.85 : 0.15) : 0.4;

      // Glow for active/connected
      if (isActR || isConnR) {
        ctx.beginPath();
        ctx.moveTo(s.sx, s.sy);
        ctx.lineTo(tg.sx, tg.sy);
        ctx.strokeStyle = isActR ? `rgba(245,158,11,0.25)` : `rgba(99,102,241,0.2)`;
        ctx.lineWidth = isActR ? 8 : 5;
        ctx.setLineDash([]);
        ctx.stroke();
      }

      ctx.beginPath();
      ctx.moveTo(s.sx, s.sy);
      ctx.lineTo(tg.sx, tg.sy);
      ctx.strokeStyle = isActR
        ? `rgba(245,158,11,${baseAlpha})`
        : isConnR
          ? `rgba(99,102,241,${baseAlpha})`
          : `rgba(148,163,184,${baseAlpha})`;
      ctx.lineWidth = isActR ? 2.5 : isConnR ? 2 : 1;
      ctx.setLineDash(r.type === "unresolved_with" ? [6, 4] : []);
      ctx.stroke();
      ctx.setLineDash([]);

      // Midpoint marker
      const mp = mids.get(r.id);
      if (!mp) continue;
      const mr = isActR ? MARKER_R + 2 : isConnR ? MARKER_R + 1 : MARKER_R;
      ctx.beginPath();
      ctx.arc(mp[0], mp[1], mr, 0, TAU);
      if (isActR) {
        ctx.fillStyle = "rgba(245,158,11,0.9)";
        ctx.fill();
        ctx.strokeStyle = "rgba(245,158,11,0.5)";
        ctx.lineWidth = 2;
        ctx.stroke();
      } else if (isConnR) {
        ctx.fillStyle = "rgba(99,102,241,0.8)";
        ctx.fill();
      } else {
        const mAlpha = hasActive ? 0.2 : 0.4;
        ctx.fillStyle = `rgba(148,163,184,${mAlpha})`;
        ctx.fill();
      }
    }

    // ── Nodes ──
    for (const n of sorted) {
      const isAct = n.id === curActive;
      const isConn = connected.has(n.id);
      const dimmed = hasActive && !isAct && !isConn;
      const s = n.ss;
      const nw = NODE_W * s, nh = NODE_H * s;
      const nx = n.sx - nw / 2, ny = n.sy - nh / 2;
      const nr = NODE_R * s;

      ctx.globalAlpha = dimmed ? 0.5 : 1;

      // Shadow
      ctx.shadowColor = isDark ? "rgba(0,0,0,0.5)" : "rgba(0,0,0,0.12)";
      ctx.shadowBlur = isAct ? 18 : 6;
      ctx.shadowOffsetY = isAct ? 4 : 2;

      // Background
      roundRect(ctx, nx, ny, nw, nh, nr);
      ctx.fillStyle = isDark ? "rgba(20,28,42,0.94)" : "rgba(255,255,255,0.97)";
      ctx.fill();
      ctx.shadowColor = "transparent";
      ctx.shadowBlur = 0;
      ctx.shadowOffsetY = 0;

      // Border
      roundRect(ctx, nx, ny, nw, nh, nr);
      const tc = TYPE_COLORS[n.type] || "#94a3b8";
      if (isAct) {
        ctx.strokeStyle = tc;
        ctx.lineWidth = 2.5 * s;
      } else if (isConn && hasActive) {
        ctx.strokeStyle = "rgba(99,102,241,0.6)";
        ctx.lineWidth = 1.8 * s;
      } else {
        ctx.strokeStyle = isDark ? "rgba(71,85,105,0.45)" : "rgba(203,213,225,0.6)";
        ctx.lineWidth = 1 * s;
      }
      ctx.stroke();

      // Left accent bar
      const bh = nh * 0.55, by = ny + (nh - bh) / 2;
      ctx.beginPath();
      ctx.roundRect(nx + 3 * s, by, 3.5 * s, bh, 2 * s);
      ctx.fillStyle = tc;
      ctx.globalAlpha = dimmed ? 0.3 : (isAct ? 0.95 : 0.55);
      ctx.fill();
      ctx.globalAlpha = dimmed ? 0.5 : 1;

      // Type label
      const fs1 = Math.max(8, 9 * s);
      ctx.font = `600 ${fs1}px system-ui,-apple-system,sans-serif`;
      ctx.fillStyle = isDark ? "rgba(148,163,184,0.75)" : "rgba(100,116,139,0.75)";
      ctx.textBaseline = "top";
      const tx = nx + 14 * s;
      const typeLabel = typeLabelCache.get(n.type) ?? n.type.toUpperCase();
      ctx.fillText(truncTextCached(ctx, typeLabel, nw - 22 * s), tx, ny + 10 * s);

      // Title
      const fs2 = Math.max(10, 12.5 * s);
      ctx.font = `600 ${fs2}px system-ui,-apple-system,sans-serif`;
      ctx.fillStyle = isDark ? "rgba(226,232,240,0.95)" : "rgba(15,23,42,0.9)";
      ctx.fillText(truncTextCached(ctx, n.title, nw - 22 * s), tx, ny + 25 * s);

      // Summary for active/connected
      if ((isAct || (hasActive && isConn)) && n.summary) {
        const fs3 = Math.max(8, 10 * s);
        ctx.font = `400 ${fs3}px system-ui,-apple-system,sans-serif`;
        ctx.fillStyle = isDark ? "rgba(148,163,184,0.65)" : "rgba(100,116,139,0.65)";
        ctx.fillText(truncTextCached(ctx, n.summary, nw - 22 * s), tx, ny + 44 * s);
      }

      ctx.globalAlpha = 1;
    }

    ctx.restore();
  }, [truncTextCached, typeLabelCache]);

  const cancelFrame = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const requestFrame = useCallback((resetClock = false) => {
    if (!activeViewRef.current || rafRef.current !== null) return;
    if (resetClock || lastFrameRef.current === 0) lastFrameRef.current = performance.now();
    rafRef.current = requestAnimationFrame((now) => frameRunnerRef.current(now));
  }, []);

  const resumeAutoRotate = useCallback(() => {
    if (idleResumeTimerRef.current) {
      clearTimeout(idleResumeTimerRef.current);
      idleResumeTimerRef.current = null;
    }
    autoRef.current = activeViewRef.current;
    requestFrame(true);
  }, [requestFrame]);

  const stopAutoRotate = useCallback(() => {
    if (idleResumeTimerRef.current) {
      clearTimeout(idleResumeTimerRef.current);
      idleResumeTimerRef.current = null;
    }
    autoRef.current = false;
    requestFrame(true);
  }, [requestFrame]);

  const scheduleAutoRotateResume = useCallback(() => {
    if (!activeViewRef.current || autoRef.current) return;
    if (idleResumeTimerRef.current) clearTimeout(idleResumeTimerRef.current);
    idleResumeTimerRef.current = setTimeout(() => {
      idleResumeTimerRef.current = null;
      if (!activeViewRef.current || dragRef.current) return;
      resumeAutoRotate();
    }, AUTO_ROTATE_IDLE_RESUME_MS);
  }, [resumeAutoRotate]);

  const markIdleInteraction = useCallback(() => {
    if (!activeViewRef.current || autoRef.current) return;
    scheduleAutoRotateResume();
  }, [scheduleAutoRotateResume]);

  // Dirty-frame render loop: continuous only while dragging or auto-rotating.
  useEffect(() => {
    frameRunnerRef.current = (now: number) => {
      rafRef.current = null;
      if (!activeViewRef.current) return;
      const previous = lastFrameRef.current || now;
      if (autoRef.current && !dragRef.current && now - previous < AUTO_ROTATE_FRAME_INTERVAL_MS) {
        requestFrame();
        return;
      }
      if (autoRef.current) orbitRef.current.yaw += ((now - previous) / 1000) * 0.05;
      lastFrameRef.current = now;
      const renderStart = performance.now();
      render();
      const renderEnd = performance.now();
      reportDebug({
        kind: "frame",
        phase: "render",
        frameTime: now,
        durationMs: renderEnd - renderStart,
        dragging: Boolean(dragRef.current),
        listener: "requestAnimationFrame",
        pointerCapture: false,
        autoRotate: autoRef.current,
      });
      if (autoRef.current) requestFrame();
    };
  }, [render, reportDebug, requestFrame]);

  useEffect(() => {
    activeViewRef.current = active;
    if (!active) {
      cancelFrame();
      dragRef.current = null;
      setGraphViewportDragging(boxRef.current, false);
      setGraphInputDragging(false);
      lastFrameRef.current = 0;
      if (idleResumeTimerRef.current) {
        clearTimeout(idleResumeTimerRef.current);
        idleResumeTimerRef.current = null;
      }
      return;
    }
    autoRef.current = true;
    if (idleResumeTimerRef.current) {
      clearTimeout(idleResumeTimerRef.current);
      idleResumeTimerRef.current = null;
    }
    requestFrame(true);
  }, [active, cancelFrame, requestFrame]);

  useEffect(() => () => {
    cancelFrame();
    setGraphInputDragging(false);
    if (idleResumeTimerRef.current) clearTimeout(idleResumeTimerRef.current);
  }, [cancelFrame]);

  useEffect(() => {
    requestFrame(true);
  }, [activeNodeId, activeRelationId, graph.nodes, graph.relations, requestFrame, typeLabelCache]);

  // Resize
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      const dpr = Math.min(window.devicePixelRatio || 1, MAX_CANVAS_DPR);
      dprRef.current = dpr;
      sizeRef.current = { w: width, h: height };
      const c = cvsRef.current;
      if (c) { c.width = width * dpr; c.height = height * dpr; c.style.width = `${width}px`; c.style.height = `${height}px`; }
      requestFrame(true);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [requestFrame]);

  // Wheel zoom
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      reportDebug({
        kind: "pointer",
        phase: "wheel",
        clientX: e.clientX,
        clientY: e.clientY,
        pointerTime: performance.now(),
        dragging: false,
        listener: "wheel",
        pointerCapture: false,
        autoRotate: autoRef.current,
      });
      const step = Math.max(0.03, orbitRef.current.zoom * 0.06);
      orbitRef.current.zoom = Math.min(2.5, Math.max(0.3, orbitRef.current.zoom + (e.deltaY < 0 ? step : -step)));
      requestFrame(true);
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, [reportDebug, requestFrame]);

  const onNativeMove = useCallback((e: PointerEvent) => {
    const d = dragRef.current;
    if (!d || d.pid !== e.pointerId) return;
    reportDebug({
      kind: "pointer",
      phase: "move",
      clientX: e.clientX,
      clientY: e.clientY,
      pointerTime: performance.now(),
      dragging: true,
      listener: "document",
      pointerCapture: false,
      autoRotate: autoRef.current,
    });
    if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) > 4) {
      d.moved = true;
    }
    orbitRef.current.yaw = d.yaw0 + (e.clientX - d.sx) / 250;
    orbitRef.current.pitch = Math.min(0.6, Math.max(-1.2, d.pitch0 + (e.clientY - d.sy) / 300));
    requestFrame();
  }, [reportDebug, requestFrame]);

  const cleanupDragInput = useCallback(() => {
    if (dragCleanupRef.current) {
      dragCleanupRef.current();
      dragCleanupRef.current = null;
    }
    setGraphViewportDragging(boxRef.current, false);
    setGraphInputDragging(false);
    setDragOverlayActive(false);
  }, []);

  const finishPointerDrag = useCallback((e?: Pick<PointerEvent, "pointerId" | "clientX" | "clientY"> | React.PointerEvent<HTMLDivElement>, cancelled = false) => {
    const drag = dragRef.current;
    if (!drag || (e && drag.pid !== e.pointerId)) return;
    reportDebug({
      kind: "pointer",
      phase: cancelled ? "cancel" : "up",
      clientX: e?.clientX,
      clientY: e?.clientY,
      pointerTime: performance.now(),
      dragging: false,
      listener: "document",
      pointerCapture: false,
      autoRotate: autoRef.current,
    });
    const wasDrag = !cancelled && e
      ? drag.moved || Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 4
      : drag.moved;
    dragRef.current = null;
    cleanupDragInput();
    if (wasDrag) {
      stopAutoRotate();
      scheduleAutoRotateResume();
    } else {
      markIdleInteraction();
    }

    if (!cancelled && e && !wasDrag) {
      const rect = cvsRef.current?.getBoundingClientRect();
      if (rect) {
        const mx = e.clientX - rect.left, my = e.clientY - rect.top;
        const nodeId = hitTestNode(nodesRef.current, mx, my);
        if (nodeId) { onSelectNode(nodeId); return; }
        const rel = hitTestMarker(midsRef.current, relsRef.current, mx, my);
        if (rel) { onSelectRelation(rel.id, rel.sourceId); return; }
        // Empty space click -> deselect
        onSelectNode("");
      }
    }
  }, [cleanupDragInput, markIdleInteraction, onSelectNode, onSelectRelation, reportDebug, scheduleAutoRotateResume, stopAutoRotate]);

  useEffect(() => () => {
    cleanupDragInput();
  }, [cleanupDragInput]);

  // Pointer events
  const onDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest("[data-graph-stop]")) return;
    e.preventDefault();
    stopAutoRotate();
    reportDebug({
      kind: "pointer",
      phase: "down",
      clientX: e.clientX,
      clientY: e.clientY,
      pointerTime: performance.now(),
      dragging: true,
      listener: "react-pointerdown + document-drag-listeners",
      pointerCapture: false,
      autoRotate: autoRef.current,
    });
    dragRef.current = { pid: e.pointerId, sx: e.clientX, sy: e.clientY, yaw0: orbitRef.current.yaw, pitch0: orbitRef.current.pitch, moved: false };
    cleanupDragInput();
    setDragOverlayActive(true);
    setGraphInputDragging(true);
    setGraphViewportDragging(e.currentTarget, true);
    const ownerDocument = e.currentTarget.ownerDocument;
    const ownerWindow = ownerDocument.defaultView;
    const handleNativePointerUp = (nativeEvent: PointerEvent) => finishPointerDrag(nativeEvent);
    const handleNativePointerCancel = (nativeEvent: PointerEvent) => finishPointerDrag(nativeEvent, true);
    const handleWindowBlur = () => finishPointerDrag(undefined, true);
    ownerDocument.addEventListener("pointermove", onNativeMove, { passive: true });
    ownerDocument.addEventListener("pointerup", handleNativePointerUp, { passive: true });
    ownerDocument.addEventListener("pointercancel", handleNativePointerCancel, { passive: true });
    ownerWindow?.addEventListener("blur", handleWindowBlur, { passive: true });
    dragCleanupRef.current = () => {
      ownerDocument.removeEventListener("pointermove", onNativeMove);
      ownerDocument.removeEventListener("pointerup", handleNativePointerUp);
      ownerDocument.removeEventListener("pointercancel", handleNativePointerCancel);
      ownerWindow?.removeEventListener("blur", handleWindowBlur);
    };
    requestFrame(true);
  }, [cleanupDragInput, finishPointerDrag, onNativeMove, reportDebug, requestFrame, stopAutoRotate]);

  const onUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    finishPointerDrag(e);
  }, [finishPointerDrag]);

  const onLostCapture = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    finishPointerDrag(e, true);
  }, [finishPointerDrag]);

  const adjustZoom = useCallback((d: number) => {
    orbitRef.current.zoom = Math.min(2.5, Math.max(0.3, orbitRef.current.zoom + d));
    requestFrame(true);
  }, [requestFrame]);

  const doReset = useCallback(() => {
    orbitRef.current = { yaw: -0.35, pitch: -0.15, zoom: 0.85 };
    requestFrame(true);
    onSelectNode("");
  }, [onSelectNode, requestFrame]);

  return (
    <div
      ref={boxRef}
      data-graph-viewport="3d"
      className={`animate-scale-in graph-grid relative select-none overflow-hidden rounded-[1.9rem] border border-[color:var(--border)] bg-[color:var(--surface-soft)] cursor-grab active:cursor-grabbing ${focusMode ? "h-[68svh] sm:h-[74vh]" : "h-[38rem] sm:h-[48rem] xl:h-[56rem]"}`}
      onPointerDownCapture={() => markIdleInteraction()}
      onPointerDown={onDown} onPointerUp={onUp} onPointerCancel={(event) => finishPointerDrag(event, true)} onLostPointerCapture={onLostCapture}
      draggable={false}
      onDragStart={(e) => e.preventDefault()}
      style={{ touchAction: "none", overscrollBehavior: "contain", WebkitUserSelect: "none", contain: "layout paint style", isolation: "isolate" }}
    >
      <canvas ref={cvsRef} className="pointer-events-none absolute inset-0" draggable={false} style={{ width: "100%", height: "100%" }} />

      <div data-graph-stop="true" className="graph-floating-surface absolute right-4 top-4 z-30 flex flex-wrap items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold text-[color:var(--muted)] shadow-lg">
        <Button variant="ghost" className="gap-2 px-3 py-2 text-xs" onClick={() => adjustZoom(-0.1)}>
          <Minus className="h-4 w-4" />{t("knowledge.graphZoomOut")}
        </Button>
        <Button variant="ghost" className="gap-2 px-3 py-2 text-xs" onClick={() => adjustZoom(0.1)}>
          <Plus className="h-4 w-4" />{t("knowledge.graphZoomIn")}
        </Button>
        <Button variant="ghost" className="gap-2 px-3 py-2 text-xs" onClick={doReset}>
          <RotateCcw className="h-4 w-4" />{t("knowledge.graphResetView")}
        </Button>
      </div>

      <div data-graph-stop="true" className="graph-floating-surface pointer-events-none absolute bottom-4 right-4 inline-flex items-center gap-2 rounded-full px-3 py-2 text-xs font-semibold text-[color:var(--muted)] shadow-lg">
        <Move className="h-4 w-4" />{t("knowledge.graph3dHint")}
      </div>

      {dragOverlayActive ? <div className="graph-drag-overlay" aria-hidden="true" /> : null}
    </div>
  );
}
