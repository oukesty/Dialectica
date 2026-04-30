"use client";

import { useI18n } from "@/components/providers/i18n-provider";
import { Avatar } from "@/components/ui/avatar";
import { Badge, Button, Panel } from "@/components/ui/primitives";
import { resolveParticipantAvatar } from "@/lib/avatar";
import { formatDateTime } from "@/lib/format";
import { KnowledgeProjectSnapshot } from "@/lib/knowledge/types";
import { AppLocale, AppSettings, DiscussionProject } from "@/lib/types";

export function ProjectReport({
  locale,
  project,
  settings,
  knowledge,
}: {
  locale: AppLocale;
  project: DiscussionProject;
  settings: AppSettings;
  knowledge: KnowledgeProjectSnapshot | null;
}) {
  const { t } = useI18n();
  const showDiagnostics = settings.privacy.shareDiagnostics;

  return (
    <div className="print-surface mx-auto max-w-6xl space-y-6 px-6 py-8">
      <div className="no-print flex justify-end">
        <Button onClick={() => window.print()}>{t("report.print")}</Button>
      </div>

      <Panel className="space-y-4 bg-white p-8 text-slate-900 shadow-none">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="font-display text-4xl font-semibold">{project.title}</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">{project.description}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge>{t(`scenario.${project.scenario}`)}</Badge>
            <Badge>{t(`languages.${project.language}`)}</Badge>
            <Badge>{t(`status.${project.status}`)}</Badge>
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <div><p className="text-xs uppercase tracking-[0.18em] text-slate-500">{t("common.createdAt")}</p><p className="mt-2 text-sm font-medium">{formatDateTime(project.createdAt, locale)}</p></div>
          <div><p className="text-xs uppercase tracking-[0.18em] text-slate-500">{t("common.updatedAt")}</p><p className="mt-2 text-sm font-medium">{formatDateTime(project.updatedAt, locale)}</p></div>
          <div><p className="text-xs uppercase tracking-[0.18em] text-slate-500">{t("project.participantsCard.title")}</p><p className="mt-2 text-sm font-medium">{project.participants.length}</p></div>
          <div><p className="text-xs uppercase tracking-[0.18em] text-slate-500">{t("project.captureCard.title")}</p><p className="mt-2 text-sm font-medium">{project.entries.length}</p></div>
        </div>
      </Panel>

      <div className="grid gap-6 xl:grid-cols-[0.85fr_1.15fr]">
        <Panel className="bg-white p-8 text-slate-900 shadow-none">
          <h2 className="font-display text-2xl font-semibold">{t("report.participants")}</h2>
          <div className="mt-4 grid gap-4">
            {project.participants.map((participant) => (
              <div key={participant.id} className="rounded-2xl border border-slate-200 p-4">
                <div className="flex items-center gap-3">
                  <Avatar
                    name={participant.name}
                    label={resolveParticipantAvatar(participant, settings.profile).label}
                    preset={resolveParticipantAvatar(participant, settings.profile).preset}
                    imageDataUrl={resolveParticipantAvatar(participant, settings.profile).imageDataUrl}
                    className="h-12 w-12 rounded-2xl text-sm"
                  />
                  <div>
                    <p className="font-semibold">{participant.name}</p>
                    <p className="text-sm text-slate-600">{participant.stance}</p>
                    <p className="text-xs text-slate-500">{t(`roles.${participant.role}`)} / {t(`collaborationRoles.${participant.collaborationRole}`)}</p>
                  </div>
                </div>
                <p className="mt-3 text-sm leading-6 text-slate-600">{participant.bio}</p>
              </div>
            ))}
          </div>
        </Panel>

        <Panel className="bg-white p-8 text-slate-900 shadow-none">
          <h2 className="font-display text-2xl font-semibold">{t("report.summary")}</h2>
          <div className="mt-5 space-y-5">
            <section>
              <h3 className="font-semibold">{t("project.summaryCard.overview")}</h3>
              <p className="mt-2 text-sm leading-6 text-slate-600">{project.summary.overview}</p>
            </section>
            <section>
              <h3 className="font-semibold">{t("project.summaryCard.topics")}</h3>
              <ul className="mt-2 space-y-2 text-sm text-slate-600">{project.summary.coreTopics.map((item) => <li key={item}>{item}</li>)}</ul>
            </section>
            <section>
              <h3 className="font-semibold">{t("project.summaryCard.claims")}</h3>
              <ul className="mt-2 space-y-2 text-sm text-slate-600">{project.summary.majorClaims.map((item) => <li key={item}>{item}</li>)}</ul>
            </section>
            <section>
              <h3 className="font-semibold">{t("project.summaryCard.evidence")}</h3>
              <ul className="mt-2 space-y-2 text-sm text-slate-600">{project.summary.keyEvidence.map((item) => <li key={item}>{item}</li>)}</ul>
            </section>
            <section>
              <h3 className="font-semibold">{t("project.summaryCard.conclusion")}</h3>
              <p className="mt-2 text-sm leading-6 text-slate-600">{project.summary.currentConclusion}</p>
            </section>
          </div>
        </Panel>
      </div>

      <Panel className="bg-white p-8 text-slate-900 shadow-none">
        <h2 className="font-display text-2xl font-semibold">{t("knowledge.reportTitle")}</h2>
        {knowledge ? (
          <>
            <div className="mt-4 grid gap-4 lg:grid-cols-3">
              <div className="rounded-2xl border border-slate-200 p-4"><p className="text-xs uppercase tracking-[0.18em] text-slate-500">{t("knowledge.metrics.nodes")}</p><p className="mt-2 text-2xl font-semibold">{knowledge.stats.nodeCount}</p></div>
              <div className="rounded-2xl border border-slate-200 p-4"><p className="text-xs uppercase tracking-[0.18em] text-slate-500">{t("knowledge.metrics.relations")}</p><p className="mt-2 text-2xl font-semibold">{knowledge.stats.relationCount}</p></div>
              <div className="rounded-2xl border border-slate-200 p-4"><p className="text-xs uppercase tracking-[0.18em] text-slate-500">{t("knowledge.metrics.primaryTopic")}</p><p className="mt-2 text-sm font-semibold leading-6">{knowledge.analysis.primaryTopic}</p></div>
            </div>
            <div className="mt-5 grid gap-5 lg:grid-cols-2">
              <section>
                <h3 className="font-semibold">{t("knowledge.analysis.viewpoints")}</h3>
                <ul className="mt-2 space-y-2 text-sm text-slate-600">{knowledge.analysis.viewpoints.map((item) => <li key={`${item.participantName}-${item.stance}`}>{item.participantName}: {item.stance}</li>)}</ul>
              </section>
              <section>
                <h3 className="font-semibold">{t("knowledge.connectedRelations")}</h3>
                <ul className="mt-2 space-y-2 text-sm text-slate-600">{knowledge.relations.slice(0, 8).map((item) => <li key={item.id}>{t(`knowledge.relationTypes.${item.type}`)}: {item.note}</li>)}</ul>
              </section>
            </div>
          </>
        ) : (
          <div className="mt-4 rounded-2xl border border-dashed border-slate-200 p-6 text-sm text-slate-600">
            {t("knowledge.empty")}
          </div>
        )}
      </Panel>

      <Panel className="bg-white p-8 text-slate-900 shadow-none">
        <h2 className="font-display text-2xl font-semibold">{t("report.issueTracker")}</h2>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          {project.insights.items.map((item) => (
            <article key={item.id} className="rounded-2xl border border-slate-200 p-4">
              <div className="flex flex-wrap gap-2">
                <Badge>{t(`insightCategories.${item.category}`)}</Badge>
                <Badge>{t(`insightStatus.${item.status}`)}</Badge>
              </div>
              <h3 className="mt-3 font-semibold">{item.title}</h3>
              <p className="mt-2 text-sm leading-6 text-slate-600">{item.detail}</p>
            </article>
          ))}
        </div>
      </Panel>

      {showDiagnostics ? (
        <div className="grid gap-6 xl:grid-cols-[1fr_1fr]">
          <Panel className="bg-white p-8 text-slate-900 shadow-none">
            <h2 className="font-display text-2xl font-semibold">{t("report.collaboration")}</h2>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div><p className="text-xs uppercase tracking-[0.18em] text-slate-500">{t("project.roomCard.sessionStatus")}</p><p className="mt-2 text-sm font-medium">{t(`roomSessionStatus.${project.room.session.status}`)}</p></div>
              <div><p className="text-xs uppercase tracking-[0.18em] text-slate-500">{t("project.roomCard.visibility")}</p><p className="mt-2 text-sm font-medium">{t(`roomVisibility.${project.room.visibility}`)}</p></div>
              <div><p className="text-xs uppercase tracking-[0.18em] text-slate-500">{t("project.roomCard.transport")}</p><p className="mt-2 text-sm font-medium">{t(`roomTransport.${project.room.session.sync.transport}`)}</p></div>
              <div><p className="text-xs uppercase tracking-[0.18em] text-slate-500">{t("project.roomCard.syncStatus")}</p><p className="mt-2 text-sm font-medium">{t(`roomSyncStatus.${project.room.session.sync.status}`)}</p></div>
            </div>
          </Panel>

          <Panel className="bg-white p-8 text-slate-900 shadow-none">
            <h2 className="font-display text-2xl font-semibold">{t("report.providerPanel")}</h2>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div><p className="text-xs uppercase tracking-[0.18em] text-slate-500">{t("common.provider")}</p><p className="mt-2 text-sm font-medium">{t(`providersCatalog.${project.providerSnapshot.providerId}.label`)}</p></div>
              <div><p className="text-xs uppercase tracking-[0.18em] text-slate-500">{t("common.model")}</p><p className="mt-2 text-sm font-medium">{project.providerSnapshot.model}</p></div>
              <div><p className="text-xs uppercase tracking-[0.18em] text-slate-500">{t("project.workspaceSettings.generated")}</p><p className="mt-2 text-sm font-medium">{formatDateTime(project.providerSnapshot.generatedAt, locale)}</p></div>
              <div><p className="text-xs uppercase tracking-[0.18em] text-slate-500">{t("project.workspaceSettings.version")}</p><p className="mt-2 text-sm font-medium">{project.providerSnapshot.version}</p></div>
            </div>
          </Panel>
        </div>
      ) : (
        <Panel className="bg-white p-8 text-slate-900 shadow-none">
          <h2 className="font-display text-2xl font-semibold">{t("report.providerPanel")}</h2>
          <p className="mt-3 text-sm leading-6 text-slate-600">{t("report.diagnosticsHidden")}</p>
        </Panel>
      )}

      <Panel className="bg-white p-8 text-slate-900 shadow-none">
        <h2 className="font-display text-2xl font-semibold">{t("report.timeline")}</h2>
        <div className="mt-4 space-y-4">
          {project.entries.map((entry) => {
            const participant = project.participants.find((candidate) => candidate.id === entry.participantId);
            return (
              <article key={entry.id} className="rounded-2xl border border-slate-200 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-semibold">{participant?.name ?? t("common.none")}</p>
                    <p className="text-xs text-slate-500">{formatDateTime(entry.occurredAt, locale)}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Badge>{t(`entryKinds.${entry.kind}`)}</Badge>
                    <Badge>{t(`sources.${entry.source}`)}</Badge>
                  </div>
                </div>
                <p className="mt-3 text-sm leading-6 text-slate-600">{entry.content}</p>
              </article>
            );
          })}
        </div>
      </Panel>
    </div>
  );
}
