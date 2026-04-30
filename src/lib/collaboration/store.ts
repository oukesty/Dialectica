import { mkdir, readFile, rm, unlink } from "node:fs/promises";
import path from "node:path";
import { bundledSampleProjectIds } from "@/data/samples";
import { writeFileAtomic } from "@/lib/atomic-file";
import {
  CollaborationEvent,
  CollaborationEventRevision,
  CollaborationPresence,
  CollaborationState,
  CollaborationTransport,
  EventActorType,
  RoomAttachment,
  RoomInvite,
} from "@/lib/collaboration/types";
import { AppLocale, DiscussionProject, PresenceStatus } from "@/lib/types";
import { createId, createSecureToken, sanitizeOptionalText } from "@/lib/utils";

const dataRoot = path.join(process.cwd(), "data");
const collaborationRoot = path.join(dataRoot, "collaboration");
const uploadRoot = path.join(dataRoot, "uploads");
const SAFE_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

function assertSafeId(id: string, label = "id"): void {
  if (!id || !SAFE_ID_PATTERN.test(id)) {
    throw new Error(`Invalid ${label}: contains disallowed characters`);
  }
}

function localize(locale: AppLocale, values: Partial<Record<AppLocale, string>> & { en: string }) {
  return values[locale] ?? values.en;
}

function localizePresenceStatus(locale: AppLocale, status: PresenceStatus) {
  return localize(locale, {
    "zh-CN": status === "online" ? "在线" : status === "away" ? "离开" : status === "syncing" ? "同步中" : status === "leaving" ? "离开中" : "离线",
    en: status === "online" ? "online" : status === "away" ? "away" : status === "syncing" ? "syncing" : status === "leaving" ? "leaving" : "offline",
    ja: status === "online" ? "オンライン" : status === "away" ? "離席" : status === "syncing" ? "同期中" : status === "leaving" ? "離脱中" : "オフライン",
    fr: status === "online" ? "en ligne" : status === "away" ? "absent" : status === "syncing" ? "en synchronisation" : status === "leaving" ? "quitte la salle" : "hors ligne",
    ko: status === "online" ? "온라인" : status === "away" ? "자리 비움" : status === "syncing" ? "동기화 중" : status === "leaving" ? "퇴장 중" : "오프라인",
    ru: status === "online" ? "в сети" : status === "away" ? "нет на месте" : status === "syncing" ? "синхронизируется" : status === "leaving" ? "выходит" : "не в сети",
  });
}

async function ensureDirectories(projectId?: string) {
  await mkdir(collaborationRoot, { recursive: true });
  await mkdir(uploadRoot, { recursive: true });
  if (projectId) {
    assertSafeId(projectId, "projectId");
    await mkdir(path.join(uploadRoot, projectId), { recursive: true });
  }
}

function getStateFile(projectId: string) {
  assertSafeId(projectId, "projectId");
  return path.join(collaborationRoot, `${projectId}.json`);
}

function isBundledSampleProjectId(projectId: string) {
  return bundledSampleProjectIds.has(projectId);
}

async function removeFileIfExists(filePath: string) {
  try {
    await unlink(filePath);
  } catch (error) {
    if ((error as { code?: string }).code !== "ENOENT") {
      throw error;
    }
  }
}

export function getUploadDirectory(projectId: string) {
  assertSafeId(projectId, "projectId");
  return path.join(uploadRoot, projectId);
}

function normalizePresence(project: DiscussionProject, current: CollaborationPresence[] = []) {
  return project.participants.map((participant) => {
    const existing = current.find((entry) => entry.participantId === participant.id);
    return {
      participantId: participant.id,
      participantName: participant.name,
      role: participant.collaborationRole,
      status: existing?.status ?? participant.presence.status,
      isTyping: existing?.isTyping ?? participant.presence.isTyping,
      connectionId: existing?.connectionId ?? project.room.presence.find((item) => item.participantId === participant.id)?.connectionId ?? createId("conn"),
      sessionId: existing?.sessionId ?? participant.presence.sessionId ?? project.room.session.id,
      lastHeartbeatAt: existing?.lastHeartbeatAt ?? participant.presence.lastSeenAt,
      active: existing?.active ?? participant.presence.status !== "offline",
    } satisfies CollaborationPresence;
  });
}

function baseSync(project: DiscussionProject, transport: CollaborationTransport = "local-poll") {
  return {
    transport,
    updatedAt: new Date().toISOString(),
    heartbeatAt: project.room.session.sync.lastEventAt,
    onlineCount: project.room.presence.filter((presence) => presence.active).length,
    typingParticipantIds: [],
    lastEventId: undefined,
    cursor: 0,
  };
}

function createDefaultState(project: DiscussionProject): CollaborationState {
  const createdAt = new Date().toISOString();
  return {
    projectId: project.id,
    roomId: project.room.id,
    invites: [],
    presence: normalizePresence(project),
    attachments: [],
    events: [
      {
        id: createId("event"),
        type: "system",
        actorType: "system",
        createdAt,
        message: localize(project.language, {
          "zh-CN": `共享讨论空间 ${project.room.session.title} 已就绪，历史记录、AI 结果和附件会在这里持续汇总。`,
          en: `Shared discussion room ${project.room.session.title} is ready. History, AI updates, and attachments will accumulate here.`,
          ja: `共有ディスカッションルーム ${project.room.session.title} の準備ができました。履歴、AI 更新、添付資料がここに集約されます。`,
          ko: `공유 토론 공간 ${project.room.session.title} 준비가 끝났습니다. 기록, AI 결과, 첨부 파일이 이곳에 계속 모입니다.`,
          fr: `L'espace de discussion partagé ${project.room.session.title} est prêt. L'historique, les sorties IA et les pièces jointes s'accumulent ici.`,
          ru: `Общее дискуссионное пространство ${project.room.session.title} готово. История, результаты ИИ и вложения будут собираться здесь.`,
        }),
        attachmentIds: [],
        metadata: {
          sessionId: project.room.session.id,
          roomId: project.room.id,
        },
      },
    ],
    sync: baseSync(project),
    version: 2,
  };
}

function buildInitialStateFromProject(project: DiscussionProject): CollaborationState | null {
  const summaryOverview = project.summary.overview.trim();
  const emptySummaryOverview = localize(project.language, {
    "zh-CN": "尚无 AI 总结。",
    en: "No AI summary yet.",
    ja: "AI 要約はまだありません。",
    ko: "아직 AI 요약이 없습니다.",
    fr: "Aucun résumé IA pour le moment.",
    ru: "AI-сводки пока нет.",
  });
  const hasRealSummaryOverview = summaryOverview.length > 0 && summaryOverview !== emptySummaryOverview;
  const hasProjectHistory = project.entries.length > 0 || hasRealSummaryOverview;
  if (!hasProjectHistory) {
    return null;
  }

  const defaultState = createDefaultState(project);
  const entryEvents: CollaborationEvent[] = project.entries.map((entry) => {
    const participant = project.participants.find((item) => item.id === entry.participantId);
    const isSystemSummary = entry.source === "system" && entry.kind === "summary";
    const isSystemActor = entry.source === "system";
    return {
      id: `event-project-entry-${entry.id}`,
      type: isSystemSummary ? "system" : "message",
      actorType: isSystemActor ? "system" : "participant",
      createdAt: entry.occurredAt,
      participantId: isSystemActor ? undefined : entry.participantId,
      participantName: isSystemActor ? undefined : participant?.name,
      role: isSystemActor ? undefined : participant?.collaborationRole,
      message: entry.content,
      attachmentIds: [],
      metadata: {
        kind: entry.kind,
        source: entry.source,
        sessionId: entry.sessionId,
        roomId: entry.roomId,
      },
    } satisfies CollaborationEvent;
  });

  const summaryPrefix = localize(project.language, {
    "zh-CN": "AI 总结",
    en: "AI summary",
    ja: "AI 要約",
    ko: "AI 요약",
    fr: "Résumé IA",
    ru: "AI-сводка",
  });

  const aiSummaryEvent: CollaborationEvent | null = hasRealSummaryOverview
    ? {
        id: `event-project-ai-${project.id}`,
        type: "system",
        actorType: "ai",
        aiTask: "summarizeDiscussion",
        createdAt: project.updatedAt,
        message: `${summaryPrefix}: ${summaryOverview}`,
        attachmentIds: [],
        metadata: {
          providerId: project.providerSnapshot.providerId,
          model: project.providerSnapshot.model,
        },
      }
    : null;

  const events = [
    ...defaultState.events,
    ...entryEvents,
    ...(aiSummaryEvent ? [aiSummaryEvent] : []),
  ];

  return {
    ...defaultState,
    events,
    sync: {
      ...defaultState.sync,
      updatedAt: project.updatedAt,
      heartbeatAt: project.room.session.sync.lastEventAt,
      onlineCount: defaultState.presence.filter((item) => item.active).length,
      typingParticipantIds: defaultState.presence.filter((item) => item.isTyping).map((item) => item.participantId),
      lastEventId: events.at(-1)?.id,
      cursor: events.length,
    },
  };
}

function normalizeState(raw: unknown, project: DiscussionProject): CollaborationState {
  const defaults = createDefaultState(project);
  const input = (raw ?? {}) as Partial<CollaborationState>;
  const presence = normalizePresence(project, input.presence ?? defaults.presence);
  const events = Array.isArray(input.events) && input.events.length > 0
    ? input.events.map((event) => ({ ...event, actorType: event.actorType ?? (event.type === "message" ? "participant" : "system") }))
    : defaults.events;
  const attachments = Array.isArray(input.attachments) ? input.attachments : defaults.attachments;
  const invites = Array.isArray(input.invites) ? input.invites : defaults.invites;
  const typingParticipantIds = presence.filter((item) => item.isTyping).map((item) => item.participantId);

  return {
    projectId: project.id,
    roomId: project.room.id,
    invites,
    presence,
    attachments,
    events,
    sync: {
      ...defaults.sync,
      ...(input.sync ?? {}),
      updatedAt: input.sync?.updatedAt ?? defaults.sync.updatedAt,
      heartbeatAt: input.sync?.heartbeatAt ?? defaults.sync.heartbeatAt,
      onlineCount: presence.filter((item) => item.active).length,
      typingParticipantIds,
      lastEventId: events.at(-1)?.id,
      cursor: Math.max(input.sync?.cursor ?? 0, events.length),
    },
    version: Math.max(2, input.version ?? 2),
  };
}

async function readRawState(projectId: string) {
  await ensureDirectories();
  try {
    const raw = await readFile(getStateFile(projectId), "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function getCollaborationState(project: DiscussionProject) {
  const raw = await readRawState(project.id);
  const derived = raw ?? buildInitialStateFromProject(project);
  const state = normalizeState(derived, project);
  if (!raw && !isBundledSampleProjectId(project.id)) {
    await saveCollaborationState(state);
  }
  return state;
}

export async function syncCollaborationState(project: DiscussionProject) {
  const raw = await readRawState(project.id);
  const derived = raw ?? buildInitialStateFromProject(project);
  const state = normalizeState(derived, project);
  await saveCollaborationState(state);
  return state;
}

export async function saveCollaborationState(state: CollaborationState) {
  if (isBundledSampleProjectId(state.projectId)) {
    return state;
  }
  await ensureDirectories(state.projectId);
  await writeFileAtomic(getStateFile(state.projectId), `${JSON.stringify(state, null, 2)}\n`, "utf-8");
  return state;
}

export function sanitizeRoomAttachmentForClient(attachment: RoomAttachment): RoomAttachment {
  const safeAttachment = { ...attachment };
  delete safeAttachment.localPath;
  return safeAttachment;
}

export function sanitizeCollaborationStateForClient(state: CollaborationState): CollaborationState {
  return {
    ...state,
    attachments: state.attachments.map(sanitizeRoomAttachmentForClient),
  };
}

function withEvent(state: CollaborationState, event: CollaborationEvent) {
  const events = [...state.events, event].slice(-240);
  return {
    ...state,
    events,
    sync: {
      ...state.sync,
      updatedAt: new Date().toISOString(),
      heartbeatAt: event.createdAt,
      lastEventId: event.id,
      cursor: events.length,
    },
  } satisfies CollaborationState;
}

function buildBaseRevision(event: CollaborationEvent): CollaborationEventRevision {
  return {
    id: event.activeRevisionId ?? createId("revision"),
    content: event.message,
    createdAt: event.createdAt,
    providerId: event.metadata.providerId,
    model: event.metadata.model,
    reasoning: event.metadata.reasoning,
  };
}

function ensureAssistantRevisions(event: CollaborationEvent) {
  const existing = Array.isArray(event.revisions)
    ? event.revisions.filter((revision) => revision.content.trim().length > 0)
    : [];
  const revisions = existing.length > 0 ? existing : [buildBaseRevision(event)];
  const activeRevisionId = revisions.some((revision) => revision.id === event.activeRevisionId)
    ? event.activeRevisionId!
    : revisions[revisions.length - 1].id;

  return { revisions, activeRevisionId };
}

function applyRevisionMetadata(
  metadata: Record<string, string>,
  revision: Pick<CollaborationEventRevision, "providerId" | "model" | "reasoning">,
  extra: Record<string, string> = {},
) {
  const nextMetadata = { ...metadata, ...extra };
  if (revision.providerId) nextMetadata.providerId = revision.providerId;
  if (revision.model) nextMetadata.model = revision.model;
  if (revision.reasoning?.trim()) {
    nextMetadata.reasoning = revision.reasoning.trim();
  } else {
    delete nextMetadata.reasoning;
  }
  return nextMetadata;
}

export async function appendAssistantEventRevision(
  project: DiscussionProject,
  eventId: string,
  payload: {
    content: string;
    createdAt?: string;
    providerId?: string;
    model?: string;
    reasoning?: string;
    metadata?: Record<string, string>;
  },
) {
  const state = await getCollaborationState(project);
  const createdAt = payload.createdAt ?? new Date().toISOString();
  const content = payload.content.trim();
  if (!content) return null;

  let updatedEvent: CollaborationEvent | null = null;
  const events = state.events.map((event) => {
    if (event.id !== eventId || event.actorType !== "ai") return event;
    const { revisions } = ensureAssistantRevisions(event);
    const nextRevision: CollaborationEventRevision = {
      id: createId("revision"),
      content,
      createdAt,
      providerId: payload.providerId,
      model: payload.model,
      reasoning: payload.reasoning?.trim() || undefined,
    };
    updatedEvent = {
      ...event,
      message: content,
      editedAt: createdAt,
      revisions: [...revisions, nextRevision],
      activeRevisionId: nextRevision.id,
      metadata: applyRevisionMetadata(event.metadata, nextRevision, payload.metadata),
    };
    return updatedEvent;
  });

  if (!updatedEvent) return null;

  const next: CollaborationState = {
    ...state,
    events,
    sync: {
      ...state.sync,
      updatedAt: createdAt,
      heartbeatAt: createdAt,
      lastEventId: eventId,
      cursor: events.length,
    },
  };
  await saveCollaborationState(next);
  return next;
}

export async function activateAssistantEventRevision(project: DiscussionProject, eventId: string, revisionId: string) {
  const state = await getCollaborationState(project);
  const activatedAt = new Date().toISOString();
  let updatedEvent: CollaborationEvent | null = null;
  const events = state.events.map((event) => {
    if (event.id !== eventId || event.actorType !== "ai") return event;
    const revisions = Array.isArray(event.revisions) ? event.revisions : [];
    const revision = revisions.find((candidate) => candidate.id === revisionId);
    if (!revision) return event;
    updatedEvent = {
      ...event,
      message: revision.content,
      editedAt: activatedAt,
      activeRevisionId: revision.id,
      revisions,
      metadata: applyRevisionMetadata(event.metadata, revision),
    };
    return updatedEvent;
  });

  if (!updatedEvent) return null;

  const next: CollaborationState = {
    ...state,
    events,
    sync: {
      ...state.sync,
      updatedAt: activatedAt,
      lastEventId: eventId,
      cursor: events.length,
    },
  };
  await saveCollaborationState(next);
  return next;
}

export async function createInvite(
  project: DiscussionProject,
  payload: { role: RoomInvite["role"]; createdByParticipantId?: string; expiresInHours?: number; note?: string },
) {
  const state = await getCollaborationState(project);
  const createdAt = new Date().toISOString();
  const expiresAt = payload.expiresInHours ? new Date(Date.now() + payload.expiresInHours * 3_600_000).toISOString() : undefined;
  const token = createSecureToken(10);
  const invite: RoomInvite = {
    id: createId("invite"),
    token,
    inviteUrl: `/${project.language}/projects/${project.id}?invite=${token}`,
    role: payload.role,
    status: "active",
    createdAt,
    createdByParticipantId: payload.createdByParticipantId,
    expiresAt,
    note: sanitizeOptionalText(payload.note, 240),
  };

  const next = withEvent(
    {
      ...state,
      invites: [invite, ...state.invites].slice(0, 24),
    },
    {
      id: createId("event"),
      type: "invite",
      actorType: "system",
      createdAt,
      participantId: payload.createdByParticipantId,
      participantName: project.participants.find((item) => item.id === payload.createdByParticipantId)?.name,
      role: payload.role,
      message: localize(project.language, {
        "zh-CN": `已创建 ${payload.role} 邀请链接，新的成员进入后会看到完整共享历史。`,
        en: `An invite link for the ${payload.role} role has been created. New members will enter with full shared history.`,
        ja: `${payload.role} ロール向けの招待リンクを作成しました。新しい参加者は共有履歴を確認できます。`,
        fr: `Un lien d'invitation pour le rôle ${payload.role} a été créé. Les nouveaux membres entreront avec l'historique partagé complet.`,
      }),
      attachmentIds: [],
      metadata: {
        token,
        expiresAt: expiresAt ?? "",
      },
    },
  );

  await saveCollaborationState(next);
  return { state: next, invite };
}

export async function appendCollaborationMessage(
  project: DiscussionProject,
  payload: {
    type: CollaborationEvent["type"];
    participantId?: string;
    message: string;
    attachmentIds?: string[];
    metadata?: Record<string, string>;
    actorType?: EventActorType;
    aiTask?: CollaborationEvent["aiTask"];
  },
) {
  const state = await getCollaborationState(project);
  const participant = project.participants.find((item) => item.id === payload.participantId);
  const createdAt = new Date().toISOString();
  const next = withEvent(state, {
    id: createId("event"),
    type: payload.type,
    createdAt,
    participantId: payload.participantId,
    participantName: participant?.name,
    role: participant?.collaborationRole,
    actorType: payload.actorType ?? (payload.type === "message" ? "participant" : "system"),
    aiTask: payload.aiTask,
    message: payload.message,
    attachmentIds: payload.attachmentIds ?? [],
    metadata: payload.metadata ?? {},
  });

  await saveCollaborationState(next);
  return next;
}

export async function updatePresence(
  project: DiscussionProject,
  payload: {
    participantId: string;
    status: PresenceStatus;
    isTyping?: boolean;
  },
) {
  const state = await getCollaborationState(project);
  const participant = project.participants.find((item) => item.id === payload.participantId);
  const timestamp = new Date().toISOString();
  const presence = state.presence.map((entry) =>
    entry.participantId === payload.participantId
      ? {
          ...entry,
          status: payload.status,
          isTyping: payload.isTyping ?? entry.isTyping,
          active: payload.status !== "offline",
          lastHeartbeatAt: timestamp,
        }
      : entry,
  );

  const next = withEvent(
    {
      ...state,
      presence,
      sync: {
        ...state.sync,
        onlineCount: presence.filter((entry) => entry.active).length,
        typingParticipantIds: presence.filter((entry) => entry.isTyping).map((entry) => entry.participantId),
      },
    },
    {
      id: createId("event"),
      type: "presence",
      actorType: "system",
      createdAt: timestamp,
      participantId: payload.participantId,
      participantName: participant?.name,
      role: participant?.collaborationRole,
      message: localize(project.language, {
        "zh-CN": `${participant?.name ?? payload.participantId} 的在线状态已更新为 ${localizePresenceStatus(project.language, payload.status)}。`,
        en: `${participant?.name ?? payload.participantId} is now ${localizePresenceStatus(project.language, payload.status)}.`,
        ja: `${participant?.name ?? payload.participantId} の在席状態が ${localizePresenceStatus(project.language, payload.status)} に更新されました。`,
        fr: `Le statut de présence de ${participant?.name ?? payload.participantId} est maintenant ${localizePresenceStatus(project.language, payload.status)}.`,
      }),
      attachmentIds: [],
      metadata: {
        status: payload.status,
        typing: String(Boolean(payload.isTyping)),
      },
    },
  );

  await saveCollaborationState(next);
  return next;
}

export async function addAttachment(
  project: DiscussionProject,
  payload: Omit<RoomAttachment, "id" | "uploadedAt">,
) {
  const state = await getCollaborationState(project);
  const attachment: RoomAttachment = {
    ...payload,
    id: createId("asset"),
    uploadedAt: new Date().toISOString(),
  };
  const uploader = project.participants.find((item) => item.id === attachment.uploadedByParticipantId);
  const next = withEvent(
    {
      ...state,
      attachments: [attachment, ...state.attachments].slice(0, 80),
    },
    {
      id: createId("event"),
      type: "attachment",
      actorType: "system",
      createdAt: attachment.uploadedAt,
      participantId: attachment.uploadedByParticipantId,
      participantName: uploader?.name,
      role: uploader?.collaborationRole,
      message: localize(project.language, {
        "zh-CN": `${attachment.name} 已上传到共享讨论空间，可作为证据、参考或来源材料引用。`,
        en: `${attachment.name} was uploaded to the shared discussion room and can be referenced as evidence or source material.`,
        ja: `${attachment.name} が共有ディスカッションルームにアップロードされ、根拠や参照資料として利用できます。`,
        fr: `${attachment.name} a été téléversé dans l'espace partagé et peut être utilisé comme preuve ou source.`,
      }),
      attachmentIds: [attachment.id],
      metadata: {
        kind: attachment.kind,
        mimeType: attachment.mimeType,
      },
    },
  );

  await saveCollaborationState(next);
  return { state: next, attachment };
}

export async function deleteAttachment(project: DiscussionProject, attachmentId: string) {
  const state = await getCollaborationState(project);
  const attachment = state.attachments.find((candidate) => candidate.id === attachmentId);
  if (!attachment) {
    return null;
  }

  if (attachment.storage === "local" && attachment.localPath) {
    const uploadDir = path.resolve(getUploadDirectory(project.id));
    const resolvedPath = path.resolve(attachment.localPath);
    if (resolvedPath.startsWith(uploadDir)) {
      await removeFileIfExists(resolvedPath);
    }
  }

  const next: CollaborationState = {
    ...state,
    attachments: state.attachments.filter((candidate) => candidate.id !== attachmentId),
    events: state.events.map((event) => (
      event.attachmentIds.includes(attachmentId)
        ? { ...event, attachmentIds: event.attachmentIds.filter((candidate) => candidate !== attachmentId) }
        : event
    )),
    sync: {
      ...state.sync,
      updatedAt: new Date().toISOString(),
    },
  };

  await saveCollaborationState(next);
  return { state: next, attachment };
}

export async function acceptInvite(
  project: DiscussionProject,
  payload: {
    token: string;
    participantId: string;
    participantName: string;
  },
) {
  const state = await getCollaborationState(project);
  const createdAt = new Date().toISOString();
  const invite = state.invites.find((candidate) => candidate.token === payload.token);
  if (!invite) {
    throw new Error("invite-not-found");
  }
  const presence = normalizePresence(project, state.presence);
  const next = withEvent(
    {
      ...state,
      invites: state.invites.map((candidate) =>
        candidate.token === payload.token
          ? {
              ...candidate,
              status: "accepted",
              acceptedAt: createdAt,
              acceptedByParticipantName: payload.participantName,
            }
          : candidate,
      ),
      presence,
    },
    {
      id: createId("event"),
      type: "join",
      actorType: "system",
      createdAt,
      participantId: payload.participantId,
      participantName: payload.participantName,
      role: invite.role,
      message: localize(project.language, {
        "zh-CN": `${payload.participantName} 已通过邀请加入共享讨论空间，并可查看历史消息与 AI 结果。`,
        en: `${payload.participantName} joined the shared discussion room through an invite and can see the full history and AI updates.`,
        ja: `${payload.participantName} が招待経由で共有ディスカッションルームに参加し、履歴と AI 出力を確認できるようになりました。`,
        fr: `${payload.participantName} a rejoint l'espace partagé via une invitation et peut consulter l'historique ainsi que les sorties IA.`,
      }),
      attachmentIds: [],
      metadata: {
        token: payload.token,
      },
    },
  );

  await saveCollaborationState(next);
  return next;
}

export async function writeUploadedFile(projectId: string, fileName: string, bytes: Buffer) {
  await ensureDirectories(projectId);
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]+/g, "-");
  const target = path.join(getUploadDirectory(projectId), `${Date.now()}-${safeName}`);
  await writeFileAtomic(target, bytes);
  return target;
}

export async function toggleEventReaction(project: DiscussionProject, eventId: string, emoji: string, userId: string) {
  const state = await getCollaborationState(project);
  if (!state) return null;
  const event = state.events.find((e) => e.id === eventId);
  if (!event) return null;
  const reactions = event.reactions ?? {};
  const users = reactions[emoji] ?? [];
  if (users.includes(userId)) {
    reactions[emoji] = users.filter((u) => u !== userId);
    if (reactions[emoji].length === 0) delete reactions[emoji];
  } else {
    reactions[emoji] = [...users, userId];
  }
  event.reactions = reactions;
  await saveCollaborationState(state);
  return state;
}

export async function deleteCollaborationArtifacts(projectId: string) {
  await ensureDirectories();
  await Promise.all([
    removeFileIfExists(getStateFile(projectId)),
    rm(getUploadDirectory(projectId), { recursive: true, force: true }),
  ]);
}
