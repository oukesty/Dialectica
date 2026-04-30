export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { z } from "zod";
import { exportProject, getProject, getSettings } from "@/lib/data/repository";
import { getProjectAccessState } from "@/lib/project-access";
import { AppLocale, EXPORT_FORMATS } from "@/lib/types";

const querySchema = z.object({
  format: z.enum(EXPORT_FORMATS).optional().default("markdown"),
  locale: z.string().optional(),
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
  const parsedQuery = querySchema.safeParse({
    format: url.searchParams.get("format") ?? undefined,
    locale: url.searchParams.get("locale") ?? undefined,
  });
  if (!parsedQuery.success) {
    return NextResponse.json({
      error: localize(settings.locale, {
        "zh-CN": "导出参数无效，请重新选择导出格式。",
        en: "The export parameters are invalid. Choose the export format again.",
        ja: "エクスポートのパラメータが無効です。形式を選び直してください。",
        ko: "내보내기 매개변수가 올바르지 않습니다. 내보내기 형식을 다시 선택하세요.",
        fr: "Les parametres d'export sont invalides. Choisissez a nouveau le format d'export.",
        ru: "Параметры экспорта недействительны. Выберите формат экспорта заново.",
      }),
      issues: parsedQuery.error.issues,
    }, { status: 400 });
  }
  const format = parsedQuery.data.format;
  const locale = parsedQuery.data.locale as AppLocale | undefined;
  const project = await getProject(projectId, locale ?? settings.locale);
  const access = getProjectAccessState(project, settings);

  if (!access.isSample && !access.isMember) {
    return NextResponse.json({
      error: localize(project.language, {
        "zh-CN": "只有当前项目成员可以导出该工作区。",
        en: "Only current project members can export this workspace.",
        ja: "このワークスペースをエクスポートできるのは現在のプロジェクト参加者だけです。",
        fr: "Seuls les membres actuels du projet peuvent exporter cet espace de travail.",
      }),
    }, { status: 403 });
  }

  const body = await exportProject(projectId, format, locale);
  const contentType =
    format === "json"
      ? "application/json"
      : format === "txt"
        ? "text/plain"
        : "text/markdown";

  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": `${contentType}; charset=utf-8`,
      "Content-Disposition": `attachment; filename="${projectId}.${format === "markdown" ? "md" : format}"`,
    },
  });
}
