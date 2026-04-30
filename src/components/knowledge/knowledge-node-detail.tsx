"use client";

import Link from "next/link";
import { useI18n } from "@/components/providers/i18n-provider";
import { Badge, Panel } from "@/components/ui/primitives";
import { AppLocale } from "@/lib/types";
import { KnowledgeNodeDetail } from "@/lib/knowledge/types";

export function KnowledgeNodeDetailView({
  locale,
  detail,
}: {
  locale: AppLocale;
  detail: KnowledgeNodeDetail;
}) {
  const { t } = useI18n();
  const { node, relations, connectedNodes } = detail;

  return (
    <div className="space-y-7 animate-fade-up">
      <Panel className="space-y-5 p-8 lg:p-10">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap gap-2">
              <Badge tone="accent">{t(`knowledge.nodeTypes.${node.type}`)}</Badge>
              <Badge>{t(`knowledge.categories.${node.category}`)}</Badge>
            </div>
            <h1 className="mt-3 font-display text-4xl font-semibold tracking-tight">{node.title}</h1>
            <p className="mt-2 max-w-4xl text-sm leading-7 text-[color:var(--muted)]">{node.summary}</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link prefetch={false} href={`/${locale}/knowledge`} className="inline-flex items-center justify-center rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-4 py-2.5 text-sm font-semibold transition hover:bg-[color:var(--surface-hover)]">
              {t("knowledge.backToHub")}
            </Link>
            <Link prefetch={false} href={`/${locale}/projects/${node.sourceProjectId}`} className="inline-flex items-center justify-center rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-4 py-2.5 text-sm font-semibold transition hover:bg-[color:var(--surface-hover)]">
              {t("knowledge.sourceProject")}
            </Link>
          </div>
        </div>
      </Panel>

      <div className="grid gap-6 xl:grid-cols-[0.92fr_1.08fr]">
        <Panel className="space-y-5 p-6">
          <h2 className="font-display text-2xl font-semibold">{t("knowledge.metadataTitle")}</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-[color:var(--muted)]">{t("knowledge.sourceProject")}</p>
              <p className="mt-2 font-semibold">{node.sourceProjectTitle}</p>
            </div>
            <div className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-[color:var(--muted)]">{t("knowledge.topics")}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {node.topics.map((topic) => <Badge key={topic}>{topic}</Badge>)}
              </div>
            </div>
            <div className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-4 sm:col-span-2">
              <p className="text-xs uppercase tracking-[0.18em] text-[color:var(--muted)]">{t("knowledge.tags")}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {node.tags.map((tag) => <Badge key={tag}>{tag}</Badge>)}
              </div>
            </div>
            <div className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-4 sm:col-span-2">
              <p className="text-xs uppercase tracking-[0.18em] text-[color:var(--muted)]">{t("knowledge.provenance")}</p>
              <p className="mt-2 text-sm leading-6 text-[color:var(--muted)]">{node.provenance.projectTitle} · {node.provenance.scenario}</p>
            </div>
          </div>
        </Panel>

        <div className="space-y-6">
          <Panel className="space-y-5 p-6">
            <h2 className="font-display text-2xl font-semibold">{t("knowledge.referencesTitle")}</h2>
            <div className="space-y-3">
              {node.evidenceReferences.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-[color:var(--border)] p-4 text-sm text-[color:var(--muted)]">{t("knowledge.empty")}</div>
              ) : node.evidenceReferences.map((reference) => (
                <div key={`${reference.entryId ?? reference.attachmentId ?? reference.label}`} className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-4">
                  <p className="font-semibold">{reference.label}</p>
                  {reference.excerpt ? <p className="mt-2 text-sm leading-6 text-[color:var(--muted)]">{reference.excerpt}</p> : null}
                </div>
              ))}
            </div>
          </Panel>

          <Panel className="space-y-5 p-6">
            <h2 className="font-display text-2xl font-semibold">{t("knowledge.connectedRelations")}</h2>
            <div className="space-y-3">
              {relations.map((relation) => (
                <div key={relation.id} className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-4">
                  <div className="flex flex-wrap gap-2">
                    <Badge>{t(`knowledge.relationTypes.${relation.type}`)}</Badge>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-[color:var(--muted)]">{relation.note}</p>
                </div>
              ))}
            </div>
          </Panel>

          <Panel className="space-y-5 p-6">
            <h2 className="font-display text-2xl font-semibold">{t("knowledge.connectedNodesTitle")}</h2>
            <div className="grid gap-3">
              {connectedNodes.map((connected) => (
                <Link prefetch={false} key={connected.id} href={`/${locale}/knowledge/${encodeURIComponent(connected.id)}`} className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-4 transition hover:border-[color:var(--brand-solid)]">
                  <div className="flex flex-wrap gap-2">
                    <p className="font-semibold">{connected.title}</p>
                    <Badge>{t(`knowledge.nodeTypes.${connected.type}`)}</Badge>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-[color:var(--muted)]">{connected.summary}</p>
                </Link>
              ))}
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}

