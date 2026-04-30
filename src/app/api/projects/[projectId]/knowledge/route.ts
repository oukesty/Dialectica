export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { z } from "zod";
import { getProject, getSettings } from "@/lib/data/repository";
import { getProjectAccessState } from "@/lib/project-access";
import { isLocale } from "@/lib/i18n";
import { extractAndSaveProjectKnowledge, getProjectKnowledgeSnapshot } from "@/lib/knowledge/service";
import { AppLocale } from "@/lib/types";

const postSchema = z.object({
  generateGraphLinks: z.boolean().optional().default(false),
});

function localize(locale: AppLocale, values: Partial<Record<AppLocale, string>> & { en: string }) {
  return values[locale] ?? values.en;
}

export async function GET(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await context.params;
  const settings = await getSettings();
  const url = new URL(request.url);
  const locale = isLocale(url.searchParams.get("locale") ?? "") ? (url.searchParams.get("locale") as AppLocale) : settings.locale;
  const project = await getProject(projectId, locale);
  const access = getProjectAccessState(project, settings);

  if (!access.canRead) {
    return NextResponse.json({
      error: localize(project.language, {
        "zh-CN": "当前身份无权查看这个项目的知识快照。",
        en: "Your current local profile cannot view this project's knowledge snapshot.",
        ja: "現在のローカルプロフィールではこのプロジェクトの知識スナップショットを表示できません。",
        fr: "Le profil local actuel ne peut pas consulter le snapshot de connaissance de ce projet.",
      }),
    }, { status: 404 });
  }

  const snapshot = await getProjectKnowledgeSnapshot(projectId, locale);
  return NextResponse.json({ snapshot });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await context.params;
  const settings = await getSettings();
  const url = new URL(request.url);
  const locale = isLocale(url.searchParams.get("locale") ?? "") ? (url.searchParams.get("locale") as AppLocale) : settings.locale;
  const project = await getProject(projectId, locale);
  const access = getProjectAccessState(project, settings);

  if (!access.canRunAiTasks) {
    return NextResponse.json({
      error: localize(project.language, {
        "zh-CN": "只有当前项目成员可以重新抽取知识快照。",
        en: "Only current project members can refresh the knowledge snapshot.",
        ja: "知識スナップショットを再抽出できるのは現在のプロジェクト参加者だけです。",
        fr: "Seuls les membres actuels du projet peuvent régénérer le snapshot de connaissance.",
      }),
    }, { status: 403 });
  }

  const rawBody = await request.json().catch(() => ({}));
  const parsed = postSchema.safeParse(rawBody);
  const generateGraphLinks = parsed.success ? parsed.data.generateGraphLinks : false;

  if (project.metadata.isSample && generateGraphLinks) {
    return NextResponse.json({
      error: localize(project.language, {
        "zh-CN": "示例项目不能生成图谱。请在你自己的项目中生成知识图谱。",
        en: "Sample projects cannot generate graphs. Generate knowledge graphs from your own projects instead.",
        ja: "サンプルプロジェクトではグラフを生成できません。自分のプロジェクトから生成してください。",
        fr: "Les projets d'exemple ne peuvent pas generer de graphe. Utilisez plutot vos propres projets.",
      }),
    }, { status: 409 });
  }

  const snapshot = await extractAndSaveProjectKnowledge(projectId, locale, {
    generateGraphLinks,
  });
  return NextResponse.json({ snapshot }, { status: 201 });
}
