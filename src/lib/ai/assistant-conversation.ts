import { z } from "zod";
import { appendAssistantEventRevision, appendCollaborationMessage, getCollaborationState, sanitizeCollaborationStateForClient } from "@/lib/collaboration/store";
import { createProviderSnapshot, buildUntitledProjectTitle } from "@/lib/factories";
import { getProject, getSettings, upsertProject } from "@/lib/data/repository";
import { buildProviderExecutionConfig, resolveRoomAiExecutionContext } from "@/lib/ai/execution";
import { getProjectAccessState } from "@/lib/project-access";
import { isLocale } from "@/lib/i18n";
import { createId, sanitizePlainText } from "@/lib/utils";
import { getProviderDescriptor } from "@/lib/providers/provider-catalog";
import {
  AnalysisContext,
  AppLocale,
  AppSettings,
  DiscussionProject,
  ProviderConversationResult,
  ProviderConversationTurn,
  ProviderId,
  ProviderRuntimeConfig,
} from "@/lib/types";
import { CollaborationState } from "@/lib/collaboration/types";

export const assistantRequestSchema = z.object({
  message: z.string().max(4000).optional().default(""),
  attachmentIds: z.array(z.string()).max(12).optional(),
  identityId: z.string().max(120).optional(),
  surface: z.enum(["assistant-workspace", "project-workspace"]).optional(),
  locale: z.string().optional(),
  regenerate: z.boolean().optional().default(false),
  replaceAssistantEventId: z.string().max(120).optional(),
}).superRefine((value, ctx) => {
  if (
    value.message.trim().length === 0
    && (value.attachmentIds?.length ?? 0) === 0
    && !(value.regenerate && value.replaceAssistantEventId)
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["message"],
      message: "message-or-attachment-required",
    });
  }
});

export type AssistantRequestPayload = z.infer<typeof assistantRequestSchema>;

export class AssistantConversationError extends Error {
  status: number;
  body: Record<string, unknown>;

  constructor(status: number, body: Record<string, unknown>) {
    super(typeof body.error === "string" ? body.error : "Assistant conversation failed.");
    this.status = status;
    this.body = body;
  }
}

export interface PreparedAssistantConversation {
  settings: AppSettings;
  project: DiscussionProject;
  projectWithMessage: DiscussionProject;
  collaborationAfterUser: CollaborationState;
  payload: AssistantRequestPayload;
  locale: AppLocale;
  executionLocale: AppLocale;
  message: string;
  attachmentIds: string[];
  selectedAttachments: CollaborationState["attachments"];
  participantId: string;
  executionSettings: AppSettings;
  providerId: ProviderId;
  providerConfig: ProviderRuntimeConfig;
  normalizedModel: string;
  roomAiConfig: DiscussionProject["room"]["aiConfig"];
  controllerParticipantId?: string;
  regenerate: boolean;
  replaceAssistantEventId?: string;
  titleSeed: string;
  conversationContext: AnalysisContext;
  conversationOptions: {
    prompt: string;
    history: ProviderConversationTurn[];
  };
}

function localize(locale: AppLocale, values: Partial<Record<AppLocale, string>> & { en: string }) {
  return values[locale] ?? values.en;
}

function resolveAttachmentContextUrl(
  request: Request,
  projectId: string,
  attachment: { id: string; publicUrl?: string; storage: "local" | "external" },
) {
  if (attachment.publicUrl) {
    return attachment.publicUrl;
  }
  if (attachment.storage === "local") {
    const url = new URL(request.url);
    return `${url.origin}/api/projects/${projectId}/attachments/${attachment.id}`;
  }
  return undefined;
}

export function buildConversationHistory(
  _project: DiscussionProject,
  collaboration: CollaborationState,
  options: { regenerate?: boolean; replaceAssistantEventId?: string } = {},
): ProviderConversationTurn[] {
  let events = collaboration.events
    .filter((event) => event.type === "message" || event.actorType === "ai")
    .filter((event) => !options.replaceAssistantEventId || event.id !== options.replaceAssistantEventId);

  if (options.regenerate) {
    while (events.length > 0 && events[events.length - 1]?.actorType === "ai") {
      events = events.slice(0, -1);
    }
  }

  return events
    .map((event) => ({
      role: (event.actorType === "ai" ? "assistant" : "user") as ProviderConversationTurn["role"],
      content: event.message,
    }))
    .slice(-18);
}

function findRegeneratePrompt(collaboration: CollaborationState, replaceAssistantEventId?: string) {
  if (!replaceAssistantEventId) return "";
  const targetIndex = collaboration.events.findIndex((event) => event.id === replaceAssistantEventId);
  if (targetIndex <= 0) return "";
  for (let index = targetIndex - 1; index >= 0; index -= 1) {
    const event = collaboration.events[index];
    if (event.actorType !== "ai" && event.type === "message" && event.message.trim().length > 0) {
      return event.message;
    }
  }
  return "";
}

function buildConversationTitle(message: string, locale: AppLocale) {
  const cleaned = sanitizePlainText(message, 120).replace(/\s+/g, " ").trim();
  const maxLength = locale === "zh-CN" || locale === "ja" ? 18 : 42;
  if (!cleaned) {
    return buildUntitledProjectTitle(locale);
  }
  return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength - 1).trim()}…` : cleaned;
}

function buildAttachmentOnlyPrompt(locale: AppLocale, attachmentNames: string[]) {
  const listed = attachmentNames.slice(0, 3).join(" / ");
  const fallback = listed || localize(locale, {
    "zh-CN": "已附带材料",
    en: "attached material",
    ja: "添付資料",
    ko: "첨부 자료",
    fr: "documents joints",
    ru: "прикрепленные материалы",
  });
  return localize(locale, {
    "zh-CN": `请先查看我刚附带的材料（${fallback}），告诉我其中最重要的信息。`,
    en: `Please review the material I just attached (${fallback}) and tell me what matters most.`,
    ja: `添付した資料（${fallback}）を確認し、重要なポイントを教えてください。`,
    ko: `방금 첨부한 자료(${fallback})를 먼저 검토하고 가장 중요한 내용을 알려주세요.`,
    fr: `Examinez le contenu que je viens d'ajouter (${fallback}) et dites-moi ce qui est le plus important.`,
    ru: `Пожалуйста, изучите только что прикрепленные материалы (${fallback}) и расскажите, что в них самое важное.`,
  });
}

function usesGeneratedAssistantTitle(project: DiscussionProject) {
  const candidates = new Set([
    buildUntitledProjectTitle(project.language),
    localize(project.language, {
      "zh-CN": "个人 AI 工作台",
      en: "Personal AI workspace",
      ja: "個人 AI ワークスペース",
      ko: "개인 AI 워크스페이스",
      fr: "Espace IA personnel",
      ru: "Персональное AI-пространство",
    }),
    localize(project.language, {
      "zh-CN": "个人 AI 对话",
      en: "Personal AI conversation",
      ja: "個人 AI 会話",
      ko: "개인 AI 대화",
      fr: "Conversation IA personnelle",
      ru: "Персональный AI-диалог",
    }),
  ]);
  return candidates.has(project.title.trim());
}

function buildAssistantError(status: number, body: Record<string, unknown>): never {
  throw new AssistantConversationError(status, body);
}

export async function prepareAssistantConversation(projectId: string, request: Request, rawPayload: unknown): Promise<PreparedAssistantConversation> {
  const requestedIdentityId = typeof (rawPayload as { identityId?: unknown } | null)?.identityId === "string"
    ? (rawPayload as { identityId?: string }).identityId
    : undefined;
  const parsedPayload = assistantRequestSchema.safeParse(rawPayload);
  const locale = isLocale((rawPayload as { locale?: string } | null)?.locale ?? "")
    ? ((rawPayload as { locale?: string }).locale as AppLocale)
    : (await getSettings({ identityId: requestedIdentityId })).locale;

  if (!parsedPayload.success) {
    buildAssistantError(400, {
      error: localize(locale, {
        "zh-CN": "个人 AI 对话请求内容无效，请检查消息内容后重试。",
        en: "The personal AI conversation payload is invalid. Check the message and try again.",
        ja: "個人 AI 対話リクエストが無効です。メッセージ内容を確認して再試行してください。",
        ko: "개인 AI 대화 요청 내용이 올바르지 않습니다. 메시지 내용을 확인한 뒤 다시 시도하세요.",
        fr: "Le contenu de la conversation IA personnelle est invalide. Verifiez le message puis reessayez.",
        ru: "Запрос персонального AI-диалога недействителен. Проверьте сообщение и повторите попытку.",
      }),
    });
  }

  const payload = parsedPayload.data;
  const settings = await getSettings({ identityId: payload.identityId });
  const project = await getProject(projectId, locale, { includePendingDeletion: true });
  const executionLocale = isLocale((rawPayload as { locale?: string } | null)?.locale ?? "")
    ? ((rawPayload as { locale?: string }).locale as AppLocale)
    : project.language;
  const access = getProjectAccessState(project, settings);
  const singleUserMode = project.scenario === "ai-dialogue" && project.participants.length === 1;

  if (!singleUserMode) {
    buildAssistantError(409, {
      error: localize(locale, {
        "zh-CN": "这个会话已经不是单用户工作台，请改用正式工作区继续协作。",
        en: "This conversation is no longer a single-user workspace. Continue in the shared project workspace instead.",
        ja: "この会話はすでに単独ワークスペースではありません。共有プロジェクトのワークスペースで続けてください。",
        ko: "이 대화는 더 이상 단일 사용자 워크스페이스가 아닙니다. 공유 프로젝트 워크스페이스에서 계속 협업하세요.",
        fr: "Cette conversation n'est plus un espace individuel. Continuez plutot dans l'espace de travail partage du projet.",
        ru: "Этот диалог больше не является одиночным рабочим пространством. Продолжайте в общем рабочем пространстве проекта.",
      }),
    });
  }

  if (!access.canPostMessages || access.ownedParticipantIds.length === 0) {
    buildAssistantError(403, {
      error: localize(locale, {
        "zh-CN": "当前本地身份没有可用的单用户发言席位。",
        en: "Your current local profile does not control this personal AI workspace.",
        ja: "現在のローカルプロフィールはこの個人 AI ワークスペースを操作できません。",
        ko: "현재 로컬 프로필은 이 개인 AI 워크스페이스를 제어할 수 없습니다.",
        fr: "Votre profil local actuel ne controle pas cet espace IA personnel.",
        ru: "Текущий локальный профиль не управляет этим персональным AI-пространством.",
      }),
    });
  }

  if (project.metadata.pendingDeletionAt) {
    buildAssistantError(409, {
      error: localize(locale, {
        "zh-CN": "这个会话已进入待清理状态，恢复后才能继续聊天。",
        en: "This session is pending cleanup. Restore it before you continue chatting.",
        ja: "このセッションは削除待ちです。続けるには先に復元してください。",
        ko: "이 세션은 정리 대기 상태입니다. 계속 채팅하려면 먼저 복원하세요.",
        fr: "Cette session est en attente de suppression. Restaurez-la avant de continuer.",
        ru: "Этот сеанс ожидает очистки. Восстановите его перед продолжением чата.",
      }),
    });
  }

  if (project.metadata.archivedAt) {
    buildAssistantError(409, {
      error: localize(locale, {
        "zh-CN": "这个会话已归档，恢复后才能继续聊天。",
        en: "This session is archived. Restore it before you continue chatting.",
        ja: "このセッションはアーカイブ済みです。続けるには先に復元してください。",
        ko: "이 세션은 보관되었습니다. 계속 채팅하려면 먼저 복원하세요.",
        fr: "Cette session est archivee. Restaurez-la avant de continuer.",
        ru: "Этот сеанс архивирован. Восстановите его перед продолжением чата.",
      }),
    });
  }

  const message = sanitizePlainText(payload.message ?? "", 4000);
  const hasMessage = message.trim().length > 0;
  const regenerate = Boolean(payload.regenerate);
  const collaborationState = await getCollaborationState(project);
  const attachmentIds = (payload.attachmentIds ?? []).filter((attachmentId) => collaborationState.attachments.some((attachment) => attachment.id === attachmentId));
  const selectedAttachments = collaborationState.attachments.filter((attachment) => attachmentIds.includes(attachment.id));
  const participantId = access.ownedParticipantIds[0];
  const occurredAt = new Date().toISOString();
  const messageKind = /[?？]$/.test(message.trim()) ? "question" : "statement";
  const replaceAssistantEventId = payload.replaceAssistantEventId
    && collaborationState.events.some((event) => event.id === payload.replaceAssistantEventId && event.actorType === "ai")
    ? payload.replaceAssistantEventId
    : undefined;

  if (regenerate && !replaceAssistantEventId) {
    buildAssistantError(400, {
      error: localize(locale, {
        "zh-CN": "无法重新生成：未找到可替换的 AI 回复。请刷新后重试。",
        en: "Cannot regenerate: the assistant reply to revise was not found. Refresh and try again.",
        ja: "再生成できません。置き換える AI 応答が見つかりません。更新して再試行してください。",
        ko: "다시 생성할 수 없습니다. 수정할 AI 응답을 찾지 못했습니다. 새로고침 후 다시 시도하세요.",
        fr: "Impossible de regénérer : la réponse IA à réviser est introuvable. Actualisez puis réessayez.",
        ru: "Не удалось сгенерировать заново: ответ AI для версии не найден. Обновите страницу и повторите попытку.",
      }),
      project,
      collaboration: sanitizeCollaborationStateForClient(collaborationState),
    });
  }

  const projectWithMessage = !regenerate && hasMessage
    ? await upsertProject(
        {
          ...project,
          updatedAt: occurredAt,
          metadata: {
            ...project.metadata,
            lastActiveAt: occurredAt,
          },
          entries: [
            ...project.entries,
            {
              id: createId("entry"),
              participantId,
              ownerParticipantId: participantId,
              occurredAt,
              content: message,
              tags: [],
              kind: messageKind,
              highlighted: false,
              linkedNodeIds: [],
              relatedEntryIds: [],
              source: "manual",
              syncState: "synced",
              roomId: project.room.id,
              sessionId: project.room.session.id,
            },
          ],
        },
        executionLocale,
        { skipAutoAnalyze: true },
      )
    : project;

  const collaborationAfterUser = regenerate
    ? collaborationState
    : await appendCollaborationMessage(projectWithMessage, {
        type: "message",
        participantId,
        message,
        attachmentIds,
      });

  const roomAiConfig = projectWithMessage.room.aiConfig;
  const execution = await resolveRoomAiExecutionContext(projectWithMessage, settings);
  const executionSettings = execution.executionSettings;

  if (!executionSettings) {
    buildAssistantError(409, {
      error: localize(locale, {
        "zh-CN": "当前工作台没有可用的已保存 AI 配置，请先在设置中保存 Provider、模型与 API Key。",
        en: "No saved AI configuration is available for this workspace yet. Save the provider, model, and API key in Settings first.",
        ja: "このワークスペースで使える保存済み AI 設定がまだありません。まず Settings でプロバイダー、モデル、API キーを保存してください。",
        ko: "이 워크스페이스에서 사용할 수 있는 저장된 AI 구성이 아직 없습니다. 먼저 설정에서 제공업체, 모델, API 키를 저장하세요.",
        fr: "Aucune configuration IA enregistree n'est disponible pour cet espace. Enregistrez d'abord le fournisseur, le modele et la cle API dans Settings.",
        ru: "Для этого рабочего пространства пока нет сохраненной AI-конфигурации. Сначала сохраните поставщика, модель и API-ключ в настройках.",
      }),
      project: projectWithMessage,
      collaboration: sanitizeCollaborationStateForClient(collaborationAfterUser),
    });
  }

  const providerId = execution.providerId;
  const providerConfig = execution.providerConfig;
  const normalizedModel = execution.normalizedModel;

  if (!providerConfig || !execution.hasAvailableCredentials) {
    buildAssistantError(409, {
      error: localize(locale, {
        "zh-CN": "当前工作台没有可用的 AI 凭据，请先在设置中保存 Provider、模型与 API Key，或配置对应环境变量。",
        en: "No usable AI credentials are available for this workspace yet. Save the provider, model, and API key in Settings, or configure the matching environment variable.",
        ja: "このワークスペースで使える AI 認証情報がまだありません。Settings に Provider・モデル・API キーを保存するか、対応する環境変数を設定してください。",
        ko: "이 워크스페이스에서 사용할 수 있는 AI 자격 증명이 아직 없습니다. 설정에서 제공업체, 모델, API 키를 저장하거나 해당 환경 변수를 구성하세요.",
        fr: "Aucun identifiant IA exploitable n'est disponible pour cet espace. Enregistrez le fournisseur, le modele et la cle API dans Settings, ou configurez la variable d'environnement correspondante.",
        ru: "Для этого рабочего пространства пока нет пригодных AI-учетных данных. Сохраните поставщика, модель и API-ключ в настройках или настройте соответствующую переменную окружения.",
      }),
      project: projectWithMessage,
      collaboration: sanitizeCollaborationStateForClient(collaborationAfterUser),
    });
  }

  if (!execution.modelSupported) {
    buildAssistantError(400, {
      error: localize(locale, {
        "zh-CN": `${providerId} 不支持模型 ${execution.requestedModel}，请在设置中改成该提供方目录内的有效模型。`,
        en: `${providerId} does not support model ${execution.requestedModel}. Switch to a valid model for that provider in Settings.`,
        ja: `${providerId} はモデル ${execution.requestedModel} をサポートしていません。Settings で有効なモデルへ切り替えてください。`,
        ko: `${providerId}은(는) 모델 ${execution.requestedModel}을 지원하지 않습니다. 설정에서 해당 제공업체의 유효한 모델로 전환하세요.`,
        fr: `${providerId} ne prend pas en charge le modele ${execution.requestedModel}. Choisissez un modele valide pour ce fournisseur dans les reglages.`,
        ru: `${providerId} не поддерживает модель ${execution.requestedModel}. Переключитесь в настройках на допустимую модель для этого поставщика.`,
      }),
      project: projectWithMessage,
      collaboration: sanitizeCollaborationStateForClient(collaborationAfterUser),
    });
  }

  const conversationContext = {
    locale: executionLocale,
    assistantSurface: payload.surface ?? "assistant-workspace",
    replyLanguage: executionSettings.aiPreferences?.replyLanguage ?? "auto",
    aiRole: executionSettings.aiPreferences?.aiRole ?? "assistant",
    responseLength: executionSettings.aiPreferences?.responseLength ?? "standard",
    focusTopics: executionSettings.aiPreferences?.focusTopics ?? "",
    autoTagging: executionSettings.aiPreferences?.autoTagging ?? false,
    emphasis: executionSettings.provider.mockEmphasis,
    stage: "capture" as const,
    goal: projectWithMessage.goal,
    providerConfig: buildProviderExecutionConfig(providerId, providerConfig, normalizedModel),
    requestTimeoutMs: executionSettings.provider.requestTimeoutMs,
    preferServerKeys: executionSettings.provider.preferServerKeys,
    allowFallbackToScaffold: executionSettings.provider.allowFallbackToScaffold,
    enableStreaming: Boolean(
      executionSettings.provider.enableStreaming
      && providerConfig.streaming
      && getProviderDescriptor(providerId)?.capabilities.streaming,
    ),
    attachmentContext: {
      total: selectedAttachments.length,
      items: selectedAttachments.slice(0, 8).map((attachment) => ({
        id: attachment.id,
        name: attachment.name,
        kind: attachment.kind,
        mimeType: attachment.mimeType,
        note: attachment.note,
        previewText: attachment.previewText,
        uploadedAt: attachment.uploadedAt,
        uploadedByParticipantId: attachment.uploadedByParticipantId,
        storage: attachment.storage,
        localPath: attachment.localPath,
        publicUrl: resolveAttachmentContextUrl(request, projectWithMessage.id, attachment),
      })),
    },
  };

  const regeneratePrompt = regenerate ? findRegeneratePrompt(collaborationAfterUser, replaceAssistantEventId) : "";
  const conversationPrompt = message || regeneratePrompt || buildAttachmentOnlyPrompt(executionLocale, selectedAttachments.map((attachment) => attachment.name));

  const conversationOptions = {
    prompt: conversationPrompt,
    history: buildConversationHistory(projectWithMessage, collaborationAfterUser, { regenerate, replaceAssistantEventId }),
  };

  return {
    settings,
    project,
    projectWithMessage,
    collaborationAfterUser,
    payload,
    locale,
    executionLocale,
    message,
    attachmentIds,
    selectedAttachments,
    participantId,
    executionSettings,
    providerId,
    providerConfig,
    normalizedModel,
    roomAiConfig,
    controllerParticipantId: execution.controllerParticipant?.id,
    regenerate,
    replaceAssistantEventId,
    titleSeed: conversationPrompt || selectedAttachments[0]?.name || "",
    conversationContext,
    conversationOptions,
  };
}

export async function finalizeAssistantConversation(
  prepared: PreparedAssistantConversation,
  conversation: ProviderConversationResult,
  options: {
    aiMetadata?: Record<string, string>;
  } = {},
) {
  const nextTitle = conversation.ok && usesGeneratedAssistantTitle(prepared.projectWithMessage)
    ? buildConversationTitle(prepared.titleSeed, prepared.executionLocale)
    : prepared.projectWithMessage.title;

  const updatedProject = await upsertProject(
    {
      ...prepared.projectWithMessage,
      title: nextTitle,
      providerSnapshot: createProviderSnapshot(
        prepared.providerId,
        prepared.normalizedModel,
        conversation.ok ? "assistant-live" : "assistant-error",
        conversation.generatedAt,
      ),
      room: {
        ...prepared.projectWithMessage.room,
        aiConfig: {
          ...prepared.projectWithMessage.room.aiConfig,
          providerId: prepared.providerId,
          model: prepared.normalizedModel,
          ownerIdentityId: prepared.roomAiConfig.ownerIdentityId ?? prepared.executionSettings.profile.localIdentityId,
          ownerParticipantId: prepared.controllerParticipantId ?? prepared.roomAiConfig.ownerParticipantId ?? prepared.participantId,
          updatedAt: conversation.generatedAt,
          updatedByParticipantId: prepared.participantId,
        },
      },
      metadata: {
        ...prepared.projectWithMessage.metadata,
        lastActiveAt: conversation.generatedAt,
      },
    },
    prepared.executionLocale,
    { skipAutoAnalyze: true, settingsOverride: prepared.executionSettings },
  );

  if (!conversation.ok) {
    return {
      project: updatedProject,
      collaboration: sanitizeCollaborationStateForClient(prepared.collaborationAfterUser),
      roomAiConfig: updatedProject.room.aiConfig,
    };
  }

  if (prepared.regenerate && prepared.replaceAssistantEventId) {
    const collaboration = await appendAssistantEventRevision(updatedProject, prepared.replaceAssistantEventId, {
      content: conversation.reply,
      createdAt: conversation.generatedAt,
      providerId: prepared.providerId,
      model: prepared.normalizedModel,
      reasoning: conversation.reasoning,
      metadata: {
        providerId: prepared.providerId,
        model: prepared.normalizedModel,
        controllerIdentityId: updatedProject.room.aiConfig.ownerIdentityId ?? prepared.executionSettings.profile.localIdentityId,
        assistant: "true",
        ...options.aiMetadata,
      },
    });

    return {
      project: updatedProject,
      collaboration: sanitizeCollaborationStateForClient(collaboration ?? prepared.collaborationAfterUser),
      roomAiConfig: updatedProject.room.aiConfig,
    };
  }

  const collaboration = await appendCollaborationMessage(updatedProject, {
    type: "message",
    actorType: "ai",
    message: conversation.reply,
    metadata: {
      providerId: prepared.providerId,
      model: prepared.normalizedModel,
      controllerIdentityId: updatedProject.room.aiConfig.ownerIdentityId ?? prepared.executionSettings.profile.localIdentityId,
      assistant: "true",
      ...(conversation.reasoning?.trim() ? { reasoning: conversation.reasoning.trim() } : {}),
      ...options.aiMetadata,
    },
  });

  return {
    project: updatedProject,
    collaboration: sanitizeCollaborationStateForClient(collaboration),
    roomAiConfig: updatedProject.room.aiConfig,
  };
}
