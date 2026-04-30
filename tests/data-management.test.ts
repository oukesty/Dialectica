import { describe, expect, it } from "vitest";
import { createDefaultSettings, createDiscussionRoom, createEmptyInsights, createEmptySummary, createParticipantPresence } from "@/lib/factories";
import { buildRestoreSettings, parseFullBackupPayload } from "@/lib/data-management";
import { DiscussionProject, Participant } from "@/lib/types";

function buildParticipant(overrides: Partial<Participant> = {}): Participant {
  return {
    id: overrides.id ?? "participant_backup_1",
    name: overrides.name ?? "Host",
    profileOwnerId: overrides.profileOwnerId ?? "identity_current",
    role: overrides.role ?? "moderator",
    collaborationRole: overrides.collaborationRole ?? "host",
    customRoleLabel: overrides.customRoleLabel,
    stance: overrides.stance ?? "",
    color: overrides.color ?? "#2563eb",
    bio: overrides.bio ?? "",
    avatarLabel: overrides.avatarLabel ?? "HS",
    avatarPreset: overrides.avatarPreset ?? "ember",
    avatarImageDataUrl: overrides.avatarImageDataUrl,
    seatLabel: overrides.seatLabel ?? "HOST",
    presence: overrides.presence ?? createParticipantPresence("session_backup_test", "online"),
  };
}

function buildProject(id = "backup_project_test"): DiscussionProject {
  const participant = buildParticipant();
  const room = createDiscussionRoom("en", "Backup goal", [participant], {
    visibility: "private",
    transport: "local-mock",
    autoSummary: true,
    autoEvaluation: true,
    sessionAutoStart: true,
  });
  const timestamp = new Date().toISOString();

  return {
    id,
    title: "Backup test project",
    description: "Project used for backup tests",
    scenario: "discussion",
    language: "en",
    createdAt: timestamp,
    updatedAt: timestamp,
    status: "active",
    goal: "Backup goal",
    tags: [],
    participants: [participant],
    entries: [],
    nodes: [],
    relations: [],
    insights: createEmptyInsights(timestamp),
    summary: createEmptySummary("en"),
    room,
    providerSnapshot: {
      providerId: "mock",
      model: "rule-balanced-v1",
      generatedAt: timestamp,
      version: "test",
    },
    metadata: {
      isSample: false,
      source: "test",
    },
  };
}

describe("data management backup contract", () => {
  it("skips bundled sample projects while keeping valid user projects", () => {
    const payload = parseFullBackupPayload({
      backupKind: "dialectica-full-backup",
      backupVersion: 2,
      settings: createDefaultSettings("en"),
      projects: [buildProject()],
    });

    expect(payload.invalidProjectCount).toBe(0);
    expect(payload.projects).toHaveLength(1);
    expect(payload.projects[0].id).toBe("backup_project_test");
    expect(payload.skippedSampleProjectIds).toHaveLength(0);
  });

  it("keeps the current local identity when restoring backup settings", () => {
    const currentSettings = createDefaultSettings("en");
    const backupSettings = {
      ...createDefaultSettings("ja"),
      profile: {
        ...createDefaultSettings("ja").profile,
        localIdentityId: "identity_from_backup",
        displayName: "Recovered profile",
      },
    };

    const restored = buildRestoreSettings(currentSettings, backupSettings);

    expect(restored.profile.localIdentityId).toBe(currentSettings.profile.localIdentityId);
    expect(restored.profile.displayName).toBe("Recovered profile");
    expect(restored.locale).toBe("ja");
  });
});
