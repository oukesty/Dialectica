export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { z } from "zod";
import { getSettings, importProject, isReservedProjectIdError } from "@/lib/data/repository";
import { isLocale } from "@/lib/i18n";
import { AppLocale } from "@/lib/types";

const importSchema = z.object({
  format: z.enum(["json", "txt", "markdown"]),
  content: z.string().min(1).max(10_000_000),
  locale: z.string().refine(isLocale, { message: "Invalid locale" }),
});

function localize(locale: AppLocale, values: Partial<Record<AppLocale, string>> & { en: string }) {
  return values[locale] ?? values.en;
}

export async function POST(request: Request) {
  const settings = await getSettings();
  const rawPayload = await request.json().catch(() => null);
  const parsed = importSchema.safeParse(rawPayload);
  if (!parsed.success) {
    const rawLocale = typeof rawPayload === "object" && rawPayload !== null && "locale" in rawPayload
      ? String((rawPayload as { locale?: unknown }).locale ?? "")
      : "";
    const locale: AppLocale = isLocale(rawLocale) ? rawLocale : settings.locale;
    return NextResponse.json({
      error: localize(locale, {
        "zh-CN": "导入内容无效，请检查文件格式和内容后重试。",
        en: "The import payload is invalid. Check the file format and contents, then try again.",
        ja: "インポート内容が無効です。ファイル形式と内容を確認して再試行してください。",
        ko: "가져오기 내용이 올바르지 않습니다. 파일 형식과 내용을 확인한 뒤 다시 시도하세요.",
        fr: "Le contenu importe est invalide. Verifiez le format et le contenu du fichier, puis reessayez.",
        ru: "Импортируемые данные недействительны. Проверьте формат и содержимое файла, затем повторите попытку.",
      }),
      details: parsed.error.flatten(),
    }, { status: 400 });
  }
  let result;
  try {
    result = await importProject(parsed.data);
  } catch (error) {
    if (isReservedProjectIdError(error)) {
      return NextResponse.json({
        error: localize(parsed.data.locale as AppLocale, {
          "zh-CN": "导入内容包含受保护的示例项目 ID，已阻止写入无效数据。",
          en: "The import contains a protected sample project ID, so invalid stored data was blocked.",
          ja: "インポート内容に保護されたサンプルプロジェクト ID が含まれていたため、無効な保存データを防止しました。",
          fr: "Le contenu importe contient un identifiant de projet d'exemple protege. L'ecriture invalide a ete bloquee.",
        }),
      }, { status: 400 });
    }
    throw error;
  }
  if (result.project.scenario === "ai-dialogue") {
    return NextResponse.json({
      error: localize(parsed.data.locale as AppLocale, {
        "zh-CN": "AI 工作台会话不能通过项目导入进入项目系统。",
        en: "AI workspace sessions cannot be imported into the project system.",
        ja: "AI ワークスペースの会話をプロジェクトシステムにインポートすることはできません。",
        ko: "AI 워크스페이스 세션은 프로젝트 시스템으로 가져올 수 없습니다.",
        fr: "Les sessions de l'espace IA ne peuvent pas être importées dans le système de projets.",
        ru: "Сеансы AI Workspace нельзя импортировать в систему проектов.",
      }),
    }, { status: 400 });
  }
  return NextResponse.json(result, { status: 201 });
}
