export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { appendCollaborationMessage, syncCollaborationState } from "@/lib/collaboration/store";
import { normalizeAvatarPreset, sanitizeAvatarDataUrl } from "@/lib/avatar";
import { getProject, getSettings, getSettingsForIdentity, syncRoomFromParticipants, upsertProject } from "@/lib/data/repository";
import { recordEmailNotificationAttempt } from "@/lib/email-notifications";
import { createParticipantPresence } from "@/lib/factories";
import { getProjectAccessState } from "@/lib/project-access";
import { discussionRoomSchema } from "@/lib/schema";
import { appendAuditLog } from "@/lib/audit";
import { appendNotification } from "@/lib/notifications";
import { AppLocale, DiscussionProject, Participant } from "@/lib/types";
import { createId, pickInitials } from "@/lib/utils";

function localize(locale: AppLocale, values: Partial<Record<AppLocale, string>> & { en: string }) {
  return values[locale] ?? values.en;
}

export async function GET(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await context.params;
  const settings = await getSettings();
  const url = new URL(request.url);
  const locale = (url.searchParams.get("locale") ?? undefined) as AppLocale | undefined;
  const project: DiscussionProject = await getProject(projectId, locale);
  const access = getProjectAccessState(project, settings);

  if (!access.canRead) {
    return NextResponse.json({
      error: localize(project.language, {
        "zh-CN": "当前身份无权查看这个房间。",
        en: "Your current local profile cannot view this room.",
        ja: "現在のローカルプロフィールではこのルームを表示できません。",
        fr: "Le profil local actuel ne peut pas consulter ce salon.",
      }),
    }, { status: 404 });
  }

  return NextResponse.json({ room: project.room, project, access });
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await context.params;
  const settings = await getSettings();
  const url = new URL(request.url);
  const locale = (url.searchParams.get("locale") ?? undefined) as AppLocale | undefined;
  const payload = discussionRoomSchema.parse(await request.json());
  const project: DiscussionProject = await getProject(projectId, locale);
  const access = getProjectAccessState(project, settings);

  if (!access.canManageRoom) {
    return NextResponse.json({
      error: localize(project.language, {
        "zh-CN": "只有当前房间主持人或协作者可以修改房间设置。",
        en: "Only the current room host or facilitator can change room settings.",
        ja: "現在のルームホストまたは進行役のみがルーム設定を変更できます。",
        fr: "Seuls l'hôte actuel ou le facilitateur peuvent modifier les réglages du salon.",
      }),
    }, { status: 403 });
  }

  const nextRoom = access.canManageAutomation
    ? payload
    : {
        ...payload,
        autoSummary: project.room.autoSummary,
        autoEvaluation: project.room.autoEvaluation,
        aiAutomation: project.room.aiAutomation,
      };

  const saved = await upsertProject({ ...project, room: nextRoom }, locale);
  return NextResponse.json({ room: saved.room, project: saved });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await context.params;
  const settings = await getSettings();
  const url = new URL(request.url);
  const locale = (url.searchParams.get("locale") ?? undefined) as AppLocale | undefined;
  const project: DiscussionProject = await getProject(projectId, locale);
  const access = getProjectAccessState(project, settings);

  if (project.metadata.isSample) {
    return NextResponse.json({
      error: localize(project.language, {
        "zh-CN": "示例房间处于只读模式，不能作为真实成员加入。",
        en: "Sample rooms are read-only and cannot be joined as a live member.",
        ja: "サンプルルームは読み取り専用のため、実メンバーとして参加できません。",
        fr: "Les salons d'exemple sont en lecture seule et ne peuvent pas être rejoints comme membre actif.",
      }),
    }, { status: 409 });
  }

  if (!access.canJoinPublicRoom && !access.isMember) {
    return NextResponse.json({
      error: localize(project.language, {
        "zh-CN": project.room.visibility === "public" ? "当前身份不能加入这个公共房间。" : "这个房间不是公共房间，请使用邀请加入。",
        en: project.room.visibility === "public" ? "Your current profile cannot join this public room." : "This room is not public. Use an invite to join.",
        ja: project.room.visibility === "public" ? "現在のプロフィールではこの公開ルームに参加できません。" : "このルームは公開されていません。招待で参加してください。",
        fr: project.room.visibility === "public" ? "Votre profil actuel ne peut pas rejoindre ce salon public." : "Ce salon n'est pas public. Utilisez une invitation pour le rejoindre.",
      }),
    }, { status: 409 });
  }

  if (access.isMember) {
    const timestamp = new Date().toISOString();
    const participants = project.participants.map((participant) =>
      participant.profileOwnerId === settings.profile.localIdentityId
        ? {
            ...participant,
            presence: {
              ...participant.presence,
              status: "online" as const,
              isTyping: false,
              lastSeenAt: timestamp,
              sessionId: project.room.session.id,
            },
          }
        : participant,
    );
    const saved = await upsertProject({
      ...project,
      updatedAt: timestamp,
      participants,
      room: syncRoomFromParticipants(project, participants),
    }, locale);
    await syncCollaborationState(saved);
    return NextResponse.json({ room: saved.room, project: saved }, { status: 200 });
  }

  const participant: Participant = {
    id: createId("participant"),
    name: settings.profile.displayName,
    profileOwnerId: settings.profile.localIdentityId,
    role: "speaker",
    collaborationRole: settings.collaborationPreferences?.defaultMemberRole ?? "participant",
    stance: localize(project.language, {
      "zh-CN": "通过公共入口加入当前讨论项目",
      en: "Joined this discussion through the public room",
      ja: "公開ルーム経由でこの議論に参加",
      fr: "A rejoint cette discussion via le salon public",
    }),
    color: "#1d4ed8",
    bio: localize(project.language, {
      "zh-CN": "当前本地身份通过公共房间加入。",
      en: "Joined the workspace through the public room entry.",
      ja: "公開ルームの入口からワークスペースに参加しました。",
      fr: "A rejoint l'espace de travail depuis l'entrée publique du salon.",
    }),
    avatarLabel: pickInitials(settings.profile.displayName),
    avatarPreset: normalizeAvatarPreset(settings.profile.avatarPreset, settings.profile.displayName),
    avatarImageDataUrl: sanitizeAvatarDataUrl(settings.profile.avatarImageDataUrl),
    seatLabel: `Seat-${project.participants.length + 1}`,
    presence: createParticipantPresence(project.room.session.id, "online"),
  };

  const participants = [...project.participants, participant];
  const saved = await upsertProject({
    ...project,
    participants,
    room: syncRoomFromParticipants(project, participants),
  }, locale);
  void appendAuditLog({ action: "room.join", actorId: settings.profile.localIdentityId, actorName: settings.profile.displayName, projectId, details: `Joined room as ${participant.name}` });
  const hostParticipant = saved.participants.find((candidate) => candidate.id === saved.room.session.hostParticipantId)
    ?? saved.participants.find((candidate) => candidate.collaborationRole === "host");
  const hostId = hostParticipant?.profileOwnerId;
  if (hostId && hostId !== settings.profile.localIdentityId) {
    const hostSettings = await getSettingsForIdentity(hostId, { includeSecrets: false });
    const hostLocale = hostSettings?.locale ?? saved.language;
    void appendNotification(hostId, {
      type: "member_join",
      title: localize(hostLocale, {
        "zh-CN": "新成员加入",
        en: "New member",
        ja: "新しいメンバー",
        ko: "새 구성원",
        fr: "Nouveau membre",
        ru: "Новый участник",
      }),
      body: localize(hostLocale, {
        "zh-CN": `${participant.name} 加入了房间。`,
        en: `${participant.name} joined the room.`,
        ja: `${participant.name} がルームに参加しました。`,
        ko: `${participant.name}님이 방에 참여했습니다.`,
        fr: `${participant.name} a rejoint le salon.`,
        ru: `${participant.name} присоединился к комнате.`,
      }),
      projectId,
      href: `/${hostLocale}/projects/${projectId}`,
    });
    if (hostSettings?.emailNotifications.enabled && hostSettings.emailNotifications.onNewMember) {
      void recordEmailNotificationAttempt(hostId, hostSettings, {
        title: localize(hostLocale, {
          "zh-CN": "邮件通知未发送：新成员",
          en: "Email notification not sent: new member",
          ja: "メール通知は未送信：新しいメンバー",
          ko: "이메일 알림 미전송: 새 구성원",
          fr: "Notification e-mail non envoyee : nouveau membre",
          ru: "Email-уведомление не отправлено: новый участник",
        }),
        body: localize(hostLocale, {
          "zh-CN": `${participant.name} 加入了房间。当前未配置外部邮件 Provider，因此不会向 ${hostSettings.emailNotifications.emailAddress || "收件人"} 发送真实邮件。`,
          en: `${participant.name} joined the room. No external email provider is configured, so no real email was sent to ${hostSettings.emailNotifications.emailAddress || "the recipient"}.`,
          ja: `${participant.name} がルームに参加しました。外部メール Provider が未設定のため、${hostSettings.emailNotifications.emailAddress || "受信者"} へ実際のメールは送信されません。`,
          ko: `${participant.name}님이 방에 참여했습니다. 외부 이메일 Provider가 설정되어 있지 않아 ${hostSettings.emailNotifications.emailAddress || "수신자"}에게 실제 이메일은 전송되지 않았습니다.`,
          fr: `${participant.name} a rejoint le salon. Aucun Provider e-mail externe n'est configure ; aucun e-mail reel n'a ete envoye a ${hostSettings.emailNotifications.emailAddress || "le destinataire"}.`,
          ru: `${participant.name} присоединился к комнате. Внешний email-провайдер не настроен, поэтому настоящее письмо на ${hostSettings.emailNotifications.emailAddress || "адрес получателя"} не отправлялось.`,
        }),
        projectId,
        href: `/${hostLocale}/projects/${projectId}`,
      });
    }
  }
  await syncCollaborationState(saved);
  const collaboration = await appendCollaborationMessage(saved, {
    type: "join",
    actorType: "system",
    participantId: participant.id,
    message: localize(project.language, {
      "zh-CN": `${participant.name} 通过公共入口加入了当前房间，已获得该公共项目的实时消息流。`,
      en: `${participant.name} joined through the public entry and now has access to this public room's live feed.`,
      ja: `${participant.name} が公開入口から参加し、この公開ルームのリアルタイムフィードを利用できるようになりました。`,
      fr: `${participant.name} a rejoint via l'entrée publique et peut désormais accéder au flux en direct de ce salon public.`,
    }),
  });

  return NextResponse.json({ room: saved.room, project: saved, participant, collaboration }, { status: 201 });
}
