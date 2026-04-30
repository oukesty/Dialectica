import { readFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { writeFileAtomic } from "@/lib/atomic-file";

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  action: string;
  actorId: string;
  actorName: string;
  projectId?: string;
  details: string;
}

const auditRoot = path.join(process.cwd(), "data", "audit");

async function ensureDir() {
  try { await mkdir(auditRoot, { recursive: true }); } catch { /* exists */ }
}

function logFile(projectId?: string) {
  return path.join(auditRoot, projectId ? `${projectId}.json` : "global.json");
}

export async function appendAuditLog(entry: Omit<AuditLogEntry, "id" | "timestamp">) {
  await ensureDir();
  const full: AuditLogEntry = {
    ...entry,
    id: `audit_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
  };
  const file = logFile(entry.projectId);
  let existing: AuditLogEntry[] = [];
  try {
    const raw = await readFile(file, "utf-8");
    existing = JSON.parse(raw) as AuditLogEntry[];
  } catch { /* new file */ }
  existing.push(full);
  // Keep last 500 entries per file
  if (existing.length > 500) existing = existing.slice(-500);
  await writeFileAtomic(file, JSON.stringify(existing, null, 2), "utf-8");
  return full;
}

export async function getAuditLog(projectId?: string): Promise<AuditLogEntry[]> {
  const file = logFile(projectId);
  try {
    const raw = await readFile(file, "utf-8");
    return (JSON.parse(raw) as AuditLogEntry[]).reverse();
  } catch {
    return [];
  }
}
