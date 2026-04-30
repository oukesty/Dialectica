export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { z } from "zod";
import { getProject, getSettings } from "@/lib/data/repository";
import { createInvite, getCollaborationState } from "@/lib/collaboration/store";
import { getProjectAccessState } from "@/lib/project-access";
import { AppLocale, COLLABORATION_ROLES } from "@/lib/types";
import { sanitizeOptionalText } from "@/lib/utils";

const inviteSchema = z.object({
  role: z.enum(COLLABORATION_ROLES),
  createdByParticipantId: z.string().optional(),
  expiresInHours: z.number().int().min(1).max(168).optional(),
  note: z.string().max(240).optional(),
});

function localize(locale: AppLocale | undefined, values: Partial<Record<AppLocale, string>> & { en: string }) {
  return values[locale ?? "en"] ?? values.en;
}

export async function GET(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await context.params;
  const url = new URL(request.url);
  const locale = (url.searchParams.get("locale") ?? undefined) as AppLocale | undefined;
  const settings = await getSettings();
  const project = await getProject(projectId, locale);
  const access = getProjectAccessState(project, settings);

  if (!access.canCreateInvites) {
    return NextResponse.json({
      error: localize(locale ?? project.language, {
        "zh-CN": "只有当前房间主持人或协作者可以查看邀请令牌。",
        en: "Only the current room host or facilitator can view invite tokens.",
        ja: "招待トークンを確認できるのは現在のルームホストまたは進行役だけです。",
        fr: "Seuls l'hôte actuel ou le facilitateur peuvent consulter les jetons d'invitation.",
      }),
    }, { status: 403 });
  }

  const collaboration = await getCollaborationState(project);
  return NextResponse.json({ invites: collaboration.invites, sync: collaboration.sync });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await context.params;
  const payload = inviteSchema.parse(await request.json());
  const url = new URL(request.url);
  const settings = await getSettings();
  const locale = ((url.searchParams.get("locale") ?? undefined) as AppLocale | undefined) ?? settings.locale;
  const project = await getProject(projectId, locale);
  const access = getProjectAccessState(project, settings);

  if (!access.canCreateInvites) {
    return NextResponse.json({
      error: localize(locale, {
        "zh-CN": "只有当前房间主持人或协作者可以创建邀请链接。",
        en: "Only the current room host or facilitator can create invite links.",
        ja: "招待リンクを作成できるのは現在のルームホストまたは進行役だけです。",
        fr: "Seuls l'hôte actuel ou le facilitateur peuvent créer des liens d'invitation.",
      }),
    }, { status: 403 });
  }

  if (!settings.collaborationPreferences.allowInvites) {
    return NextResponse.json(
      {
        error: localize(locale, {
          "zh-CN": "当前设置已关闭邀请链接创建。",
          en: "Invite link creation is disabled in Settings.",
          ja: "設定で招待リンクの作成が無効になっています。",
          fr: "La creation de liens d'invitation est desactivee dans les parametres.",
        }),
      },
      { status: 409 },
    );
  }

  if (project.room.visibility === "private") {
    return NextResponse.json(
      {
        error: localize(locale, {
          "zh-CN": "私人房间不允许直接创建邀请链接，请先把房间切换为邀请制或公共可见。",
          en: "Private rooms cannot create invite links directly. Switch the room to invite-only or public visibility first.",
          ja: "非公開ルームでは招待リンクを直接作成できません。先に招待制または公開へ切り替えてください。",
          fr: "Les salons prives ne peuvent pas creer de lien d'invitation direct. Passez d'abord le salon en mode invitation ou public.",
        }),
      },
      { status: 409 },
    );
  }

  if (payload.role === "host") {
    return NextResponse.json(
      {
        error: localize(locale, {
          "zh-CN": "邀请不能授予房主身份，请使用所有权转移流程。",
          en: "Invites cannot grant room ownership. Use the ownership transfer flow instead.",
          ja: "招待でルーム所有者権限は付与できません。所有権の移譲フローを使用してください。",
          fr: "Les invitations ne peuvent pas accorder la propriété du salon. Utilisez le transfert de propriété.",
        }),
      },
      { status: 400 },
    );
  }

  if (payload.role === "facilitator" && !access.canAssignRoles) {
    return NextResponse.json(
      {
        error: localize(locale, {
          "zh-CN": "只有房主可以通过邀请授予协作者权限。",
          en: "Only the room owner can grant facilitator permissions through an invite.",
          ja: "招待で進行役権限を付与できるのはルーム所有者だけです。",
          fr: "Seul le propriétaire du salon peut accorder le rôle de facilitateur via une invitation.",
        }),
      },
      { status: 403 },
    );
  }

  if (payload.createdByParticipantId && !access.ownedParticipantIds.includes(payload.createdByParticipantId)) {
    return NextResponse.json(
      {
        error: localize(locale, {
          "zh-CN": "邀请创建者必须是当前本地身份绑定的成员。",
          en: "Invite creators must be participants bound to your current local profile.",
          ja: "招待の作成者は現在のローカルプロフィールに紐づく参加者である必要があります。",
          fr: "Le créateur de l'invitation doit être un participant lié à votre profil local actuel.",
        }),
      },
      { status: 403 },
    );
  }

  const result = await createInvite(project, {
    ...payload,
    createdByParticipantId: payload.createdByParticipantId ?? access.ownedParticipantIds[0],
    note: sanitizeOptionalText(payload.note, 240),
  });
  return NextResponse.json(result, { status: 201 });
}
