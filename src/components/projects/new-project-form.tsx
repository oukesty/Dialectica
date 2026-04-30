"use client";

import { startTransition, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { BrainCircuit, MessageSquareQuote, Pencil, Sparkles, Trash2, Users } from "lucide-react";
import { useI18n } from "@/components/providers/i18n-provider";
import { Badge, Button, Panel } from "@/components/ui/primitives";
import { applyProjectTemplatePayload, getBuiltinStarterTemplates, type UserProjectTemplate } from "@/lib/project-templates-shared";
import { AppLocale, DiscussionProject, DISPLAY_LOCALE_ORDER, LOCALE_AUTONYMS } from "@/lib/types";

const fieldClass = "form-field";

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

function parseTags(input: string) {
  return input
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function normalizeProjectCreationScenario(scenario: DiscussionProject["scenario"]) {
  return scenario === "ai-dialogue" ? "discussion" : scenario;
}

export function NewProjectForm({
  locale,
  initialProject,
  currentIdentityId,
  customTemplates = [],
}: {
  locale: AppLocale;
  initialProject: DiscussionProject;
  currentIdentityId: string;
  customTemplates?: UserProjectTemplate[];
}) {
  const { t } = useI18n();
  const router = useRouter();
  const blueprints = useMemo(
    () => getBuiltinStarterTemplates(locale),
    [locale],
  );
  const rotationSeed = useMemo(() => `${locale}:${initialProject.id}:${new Date().toISOString().slice(0, 10)}`, [initialProject.id, locale]);
  const shuffledBlueprints = useMemo(() => createSeededOrder(blueprints, rotationSeed), [blueprints, rotationSeed]);
  const [project, setProject] = useState<DiscussionProject>(() => ({
    ...initialProject,
    scenario: normalizeProjectCreationScenario(initialProject.scenario),
  }));
  const [userTemplates, setUserTemplates] = useState<UserProjectTemplate[]>(customTemplates);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const featuredIndex = useMemo(() => Math.abs(hashSeed(`${rotationSeed}:featured`)) % Math.max(shuffledBlueprints.length, 1), [rotationSeed, shuffledBlueprints.length]);
  const featured = shuffledBlueprints[featuredIndex] ?? shuffledBlueprints[0];
  const myTemplates = userTemplates.filter((template) => template.ownerIdentityId === currentIdentityId);
  const sharedTemplates = userTemplates.filter((template) => template.visibility === "shared" && template.ownerIdentityId !== currentIdentityId);

  const applyBlueprint = (blueprint: (typeof blueprints)[number]) => {
    setProject((current) => applyProjectTemplatePayload(current, blueprint.payload));
  };

  const applyUserTemplate = (template: UserProjectTemplate) => {
    setProject((current) => applyProjectTemplatePayload(current, template.payload));
  };

  const updateUserTemplate = async (template: UserProjectTemplate, patch: Partial<Pick<UserProjectTemplate, "title" | "description" | "visibility">>) => {
    setError(null);
    const response = await fetch("/api/project-templates", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ templateId: template.id, ...patch }),
    });
    if (!response.ok) {
      throw new Error(t("newProject.templateUpdateFailed"));
    }
    const data = await response.json() as { template: UserProjectTemplate };
    setUserTemplates((current) => current.map((item) => item.id === data.template.id ? data.template : item));
  };

  const editUserTemplate = async (template: UserProjectTemplate) => {
    const nextTitle = window.prompt(t("newProject.templateNamePrompt"), template.title);
    if (nextTitle === null) return;
    const nextDescription = window.prompt(t("newProject.templateDescriptionPrompt"), template.description);
    if (nextDescription === null) return;
    try {
      await updateUserTemplate(template, { title: nextTitle, description: nextDescription });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("newProject.templateUpdateFailed"));
    }
  };

  const toggleTemplateVisibility = async (template: UserProjectTemplate) => {
    try {
      await updateUserTemplate(template, { visibility: template.visibility === "shared" ? "private" : "shared" });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("newProject.templateUpdateFailed"));
    }
  };

  const deleteUserTemplate = async (template: UserProjectTemplate) => {
    if (!window.confirm(t("newProject.templateDeleteConfirm"))) return;
    setError(null);
    const response = await fetch("/api/project-templates", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ templateId: template.id }),
    });
    if (!response.ok) {
      setError(t("newProject.templateDeleteFailed"));
      return;
    }
    setUserTemplates((current) => current.filter((item) => item.id !== template.id));
  };

  return (
    <div className="mx-auto max-w-[88rem] space-y-7 animate-fade-up">
      <Panel className="hero-surface overflow-hidden p-8 lg:p-10">
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.08fr)_minmax(22rem,0.92fr)] xl:items-end">
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="accent">{t("newProject.title")}</Badge>
              <Badge>{t("common.aiReady")}</Badge>
              <Badge>{t(`scenario.${project.scenario}`)}</Badge>
            </div>
            <div className="space-y-3">
              <h1 className="font-display text-4xl font-semibold tracking-tight sm:text-5xl">{t("newProject.title")}</h1>
              <p className="max-w-3xl text-sm leading-7 text-[color:var(--muted)] sm:text-base">{t("newProject.subtitle")}</p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Button className="gap-2" onClick={() => featured && applyBlueprint(featured)}>
                <Sparkles className="h-4 w-4" />
                {t("newProject.useTemplate")}
              </Button>
              <Button variant="ghost" onClick={() => setProject(initialProject)}>
                {t("newProject.blankStarter")}
              </Button>
            </div>
          </div>

          <div className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface-strong)] p-5 shadow-panel">
            <div className="grid gap-3 md:min-h-[5.5rem] md:grid-cols-[minmax(0,1fr)_auto] md:items-start">
              <div className="min-w-0">
                <p className="text-xs uppercase tracking-[0.18em] text-[color:var(--muted)]">{t("newProject.templatesTitle")}</p>
                <h2 className="mt-2 min-h-[3.4rem] font-display text-2xl font-semibold tracking-tight">{featured?.title}</h2>
              </div>
              <div className="flex min-w-[9rem] shrink-0 justify-start md:justify-end">
                {featured ? <Badge>{t(`scenario.${featured.payload.scenario}`)}</Badge> : null}
              </div>
            </div>
            <p className="mt-3 text-sm leading-6 text-[color:var(--muted)]">{featured?.description}</p>
            <div className="mt-4 rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-4 py-3 text-sm leading-6 text-[color:var(--muted)]">
              {featured?.goal}
            </div>
          </div>
        </div>
      </Panel>

      <Panel className="space-y-5 p-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-2xl font-semibold">{t("newProject.templatesTitle")}</h2>
            <p className="mt-1 text-sm leading-6 text-[color:var(--muted)]">{t("newProject.templatesHint")}</p>
          </div>
          <Badge>{shuffledBlueprints.length + userTemplates.length}</Badge>
        </div>
        {myTemplates.length > 0 || sharedTemplates.length > 0 ? (
          <div className="grid gap-5">
            {myTemplates.length > 0 ? (
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-[color:var(--brand-solid)]">{t("newProject.myTemplates")}</p>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {myTemplates.map((template) => (
                    <button key={template.id} type="button" onClick={() => applyUserTemplate(template)} className="rounded-xl border border-[color:var(--brand-solid)]/30 bg-[color:var(--brand-soft)] p-3 text-left transition hover:border-[color:var(--brand-solid)]">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-[color:var(--brand-ink)]">{template.title}</p>
                          <p className="mt-1 line-clamp-2 text-xs text-[color:var(--muted)]">{template.description}</p>
                        </div>
                        <Badge>{template.visibility === "shared" ? t("newProject.templateShared") : t("newProject.templatePrivate")}</Badge>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        <span role="button" tabIndex={0} onClick={(event) => { event.stopPropagation(); void editUserTemplate(template); }} className="inline-flex items-center gap-1 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-2 py-1 text-[11px] font-semibold">
                          <Pencil className="h-3 w-3" />{t("common.edit")}
                        </span>
                        <span role="button" tabIndex={0} onClick={(event) => { event.stopPropagation(); void toggleTemplateVisibility(template); }} className="inline-flex items-center rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-2 py-1 text-[11px] font-semibold">
                          {template.visibility === "shared" ? t("newProject.templateMakePrivate") : t("newProject.templateMakeShared")}
                        </span>
                        <span role="button" tabIndex={0} onClick={(event) => { event.stopPropagation(); void deleteUserTemplate(template); }} className="inline-flex items-center gap-1 rounded-lg border border-red-500/30 bg-red-500/10 px-2 py-1 text-[11px] font-semibold text-red-600 dark:text-red-300">
                          <Trash2 className="h-3 w-3" />{t("common.delete")}
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            {sharedTemplates.length > 0 ? (
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-[color:var(--muted)]">{t("newProject.sharedTemplates")}</p>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {sharedTemplates.map((template) => (
                    <button key={template.id} type="button" onClick={() => applyUserTemplate(template)} className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-3 text-left transition hover:border-[color:var(--brand-solid)]">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold">{template.title}</p>
                          <p className="mt-1 line-clamp-2 text-xs text-[color:var(--muted)]">{template.description}</p>
                        </div>
                        <Badge>{t("newProject.templateShared")}</Badge>
                      </div>
                      {template.ownerDisplayName ? <p className="mt-2 text-[11px] text-[color:var(--muted)]">{t("newProject.templateOwner", { name: template.ownerDisplayName })}</p> : null}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
        <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-4">
          {shuffledBlueprints.map((blueprint) => (
            <button
              key={blueprint.id}
              type="button"
              onClick={() => applyBlueprint(blueprint)}
              className="motion-card rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-5 text-left transition-all duration-200 hover:border-[color:var(--brand-solid)]/30 hover:bg-[color:var(--surface-hover)] hover:shadow-[0_4px_12px_rgba(var(--shadow-color)/0.06)]"
            >
              <div className="flex items-center justify-between gap-3">
                <p className="font-semibold">{blueprint.title}</p>
                <Badge>{t(`scenario.${blueprint.payload.scenario}`)}</Badge>
              </div>
              <p className="mt-3 text-sm leading-6 text-[color:var(--muted)]">{blueprint.description}</p>
            </button>
          ))}
        </div>
      </Panel>

      <Panel className="space-y-6 p-8">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="grid gap-5">
            <label className="space-y-2">
              <span className="text-sm font-medium">{t("project.overviewCard.title")}</span>
              <input className={fieldClass} value={project.title} onChange={(event) => setProject({ ...project, title: event.target.value })} placeholder={t("project.titlePlaceholder")} />
            </label>

            <label className="space-y-2">
              <span className="text-sm font-medium">{t("project.descriptionLabel")}</span>
              <textarea className={`${fieldClass} min-h-32`} value={project.description} onChange={(event) => setProject({ ...project, description: event.target.value })} placeholder={t("project.descriptionPlaceholder")} />
            </label>

            <label className="space-y-2">
              <span className="text-sm font-medium">{t("project.goalLabel")}</span>
              <textarea className={`${fieldClass} min-h-24`} value={project.goal} onChange={(event) => setProject({ ...project, goal: event.target.value, room: { ...project.room, session: { ...project.room.session, goal: event.target.value } } })} placeholder={t("project.goalPlaceholder")} />
            </label>
          </div>

          <div className="grid gap-5">
            <div className="grid gap-5 sm:grid-cols-2">
              <label className="space-y-2">
                <span className="text-sm font-medium">{t("project.scenario")}</span>
                <select className={fieldClass} value={project.scenario} onChange={(event) => setProject({ ...project, scenario: event.target.value as DiscussionProject["scenario"] })}>
                  <option value="debate">{t("scenario.debate")}</option>
                  <option value="discussion">{t("scenario.discussion")}</option>
                  <option value="meeting">{t("scenario.meeting")}</option>
                  <option value="negotiation">{t("scenario.negotiation")}</option>
                  <option value="document-driven-discussion">{t("scenario.document-driven-discussion")}</option>
                </select>
              </label>
              <label className="space-y-2">
                <span className="text-sm font-medium">{t("project.language")}</span>
                <select className={fieldClass} value={project.language} onChange={(event) => setProject({ ...project, language: event.target.value as AppLocale })}>
                  {DISPLAY_LOCALE_ORDER.map((item) => (
                    <option key={`project-language-${item}`} value={item}>{LOCALE_AUTONYMS[item]}</option>
                  ))}
                </select>
              </label>
            </div>

            <div className="grid gap-5 sm:grid-cols-2">
              <label className="space-y-2">
                <span className="text-sm font-medium">{t("newProject.roomTitleLabel")}</span>
                <input className={fieldClass} value={project.room.session.title} onChange={(event) => setProject({ ...project, room: { ...project.room, session: { ...project.room.session, title: event.target.value } } })} placeholder={t("newProject.roomTitlePlaceholder")} />
              </label>
              <label className="space-y-2">
                <span className="text-sm font-medium">{t("newProject.roomVisibility")}</span>
                <select className={fieldClass} value={project.room.visibility} onChange={(event) => setProject({ ...project, room: { ...project.room, visibility: event.target.value as DiscussionProject["room"]["visibility"] } })}>
                  <option value="private">{t("roomVisibility.private")}</option>
                  <option value="invite">{t("roomVisibility.invite")}</option>
                  <option value="public">{t("roomVisibility.public")}</option>
                </select>
              </label>
            </div>

            <label className="space-y-2">
              <span className="text-sm font-medium">{t("project.tags")}</span>
              <input className={fieldClass} value={project.tags.join(", ")} onChange={(event) => setProject({ ...project, tags: parseTags(event.target.value) })} placeholder={t("project.tagsPlaceholder")} />
            </label>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-4">
                <div className="flex items-start gap-3">
                  <BrainCircuit className="mt-1 h-5 w-5 text-[color:var(--brand-solid)]" />
                  <div>
                    <p className="font-semibold">{t("dashboard.workflowThreeTitle")}</p>
                    <p className="mt-1 text-sm leading-6 text-[color:var(--muted)]">{t("dashboard.workflowThreeBody")}</p>
                  </div>
                </div>
              </div>
              <div className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-4">
                <div className="flex items-start gap-3">
                  <Users className="mt-1 h-5 w-5 text-[color:var(--brand-solid)]" />
                  <div>
                    <p className="font-semibold">{t("project.participantsCard.title")}</p>
                    <p className="mt-1 text-sm leading-6 text-[color:var(--muted)]">{t("project.participantsCard.subtitle")}</p>
                  </div>
                </div>
              </div>
              <div className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-4">
                <div className="flex items-start gap-3">
                  <MessageSquareQuote className="mt-1 h-5 w-5 text-[color:var(--brand-solid)]" />
                  <div>
                    <p className="font-semibold">{t("project.captureCard.title")}</p>
                    <p className="mt-1 text-sm leading-6 text-[color:var(--muted)]">{t("newProject.createHint")}</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div className="rounded-2xl border border-dashed border-[color:var(--border)] bg-[color:var(--surface-soft)] p-4 text-sm leading-6 text-[color:var(--muted)]">
          {t("newProject.createHint")}
        </div>

        <div className="flex flex-wrap gap-3">
          <Button
            onClick={() => {
              setSaving(true);
              setError(null);
              startTransition(async () => {
                try {
                  const response = await fetch("/api/projects", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(project),
                  });
                  if (!response.ok) {
                    throw new Error(t("errors.saveFailed"));
                  }
                  const data = (await response.json()) as { project: { id: string } };
                  router.push(`/${locale}/projects/${data.project.id}`);
                } catch (caught) {
                  setError(caught instanceof Error ? caught.message : t("errors.saveFailed"));
                } finally {
                  setSaving(false);
                }
              });
            }}
          >
            {saving ? `${t("common.loading")}...` : t("common.create")}
          </Button>
          <Button variant="ghost" onClick={() => router.push(`/${locale}`)}>
            {t("common.cancel")}
          </Button>
        </div>
        {error ? <p className="text-sm text-rose-600 dark:text-rose-300">{error}</p> : null}
      </Panel>
    </div>
  );
}
