import {
  AiTask,
  AiTaskOutput,
  AnalysisContext,
  DiscussionProject,
  OrchestrationPacket,
  ProjectScenario,
  ProviderId,
  ProviderTaskResult,
} from "@/lib/types";

function localize<T>(locale: AnalysisContext["locale"], map: Record<AnalysisContext["locale"], T>) {
  return map[locale] ?? map.en;
}

export function scenarioLabel(scenario: ProjectScenario, locale: AnalysisContext["locale"]) {
  const labels = {
    debate: { "zh-CN": "辩论", en: "debate", ja: "ディベート", ko: "토론", fr: "debat", ru: "дебаты" },
    discussion: { "zh-CN": "讨论", en: "discussion", ja: "議論", ko: "논의", fr: "discussion", ru: "обсуждение" },
    meeting: { "zh-CN": "会议", en: "meeting", ja: "会議", ko: "회의", fr: "reunion", ru: "встреча" },
    negotiation: { "zh-CN": "协商", en: "negotiation", ja: "交渉", ko: "협상", fr: "negociation", ru: "переговоры" },
    "ai-dialogue": { "zh-CN": "AI 对话", en: "AI dialogue", ja: "AI 対話", ko: "AI 대화", fr: "dialogue IA", ru: "диалог с ИИ" },
    "document-driven-discussion": { "zh-CN": "文档驱动讨论", en: "document-driven discussion", ja: "文書駆動ディスカッション", ko: "문서 기반 토론", fr: "discussion guidee par documents", ru: "обсуждение на основе документов" },
  };

  return labels[scenario][locale];
}

function taskLabel(task: AiTask, locale: AnalysisContext["locale"]) {
  const labels = {
    summarizeDiscussion: {
      "zh-CN": "讨论总结",
      en: "discussion summary",
      ja: "議論サマリー",
      ko: "논의 요약",
      fr: "resume de discussion",
      ru: "сводка обсуждения",
    },
    evaluateDiscussion: {
      "zh-CN": "讨论评估",
      en: "discussion evaluation",
      ja: "議論評価",
      ko: "논의 평가",
      fr: "evaluation de discussion",
      ru: "оценка обсуждения",
    },
    generateFollowupQuestions: {
      "zh-CN": "跟进问题生成",
      en: "follow-up question generation",
      ja: "フォローアップ質問生成",
      ko: "후속 질문 생성",
      fr: "generation de questions de suivi",
      ru: "генерация последующих вопросов",
    },
    testConnection: {
      "zh-CN": "连接测试",
      en: "connection test",
      ja: "接続テスト",
      ko: "연결 테스트",
      fr: "test de connexion",
      ru: "проверка соединения",
    },
    multiperspectiveSummary: {
      "zh-CN": "多视角摘要",
      en: "multi-perspective summary",
      ja: "多視点サマリー",
      ko: "다중 관점 요약",
      fr: "resume multi-perspectives",
      ru: "многоперспективное резюме",
    },
    debateAnalysis: {
      "zh-CN": "辩论分析",
      en: "debate analysis",
      ja: "ディベート分析",
      ko: "토론 분석",
      fr: "analyse de debat",
      ru: "анализ дебатов",
    },
    sentimentAnalysis: {
      "zh-CN": "情感分析",
      en: "sentiment analysis",
      ja: "感情分析",
      ko: "감정 분석",
      fr: "analyse de sentiment",
      ru: "анализ тональности",
    },
    extractViewpoints: {
      "zh-CN": "观点提取",
      en: "viewpoint extraction",
      ja: "観点抽出",
      ko: "관점 추출",
      fr: "extraction de points de vue",
      ru: "извлечение точек зрения",
    },
    extractActionItems: {
      "zh-CN": "行动项提取",
      en: "action item extraction",
      ja: "アクション項目抽出",
      ko: "실행 항목 추출",
      fr: "extraction d'actions",
      ru: "извлечение задач",
    },
  };

  return labels[task][locale];
}

const LOW_VALUE_TRANSCRIPT_PATTERNS = [
  /^(hi|hello|hey|ok|okay|yes|no|thanks|thank you|got it|noted|sure|sounds good)[.!。！\s]*$/i,
  /^(你好|您好|谢谢|好的|收到|明白|嗯|可以|行|没问题|辛苦了)[。！\s]*$/i,
] as const;

const HIGH_SIGNAL_TRANSCRIPT_PATTERNS = [
  /\b(because|therefore|however|but|evidence|risk|decision|decided|action|next step|todo|blocker|issue|problem|conflict|disagree|proposal|recommend|should|must)\b/i,
  /(因为|因此|但是|不过|证据|风险|决定|决策|行动项|下一步|待办|阻塞|问题|分歧|冲突|不同意|建议|应该|必须|结论|未解决)/i,
] as const;

function compactTranscriptText(value: string, limit = 220) {
  const compacted = value.replace(/\s+/g, " ").trim();
  return compacted.length > limit ? `${compacted.slice(0, limit - 3).trim()}...` : compacted;
}

function isHighSignalTranscriptEntry(entry: DiscussionProject["entries"][number]) {
  const content = entry.content.trim();
  if (!content) return false;
  if (LOW_VALUE_TRANSCRIPT_PATTERNS.some((pattern) => pattern.test(content))) return false;
  if (entry.highlighted) return true;
  if (entry.kind === "question" && content.length >= 16) return true;
  if (content.length >= 80) return true;
  return HIGH_SIGNAL_TRANSCRIPT_PATTERNS.some((pattern) => pattern.test(content));
}

function buildRecentTranscriptExcerpts(project: DiscussionProject) {
  const participantNames = new Map(project.participants.map((participant) => [participant.id, participant.name]));
  return project.entries
    .slice(-50)
    .filter(isHighSignalTranscriptEntry)
    .slice(-12)
    .map((entry) => `- ${participantNames.get(entry.participantId) ?? "Participant"}: ${compactTranscriptText(entry.content)}`)
    .join("\n");
}

export function buildOrchestrationPacket(
  project: DiscussionProject,
  context: AnalysisContext,
  providerId: ProviderId,
  task: AiTask,
): OrchestrationPacket {
  const highlightedEntries = project.entries.filter((entry) => entry.highlighted).length;
  const lastEntry = project.entries.at(-1)?.occurredAt;
  const recentTranscriptExcerpts = task === "summarizeDiscussion" ? buildRecentTranscriptExcerpts(project) : "";
  const participantLines = project.participants
    .map(
      (participant) =>
        `${participant.name} | debate role: ${participant.role} | room role: ${participant.collaborationRole} | stance: ${participant.stance}`,
    )
    .join("\n");

  const system = [
    `You are the AI orchestration layer for Dialectica, an AI-ready platform for structured multi-party ${scenarioLabel(project.scenario, context.locale)} workflows.`,
    `Current task: ${taskLabel(task, context.locale)}.`,
    "Preserve participant identity, timeline order, argument ownership, unresolved questions, evidence quality, and disagreement structure.",
    "Return structured analysis that can feed a knowledge base and graph pipeline.",
  ].join(" ");

  const attachmentLines = (context.attachmentContext?.items ?? [])
    .slice(0, 8)
    .map((attachment) => {
      const parts = [attachment.name, attachment.kind, attachment.mimeType];
      if (attachment.note) parts.push(attachment.note);
      if (attachment.previewText) parts.push(`preview: ${attachment.previewText}`);
      if (attachment.publicUrl) parts.push(`url: ${attachment.publicUrl}`);
      return parts.join(" | ");
    })
    .join("\n");

  const user = [
    `Project goal: ${context.goal || project.goal}`,
    `Scenario: ${project.scenario}`,
    `Participants:\n${participantLines}`,
    `Transcript entries: ${project.entries.length}`,
    recentTranscriptExcerpts ? `Recent high-signal transcript excerpts:\n${recentTranscriptExcerpts}` : "",
    `Argument nodes: ${project.nodes.length}`,
    `Argument relations: ${project.relations.length}`,
    `Room status: ${project.room.session.status}`,
    `Attachments available: ${context.attachmentContext?.total ?? 0}`,
    attachmentLines ? `Attachment context:\n${attachmentLines}` : "",
  ].filter(Boolean).join("\n\n");

  return {
    providerId,
    task,
    stage: context.stage,
    locale: context.locale,
    scenario: project.scenario,
    projectId: project.id,
    goal: context.goal || project.goal,
    room: {
      roomId: project.room.id,
      visibility: project.room.visibility,
      sessionId: project.room.session.id,
      sessionTitle: project.room.session.title,
      sessionStatus: project.room.session.status,
      transport: project.room.session.sync.transport,
      syncStatus: project.room.session.sync.status,
    },
    participants: project.participants.map((participant) => ({
      id: participant.id,
      name: participant.name,
      role: participant.role,
      collaborationRole: participant.collaborationRole,
      stance: participant.stance,
      presence: participant.presence.status,
    })),
    transcript: {
      totalEntries: project.entries.length,
      highlightedEntries,
      lastEntryAt: lastEntry,
    },
    attachments: {
      total: context.attachmentContext?.total ?? 0,
      items: context.attachmentContext?.items ?? [],
    },
    instructions: {
      system,
      user,
      outputShape: [
        "topic",
        "viewpoints[]",
        "arguments[]",
        "evidence[]",
        "conflicts[]",
        "summary",
        "disputes[]",
        "unresolvedQuestions[]",
        "evaluation",
        "conclusion",
        "suggestions[]",
        "recommendations[]",
        "followupQuestions[]",
      ],
    },
  };
}

export function buildAdapterScaffoldOutput(
  project: DiscussionProject,
  context: AnalysisContext,
  providerId: ProviderId,
): AiTaskOutput {
  const providerName = providerId.toUpperCase();
  const summary = localize(context.locale, {
    "zh-CN": `${providerName} 接口已接入 Provider 编排层。当前返回的是接入预览，请配置模型与密钥后替换为真实调用。`,
    en: `${providerName} is wired into the provider orchestration surface. This response is a setup preview until you configure a live model and credentials.`,
    ja: `${providerName} は provider 編成レイヤーに接続済みです。現在は接続プレビューであり、モデルと認証情報を設定すると実接続へ置き換えられます。`,
    ko: `${providerName} 공급자 경로는 이미 오케스트레이션 계층에 연결되어 있습니다. 현재 응답은 설정 미리보기이며, 실제 모델과 자격 증명을 설정하면 실호출로 전환됩니다.`,
    fr: `${providerName} est integre a la couche d'orchestration provider. Cette reponse reste un apercu de configuration tant qu'un modele actif et des identifiants n'ont pas ete configures.`,
    ru: `${providerName} уже подключён к уровню оркестрации провайдеров. Сейчас это предварительный ответ настройки, пока не будут настроены реальная модель и учетные данные.`,
  });

  const viewpoints = project.participants.map((participant) => `${participant.name}: ${participant.stance || participant.role}`);
  const argumentsList = project.nodes.filter((node) => ["claim", "rebuttal", "clarification"].includes(node.type)).slice(0, 4).map((node) => node.title);
  const evidence = project.nodes.filter((node) => node.type === "evidence").slice(0, 4).map((node) => node.title);
  const conflicts = project.relations.filter((relation) => relation.type === "rebuts").slice(0, 4).map((relation) => relation.note || relation.type);
  const unresolvedQuestions = project.nodes
    .filter((node) => node.type === "question" && node.status !== "resolved")
    .slice(0, 3)
    .map((node) => node.title);
  const recommendations = project.summary.suggestions.length > 0 ? project.summary.suggestions : [summary];

  return {
    topic: project.summary.coreTopics[0] ?? project.tags[0] ?? project.title,
    viewpoints,
    arguments: argumentsList,
    evidence,
    conflicts,
    summary,
    disputes: project.nodes
      .filter((node) => node.status === "contested")
      .slice(0, 3)
      .map((node) => node.title),
    unresolvedQuestions,
    evaluation: {
      leaning: localize(context.locale, {
        "zh-CN": "待真实模型评估",
        en: "Waiting for a live model evaluation",
        ja: "実モデル評価待ち",
        ko: "실제 모델 평가 대기 중",
        fr: "En attente d'une evaluation par modele actif",
        ru: "Ожидается оценка от реальной модели",
      }),
      favoredByEvidence: summary,
      favoredByResponsiveness: summary,
      favoredByLogic: summary,
      moreUnanswered: summary,
      confidence: localize(context.locale, {
        "zh-CN": "占位",
        en: "Placeholder",
        ja: "プレースホルダー",
        ko: "플레이스홀더",
        fr: "Placeholder",
        ru: "Заглушка",
      }),
      reasons: [summary],
      improvementSuggestions: recommendations,
    },
    conclusion: project.summary.currentConclusion || summary,
    suggestions: recommendations,
    recommendations,
    followupQuestions:
      project.summary.followupQuestions.length > 0
        ? project.summary.followupQuestions
        : project.entries
            .filter((entry) => entry.kind === "question")
            .slice(0, 3)
            .map((entry) => entry.content),
  };
}

export function buildProviderTaskResult(
  providerId: ProviderId,
  task: AiTask,
  packet: OrchestrationPacket,
  output: AiTaskOutput,
  message: string,
): ProviderTaskResult {
  return {
    ok: true,
    providerId,
    task,
    generatedAt: new Date().toISOString(),
    message,
    packet,
    output,
  };
}
