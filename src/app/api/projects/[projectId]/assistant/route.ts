export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { finalizeAssistantConversation, prepareAssistantConversation, AssistantConversationError } from "@/lib/ai/assistant-conversation";
import { resolveAutoTriggeredTasks } from "@/lib/ai/summary-automation";
import { getSettings } from "@/lib/data/repository";
import { AppLocale } from "@/lib/types";
import { getProvider } from "@/lib/providers/registry";

function localize(locale: AppLocale, values: Partial<Record<AppLocale, string>> & { en: string }) {
  return values[locale] ?? values.en;
}

export async function POST(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await context.params;
  const rawPayload = await request.json().catch(() => null);

  try {
    const prepared = await prepareAssistantConversation(projectId, request, rawPayload);
    const provider = getProvider(prepared.providerId);
    const conversation = await provider.respondInConversation(
      prepared.projectWithMessage,
      prepared.conversationContext,
      prepared.conversationOptions,
    );
    const finalized = await finalizeAssistantConversation(prepared, conversation, {
      aiMetadata: conversation.reasoning?.trim() ? { reasoning: conversation.reasoning.trim() } : undefined,
    });

    if (!conversation.ok) {
      return NextResponse.json({
        error: conversation.message,
        conversation,
        project: finalized.project,
        collaboration: finalized.collaboration,
        roomAiConfig: finalized.roomAiConfig,
      }, { status: 409 });
    }

    return NextResponse.json({
      providerId: prepared.providerId,
      conversation,
      project: finalized.project,
      collaboration: finalized.collaboration,
      roomAiConfig: finalized.roomAiConfig,
      aiTriggeredTasks: resolveAutoTriggeredTasks(finalized.project),
    });
  } catch (error) {
    if (error instanceof AssistantConversationError) {
      return NextResponse.json(error.body, { status: error.status });
    }
    const settings = await getSettings();
    return NextResponse.json({
      error: localize(settings.locale, {
        "zh-CN": "AI 对话出现意外错误，请稍后重试。",
        en: "The assistant conversation hit an unexpected error. Please try again shortly.",
        ja: "AI 会話で予期しないエラーが発生しました。しばらくしてから再試行してください。",
        ko: "AI 대화에서 예기치 않은 오류가 발생했습니다. 잠시 후 다시 시도하세요.",
        fr: "La conversation IA a rencontre une erreur inattendue. Reessayez dans un instant.",
        ru: "В диалоге с ИИ произошла непредвиденная ошибка. Повторите попытку чуть позже.",
      }),
    }, { status: 500 });
  }
}
