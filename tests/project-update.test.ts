import { describe, expect, it } from "vitest";
import { createDiscussionRoom, createParticipantPresence } from "@/lib/factories";
import { createProjectPatch, hasProjectConflict, mergeProjectPatch } from "@/lib/project-update";
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
    presence: overrides.presence ?? createParticipantPresence("session_project_update", "online"),
  };
}

function buildProject(): DiscussionProject {
  const participant = buildParticipant({
    id: "participant_1",
    name: "Host",
    profileOwnerId: "profile_host",
    role: "moderator",
    collaborationRole: "host",
    seatLabel: "HOST",
  });
  const room = createDiscussionRoom("en", "Project update goal", [participant], {
    visibility: "private",
    transport: "local-mock",
    autoSummary: true,
    autoEvaluation: true,
    sessionAutoStart: true,
  });

  return {
    id: "project_update_test",
    title: "Project update test",
    description: "Baseline description",
    scenario: "discussion",
    language: "en",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: "active",
    goal: "Project update goal",
    tags: ["alpha"],
    participants: [participant],
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

describe("project update conflict control", () => {
  it("merges a deep patch back into the saved project", () => {
    const previous = buildProject();
    const next = {
      ...previous,
      description: "Revised description",
      room: {
        ...previous.room,
        notes: ["Keep this synced"],
      },
    };

    const patch = createProjectPatch(previous, next);
    const merged = mergeProjectPatch(previous, patch);

    expect(merged).toEqual(next);
  });

  it("flags only overlapping field changes as conflicts", () => {
    const previous = buildProject();
    const next = {
      ...previous,
      description: "Revised description",
    };
    const patch = createProjectPatch(previous, next);

    const remoteNonOverlapping = {
      ...previous,
      title: "Remote title change",
    };
    const remoteOverlapping = {
      ...previous,
      description: "Remote description change",
    };

    expect(hasProjectConflict(remoteNonOverlapping, patch, previous)).toBe(false);
    expect(hasProjectConflict(remoteOverlapping, patch, previous)).toBe(true);
  });
});
