import { describe, expect, it } from "vitest";
import { createDefaultSettings } from "@/lib/factories";
import { appSettingsSchema } from "@/lib/schema";
import { createDeepPatch, mergeDeep } from "@/lib/settings-update";
import { AppSettings } from "@/lib/types";

describe("settings contract", () => {
  it("round-trips extended settings fields through schema validation and patch merging", () => {
    const current = createDefaultSettings("en");
    const next: AppSettings = {
      ...current,
      collaborationPreferences: {
        ...current.collaborationPreferences,
        defaultMemberRole: "observer",
        notificationsEnabled: false,
      },
      aiPreferences: {
        ...current.aiPreferences,
        replyLanguage: "ja",
        aiRole: "moderator",
        focusTopics: "pricing, evidence",
        autoTagging: false,
      },
      participantNicknames: {
        "project-a:participant-2": "Lead analyst",
      },
      tagColors: {
        evidence: "#10b981",
      },
      customShortcuts: {
        sendMessage: "Ctrl+Enter",
      },
      quickReplies: ["Let's validate that claim."],
      projectOrder: ["project-b", "project-a"],
      savedTemplates: [{
        id: "tmpl_1",
        name: "Weekly review",
        scenario: "meeting",
        description: "Reusable meeting scaffold",
        goal: "Summarize key decisions",
        tags: ["meeting", "weekly"],
        savedAt: "2026-04-05T00:00:00.000Z",
      }],
      emailNotifications: {
        enabled: true,
        emailAddress: "host@example.com",
        onNewMember: true,
        onAiSummary: false,
        onRoomArchived: true,
      },
      privacy: {
        ...current.privacy,
        assistantSessionCleanup: {
          enabled: true,
          maxIdleDays: 180,
        },
      },
    };

    const patch = createDeepPatch(current, next);
    expect(patch).toBeDefined();

    const merged = mergeDeep(current, patch);
    const validated = appSettingsSchema.parse(merged);
    expect(validated).toEqual(merged);
    expect(validated.aiPreferences.aiRole).toBe("moderator");
    expect(validated.quickReplies).toEqual(["Let's validate that claim."]);
    expect(validated.savedTemplates).toHaveLength(1);
    expect(validated.emailNotifications.emailAddress).toBe("host@example.com");
    expect(validated.privacy.assistantSessionCleanup).toEqual({
      enabled: true,
      maxIdleDays: 180,
    });
  });

  it("merges nested provider updates without dropping unrelated settings fields", () => {
    const current = createDefaultSettings("en");
    const next = mergeDeep(current, {
      provider: {
        providers: {
          openai: {
            model: "gpt-4o-mini",
          },
        },
      },
    });

    expect(next.provider.providers.openai.model).toBe("gpt-4o-mini");
    expect(next.quickReplies).toEqual(current.quickReplies);
    expect(next.savedTemplates).toEqual(current.savedTemplates);
    expect(next.emailNotifications).toEqual(current.emailNotifications);
  });
});
