import { describe, expect, it } from "vitest";
import { createDiscussionRoom, createParticipantPresence } from "@/lib/factories";
import { buildProjectSyncSignature } from "@/lib/project-sync";
import { DiscussionProject, Participant } from "@/lib/types";

function buildParticipant(overrides: Partial<Participant>): Participant {
  return {
    id: overrides.id ?? "participant_1",
    name: overrides.name ?? "Participant",
    profileOwnerId: overrides.profileOwnerId,
    role: overrides.role ?? "speaker",
    collaborationRole: overrides.collaborationRole ?? "participant",
    customRoleLabel: overrides.customRoleLabel,
    stance: overrides.stance ?? "",
    color: overrides.color ?? "#2563eb",
    bio: overrides.bio ?? "",
    avatarLabel: overrides.avatarLabel ?? "PT",
    avatarPreset: overrides.avatarPreset ?? "ember",
    avatarImageDataUrl: overrides.avatarImageDataUrl,
    seatLabel: overrides.seatLabel ?? "Seat-1",
    presence: overrides.presence ?? createParticipantPresence("session_project_sync", "online"),
  };
}

function buildProject(): DiscussionProject {
  const host = buildParticipant({
    id: "host_1",
    name: "Host",
    profileOwnerId: "profile_host",
    role: "moderator",
    collaborationRole: "host",
    seatLabel: "HOST",
  });
  const participant = buildParticipant({
    id: "participant_2",
    name: "Analyst",
    profileOwnerId: "profile_analyst",
  });
  const room = createDiscussionRoom("en", "Project sync goal", [host, participant], {
    visibility: "public",
    transport: "local-mock",
    autoSummary: true,
    autoEvaluation: true,
    sessionAutoStart: true,
  });

  return {
    id: "project_sync_test",
    title: "Project sync test",
    description: "",
    scenario: "discussion",
    language: "en",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: "active",
    goal: "Project sync goal",
    tags: [],
    participants: [host, participant],
    entries: [],
    nodes: [],
    relations: [],
    insights: { updatedAt: new Date().toISOString(), items: [] },
    summary: {
      overview: "",
      participantOverview: [],
      coreTopics: [],
      majorClaims: [],
      keyEvidence: [],
      majorRebuttals: [],
      unresolvedQuestions: [],
      disputes: [],
      currentConclusion: "",
      nextSteps: [],
      suggestions: [],
      followupQuestions: [],
      evaluation: {
        leaning: "",
        favoredByEvidence: "",
        favoredByResponsiveness: "",
        favoredByLogic: "",
        moreUnanswered: "",
        confidence: "low",
        reasons: [],
        improvementSuggestions: [],
      },
    },
    room,
    providerSnapshot: {
      providerId: "mock",
      model: "rule-balanced-v1",
      generatedAt: new Date().toISOString(),
      version: "test",
    },
    metadata: {
      isSample: false,
      source: "test",
    },
  };
}

describe("project sync signature", () => {
  it("changes when membership, room ai owner, or automation settings change", () => {
    const baseProject = buildProject();
    const baseSignature = buildProjectSyncSignature(baseProject);

    const roleChanged = buildProjectSyncSignature({
      ...baseProject,
      participants: baseProject.participants.map((participant) =>
        participant.id === "participant_2"
          ? { ...participant, collaborationRole: "observer", role: "observer" }
          : participant),
    });
    const ownerChanged = buildProjectSyncSignature({
      ...baseProject,
      room: {
        ...baseProject.room,
        session: {
          ...baseProject.room.session,
          hostParticipantId: "participant_2",
          observerIds: ["host_1"],
        },
        aiConfig: {
          ...baseProject.room.aiConfig,
          ownerParticipantId: "participant_2",
          ownerIdentityId: "profile_analyst",
          updatedAt: "2026-04-06T00:00:00.000Z",
        },
      },
    });
    const automationChanged = buildProjectSyncSignature({
      ...baseProject,
      room: {
        ...baseProject.room,
        aiAutomation: {
          mode: "auto",
          autoReplyThreshold: 4,
          responseStyle: "analytical",
        },
      },
    });

    expect(roleChanged).not.toBe(baseSignature);
    expect(ownerChanged).not.toBe(baseSignature);
    expect(automationChanged).not.toBe(baseSignature);
  });
});
