export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { z } from "zod";
import { buildProviderExecutionConfig, resolveRoomAiExecutionContext } from "@/lib/ai/execution";
import { normalizeSummaryAutomationConfig } from "@/lib/ai/summary-automation";
import { appendCollaborationMessage, getCollaborationState, sanitizeCollaborationStateForClient } from "@/lib/collaboration/store";
import { createProviderSnapshot } from "@/lib/factories";
import { getProject, getSettings, upsertProject } from "@/lib/data/repository";
import { getProjectAccessState } from "@/lib/project-access";
import { getProvider } from "@/lib/providers/registry";
import { isLocale } from "@/lib/i18n";
import { AppLocale, ProviderConversationTurn, RoomAiAutomationMode } from "@/lib/types";
import { CollaborationEvent } from "@/lib/collaboration/types";

const RESPONSE_STYLES: Record<string, Partial<Record<AppLocale, string>> & { en: string }> = {
  objective: {
    "zh-CN": "请以客观、中立的语气总结讨论内容。列出每位参与者的核心观点，不要加入你的评价。",
    en: "Summarize the discussion in an objective, neutral tone. List each participant's core points without adding your own judgment.",
    ja: "議論を客観的・中立的なトーンで要約してください。各参加者の核心的な主張を評価を加えずに列挙してください。",
    ko: "토론 내용을 객관적이고 중립적인 어조로 요약하세요. 각 참여자의 핵심 입장을 당신의 판단 없이 정리하세요.",
    fr: "Resumez la discussion d'un ton objectif et neutre. Listez les points cles de chaque participant sans jugement personnel.",
    ru: "Кратко изложите обсуждение в объективном и нейтральном тоне. Перечислите ключевые позиции каждого участника без собственных оценок.",
  },
  analytical: {
    "zh-CN": "请分析讨论中的逻辑链条、争议焦点和各方论据的强弱。指出哪些论点有充分支撑，哪些还需要进一步论证。",
    en: "Analyze the logical chains, points of contention, and strength of each participant's arguments. Identify which points are well-supported and which need further evidence.",
    ja: "議論の論理的な流れ、争点、各参加者の論拠の強弱を分析してください。十分な裏付けがある主張と、さらなる論証が必要な主張を指摘してください。",
    ko: "논의의 논리 흐름, 핵심 쟁점, 각 참여자 주장들의 강약을 분석하세요. 어떤 주장은 충분히 뒷받침되고, 어떤 주장은 추가 근거가 필요한지 짚어 주세요.",
    fr: "Analysez les enchainements logiques, les points de desaccord et la solidite des arguments de chaque participant. Identifiez les points bien etayes et ceux necessitant davantage de preuves.",
    ru: "Проанализируйте логические цепочки, точки разногласия и силу аргументов участников. Укажите, какие тезисы уже хорошо подкреплены, а каким требуется больше доказательств.",
  },
  comprehensive: {
    "zh-CN": "请全面整理讨论内容：1) 每位参与者说了什么及其立场；2) 讨论的核心争议点；3) 已达成的共识；4) 需要进一步讨论的问题；5) 你的建议和下一步行动方向。",
    en: "Provide a comprehensive overview: 1) Each participant's contributions and stance; 2) Core points of contention; 3) Areas of agreement; 4) Unresolved questions; 5) Your recommendations and suggested next steps.",
    ja: "以下を包括的にまとめてください：1) 各参加者の発言と立場；2) 核心的な争点；3) 合意が得られた領域；4) 未解決の問題；5) あなたの提案と次のステップ。",
    ko: "토론을 종합적으로 정리하세요: 1) 각 참여자의 발언과 입장 2) 핵심 쟁점 3) 합의된 부분 4) 추가 논의가 필요한 문제 5) 제안과 다음 단계.",
    fr: "Fournissez un apercu complet : 1) Contributions et position de chaque participant ; 2) Points de desaccord centraux ; 3) Zones d'accord ; 4) Questions non resolues ; 5) Vos recommandations et prochaines etapes suggerees.",
    ru: "Дайте целостное резюме: 1) вклад и позиция каждого участника; 2) ключевые точки спора; 3) области согласия; 4) нерешённые вопросы; 5) ваши рекомендации и возможные следующие шаги.",
  },
  minutes: {
    "zh-CN": "请以正式会议纪要的格式整理讨论内容。包括：时间、参与者、议题、各方发言要点、决议事项、待办事项。",
    en: "Format the discussion as formal meeting minutes. Include: date, participants, agenda items, key points from each speaker, decisions made, and action items.",
    ja: "議論を正式な議事録形式で整理してください。日時、参加者、議題、各発言者の要点、決定事項、アクションアイテムを含めてください。",
    ko: "논의를 공식 회의록 형식으로 정리하세요. 날짜, 참여자, 안건, 각 발언자의 핵심 요지, 결정 사항, 실행 항목을 포함해 주세요.",
    fr: "Formatez la discussion comme un compte-rendu formel. Incluez : date, participants, points a l'ordre du jour, interventions cles, decisions prises et actions a mener.",
    ru: "Оформите обсуждение как официальный протокол встречи. Включите дату, участников, пункты повестки, ключевые тезисы каждого, принятые решения и задачи.",
  },
};

function localize(locale: AppLocale, values: Partial<Record<AppLocale, string>> & { en: string }) {
  return values[locale] ?? values.en;
}

const roomAiRequestSchema = z.object({
  action: z.enum(["summarize", "auto-check"]),
  responseStyle: z.enum(["objective", "analytical", "comprehensive", "minutes"]).optional(),
  locale: z.string().optional(),
});

function shouldAutoReply(
  events: CollaborationEvent[],
  threshold: number,
): { shouldReply: boolean; reason: string } {
  const lastAiIndex = events.map((e, i) => ({ e, i })).filter(({ e }) => e.actorType === "ai").pop()?.i ?? -1;
  const messagesSinceAi = events.slice(lastAiIndex + 1).filter((e) => e.type === "message" && e.actorType !== "ai");

  if (messagesSinceAi.length < threshold) {
    return { shouldReply: false, reason: "below-threshold" };
  }

  const uniqueParticipants = new Set(messagesSinceAi.map((e) => e.participantId).filter(Boolean));
  if (uniqueParticipants.size < 2) {
    return { shouldReply: false, reason: "single-participant" };
  }

  const hasQuestion = messagesSinceAi.some((e) =>
    /[?？]/.test(e.message) || /^(what|how|why|when|who|which|please|could|should|什么|怎么|为什么|请|是否|能否|如何)/i.test(e.message.trim()),
  );
  if (hasQuestion && messagesSinceAi.length >= Math.max(2, threshold - 2)) {
    return { shouldReply: true, reason: "question-detected" };
  }

  return { shouldReply: true, reason: "threshold-reached" };
}

function buildRoomConversationHistory(events: CollaborationEvent[]): ProviderConversationTurn[] {
  return events
    .filter((event) => event.type === "message")
    .slice(-24)
    .map((event) => {
      const speaker = event.actorType === "ai" ? "AI Assistant" : (event.participantName || "Participant");
      return {
        role: (event.actorType === "ai" ? "assistant" : "user") as ProviderConversationTurn["role"],
        content: event.actorType === "ai" ? event.message : `[${speaker}]: ${event.message}`,
      };
    });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await context.params;
  const settings = await getSettings();
  const url = new URL(request.url);
  const requestLocale = url.searchParams.get("locale") ?? "";
  const locale: AppLocale = isLocale(requestLocale) ? requestLocale : settings.locale;

  let rawPayload: unknown;
  try {
    rawPayload = await request.json();
  } catch {
    return NextResponse.json({
      error: localize(locale, {
        "zh-CN": "房间 AI 请求不是有效的 JSON，请刷新后重试。",
        en: "The room AI request is not valid JSON. Refresh and try again.",
        ja: "ルーム AI リクエストが有効な JSON ではありません。更新して再試行してください。",
        ko: "방 AI 요청이 올바른 JSON이 아닙니다. 새로고침 후 다시 시도하세요.",
        fr: "La requete IA du salon n'est pas un JSON valide. Actualisez puis reessayez.",
        ru: "Запрос ИИ комнаты не является допустимым JSON. Обновите страницу и повторите попытку.",
      }),
    }, { status: 400 });
  }

  const parsed = roomAiRequestSchema.safeParse(rawPayload);
  if (!parsed.success) {
    return NextResponse.json({
      error: localize(locale, {
        "zh-CN": "房间 AI 请求无效，请刷新后重试。",
        en: "The room AI request is invalid. Refresh and try again.",
        ja: "ルーム AI リクエストが無効です。更新して再試行してください。",
        ko: "방 AI 요청이 올바르지 않습니다. 새로고침 후 다시 시도하세요.",
        fr: "La requete IA du salon est invalide. Actualisez puis reessayez.",
        ru: "Запрос ИИ комнаты недействителен. Обновите страницу и повторите попытку.",
      }),
      issues: parsed.error.issues,
    }, { status: 400 });
  }

  const { action, responseStyle } = parsed.data;
  const project = await getProject(projectId, locale);
  const access = getProjectAccessState(project, settings);

  if (!access.canRunAiTasks) {
    return NextResponse.json({ error: localize(locale, {
      "zh-CN": access.canJoinPublicRoom ? "请先加入这个公共房间，再触发房间 AI 发言。" : "当前身份不能触发房间 AI 发言。",
      en: access.canJoinPublicRoom ? "Join this public room before triggering room AI." : "Your current profile cannot trigger room AI.",
      ja: access.canJoinPublicRoom ? "この公開ルームに参加してから、ルーム AI を起動してください。" : "現在のプロフィールではルーム AI を起動できません。",
      fr: access.canJoinPublicRoom ? "Rejoignez d'abord ce salon public avant de declencher l'IA du salon." : "Le profil actuel ne peut pas declencher l'IA du salon.",
    }) }, { status: access.canJoinPublicRoom ? 409 : 403 });
  }

  const collaboration = await getCollaborationState(project);
  const events = collaboration.events;
  const aiAutomation = project.room.aiAutomation ?? { mode: "off" as RoomAiAutomationMode, autoReplyThreshold: 5, responseStyle: "comprehensive" };
  const normalizedAutomation = normalizeSummaryAutomationConfig(project.room.aiAutomation);

  if (action === "auto-check") {
    if (normalizedAutomation.mode === "off") {
      return NextResponse.json({ shouldReply: false, reason: "manual-mode" });
    }
    const threshold = normalizedAutomation.mode === "assistive"
      ? normalizedAutomation.summaryCurrentThreshold
      : normalizedAutomation.summaryThreshold;
    const check = shouldAutoReply(events, threshold);
    if (!check.shouldReply) {
      return NextResponse.json({ shouldReply: false, reason: check.reason });
    }
  }

  const effectiveStyle = responseStyle || aiAutomation.responseStyle || "comprehensive";
  const styleInstruction = RESPONSE_STYLES[effectiveStyle]?.[locale] ?? RESPONSE_STYLES.comprehensive[locale];

  const participants = project.participants;
  const participantList = participants.map((p) => `- ${p.name} (${p.collaborationRole})`).join("\n");
  const recentMessages = events
    .filter((e) => e.type === "message")
    .slice(-30)
    .map((e) => {
      const speaker = e.actorType === "ai" ? "AI Assistant" : (e.participantName || "Unknown");
      const time = new Date(e.createdAt).toLocaleTimeString();
      return `[${time}] ${speaker}: ${e.message}`;
    })
    .join("\n");

  const userPrompt = [
    `You are helping with an active collaborative discussion for the project "${project.title}".`,
    `Project goal: ${project.goal || "Open discussion"}`,
    `Room participants:\n${participantList}`,
    `\nResponse style instruction:\n${styleInstruction}`,
    `\nGuidance:`,
    `- Help the room make progress without pretending to be any participant.`,
    `- Address participants by name when that is useful.`,
    `- Keep the reply natural, concise, and helpful.`,
    `- Reply in the same language as the majority of the discussion.`,
    `\nHere is the recent discussion:\n\n${recentMessages || "(No messages yet)"}`,
    `\nPlease provide your response following the style instruction above.`,
  ].join("\n");

  const execution = await resolveRoomAiExecutionContext(project, settings);
  const executionSettings = execution.executionSettings;
  const providerId = execution.providerId;
  const providerConfig = execution.providerConfig;
  const normalizedModel = execution.normalizedModel;

  if (!executionSettings || !providerConfig || !execution.hasAvailableCredentials) {
    return NextResponse.json({
      error: localize(locale, {
        "zh-CN": "房间当前没有可用的 AI 凭据，请房间主持人先保存对应 Provider 的设置或配置环境变量。",
        en: "No usable AI credentials are available for this room. Ask the room host to save the provider settings or configure the matching environment variable.",
        ja: "このルームでは利用可能な AI 認証情報がありません。ルームホストに Provider 設定を保存するか、対応する環境変数を設定してもらってください。",
        fr: "Aucun identifiant IA exploitable n'est disponible pour ce salon. Demandez a l'hote d'enregistrer les reglages du fournisseur ou de configurer la variable d'environnement correspondante.",
      }),
    }, { status: 409 });
  }

  if (!execution.modelSupported) {
    return NextResponse.json({
      error: localize(locale, {
        "zh-CN": `${providerId} 不支持模型 ${execution.requestedModel}。请由房间主持人保存该提供方支持的有效模型。`,
        en: `${providerId} does not support model ${execution.requestedModel}. Ask the room host to save a valid model supported by this provider.`,
        ja: `${providerId} はモデル ${execution.requestedModel} をサポートしていません。ルームホストにこのプロバイダーで有効なモデルを保存してもらってください。`,
        fr: `${providerId} ne prend pas en charge le modele ${execution.requestedModel}. Demandez a l'hote d'enregistrer un modele valide pris en charge par ce fournisseur.`,
      }),
    }, { status: 400 });
  }

  const provider = getProvider(providerId);

  const conversation = await provider.respondInConversation(project, {
    locale,
    assistantSurface: "room-facilitator",
    emphasis: executionSettings.provider.mockEmphasis,
    stage: "capture",
    goal: project.goal,
    providerConfig: buildProviderExecutionConfig(providerId, providerConfig, normalizedModel),
    requestTimeoutMs: executionSettings.provider.requestTimeoutMs,
    preferServerKeys: executionSettings.provider.preferServerKeys,
    allowFallbackToScaffold: executionSettings.provider.allowFallbackToScaffold,
    attachmentContext: { total: 0, items: [] },
  }, {
    prompt: userPrompt,
    history: buildRoomConversationHistory(events),
  });

  if (!conversation.ok) {
    return NextResponse.json({
      error: conversation.message,
      conversation,
    }, { status: 409 });
  }

  const updatedProject = await upsertProject(
    {
      ...project,
      providerSnapshot: createProviderSnapshot(providerId, normalizedModel, "room-ai-response", conversation.generatedAt),
      room: {
        ...project.room,
        aiConfig: {
          ...project.room.aiConfig,
          providerId,
          model: normalizedModel,
          updatedAt: conversation.generatedAt,
        },
      },
    },
    locale,
    { skipAutoAnalyze: true, settingsOverride: executionSettings },
  );

  const updatedCollaboration = await appendCollaborationMessage(updatedProject, {
    type: "message",
    actorType: "ai",
    message: conversation.reply,
    metadata: {
      providerId,
      model: normalizedModel,
      assistant: "true",
      responseStyle: effectiveStyle,
      automationMode: aiAutomation.mode,
    },
  });

  return NextResponse.json({
    providerId,
    conversation,
    project: updatedProject,
    collaboration: sanitizeCollaborationStateForClient(updatedCollaboration),
  });
}
