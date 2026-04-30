export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { z } from "zod";
import { resolveAutoTriggeredTasks } from "@/lib/ai/summary-automation";
import { activateAssistantEventRevision, appendCollaborationMessage, getCollaborationState, sanitizeCollaborationStateForClient, saveCollaborationState, toggleEventReaction, updatePresence } from "@/lib/collaboration/store";
import { CollaborationState } from "@/lib/collaboration/types";
import { getProject, getSettings, syncRoomFromParticipants, upsertProject } from "@/lib/data/repository";
import { getProjectAccessState, isProjectWorkspaceArchived } from "@/lib/project-access";
import { AppLocale, DiscussionProject, ENTRY_KINDS, PRESENCE_STATUSES } from "@/lib/types";
import { isLocale } from "@/lib/i18n";
import { createId, sanitizeOptionalText, sanitizePlainText } from "@/lib/utils";

const eventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("message"),
    participantId: z.string().optional(),
    message: z.string().max(4000).optional().default("") ,
    attachmentIds: z.array(z.string()).optional(),
    metadata: z.record(z.string(), z.string()).optional(),
    occurredAt: z.string().optional(),
    kind: z.enum(ENTRY_KINDS).optional(),
    tags: z.array(z.string()).max(16).optional(),
    highlighted: z.boolean().optional(),
  }).superRefine((value, ctx) => {
    const hasMessage = value.message.trim().length > 0;
    const hasAttachments = (value.attachmentIds?.length ?? 0) > 0;
    if (!hasMessage && !hasAttachments) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["message"],
        message: "Either a message or at least one attachment must be provided.",
      });
    }
  }),
  z.object({
    type: z.literal("presence"),
    participantId: z.string(),
    status: z.enum(PRESENCE_STATUSES),
    isTyping: z.boolean().optional(),
  }),
]);

function localize(locale: AppLocale, values: Partial<Record<AppLocale, string>> & { en: string }) {
  return values[locale] ?? values.en;
}

function applyPresenceToProject(
  project: DiscussionProject,
  payload: z.infer<typeof eventSchema> & { type: "presence" },
) {
  const timestamp = new Date().toISOString();
  const participants = project.participants.map((participant) =>
    participant.id === payload.participantId
      ? {
          ...participant,
          presence: {
            ...participant.presence,
            status: payload.status,
            isTyping: payload.isTyping ?? participant.presence.isTyping,
            lastSeenAt: timestamp,
            sessionId: project.room.session.id,
          },
        }
      : participant,
  );
  const room = syncRoomFromParticipants(project, participants);

  return {
    ...project,
    updatedAt: timestamp,
    participants,
    room: {
      ...room,
      session: {
        ...room.session,
        sync: {
          ...project.room.session.sync,
          lastEventAt: timestamp,
          status: payload.status === "syncing"
            ? "syncing"
            : project.room.session.sync.status === "paused"
              ? "paused"
              : "idle",
        },
      },
    },
  } satisfies DiscussionProject;
}

export async function GET(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await context.params;
  const settings = await getSettings();
  const url = new URL(request.url);
  const locale = isLocale(url.searchParams.get("locale") ?? "") ? (url.searchParams.get("locale") as AppLocale) : settings.locale;
  const since = Number(url.searchParams.get("since") ?? "0");
  const project = await getProject(projectId, locale);
  const access = getProjectAccessState(project, settings);

  if (!access.canRead) {
    return NextResponse.json({
      error: localize(project.language, {
        "zh-CN": "当前身份无权查看这个房间。",
        en: "Your current local profile cannot view this room.",
        ja: "現在のローカルプロフィールではこのルームを表示できません。",
        ko: "현재 로컬 프로필로는 이 방을 볼 수 없습니다.",
        fr: "Le profil local actuel ne peut pas consulter ce salon.",
        ru: "Текущий локальный профиль не может просматривать эту комнату.",
      }),
    }, { status: 404 });
  }

  const collaboration = sanitizeCollaborationStateForClient(await getCollaborationState(project));
  const events = Number.isFinite(since) && since > 0 ? collaboration.events.slice(since) : collaboration.events;
  return NextResponse.json({ events, sync: collaboration.sync, presence: collaboration.presence, cursor: collaboration.sync.cursor, project });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await context.params;
  const settings = await getSettings();
  const url = new URL(request.url);
  const locale = isLocale(url.searchParams.get("locale") ?? "") ? (url.searchParams.get("locale") as AppLocale) : settings.locale;

  let rawPayload: unknown;
  try {
    rawPayload = await request.json();
  } catch {
    return NextResponse.json({
      error: localize(locale, {
        "zh-CN": "房间事件请求内容无效，请检查后重试。",
        en: "The room event payload is invalid. Check the submitted JSON and try again.",
        ja: "ルームイベントの内容が無効です。送信した JSON を確認して再試行してください。",
        ko: "방 이벤트 요청 내용이 올바르지 않습니다. 확인 후 다시 시도해 주세요.",
        fr: "Le contenu de l'événement de salon est invalide. Vérifiez le JSON envoyé puis réessayez.",
        ru: "Некорректное содержимое запроса события комнаты. Проверьте его и попробуйте снова.",
      }),
    }, { status: 400 });
  }

  const parsedPayload = eventSchema.safeParse(rawPayload);
  if (!parsedPayload.success) {
    return NextResponse.json({
      error: localize(locale, {
        "zh-CN": "房间事件字段无效，请检查参与者、状态或消息内容后重试。",
        en: "The room event fields are invalid. Check the participant, status, or message fields and try again.",
        ja: "ルームイベントの項目が無効です。参加者、状態、またはメッセージ内容を確認して再試行してください。",
        ko: "방 이벤트 필드가 올바르지 않습니다. 참가자, 상태 또는 메시지 내용을 확인해 주세요.",
        fr: "Les champs de l'événement de salon sont invalides. Vérifiez le participant, l'état ou le message puis réessayez.",
        ru: "Поля события комнаты некорректны. Проверьте участника, статус или текст сообщения.",
      }),
      issues: parsedPayload.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
    }, { status: 400 });
  }

  const payload = parsedPayload.data;
  const project = await getProject(projectId, locale);
  const access = getProjectAccessState(project, settings);

  if (!access.canRead) {
    return NextResponse.json({
      error: localize(project.language, {
        "zh-CN": "当前身份无权访问这个房间。",
        en: "Your current local profile cannot access this room.",
        ja: "現在のローカルプロフィールではこのルームにアクセスできません。",
        ko: "현재 로컬 프로필로는 이 방에 접근할 수 없습니다.",
        fr: "Le profil local actuel ne peut pas accéder à ce salon.",
        ru: "Текущий локальный профиль не может получить доступ к этой комнате.",
      }),
    }, { status: 404 });
  }

  if (payload.type === "message") {
    const resolvedParticipantId = payload.participantId ?? access.ownedParticipantIds[0];

    if (!access.canPostMessages || !resolvedParticipantId) {
      return NextResponse.json({
        error: localize(project.language, {
          "zh-CN": access.canJoinPublicRoom ? "请先加入这个公共房间，再以你的身份发言。" : "当前身份没有可用的发言席位。",
          en: access.canJoinPublicRoom ? "Join this public room before posting with your identity." : "Your current identity does not have a speaker slot in this room.",
          ja: access.canJoinPublicRoom ? "この公開ルームに参加してから、自分のプロフィールで発言してください。" : "現在のプロフィールにはこのルームで発言できる席がありません。",
          ko: access.canJoinPublicRoom ? "이 공개 방에 먼저 참여한 뒤 현재 프로필로 발언해 주세요." : "현재 프로필에는 이 방에서 발언할 수 있는 좌석이 없습니다.",
          fr: access.canJoinPublicRoom ? "Rejoignez d'abord ce salon public avant de publier avec votre identité." : "Votre identité actuelle n'a pas de siège de parole dans ce salon.",
          ru: access.canJoinPublicRoom ? "Сначала войдите в эту публичную комнату, а затем отправляйте сообщения от своего профиля." : "У текущего профиля нет места для выступления в этой комнате.",
        }),
      }, { status: access.canJoinPublicRoom ? 409 : 403 });
    }

    if (!access.ownedParticipantIds.includes(resolvedParticipantId)) {
      return NextResponse.json({
        error: localize(project.language, {
          "zh-CN": "你只能以当前本地身份绑定的参与者发言。",
          en: "You can only post as participants bound to your current local profile.",
          ja: "現在のローカルプロフィールに紐づく参加者としてのみ投稿できます。",
          ko: "현재 로컬 프로필에 연결된 참가자 자격으로만 발언할 수 있습니다.",
          fr: "Vous ne pouvez publier qu'au nom des participants liés à votre profil local actuel.",
          ru: "Отправлять сообщения можно только от участников, связанных с текущим локальным профилем.",
        }),
      }, { status: 403 });
    }

    const collaborationState = await getCollaborationState(project);
    const sanitizedAttachmentIds = (payload.attachmentIds ?? []).filter((attachmentId) =>
      collaborationState.attachments.some((attachment) => attachment.id === attachmentId),
    );
    if ((payload.attachmentIds?.length ?? 0) !== sanitizedAttachmentIds.length) {
      return NextResponse.json({
        error: localize(project.language, {
          "zh-CN": "消息引用了当前房间中不存在的附件。",
          en: "The message references attachments that are not available in this room.",
          ja: "このメッセージは現在のルームに存在しない添付ファイルを参照しています。",
          ko: "이 메시지는 현재 방에 없는 첨부파일을 참조하고 있습니다.",
          fr: "Le message reference des pieces jointes indisponibles dans ce salon.",
          ru: "Сообщение ссылается на вложения, которых нет в этой комнате.",
        }),
      }, { status: 400 });
    }

    const sanitizedMessage = sanitizePlainText(payload.message, 4000);
    const occurredAt = payload.occurredAt && !Number.isNaN(Date.parse(payload.occurredAt)) ? new Date(payload.occurredAt).toISOString() : new Date().toISOString();
    const sanitizedTags = (payload.tags ?? []).map((tag) => sanitizeOptionalText(tag, 40)).filter(Boolean).slice(0, 12);
    const savedProject = sanitizedMessage
      ? await upsertProject({
          ...project,
          updatedAt: occurredAt,
          entries: [
            ...project.entries,
            {
              id: createId("entry"),
              participantId: resolvedParticipantId,
              ownerParticipantId: resolvedParticipantId,
              occurredAt,
              content: sanitizedMessage,
              tags: sanitizedTags,
              kind: payload.kind ?? "statement",
              highlighted: payload.highlighted ?? false,
              linkedNodeIds: [],
              relatedEntryIds: [],
              source: "manual",
              syncState: "synced",
              roomId: project.room.id,
              sessionId: project.room.session.id,
            },
          ],
        }, locale)
      : project;

    const collaboration = await appendCollaborationMessage(savedProject, {
      type: "message",
      participantId: resolvedParticipantId,
      message: sanitizedMessage,
      attachmentIds: sanitizedAttachmentIds,
      metadata: payload.metadata,
    });

    const aiTriggeredTasks = resolveAutoTriggeredTasks(savedProject);

    return NextResponse.json({
      collaboration: sanitizeCollaborationStateForClient(collaboration),
      project: savedProject,
      aiTriggeredTasks,
    });
  }

  if (!access.canUpdatePresence) {
    return NextResponse.json({
      error: localize(project.language, {
        "zh-CN": access.canJoinPublicRoom ? "请先加入这个公共房间，再更新你的在线状态。" : "当前身份没有可更新的在线状态。",
        en: access.canJoinPublicRoom ? "Join this public room before updating your presence." : "Your current identity does not have a presence record in this room.",
        ja: access.canJoinPublicRoom ? "この公開ルームに参加してから在席状態を更新してください。" : "現在のプロフィールにはこのルームで更新できる在席レコードがありません。",
        ko: access.canJoinPublicRoom ? "이 공개 방에 먼저 참여한 뒤 온라인 상태를 업데이트해 주세요." : "현재 프로필에는 이 방에서 갱신할 수 있는 상태 기록이 없습니다.",
        fr: access.canJoinPublicRoom ? "Rejoignez d'abord ce salon public avant de mettre à jour votre présence." : "Votre identité actuelle n'a pas d'état de présence modifiable dans ce salon.",
        ru: access.canJoinPublicRoom ? "Сначала войдите в эту публичную комнату, а затем обновляйте свой статус присутствия." : "У текущего профиля нет записи присутствия в этой комнате.",
      }),
    }, { status: access.canJoinPublicRoom ? 409 : 403 });
  }

  if (!access.canManageParticipants && !access.ownedParticipantIds.includes(payload.participantId)) {
    return NextResponse.json({
      error: localize(project.language, {
        "zh-CN": "你只能更新自己在这个房间里的在线状态。",
        en: "You can only update presence for your own room identity.",
        ja: "このルームでは自分の在席状態のみ更新できます。",
        ko: "이 방에서는 자신의 상태만 업데이트할 수 있습니다.",
        fr: "Vous ne pouvez mettre à jour que la présence de votre propre identité dans ce salon.",
        ru: "В этой комнате можно обновлять только собственный статус присутствия.",
      }),
    }, { status: 403 });
  }

  const collaboration = await updatePresence(project, payload);
  const savedProject = await upsertProject(applyPresenceToProject(project, payload), locale);
  return NextResponse.json({ collaboration: sanitizeCollaborationStateForClient(collaboration), project: savedProject });
}

/** PATCH: Toggle emoji reaction, edit message, delete message, or switch an AI revision */
export async function PATCH(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await context.params;
  const settings = await getSettings();
  const url = new URL(request.url);
  const locale = isLocale(url.searchParams.get("locale") ?? "") ? (url.searchParams.get("locale") as AppLocale) : settings.locale;
  const project = await getProject(projectId, locale);
  if (!project) {
    return NextResponse.json({ error: localize(locale, {
      "zh-CN": "项目不存在。",
      en: "Project not found.",
      ja: "プロジェクトが見つかりません。",
      ko: "프로젝트를 찾을 수 없습니다.",
      fr: "Projet introuvable.",
      ru: "Проект не найден.",
    }) }, { status: 404 });
  }

  const access = getProjectAccessState(project, settings);
  if (!access.canRead) {
    return NextResponse.json({ error: localize(project.language, {
      "zh-CN": "当前身份无权访问这个房间。",
      en: "Your current local profile cannot access this room.",
      ja: "現在のローカルプロフィールではこのルームにアクセスできません。",
      ko: "현재 로컬 프로필로는 이 방에 접근할 수 없습니다.",
      fr: "Le profil local actuel ne peut pas accéder à ce salon.",
      ru: "Текущий локальный профиль не может получить доступ к этой комнате.",
    }) }, { status: 403 });
  }

  if (access.isProtectedSample) {
    return NextResponse.json({ error: localize(project.language, {
      "zh-CN": "示例工作区是只读展示，不能修改消息或回应。",
      en: "Sample workspaces are read-only demos. Messages and reactions cannot be changed.",
      ja: "サンプルワークスペースは読み取り専用デモのため、メッセージやリアクションは変更できません。",
      ko: "샘플 워크스페이스는 읽기 전용 데모이므로 메시지와 리액션을 변경할 수 없습니다.",
      fr: "Les espaces d'exemple sont des demos en lecture seule. Les messages et reactions ne peuvent pas etre modifies.",
      ru: "Примеры рабочих пространств доступны только для чтения; сообщения и реакции нельзя изменять.",
    }) }, { status: 403 });
  }

  if (isProjectWorkspaceArchived(project)) {
    return NextResponse.json({
      error: localize(project.language, {
        "zh-CN": "当前工作区已归档，只能查看，不能继续修改消息或反应。",
        en: "This workspace is archived and read-only. Messages and reactions can no longer be changed.",
        ja: "このワークスペースはアーカイブ済みで読み取り専用です。メッセージやリアクションは変更できません。",
        fr: "Cet espace de travail est archive et en lecture seule. Les messages et reactions ne peuvent plus etre modifies.",
      }),
    }, { status: 409 });
  }

  const body = (await request.json()) as { eventId: string; emoji?: string; action?: "edit" | "delete" | "pin" | "unpin" | "activateRevision"; message?: string; revisionId?: string };

  if (!body.eventId) {
    return NextResponse.json({ error: localize(project.language, {
      "zh-CN": "缺少 eventId。",
      en: "eventId is required.",
      ja: "eventId が必要です。",
      ko: "eventId 가 필요합니다.",
      fr: "eventId est requis.",
      ru: "Не указан eventId.",
    }) }, { status: 400 });
  }

  if (body.action === "activateRevision") {
    if (!body.revisionId) {
      return NextResponse.json({ error: localize(project.language, {
        "zh-CN": "缺少 revisionId。",
        en: "revisionId is required.",
        ja: "revisionId が必要です。",
        ko: "revisionId 가 필요합니다.",
        fr: "revisionId est requis.",
        ru: "Не указан revisionId.",
      }) }, { status: 400 });
    }
    if (!access.canPostMessages || access.ownedParticipantIds.length === 0) {
      return NextResponse.json({ error: localize(project.language, {
        "zh-CN": "当前身份没有可切换 AI 回复版本的发言席位。",
        en: "Your current identity does not have a room seat that can switch assistant revisions.",
        ja: "現在のプロフィールには AI 応答バージョンを切り替える席がありません。",
        ko: "현재 프로필에는 AI 응답 버전을 전환할 수 있는 방 좌석이 없습니다.",
        fr: "Votre identité actuelle n'a pas de siège lui permettant de changer de version IA.",
        ru: "У текущего профиля нет места в комнате для переключения версий ответа AI.",
      }) }, { status: 403 });
    }
    const state = await activateAssistantEventRevision(project, body.eventId, body.revisionId);
    if (!state) {
      return NextResponse.json({ error: localize(project.language, {
        "zh-CN": "未找到对应 AI 回复版本。",
        en: "Assistant reply revision not found.",
        ja: "AI 応答バージョンが見つかりません。",
        ko: "AI 응답 버전을 찾을 수 없습니다.",
        fr: "Version de réponse IA introuvable.",
        ru: "Версия ответа AI не найдена.",
      }) }, { status: 404 });
    }
    return NextResponse.json({ collaboration: sanitizeCollaborationStateForClient(state) });
  }

  // Pin/Unpin message (moderators only)
  if (body.action === "pin" || body.action === "unpin") {
    if (!access.canModerate) {
      return NextResponse.json({ error: localize(project.language, {
        "zh-CN": "只有主持人或协作者可以置顶消息。",
        en: "Only moderators can pin messages.",
        ja: "メッセージを固定できるのはモデレーターのみです。",
        ko: "메시지를 고정할 수 있는 사람은 진행자뿐입니다.",
        fr: "Seuls les modérateurs peuvent épingler des messages.",
        ru: "Закреплять сообщения могут только модераторы.",
      }) }, { status: 403 });
    }
    const state = await getCollaborationState(project);
    const event = state.events.find((e) => e.id === body.eventId);
    if (!event) {
      return NextResponse.json({ error: localize(project.language, {
        "zh-CN": "未找到对应事件。",
        en: "Event not found.",
        ja: "イベントが見つかりません。",
        ko: "이벤트를 찾을 수 없습니다.",
        fr: "Événement introuvable.",
        ru: "Событие не найдено.",
      }) }, { status: 404 });
    }
    event.pinned = body.action === "pin";
    event.pinnedAt = body.action === "pin" ? new Date().toISOString() : undefined;
    event.pinnedBy = body.action === "pin" ? settings.profile.localIdentityId : undefined;
    await saveCollaborationState(state);
    return NextResponse.json({ collaboration: sanitizeCollaborationStateForClient(state) });
  }

  // Edit message
  if (body.action === "edit") {
    if (!body.message || body.message.trim().length === 0) {
      return NextResponse.json({ error: localize(project.language, {
        "zh-CN": "缺少消息内容。",
        en: "A message is required.",
        ja: "メッセージ内容が必要です。",
        ko: "메시지 내용이 필요합니다.",
        fr: "Le message est requis.",
        ru: "Требуется текст сообщения.",
      }) }, { status: 400 });
    }
    const state = await getCollaborationState(project);
    const event = state.events.find((e) => e.id === body.eventId);
    if (!event) {
      return NextResponse.json({ error: localize(project.language, {
        "zh-CN": "未找到对应事件。",
        en: "Event not found.",
        ja: "イベントが見つかりません。",
        ko: "이벤트를 찾을 수 없습니다.",
        fr: "Événement introuvable.",
        ru: "Событие не найдено.",
      }) }, { status: 404 });
    }
    // Only the message author can edit
    if (!event.participantId || !access.ownedParticipantIds.includes(event.participantId)) {
      return NextResponse.json({ error: localize(project.language, {
        "zh-CN": "你只能编辑自己发送的消息。",
        en: "You can only edit your own messages.",
        ja: "自分のメッセージのみ編集できます。",
        ko: "자신이 보낸 메시지만 수정할 수 있습니다.",
        fr: "Vous ne pouvez modifier que vos propres messages.",
        ru: "Редактировать можно только свои сообщения.",
      }) }, { status: 403 });
    }
    event.message = sanitizePlainText(body.message, 4000);
    event.editedAt = new Date().toISOString();
    await saveCollaborationState(state);
    return NextResponse.json({ collaboration: sanitizeCollaborationStateForClient(state) });
  }

  // Delete message
  if (body.action === "delete") {
    const state = await getCollaborationState(project);
    const eventIdx = state.events.findIndex((e) => e.id === body.eventId);
    if (eventIdx === -1) {
      return NextResponse.json({ error: localize(project.language, {
        "zh-CN": "未找到对应事件。",
        en: "Event not found.",
        ja: "イベントが見つかりません。",
        ko: "이벤트를 찾을 수 없습니다.",
        fr: "Événement introuvable.",
        ru: "Событие не найдено.",
      }) }, { status: 404 });
    }
    const event = state.events[eventIdx];
    // Only the message author (or room moderator) can delete
    if (!event.participantId || (!access.ownedParticipantIds.includes(event.participantId) && !access.canModerate)) {
      return NextResponse.json({ error: localize(project.language, {
        "zh-CN": "你只能删除自己的消息。",
        en: "You can only delete your own messages.",
        ja: "自分のメッセージのみ削除できます。",
        ko: "자신의 메시지만 삭제할 수 있습니다.",
        fr: "Vous ne pouvez supprimer que vos propres messages.",
        ru: "Удалять можно только свои сообщения.",
      }) }, { status: 403 });
    }
    state.events.splice(eventIdx, 1);
    await saveCollaborationState(state);
    return NextResponse.json({ collaboration: sanitizeCollaborationStateForClient(state) });
  }

  // Emoji reaction (default)
  if (!body.emoji) {
    return NextResponse.json({ error: localize(project.language, {
      "zh-CN": "缺少用于回应的表情。",
      en: "An emoji is required for reactions.",
      ja: "リアクションには絵文字が必要です。",
      ko: "리액션에는 이모지가 필요합니다.",
      fr: "Un emoji est requis pour la réaction.",
      ru: "Для реакции нужен эмодзи.",
    }) }, { status: 400 });
  }
  if (!access.canPostMessages || access.ownedParticipantIds.length === 0) {
    return NextResponse.json({ error: localize(project.language, {
      "zh-CN": access.canJoinPublicRoom ? "请先加入这个公共房间，再回应消息。" : "当前身份没有可用的回应席位。",
      en: access.canJoinPublicRoom ? "Join this public room before reacting to messages." : "Your current identity does not have a room seat that can react.",
      ja: access.canJoinPublicRoom ? "この公開ルームに参加してからメッセージにリアクションしてください。" : "現在のプロフィールにはリアクションできるルーム席がありません。",
      ko: access.canJoinPublicRoom ? "이 공개 방에 먼저 참여한 뒤 메시지에 리액션해 주세요." : "현재 프로필에는 리액션할 수 있는 방 좌석이 없습니다.",
      fr: access.canJoinPublicRoom ? "Rejoignez d'abord ce salon public avant de reagir aux messages." : "Votre identite actuelle n'a pas de siege lui permettant de reagir dans ce salon.",
      ru: access.canJoinPublicRoom ? "Сначала войдите в эту публичную комнату, затем реагируйте на сообщения." : "У текущего профиля нет места в комнате для реакций.",
    }) }, { status: access.canJoinPublicRoom ? 409 : 403 });
  }
  const state = await toggleEventReaction(project, body.eventId, body.emoji, settings.profile.localIdentityId);
  if (!state) {
    return NextResponse.json({ error: localize(project.language, {
      "zh-CN": "未找到对应事件。",
      en: "Event not found.",
      ja: "イベントが見つかりません。",
      ko: "이벤트를 찾을 수 없습니다.",
      fr: "Événement introuvable.",
      ru: "Событие не найдено.",
    }) }, { status: 404 });
  }

  return NextResponse.json({ collaboration: sanitizeCollaborationStateForClient(state) });
}
