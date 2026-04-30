export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { z } from "zod";
import { deleteCollaborationArtifacts } from "@/lib/collaboration/store";
import { deleteProject, getProject, getSettings, upsertProject } from "@/lib/data/repository";
import { isLocale } from "@/lib/i18n";
import { deleteProjectKnowledge } from "@/lib/knowledge/service";
import { getProjectAccessState } from "@/lib/project-access";
import { AppLocale } from "@/lib/types";

const requestSchema = z.object({
  action: z.enum(["archive", "restore", "delete", "purge"]),
  locale: z.string().optional(),
});

function localize(locale: AppLocale, values: Partial<Record<AppLocale, string>> & { en: string }) {
  return values[locale] ?? values.en;
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await context.params;
  const settings = await getSettings();
  const rawPayload = await request.json().catch(() => null);
  const parsedPayload = requestSchema.safeParse(rawPayload);
  const locale = isLocale((rawPayload as { locale?: string } | null)?.locale ?? "") ? ((rawPayload as { locale?: string }).locale as AppLocale) : settings.locale;

  if (!parsedPayload.success) {
    return NextResponse.json({
      error: localize(locale, {
        "zh-CN": "会话管理请求无效，请刷新后重试。",
        en: "The session management request is invalid. Refresh and try again.",
        ja: "セッション管理リクエストが無効です。再読み込みしてやり直してください。",
        fr: "La requete de gestion de session est invalide. Rechargez la page puis reessayez.",
      }),
    }, { status: 400 });
  }

  const project = await getProject(projectId, locale, { includePendingDeletion: true });
  const access = getProjectAccessState(project, settings);

  if (project.scenario !== "ai-dialogue" || project.metadata.isSample) {
    return NextResponse.json({
      error: localize(locale, {
        "zh-CN": "只有个人 AI 工作台支持这项历史管理操作。",
        en: "Only personal AI workspaces support this history management action.",
        ja: "この履歴管理操作は個人 AI ワークスペースでのみ利用できます。",
        fr: "Cette action de gestion d'historique n'est disponible que pour les espaces IA personnels.",
      }),
    }, { status: 409 });
  }

  if (!access.canEditWorkspace || access.ownedParticipantIds.length === 0) {
    return NextResponse.json({
      error: localize(locale, {
        "zh-CN": "当前本地身份不能管理这个个人 AI 工作台。",
        en: "Your current local profile cannot manage this personal AI workspace.",
        ja: "現在のローカルプロフィールではこの個人 AI ワークスペースを管理できません。",
        fr: "Votre profil local actuel ne peut pas gerer cet espace IA personnel.",
      }),
    }, { status: 403 });
  }

  const { action } = parsedPayload.data;

  if (action === "purge" || action === "delete") {
    await Promise.all([
      deleteProject(projectId),
      deleteCollaborationArtifacts(projectId),
      deleteProjectKnowledge(projectId),
    ]);
    return NextResponse.json({ projectId, purged: true });
  }

  const now = new Date().toISOString();
  const nextStatus: "active" | "archived" = action === "archive" ? "archived" : "active";
  const nextProject: typeof project = {
    ...project,
    status: nextStatus,
    updatedAt: now,
    metadata: {
      ...project.metadata,
      archivedAt: action === "restore" ? undefined : project.metadata.archivedAt ?? now,
      pendingDeletionAt: undefined,
      lastActiveAt: now,
    },
  };

  if (action === "restore") {
    nextProject.metadata.archivedAt = undefined;
    nextProject.metadata.pendingDeletionAt = undefined;
  }

  const savedProject = await upsertProject(nextProject, locale, {
    skipAutoAnalyze: true,
    settingsOverride: settings,
  });

  return NextResponse.json({ project: savedProject });
}
