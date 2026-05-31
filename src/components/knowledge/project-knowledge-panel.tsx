"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { BookOpenText, Network, RefreshCcw, Sparkles } from "lucide-react";
import { useI18n } from "@/components/providers/i18n-provider";
import { Badge, Button, Panel } from "@/components/ui/primitives";
import { formatDateTime } from "@/lib/format";
import { AppLocale, DiscussionProject } from "@/lib/types";
import { KnowledgeProjectSnapshot } from "@/lib/knowledge/types";

type MessageTone = "success" | "danger" | "default";

export function ProjectKnowledgePanel({
  locale,
  project,
}: {
  locale: AppLocale;
  project: DiscussionProject;
}) {
  const { t } = useI18n();
  const [snapshot, setSnapshot] = useState<KnowledgeProjectSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [messageTone, setMessageTone] = useState<MessageTone>("default");

  const loadSnapshot = useCallback(
    async (force = false, options: { generateGraphLinks?: boolean } = {}) => {
      setLoading(true);
      setMessage(null);
      setMessageTone("default");
      try {
        const shouldPost = force || Boolean(options.generateGraphLinks);
        if (project.metadata.isSample && options.generateGraphLinks) {
          setMessage(t("knowledge.sampleGraphGenerationDisabled"));
          setMessageTone("danger");
          return;
        }
        const response = await fetch(`/api/projects/${project.id}/knowledge?locale=${locale}`, {
          method: shouldPost ? "POST" : "GET",
          headers: shouldPost ? { "Content-Type": "application/json" } : undefined,
          body: shouldPost ? JSON.stringify({ generateGraphLinks: Boolean(options.generateGraphLinks) }) : undefined,
          cache: "no-store",
        });
        if (!response.ok) throw new Error(t("errors.unexpected"));
        const payload = (await response.json()) as { snapshot: KnowledgeProjectSnapshot };
        setSnapshot(payload.snapshot);
        if (shouldPost) {
          setMessage(options.generateGraphLinks ? t("knowledge.generateGraphSuccess") : t("knowledge.extractSuccess"));
          setMessageTone("success");
        }
      } catch (error) {
        setMessage(error instanceof Error ? error.message : t("errors.unexpected"));
        setMessageTone("danger");
      } finally {
        setLoading(false);
      }
    },
    [locale, project.id, project.metadata.isSample, t],
  );

  useEffect(() => {
    void loadSnapshot(false);
  }, [loadSnapshot]);

  const topRelations = useMemo(() => snapshot?.relations.slice(0, 6) ?? [], [snapshot]);
  const topNodes = useMemo(() => snapshot?.nodes.slice(0, 8) ?? [], [snapshot]);

  return (
    <div className="space-y-6">
      <Panel className="space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap gap-2">
              <Badge tone="accent">{t("knowledge.projectPanel.badge")}</Badge>
              {snapshot ? <Badge>{formatDateTime(snapshot.generatedAt, locale)}</Badge> : null}
            </div>
            <h2 className="mt-3 font-display text-2xl font-semibold">{t("knowledge.projectPanel.title")}</h2>
            <p className="mt-1 text-sm leading-6 text-[color:var(--muted)]">{t("knowledge.projectPanel.subtitle")}</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Button variant="ghost" className="gap-2" onClick={() => void loadSnapshot(true)} disabled={loading}>
              <RefreshCcw className="h-4 w-4" />
              {loading ? `${t("common.loading")}...` : t("knowledge.extractNow")}
            </Button>
            <Button
              variant="ghost"
              className="gap-2"
              onClick={() => void loadSnapshot(true, { generateGraphLinks: true })}
              disabled={loading || project.metadata.isSample}
              title={project.metadata.isSample ? t("knowledge.sampleGraphGenerationDisabled") : undefined}
            >
              <Network className="h-4 w-4" />
              {loading ? `${t("common.loading")}...` : t("knowledge.generateGraphNow")}
            </Button>
            <Link prefetch={false} href={`/${locale}/knowledge?projectId=${project.id}`} className="inline-flex items-center justify-center rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-4 py-2.5 text-sm font-semibold transition hover:bg-[color:var(--surface-hover)] ">
              <BookOpenText className="mr-2 h-4 w-4" />
              {t("knowledge.openHub")}
            </Link>
            <Link prefetch={false} href={`/${locale}/knowledge/graph?projectId=${project.id}`} className="inline-flex items-center justify-center rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-4 py-2.5 text-sm font-semibold transition hover:bg-[color:var(--surface-hover)] ">
              <Network className="mr-2 h-4 w-4" />
              {t("knowledge.openGraph")}
            </Link>
          </div>
        </div>

        {message ? <p className={messageTone === "danger" ? "text-sm text-rose-600 dark:text-rose-300" : messageTone === "success" ? "text-sm text-emerald-600 dark:text-emerald-300" : "text-sm text-[color:var(--muted)]"}>{message}</p> : null}
        <p className="text-xs leading-5 text-[color:var(--muted)]">{t("knowledge.graphQualityHint")}</p>

        {snapshot ? (
          <>
            <div className="grid gap-4 md:grid-cols-4">
              <div className="rounded-2xl border border-[color:var(--border)] p-4">
                <p className="text-xs uppercase tracking-[0.18em] text-[color:var(--muted)]">{t("knowledge.metrics.nodes")}</p>
                <p className="mt-2 text-2xl font-semibold">{snapshot.stats.nodeCount}</p>
              </div>
              <div className="rounded-2xl border border-[color:var(--border)] p-4">
                <p className="text-xs uppercase tracking-[0.18em] text-[color:var(--muted)]">{t("knowledge.metrics.relations")}</p>
                <p className="mt-2 text-2xl font-semibold">{snapshot.stats.relationCount}</p>
              </div>
              <div className="rounded-2xl border border-[color:var(--border)] p-4">
                <p className="text-xs uppercase tracking-[0.18em] text-[color:var(--muted)]">{t("knowledge.metrics.topics")}</p>
                <p className="mt-2 text-2xl font-semibold">{snapshot.stats.topicCount}</p>
              </div>
              <div className="rounded-2xl border border-[color:var(--border)] p-4">
                <p className="text-xs uppercase tracking-[0.18em] text-[color:var(--muted)]">{t("knowledge.metrics.primaryTopic")}</p>
                <p className="mt-2 text-sm font-semibold leading-6">{snapshot.analysis.primaryTopic}</p>
              </div>
            </div>

            <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
              <div className="space-y-6">
                <section className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-5 ">
                  <div className="flex items-center gap-2 text-amber-700 dark:text-amber-300">
                    <Sparkles className="h-4 w-4" />
                    <h3 className="font-semibold">{t("knowledge.analysis.title")}</h3>
                  </div>
                  <p className="mt-3 text-sm leading-6 text-[color:var(--muted)]">{snapshot.analysis.conclusion || project.summary.currentConclusion}</p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {snapshot.analysis.topics.map((topic) => <Badge key={topic}>{topic}</Badge>)}
                  </div>
                </section>

                <section className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-5 ">
                  <h3 className="font-semibold">{t("knowledge.analysis.viewpoints")}</h3>
                  <div className="mt-3 space-y-3">
                    {snapshot.analysis.viewpoints.map((viewpoint) => (
                      <div key={`${viewpoint.participantName}-${viewpoint.stance}`} className="rounded-2xl border border-[color:var(--border)] p-4">
                        <p className="font-semibold">{viewpoint.participantName}</p>
                        <p className="mt-1 text-sm text-[color:var(--muted)]">{viewpoint.stance}</p>
                        <p className="mt-2 text-sm leading-6 text-[color:var(--muted)]">{viewpoint.summary}</p>
                      </div>
                    ))}
                  </div>
                </section>
              </div>

              <div className="space-y-6">
                <section className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-5 ">
                  <h3 className="font-semibold">{t("knowledge.projectPanel.nodeHighlights")}</h3>
                  <div className="mt-3 grid gap-3">
                    {topNodes.map((node) => (
                      <Link prefetch={false} key={node.id} href={`/${locale}/knowledge/${encodeURIComponent(node.id)}`} className="rounded-2xl border border-[color:var(--border)] p-4 transition hover:border-amber-500/40">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-semibold">{node.title}</p>
                          <Badge>{t(`knowledge.nodeTypes.${node.type}`)}</Badge>
                          <Badge>{t(`knowledge.categories.${node.category}`)}</Badge>
                        </div>
                        <p className="mt-2 text-sm leading-6 text-[color:var(--muted)]">{node.summary}</p>
                      </Link>
                    ))}
                  </div>
                </section>

                <section className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-5 ">
                  <h3 className="font-semibold">{t("knowledge.projectPanel.relationHighlights")}</h3>
                  <div className="mt-3 space-y-3">
                    {topRelations.map((relation) => (
                      <div key={relation.id} className="rounded-2xl border border-[color:var(--border)] p-4">
                        <div className="flex flex-wrap gap-2">
                          <Badge>{t(`knowledge.relationTypes.${relation.type}`)}</Badge>
                        </div>
                        <p className="mt-2 text-sm leading-6 text-[color:var(--muted)]">{relation.note}</p>
                      </div>
                    ))}
                  </div>
                </section>
              </div>
            </div>
          </>
        ) : (
          <div className="rounded-2xl border border-dashed border-[color:var(--border)] p-6 text-sm text-[color:var(--muted)]">
            {loading ? `${t("common.loading")}...` : t("knowledge.empty")}
          </div>
        )}
      </Panel>
    </div>
  );
}
