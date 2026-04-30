export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { z } from "zod";
import { acceptInvite, getCollaborationState, sanitizeCollaborationStateForClient, syncCollaborationState } from "@/lib/collaboration/store";
import { createParticipantPresence } from "@/lib/factories";
import { deriveAvatarPreset, normalizeAvatarPreset, sanitizeAvatarDataUrl } from "@/lib/avatar";
import { getProject, getSettings, syncRoomFromParticipants, upsertProject } from "@/lib/data/repository";
import { AppLocale, DiscussionProject, Participant } from "@/lib/types";
import { createId, pickInitials, sanitizeOptionalText, sanitizePlainText } from "@/lib/utils";

const acceptSchema = z.object({
  token: z.string().min(1).max(64),
  name: z.string().min(1).max(80),
  stance: z.string().max(240).optional(),
  bio: z.string().max(480).optional(),
  profileOwnerId: z.string().max(120).optional(),
  avatarPreset: z.string().max(40).optional(),
  avatarImageDataUrl: z.string().max(1024 * 1024).optional(),
});

function localize(locale: AppLocale, values: Partial<Record<AppLocale, string>> & { en: string }) {
  return values[locale] ?? values.en;
}

function mapInviteRoleToParticipant(role: Participant["collaborationRole"]): Pick<Participant, "role" | "collaborationRole" | "customRoleLabel"> {
  if (role === "observer") return { role: "observer", collaborationRole: role };
  if (role === "host") return { role: "moderator", collaborationRole: role };
  if (role === "facilitator") return { role: "custom", collaborationRole: role, customRoleLabel: "Facilitator" };
  return { role: "speaker", collaborationRole: role };
}

export async function POST(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await context.params;
  const settings = await getSettings();
  const url = new URL(request.url);
  const payload = acceptSchema.parse(await request.json());
  const locale = ((url.searchParams.get("locale") ?? undefined) as AppLocale | undefined) ?? settings.locale;
  const project: DiscussionProject = await getProject(projectId, locale);
  const collaboration = await getCollaborationState(project);
  const token = sanitizePlainText(payload.token, 64);
  const invite = collaboration.invites.find((candidate) => candidate.token === token);

  if (!invite) {
    return NextResponse.json({
      error: localize(locale, {
        "zh-CN": "邀请令牌不存在。",
        en: "Invite token was not found.",
        ja: "招待トークンが見つかりません。",
        fr: "Le jeton d'invitation est introuvable.",
      }),
    }, { status: 404 });
  }

  if (invite.expiresAt && new Date(invite.expiresAt).getTime() < Date.now()) {
    return NextResponse.json({
      error: localize(locale, {
        "zh-CN": "该邀请已过期，请重新生成邀请链接。",
        en: "This invite has expired. Generate a new invite link.",
        ja: "この招待は期限切れです。新しい招待リンクを作成してください。",
        fr: "Cette invitation a expire. Generez un nouveau lien d'invitation.",
      }),
    }, { status: 410 });
  }

  if (invite.status !== "active") {
    return NextResponse.json({
      error: localize(locale, {
        "zh-CN": "该邀请已经被使用或失效。",
        en: "This invite has already been used or is no longer active.",
        ja: "この招待は既に使用されているか、無効になっています。",
        fr: "Cette invitation a deja ete utilisee ou n'est plus active.",
      }),
    }, { status: 409 });
  }

  if (invite.role === "host") {
    return NextResponse.json({
      error: localize(locale, {
        "zh-CN": "该邀请包含已停用的房主授予权限，请让房主使用所有权转移流程。",
        en: "This invite contains a retired ownership grant. Ask the room owner to use the ownership transfer flow.",
        ja: "この招待には廃止された所有者権限の付与が含まれています。ルーム所有者に所有権移譲フローの利用を依頼してください。",
        fr: "Cette invitation contient une ancienne attribution de propriété. Demandez au propriétaire d'utiliser le transfert de propriété.",
      }),
    }, { status: 409 });
  }

  const cleanName = sanitizePlainText(payload.name, 80);
  const cleanStance = sanitizeOptionalText(payload.stance, 240);
  const cleanBio = sanitizeOptionalText(payload.bio, 480);
  const cleanProfileOwnerId = sanitizeOptionalText(payload.profileOwnerId, 120) || settings.profile.localIdentityId || `guest_${createId("profile")}`;
  const cleanAvatarPreset = normalizeAvatarPreset(payload.avatarPreset, cleanName);
  const cleanAvatarImageDataUrl = sanitizeAvatarDataUrl(payload.avatarImageDataUrl);
  const mapped = mapInviteRoleToParticipant(invite.role);
  const existing = project.participants.find((participant) => participant.profileOwnerId === cleanProfileOwnerId)
    ?? project.participants.find((participant) => !participant.profileOwnerId && participant.name.toLowerCase() === cleanName.toLowerCase());

  const participant = existing ?? {
    id: createId("participant"),
    name: cleanName,
    role: mapped.role,
    collaborationRole: mapped.collaborationRole,
    customRoleLabel: mapped.customRoleLabel,
    stance: cleanStance || localize(locale, {
      "zh-CN": "通过邀请加入讨论",
      en: "Joined through an invite",
      ja: "招待経由で参加",
      fr: "Rejoint via invitation",
    }),
    color: "#0f766e",
    bio: cleanBio,
    avatarLabel: pickInitials(cleanName),
    avatarPreset: cleanAvatarPreset || deriveAvatarPreset(cleanName),
    avatarImageDataUrl: cleanAvatarImageDataUrl,
    profileOwnerId: cleanProfileOwnerId,
    seatLabel: invite.role === "observer" ? "OBS" : `Seat-${project.participants.length + 1}`,
    presence: createParticipantPresence(project.room.session.id, "online"),
  } satisfies Participant;

  const nextParticipants: Participant[] = existing
    ? project.participants.map((candidate) => candidate.id === existing.id
      ? {
          ...candidate,
          name: cleanName,
          role: mapped.role,
          collaborationRole: mapped.collaborationRole,
          customRoleLabel: mapped.customRoleLabel,
          bio: cleanBio || candidate.bio,
          stance: cleanStance || candidate.stance,
          avatarLabel: pickInitials(cleanName),
          avatarPreset: cleanAvatarPreset || candidate.avatarPreset,
          avatarImageDataUrl: cleanAvatarImageDataUrl || candidate.avatarImageDataUrl,
          profileOwnerId: cleanProfileOwnerId,
          presence: { ...candidate.presence, status: "online" as const, lastSeenAt: new Date().toISOString(), sessionId: project.room.session.id },
        }
      : candidate)
    : [...project.participants, participant];

  const updatedProject = await upsertProject({
    ...project,
    participants: nextParticipants,
    room: syncRoomFromParticipants(project, nextParticipants),
  }, locale);

  await syncCollaborationState(updatedProject);
  const finalParticipant = updatedProject.participants.find((candidate) => candidate.profileOwnerId === cleanProfileOwnerId)
    ?? updatedProject.participants.find((candidate) => candidate.id === participant.id)
    ?? participant;
  const nextCollaboration = await acceptInvite(updatedProject, {
    token,
    participantId: finalParticipant.id,
    participantName: finalParticipant.name,
  });

  return NextResponse.json({
    participant: finalParticipant,
    collaboration: sanitizeCollaborationStateForClient(nextCollaboration),
    project: updatedProject,
  }, { status: 201 });
}
