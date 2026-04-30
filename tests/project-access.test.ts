import { describe, expect, it } from "vitest";
import { createDefaultSettings, createDiscussionRoom, createParticipantPresence } from "@/lib/factories";
import { canArchivePrivateWorkspace, getProjectAccessState, isProjectCreator, isSharedProjectWorkspace } from "@/lib/project-access";
import { DiscussionProject, Participant } from "@/lib/types";

function buildProject(overrides: Partial<DiscussionProject> = {}, participants: Participant[] = []) {
  const { room: roomOverrides, metadata: metadataOverrides, ...projectOverrides } = overrides;
  const room = createDiscussionRoom("en", "Test goal", participants, {
    visibility: roomOverrides?.visibility ?? "private",
    transport: "local-mock",
    autoSummary: true,
    autoEvaluation: true,
    sessionAutoStart: true,
  });

  return {
    id: "project_access_test",
    title: "Access test",
    description: "",
    scenario: "discussion",
    language: "en",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: "active",
    goal: "Test goal",
    tags: [],
    participants,
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
    room: { ...room, ...roomOverrides },
    providerSnapshot: {
      providerId: "mock",
      model: "rule-balanced-v1",
      generatedAt: new Date().toISOString(),
      version: "test",
    },
    metadata: {
      isSample: false,
      source: "test",
      ...metadataOverrides,
    },
    ...projectOverrides,
  } satisfies DiscussionProject;
}

describe("project access state", () => {
  it("treats public non-members as read-only viewers until they join", () => {
    const settings = createDefaultSettings("en");
    const project = buildProject({ room: { visibility: "public" } as DiscussionProject["room"] }, []);

    const access = getProjectAccessState(project, settings);

    expect(access.canRead).toBe(true);
    expect(access.isPublicViewer).toBe(true);
    expect(access.canJoinPublicRoom).toBe(true);
    expect(access.canRunAiTasks).toBe(false);
    expect(access.canPostMessages).toBe(false);
  });

  it("allows a bound participant to post and upload but not moderate by default", () => {
    const settings = createDefaultSettings("en");
    const participant: Participant = {
      id: "participant_local",
      name: settings.profile.displayName,
      profileOwnerId: settings.profile.localIdentityId,
      role: "speaker",
      collaborationRole: "participant",
      stance: "",
      color: "#1d4ed8",
      bio: "",
      avatarLabel: "LP",
      avatarPreset: settings.profile.avatarPreset,
      avatarImageDataUrl: settings.profile.avatarImageDataUrl,
      seatLabel: "Seat-1",
      presence: createParticipantPresence("session_access_test", "online"),
    };
    const project = buildProject({ room: { visibility: "invite" } as DiscussionProject["room"] }, [participant]);

    const access = getProjectAccessState(project, settings);

    expect(access.isMember).toBe(true);
    expect(access.canPostMessages).toBe(true);
    expect(access.canUploadAttachments).toBe(true);
    expect(access.canModerate).toBe(false);
    expect(access.canCreateInvites).toBe(false);
  });

  it("grants moderation controls to the bound host", () => {
    const settings = createDefaultSettings("en");
    const participant: Participant = {
      id: "participant_host",
      name: settings.profile.displayName,
      profileOwnerId: settings.profile.localIdentityId,
      role: "moderator",
      collaborationRole: "host",
      stance: "",
      color: "#b45309",
      bio: "",
      avatarLabel: "LH",
      avatarPreset: settings.profile.avatarPreset,
      avatarImageDataUrl: settings.profile.avatarImageDataUrl,
      seatLabel: "HOST",
      presence: createParticipantPresence("session_access_test", "online"),
    };
    const project = buildProject({ room: { visibility: "public" } as DiscussionProject["room"] }, [participant]);

    const access = getProjectAccessState(project, settings);

    expect(access.canModerate).toBe(true);
    expect(access.canEditWorkspace).toBe(true);
    expect(access.canManageParticipants).toBe(true);
    expect(access.canCreateInvites).toBe(true);
  });

  it("only treats a private single-user workspace as archivable", () => {
    const settings = createDefaultSettings("en");
    const participant: Participant = {
      id: "participant_creator",
      name: settings.profile.displayName,
      profileOwnerId: settings.profile.localIdentityId,
      role: "moderator",
      collaborationRole: "host",
      stance: "",
      color: "#b45309",
      bio: "",
      avatarLabel: "LC",
      avatarPreset: settings.profile.avatarPreset,
      avatarImageDataUrl: settings.profile.avatarImageDataUrl,
      seatLabel: "HOST",
      presence: createParticipantPresence("session_access_test", "online"),
    };

    const privateSingle = buildProject({ room: { visibility: "private" } as DiscussionProject["room"] }, [participant]);
    const publicSingle = buildProject({ room: { visibility: "public" } as DiscussionProject["room"] }, [participant]);
    const multiUser = buildProject({ room: { visibility: "private" } as DiscussionProject["room"] }, [
      participant,
      {
        ...participant,
        id: "participant_other",
        profileOwnerId: "profile_other",
        collaborationRole: "participant",
        role: "speaker",
        name: "Other participant",
      },
    ]);

    expect(canArchivePrivateWorkspace(privateSingle)).toBe(true);
    expect(canArchivePrivateWorkspace(publicSingle)).toBe(false);
    expect(canArchivePrivateWorkspace(multiUser)).toBe(false);
  });

  it("keeps archive permission bound to the original creator identity", () => {
    const settings = createDefaultSettings("en");
    const project = buildProject({
      metadata: {
        isSample: false,
        source: "test",
        createdByIdentityId: settings.profile.localIdentityId,
      },
    }, [
      {
        id: "participant_host",
        name: "Transferred host",
        profileOwnerId: "profile_new_host",
        role: "moderator",
        collaborationRole: "host",
        stance: "",
        color: "#b45309",
        bio: "",
        avatarLabel: "TH",
        avatarPreset: settings.profile.avatarPreset,
        avatarImageDataUrl: settings.profile.avatarImageDataUrl,
        seatLabel: "HOST",
        presence: createParticipantPresence("session_access_test", "online"),
      },
    ]);

    expect(isProjectCreator(project, settings.profile.localIdentityId)).toBe(true);
    expect(isProjectCreator(project, "profile_new_host")).toBe(false);
  });

  it("treats public or multi-user workspaces as shared delete targets", () => {
    const settings = createDefaultSettings("en");
    const participant: Participant = {
      id: "participant_creator",
      name: settings.profile.displayName,
      profileOwnerId: settings.profile.localIdentityId,
      role: "moderator",
      collaborationRole: "host",
      stance: "",
      color: "#b45309",
      bio: "",
      avatarLabel: "LC",
      avatarPreset: settings.profile.avatarPreset,
      avatarImageDataUrl: settings.profile.avatarImageDataUrl,
      seatLabel: "HOST",
      presence: createParticipantPresence("session_access_test", "online"),
    };

    const privateSingle = buildProject({ room: { visibility: "private" } as DiscussionProject["room"] }, [participant]);
    const inviteSingle = buildProject({ room: { visibility: "invite" } as DiscussionProject["room"] }, [participant]);
    const privateMulti = buildProject({ room: { visibility: "private" } as DiscussionProject["room"] }, [
      participant,
      {
        ...participant,
        id: "participant_other",
        profileOwnerId: "profile_other",
        collaborationRole: "participant",
        role: "speaker",
        name: "Other participant",
      },
    ]);

    expect(isSharedProjectWorkspace(privateSingle)).toBe(false);
    expect(isSharedProjectWorkspace(inviteSingle)).toBe(true);
    expect(isSharedProjectWorkspace(privateMulti)).toBe(true);
  });

});
