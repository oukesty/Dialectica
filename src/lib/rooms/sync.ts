import { createRoomAiConfig } from "@/lib/factories";
import { normalizeProviderModel } from "@/lib/providers/provider-catalog";
import { DiscussionProject, Participant, ProviderId } from "@/lib/types";
import { createId } from "@/lib/utils";

export function buildRoomAiConfig(
  project: Pick<DiscussionProject, "participants" | "providerSnapshot" | "room">,
  fallbackProviderId: ProviderId,
  fallbackModel: string,
  fallbackOwnerIdentityId?: string,
) {
  const hostParticipantId = project.room.session.hostParticipantId
    ?? project.participants.find((participant) => participant.collaborationRole === "host")?.id
    ?? project.participants.find((participant) => participant.role === "moderator")?.id
    ?? project.participants[0]?.id;
  const hostParticipant = project.participants.find((participant) => participant.id === hostParticipantId);
  const requestedOwnerParticipant = project.room.aiConfig?.ownerParticipantId
    ? project.participants.find((participant) => participant.id === project.room.aiConfig.ownerParticipantId)
    : undefined;
  const ownerParticipant = hostParticipant
    ?? requestedOwnerParticipant
    ?? project.participants[0];
  const providerId = project.room.aiConfig?.providerId ?? project.providerSnapshot.providerId ?? fallbackProviderId;
  const model = normalizeProviderModel(providerId, project.room.aiConfig?.model ?? project.providerSnapshot.model ?? fallbackModel);
  const updatedByParticipant = project.room.aiConfig?.updatedByParticipantId
    ? project.participants.find((participant) => participant.id === project.room.aiConfig.updatedByParticipantId)
    : undefined;
  const nextConfig = createRoomAiConfig(providerId, model, {
    ownerIdentityId: ownerParticipant?.profileOwnerId ?? project.room.aiConfig?.ownerIdentityId ?? fallbackOwnerIdentityId,
    ownerParticipantId: ownerParticipant?.id,
    updatedByParticipantId: updatedByParticipant?.id ?? ownerParticipant?.id,
  });
  nextConfig.updatedAt = project.room.aiConfig?.updatedAt ?? nextConfig.updatedAt;
  return nextConfig;
}

export function syncRoomFromParticipants(
  project: Pick<DiscussionProject, "room" | "participants" | "providerSnapshot">,
  participants: Participant[],
) {
  const observerIds = participants.filter((participant) => participant.collaborationRole === "observer").map((participant) => participant.id);
  const hostParticipantId = participants.find((participant) => participant.collaborationRole === "host")?.id
    ?? participants.find((participant) => participant.role === "moderator")?.id
    ?? participants[0]?.id;

  const presence = participants.map((participant) => {
    const existing = project.room.presence.find((item) => item.participantId === participant.id);
    return {
      participantId: participant.id,
      collaborationRole: participant.collaborationRole,
      status: participant.presence.status,
      sessionId: project.room.session.id,
      deviceLabel: participant.seatLabel || existing?.deviceLabel || participant.name,
      connectionId: existing?.connectionId || createId("presence"),
      lastSeenAt: participant.presence.lastSeenAt,
      active: participant.presence.status !== "offline",
    };
  });

  return {
    ...project.room,
    presence,
    session: {
      ...project.room.session,
      hostParticipantId,
      observerIds,
    },
    aiConfig: buildRoomAiConfig({
      participants,
      providerSnapshot: project.providerSnapshot,
      room: {
        ...project.room,
        session: {
          ...project.room.session,
          hostParticipantId,
          observerIds,
        },
      },
    }, project.providerSnapshot.providerId, project.providerSnapshot.model),
  };
}
