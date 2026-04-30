import { Participant } from "@/lib/types";

function normalizeSingleParticipant(participant: Participant): Participant {
  let role: Participant["role"] = participant.role;
  let collaborationRole: Participant["collaborationRole"] = participant.collaborationRole;

  if (role === "observer" && collaborationRole !== "host") {
    collaborationRole = "observer";
  }

  if (collaborationRole === "observer") {
    role = "observer";
  } else if (collaborationRole === "host") {
    role = "moderator";
  } else if (collaborationRole === "facilitator") {
    if (role === "observer" || role === "moderator") {
      role = "custom";
    }
  } else if (collaborationRole === "participant") {
    if (role === "observer" || role === "moderator") {
      role = "speaker";
    }
  }

  return {
    ...participant,
    role,
    collaborationRole,
    customRoleLabel: participant.customRoleLabel || undefined,
  } satisfies Participant;
}

export function normalizeParticipantRoster(participants: Participant[]): Participant[] {
  if (participants.length === 0) {
    return participants;
  }

  let hostSeen = false;
  const normalized = participants.map((participant) => {
    const next = normalizeSingleParticipant(participant);
    if (next.collaborationRole === "host") {
      if (!hostSeen) {
        hostSeen = true;
        return next;
      }

      return {
        ...next,
        collaborationRole: "facilitator",
        role: next.role === "observer" || next.role === "moderator" ? "custom" : next.role,
      } satisfies Participant;
    }
    return next;
  });

  if (hostSeen) {
    return normalized;
  }

  const fallbackIndex = normalized.findIndex((participant) => participant.collaborationRole !== "observer");
  const targetIndex = fallbackIndex >= 0 ? fallbackIndex : 0;
  return normalized.map((participant, index) =>
    index === targetIndex
      ? {
          ...participant,
          collaborationRole: "host",
          role: "moderator",
        }
      : participant,
  );
}

export function updateParticipantRoster(
  participants: Participant[],
  participantId: string,
  updater: (participant: Participant) => Participant,
): Participant[] {
  return normalizeParticipantRoster(
    participants.map((participant) => (participant.id === participantId ? updater(participant) : participant)),
  );
}
