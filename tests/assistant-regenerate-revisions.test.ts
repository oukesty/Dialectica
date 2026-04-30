import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

async function withTempWorkspace<T>(run: () => Promise<T>) {
  const originalCwd = process.cwd();
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "dialectica-assistant-revisions-"));
  try {
    process.chdir(tempDir);
    await mkdir(path.join(tempDir, "data", "projects"), { recursive: true });
    await mkdir(path.join(tempDir, "data", "collaboration"), { recursive: true });
    return await run();
  } finally {
    for (const cacheKey of Object.keys(require.cache)) {
      if (cacheKey.includes(`${path.sep}.test-dist${path.sep}src${path.sep}`)) {
        delete require.cache[cacheKey];
      }
    }
    process.chdir(originalCwd);
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function createAssistantThread() {
  const repository = await import("@/lib/data/repository");
  const store = await import("@/lib/collaboration/store");
  const { createDefaultSettings } = await import("@/lib/factories");

  const settings = createDefaultSettings("en");
  await repository.saveSettings(settings);
  const project = repository.createProjectSkeleton("en", "ai-dialogue", settings);
  project.title = "Personal AI workspace";
  project.goal = "Keep a normal one-to-one chat.";
  const savedProject = await repository.createProject(project, "en", {
    skipAutoAnalyze: true,
    settingsOverride: settings,
  });
  const participantId = savedProject.participants[0].id;

  await store.appendCollaborationMessage(savedProject, {
    type: "message",
    participantId,
    message: "Hello",
  });
  const state = await store.appendCollaborationMessage(savedProject, {
    type: "message",
    actorType: "ai",
    message: "First assistant answer.",
    metadata: {
      providerId: "mock",
      model: "rule-balanced-v1",
      assistant: "true",
    },
  });
  const aiEvent = state.events.find((event) => event.actorType === "ai" && event.message === "First assistant answer.");
  if (!aiEvent) throw new Error("assistant event missing");

  return { savedProject, aiEvent, store };
}

describe("assistant regenerate revisions", () => {
  it("adds a new assistant revision without adding another user message", async () => {
    await withTempWorkspace(async () => {
      const { savedProject, aiEvent, store } = await createAssistantThread();
      const revised = await store.appendAssistantEventRevision(savedProject, aiEvent.id, {
        content: "Second assistant answer.",
        createdAt: "2026-04-30T00:00:00.000Z",
        providerId: "mock",
        model: "rule-balanced-v1",
      });

      expect(revised).not.toBe(null);
      const events = revised!.events.filter((event) => event.type === "message" || event.actorType === "ai");
      expect(events.filter((event) => event.actorType !== "ai").length).toBe(1);
      expect(events.filter((event) => event.actorType === "ai").length).toBe(1);
      const updatedAi = events.find((event) => event.actorType === "ai")!;
      expect(updatedAi.message).toBe("Second assistant answer.");
      expect(updatedAi.revisions?.length).toBe(2);
      expect(updatedAi.revisions?.[0].content).toBe("First assistant answer.");
      expect(updatedAi.activeRevisionId).toBe(updatedAi.revisions?.[1].id);
    });
  });

  it("uses the active assistant revision when building later context", async () => {
    await withTempWorkspace(async () => {
      const { savedProject, aiEvent, store } = await createAssistantThread();
      const { buildConversationHistory } = await import("@/lib/ai/assistant-conversation");
      const revised = await store.appendAssistantEventRevision(savedProject, aiEvent.id, {
        content: "Second assistant answer.",
        providerId: "mock",
        model: "rule-balanced-v1",
      });
      const firstRevisionId = revised!.events.find((event) => event.id === aiEvent.id)!.revisions![0].id;
      const activated = await store.activateAssistantEventRevision(savedProject, aiEvent.id, firstRevisionId);

      expect(activated).not.toBe(null);
      const activeEvent = activated!.events.find((event) => event.id === aiEvent.id)!;
      expect(activeEvent.message).toBe("First assistant answer.");
      const history = buildConversationHistory(savedProject, activated!);
      expect(history[history.length - 1].role).toBe("assistant");
      expect(history[history.length - 1].content).toBe("First assistant answer.");
    });
  });

  it("does not create a fake revision when the regenerated content is empty", async () => {
    await withTempWorkspace(async () => {
      const { savedProject, aiEvent, store } = await createAssistantThread();
      const empty = await store.appendAssistantEventRevision(savedProject, aiEvent.id, {
        content: "   ",
        providerId: "mock",
        model: "rule-balanced-v1",
      });
      const state = await store.getCollaborationState(savedProject);
      const aiEvents = state.events.filter((event) => event.actorType === "ai");

      expect(empty).toBe(null);
      expect(aiEvents.length).toBe(1);
      expect(aiEvents[0].message).toBe("First assistant answer.");
      expect(aiEvents[0].revisions).toBe(undefined);
    });
  });
});
