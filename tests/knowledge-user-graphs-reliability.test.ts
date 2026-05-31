import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import Module from "node:module";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

type ModuleLoader = typeof Module & {
  _load: (request: string, parent: NodeModule | null, isMain: boolean) => unknown;
};

async function withTempWorkspace<T>(run: (
  setIdentity: (identityId: string | null) => void,
  setGraphProviderReply: (reply: string | null) => void,
) => Promise<T>) {
  const originalCwd = process.cwd();
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "dialectica-user-graph-reliability-"));
  const moduleLoader = Module as ModuleLoader;
  const originalLoad = moduleLoader._load;
  let activeIdentityId: string | null = null;
  let graphProviderReply: string | null = null;

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
    if (
      graphProviderReply !== null
      && (
        request === "@/lib/providers/registry"
        || request.endsWith("/lib/providers/registry")
        || request.endsWith("\\lib\\providers\\registry")
        || request.includes(`${path.sep}lib${path.sep}providers${path.sep}registry`)
      )
    ) {
      return {
        getProvider: () => ({
          respondInConversation: async () => ({
            ok: true,
            providerId: "mock",
            model: "rule-balanced-v1",
            generatedAt: new Date().toISOString(),
            message: "Test graph provider returned structured JSON.",
            reply: graphProviderReply,
          }),
        }),
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    process.chdir(tempDir);
    await mkdir(path.join(tempDir, "data", "projects"), { recursive: true });
    await mkdir(path.join(tempDir, "data", "knowledge"), { recursive: true });
    await mkdir(path.join(tempDir, "data", "collaboration"), { recursive: true });
    return await run(
      (identityId) => { activeIdentityId = identityId; },
      (reply) => { graphProviderReply = reply; },
    );
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

function jsonRequest(url: string, method: string, body: unknown) {
  return new Request(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("user knowledge graph reliability", () => {
  it("marks provider failures as failed graphs instead of saving fake nodes", async () => {
    const oldOpenAiKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "";

    try {
      await withTempWorkspace(async (setIdentity) => {
        const repository = await import("@/lib/data/repository");
        const collaborationStore = await import("@/lib/collaboration/store");
        const { createDefaultSettings } = await import("@/lib/factories");
        const userGraphs = await import("@/lib/knowledge/user-graphs");

        const settings = createDefaultSettings("en");
        settings.provider.activeProviderId = "openai";
        settings.provider.providers.openai.enabled = true;
        settings.provider.providers.openai.apiKey = "";
        settings.provider.allowFallbackToScaffold = true;
        setIdentity(settings.profile.localIdentityId);
        await repository.saveSettings(settings);

        const project = repository.createProjectSkeleton("en", "discussion", settings);
        project.title = "Graph failure boundary";
        project.goal = "Verify graph generation does not fabricate fallback nodes.";
        const savedProject = await repository.createProject(project, "en", {
          skipAutoAnalyze: true,
          settingsOverride: settings,
        });
        await collaborationStore.appendCollaborationMessage(savedProject, {
          type: "message",
          participantId: savedProject.participants[0]?.id,
          message: "The team needs to compare evidence quality, identify unresolved risks, and decide the next review action.",
        });

        const graph = await userGraphs.createUserGraph({
          ownerIdentityId: settings.profile.localIdentityId,
          ownerDisplayName: settings.profile.displayName,
          title: "Failed graph",
          description: "",
          sourceProjectIds: [savedProject.id],
          sourceProjectTitles: [savedProject.title],
          graphMode: "both",
          visibility: "private",
          locale: "en",
        });

        const generated = await userGraphs.generateUserGraphContent(graph.id, "en", settings);
        const after = await userGraphs.getUserGraph(graph.id, {
          identityId: settings.profile.localIdentityId,
          displayName: settings.profile.displayName,
        }, "en");

        expect(generated).toBe(null);
        expect(after?.status).toBe("failed");
        expect(after?.nodes).toHaveLength(0);
        expect(after?.relations).toHaveLength(0);
        expect(after?.errorMessage).toContain("AI");
      });
    } finally {
      if (oldOpenAiKey === undefined) {
        delete process.env.OPENAI_API_KEY;
      } else {
        process.env.OPENAI_API_KEY = oldOpenAiKey;
      }
    }
  });

  it("recovers stale generating graphs as failed so users can retry", async () => {
    await withTempWorkspace(async (setIdentity) => {
      const repository = await import("@/lib/data/repository");
      const { createDefaultSettings } = await import("@/lib/factories");
      const userGraphs = await import("@/lib/knowledge/user-graphs");
      const { writeFileAtomic } = await import("@/lib/atomic-file");

      const settings = createDefaultSettings("en");
      setIdentity(settings.profile.localIdentityId);
      await repository.saveSettings(settings);

      const graph = await userGraphs.createUserGraph({
        ownerIdentityId: settings.profile.localIdentityId,
        ownerDisplayName: settings.profile.displayName,
        title: "Stale graph",
        description: "",
        sourceProjectIds: ["project_stale_source"],
        sourceProjectTitles: ["Stale source"],
        graphMode: "both",
        visibility: "private",
        locale: "en",
      });

      const graphPath = path.join(process.cwd(), "data", "knowledge", "user-graphs", `${graph.id}.json`);
      await writeFileAtomic(graphPath, JSON.stringify({
        ...graph,
        status: "generating",
        updatedAt: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
      }, null, 2), "utf-8");

      const recovered = await userGraphs.getUserGraph(graph.id, {
        identityId: settings.profile.localIdentityId,
        displayName: settings.profile.displayName,
      }, "en");

      expect(recovered?.status).toBe("failed");
      expect(recovered?.errorMessage).toContain("timed out");
      expect(recovered?.nodes).toHaveLength(0);
      expect(recovered?.relations).toHaveLength(0);
    });
  });

  it("lets users retry a failed graph generation and stores the regenerated graph", async () => {
    await withTempWorkspace(async (setIdentity, setGraphProviderReply) => {
      const repository = await import("@/lib/data/repository");
      const collaborationStore = await import("@/lib/collaboration/store");
      const { createDefaultSettings } = await import("@/lib/factories");
      const userGraphs = await import("@/lib/knowledge/user-graphs");
      const graphRoute = await import("@/app/api/knowledge/user-graphs/[graphId]/route");

      const settings = createDefaultSettings("en");
      settings.provider.activeProviderId = "mock";
      setIdentity(settings.profile.localIdentityId);
      await repository.saveSettings(settings);

      const project = repository.createProjectSkeleton("en", "discussion", settings);
      project.title = "Retryable graph source";
      project.goal = "Verify retry replaces a failed graph with source-backed knowledge.";
      const savedProject = await repository.createProject(project, "en", {
        skipAutoAnalyze: true,
        settingsOverride: settings,
      });
      await collaborationStore.appendCollaborationMessage(savedProject, {
        type: "message",
        participantId: savedProject.participants[0]?.id,
        message: "The launch should wait until privacy evidence and owner accountability are both confirmed.",
      });

      const graph = await userGraphs.createUserGraph({
        ownerIdentityId: settings.profile.localIdentityId,
        ownerDisplayName: settings.profile.displayName,
        title: "Retry graph",
        description: "",
        sourceProjectIds: [savedProject.id],
        sourceProjectTitles: [savedProject.title],
        graphMode: "both",
        visibility: "private",
        locale: "en",
      });
      await userGraphs.updateUserGraph(graph.id, {
        status: "failed",
        errorMessage: "Previous provider failure.",
      });

      setGraphProviderReply(JSON.stringify({
        nodes: [
          {
            id: "n1",
            label: "Privacy evidence gates launch",
            type: "evidence",
            description: "The launch should wait until privacy evidence is confirmed by the team.",
          },
          {
            id: "n2",
            label: "Owner accountability must be confirmed",
            type: "recommendation",
            description: "The owner accountability path needs confirmation before launch.",
          },
        ],
        relations: [
          {
            source: "n1",
            target: "n2",
            label: "both are required before launch",
            type: "supports",
          },
        ],
      }));

      const response = await graphRoute.POST(
        jsonRequest("http://test.local/api/knowledge/user-graphs/retry?locale=en", "POST", { action: "retry" }),
        { params: Promise.resolve({ graphId: graph.id }) },
      );
      const payload = await response.json();

      expect(response.status).toBe(200);
      expect(payload.graph.status).toBe("ready");
      expect(payload.graph.nodes.length).toBeGreaterThan(0);
      expect(payload.graph.errorMessage ?? "").toBe("");
    });
  });

  it("exports the active user graph version instead of rebuilding a different visible scope", async () => {
    await withTempWorkspace(async (setIdentity) => {
      const repository = await import("@/lib/data/repository");
      const { createDefaultSettings } = await import("@/lib/factories");
      const userGraphs = await import("@/lib/knowledge/user-graphs");
      const graphExportRoute = await import("@/app/api/knowledge/graph/route");

      const settings = createDefaultSettings("en");
      setIdentity(settings.profile.localIdentityId);
      await repository.saveSettings(settings);

      const graph = await userGraphs.createUserGraph({
        ownerIdentityId: settings.profile.localIdentityId,
        ownerDisplayName: settings.profile.displayName,
        title: "Visible export graph",
        description: "",
        sourceProjectIds: ["project_export_a", "project_export_b"],
        sourceProjectTitles: ["Export source A", "Export source B"],
        graphMode: "both",
        visibility: "private",
        locale: "en",
      });
      await userGraphs.updateUserGraph(graph.id, {
        status: "ready",
        nodes: [{
          id: "kg_project_export_a_n1",
          title: "Only visible user graph node",
          type: "conclusion",
          category: "other",
          summary: "This node belongs to the active user graph version and must be exported.",
          sourceProjectId: "project_export_a",
          sourceProjectTitle: "Export source A",
          sourceDiscussionId: "project_export_a",
          tags: ["export"],
          topics: ["export"],
          relatedParticipantIds: [],
          evidenceReferences: [],
          relatedNodeIds: [],
          createdFrom: ["transcript"],
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
          provenance: {
            projectId: "project_export_a",
            projectTitle: "Export source A",
            projectLocale: "en",
            scenario: "discussion",
            createdFrom: ["transcript"],
            generatedAt: "2026-01-01T00:00:00.000Z",
          },
        }],
        relations: [],
        stats: { nodeCount: 1, relationCount: 0, topicCount: 1 },
      });

      const response = await graphExportRoute.GET(new Request(
        `http://test.local/api/knowledge/graph?locale=en&graphId=${graph.id}&projectIds=project_export_a,project_export_b&scopeMode=cross-project&query=visible`,
      ));
      const payload = await response.json();

      expect(response.status).toBe(200);
      expect(payload.graph.nodes).toHaveLength(1);
      expect(payload.graph.nodes[0].title).toBe("Only visible user graph node");
      expect(payload.graph.scope.projectIds).toEqual(["project_export_a", "project_export_b"]);
      expect(payload.graph.scope.query).toBe("visible");
    });
  });

  it("uses the bulk graph API to delete all versions or keep only the latest", async () => {
    await withTempWorkspace(async (setIdentity) => {
      const repository = await import("@/lib/data/repository");
      const { createDefaultSettings } = await import("@/lib/factories");
      const userGraphs = await import("@/lib/knowledge/user-graphs");
      const userGraphsRoute = await import("@/app/api/knowledge/user-graphs/route");

      const settings = createDefaultSettings("en");
      setIdentity(settings.profile.localIdentityId);
      await repository.saveSettings(settings);

      const makeGraph = (title: string) => userGraphs.createUserGraph({
        ownerIdentityId: settings.profile.localIdentityId,
        ownerDisplayName: settings.profile.displayName,
        title,
        description: "",
        sourceProjectIds: ["project_bulk_source"],
        sourceProjectTitles: ["Bulk source"],
        graphMode: "both",
        visibility: "private",
        locale: "en",
      });

      const oldVersion = await makeGraph("Bulk graph v1");
      const latestVersion = await makeGraph("Bulk graph v2");

      const keepLatest = await userGraphsRoute.DELETE(jsonRequest(
        "http://test.local/api/knowledge/user-graphs?locale=en",
        "DELETE",
        {
          action: "keep-latest",
          graphIds: [oldVersion.id, latestVersion.id],
          keepGraphId: latestVersion.id,
        },
      ));
      const keepPayload = await keepLatest.json();
      expect(keepLatest.status).toBe(200);
      expect(keepPayload.deletedIds).toEqual([oldVersion.id]);
      expect(await userGraphs.getUserGraph(oldVersion.id, {
        identityId: settings.profile.localIdentityId,
        displayName: settings.profile.displayName,
      }, "en")).toBe(null);
      expect((await userGraphs.getUserGraph(latestVersion.id, {
        identityId: settings.profile.localIdentityId,
        displayName: settings.profile.displayName,
      }, "en"))?.id).toBe(latestVersion.id);

      const deleteOne = await makeGraph("Bulk graph v3");
      const deleteTwo = await makeGraph("Bulk graph v4");
      const deleteAll = await userGraphsRoute.DELETE(jsonRequest(
        "http://test.local/api/knowledge/user-graphs?locale=en",
        "DELETE",
        {
          action: "delete-versions",
          graphIds: [deleteOne.id, deleteTwo.id],
        },
      ));
      const deletePayload = await deleteAll.json();
      expect(deleteAll.status).toBe(200);
      expect(deletePayload.deletedIds.sort()).toEqual([deleteOne.id, deleteTwo.id].sort());
      expect(await userGraphs.getUserGraph(deleteOne.id, {
        identityId: settings.profile.localIdentityId,
        displayName: settings.profile.displayName,
      }, "en")).toBe(null);
      expect(await userGraphs.getUserGraph(deleteTwo.id, {
        identityId: settings.profile.localIdentityId,
        displayName: settings.profile.displayName,
      }, "en")).toBe(null);
    });
  });

  it("keeps generated user graphs isolated from project knowledge snapshots", async () => {
    await withTempWorkspace(async (setIdentity) => {
      const repository = await import("@/lib/data/repository");
      const collaborationStore = await import("@/lib/collaboration/store");
      const { createDefaultSettings } = await import("@/lib/factories");
      const service = await import("@/lib/knowledge/service");
      const userGraphs = await import("@/lib/knowledge/user-graphs");
      const { mockProvider } = await import("@/lib/providers/mock-provider");

      const settings = createDefaultSettings("en");
      setIdentity(settings.profile.localIdentityId);
      await repository.saveSettings(settings);

      const project = repository.createProjectSkeleton("en", "discussion", settings);
      project.title = "Snapshot isolation";
      project.goal = "Keep project knowledge snapshots separate from user graphs.";
      const savedProject = await repository.createProject(project, "en", {
        skipAutoAnalyze: true,
        settingsOverride: settings,
      });
      await service.extractAndSaveProjectKnowledge(savedProject.id, "en", {
        generateGraphLinks: true,
      });
      const snapshotFile = path.join(process.cwd(), "data", "knowledge", `${savedProject.id}.en.json`);
      const snapshotBefore = await readFile(snapshotFile, "utf-8");

      await collaborationStore.appendCollaborationMessage(savedProject, {
        type: "message",
        participantId: savedProject.participants[0]?.id,
        message: "Evidence quality should determine the release decision, while unresolved privacy risks remain action items.",
      });

      const graphProviderReply = JSON.stringify({
        nodes: [
          {
            id: "n1",
            label: "Evidence quality determines release",
            type: "conclusion",
            description: "The release decision should depend on whether the evidence is strong enough.",
          },
          {
            id: "n2",
            label: "Privacy risks remain unresolved",
            type: "question",
            description: "Open privacy risks need review before the team can move ahead.",
          },
        ],
        relations: [
          {
            source: "n2",
            target: "n1",
            label: "blocks the release decision",
            type: "contradicts",
          },
        ],
      });
      const originalRespond = mockProvider.respondInConversation;
      mockProvider.respondInConversation = async () => ({
        ok: true,
        providerId: "mock",
        model: "rule-balanced-v1",
        generatedAt: new Date().toISOString(),
        message: "Test graph provider returned structured JSON.",
        reply: graphProviderReply,
      });

      try {
        const graph = await userGraphs.createUserGraph({
          ownerIdentityId: settings.profile.localIdentityId,
          ownerDisplayName: settings.profile.displayName,
          title: "Isolated graph",
          description: "",
          sourceProjectIds: [savedProject.id],
          sourceProjectTitles: [savedProject.title],
          graphMode: "both",
          visibility: "private",
          locale: "en",
        });

        const generated = await userGraphs.generateUserGraphContent(graph.id, "en", settings);
        const snapshotAfter = await readFile(snapshotFile, "utf-8");

        expect(generated?.status).toBe("ready");
        expect((generated?.nodes.length ?? 0) > 0).toBe(true);
        expect(snapshotAfter).toBe(snapshotBefore);
      } finally {
        mockProvider.respondInConversation = originalRespond;
      }
    });
  });
});
