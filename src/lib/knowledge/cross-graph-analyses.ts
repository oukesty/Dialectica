import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { writeFileAtomic } from "@/lib/atomic-file";
import type { CrossGraphAnalysis } from "@/lib/knowledge/types";

const analysisRoot = path.join(process.cwd(), "data", "knowledge", "cross-graph-analyses");

function safeOwnerKey(ownerIdentityId: string) {
  return ownerIdentityId.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "anonymous";
}

async function ensureAnalysisDir() {
  await mkdir(analysisRoot, { recursive: true });
}

function latestAnalysisPath(ownerIdentityId: string) {
  return path.join(analysisRoot, `${safeOwnerKey(ownerIdentityId)}.latest.json`);
}

export async function saveLatestCrossGraphAnalysis(
  ownerIdentityId: string,
  analysis: CrossGraphAnalysis,
) {
  await ensureAnalysisDir();
  const scopedAnalysis: CrossGraphAnalysis = {
    ...analysis,
    ownerIdentityId,
  };
  await writeFileAtomic(latestAnalysisPath(ownerIdentityId), JSON.stringify(scopedAnalysis, null, 2), "utf-8");
  return scopedAnalysis;
}

export async function getLatestCrossGraphAnalysis(ownerIdentityId: string): Promise<CrossGraphAnalysis | null> {
  try {
    const parsed = JSON.parse(await readFile(latestAnalysisPath(ownerIdentityId), "utf-8")) as CrossGraphAnalysis;
    return parsed.ownerIdentityId === ownerIdentityId ? parsed : null;
  } catch {
    return null;
  }
}
