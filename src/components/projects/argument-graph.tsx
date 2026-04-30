"use client";

import { useMemo } from "react";
import { useI18n } from "@/components/providers/i18n-provider";
import { ArgumentNode, ArgumentRelation } from "@/lib/types";

const order = [
  "question",
  "claim",
  "evidence",
  "rebuttal",
  "clarification",
  "assumption",
  "actionItem",
  "conclusion",
] as const;

const relationMarkerOffsets: Array<{ x: number; y: number }> = [
  { x: 0, y: 0 },
  { x: 0, y: -18 },
  { x: 0, y: 18 },
  { x: -18, y: 0 },
  { x: 18, y: 0 },
  { x: -24, y: 16 },
  { x: 24, y: -16 },
];

function estimateNodeHeight(title: string, description: string, density: "comfortable" | "dense") {
  const titleLines = Math.min(3, Math.max(1, Math.ceil(title.length / (density === "dense" ? 18 : 20))));
  const descriptionLines = Math.min(5, Math.max(description ? 2 : 1, Math.ceil(Math.max(description.length, 24) / (density === "dense" ? 38 : 44))));
  return (density === "dense" ? 118 : 130) + titleLines * 14 + descriptionLines * 12;
}

function markerTone(type: ArgumentRelation["type"], active: boolean, connected: boolean) {
  if (active) return "border-amber-500/55 bg-amber-500/16 text-amber-700 dark:text-amber-200";
  if (connected) return "border-indigo-500/30 bg-indigo-500/10 text-[color:var(--foreground)]";
  if (type === "rebuts") return "border-rose-500/30 bg-rose-500/10 text-[color:var(--foreground)]";
  if (type === "supports") return "border-emerald-500/30 bg-emerald-500/10 text-[color:var(--foreground)]";
  return "border-[color:var(--border)] bg-[color:var(--surface-strong)] text-[color:var(--muted)]";
}

export function ArgumentGraph({
  nodes,
  relations,
  activeNodeId,
  density = "comfortable",
}: {
  nodes: ArgumentNode[];
  relations: ArgumentRelation[];
  activeNodeId?: string;
  density?: "comfortable" | "dense";
}) {
  const { t } = useI18n();
  const nodeWidth = density === "dense" ? 208 : 236;
  const columnGap = density === "dense" ? 276 : 316;
  const laneInset = density === "dense" ? 20 : 24;

  const relationCounts = useMemo(() => {
    const counts = new Map<string, number>();
    relations.forEach((relation) => {
      counts.set(relation.sourceNodeId, (counts.get(relation.sourceNodeId) ?? 0) + 1);
      counts.set(relation.targetNodeId, (counts.get(relation.targetNodeId) ?? 0) + 1);
    });
    return counts;
  }, [relations]);

  const layout = useMemo(() => {
    const positions = new Map<string, { x: number; y: number; height: number }>();
    const visibleTypes = order.filter((type) => nodes.some((node) => node.type === type));
    const lanes = visibleTypes.map((type, columnIndex) => {
      const laneNodes = nodes
        .filter((node) => node.type === type)
        .sort((left, right) => {
          const countDiff = (relationCounts.get(right.id) ?? 0) - (relationCounts.get(left.id) ?? 0);
          return countDiff !== 0 ? countDiff : left.title.localeCompare(right.title);
        });

      let cursorY = density === "dense" ? 102 : 114;
      const x = 56 + columnIndex * columnGap;
      laneNodes.forEach((node) => {
        const height = estimateNodeHeight(node.title, node.description, density);
        positions.set(node.id, { x, y: cursorY, height });
        cursorY += height + (density === "dense" ? 28 : 34) + Math.min(18, (relationCounts.get(node.id) ?? 0) * 2);
      });

      return {
        type,
        count: laneNodes.length,
        x,
        height: cursorY + 28,
      };
    });

    return {
      positions,
      lanes,
      width: Math.max(920, visibleTypes.length * columnGap + 156),
      height: Math.max(440, ...lanes.map((lane) => lane.height)),
    };
  }, [columnGap, density, nodes, relationCounts]);

  const connectedNodeIds = useMemo(() => {
    const ids = new Set<string>();
    if (!activeNodeId) return ids;
    ids.add(activeNodeId);
    relations.forEach((relation) => {
      if (relation.sourceNodeId === activeNodeId) ids.add(relation.targetNodeId);
      if (relation.targetNodeId === activeNodeId) ids.add(relation.sourceNodeId);
    });
    return ids;
  }, [activeNodeId, relations]);

  const relationMarkers = useMemo(() => {
    const buckets = new Map<string, number>();
    return relations.flatMap((relation) => {
      const source = layout.positions.get(relation.sourceNodeId);
      const target = layout.positions.get(relation.targetNodeId);
      if (!source || !target) return [];
      const sourceY = source.y + source.height / 2;
      const targetY = target.y + target.height / 2;
      const midX = (source.x + nodeWidth + target.x) / 2;
      const midY = (sourceY + targetY) / 2;
      const bucketKey = `${Math.round(midX / 72)}:${Math.round(midY / 48)}`;
      const index = buckets.get(bucketKey) ?? 0;
      buckets.set(bucketKey, index + 1);
      const offset = relationMarkerOffsets[index % relationMarkerOffsets.length];
      return [{ relation, left: midX - 42 + offset.x, top: midY - 12 + offset.y }];
    });
  }, [layout.positions, nodeWidth, relations]);

  return (
    <div className="soft-scrollbar overflow-x-auto rounded-[1.6rem] border border-[color:var(--border)] bg-[color:var(--surface-soft)] p-4">
      <div className="graph-grid pointer-events-none relative overflow-hidden rounded-[1.4rem]" style={{ minWidth: layout.width, minHeight: layout.height }}>
        {layout.lanes.map((lane) => (
          <div
            key={lane.type}
            className="graph-lane-surface absolute rounded-[1.55rem] p-4"
            style={{ left: lane.x - laneInset, top: 34, width: nodeWidth + laneInset * 2, height: layout.height - 68 }}
          >
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--muted)]">{t(`nodeTypes.${lane.type}`)}</p>
              <span className="rounded-full border border-[color:var(--border)] bg-[color:var(--surface-strong)] px-2.5 py-1 text-[10px] font-semibold text-[color:var(--muted)]">{lane.count}</span>
            </div>
          </div>
        ))}

        <svg width={layout.width} height={layout.height} className="absolute left-0 top-0 overflow-visible">
          {relations.map((relation) => {
            const source = layout.positions.get(relation.sourceNodeId);
            const target = layout.positions.get(relation.targetNodeId);
            if (!source || !target) return null;
            const sourceY = source.y + source.height / 2;
            const targetY = target.y + target.height / 2;
            const isConnected = activeNodeId ? relation.sourceNodeId === activeNodeId || relation.targetNodeId === activeNodeId : false;
            const stroke = relation.type === "rebuts"
              ? (isConnected ? "rgba(244,63,94,0.8)" : "rgba(244,63,94,0.38)")
              : relation.type === "supports"
                ? (isConnected ? "rgba(16,185,129,0.8)" : "rgba(16,185,129,0.34)")
                : isConnected
                  ? "rgba(99,102,241,0.78)"
                  : "rgba(148,163,184,0.4)";
            return (
              <path
                key={relation.id}
                d={`M ${source.x + nodeWidth} ${sourceY} C ${source.x + nodeWidth + 38} ${sourceY}, ${target.x - 38} ${targetY}, ${target.x} ${targetY}`}
                fill="none"
                stroke={stroke}
                strokeWidth={isConnected ? "3" : "2"}
                strokeDasharray={relation.type === "rebuts" ? "6 6" : undefined}
                opacity={activeNodeId ? (isConnected ? 1 : 0.42) : 0.86}
              />
            );
          })}
        </svg>

        {relationMarkers.map(({ relation, left, top }) => {
          const isConnected = activeNodeId ? relation.sourceNodeId === activeNodeId || relation.targetNodeId === activeNodeId : false;
          return (
            <div
              key={`${relation.id}-label`}
              className={`graph-floating-surface absolute rounded-full border px-3 py-1 text-[10px] font-semibold ${markerTone(relation.type, false, isConnected)}`}
              style={{ left, top }}
            >
              {t(`relationTypes.${relation.type}`)}
            </div>
          );
        })}

        {nodes.map((node) => {
          const point = layout.positions.get(node.id);
          if (!point) return null;
          const isActive = activeNodeId === node.id;
          const isConnected = !activeNodeId || connectedNodeIds.has(node.id);
          return (
            <article
              key={node.id}
              style={{ left: point.x, top: point.y, width: nodeWidth, minHeight: point.height }}
              className={`graph-node-surface absolute rounded-[1.45rem] border p-4 transition-[opacity,border-color,background-color,box-shadow] duration-150 ${isActive ? "border-amber-500/50 bg-amber-500/12 ring-2 ring-amber-500/35 shadow-[0_14px_28px_rgba(217,119,6,0.12)]" : "border-[color:var(--border)] bg-[color:var(--surface-strong)]"} ${isConnected ? "opacity-100" : "opacity-45"}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[color:var(--muted)]">{t(`nodeTypes.${node.type}`)}</p>
                  <h4 className="mt-2 break-words text-sm font-semibold leading-5">{node.title}</h4>
                </div>
                <span className="rounded-full border border-[color:var(--border)] bg-[color:var(--surface-hover)] px-2.5 py-1 text-[10px] font-semibold text-[color:var(--muted)]">
                  {node.strength}/5
                </span>
              </div>
              <p className="mt-3 break-words text-xs leading-5 text-[color:var(--muted)]">{node.description || t("common.none")}</p>
              <div className="mt-4 flex flex-wrap gap-2 text-[10px] font-semibold">
                <span className="rounded-full border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-2.5 py-1 text-[color:var(--muted)]">{t(`nodeStatus.${node.status}`)}</span>
                {node.stance ? <span className="rounded-full border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-2.5 py-1 text-[color:var(--muted)]">{node.stance}</span> : null}
                {node.entryIds.length > 0 ? <span className="rounded-full border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-2.5 py-1 text-[color:var(--muted)]">{`${node.entryIds.length} ${t("project.overviewCard.entries")}`}</span> : null}
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}