import { mkdir, mkdtemp, rm } from "node:fs/promises";
import Module from "node:module";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

type ModuleLoader = typeof Module & {
  _load: (request: string, parent: NodeModule | null, isMain: boolean) => unknown;
};

async function withTempWorkspace<T>(run: (setIdentity: (identityId: string | null) => void) => Promise<T>) {
  const originalCwd = process.cwd();
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "dialectica-notifications-"));
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

describe("notifications storage", () => {
  it("serializes concurrent appends so no notification is lost", async () => {
    await withTempWorkspace(async () => {
      const { appendNotification, clearAllNotifications, getNotifications } = await import("@/lib/notifications");
      const userId = `notif_test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      try {
        await Promise.all([
          appendNotification(userId, {
            type: "member_join",
            title: "Join",
            body: "A member joined",
            projectId: "project-1",
          }),
          appendNotification(userId, {
            type: "email_trigger",
            title: "Email",
            body: "Send the email stub",
            projectId: "project-1",
          }),
        ]);

        const notifications = await getNotifications(userId);

        expect(notifications).toHaveLength(2);
        expect(notifications.map((entry) => entry.type)).toContain("member_join");
        expect(notifications.map((entry) => entry.type)).toContain("email_trigger");
      } finally {
        await clearAllNotifications(userId);
      }
    });
  });

  it("keeps do-not-disturb notifications in history but suppresses storage when notifications are disabled", async () => {
    await withTempWorkspace(async (setIdentity) => {
      const repository = await import("@/lib/data/repository");
      const { createDefaultSettings } = await import("@/lib/factories");
      const { appendNotification, getNotifications } = await import("@/lib/notifications");

      const mutedSettings = createDefaultSettings("en");
      mutedSettings.profile.localIdentityId = "profile_notifications_dnd_test";
      mutedSettings.collaborationPreferences.notificationsEnabled = true;
      mutedSettings.collaborationPreferences.notificationDoNotDisturb = true;
      setIdentity(mutedSettings.profile.localIdentityId);
      await repository.saveSettings(mutedSettings);

      const mutedStored = await appendNotification(mutedSettings.profile.localIdentityId, {
        type: "member_join",
        title: "Join",
        body: "A member joined while do-not-disturb was enabled.",
        projectId: "project-1",
      });
      expect(Boolean(mutedStored)).toBe(true);
      expect(await getNotifications(mutedSettings.profile.localIdentityId)).toHaveLength(1);

      const disabledSettings = createDefaultSettings("en");
      disabledSettings.profile.localIdentityId = "profile_notifications_disabled_test";
      disabledSettings.collaborationPreferences.notificationsEnabled = false;
      setIdentity(disabledSettings.profile.localIdentityId);
      await repository.saveSettings(disabledSettings);

      const skipped = await appendNotification(disabledSettings.profile.localIdentityId, {
        type: "member_join",
        title: "Join",
        body: "A member joined while notifications were disabled.",
        projectId: "project-1",
      });
      expect(skipped === null).toBe(true);
      expect(await getNotifications(disabledSettings.profile.localIdentityId)).toHaveLength(0);

      const simulatedEmail = await appendNotification(disabledSettings.profile.localIdentityId, {
        type: "email_trigger",
        title: "Email",
        body: "Local simulated email notifications are retained for audit visibility.",
        projectId: "project-1",
      });
      expect(Boolean(simulatedEmail)).toBe(true);
      expect(await getNotifications(disabledSettings.profile.localIdentityId)).toHaveLength(1);
    });
  });
});
