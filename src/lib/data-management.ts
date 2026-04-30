import { bundledSampleProjectIds } from "@/data/samples";
import { appSettingsSchema, discussionProjectSchema } from "@/lib/schema";
import { AppSettings, DiscussionProject } from "@/lib/types";

export const FULL_BACKUP_KIND = "dialectica-full-backup";
export const FULL_BACKUP_VERSION = 3;

export type FullBackupPayload = {
  backupKind: typeof FULL_BACKUP_KIND;
  backupVersion: number;
  exportedAt: string;
  settings: AppSettings;
  projects: DiscussionProject[];
};

export type ParsedFullBackupPayload = {
  settings?: AppSettings;
  projects: DiscussionProject[];
  invalidProjectCount: number;
  skippedSampleProjectIds: string[];
};

export function buildFullBackupPayload(settings: AppSettings, projects: DiscussionProject[]): FullBackupPayload {
  return {
    backupKind: FULL_BACKUP_KIND,
    backupVersion: FULL_BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    settings,
    projects,
  };
}

export function buildRestoreSettings(currentSettings: AppSettings, backupSettings?: AppSettings): AppSettings {
  if (!backupSettings) {
    return currentSettings;
  }

  return appSettingsSchema.parse({
    ...backupSettings,
    profile: {
      ...backupSettings.profile,
      localIdentityId: currentSettings.profile.localIdentityId,
    },
  });
}

export function parseFullBackupPayload(raw: unknown): ParsedFullBackupPayload {
  const input = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const backupKind = typeof input.backupKind === "string" ? input.backupKind : undefined;
  const backupVersion = typeof input.backupVersion === "number" ? input.backupVersion : undefined;

  if (backupKind && backupKind !== FULL_BACKUP_KIND) {
    throw new Error("invalid-backup-kind");
  }

  if (backupVersion !== undefined && backupVersion < 2) {
    throw new Error("unsupported-backup-version");
  }

  const settings = input.settings === undefined ? undefined : appSettingsSchema.parse(input.settings);
  const rawProjects = Array.isArray(input.projects) ? input.projects : [];
  const projects: DiscussionProject[] = [];
  const skippedSampleProjectIds: string[] = [];
  let invalidProjectCount = 0;

  for (const rawProject of rawProjects) {
    const parsedProject = discussionProjectSchema.safeParse(rawProject);
    if (!parsedProject.success) {
      invalidProjectCount += 1;
      continue;
    }
    if (bundledSampleProjectIds.has(parsedProject.data.id)) {
      skippedSampleProjectIds.push(parsedProject.data.id);
      continue;
    }
    projects.push(parsedProject.data);
  }

  return {
    settings,
    projects,
    invalidProjectCount,
    skippedSampleProjectIds,
  };
}
