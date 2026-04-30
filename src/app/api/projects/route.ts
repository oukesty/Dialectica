export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { createProject, getSettings, isReservedProjectIdError, listProjects } from "@/lib/data/repository";
import { discussionProjectSchema } from "@/lib/schema";
import { appendAuditLog } from "@/lib/audit";
import { AppLocale } from "@/lib/types";
import { isLocale } from "@/lib/i18n";

function localize(locale: AppLocale, values: Partial<Record<AppLocale, string>> & { en: string }) {
  return values[locale] ?? values.en;
}

function aiDialogueNotAllowed(locale: AppLocale) {
  return NextResponse.json({
    error: localize(locale, {
      "zh-CN": "AI 工作台会话不能通过项目接口创建。请使用 AI 工作台入口发起个人 AI 对话。",
      en: "AI workspace sessions cannot be created from the project API. Use the AI Workspace entry for personal AI conversations.",
      ja: "AI ワークスペースの会話はプロジェクト API から作成できません。個人 AI 会話は AI ワークスペース入口から開始してください。",
      ko: "AI 워크스페이스 세션은 프로젝트 API로 생성할 수 없습니다. 개인 AI 대화는 AI 워크스페이스에서 시작해 주세요.",
      fr: "Les sessions de l'espace IA ne peuvent pas être créées via l'API projet. Utilisez l'entrée Espace IA pour les conversations personnelles.",
      ru: "Сеансы AI Workspace нельзя создавать через API проектов. Используйте вход AI Workspace для личных AI-диалогов.",
    }),
  }, { status: 400 });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const locale = (url.searchParams.get("locale") ?? undefined) as AppLocale | undefined;
  const projects = await listProjects(locale);
  return NextResponse.json({ projects });
}

export async function POST(request: Request) {
  const settings = await getSettings();
  const url = new URL(request.url);
  const requestLocale = isLocale(url.searchParams.get("locale") ?? "")
    ? (url.searchParams.get("locale") as AppLocale)
    : settings.locale;

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({
      error: localize(requestLocale, {
        "zh-CN": "项目请求内容无效，请检查后重试。",
        en: "The project request body is invalid. Check the submitted JSON and try again.",
        ja: "プロジェクト要求の内容が無効です。送信した JSON を確認して再試行してください。",
        fr: "Le contenu de la requête projet est invalide. Vérifiez le JSON envoyé puis réessayez.",
      }),
    }, { status: 400 });
  }

  const payloadRecord = typeof payload === "object" && payload !== null ? (payload as Record<string, unknown>) : undefined;
  const locale = isLocale(String(payloadRecord?.language ?? payloadRecord?.locale ?? ""))
    ? (String(payloadRecord?.language ?? payloadRecord?.locale) as AppLocale)
    : "en";

  try {
    const project = discussionProjectSchema.parse(payload);
    if (project.scenario === "ai-dialogue") {
      return aiDialogueNotAllowed(project.language);
    }
    const created = await createProject(project, project.language);
    void appendAuditLog({ action: "project.create", actorId: settings.profile.localIdentityId, actorName: settings.profile.displayName, projectId: created.id, details: `Created project "${created.title}"` });
    return NextResponse.json({ project: created }, { status: 201 });
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        {
          error: localize(locale, {
            "zh-CN": "项目数据结构无效，请检查标题、场景、参与者和讨论内容后重试。",
            en: "The project payload is invalid. Check the title, scenario, participants, and discussion fields, then try again.",
            ja: "プロジェクトデータが無効です。タイトル、シナリオ、参加者、議論フィールドを確認してから再試行してください。",
            fr: "La structure du projet est invalide. Verifiez le titre, le scenario, les participants et les champs de discussion, puis reessayez.",
          }),
          issues: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
        },
        { status: 400 },
      );
    }
    if (isReservedProjectIdError(error)) {
      return NextResponse.json({
        error: localize(locale, {
          "zh-CN": "该项目 ID 属于受保护的示例项目，不能写入本地存储。",
          en: "This project ID belongs to a protected sample project and cannot be written to local storage.",
          ja: "このプロジェクト ID は保護されたサンプルプロジェクトに属しているため、ローカル保存できません。",
          fr: "Cet identifiant correspond a un projet d'exemple protege et ne peut pas etre enregistre localement.",
        }),
      }, { status: 400 });
    }
    throw error;
  }
}
