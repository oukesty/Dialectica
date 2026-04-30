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
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "dialectica-ai-summary-failure-"));
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
    await mkdir(path.join(tempDir, "data", "projects"), { recursive: true });
    await mkdir(path.join(tempDir, "data", "knowledge"), { recursive: true });
    await mkdir(path.join(tempDir, "data", "collaboration"), { recursive: true });
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

function jsonRequest(url: string, method: "POST", body?: unknown) {
  return new Request(url, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("AI summary failure handling", () => {
  it("does not save provider failure scaffold as a real summary", async () => {
    const oldOpenAiKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "";

    try {
      await withTempWorkspace(async (setIdentity) => {
        const repository = await import("@/lib/data/repository");
        const collaborationStore = await import("@/lib/collaboration/store");
        const { createDefaultSettings } = await import("@/lib/factories");
        const aiRoute = await import("@/app/api/projects/[projectId]/ai/route");

        const settings = createDefaultSettings("en");
        settings.provider.activeProviderId = "openai";
        settings.provider.providers.openai.enabled = true;
        settings.provider.providers.openai.apiKey = "";
        settings.provider.allowFallbackToScaffold = true;
        setIdentity(settings.profile.localIdentityId);
        await repository.saveSettings(settings);

        const project = repository.createProjectSkeleton("en", "discussion", settings);
        project.title = "Summary failure boundary";
        project.goal = "Verify failed provider output cannot overwrite a valid summary.";
        project.summary = {
          ...project.summary,
          overview: "Existing valid summary.",
          history: [{
            id: "summary-existing",
            createdAt: new Date(Date.UTC(2026, 0, 1)).toISOString(),
            trigger: "manual",
            providerId: "mock",
            model: "rule-balanced-v1",
            throughEntryCount: 1,
            overview: "Existing valid summary.",
            currentConclusion: "Keep this conclusion.",
            nextSteps: ["Keep the old step."],
          }],
        };

        const savedProject = await repository.createProject(project, "en", {
          skipAutoAnalyze: true,
          settingsOverride: settings,
        });
        const beforeCollaboration = await collaborationStore.getCollaborationState(savedProject);
        const beforeSummaryAiEvents = beforeCollaboration.events.filter((event) => event.actorType === "ai" && event.aiTask === "summarizeDiscussion");

        const response = await aiRoute.POST(
          jsonRequest(`http://test.local/api/projects/${savedProject.id}/ai`, "POST", {
            task: "summarizeDiscussion",
            locale: "en",
          }),
          { params: Promise.resolve({ projectId: savedProject.id }) },
        );
        const payload = await response.json() as { error?: string };

        expect(response.status).toBe(502);
        expect(payload.error).toContain("no new summary was saved");

        const after = await repository.getProject(savedProject.id, "en");
        const history = after.summary.history ?? [];
        expect(after.summary.overview).toBe("Existing valid summary.");
        expect(history).toHaveLength(1);
        expect(history[0]?.id).toBe("summary-existing");

        const collaboration = await collaborationStore.getCollaborationState(after);
        const afterSummaryAiEvents = collaboration.events.filter((event) => event.actorType === "ai" && event.aiTask === "summarizeDiscussion");
        expect(afterSummaryAiEvents).toHaveLength(beforeSummaryAiEvents.length);
      });
    } finally {
      if (oldOpenAiKey === undefined) {
        delete process.env.OPENAI_API_KEY;
      } else {
        process.env.OPENAI_API_KEY = oldOpenAiKey;
      }
    }
  });
});
