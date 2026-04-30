export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { z } from "zod";
import { getProject, getSettings, upsertProject } from "@/lib/data/repository";
import { canArchivePrivateWorkspace, isProjectCreator } from "@/lib/project-access";
import { isLocale } from "@/lib/i18n";
import { AppLocale, DiscussionProject } from "@/lib/types";

const requestSchema = z.object({
  action: z.enum(["archive", "restore"]),
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
  const locale = isLocale((rawPayload as { locale?: string } | null)?.locale ?? "")
    ? ((rawPayload as { locale?: string }).locale as AppLocale)
    : settings.locale;

  if (!parsedPayload.success) {
    return NextResponse.json({
      error: localize(locale, {
        "zh-CN": "项目归档请求无效，请刷新后重试。",
        en: "The workspace archive request is invalid. Refresh and try again.",
        ja: "ワークスペースのアーカイブ要求が無効です。再読み込みしてやり直してください。",
        fr: "La requete d'archivage de l'espace de travail est invalide. Rechargez puis reessayez.",
      }),
    }, { status: 400 });
  }

  const project = await getProject(projectId, locale);

  if (!canArchivePrivateWorkspace(project)) {
    return NextResponse.json({
      error: localize(locale, {
        "zh-CN": "只有单人私有项目支持在这里归档或恢复。公开项目、多人项目和个人 AI 会话不在此入口处理。",
        en: "Only private single-user workspaces can be archived or restored here. Public workspaces, multi-user workspaces, and personal AI sessions are not handled by this endpoint.",
        ja: "ここでアーカイブまたは復元できるのは、非公開の単独ワークスペースのみです。公開ワークスペース、複数人ワークスペース、個人 AI セッションは対象外です。",
        fr: "Seuls les espaces de travail prives a utilisateur unique peuvent etre archives ou restaures ici. Les espaces publics, collaboratifs et les sessions IA personnelles ne sont pas geres par ce point d'entree.",
      }),
    }, { status: 409 });
  }

  if (!isProjectCreator(project, settings.profile.localIdentityId)) {
    return NextResponse.json({
      error: localize(locale, {
        "zh-CN": "只有单人私有项目的创建者可以归档或恢复这个工作区。",
        en: "Only the creator of a private single-user workspace can archive or restore it.",
        ja: "このワークスペースをアーカイブまたは復元できるのは、非公開の単独ワークスペースを作成した本人のみです。",
        fr: "Seul le createur d'un espace de travail prive a utilisateur unique peut l'archiver ou le restaurer.",
      }),
    }, { status: 403 });
  }

  const { action } = parsedPayload.data;
  const now = new Date().toISOString();
  const nextProject: DiscussionProject = {
    ...project,
    status: action === "archive" ? "archived" : "active",
    updatedAt: now,
    metadata: {
      ...project.metadata,
      archivedAt: action === "archive" ? (project.metadata.archivedAt ?? now) : undefined,
    },
  };

  const savedProject = await upsertProject(nextProject, locale, {
    skipAutoAnalyze: true,
    settingsOverride: settings,
  });

  return NextResponse.json({ project: savedProject });
}
