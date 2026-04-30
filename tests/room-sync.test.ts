import { describe, expect, it } from "vitest";
import { createDiscussionRoom, createParticipantPresence, createProviderSnapshot, createRoomAiConfig } from "@/lib/factories";
import { syncRoomFromParticipants } from "@/lib/data/repository";
import { DiscussionProject, Participant } from "@/lib/types";

function buildParticipant(overrides: Partial<Participant>): Participant {
  return {
    id: overrides.id ?? "participant",
    name: overrides.name ?? "Participant",
    profileOwnerId: overrides.profileOwnerId,
    role: overrides.role ?? "speaker",
    collaborationRole: overrides.collaborationRole ?? "participant",
    customRoleLabel: overrides.customRoleLabel,
    stance: overrides.stance ?? "",
    color: overrides.color ?? "#1d4ed8",
    bio: overrides.bio ?? "",
    avatarLabel: overrides.avatarLabel ?? "PT",
    avatarPreset: overrides.avatarPreset ?? "ember",
    avatarImageDataUrl: overrides.avatarImageDataUrl,
    seatLabel: overrides.seatLabel ?? "Seat-1",
    presence: overrides.presence ?? createParticipantPresence("session_room_sync", "online"),
  };
}

describe("room membership sync", () => {
  it("recomputes host, observers, and ai owner from the participant roster", () => {
    const previousHost = buildParticipant({
      id: "host_old",
      name: "Old host",
      profileOwnerId: "profile_old",
      role: "custom",
      collaborationRole: "facilitator",
      seatLabel: "HOST",
    });
    const nextHost = buildParticipant({
      id: "host_new",
      name: "New host",
      profileOwnerId: "profile_new",
      role: "moderator",
      collaborationRole: "host",
      seatLabel: "HOST",
    });
    const observer = buildParticipant({
      id: "observer_1",
      name: "Observer",
      profileOwnerId: "profile_observer",
      role: "observer",
      collaborationRole: "observer",
      seatLabel: "OBS",
    });
    const participants = [previousHost, nextHost, observer];

    const room = createDiscussionRoom("en", "Room sync test", participants, {
      visibility: "public",
      transport: "local-mock",
      autoSummary: true,
      autoEvaluation: true,
      sessionAutoStart: true,
      aiConfig: createRoomAiConfig("openai", "gpt-4o", {
        ownerIdentityId: "profile_old",
        ownerParticipantId: "host_old",
        updatedByParticipantId: "host_old",
      }),
    });

    const synced = syncRoomFromParticipants({
      participants,
      providerSnapshot: createProviderSnapshot("openai", "gpt-4o", "test"),
      room: {
        ...room,
        session: {
          ...room.session,
          hostParticipantId: "host_old",
          observerIds: [],
        },
        aiConfig: {
          ...room.aiConfig,
          ownerParticipantId: "host_old",
          ownerIdentityId: "profile_old",
        },
      },
    } satisfies Pick<DiscussionProject, "participants" | "providerSnapshot" | "room">, participants);

    expect(synced.session.hostParticipantId).toBe("host_new");
    expect(synced.session.observerIds).toEqual(["observer_1"]);
    expect(synced.aiConfig.ownerParticipantId).toBe("host_new");
    expect(synced.aiConfig.ownerIdentityId).toBe("profile_new");
  });
});
