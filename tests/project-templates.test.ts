import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  applyProjectTemplatePayload,
  assertBuiltinTemplateLocalesComplete,
  getBuiltinStarterTemplates,
  projectToTemplatePayload,
} from "@/lib/project-templates";
import { createDefaultSettings } from "@/lib/factories";
import { createProjectSkeleton } from "@/lib/data/repository";

async function withTempWorkspace<T>(run: () => Promise<T>) {
  const originalCwd = process.cwd();
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "dialectica-project-templates-"));
  try {
    process.chdir(tempDir);
    await mkdir(path.join(tempDir, "data"), { recursive: true });
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

describe("project starter templates", () => {
  it("uses built-in starter templates instead of bundled samples", () => {
    expect(assertBuiltinTemplateLocalesComplete()).toBe(true);
    const templates = getBuiltinStarterTemplates("en");
    expect(templates).toHaveLength(8);
    expect(templates.map((template) => template.id)).not.toContain("sample_civic_ai_room");
    expect(templates.map((template) => template.id)).not.toContain("sample_heat_resilience_research");
    expect(templates.every((template) => template.payload.room.automationMode === "off")).toBe(true);
  });

  it("keeps private templates scoped to the owner and shared templates visible locally", async () => {
    await withTempWorkspace(async () => {
      const store = await import("@/lib/project-templates");
      const payload = getBuiltinStarterTemplates("en")[2].payload;

      const privateTemplate = await store.saveProjectTemplate({
        ownerIdentityId: "identity-a",
        ownerDisplayName: "A",
        visibility: "private",
        title: "Private review",
        description: "Only A should see this",
        payload,
      });
      const sharedTemplate = await store.saveProjectTemplate({
        ownerIdentityId: "identity-a",
        ownerDisplayName: "A",
        visibility: "shared",
        title: "Shared review",
        description: "Visible to other local identities",
        payload,
      });

      expect((await store.listVisibleProjectTemplates("identity-a")).map((template) => template.id)).toEqual([
        sharedTemplate.id,
        privateTemplate.id,
      ]);
      expect((await store.listVisibleProjectTemplates("identity-b")).map((template) => template.id)).toEqual([
        sharedTemplate.id,
      ]);
      await store.updateProjectTemplate("identity-b", sharedTemplate.id, { title: "Hijack" })
        .then(() => { throw new Error("expected forbidden update"); })
        .catch((error) => expect(error).toEqual(new Error("forbidden")));
      await store.deleteProjectTemplate("identity-b", sharedTemplate.id)
        .then(() => { throw new Error("expected forbidden delete"); })
        .catch((error) => expect(error).toEqual(new Error("forbidden")));
    });
  });

  it("copies template payloads and does not persist runtime project data", async () => {
    await withTempWorkspace(async () => {
      const store = await import("@/lib/project-templates");
      const settings = createDefaultSettings("en");
      const sourceProject = createProjectSkeleton("en", "discussion", settings);
      sourceProject.title = "Launch review";
      sourceProject.description = "Reusable project shape";
      sourceProject.goal = "Clarify launch risks";
      sourceProject.tags = ["launch", "risk"];
      (sourceProject as unknown as { entries: unknown[] }).entries = [{ content: "runtime discussion should not be saved" }];
      (sourceProject as unknown as { attachments: unknown[] }).attachments = [{ fileName: "upload.png" }];
      (sourceProject as unknown as { providerSecrets: unknown }).providerSecrets = { apiKey: "NOT_A_REAL_SECRET_FOR_TESTS" };

      const payload = projectToTemplatePayload(sourceProject);
      const payloadJson = JSON.stringify(payload);
      expect(payloadJson).toContain("Launch review");
      expect(payloadJson).not.toContain("runtime discussion should not be saved");
      expect(payloadJson).not.toContain("upload.png");
      expect(payloadJson).not.toContain("NOT_A_REAL_SECRET_FOR_TESTS");

      const savedTemplate = await store.saveProjectTemplate({
        ownerIdentityId: "identity-a",
        ownerDisplayName: "A",
        visibility: "shared",
        title: "Launch review template",
        description: "Copy-safe template",
        payload,
      });
      const newProject = createProjectSkeleton("en", "meeting", settings);
      const createdFromTemplate = applyProjectTemplatePayload(newProject, savedTemplate.payload);
      createdFromTemplate.title = "Mutated project title";
      expect(savedTemplate.payload.title).toBe("Launch review");

      await store.deleteProjectTemplate("identity-a", savedTemplate.id);
      expect(await store.listVisibleProjectTemplates("identity-a")).toEqual([]);
      expect(createdFromTemplate.title).toBe("Mutated project title");
    });
  });
});
