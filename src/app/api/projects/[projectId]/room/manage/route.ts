export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getProject, getSettings, upsertProject } from "@/lib/data/repository";
import { getProjectAccessState, canRemoveParticipant } from "@/lib/project-access";
import { appendAuditLog } from "@/lib/audit";
import { appendNotification } from "@/lib/notifications";
import { AppLocale, CollaborationRole } from "@/lib/types";

type ManageAction =
  | { action: "kick"; participantId: string }
  | { action: "setRole"; participantId: string; role: CollaborationRole }
  | { action: "transferOwnership"; participantId: string }
  | { action: "destroyRoom" }
  | { action: "setJoinMode"; joinMode: "open" | "approval" }
  | { action: "setNickname"; participantId: string; nickname: string };

function localize(locale: AppLocale, values: Partial<Record<AppLocale, string>> & { en: string }) {
  return values[locale] ?? values.en;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const body = (await request.json()) as ManageAction;
  const settings = await getSettings();
  const url = new URL(request.url);
  const locale = (url.searchParams.get("locale") ?? undefined) as typeof settings.locale | undefined;
  const project = await getProject(projectId, locale);

  if (!project) {
    return NextResponse.json({
      error: localize(locale ?? "en", {
        "zh-CN": "项目不存在。",
        en: "Project not found.",
        ja: "プロジェクトが見つかりません。",
        ko: "프로젝트를 찾을 수 없습니다.",
        fr: "Projet introuvable.",
        ru: "Проект не найден.",
      }),
    }, { status: 404 });
  }

  const access = getProjectAccessState(project, settings);

  switch (body.action) {
    case "kick": {
      if (!body.participantId) {
        return NextResponse.json({ error: localize(project.language, {
          "zh-CN": "缺少 participantId。",
          en: "participantId is required.",
          ja: "participantId が必要です。",
          ko: "participantId 가 필요합니다.",
          fr: "participantId est requis.",
          ru: "Не указан participantId.",
        }) }, { status: 400 });
      }
      const target = project.participants.find((p) => p.id === body.participantId);
      if (!target) {
        return NextResponse.json({ error: localize(project.language, {
          "zh-CN": "未找到该参与者。",
          en: "Participant not found.",
          ja: "参加者が見つかりません。",
          ko: "참여자를 찾을 수 없습니다.",
          fr: "Participant introuvable.",
          ru: "Участник не найден.",
        }) }, { status: 404 });
      }
      if (!canRemoveParticipant(project, access, target)) {
        return NextResponse.json({ error: localize(project.language, {
          "zh-CN": "当前权限不足。",
          en: "Insufficient permissions.",
          ja: "権限が不足しています。",
          ko: "권한이 부족합니다.",
          fr: "Permissions insuffisantes.",
          ru: "Недостаточно прав.",
        }) }, { status: 403 });
      }
      void appendAuditLog({ action: "room.kick", actorId: settings.profile.localIdentityId, actorName: settings.profile.displayName, projectId, details: `Kicked participant ${target.name}` });
      if (target.profileOwnerId) void appendNotification(target.profileOwnerId, { type: "member_kick", title: "Removed from room", body: `You were removed from the room by ${settings.profile.displayName}`, projectId });
      const updatedProject = await upsertProject({
        ...project,
        participants: project.participants.filter((p) => p.id !== body.participantId),
        room: {
          ...project.room,
          presence: project.room.presence.filter((p) => p.participantId !== body.participantId),
        },
      });
      return NextResponse.json({ project: updatedProject });
    }

    case "setRole": {
      if (!access.canAssignRoles) {
        return NextResponse.json({ error: localize(project.language, {
          "zh-CN": "只有房间所有者可以分配角色。",
          en: "Only the room owner can assign roles.",
          ja: "ロールを割り当てられるのはルーム所有者だけです。",
          ko: "역할을 지정할 수 있는 사람은 방 소유자뿐입니다.",
          fr: "Seul le propriétaire du salon peut attribuer des rôles.",
          ru: "Назначать роли может только владелец комнаты.",
        }) }, { status: 403 });
      }
      if (!body.participantId || !body.role) {
        return NextResponse.json({ error: localize(project.language, {
          "zh-CN": "缺少 participantId 或 role。",
          en: "participantId and role are required.",
          ja: "participantId と role が必要です。",
          ko: "participantId와 role이 필요합니다.",
          fr: "participantId et role sont requis.",
          ru: "Не указаны participantId и role.",
        }) }, { status: 400 });
      }
      const validRoles: CollaborationRole[] = ["host", "facilitator", "participant", "observer"];
      if (!validRoles.includes(body.role)) {
        return NextResponse.json({ error: localize(project.language, {
          "zh-CN": "成员角色无效。",
          en: "Invalid member role.",
          ja: "メンバーロールが無効です。",
          ko: "구성원 역할이 올바르지 않습니다.",
          fr: "Role de membre invalide.",
          ru: "Недопустимая роль участника.",
        }) }, { status: 400 });
      }
      // Prevent setting another host (use transferOwnership instead)
      if (body.role === "host") {
        return NextResponse.json({ error: localize(project.language, {
          "zh-CN": "请使用所有权转移流程变更房主。",
          en: "Use the ownership transfer flow to change the room owner.",
          ja: "ルーム所有者の変更には所有権移譲フローを使用してください。",
          ko: "방 소유자를 변경하려면 소유권 이전 절차를 사용하세요.",
          fr: "Utilisez le transfert de propriete pour changer le propriétaire du salon.",
          ru: "Используйте передачу прав собственности, чтобы изменить владельца комнаты.",
        }) }, { status: 400 });
      }
      const target = project.participants.find((p) => p.id === body.participantId);
      if (!target) {
        return NextResponse.json({ error: localize(project.language, {
          "zh-CN": "未找到该参与者。",
          en: "Participant not found.",
          ja: "参加者が見つかりません。",
          ko: "참여자를 찾을 수 없습니다.",
          fr: "Participant introuvable.",
          ru: "Участник не найден.",
        }) }, { status: 404 });
      }
      if (target.collaborationRole === "host") {
        return NextResponse.json({ error: localize(project.language, {
          "zh-CN": "房主身份只能通过所有权转移流程变更。",
          en: "Room ownership can only be changed through the ownership transfer flow.",
          ja: "ルーム所有者は所有権移譲フローでのみ変更できます。",
          ko: "방 소유권은 소유권 이전 절차로만 변경할 수 있습니다.",
          fr: "La propriété du salon ne peut être modifiée que via le transfert de propriété.",
          ru: "Владельца комнаты можно изменить только через передачу прав собственности.",
        }) }, { status: 400 });
      }
      void appendAuditLog({ action: "room.setRole", actorId: settings.profile.localIdentityId, actorName: settings.profile.displayName, projectId, details: `Changed role of ${body.participantId} to ${body.role}` });
      const updatedProject = await upsertProject({
        ...project,
        participants: project.participants.map((p) =>
          p.id === body.participantId ? { ...p, collaborationRole: body.role } : p,
        ),
        room: {
          ...project.room,
          presence: project.room.presence.map((p) =>
            p.participantId === body.participantId ? { ...p, collaborationRole: body.role } : p,
          ),
        },
      });
      return NextResponse.json({ project: updatedProject });
    }

    case "transferOwnership": {
      if (!access.canTransferOwnership) {
        return NextResponse.json({ error: localize(project.language, {
          "zh-CN": "只有房间所有者可以转移所有权。",
          en: "Only the room owner can transfer ownership.",
          ja: "所有権を移譲できるのはルーム所有者だけです。",
          ko: "방 소유자만 소유권을 이전할 수 있습니다.",
          fr: "Seul le propriétaire du salon peut transférer la propriété.",
          ru: "Передавать право собственности может только владелец комнаты.",
        }) }, { status: 403 });
      }
      if (!body.participantId) {
        return NextResponse.json({ error: localize(project.language, {
          "zh-CN": "缺少 participantId。",
          en: "participantId is required.",
          ja: "participantId が必要です。",
          ko: "participantId가 필요합니다.",
          fr: "participantId est requis.",
          ru: "Не указан participantId.",
        }) }, { status: 400 });
      }
      const newOwner = project.participants.find((p) => p.id === body.participantId);
      if (!newOwner) {
        return NextResponse.json({ error: localize(project.language, {
          "zh-CN": "未找到该参与者。",
          en: "Participant not found.",
          ja: "参加者が見つかりません。",
          ko: "참여자를 찾을 수 없습니다.",
          fr: "Participant introuvable.",
          ru: "Участник не найден.",
        }) }, { status: 404 });
      }
      const currentOwnerId = access.ownedParticipants.find((p) => p.collaborationRole === "host")?.id;
      const updatedProject = await upsertProject({
        ...project,
        participants: project.participants.map((p) => {
          if (p.id === body.participantId) return { ...p, collaborationRole: "host" as const };
          if (p.id === currentOwnerId) return { ...p, collaborationRole: "facilitator" as const };
          return p;
        }),
        room: {
          ...project.room,
          presence: project.room.presence.map((p) => {
            if (p.participantId === body.participantId) return { ...p, collaborationRole: "host" as const };
            if (p.participantId === currentOwnerId) return { ...p, collaborationRole: "facilitator" as const };
            return p;
          }),
        },
      });
      return NextResponse.json({ project: updatedProject });
    }

    case "destroyRoom": {
      if (!access.canDestroyRoom) {
        return NextResponse.json({ error: localize(project.language, {
          "zh-CN": "只有房间所有者可以归档这个房间。",
          en: "Only the room owner can archive this room.",
          ja: "このルームをアーカイブできるのはルーム所有者だけです。",
          ko: "방 소유자만 이 방을 보관할 수 있습니다.",
          fr: "Seul le propriétaire du salon peut archiver ce salon.",
          ru: "Архивировать эту комнату может только владелец.",
        }) }, { status: 403 });
      }
      void appendAuditLog({ action: "room.archive", actorId: settings.profile.localIdentityId, actorName: settings.profile.displayName, projectId, details: "Archived room" });
      if (settings.emailNotifications?.enabled && settings.emailNotifications?.onRoomArchived) {
        void appendNotification(settings.profile.localIdentityId, {
          type: "email_trigger",
          title: localize(project.language, {
            "zh-CN": "本地模拟邮件通知：房间归档",
            en: "Local simulated email notification: room archived",
            ja: "ローカル模擬メール通知：ルームをアーカイブ",
            ko: "로컬 모의 이메일 알림: 방 보관",
            fr: "Notification e-mail simulee locale : salon archive",
            ru: "Локальное имитированное email-уведомление: комната архивирована",
          }),
          body: localize(project.language, {
            "zh-CN": `已记录一条本地模拟通知，不会真实发送邮件到 ${settings.emailNotifications.emailAddress}。房间「${project.title}」已归档。`,
            en: `A local simulated notification was recorded; no real email was sent to ${settings.emailNotifications.emailAddress}. Room "${project.title}" was archived.`,
            ja: `${settings.emailNotifications.emailAddress} へ実際のメールは送信されません。ローカルの模擬通知として記録しました。ルーム「${project.title}」をアーカイブしました。`,
            ko: `${settings.emailNotifications.emailAddress}로 실제 이메일을 보내지 않고 로컬 모의 알림만 기록했습니다. "${project.title}" 방이 보관되었습니다.`,
            fr: `Une notification simulee locale a ete enregistree ; aucun e-mail reel n'a ete envoye a ${settings.emailNotifications.emailAddress}. Le salon « ${project.title} » a ete archive.`,
            ru: `Записано локальное имитированное уведомление; реальное письмо на ${settings.emailNotifications.emailAddress} не отправлялось. Комната "${project.title}" архивирована.`,
          }),
          projectId,
        });
      }
      const updatedProject = await upsertProject({
        ...project,
        room: {
          ...project.room,
          archivedAt: new Date().toISOString(),
          archivedBy: access.ownedParticipantIds[0] ?? "",
          session: { ...project.room.session, status: "closed" },
        },
      });
      return NextResponse.json({ project: updatedProject });
    }

    case "setJoinMode": {
      if (!access.canManageRoom) {
        return NextResponse.json({ error: localize(project.language, {
          "zh-CN": "当前权限不足，不能修改加入方式。",
          en: "You do not have permission to change the join mode.",
          ja: "参加方法を変更する権限がありません。",
          ko: "참여 방식을 변경할 권한이 없습니다.",
          fr: "Vous n'avez pas l'autorisation de modifier le mode d'acces.",
          ru: "У вас нет прав изменять режим входа.",
        }) }, { status: 403 });
      }
      if (body.joinMode !== "open" && body.joinMode !== "approval") {
        return NextResponse.json({ error: localize(project.language, {
          "zh-CN": "加入方式无效。",
          en: "Invalid join mode.",
          ja: "参加方法が無効です。",
          ko: "참여 방식이 올바르지 않습니다.",
          fr: "Mode d'acces invalide.",
          ru: "Недопустимый режим входа.",
        }) }, { status: 400 });
      }
      const updatedProject = await upsertProject({
        ...project,
        room: { ...project.room, joinMode: body.joinMode },
      });
      return NextResponse.json({ project: updatedProject });
    }

    case "setNickname": {
      return NextResponse.json({ error: localize(project.language, {
        "zh-CN": "成员备注保存在你的本地设置中，请使用设置保存接口更新，不能通过房间管理接口伪保存。",
        en: "Member nicknames are stored in your local settings. Use the settings save API instead of the room management endpoint.",
        ja: "メンバーのニックネームはローカル設定に保存されます。ルーム管理 API ではなく設定保存 API を使用してください。",
        ko: "멤버 별칭은 로컬 설정에 저장됩니다. 룸 관리 엔드포인트가 아니라 설정 저장 API를 사용하세요.",
        fr: "Les surnoms des membres sont stockes dans vos parametres locaux. Utilisez l'API de sauvegarde des parametres, pas le point d'entree de gestion du salon.",
        ru: "Псевдонимы участников хранятся в локальных настройках. Используйте API сохранения настроек, а не endpoint управления комнатой.",
      }) }, { status: 400 });
    }

    default:
      return NextResponse.json({ error: localize(project.language, {
        "zh-CN": "未知的管理操作。",
        en: "Unknown action.",
        ja: "不明な操作です。",
        ko: "알 수 없는 작업입니다.",
        fr: "Action inconnue.",
        ru: "Неизвестное действие.",
      }) }, { status: 400 });
  }
}
