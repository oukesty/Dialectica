export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { z } from "zod";
import { getCollaborationState, sanitizeCollaborationStateForClient } from "@/lib/collaboration/store";
import { createDefaultGoal } from "@/lib/factories";
import { createProjectSkeleton, getSettings, upsertProject } from "@/lib/data/repository";
import { isLocale } from "@/lib/i18n";
import { LOCAL_IDENTITY_COOKIE } from "@/lib/local-identity";
import { AppLocale } from "@/lib/types";

const requestSchema = z.object({
  locale: z.string().refine(isLocale, { message: "Invalid locale" }),
  identityId: z.string().max(120).optional(),
});

const soloStarterCopy: Record<AppLocale, { title: string; description: string; roomTitle: string }> = {
  "zh-CN": {
    title: "个人 AI 工作台",
    description: "在这里像使用普通 AI 应用一样连续聊天、上传材料，并把需要公开的内容后续转换为共享房间。",
    roomTitle: "个人 AI 对话",
  },
  en: {
    title: "Personal AI workspace",
    description: "Chat, upload context, and grow a private AI thread here before turning it into a shared room when needed.",
    roomTitle: "Personal AI conversation",
  },
  ja: {
    title: "個人 AI ワークスペース",
    description: "通常の AI アプリのように会話や添付を積み上げ、必要になった時だけ共有ルームへ公開できます。",
    roomTitle: "個人 AI 会話",
  },
  ko: {
    title: "개인 AI 워크스페이스",
    description: "일반적인 AI 앱처럼 대화와 자료를 쌓아 두었다가, 필요할 때만 공유 방으로 전환할 수 있습니다.",
    roomTitle: "개인 AI 대화",
  },
  fr: {
    title: "Espace IA personnel",
    description: "Discutez, joignez du contexte, puis transformez ce fil prive en salon partage uniquement quand vous en avez besoin.",
    roomTitle: "Conversation IA personnelle",
  },
  ru: {
    title: "Личное AI-пространство",
    description: "Общайтесь, добавляйте материалы и при необходимости позже превращайте эту личную ветку в общий рабочий зал.",
    roomTitle: "Личный AI-диалог",
  },
};

function localize(locale: AppLocale, values: Partial<Record<AppLocale, string>> & { en: string }) {
  return values[locale] ?? values.en;
}

export async function POST(request: Request) {
  const rawPayload = await request.json().catch(() => null);
  const parsed = requestSchema.safeParse(rawPayload);

  if (!parsed.success) {
    const settings = await getSettings();
    const rawLocale = typeof rawPayload === "object" && rawPayload !== null && "locale" in rawPayload
      ? String((rawPayload as { locale?: unknown }).locale ?? "")
      : "";
    const locale: AppLocale = isLocale(rawLocale) ? rawLocale : settings.locale;
    return NextResponse.json({
      error: localize(locale, {
        "zh-CN": "AI 工作台会话请求无效，请刷新页面后重试。",
        en: "The AI workspace session request is invalid. Refresh the page and try again.",
        ja: "AI ワークスペースのセッションリクエストが無効です。ページを更新して再試行してください。",
        ko: "AI 워크스페이스 세션 요청이 올바르지 않습니다. 페이지를 새로고침한 뒤 다시 시도하세요.",
        fr: "La requete de session de l'espace IA est invalide. Actualisez la page puis reessayez.",
        ru: "Запрос сеанса AI Workspace недействителен. Обновите страницу и повторите попытку.",
      }),
      issues: parsed.error.issues,
    }, { status: 400 });
  }

  const locale = parsed.data.locale as AppLocale;
  const settings = await getSettings({ identityId: parsed.data.identityId });
  const project = createProjectSkeleton(locale, "ai-dialogue", settings);
  const copy = soloStarterCopy[locale];

  project.title = copy.title;
  project.description = copy.description;
  project.goal = createDefaultGoal(locale, "ai-dialogue");
  project.tags = Array.from(new Set([...(project.tags ?? []), "solo-mode", "ai-dialogue", "personal-ai-workspace"]));
  project.room.visibility = "private";
  project.room.session.title = copy.roomTitle;
  project.room.session.goal = project.goal;

  const created = await upsertProject(project, locale, {
    skipAutoAnalyze: true,
    settingsOverride: settings,
  });

  const collaboration = sanitizeCollaborationStateForClient(
    await getCollaborationState(created),
  );

  const response = NextResponse.json({ project: created, collaboration });
  response.cookies.set(LOCAL_IDENTITY_COOKIE, settings.profile.localIdentityId, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
  });
  return response;
}
