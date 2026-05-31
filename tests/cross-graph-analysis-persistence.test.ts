import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

async function withTempWorkspace<T>(run: () => Promise<T>) {
  const originalCwd = process.cwd();
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "dialectica-cross-graph-analysis-"));
  try {
    process.chdir(tempDir);
    await mkdir(path.join(tempDir, "data", "knowledge"), { recursive: true });
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

describe("cross-graph analysis persistence", () => {
  it("stores and replaces the latest analysis for the current owner", async () => {
    await withTempWorkspace(async () => {
      const {
        getLatestCrossGraphAnalysis,
        saveLatestCrossGraphAnalysis,
      } = await import("@/lib/knowledge/cross-graph-analyses");

      const first = {
        id: "xanalysis_first",
        ownerIdentityId: "owner_analysis",
        title: "First analysis",
        sourceGraphIds: ["graph_a", "graph_b"],
        analysisGoal: "First goal",
        sharedConcepts: [],
        conflictingViewpoints: [],
        supportingConclusions: [],
        unrelatedNodes: [],
        nodes: [],
        relations: [],
        createdAt: "2026-01-01T00:00:00.000Z",
      };
      const second = {
        ...first,
        id: "xanalysis_second",
        title: "Second analysis",
        sourceGraphIds: ["graph_b", "graph_c"],
        createdAt: "2026-01-02T00:00:00.000Z",
      };

      await saveLatestCrossGraphAnalysis("owner_analysis", first);
      expect((await getLatestCrossGraphAnalysis("owner_analysis"))?.id).toBe("xanalysis_first");

      await saveLatestCrossGraphAnalysis("owner_analysis", second);
      const restored = await getLatestCrossGraphAnalysis("owner_analysis");

      expect(restored?.id).toBe("xanalysis_second");
      expect(restored?.sourceGraphIds).toEqual(["graph_b", "graph_c"]);
      expect(await getLatestCrossGraphAnalysis("another_owner")).toBe(null);
    });
  });
});
