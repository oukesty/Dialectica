import {
  AppLocale,
  AppSettings,
  DiscussionRoom,
  InsightPanelData,
  Participant,
  ProjectScenario,
  ProjectSummary,
  ProviderConfiguration,
  ProviderId,
  ProviderRuntimeConfig,
  ProviderRuntimeMap,
  RoomTransport,
  RoomVisibility,
} from "@/lib/types";
import { createId, createScopedId, normalizeText } from "@/lib/utils";
import { providerCatalog, getProviderDescriptor } from "@/lib/providers/provider-catalog";
import { defaultCustomTheme } from "@/lib/theme";

function localeText<T>(locale: AppLocale, values: Partial<Record<AppLocale, T>> & { en: T }) {
  return values[locale] ?? values.en;
}

const DEFAULT_PROFILE_DISPLAY_NAME_BY_LOCALE: Record<AppLocale, string> = {
  en: "Me",
  "zh-CN": "我",
  ja: "私",
  ko: "나",
  fr: "Moi",
  ru: "Я",
};

const LEGACY_PROFILE_DISPLAY_NAMES = [
  "Local Host",
  "本地主持人",
  "ローカルホスト",
  "로컬 호스트",
  "Hote local",
  "Локальный ведущий",
];

const SYSTEM_PROFILE_DISPLAY_NAME_SET = new Set(
  [...Object.values(DEFAULT_PROFILE_DISPLAY_NAME_BY_LOCALE), ...LEGACY_PROFILE_DISPLAY_NAMES].map((value) => normalizeText(value)),
);

export function getDefaultProfileDisplayName(locale: AppLocale): string {
  return DEFAULT_PROFILE_DISPLAY_NAME_BY_LOCALE[locale] ?? DEFAULT_PROFILE_DISPLAY_NAME_BY_LOCALE.en;
}

export function isSystemDefaultProfileDisplayName(value?: string | null): boolean {
  if (!value) return false;
  return SYSTEM_PROFILE_DISPLAY_NAME_SET.has(normalizeText(value));
}

export function resolveProfileDisplayName(
  locale: AppLocale,
  value?: string | null,
  displayNameIsDefault?: boolean | null,
): { displayName: string; displayNameIsDefault: boolean } {
  const trimmed = typeof value === "string" ? value.trim() : "";
  const inferredIsDefault = typeof displayNameIsDefault === "boolean"
    ? displayNameIsDefault
    : !trimmed || isSystemDefaultProfileDisplayName(trimmed);

  if (inferredIsDefault) {
    return {
      displayName: getDefaultProfileDisplayName(locale),
      displayNameIsDefault: true,
    };
  }

  return {
    displayName: trimmed || getDefaultProfileDisplayName(locale),
    displayNameIsDefault: false,
  };
}

export function buildUntitledProjectTitle(locale: AppLocale) {
  return localeText(locale, {
    en: "Untitled Discussion Workspace",
    "zh-CN": "未命名讨论工作区",
    ja: "名称未設定のディスカッションワークスペース",
    ko: "제목 없는 토론 워크스페이스",
    fr: "Espace de discussion sans titre",
    ru: "Рабочее пространство обсуждения без названия",
  });
}

function createRuntimeConfig(providerId: ProviderId): ProviderRuntimeConfig {
  const descriptor = getProviderDescriptor(providerId);
  if (!descriptor) {
    throw new Error(`Missing provider descriptor for ${providerId}.`);
  }

  return {
    providerId,
    enabled: providerId === "mock",
    mode: descriptor.mode,
    model: descriptor.models[0]?.id ?? "",
    apiKey: "",
    baseUrl: providerId === "mock" ? "local://mock" : providerId === "disabled" ? "local://disabled" : "",
    organization: "",
    notes: "",
    streaming: descriptor.capabilities.streaming,
    temperature: providerId === "mock" ? 0 : 0.2,
    testState: "idle",
    hasStoredApiKey: false,
    maskedApiKey: "",
    clearStoredApiKey: false,
  };
}

export function createRoomAiConfig(
  providerId: ProviderId,
  model: string,
  options: {
    ownerIdentityId?: string;
    ownerParticipantId?: string;
    updatedByParticipantId?: string;
  } = {},
) {
  return {
    providerId,
    model,
    ownerIdentityId: options.ownerIdentityId,
    ownerParticipantId: options.ownerParticipantId,
    updatedAt: new Date().toISOString(),
    updatedByParticipantId: options.updatedByParticipantId,
  };
}

export function getProviderDescriptors() {
  return providerCatalog;
}

export function createProviderRuntimeMap(): ProviderRuntimeMap {
  return {
    mock: createRuntimeConfig("mock"),
    disabled: createRuntimeConfig("disabled"),
    openai: createRuntimeConfig("openai"),
    gemini: createRuntimeConfig("gemini"),
    grok: createRuntimeConfig("grok"),
    claude: createRuntimeConfig("claude"),
    deepseek: createRuntimeConfig("deepseek"),
    doubao: createRuntimeConfig("doubao"),
    qwen: createRuntimeConfig("qwen"),
  };
}

export function createDefaultProviderConfiguration(): ProviderConfiguration {
  return {
    activeProviderId: "mock",
    activeMode: "mock",
    descriptors: getProviderDescriptors(),
    providers: createProviderRuntimeMap(),
    mockEmphasis: "balanced",
    autoSummary: true,
    autoEvaluation: false,
    enableStreaming: true,
    requestTimeoutMs: 30000,
    preferServerKeys: true,
    allowFallbackToScaffold: true,
  };
}

export function createEmptyInsights(timestamp: string): InsightPanelData {
  return {
    updatedAt: timestamp,
    items: [],
  };
}

export function createEmptySummary(locale: AppLocale): ProjectSummary {
  return {
    overview: localeText(locale, {
      en: "No AI summary yet.",
      "zh-CN": "尚无 AI 总结。",
      ja: "AI 要約はまだありません。",
      ko: "아직 AI 요약이 없습니다.",
      fr: "Aucun résumé IA pour le moment.",
      ru: "Сводка ИИ пока отсутствует.",
    }),
    participantOverview: [],
    coreTopics: [],
    majorClaims: [],
    keyEvidence: [],
    majorRebuttals: [],
    unresolvedQuestions: [],
    disputes: [],
    currentConclusion: localeText(locale, {
      en: "No conclusion has been reached yet.",
      "zh-CN": "尚未形成当前结论。",
      ja: "現時点の結論はまだありません。",
      ko: "아직 현재 결론이 도출되지 않았습니다.",
      fr: "Aucune conclusion n'a encore été retenue.",
      ru: "Итоговый вывод пока не сформирован.",
    }),
    nextSteps: [],
    suggestions: [],
    followupQuestions: [],
    history: [],
    evaluation: {
      leaning: localeText(locale, {
        en: "Pending evaluation",
        "zh-CN": "待评估",
        ja: "評価待ち",
        ko: "평가 대기 중",
        fr: "Évaluation en attente",
        ru: "Ожидает оценки",
      }),
      favoredByEvidence: localeText(locale, {
        en: "Pending analysis",
        "zh-CN": "待分析",
        ja: "分析待ち",
        ko: "분석 대기 중",
        fr: "Analyse en attente",
        ru: "Ожидает анализа",
      }),
      favoredByResponsiveness: localeText(locale, {
        en: "Pending analysis",
        "zh-CN": "待分析",
        ja: "分析待ち",
        ko: "분석 대기 중",
        fr: "Analyse en attente",
        ru: "Ожидает анализа",
      }),
      favoredByLogic: localeText(locale, {
        en: "Pending analysis",
        "zh-CN": "待分析",
        ja: "分析待ち",
        ko: "분석 대기 중",
        fr: "Analyse en attente",
        ru: "Ожидает анализа",
      }),
      moreUnanswered: localeText(locale, {
        en: "Pending analysis",
        "zh-CN": "待分析",
        ja: "分析待ち",
        ko: "분석 대기 중",
        fr: "Analyse en attente",
        ru: "Ожидает анализа",
      }),
      confidence: localeText(locale, {
        en: "Low",
        "zh-CN": "低",
        ja: "低",
        ko: "낮음",
        fr: "Faible",
        ru: "Низкая",
      }),
      reasons: [],
      improvementSuggestions: [],
    },
  };
}

export function createDefaultGoal(locale: AppLocale, scenario: ProjectScenario) {
  const text = localeText(locale, {
    en: {
      debate: "Clarify the central claim, evidence, and rebuttal chain.",
      discussion: "Capture structured viewpoints, disagreements, and next actions around one topic.",
      meeting: "Align information, disputes, and decisions around the meeting objective.",
      negotiation: "Turn competing interests into an actionable negotiation path and follow-up plan.",
      "ai-dialogue": "Capture reusable insights, prompt strategies, and conclusions from a human-AI dialogue.",
      "document-driven-discussion": "Organize a discussion around source materials, attachments, and referenced evidence.",
    },
    "zh-CN": {
      debate: "围绕核心主张梳理立场、证据与反驳链条。",
      discussion: "围绕同一议题沉淀结构化观点、分歧与下一步行动。",
      meeting: "围绕会议目标对齐信息、争议点与决策事项。",
      negotiation: "围绕利益差异形成可执行的协商方案与后续安排。",
      "ai-dialogue": "围绕人与 AI 的多轮对话沉淀观点、提示策略与可复用结论。",
      "document-driven-discussion": "围绕附件、纪要和证据材料组织带来源引用的结构化讨论。",
    },
    ja: {
      debate: "中心主張、根拠、反論のつながりを明確に整理します。",
      discussion: "同じ議題について、構造化された見解、相違点、次の行動を記録します。",
      meeting: "会議の目的に沿って、情報、争点、意思決定事項を整理します。",
      negotiation: "利害の違いを実行可能な交渉案と次の対応にまとめます。",
      "ai-dialogue": "人と AI の対話から、再利用可能な示唆、プロンプト戦略、結論を整理します。",
      "document-driven-discussion": "文書、添付資料、参照根拠を軸にした議論を構造化して整理します。",
    },
    ko: {
      debate: "핵심 주장과 근거, 반박의 흐름을 명확히 정리합니다.",
      discussion: "하나의 주제를 중심으로 구조화된 관점, 쟁점, 다음 행동을 정리합니다.",
      meeting: "회의 목표를 기준으로 정보, 쟁점, 결정 사항을 정렬합니다.",
      negotiation: "상충하는 이해관계를 실행 가능한 협상 경로와 후속 계획으로 정리합니다.",
      "ai-dialogue": "인간과 AI의 대화에서 재사용 가능한 인사이트, 프롬프트 전략, 결론을 정리합니다.",
      "document-driven-discussion": "문서, 첨부자료, 인용 근거를 중심으로 토론을 구조화합니다.",
    },
    fr: {
      debate: "Clarifier la thèse centrale, les preuves et la chaîne de contre-arguments.",
      discussion: "Structurer les points de vue, les désaccords et les prochaines actions autour d'un même sujet.",
      meeting: "Aligner les informations, les divergences et les décisions autour de l'objectif de réunion.",
      negotiation: "Transformer des intérêts divergents en trajectoire de négociation actionnable et en plan de suivi.",
      "ai-dialogue": "Structurer les enseignements, stratégies de prompt et conclusions issus d'un dialogue humain-IA.",
      "document-driven-discussion": "Organiser une discussion appuyée sur des documents, pièces jointes et sources citées.",
    },
    ru: {
      debate: "Прояснить ключевой тезис, доказательства и цепочку возражений.",
      discussion: "Собрать структурированные точки зрения, разногласия и следующие шаги вокруг одной темы.",
      meeting: "Согласовать информацию, спорные точки и решения вокруг цели встречи.",
      negotiation: "Преобразовать конфликт интересов в практический сценарий переговоров и план дальнейших действий.",
      "ai-dialogue": "Сохранить полезные выводы, стратегии промптов и итоги из диалога человека с ИИ.",
      "document-driven-discussion": "Организовать обсуждение вокруг исходных материалов, вложений и цитируемых доказательств.",
    },
  });

  return text[scenario];
}

export function createParticipantPresence(sessionId: string, status: Participant["presence"]["status"] = "offline") {
  return {
    status,
    lastSeenAt: new Date().toISOString(),
    isTyping: false,
    sessionId,
  };
}

export function inferHostParticipant(participants: Participant[]) {
  return participants.find((participant) => participant.collaborationRole === "host")?.id
    ?? participants.find((participant) => participant.role === "moderator")?.id
    ?? participants[0]?.id;
}

interface RoomCreationOptions {
  visibility?: RoomVisibility;
  transport?: RoomTransport;
  autoSummary?: boolean;
  autoEvaluation?: boolean;
  sessionAutoStart?: boolean;
  aiConfig?: DiscussionRoom["aiConfig"];
}

export function createDiscussionRoom(
  locale: AppLocale,
  goal: string,
  participants: Participant[] = [],
  options: RoomCreationOptions = {},
): DiscussionRoom {
  const roomId = createId("room");
  const sessionId = createId("session");
  const timestamp = new Date().toISOString();
  const hostParticipantId = inferHostParticipant(participants);
  const observerIds = participants
    .filter((participant) => participant.collaborationRole === "observer")
    .map((participant) => participant.id);
  const visibility = options.visibility ?? "private";
  const transport = options.transport ?? "local-mock";
  const autoSummary = options.autoSummary ?? true;
  const autoEvaluation = options.autoEvaluation ?? true;
  const sessionAutoStart = options.sessionAutoStart ?? true;

  const hostProfileOwnerId = participants.find((participant) => participant.id === hostParticipantId)?.profileOwnerId;

  return {
    id: roomId,
    slug: roomId.replace(/_/g, "-"),
    visibility,
    joinMode: (options as Record<string, unknown>).joinMode === "approval" ? "approval" as const : "open" as const,
    accessCode: roomId.slice(-6).toUpperCase(),
    notes: [
      localeText(locale, {
        en: "This is a local-first collaboration prototype with reserved interfaces for sync, streaming, and multi-client collaboration.",
        "zh-CN": "当前是本地优先的协作原型，已预留实时同步、流式输出和多端协作接口。",
        ja: "現在はローカルファーストの協働プロトタイプであり、同期、ストリーミング、マルチクライアント協働のインターフェースを確保しています。",
        ko: "현재는 로컬 우선 협업 프로토타입이며, 동기화·스트리밍·멀티클라이언트 협업을 위한 인터페이스를 확보해 두었습니다.",
        fr: "Il s'agit d'un prototype local-first avec des interfaces réservées pour la synchronisation, le streaming et la collaboration multi-clients.",
        ru: "Сейчас это локально-ориентированный прототип совместной работы с заделом под синхронизацию, стриминг и многоклиентское взаимодействие.",
      }),
    ],
    session: {
      id: sessionId,
      title: localeText(locale, {
        en: "Live discussion session",
        "zh-CN": "实时讨论会话",
        ja: "ライブディスカッションセッション",
        ko: "실시간 토론 세션",
        fr: "Session de discussion en direct",
        ru: "Сессия живого обсуждения",
      }),
      goal,
      hostParticipantId,
      status: participants.length > 0 && sessionAutoStart ? "live" : "scheduled",
      startedAt: timestamp,
      observerIds,
      sync: {
        transport,
        status: "idle",
        latencyMs: 0,
        backlog: 0,
        streamingReady: false,
        lastEventAt: timestamp,
      },
    },
    presence: participants.map((participant) => ({
      participantId: participant.id,
      collaborationRole: participant.collaborationRole,
      status: participant.presence.status,
      sessionId,
      deviceLabel: participant.seatLabel ?? participant.name,
      connectionId: createId("presence"),
      lastSeenAt: participant.presence.lastSeenAt,
      active: participant.presence.status !== "offline",
    })),
    autoSummary,
    autoEvaluation,
    aiConfig: options.aiConfig ?? createRoomAiConfig("mock", "rule-balanced-v1", {
      ownerIdentityId: hostProfileOwnerId,
      ownerParticipantId: hostParticipantId,
      updatedByParticipantId: hostParticipantId,
    }),
    aiAutomation: {
      mode: "off",
      summaryThreshold: 20,
      summaryCurrentThreshold: 20,
      summaryLastProcessedEntryCount: 0,
      autoReplyThreshold: 20,
      permissions: {
        facilitatorCanManage: false,
        facilitatorCanTrigger: false,
      },
    },
  };
}

export function createDefaultSettings(locale: AppLocale = "zh-CN"): AppSettings {
  return {
    locale,
    theme: "system",
    datetimeFormat: "absolute",
    profile: {
      localIdentityId: createScopedId("profile", 16),
      displayName: getDefaultProfileDisplayName(locale),
      displayNameIsDefault: true,
      avatarPreset: "ember",
      avatarImageDataUrl: "",
    },
    appearancePreferences: {
      themePreset: "dialectica",
      reduceMotion: false,
      customTheme: defaultCustomTheme,
      customThemeName: localeText(locale, {
        en: "My Dialectica Theme",
        "zh-CN": "我的 Dialectica 主题",
        ja: "マイ Dialectica テーマ",
        ko: "내 Dialectica 테마",
        fr: "Mon theme Dialectica",
        ru: "Моя тема Dialectica",
      }),
      savedThemes: [],
    },
    defaultScenario: "discussion",
    defaultExportFormat: "markdown",
    provider: createDefaultProviderConfiguration(),
    discussionPreferences: {
      compactTimeline: false,
      highlightKeywords: true,
      graphDensity: "comfortable",
      defaultWorkspaceTab: "capture",
      singleUserAutoSummaryThreshold: 20,
      multiUserAutoSummaryThreshold: 20,
      assistiveSummaryThreshold: 15,
      latestAiHistoryMode: "latest-only",
      latestAiHistoryLimit: 3,
      summaryHistoryRetentionMode: "unlimited",
      summaryHistoryRetentionLimit: 20,
    },
    collaborationPreferences: {
      defaultVisibility: "private",
      defaultTransport: "local-mock",
      sessionAutoStart: true,
      sessionAutoArchive: false,
      showPresenceIndicators: true,
      allowInvites: true,
      syncPollingMs: 8000,
      showSystemEvents: true,
      eventHistoryLimit: 120,
      defaultMemberRole: "participant",
      notificationsEnabled: true,
      notificationDoNotDisturb: false,
    },
    knowledgePreferences: {
      autoExtractOnSave: false,
      autoExtractAfterAiTask: false,
      includeAttachmentsAsEvidence: true,
      includeUnresolvedQuestions: true,
      autoGenerateGraphLinks: false,
      defaultView: "hub",
      defaultGraphMode: "both",
      graphOutputLanguage: "auto",
    },
    aiPreferences: {
      replyLanguage: "auto",
      aiRole: "assistant",
      responseLength: "standard",
      focusTopics: "",
      autoTagging: true,
    },
    uploadPreferences: {
      allowDocuments: true,
      allowImages: true,
      allowVideos: true,
      retainLocalFiles: true,
      maxUploadMb: 32,
    },
    participantNicknames: {},
    tagColors: {},
    customShortcuts: {},
    quickReplies: [],
    projectOrder: [],
    savedTemplates: [],
    emailNotifications: {
      enabled: false,
      emailAddress: "",
      onNewMember: true,
      onAiSummary: true,
      onRoomArchived: true,
    },
    privacy: {
      storeApiKeysLocally: true,
      analyticsMode: "local-only",
      shareDiagnostics: false,
      assistantSessionCleanup: {
        enabled: false,
        maxIdleDays: 90,
      },
    },
    about: {
      projectName: "Dialectica",
      version: "0.5.0",
      repositoryUrl: "",
      license: "MIT",
    },
  };
}
export function createProviderSnapshot(
  providerId: ProviderId,
  model: string,
  version: string,
  generatedAt = new Date().toISOString(),
) {
  return {
    providerId,
    model,
    generatedAt,
    version,
  };
}
