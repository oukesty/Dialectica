export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { createDefaultGoal } from "@/lib/factories";
import { createProjectSkeleton, getSettings, upsertProject } from "@/lib/data/repository";
import { isLocale } from "@/lib/i18n";
import { AppLocale } from "@/lib/types";

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

export default async function AssistantNewPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) {
    redirect("/zh-CN/assistant");
  }

  const settings = await getSettings();
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

  redirect(`/${locale}/assistant?chat=${created.id}`);
}
