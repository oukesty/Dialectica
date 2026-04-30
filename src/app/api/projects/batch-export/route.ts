export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getProject, getSettings } from "@/lib/data/repository";
import { AppLocale } from "@/lib/types";

function localize(locale: AppLocale, values: Partial<Record<AppLocale, string>> & { en: string }) {
  return values[locale] ?? values.en;
}

export async function POST(request: Request) {
  const settings = await getSettings();
  const locale = settings.locale as AppLocale;
  const body = await request.json().catch(() => null) as { projectIds?: string[] } | null;
  if (!body || !Array.isArray(body.projectIds) || body.projectIds.length === 0) {
    return NextResponse.json({
      error: localize(locale, {
        "zh-CN": "请至少选择一个项目再导出。",
        en: "Select at least one project before exporting.",
        ja: "エクスポートする前に少なくとも 1 つのプロジェクトを選択してください。",
        fr: "Selectionnez au moins un projet avant de lancer l'export.",
      }),
    }, { status: 400 });
  }
  if (body.projectIds.length > 50) {
    return NextResponse.json({
      error: localize(locale, {
        "zh-CN": "批量导出一次最多支持 50 个项目。",
        en: "Batch export supports at most 50 projects at a time.",
        ja: "一度にエクスポートできるのは最大 50 プロジェクトです。",
        fr: "L'export par lot prend en charge au maximum 50 projets a la fois.",
      }),
    }, { status: 400 });
  }

  const projects = [];
  for (const id of body.projectIds) {
    try {
      const project = await getProject(id, settings.locale as AppLocale);
      if (project) projects.push(project);
    } catch {
      // skip projects that don't exist
    }
  }

  const exportData = {
    exportedAt: new Date().toISOString(),
    projectCount: projects.length,
    projects,
  };

  return new NextResponse(JSON.stringify(exportData, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="dialectica-batch-export-${Date.now()}.json"`,
    },
  });
}
