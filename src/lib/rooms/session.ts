import { DiscussionProject } from "@/lib/types";

export function findRoomHost(project: DiscussionProject) {
  return project.participants.find((participant) => participant.id === project.room.session.hostParticipantId)
    ?? project.participants.find((participant) => participant.collaborationRole === "host");
}

export function getRoomObservers(project: DiscussionProject) {
  return project.participants.filter((participant) => participant.collaborationRole === "observer");
}

export function getActivePresence(project: DiscussionProject) {
  return project.room.presence.filter((presence) => presence.active);
}

