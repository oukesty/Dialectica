import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import Module from "node:module";
import os from "node:os";
import path from "node:path";
import { createDefaultSettings } from "@/lib/factories";
import { appSettingsSchema } from "@/lib/schema";
import { createDeepPatch, mergeDeep } from "@/lib/settings-update";
import { AppSettings } from "@/lib/types";

type ModuleLoader = typeof Module & {
  _load: (request: string, parent: NodeModule | null, isMain: boolean) => unknown;
};

async function withTempSettingsWorkspace<T>(run: (setIdentity: (identityId: string | null) => void) => Promise<T>) {
  const originalCwd = process.cwd();
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "dialectica-settings-"));
  const moduleLoader = Module as ModuleLoader;
  const originalLoad = moduleLoader._load;
  let activeIdentityId: string | null = null;

  moduleLoader._load = function patchedLoad(request, parent, isMain) {
    if (request === "next/headers") {
      return {
        cookies: async () => ({
          get: (name: string) => (
            name === "dialectica-profile-id" && activeIdentityId
              ? { name, value: activeIdentityId }
              : undefined
          ),
        }),
        headers: async () => new Headers({ "accept-language": "en-US,en;q=0.9" }),
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    process.chdir(tempDir);
    await mkdir(path.join(tempDir, "data"), { recursive: true });
    return await run((identityId) => { activeIdentityId = identityId; });
  } finally {
    moduleLoader._load = originalLoad;
    for (const cacheKey of Object.keys(require.cache)) {
      if (cacheKey.includes(`${path.sep}.test-dist${path.sep}src${path.sep}`)) {
        delete require.cache[cacheKey];
      }
    }
    process.chdir(originalCwd);
    await rm(tempDir, { recursive: true, force: true });
  }
}

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

  it("persists knowledge automation settings instead of silently resetting them", async () => {
    await withTempSettingsWorkspace(async (setIdentity) => {
      const repository = await import("@/lib/data/repository");
      const settings = createDefaultSettings("en");
      settings.profile.localIdentityId = "profile_knowledge_automation";
      settings.knowledgePreferences.autoExtractOnSave = true;
      settings.knowledgePreferences.autoExtractAfterAiTask = true;
      settings.knowledgePreferences.autoGenerateGraphLinks = true;
      setIdentity(settings.profile.localIdentityId);

      await repository.saveSettings(settings);
      const restored = await repository.getSettings({ includeSecrets: false });

      expect(restored.knowledgePreferences.autoExtractOnSave).toBe(true);
      expect(restored.knowledgePreferences.autoExtractAfterAiTask).toBe(true);
      expect(restored.knowledgePreferences.autoGenerateGraphLinks).toBe(true);
    });
  });
});
