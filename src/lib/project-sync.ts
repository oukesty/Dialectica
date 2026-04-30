import { CollaborationState } from "@/lib/collaboration/types";
import { DiscussionProject } from "@/lib/types";

function hashText(value: string | undefined) {
  if (!value) return "0";
  let hash = 17;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index) + index) % 2147483647;
  }
  return String(hash);
}

export function buildProjectSyncSignature(project: DiscussionProject | null | undefined) {
  if (!project) return "";
  const signaturePayload = {
    id: project.id,
    updatedAt: project.updatedAt,
    title: project.title,
    description: project.description,
    summary: {
      overview: project.summary.overview,
      currentConclusion: project.summary.currentConclusion,
      followupQuestions: project.summary.followupQuestions,
      nextSteps: project.summary.nextSteps,
      suggestions: project.summary.suggestions,
      disputes: project.summary.disputes,
      unresolvedQuestions: project.summary.unresolvedQuestions,
    },
    room: {
      visibility: project.room.visibility,
      joinMode: project.room.joinMode ?? "open",
      archivedAt: project.room.archivedAt ?? "",
      session: {
        status: project.room.session.status,
        hostParticipantId: project.room.session.hostParticipantId ?? "",
        observerIds: project.room.session.observerIds,
      },
      aiConfig: {
        providerId: project.room.aiConfig.providerId,
        model: project.room.aiConfig.model,
        ownerIdentityId: project.room.aiConfig.ownerIdentityId ?? "",
        ownerParticipantId: project.room.aiConfig.ownerParticipantId ?? "",
        updatedAt: project.room.aiConfig.updatedAt,
        updatedByParticipantId: project.room.aiConfig.updatedByParticipantId ?? "",
      },
      aiAutomation: project.room.aiAutomation ?? null,
      presence: project.room.presence.map((presence) => ({
        participantId: presence.participantId,
        collaborationRole: presence.collaborationRole,
        status: presence.status,
        active: presence.active,
        lastSeenAt: presence.lastSeenAt,
      })),
    },
    participants: project.participants.map((participant) => ({
      id: participant.id,
      name: participant.name,
      role: participant.role,
      collaborationRole: participant.collaborationRole,
      profileOwnerId: participant.profileOwnerId ?? "",
      seatLabel: participant.seatLabel ?? "",
      stance: participant.stance,
      color: participant.color,
      customRoleLabel: participant.customRoleLabel ?? "",
      presenceStatus: participant.presence.status,
      lastSeenAt: participant.presence.lastSeenAt,
    })),
    counts: {
      entries: project.entries.length,
      nodes: project.nodes.length,
      relations: project.relations.length,
    },
  };

  return `${project.id}|${hashText(JSON.stringify(signaturePayload))}`;
}

export function buildCollaborationSyncSignature(state: CollaborationState | null | undefined) {
  if (!state) return "";
  return [
    state.projectId,
    state.version,
    state.sync.lastEventId ?? "",
    state.sync.cursor,
    state.events.length,
    state.attachments.length,
    state.presence.length,
    state.invites.length,
  ].join("|");
}
