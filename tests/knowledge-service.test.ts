import { access, mkdir, mkdtemp, rm } from "node:fs/promises";
import Module from "node:module";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

type ModuleLoader = typeof Module & {
  _load: (request: string, parent: NodeModule | null, isMain: boolean) => unknown;
};

async function pathExists(targetPath: string) {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function withTempWorkspace<T>(run: (workspace: string) => Promise<T>) {
  const originalCwd = process.cwd();
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "dialectica-knowledge-service-"));
  const moduleLoader = Module as ModuleLoader;
  const originalLoad = moduleLoader._load;

  moduleLoader._load = function patchedLoad(request, parent, isMain) {
    if (request === "next/headers") {
      return {
        cookies: async () => ({ get: () => undefined }),
        headers: async () => new Headers({ "accept-language": "en-US,en;q=0.9" }),
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    process.chdir(tempDir);
    await mkdir(path.join(tempDir, "data", "projects"), { recursive: true });
    await mkdir(path.join(tempDir, "data", "knowledge"), { recursive: true });
    return await run(tempDir);
  } finally {
    moduleLoader._load = originalLoad;
    process.chdir(originalCwd);
    await rm(tempDir, { recursive: true, force: true });
  }
}

describe("knowledge service read/write boundaries", () => {
  it("keeps normal project reads read-only", async () => {
    await withTempWorkspace(async (workspace) => {
      const repository = await import("@/lib/data/repository");
      const service = await import("@/lib/knowledge/service");
      const { createDefaultSettings } = await import("@/lib/factories");

      const settings = createDefaultSettings("en");
      await repository.saveSettings(settings);
      const project = repository.createProjectSkeleton("en", "discussion", settings);
      project.title = "Read-path regression";
      project.goal = "Verify that read paths stay read-only.";

      const savedProject = await repository.createProject(project, "en", {
        skipAutoAnalyze: true,
        settingsOverride: settings,
      });
      const snapshotPath = path.join(workspace, "data", "knowledge", `${savedProject.id}.en.json`);

      expect(await service.getProjectKnowledgeSnapshot(savedProject.id, "en")).toBe(null);
      expect(await pathExists(snapshotPath)).toBe(false);

      const homepageSummary = await service.getKnowledgeHomepageSummary("en");
      const overview = await service.getKnowledgeOverview("en");
      const graph = await service.buildKnowledgeGraph({ locale: "en", projectId: savedProject.id });

      expect(homepageSummary.recentNodes.some((node) => node.sourceProjectId === savedProject.id)).toBe(false);
      expect(overview.projects.some((projectSummary) => projectSummary.projectId === savedProject.id)).toBe(false);
      expect(graph.nodes).toEqual([]);
      expect(await pathExists(snapshotPath)).toBe(false);

      const generatedSnapshot = await service.extractAndSaveProjectKnowledge(savedProject.id, "en", {
        generateGraphLinks: true,
      });
      if (!generatedSnapshot) {
        throw new Error("Expected the explicit English extraction to return a snapshot.");
      }

      expect(generatedSnapshot.locale).toBe("en");
      expect(await pathExists(snapshotPath)).toBe(true);
    });
  });

  it("only falls back to English for node detail lookup instead of leaking another locale", async () => {
    await withTempWorkspace(async () => {
      const repository = await import("@/lib/data/repository");
      const service = await import("@/lib/knowledge/service");
      const { createDefaultSettings } = await import("@/lib/factories");

      const settings = createDefaultSettings("en");
      await repository.saveSettings(settings);
      const project = repository.createProjectSkeleton("en", "discussion", settings);
      project.title = "Locale fallback boundary";
      project.goal = "Verify node detail fallback stays English-only.";

      const savedProject = await repository.createProject(project, "en", {
        skipAutoAnalyze: true,
        settingsOverride: settings,
      });

      const zhSnapshot = await service.extractAndSaveProjectKnowledge(savedProject.id, "zh-CN", {
        generateGraphLinks: true,
      });
      if (!zhSnapshot) {
        throw new Error("Expected the explicit Chinese extraction to return a snapshot.");
      }
      const zhProjectNodeId = zhSnapshot.nodes.find((node) => node.type === "project")?.id ?? "";

      expect(zhProjectNodeId).not.toBe("");
      expect(await service.getKnowledgeNodeDetail(zhProjectNodeId, "fr")).toBe(null);

      const englishSnapshot = await service.extractAndSaveProjectKnowledge(savedProject.id, "en", {
        generateGraphLinks: true,
      });
      if (!englishSnapshot) {
        throw new Error("Expected the explicit English extraction to return a snapshot.");
      }
      const englishProjectNodeId = englishSnapshot.nodes.find((node) => node.type === "project")?.id ?? "";

      expect(englishProjectNodeId).not.toBe("");

      const englishFallbackDetail = await service.getKnowledgeNodeDetail(englishProjectNodeId, "fr");

      expect(englishFallbackDetail).not.toBe(null);
      expect(englishFallbackDetail?.node.provenance.projectLocale).toBe("en");
    });
  });
});
