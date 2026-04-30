import { AppSettings } from "@/lib/types";
import { createDeepPatch, createSettingsPatchBase, SettingsPatch } from "@/lib/settings-update";

type SettingsResponse = {
  code?: string;
  error?: string;
  settings?: AppSettings;
  currentSettings?: AppSettings;
};

export class SettingsConflictError extends Error {
  currentSettings?: AppSettings;

  constructor(message: string, currentSettings?: AppSettings) {
    super(message);
    this.name = "SettingsConflictError";
    this.currentSettings = currentSettings;
  }
}

let latestSettingsSnapshot: AppSettings | null = null;

export function primeSettingsSnapshot(settings: AppSettings) {
  latestSettingsSnapshot = settings;
}

async function readSettingsResponse(response: Response) {
  const payload = (await response.json().catch(() => null)) as SettingsResponse | null;
  if (response.status === 409 && payload?.code === "conflict") {
    if (payload.currentSettings) {
      latestSettingsSnapshot = payload.currentSettings;
    }
    throw new SettingsConflictError(payload.error ?? "Settings changed in another tab.", payload.currentSettings);
  }
  if (!response.ok || !payload?.settings) {
    throw new Error(payload?.error ?? "Failed to update settings.");
  }
  latestSettingsSnapshot = payload.settings;
  return payload.settings;
}

export async function patchSettings(
  patch: SettingsPatch,
  options: { baseSettings?: AppSettings; base?: SettingsPatch } = {},
) {
  const baseSettings = options.baseSettings ?? latestSettingsSnapshot ?? undefined;
  const response = await fetch("/api/settings", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      patch,
      base: options.base ?? (baseSettings ? createSettingsPatchBase(baseSettings, patch) : undefined),
    }),
  });
  return readSettingsResponse(response);
}

export async function saveSettingsChanges(previous: AppSettings, next: AppSettings) {
  latestSettingsSnapshot = previous;
  const patch = createDeepPatch(previous, next);
  if (!patch) {
    latestSettingsSnapshot = previous;
    return previous;
  }
  return patchSettings(patch, { baseSettings: previous });
}
