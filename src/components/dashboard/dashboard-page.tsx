import Link from "next/link";
import { ArrowRight, BrainCircuit } from "lucide-react";
import { getLocalizedHeroNarratives, getLocalizedShowcases } from "@/data/samples";
import { getNestedValue, dictionaries } from "@/lib/i18n";
import { KnowledgeHomepageSummary } from "@/lib/knowledge/types";
import { AppLocale, AppSettings, DashboardProjectSummary } from "@/lib/types";
import { resolveProfileDisplayName } from "@/lib/factories";
import { ProfileAvatar } from "@/components/ui/avatar";
import { Badge, LinkButton, Panel } from "@/components/ui/primitives";
import { DashboardBatchExport } from "@/components/dashboard/dashboard-batch-export";
import { DashboardProjectList } from "@/components/dashboard/dashboard-project-list";
import { DashboardDeferredSecondaryPanels } from "@/components/dashboard/dashboard-deferred-secondary-panels";
import { DashboardImportButton } from "@/components/dashboard/dashboard-import-button";
import { DashboardShowcasePanel } from "@/components/dashboard/dashboard-showcase-panel";
import { DashboardHomeRefreshController } from "@/components/dashboard/dashboard-home-refresh-controller";

function hashSeed(input: string) {
  return [...input].reduce((accumulator, character, index) => (accumulator * 31 + character.charCodeAt(0) + index) % 2147483647, 17);
}

function createSeededOrder<T>(items: T[], seed: string) {
  const ordered = [...items];
  let state = hashSeed(seed) || 17;
  for (let index = ordered.length - 1; index > 0; index -= 1) {
    state = (state * 48271) % 2147483647;
    const targetIndex = state % (index + 1);
    [ordered[index], ordered[targetIndex]] = [ordered[targetIndex], ordered[index]];
  }
  return ordered;
}

function translate(locale: AppLocale, path: string, params?: Record<string, string>) {
  const dictionary = dictionaries[locale] ?? dictionaries.en;
  const found = getNestedValue(dictionary, path);
  if (typeof found !== "string") {
    return path;
  }
  if (!params) {
    return found;
  }
  return Object.entries(params).reduce(
    (value, [key, replacement]) => value.replaceAll(`{${key}}`, replacement),
    found,
  );
}

function getShowcaseRefreshBucket() {
  return Math.floor(Date.now() / (1000 * 60 * 6));
}
function MetricCard({ label, value, tone = "default" }: { label: string; value: number; tone?: "default" | "accent" }) {
  return (
    <div className={`group rounded-xl border p-4 transition-all duration-200 ${tone === "accent" ? "border-[color:var(--brand-solid)]/25 bg-[color:var(--brand-soft)] text-[color:var(--brand-ink)]" : "border-[color:var(--border)] bg-[color:var(--surface-soft)] hover:border-[color:var(--brand-solid)]/20"}`}>
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[color:var(--muted)]">{label}</p>
      <p className="mt-2 text-2xl font-semibold tracking-tight">{value}</p>
    </div>
  );
}

export function DashboardPage({
  locale,
  projects,
  settings,
  knowledgeSummary,
}: {
  locale: AppLocale;
  projects: DashboardProjectSummary[];
  settings: AppSettings;
  knowledgeSummary: KnowledgeHomepageSummary;
}) {
  const t = (path: string, params?: Record<string, string>) => translate(locale, path, params);
  const reduceMotion = settings.appearancePreferences.reduceMotion;
  const profileDisplayName = resolveProfileDisplayName(
    locale,
    settings.profile.displayName,
    settings.profile.displayNameIsDefault,
  ).displayName;
  const heroSeed = `${locale}:${settings.profile.localIdentityId}:${new Date().toISOString().slice(0, 10)}`;
  const showcaseSeed = `${locale}:${settings.profile.localIdentityId}:${getShowcaseRefreshBucket()}`;
  const shuffledShowcases = createSeededOrder(getLocalizedShowcases(locale), `${showcaseSeed}:showcases`);
  const shuffledHeroes = createSeededOrder(getLocalizedHeroNarratives(locale), `${heroSeed}:heroes`);
  const heroIndex = Math.abs(hashSeed(`${heroSeed}:hero`)) % Math.max(shuffledHeroes.length, 1);
  const hero = shuffledHeroes[heroIndex] ?? shuffledHeroes[0];
  const showcase = shuffledShowcases[Math.abs(hashSeed(`${showcaseSeed}:showcase`)) % Math.max(shuffledShowcases.length, 1)] ?? shuffledShowcases[0];
  const exampleShowcases = shuffledShowcases.slice(0, 10);

  let totalEntries = 0;
  let totalParticipants = 0;
  let sampleCount = 0;
  let activePresence = 0;
  let liveRoomCount = 0;
  let publicProjectCount = 0;
  let inviteProjectCount = 0;
  let privateProjectCount = 0;
  const sampleProjects: DashboardProjectSummary[] = [];
  const publicProjects: DashboardProjectSummary[] = [];

  for (const project of projects) {
    totalEntries += project.entryCount;
    totalParticipants += project.participantCount;
    activePresence += project.activePresenceCount;
    if (project.isSample) {
      sampleCount += 1;
      if (sampleProjects.length < 6) sampleProjects.push(project);
    }
    if (project.roomStatus === "live") {
      liveRoomCount += 1;
    }
    if (project.visibility === "public") {
      publicProjectCount += 1;
      if (publicProjects.length < 4) publicProjects.push(project);
    } else if (project.visibility === "invite") {
      inviteProjectCount += 1;
    } else {
      privateProjectCount += 1;
    }
  }

  const userProjectCount = projects.length - sampleCount;
  const userFacingProjects = userProjectCount > 0 ? projects.filter((project) => !project.isSample) : projects;
  const latestProjects = userFacingProjects.slice(0, 6);
  const liveProject = projects.find((project) => project.roomStatus === "live") ?? projects[0];
  const recentKnowledgeNode = knowledgeSummary.recentNodes[0];

  return (
    <div className="space-y-6 animate-fade-up">
      <DashboardHomeRefreshController intervalMs={360000} />

      <section className="dashboard-hero-grid grid gap-6 xl:items-start">
        <Panel className="dashboard-hero-panel hero-surface relative h-full overflow-hidden p-8 lg:p-10 xl:self-stretch">
          {!reduceMotion ? (
            <div className="hero-ambient" aria-hidden>
              <span className="hero-ambient-orb hero-ambient-orb-a" />
              <span className="hero-ambient-orb hero-ambient-orb-b" />
              <span className="hero-ambient-orb hero-ambient-orb-c" />
            </div>
          ) : null}
          <div className="relative z-10 space-y-6">
            <div className="flex flex-wrap items-center gap-3">
              <ProfileAvatar profile={settings.profile} className="h-12 w-12 rounded-2xl text-sm" />
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="accent">{hero?.badge ?? t("dashboard.heroBadge")}</Badge>
                <Badge>{profileDisplayName}</Badge>
                <Badge>{t(`providersCatalog.${settings.provider.activeProviderId}.label`)}</Badge>
                <Badge>{t(`roomVisibility.${settings.collaborationPreferences.defaultVisibility}`)}</Badge>
              </div>
            </div>
            <div className="max-w-4xl space-y-4">
              <h1 className="font-display text-4xl font-semibold tracking-tight text-balance sm:text-5xl lg:text-[3.65rem] lg:leading-[1.02]">
                {hero?.title ?? t("dashboard.heroTitle")}
              </h1>
              <p className="max-w-3xl text-sm leading-8 text-[color:var(--muted)] sm:text-base">{hero?.body ?? t("dashboard.heroBody")}</p>
            </div>
            <div className="flex flex-wrap gap-4">
              <LinkButton href={`/${locale}/projects/new`}>{t("nav.newProject")}</LinkButton>
              <DashboardImportButton locale={locale} variant="ghost" className="gap-2" />
            </div>
            {hero?.prompt ? (
              <div className="rounded-xl border border-[color:var(--border)] border-l-2 border-l-[color:var(--brand-solid)] bg-[color:var(--surface-strong)] px-5 py-4 text-sm leading-6 text-[color:var(--muted)]">
                <span className="text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--brand-solid)]">{t("dashboard.heroPromptTitle")}</span>
                <p className="mt-2 text-[color:var(--foreground)]">{hero.prompt}</p>
              </div>
            ) : null}
            <div className="dashboard-metric-grid grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <MetricCard label={t("dashboard.statsProjects")} value={projects.length} tone="accent" />
              <MetricCard label={t("dashboard.statsEntries")} value={totalEntries} />
              <MetricCard label={t("dashboard.statsParticipants")} value={totalParticipants} />
              <MetricCard label={t("dashboard.statsKnowledgeNodes")} value={knowledgeSummary.totalNodes} />
            </div>
            <div className="dashboard-hero-support-grid grid gap-4 lg:grid-cols-2">
              <div className="motion-card rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-strong)] px-5 py-4">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--muted)]">{t("dashboard.statsLiveRooms")}</p>
                <div className="soft-scrollbar mt-2.5 min-h-[12rem] max-h-[16rem] overflow-y-auto overflow-x-hidden pr-1">
                  <p className="text-base font-semibold leading-6 [overflow-wrap:anywhere]">{liveProject?.title ?? t("dashboard.emptyTitle")}</p>
                  <p className="mt-1.5 text-sm leading-6 text-[color:var(--muted)] [overflow-wrap:anywhere]">
                    {liveProject ? `${t(`status.${liveProject.status}`)} · ${liveProject.entryCount} ${t("projectList.entries")}` : t("dashboard.emptyBody")}
                  </p>
                </div>
              </div>
              <div className="motion-card rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-strong)] px-5 py-4">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--muted)]">{t("knowledge.recentTitle")}</p>
                <div className="soft-scrollbar mt-2.5 min-h-[12rem] max-h-[16rem] overflow-y-auto overflow-x-hidden pr-1">
                  <p className="text-base font-semibold leading-6 [overflow-wrap:anywhere]">{recentKnowledgeNode?.title ?? t("knowledge.empty")}</p>
                  <p className="mt-1.5 text-sm leading-6 text-[color:var(--muted)] [overflow-wrap:anywhere]">{recentKnowledgeNode?.summary ?? t("dashboard.heroHint")}</p>
                </div>
              </div>
            </div>
            <div className="grid gap-3 rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface-soft)]/80 p-4 sm:grid-cols-2 xl:grid-cols-4">
              {[
                { label: t("dashboard.statsLiveRooms"), value: liveRoomCount, detail: liveProject?.title ?? t("dashboard.emptyTitle") },
                { label: t("dashboard.statsUserProjects"), value: userProjectCount, detail: `${sampleCount} ${t("dashboard.statsSamples")}` },
                { label: t("dashboard.visibilitySummaryTitle"), value: publicProjectCount + inviteProjectCount + privateProjectCount, detail: `${t("roomVisibility.public")} ${publicProjectCount} · ${t("roomVisibility.invite")} ${inviteProjectCount} · ${t("roomVisibility.private")} ${privateProjectCount}` },
                { label: t("dashboard.defaultProviderTitle"), value: t(`providersCatalog.${settings.provider.activeProviderId}.label`), detail: t("projectList.provider") },
              ].map((item) => (
                <div key={item.label} className="min-w-0 rounded-xl bg-[color:var(--surface-strong)] px-4 py-3">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[color:var(--muted)]">{item.label}</p>
                  <p className="mt-2 line-clamp-2 text-lg font-semibold leading-6 text-[color:var(--foreground)]">{item.value}</p>
                  <p className="mt-1 line-clamp-2 text-xs leading-5 text-[color:var(--muted)]">{item.detail}</p>
                </div>
              ))}
            </div>
          </div>
        </Panel>

        <div className="dashboard-hero-aside grid gap-6 xl:auto-rows-[minmax(0,auto)] xl:[grid-template-rows:auto_minmax(0,1fr)] xl:self-stretch">
          <DashboardShowcasePanel locale={locale} showcase={showcase} />

          <Panel className="flex h-full flex-col justify-between gap-6 p-7 lg:p-8">
            <div className="flex items-start gap-3">
              <div className="theme-icon-tile inline-flex h-12 w-12 items-center justify-center rounded-2xl">
                <BrainCircuit className="h-5 w-5" />
              </div>
              <div className="min-w-0 space-y-1.5">
                <h2 className="font-display text-2xl font-semibold tracking-tight">{t("dashboard.productHighlights")}</h2>
                <p className="text-sm leading-6 text-[color:var(--muted)]">{t("dashboard.heroHint")}</p>
              </div>
            </div>
            <div className="grid gap-3">
              {[
                t("dashboard.highlightOne"),
                t("dashboard.highlightTwo"),
                t("dashboard.highlightThree"),
                t("dashboard.highlightFour"),
                t("dashboard.highlightFive"),
                t("dashboard.highlightSix"),
              ].map((item, idx) => (
                <div key={item} className="flex items-start gap-3.5 rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface-soft)] px-4 py-3.5 text-sm leading-5 shadow-[0_4px_12px_rgba(var(--shadow-color)/0.03)]">
                  <span className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[color:var(--brand-soft)] text-[11px] font-bold text-[color:var(--brand-ink)]">{idx + 1}</span>
                  <span className="min-w-0 pt-0.5 text-[color:var(--foreground)] [overflow-wrap:anywhere]">{item}</span>
                </div>
              ))}
            </div>
            <div className="grid gap-3 pt-1 sm:grid-cols-3">
              <MetricCard label={t("dashboard.statsSamples")} value={sampleCount} />
              <MetricCard label={t("dashboard.statsPresence")} value={activePresence} />
              <MetricCard label={t("knowledge.metrics.relations")}
 value={knowledgeSummary.totalRelations} />
            </div>
          </Panel>
        </div>
      </section>

      <section className="dashboard-main-grid grid gap-5 xl:items-start">
        <Panel className="dashboard-projects-panel space-y-5 p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="font-display text-2xl font-semibold">{t("dashboard.recentProjects")}</h2>
              <p className="mt-1 text-sm leading-6 text-[color:var(--muted)]">{t("dashboard.recentProjectsHint")}</p>
            </div>
            <div className="flex items-center gap-2">
              <DashboardBatchExport projects={userFacingProjects} />
              <Link prefetch={false} href={`/${locale}/projects/new`} className="inline-flex items-center gap-2 text-sm font-semibold text-[color:var(--brand-solid)]">
                {t("nav.newProject")}
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </div>

          <DashboardProjectList projects={latestProjects} locale={locale} initialOrder={settings.projectOrder} sampleProjects={userProjectCount > 0 ? sampleProjects : []} />

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="motion-card rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-5 py-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--muted)]">{t("dashboard.statsUserProjects")}</p>
              <p className="mt-2.5 text-xl font-semibold">{userProjectCount}</p>
            </div>
            <div className="motion-card rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-5 py-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--muted)]">{t("dashboard.statsLiveRooms")}</p>
              <p className="mt-2.5 text-xl font-semibold">{liveRoomCount}</p>
            </div>
            <div className="motion-card rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-5 py-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--muted)]">{t("dashboard.defaultProviderTitle")}</p>
              <p className="mt-2.5 text-sm font-semibold leading-6">{t(`providersCatalog.${settings.provider.activeProviderId}.label`)}</p>
            </div>
          </div>
        </Panel>

        <div className="dashboard-secondary-shell">
          <DashboardDeferredSecondaryPanels
          locale={locale}
          publicProjectCount={publicProjectCount}
          inviteProjectCount={inviteProjectCount}
          privateProjectCount={privateProjectCount}
          publicProjects={publicProjects}
          knowledgeSummary={knowledgeSummary}
          exampleShowcases={exampleShowcases}
          sampleProjects={sampleProjects}
          collapseSamples={userProjectCount > 0}
          />
        </div>
      </section>
    </div>
  );
}
