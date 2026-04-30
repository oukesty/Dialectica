import { mkdir, readFile, readdir, unlink } from "node:fs/promises";
import path from "node:path";
import { cookies, headers } from "next/headers";
import { bundledSampleProjectIds, localizeBundledProject, sampleProjects } from "@/data/samples";
import { writeFileAtomic } from "@/lib/atomic-file";
import { resolveInitialLocaleFromAcceptLanguage } from "@/lib/i18n";
import { normalizeSummaryAutomationConfig, normalizeSummaryAutomationMode } from "@/lib/ai/summary-automation";
import {
  buildUntitledProjectTitle,
  createDefaultGoal,
  createDefaultSettings,
  createDiscussionRoom,
  createEmptyInsights,
  createEmptySummary,
  createParticipantPresence,
  createProviderRuntimeMap,
  createProviderSnapshot,
  createRoomAiConfig,
  resolveProfileDisplayName,
} from "@/lib/factories";
import { exportProject as buildExport, importProject as parseImport } from "@/lib/import-export";
import { normalizeAvatarPreset, sanitizeAvatarDataUrl } from "@/lib/avatar";
import { createLocalIdentityId, LOCAL_IDENTITY_COOKIE } from "@/lib/local-identity";
import { appSettingsSchema, discussionProjectSchema } from "@/lib/schema";
import { getProvider } from "@/lib/providers/registry";
import { mergeDeep, SettingsPatch } from "@/lib/settings-update";
import { sanitizeThemeCustomization } from "@/lib/theme";
import { getProviderDescriptor, normalizeProviderModel } from "@/lib/providers/provider-catalog";
import { syncRoomFromParticipants } from "@/lib/rooms/sync";
import {
  APP_LOCALES,
  PROJECT_SCENARIOS,
  AppLocale,
  AppSettings,
  DashboardProjectSummary,
  DiscussionProject,
  ExportFormat,
  ImportPayload,
  Participant,
  ProjectListItem,
  ProviderId,
  ProviderRuntimeConfig,
  PROVIDER_IDS,
  WORKSPACE_DEFAULT_TABS,
} from "@/lib/types";

export { syncRoomFromParticipants } from "@/lib/rooms/sync";
import { clamp, createId, createScopedId, isSafeHttpUrl, normalizeAvatarLabel, normalizeText, pickInitials, sanitizeOptionalText } from "@/lib/utils";
import { normalizeParticipantRoster } from "@/lib/participants";

const dataRoot = path.join(process.cwd(), "data");
const projectRoot = path.join(dataRoot, "projects");
const profileRoot = path.join(dataRoot, "profiles");
const providerSecretRoot = path.join(dataRoot, "provider-secrets");
const collaborationRoot = path.join(dataRoot, "collaboration");
const settingsFile = path.join(dataRoot, "settings.json");
const legacyRepositoryPlaceholders = new Set(["https://github.com/your-org/dialectica"]);
const SAFE_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

function assertSafeId(id: string, label = "id"): void {
  if (!id || !SAFE_ID_PATTERN.test(id)) {
    throw new Error(`Invalid ${label}: contains disallowed characters`);
  }
}
const PROJECT_ANALYSIS_CACHE_TTL_MS = 6000;
const ASSISTANT_PENDING_DELETION_TTL_MS = 1000 * 60 * 60 * 24 * 30;
const ASSISTANT_EMPTY_SESSION_TTL_MS = 1000 * 60 * 60 * 24;
const ASSISTANT_SESSION_CLEANUP_DAY_OPTIONS = [30, 90, 180, 365] as const;
const analyzedProjectCache = new Map<string, { expiresAt: number; project: DiscussionProject }>();
const PROJECT_WORKSPACE_SCENARIOS = PROJECT_SCENARIOS.filter((scenario) => scenario !== "ai-dialogue");

function isProjectWorkspaceScenario(value: unknown): value is Exclude<DiscussionProject["scenario"], "ai-dialogue"> {
  return typeof value === "string" && PROJECT_WORKSPACE_SCENARIOS.includes(value as Exclude<DiscussionProject["scenario"], "ai-dialogue">);
}

function normalizeProjectWorkspaceScenario(value: unknown): Exclude<DiscussionProject["scenario"], "ai-dialogue"> {
  return isProjectWorkspaceScenario(value) ? value : "discussion";
}

export class ReservedProjectIdError extends Error {
  projectId: string;

  constructor(projectId: string) {
    super("reserved-project-id");
    this.name = "ReservedProjectIdError";
    this.projectId = projectId;
  }
}

export function isReservedProjectIdError(error: unknown): error is ReservedProjectIdError {
  return error instanceof ReservedProjectIdError;
}

function assertWritableProjectId(projectId: string) {
  if (bundledSampleProjectIds.has(projectId)) {
    throw new ReservedProjectIdError(projectId);
  }
}

function getProfileSettingsFile(profileId: string) {
  assertSafeId(profileId, "profileId");
  return path.join(profileRoot, `${profileId}.json`);
}

function getProfileSecretFile(profileId: string) {
  assertSafeId(profileId, "profileId");
  return path.join(providerSecretRoot, `${profileId}.json`);
}

async function ensureDirectories() {
  await Promise.all([
    mkdir(projectRoot, { recursive: true }),
    mkdir(profileRoot, { recursive: true }),
    mkdir(providerSecretRoot, { recursive: true }),
  ]);
}

async function safeRead(filePath: string) {
  return readFile(filePath, "utf-8");
}

async function removeFileIfExists(filePath: string) {
  try {
    await unlink(filePath);
  } catch (error) {
    if ((error as { code?: string }).code !== "ENOENT") {
      throw error;
    }
  }
}

function applyRequestedIdentity(settings: AppSettings, requestedIdentityId?: string) {
  if (!requestedIdentityId) {
    return ensureSettingsProfileFields(settings);
  }

  return ensureSettingsProfileFields({
    ...settings,
    profile: {
      ...settings.profile,
      localIdentityId: requestedIdentityId,
    },
  });
}

function createProfileDefaults(locale: AppLocale = "zh-CN", requestedIdentityId?: string) {
  const defaults = createDefaultSettings(locale);
  return applyRequestedIdentity(
    defaults,
    sanitizeOptionalText(requestedIdentityId, 120) || defaults.profile.localIdentityId || createLocalIdentityId(),
  );
}

async function readSettingsFileOrNull(filePath: string) {
  try {
    const raw = await safeRead(filePath);
    return ensureSettingsProfileFields(normalizeSettings(JSON.parse(raw)));
  } catch {
    return null;
  }
}


function sanitizeProviderSecretValue(value: unknown) {
  return sanitizeOptionalText(typeof value === "string" ? value : undefined, 240);
}

function maskProviderSecret(secret: string) {
  const trimmed = secret.trim();
  if (!trimmed) return "";
  if (trimmed.length <= 8) {
    return `${trimmed.slice(0, 2)}••••`;
  }
  return `${trimmed.slice(0, 3)}••••${trimmed.slice(-4)}`;
}

function sanitizeProviderSecretStore(raw: unknown) {
  const input = raw && typeof raw === "object" ? raw : {};
  const secrets = {} as Partial<Record<ProviderId, string>>;
  for (const providerId of PROVIDER_IDS) {
    const nextValue = sanitizeProviderSecretValue((input as Record<string, unknown>)[providerId]);
    if (nextValue) {
      secrets[providerId] = nextValue;
    }
  }
  return secrets;
}

async function readProviderSecretStore(profileId: string) {
  try {
    const raw = await safeRead(getProfileSecretFile(profileId));
    return sanitizeProviderSecretStore(JSON.parse(raw));
  } catch {
    return {} as Partial<Record<ProviderId, string>>;
  }
}

async function writeProviderSecretStore(profileId: string, secrets: Partial<Record<ProviderId, string>>) {
  const normalizedSecrets = sanitizeProviderSecretStore(secrets);
  if (Object.keys(normalizedSecrets).length === 0) {
    await removeFileIfExists(getProfileSecretFile(profileId));
    return normalizedSecrets;
  }
  await writeFileAtomic(getProfileSecretFile(profileId), `${JSON.stringify(normalizedSecrets, null, 2)}\n`, "utf-8");
  return normalizedSecrets;
}

function mergeProviderSecrets(settings: AppSettings, secrets: Partial<Record<ProviderId, string>>): AppSettings {
  return {
    ...settings,
    provider: {
      ...settings.provider,
      providers: Object.fromEntries(
        (Object.entries(settings.provider.providers) as [ProviderId, ProviderRuntimeConfig][]).map(([providerId, config]) => {
          const nextSecret = secrets[providerId] ?? "";
          return [
            providerId,
            {
              ...config,
              apiKey: nextSecret || config.apiKey,
              hasStoredApiKey: Boolean(nextSecret),
              maskedApiKey: nextSecret ? maskProviderSecret(nextSecret) : "",
              clearStoredApiKey: false,
            },
          ];
        }),
      ) as AppSettings["provider"]["providers"],
    },
  };
}

export function stripProviderSecretsForClient(settings: AppSettings, secrets: Partial<Record<ProviderId, string>> = {}): AppSettings {
  return {
    ...settings,
    provider: {
      ...settings.provider,
      providers: Object.fromEntries(
        (Object.entries(settings.provider.providers) as [ProviderId, ProviderRuntimeConfig][]).map(([providerId, config]) => {
          const storedSecret = secrets[providerId] ?? config.apiKey;
          return [
            providerId,
            {
              ...config,
              apiKey: "",
              hasStoredApiKey: Boolean(storedSecret),
              maskedApiKey: storedSecret ? maskProviderSecret(storedSecret) : "",
              clearStoredApiKey: false,
            },
          ];
        }),
      ) as AppSettings["provider"]["providers"],
    },
  };
}

function collectStoredProviderSecrets(settings: AppSettings, existingSecrets: Partial<Record<ProviderId, string>> = {}) {
  if (!settings.privacy.storeApiKeysLocally) {
    return {} as Partial<Record<ProviderId, string>>;
  }

  const nextSecrets = {} as Partial<Record<ProviderId, string>>;
  for (const providerId of PROVIDER_IDS) {
    const config = settings.provider.providers[providerId];
    const incomingSecret = sanitizeProviderSecretValue(config.apiKey);
    const shouldClear = Boolean(config.clearStoredApiKey);
    if (shouldClear) continue;
    if (incomingSecret) {
      nextSecrets[providerId] = incomingSecret;
      continue;
    }
    if (existingSecrets[providerId]) {
      nextSecrets[providerId] = existingSecrets[providerId] as string;
    }
  }
  return nextSecrets;
}

async function getRequestLocalIdentityId() {
  try {
    const store = await cookies();
    return sanitizeOptionalText(store.get(LOCAL_IDENTITY_COOKIE)?.value, 120) || null;
  } catch {
    return undefined;
  }
}

async function getRequestPreferredLocale(): Promise<AppLocale> {
  try {
    const requestHeaders = await headers();
    return resolveInitialLocaleFromAcceptLanguage(requestHeaders.get("accept-language"));
  } catch {
    return "en";
  }
}

function shouldSyncLocalIdentityParticipant(participant: Participant, previousSettings: AppSettings, nextSettings: AppSettings) {
  if (participant.profileOwnerId && participant.profileOwnerId === previousSettings.profile.localIdentityId) return true;
  if (participant.profileOwnerId && participant.profileOwnerId !== previousSettings.profile.localIdentityId) return false;
  if (participant.collaborationRole !== "host") return false;
  if ((participant.seatLabel ?? "").trim().toUpperCase() === "HOST") return true;
  return normalizeText(participant.name) === normalizeText(previousSettings.profile.displayName)
    && normalizeText(nextSettings.profile.displayName) !== normalizeText(participant.name);
}

async function syncLocalProfileAcrossProjects(previousSettings: AppSettings, nextSettings: AppSettings) {
  const files = await readdir(projectRoot).catch(() => []);

  for (const file of files.filter((fileName) => fileName.endsWith(".json"))) {
    const projectId = file.replace(/\.json$/, "");
    if (bundledSampleProjectIds.has(projectId)) continue;

    const raw = await safeRead(path.join(projectRoot, file));
    const project = normalizeProject(JSON.parse(raw), nextSettings.locale);
    let changed = false;
    const participants = project.participants.map((participant) => {
      if (!shouldSyncLocalIdentityParticipant(participant, previousSettings, nextSettings)) {
        return participant;
      }
      changed = true;
      return {
        ...participant,
        name: nextSettings.profile.displayName,
        profileOwnerId: nextSettings.profile.localIdentityId,
        avatarLabel: pickInitials(nextSettings.profile.displayName),
        avatarPreset: nextSettings.profile.avatarPreset,
        avatarImageDataUrl: sanitizeAvatarDataUrl(nextSettings.profile.avatarImageDataUrl),
      };
    });

    if (!changed) continue;

    const nextRoom = syncRoomFromParticipants(project, participants);
    if (nextRoom.aiConfig.ownerIdentityId === previousSettings.profile.localIdentityId) {
      nextRoom.aiConfig = {
        ...nextRoom.aiConfig,
        ownerIdentityId: nextSettings.profile.localIdentityId,
      };
    }

    await saveProjectFile({
      ...project,
      participants,
      room: nextRoom,
      updatedAt: new Date().toISOString(),
    });
  }
}

function isLocale(value: unknown): value is AppLocale {
  return typeof value === "string" && (APP_LOCALES as readonly string[]).includes(value);
}

function ensureSettingsProfileFields(settings: AppSettings): AppSettings {
  const defaults = createDefaultSettings(settings.locale);
  const resolvedProfileName = resolveProfileDisplayName(
    settings.locale,
    settings.profile?.displayName,
    (settings.profile as AppSettings["profile"] | undefined)?.displayNameIsDefault,
  );
  return {
    ...settings,
    profile: {
      ...defaults.profile,
      ...settings.profile,
      localIdentityId: sanitizeOptionalText(settings.profile?.localIdentityId, 120) || defaults.profile.localIdentityId,
      displayName: resolvedProfileName.displayName,
      displayNameIsDefault: resolvedProfileName.displayNameIsDefault,
      avatarPreset: normalizeAvatarPreset(settings.profile?.avatarPreset, resolvedProfileName.displayName || defaults.profile.displayName),
      avatarImageDataUrl: sanitizeAvatarDataUrl(settings.profile?.avatarImageDataUrl),
    },
  };
}

function sanitizeSettingsForStorage(settings: AppSettings): AppSettings {
  const profiled = ensureSettingsProfileFields(settings);
  const providers = Object.fromEntries(
    Object.entries(profiled.provider.providers).map(([providerId, config]) => [
      providerId,
      {
        ...config,
        apiKey: "",
        hasStoredApiKey: false,
        maskedApiKey: "",
        clearStoredApiKey: false,
      },
    ]),
  ) as AppSettings["provider"]["providers"];

  return {
    ...profiled,
    provider: {
      ...profiled.provider,
      providers,
    },
  };
}

function sanitizeSavedThemes(raw: unknown): AppSettings["appearancePreferences"]["savedThemes"] {
  const list = Array.isArray(raw) ? raw : [];
  const seen = new Set<string>();
  return list
    .map((item, index) => {
      const candidate = (item && typeof item === "object" ? item : {}) as {
        id?: unknown;
        name?: unknown;
        customTheme?: unknown;
        updatedAt?: unknown;
      };
      const name = sanitizeOptionalText(typeof candidate.name === "string" ? candidate.name : undefined, 48) || `Theme ${index + 1}`;
      const id = sanitizeOptionalText(typeof candidate.id === "string" ? candidate.id : undefined, 64) || createId("theme");
      const dedupeKey = `${name.toLowerCase()}::${id}`;
      if (seen.has(dedupeKey)) return null;
      seen.add(dedupeKey);
      return {
        id,
        name,
        customTheme: sanitizeThemeCustomization(candidate.customTheme),
        updatedAt: sanitizeOptionalText(typeof candidate.updatedAt === "string" ? candidate.updatedAt : undefined, 80) || new Date().toISOString(),
      } satisfies AppSettings["appearancePreferences"]["savedThemes"][number];
    })
    .filter((theme): theme is AppSettings["appearancePreferences"]["savedThemes"][number] => Boolean(theme))
    .slice(0, 6);
}

function sanitizeStringRecord(raw: unknown, valueMaxLength: number, keyMaxLength = 160) {
  const input = raw && typeof raw === "object" ? raw : {};
  const next: Record<string, string> = {};

  for (const [key, value] of Object.entries(input)) {
    const sanitizedKey = sanitizeOptionalText(key, keyMaxLength);
    const sanitizedValue = sanitizeOptionalText(typeof value === "string" ? value : undefined, valueMaxLength);
    if (sanitizedKey && sanitizedValue) {
      next[sanitizedKey] = sanitizedValue;
    }
  }

  return next;
}

function sanitizeTagColors(raw: unknown): AppSettings["tagColors"] {
  const input = raw && typeof raw === "object" ? raw : {};
  const next: AppSettings["tagColors"] = {};

  for (const [tag, color] of Object.entries(input)) {
    const sanitizedTag = sanitizeOptionalText(tag, 80);
    const sanitizedColor = sanitizeOptionalText(typeof color === "string" ? color : undefined, 7);
    if (sanitizedTag && sanitizedColor && /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(sanitizedColor)) {
      next[sanitizedTag] = sanitizedColor;
    }
  }

  return next;
}

function sanitizeStringList(raw: unknown, itemMaxLength: number, maxItems: number): string[] {
  const list = Array.isArray(raw) ? raw : [];
  return list
    .map((item) => sanitizeOptionalText(typeof item === "string" ? item : undefined, itemMaxLength))
    .filter((item): item is string => Boolean(item))
    .slice(0, maxItems);
}

function sanitizeProjectOrder(raw: unknown): AppSettings["projectOrder"] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const id of sanitizeStringList(raw, 120, 400)) {
    if (seen.has(id)) continue;
    seen.add(id);
    ordered.push(id);
  }
  return ordered;
}

function sanitizeSavedTemplates(raw: unknown): AppSettings["savedTemplates"] {
  const list = Array.isArray(raw) ? raw : [];
  const seen = new Set<string>();

  return list
    .map<AppSettings["savedTemplates"][number] | null>((item, index) => {
      const candidate = item && typeof item === "object" ? item as Record<string, unknown> : {};
      const id = sanitizeOptionalText(typeof candidate.id === "string" ? candidate.id : undefined, 80) || createId("template");
      if (seen.has(id)) return null;
      seen.add(id);
      return {
        id,
        name: sanitizeOptionalText(typeof candidate.name === "string" ? candidate.name : undefined, 120) || `Template ${index + 1}`,
        scenario: normalizeProjectWorkspaceScenario(
          sanitizeOptionalText(typeof candidate.scenario === "string" ? candidate.scenario : undefined, 64),
        ),
        description: sanitizeOptionalText(typeof candidate.description === "string" ? candidate.description : undefined, 600) || "",
        goal: sanitizeOptionalText(typeof candidate.goal === "string" ? candidate.goal : undefined, 400) || "",
        tags: sanitizeStringList(candidate.tags, 40, 16),
        savedAt: sanitizeOptionalText(typeof candidate.savedAt === "string" ? candidate.savedAt : undefined, 80) || new Date().toISOString(),
      };
    })
    .filter((template): template is AppSettings["savedTemplates"][number] => template !== null)
    .slice(0, 60);
}

function sanitizeAiPreferences(raw: unknown, defaults: AppSettings["aiPreferences"]): AppSettings["aiPreferences"] {
  const input = raw && typeof raw === "object" ? raw as Partial<AppSettings["aiPreferences"]> : {};
  const replyLanguage = input.replyLanguage === "auto" || isLocale(input.replyLanguage)
    ? input.replyLanguage
    : defaults.replyLanguage;
  const aiRole = typeof input.aiRole === "string" && ["assistant", "moderator", "note-taker", "debate-judge"].includes(input.aiRole)
    ? input.aiRole
    : defaults.aiRole;
  const responseLength = typeof input.responseLength === "string" && ["brief", "standard", "detailed"].includes(input.responseLength)
    ? input.responseLength
    : defaults.responseLength;

  return {
    replyLanguage,
    aiRole,
    responseLength,
    focusTopics: sanitizeOptionalText(input.focusTopics, 240) || "",
    autoTagging: input.autoTagging ?? defaults.autoTagging,
  };
}

function sanitizeEmailNotifications(raw: unknown, defaults: AppSettings["emailNotifications"]): AppSettings["emailNotifications"] {
  const input = raw && typeof raw === "object" ? raw as Partial<AppSettings["emailNotifications"]> : {};
  return {
    enabled: input.enabled ?? defaults.enabled,
    emailAddress: sanitizeOptionalText(input.emailAddress, 160) || "",
    onNewMember: input.onNewMember ?? defaults.onNewMember,
    onAiSummary: input.onAiSummary ?? defaults.onAiSummary,
    onRoomArchived: input.onRoomArchived ?? defaults.onRoomArchived,
  };
}

function sanitizeAssistantSessionCleanup(
  raw: unknown,
  defaults: AppSettings["privacy"]["assistantSessionCleanup"],
): AppSettings["privacy"]["assistantSessionCleanup"] {
  const input = raw && typeof raw === "object"
    ? raw as Partial<AppSettings["privacy"]["assistantSessionCleanup"]>
    : {};
  const requestedDays = Number(input.maxIdleDays);
  const maxIdleDays = ASSISTANT_SESSION_CLEANUP_DAY_OPTIONS.includes(requestedDays as (typeof ASSISTANT_SESSION_CLEANUP_DAY_OPTIONS)[number])
    ? requestedDays as AppSettings["privacy"]["assistantSessionCleanup"]["maxIdleDays"]
    : defaults.maxIdleDays;
  return {
    enabled: input.enabled ?? defaults.enabled,
    maxIdleDays,
  };
}

function normalizeSettings(raw: unknown): AppSettings {
  const defaults = createDefaultSettings();
  const parsed = appSettingsSchema.safeParse(raw);

  const input = (parsed.success ? parsed.data : raw ?? {}) as Partial<AppSettings> & {
    provider?: Partial<AppSettings["provider"]> & { providers?: Partial<Record<ProviderId, Partial<ProviderRuntimeConfig>>> };
  };
  const runtimeMap = createProviderRuntimeMap();
  const mergedProviders = { ...runtimeMap };

  for (const providerId of Object.keys(mergedProviders) as ProviderId[]) {
    const candidate = input.provider?.providers?.[providerId];
    const descriptor = getProviderDescriptor(providerId);
    if (!descriptor) continue;
    const nextModel = normalizeProviderModel(providerId, candidate?.model ?? mergedProviders[providerId].model);
    mergedProviders[providerId] = {
      ...mergedProviders[providerId],
      ...candidate,
      providerId,
      mode: descriptor.mode,
      model: nextModel,
      streaming: descriptor.capabilities.streaming,
      testState: candidate?.testState ?? mergedProviders[providerId].testState,
    };
  }

  const requestedActiveProviderId = input.provider?.activeProviderId;
  const activeProviderId = typeof requestedActiveProviderId === "string" && getProviderDescriptor(requestedActiveProviderId as ProviderId)
    ? (requestedActiveProviderId as ProviderId)
    : defaults.provider.activeProviderId;

  const normalized: AppSettings = {
    ...defaults,
    ...input,
    locale: isLocale(input.locale) ? input.locale : defaults.locale,
    theme: input.theme ?? defaults.theme,
    datetimeFormat: input.datetimeFormat ?? defaults.datetimeFormat,
    defaultScenario: normalizeProjectWorkspaceScenario(input.defaultScenario),
    profile: {
      ...defaults.profile,
      ...input.profile,
    },
    appearancePreferences: {
      ...defaults.appearancePreferences,
      ...input.appearancePreferences,
      customTheme: sanitizeThemeCustomization(input.appearancePreferences?.customTheme ?? defaults.appearancePreferences.customTheme),
      customThemeName: sanitizeOptionalText(input.appearancePreferences?.customThemeName, 48) || defaults.appearancePreferences.customThemeName,
      savedThemes: sanitizeSavedThemes(input.appearancePreferences?.savedThemes),
    },
    provider: {
      ...defaults.provider,
      ...input.provider,
      activeProviderId,
      activeMode: mergedProviders[activeProviderId].mode,
      descriptors: defaults.provider.descriptors,
      providers: mergedProviders,
      mockEmphasis: input.provider?.mockEmphasis ?? defaults.provider.mockEmphasis,
      autoSummary: input.provider?.autoSummary ?? defaults.provider.autoSummary,
      autoEvaluation: input.provider?.autoEvaluation ?? defaults.provider.autoEvaluation,
      enableStreaming: input.provider?.enableStreaming ?? defaults.provider.enableStreaming,
      requestTimeoutMs: input.provider?.requestTimeoutMs ?? defaults.provider.requestTimeoutMs,
      preferServerKeys: input.provider?.preferServerKeys ?? defaults.provider.preferServerKeys,
      allowFallbackToScaffold: input.provider?.allowFallbackToScaffold ?? defaults.provider.allowFallbackToScaffold,
    },
    discussionPreferences: {
      ...defaults.discussionPreferences,
      ...input.discussionPreferences,
    },
    collaborationPreferences: {
      ...defaults.collaborationPreferences,
      ...input.collaborationPreferences,
    },
    knowledgePreferences: {
      ...defaults.knowledgePreferences,
      ...input.knowledgePreferences,
      defaultGraphMode:
        input.knowledgePreferences?.defaultGraphMode === "2d"
        || input.knowledgePreferences?.defaultGraphMode === "3d"
        || input.knowledgePreferences?.defaultGraphMode === "both"
          ? input.knowledgePreferences.defaultGraphMode
          : defaults.knowledgePreferences.defaultGraphMode,
      graphOutputLanguage:
        input.knowledgePreferences?.graphOutputLanguage === "auto" || isLocale(input.knowledgePreferences?.graphOutputLanguage)
          ? input.knowledgePreferences?.graphOutputLanguage
          : defaults.knowledgePreferences.graphOutputLanguage,
      autoExtractOnSave: false,
      autoExtractAfterAiTask: false,
      autoGenerateGraphLinks: false,
    },
    aiPreferences: sanitizeAiPreferences(input.aiPreferences, defaults.aiPreferences),
    uploadPreferences: {
      ...defaults.uploadPreferences,
      ...input.uploadPreferences,
    },
    participantNicknames: sanitizeStringRecord(input.participantNicknames, 80),
    tagColors: sanitizeTagColors(input.tagColors),
    customShortcuts: sanitizeStringRecord(input.customShortcuts, 48, 80),
    quickReplies: sanitizeStringList(input.quickReplies, 240, 20),
    projectOrder: sanitizeProjectOrder(input.projectOrder),
    savedTemplates: sanitizeSavedTemplates(input.savedTemplates),
    emailNotifications: sanitizeEmailNotifications(input.emailNotifications, defaults.emailNotifications),
    privacy: {
      ...defaults.privacy,
      ...input.privacy,
      assistantSessionCleanup: sanitizeAssistantSessionCleanup(input.privacy?.assistantSessionCleanup, defaults.privacy.assistantSessionCleanup),
    },
    about: {
      ...defaults.about,
      ...input.about,
    },
  };

  normalized.discussionPreferences.defaultWorkspaceTab = (WORKSPACE_DEFAULT_TABS as readonly string[]).includes(normalized.discussionPreferences.defaultWorkspaceTab)
    ? normalized.discussionPreferences.defaultWorkspaceTab
    : defaults.discussionPreferences.defaultWorkspaceTab;
  normalized.discussionPreferences.singleUserAutoSummaryThreshold = clamp(Number(normalized.discussionPreferences.singleUserAutoSummaryThreshold || defaults.discussionPreferences.singleUserAutoSummaryThreshold), 5, 100);
  normalized.discussionPreferences.multiUserAutoSummaryThreshold = clamp(Number(normalized.discussionPreferences.multiUserAutoSummaryThreshold || defaults.discussionPreferences.multiUserAutoSummaryThreshold), 5, 100);
  normalized.discussionPreferences.assistiveSummaryThreshold = clamp(Number(normalized.discussionPreferences.assistiveSummaryThreshold || defaults.discussionPreferences.assistiveSummaryThreshold), 5, 100);
  normalized.discussionPreferences.latestAiHistoryMode = normalized.discussionPreferences.latestAiHistoryMode === "latest-only" ? "latest-only" : "retain";
  normalized.discussionPreferences.latestAiHistoryLimit = clamp(Number(normalized.discussionPreferences.latestAiHistoryLimit || defaults.discussionPreferences.latestAiHistoryLimit), 1, 50);
  normalized.discussionPreferences.summaryHistoryRetentionMode = normalized.discussionPreferences.summaryHistoryRetentionMode === "capped" ? "capped" : "unlimited";
  normalized.discussionPreferences.summaryHistoryRetentionLimit = clamp(Number(normalized.discussionPreferences.summaryHistoryRetentionLimit || defaults.discussionPreferences.summaryHistoryRetentionLimit), 1, 100);
  normalized.collaborationPreferences.defaultTransport = "local-mock";
  normalized.collaborationPreferences.eventHistoryLimit = clamp(Number(normalized.collaborationPreferences.eventHistoryLimit || defaults.collaborationPreferences.eventHistoryLimit), 10, 400);
  normalized.collaborationPreferences.defaultMemberRole = normalized.collaborationPreferences.defaultMemberRole ?? defaults.collaborationPreferences.defaultMemberRole;
  normalized.collaborationPreferences.notificationsEnabled = normalized.collaborationPreferences.notificationsEnabled ?? defaults.collaborationPreferences.notificationsEnabled;
  normalized.collaborationPreferences.notificationDoNotDisturb = normalized.collaborationPreferences.notificationDoNotDisturb ?? defaults.collaborationPreferences.notificationDoNotDisturb;
  const resolvedProfileName = resolveProfileDisplayName(
    normalized.locale,
    sanitizeOptionalText(normalized.profile.displayName, 80),
    normalized.profile.displayNameIsDefault,
  );
  normalized.profile.displayName = resolvedProfileName.displayName;
  normalized.profile.displayNameIsDefault = resolvedProfileName.displayNameIsDefault;
  normalized.profile.avatarPreset = normalizeAvatarPreset(normalized.profile.avatarPreset, normalized.profile.displayName);
  normalized.profile.avatarImageDataUrl = sanitizeAvatarDataUrl(normalized.profile.avatarImageDataUrl);
  normalized.appearancePreferences.customTheme = sanitizeThemeCustomization(normalized.appearancePreferences.customTheme);
  normalized.appearancePreferences.customThemeName = sanitizeOptionalText(normalized.appearancePreferences.customThemeName, 48) || defaults.appearancePreferences.customThemeName;
  normalized.appearancePreferences.savedThemes = sanitizeSavedThemes(normalized.appearancePreferences.savedThemes);
  normalized.provider.providers = Object.fromEntries(
    (Object.entries(normalized.provider.providers) as [ProviderId, ProviderRuntimeConfig][]).map(([providerId, config]) => {
      const fallback = defaults.provider.providers[providerId];
      const descriptor = getProviderDescriptor(providerId);
      const baseUrl = sanitizeOptionalText(config.baseUrl, 240);
      return [
        providerId,
        {
          ...config,
          mode: descriptor?.mode ?? fallback.mode,
          model: normalizeProviderModel(providerId, sanitizeOptionalText(config.model, 120) || fallback.model),
          apiKey: sanitizeOptionalText(config.apiKey, 240),
          baseUrl: baseUrl.startsWith("local://") || isSafeHttpUrl(baseUrl) ? baseUrl : fallback.baseUrl,
          organization: sanitizeOptionalText(config.organization, 120),
          notes: sanitizeOptionalText(config.notes, 240),
          streaming: descriptor?.capabilities.streaming ?? fallback.streaming,
          hasStoredApiKey: Boolean(config.hasStoredApiKey),
          maskedApiKey: sanitizeOptionalText(config.maskedApiKey, 32),
          clearStoredApiKey: Boolean(config.clearStoredApiKey),
        },
      ];
    }),
  ) as AppSettings["provider"]["providers"];
  normalized.provider.activeMode = normalized.provider.providers[normalized.provider.activeProviderId].mode;
  normalized.about.projectName = sanitizeOptionalText(normalized.about.projectName, 80) || defaults.about.projectName;
  normalized.about.version = sanitizeOptionalText(normalized.about.version, 40) || defaults.about.version;
  normalized.about.license = sanitizeOptionalText(normalized.about.license, 80) || defaults.about.license;
  normalized.about.repositoryUrl = isSafeHttpUrl(normalized.about.repositoryUrl) && !legacyRepositoryPlaceholders.has(normalized.about.repositoryUrl)
    ? normalized.about.repositoryUrl
    : defaults.about.repositoryUrl;

  return appSettingsSchema.parse(normalized);
}

function normalizeParticipants(project: Partial<DiscussionProject>, locale: AppLocale) {
  const participants = Array.isArray(project.participants) ? project.participants : [];
  const sessionId = typeof project.room?.session?.id === "string" ? project.room.session.id : createId("session");

  return normalizeParticipantRoster(
    participants.map((participant, index) => {
      const name = participant?.name || (
        locale === "zh-CN"
          ? `参与者 ${index + 1}`
          : locale === "ja"
            ? `参加者 ${index + 1}`
            : locale === "ko"
              ? `참여자 ${index + 1}`
              : locale === "fr"
                ? `Participant ${index + 1}`
                : locale === "ru"
                  ? `Участник ${index + 1}`
                  : `Participant ${index + 1}`
      );
      const role = participant?.role ?? "speaker";
      const collaborationRole = participant?.collaborationRole ?? (index === 0 ? "host" : role === "observer" ? "observer" : "participant");

      return {
        id: participant?.id ?? createId("participant"),
        name,
        role,
        collaborationRole,
        customRoleLabel: participant?.customRoleLabel,
        stance: participant?.stance ?? "",
        color: participant?.color ?? ["#b45309", "#1d4ed8", "#0f766e", "#7c3aed"][index % 4],
        bio: participant?.bio ?? "",
        profileOwnerId: sanitizeOptionalText(participant?.profileOwnerId, 120),
        avatarLabel: normalizeAvatarLabel(participant?.avatarLabel ?? "") || pickInitials(name),
        avatarPreset: normalizeAvatarPreset(participant?.avatarPreset, name),
        avatarImageDataUrl: sanitizeAvatarDataUrl(participant?.avatarImageDataUrl),
        seatLabel: participant?.seatLabel,
        presence: participant?.presence ?? createParticipantPresence(sessionId, index === 0 ? "online" : "offline"),
      } satisfies Participant;
    }),
  );
}

function normalizeProject(raw: unknown, preferredLocale?: AppLocale): DiscussionProject {
  const parsed = discussionProjectSchema.safeParse(raw);
  const input = (parsed.success ? parsed.data : raw ?? {}) as Partial<DiscussionProject>;
  const locale = isLocale(input.language) ? input.language : preferredLocale ?? "en";
  const scenario = input.scenario ?? "discussion";
  const goal = input.goal ?? createDefaultGoal(locale, scenario);
  const participants = normalizeParticipants(input, locale);
  const generatedRoom = createDiscussionRoom(locale, goal, participants);
  const mergedRoom = input.room
    ? {
        ...generatedRoom,
        ...input.room,
        session: {
          ...generatedRoom.session,
          ...input.room.session,
          goal: input.room.session?.goal ?? goal,
        },
      }
    : generatedRoom;
  const normalizedProviderSnapshot = {
    providerId: typeof input.providerSnapshot?.providerId === "string" && getProviderDescriptor(input.providerSnapshot.providerId as ProviderId)
      ? (input.providerSnapshot.providerId as ProviderId)
      : "mock",
    model: normalizeProviderModel(
      typeof input.providerSnapshot?.providerId === "string" && getProviderDescriptor(input.providerSnapshot.providerId as ProviderId)
        ? (input.providerSnapshot.providerId as ProviderId)
        : "mock",
      input.providerSnapshot?.model ?? "rule-balanced-v1",
    ),
    generatedAt: input.providerSnapshot?.generatedAt ?? new Date().toISOString(),
    version: input.providerSnapshot?.version ?? "migrated",
  } satisfies DiscussionProject["providerSnapshot"];
  const room = syncRoomFromParticipants({
    participants,
    providerSnapshot: normalizedProviderSnapshot,
    room: mergedRoom,
  }, participants);

  const entries = Array.isArray(input.entries) ? input.entries : [];
  const normalizedEntries = entries.map((entry) => ({
    id: entry.id ?? createId("entry"),
    participantId: entry.participantId ?? participants[0]?.id ?? createId("participant"),
    ownerParticipantId: entry.ownerParticipantId ?? entry.participantId ?? participants[0]?.id ?? createId("participant"),
    roomId: entry.roomId ?? room.id,
    sessionId: entry.sessionId ?? room.session.id,
    occurredAt: entry.occurredAt ?? new Date().toISOString(),
    content: entry.content ?? "",
    tags: entry.tags ?? [],
    kind: entry.kind ?? "statement",
    highlighted: entry.highlighted ?? false,
    linkedNodeIds: entry.linkedNodeIds ?? [],
    relatedEntryIds: entry.relatedEntryIds ?? [],
    source: entry.source ?? "manual",
    syncState: entry.syncState ?? "synced",
  }));

  const emptySummary = createEmptySummary(locale);
  const summary = {
    ...emptySummary,
    ...input.summary,
    evaluation: {
      ...emptySummary.evaluation,
      ...input.summary?.evaluation,
    },
    history: input.summary?.history ?? emptySummary.history,
  };

  const normalized: DiscussionProject = {
    id: input.id ?? createId("project"),
    title: input.title ?? buildUntitledProjectTitle(locale),
    description: input.description ?? "",
    scenario,
    language: locale,
    createdAt: input.createdAt ?? new Date().toISOString(),
    updatedAt: input.updatedAt ?? new Date().toISOString(),
    status: input.status ?? "active",
    goal,
    tags: input.tags ?? [],
    participants,
    entries: normalizedEntries,
    nodes: input.nodes ?? [],
    relations: input.relations ?? [],
    insights: input.insights ?? createEmptyInsights(new Date().toISOString()),
    summary,
    room,
    providerSnapshot: normalizedProviderSnapshot,
    metadata: {
      isSample: input.metadata?.isSample ?? false,
      source: input.metadata?.source ?? "migrated",
      sampleKey: input.metadata?.sampleKey,
      createdByIdentityId: input.metadata?.createdByIdentityId
        ?? participants.find((participant) => participant.collaborationRole === "host")?.profileOwnerId
        ?? room.aiConfig.ownerIdentityId,
      archivedAt: input.metadata?.archivedAt,
      pendingDeletionAt: input.metadata?.pendingDeletionAt,
      lastActiveAt: input.metadata?.lastActiveAt ?? input.updatedAt ?? input.createdAt,
    },
  };

  return discussionProjectSchema.parse(normalized);
}

function syncProjectLifecycle(project: DiscussionProject, settings: AppSettings): DiscussionProject {
  const hasActivePresence = project.room.presence.some((presence) => presence.active);
  const room = {
    ...project.room,
    autoSummary: project.room.autoSummary ?? settings.provider.autoSummary,
    autoEvaluation: project.room.autoEvaluation ?? settings.provider.autoEvaluation,
    session: {
      ...project.room.session,
      sync: {
        ...project.room.session.sync,
        transport: project.room.session.sync.transport || settings.collaborationPreferences.defaultTransport,
      },
    },
  };

  if (settings.collaborationPreferences.sessionAutoStart && room.session.status === "scheduled" && hasActivePresence) {
    room.session.status = "live";
  }

  if (settings.collaborationPreferences.sessionAutoArchive && !hasActivePresence && ["live", "paused"].includes(room.session.status)) {
    room.session.status = "closed";
  }

  const nextStatus = project.metadata.archivedAt
    ? "archived"
    : room.session.status === "closed"
      ? "completed"
      : "active";

  return {
    ...project,
    status: nextStatus,
    room,
  };
}

function applyCreationDefaults(project: DiscussionProject, settings: AppSettings, locale: AppLocale): DiscussionProject {
  const activeProviderId = settings.provider.activeProviderId;
  const runtime = settings.provider.providers[activeProviderId] ?? createProviderRuntimeMap()[activeProviderId];
  const goal = project.goal || createDefaultGoal(locale, project.scenario);
  const participants = [...project.participants];
  const isSingleUserAiWorkspace = project.scenario === "ai-dialogue" && participants.length <= 1;
  const defaultAutomationMode: "basic" = "basic";
  const defaultSummaryThreshold = isSingleUserAiWorkspace
    ? settings.discussionPreferences.singleUserAutoSummaryThreshold
    : settings.discussionPreferences.multiUserAutoSummaryThreshold;

  if (!project.metadata.isSample && !participants.some((participant) => participant.profileOwnerId === settings.profile.localIdentityId)) {
    const bindIndex = participants.findIndex((participant) => participant.collaborationRole === "host" && !participant.profileOwnerId);
    const fallbackIndex = participants.findIndex((participant) => !participant.profileOwnerId);
    const targetIndex = bindIndex >= 0 ? bindIndex : fallbackIndex;
    if (targetIndex >= 0) {
      participants[targetIndex] = {
        ...participants[targetIndex],
        name: settings.profile.displayName,
        profileOwnerId: settings.profile.localIdentityId,
        avatarLabel: pickInitials(settings.profile.displayName),
        avatarPreset: settings.profile.avatarPreset,
        avatarImageDataUrl: sanitizeAvatarDataUrl(settings.profile.avatarImageDataUrl),
      };
    }
  }

  const hostParticipantId = participants.find((participant) => participant.collaborationRole === "host")?.id
    ?? participants.find((participant) => participant.role === "moderator")?.id
    ?? participants[0]?.id;
  const room = createDiscussionRoom(locale, goal, participants, {
    visibility: settings.collaborationPreferences.defaultVisibility,
    transport: settings.collaborationPreferences.defaultTransport,
    autoSummary: settings.provider.autoSummary,
    autoEvaluation: settings.provider.autoEvaluation,
    sessionAutoStart: settings.collaborationPreferences.sessionAutoStart,
    aiConfig: createRoomAiConfig(activeProviderId, runtime.model, {
      ownerIdentityId: settings.profile.localIdentityId,
      ownerParticipantId: hostParticipantId,
      updatedByParticipantId: hostParticipantId,
    }),
  });

  const providerSnapshot = project.providerSnapshot?.providerId && project.providerSnapshot?.model
    ? project.providerSnapshot
    : createProviderSnapshot(activeProviderId, runtime.model, project.metadata.isSample ? project.providerSnapshot.version : "settings-default", project.providerSnapshot.generatedAt);
  const defaultAutomation = room.aiAutomation;
  const normalizedAutomation = normalizeSummaryAutomationConfig(project.room.aiAutomation ?? defaultAutomation);
  const hasExplicitAutomationMode = typeof project.room.aiAutomation?.mode === "string";
  const rawResolvedAutomationMode = hasExplicitAutomationMode
    ? normalizeSummaryAutomationMode(project.room.aiAutomation?.mode)
    : defaultAutomationMode;
  const resolvedAutomationMode = isSingleUserAiWorkspace && rawResolvedAutomationMode === "assistive"
    ? "basic"
    : rawResolvedAutomationMode;
  const resolvedSummaryThreshold = project.room.aiAutomation?.summaryThreshold
    ?? (resolvedAutomationMode === "assistive"
      ? settings.discussionPreferences.assistiveSummaryThreshold
      : defaultSummaryThreshold);
  const resolvedCurrentThreshold = project.room.aiAutomation?.summaryCurrentThreshold
    ?? resolvedSummaryThreshold;

  const mergedRoom = {
    ...room,
    ...project.room,
    visibility: project.room.visibility || settings.collaborationPreferences.defaultVisibility,
    autoSummary: project.room.autoSummary ?? settings.provider.autoSummary,
    autoEvaluation: project.room.autoEvaluation ?? settings.provider.autoEvaluation,
    session: {
      ...room.session,
      ...project.room.session,
      goal: project.room.session.goal || goal,
      sync: {
        ...room.session.sync,
        ...project.room.session.sync,
        transport: project.room.session.sync.transport || settings.collaborationPreferences.defaultTransport,
      },
    },
    aiAutomation: {
      mode: resolvedAutomationMode,
      summaryThreshold: resolvedSummaryThreshold,
      summaryCurrentThreshold: resolvedAutomationMode === "assistive" ? resolvedCurrentThreshold : resolvedSummaryThreshold,
      summaryLastProcessedEntryCount: project.room.aiAutomation?.summaryLastProcessedEntryCount ?? normalizedAutomation.summaryLastProcessedEntryCount,
      autoReplyThreshold: resolvedSummaryThreshold,
      permissions: {
        ...(defaultAutomation?.permissions ?? { facilitatorCanManage: false, facilitatorCanTrigger: false }),
        ...project.room.aiAutomation?.permissions,
      },
    },
  };
  const syncedRoom = syncRoomFromParticipants({
    participants,
    providerSnapshot,
    room: mergedRoom,
  }, participants);

  return {
    ...project,
    participants,
    goal,
    room: syncedRoom,
    providerSnapshot,
  };
}

function shouldAutoAnalyze(project: DiscussionProject, settings: AppSettings) {
  if (!["mock", "disabled"].includes(project.room.aiConfig.providerId)) {
    return false;
  }

  if (project.metadata.isSample) {
    return false;
  }

  if (settings.privacy.analyticsMode !== "local-only") {
    return false;
  }

  return project.room.autoSummary || project.room.autoEvaluation || settings.provider.autoSummary || settings.provider.autoEvaluation;
}

async function saveProjectFile(project: DiscussionProject) {
  const validated = discussionProjectSchema.parse(project);
  assertWritableProjectId(validated.id);
  await writeFileAtomic(path.join(projectRoot, `${validated.id}.json`), `${JSON.stringify(validated, null, 2)}\n`, "utf-8");
}

function buildAnalysisCacheKey(project: DiscussionProject, settings: AppSettings, locale?: AppLocale) {
  const providerId = project.room.aiConfig?.providerId ?? project.providerSnapshot.providerId ?? settings.provider.activeProviderId;
  const runtimeConfig = settings.provider.providers[providerId] ?? createProviderRuntimeMap()[providerId];
  const model = normalizeProviderModel(
    providerId,
    project.room.aiConfig?.model ?? project.providerSnapshot.model ?? runtimeConfig.model,
  );

  return [
    locale ?? settings.locale ?? project.language,
    project.id,
    project.updatedAt,
    project.room.aiConfig.updatedAt,
    providerId,
    model,
    settings.provider.mockEmphasis,
    project.entries.length,
    project.nodes.length,
    project.relations.length,
  ].join("|");
}

async function analyzeProject(project: DiscussionProject, settings: AppSettings, locale?: AppLocale, options: { touchUpdatedAt?: boolean } = {}): Promise<DiscussionProject> {
  const providerId = project.room.aiConfig?.providerId ?? project.providerSnapshot.providerId ?? settings.provider.activeProviderId;
  const provider = getProvider(providerId);
  const runtimeConfig = settings.provider.providers[providerId] ?? createProviderRuntimeMap()[providerId];
  const model = normalizeProviderModel(
    providerId,
    project.room.aiConfig?.model ?? project.providerSnapshot.model ?? runtimeConfig.model,
  );
  const analysis = await provider.analyze(project, {
    locale: locale ?? settings.locale ?? project.language,
    emphasis: settings.provider.mockEmphasis,
    stage: "final-summary",
    goal: project.goal,
    providerConfig: {
      ...runtimeConfig,
      model,
    },
    requestTimeoutMs: settings.provider.requestTimeoutMs,
    preferServerKeys: settings.provider.preferServerKeys,
    allowFallbackToScaffold: settings.provider.allowFallbackToScaffold,
  });

  return {
    ...project,
    updatedAt: options.touchUpdatedAt ? new Date().toISOString() : project.updatedAt,
    insights: analysis.insights,
    summary: analysis.summary,
    providerSnapshot: analysis.providerSnapshot,
  };
}

async function maybeAnalyzeProject(project: DiscussionProject, settings: AppSettings, locale?: AppLocale, options: { touchUpdatedAt?: boolean } = {}): Promise<DiscussionProject> {
  const cacheKey = options.touchUpdatedAt ? "" : buildAnalysisCacheKey(project, settings, locale);
  if (cacheKey) {
    const cached = analyzedProjectCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.project;
    }
  }

  const nextProject = !shouldAutoAnalyze(project, settings)
    ? (options.touchUpdatedAt ? {
        ...project,
        updatedAt: new Date().toISOString(),
      } : project)
    : await analyzeProject(project, settings, locale, options);

  if (cacheKey) {
    analyzedProjectCache.set(cacheKey, {
      expiresAt: Date.now() + PROJECT_ANALYSIS_CACHE_TTL_MS,
      project: nextProject,
    });
  }

  return nextProject;
}
function isDashboardSummaryStatus(value: unknown): value is DashboardProjectSummary["status"] {
  return value === "active" || value === "archived" || value === "completed";
}

function isDashboardSummaryRoomStatus(value: unknown): value is DashboardProjectSummary["roomStatus"] {
  return value === "scheduled" || value === "live" || value === "paused" || value === "closed";
}

function isDashboardSummaryVisibility(value: unknown): value is DashboardProjectSummary["visibility"] {
  return value === "private" || value === "invite" || value === "public";
}

function isPendingDeletionMetadata(metadata: { pendingDeletionAt?: unknown } | undefined) {
  return typeof metadata?.pendingDeletionAt === "string" && metadata.pendingDeletionAt.length > 0;
}

function isPendingDeletionExpired(metadata: { pendingDeletionAt?: unknown } | undefined, now = Date.now()) {
  if (!isPendingDeletionMetadata(metadata)) return false;
  const parsed = Date.parse(String(metadata?.pendingDeletionAt));
  if (Number.isNaN(parsed)) return false;
  return now - parsed >= ASSISTANT_PENDING_DELETION_TTL_MS;
}

async function readRawCollaborationStateForRepository(projectId: string) {
  assertSafeId(projectId, "projectId");
  try {
    const raw = await safeRead(path.join(collaborationRoot, `${projectId}.json`));
    return JSON.parse(raw) as { events?: Array<{ type?: string; actorType?: string }>; attachments?: unknown[] } | null;
  } catch {
    return null;
  }
}

function hasGeneratedAssistantArtifacts(project: DiscussionProject) {
  if (project.nodes.length > 0 || project.relations.length > 0) return true;
  if (project.insights.items.length > 0) return true;
  return JSON.stringify(project.summary) !== JSON.stringify(createEmptySummary(project.language));
}

function collaborationStateHasMeaningfulSessionContent(raw: { events?: Array<{ type?: string; actorType?: string }>; attachments?: unknown[] } | null) {
  if (!raw) return false;
  if (Array.isArray(raw.attachments) && raw.attachments.length > 0) return true;
  const events = Array.isArray(raw.events) ? raw.events : [];
  return events.some((event) => event?.type === "message" || event?.actorType === "ai");
}

async function isEmptyAssistantSession(project: DiscussionProject) {
  if (project.metadata.isSample || project.scenario !== "ai-dialogue") return false;
  if (project.metadata.archivedAt || project.metadata.pendingDeletionAt) return false;
  if (project.room.visibility !== "private") return false;
  if (project.entries.length > 0) return false;
  if (hasGeneratedAssistantArtifacts(project)) return false;
  const rawCollaboration = await readRawCollaborationStateForRepository(project.id);
  return !collaborationStateHasMeaningfulSessionContent(rawCollaboration);
}

function isEmptyAssistantSessionExpired(project: DiscussionProject, now = Date.now()) {
  const createdAt = Date.parse(project.createdAt || project.updatedAt);
  if (Number.isNaN(createdAt)) return false;
  return now - createdAt >= ASSISTANT_EMPTY_SESSION_TTL_MS;
}

function getAssistantSessionLastActiveAt(project: DiscussionProject) {
  const parsed = Date.parse(project.metadata.lastActiveAt ?? project.updatedAt ?? project.createdAt);
  return Number.isNaN(parsed) ? null : parsed;
}

function isPrivateOwnedSingleUserAssistantSession(project: DiscussionProject, settings: AppSettings) {
  return isOwnedAssistantSession(project, settings)
    && project.room.visibility === "private"
    && project.participants.length === 1;
}

function isAssistantSessionAutoCleanupExpired(
  project: DiscussionProject,
  settings: AppSettings,
  now = Date.now(),
) {
  const cleanup = settings.privacy.assistantSessionCleanup;
  if (!cleanup.enabled) return false;
  if (!isPrivateOwnedSingleUserAssistantSession(project, settings)) return false;
  if (project.metadata.pendingDeletionAt) return false;
  const lastActiveAt = getAssistantSessionLastActiveAt(project);
  if (lastActiveAt === null) return false;
  const maxAgeMs = cleanup.maxIdleDays * 24 * 60 * 60 * 1000;
  return now - lastActiveAt >= maxAgeMs;
}

function assistantSessionRank(summary: DashboardProjectSummary) {
  if (summary.pendingDeletionAt) return 2;
  if (summary.archivedAt) return 1;
  return 0;
}

function canSurfaceProjectSummary(
  input: {
    metadata?: { isSample?: boolean; pendingDeletionAt?: unknown };
    scenario?: unknown;
    room?: { visibility?: unknown };
    participants?: Array<{ profileOwnerId?: unknown }>;
  },
  settings: AppSettings,
) {
  if (input.metadata?.isSample) return true;
  if (isPendingDeletionMetadata(input.metadata)) return false;
  if (input.scenario === "ai-dialogue") return false;
  if (input.room?.visibility === "public") return true;
  const localIdentityId = settings.profile.localIdentityId;
  return (input.participants ?? []).some((participant) => participant?.profileOwnerId === localIdentityId);
}

function isOwnedAssistantSession(
  input: {
    metadata?: { isSample?: boolean; pendingDeletionAt?: unknown; archivedAt?: unknown };
    scenario?: unknown;
    participants?: Array<{ profileOwnerId?: unknown }>;
  },
  settings: AppSettings,
) {
  if (input.metadata?.isSample) return false;
  if (input.scenario !== "ai-dialogue") return false;
  const localIdentityId = settings.profile.localIdentityId;
  return (input.participants ?? []).some((participant) => participant?.profileOwnerId === localIdentityId);
}

function toDashboardSummaryFromProject(project: DiscussionProject): DashboardProjectSummary {
  return {
    id: project.id,
    title: project.title,
    description: project.description,
    scenario: project.scenario,
    language: project.language,
    updatedAt: project.updatedAt,
    status: project.status,
    participantCount: project.participants.length,
    activePresenceCount: project.room.presence.filter((presence) => presence.active).length,
    entryCount: project.entries.length,
    roomStatus: project.room.session.status,
    visibility: project.room.visibility,
    providerId: project.providerSnapshot.providerId,
    isSample: project.metadata.isSample,
    archivedAt: project.metadata.archivedAt,
    pendingDeletionAt: project.metadata.pendingDeletionAt,
  };
}

function toDashboardSummaryFromRaw(rawProject: Record<string, unknown>, fallbackLocale: AppLocale): DashboardProjectSummary {
  const participants = Array.isArray(rawProject.participants) ? rawProject.participants : [];
  const entries = Array.isArray(rawProject.entries) ? rawProject.entries : [];
  const room = rawProject.room && typeof rawProject.room === "object" ? (rawProject.room as Record<string, unknown>) : {};
  const session = room.session && typeof room.session === "object" ? (room.session as Record<string, unknown>) : {};
  const metadata = rawProject.metadata && typeof rawProject.metadata === "object" ? (rawProject.metadata as Record<string, unknown>) : {};
  const presence = Array.isArray(room.presence) ? room.presence : [];
  const updatedAt = typeof rawProject.updatedAt === "string" && rawProject.updatedAt ? rawProject.updatedAt : new Date().toISOString();
  const scenario = rawProject.scenario;
  const language = rawProject.language;
  const roomStatus = session.status;
  const visibility = room.visibility;
  const providerSnapshot = rawProject.providerSnapshot && typeof rawProject.providerSnapshot === "object" ? (rawProject.providerSnapshot as Record<string, unknown>) : {};
  return {
    id: typeof rawProject.id === "string" && rawProject.id ? rawProject.id : createId("project"),
    title: typeof rawProject.title === "string" && rawProject.title ? rawProject.title : buildUntitledProjectTitle(fallbackLocale),
    description: typeof rawProject.description === "string" ? rawProject.description : "",
    scenario: PROJECT_SCENARIOS.includes(scenario as (typeof PROJECT_SCENARIOS)[number]) ? (scenario as DashboardProjectSummary["scenario"]) : "discussion",
    language: APP_LOCALES.includes(language as AppLocale) ? (language as AppLocale) : fallbackLocale,
    updatedAt,
    status: isDashboardSummaryStatus(rawProject.status) ? rawProject.status : "active",
    participantCount: participants.length,
    activePresenceCount: presence.filter((item: { active?: boolean }) => Boolean(item?.active)).length,
    entryCount: entries.length,
    roomStatus: isDashboardSummaryRoomStatus(roomStatus) ? roomStatus : "scheduled",
    visibility: isDashboardSummaryVisibility(visibility) ? visibility : "private",
    providerId: PROVIDER_IDS.includes(providerSnapshot.providerId as typeof PROVIDER_IDS[number]) ? (providerSnapshot.providerId as typeof PROVIDER_IDS[number]) : "mock",
    isSample: Boolean(metadata.isSample),
    archivedAt: typeof metadata.archivedAt === "string" ? metadata.archivedAt : undefined,
    pendingDeletionAt: typeof metadata.pendingDeletionAt === "string" ? metadata.pendingDeletionAt : undefined,
  };
}

async function readStoredDashboardProjectSummaries(settings: AppSettings, locale: AppLocale) {
  await ensureDirectories();
  const files = await readdir(projectRoot);
  const summaries: DashboardProjectSummary[] = [];

  for (const file of files.filter((fileName) => fileName.endsWith(".json"))) {
    const projectId = file.replace(/\.json$/, "");
    if (bundledSampleProjectIds.has(projectId)) {
      continue;
    }
    try {
      const raw = await safeRead(path.join(projectRoot, file));
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (!canSurfaceProjectSummary(parsed, settings)) {
        continue;
      }
      summaries.push(toDashboardSummaryFromRaw(parsed, locale));
    } catch (error) {
      if (isProjectFileMissingError(error)) {
        continue;
      }
      throw error;
    }
  }

  return summaries;
}

export async function purgeExpiredAssistantSessions() {
  const settings = await getSettings({ includeSecrets: false });
  const projects = await readStoredProjects();
  const expiredIds: string[] = [];

  for (const project of projects) {
    if (project.scenario !== "ai-dialogue") continue;
    if (isPendingDeletionExpired(project.metadata)) {
      expiredIds.push(project.id);
      continue;
    }
    if (await isEmptyAssistantSession(project) && isEmptyAssistantSessionExpired(project)) {
      expiredIds.push(project.id);
      continue;
    }
    if (isAssistantSessionAutoCleanupExpired(project, settings)) {
      expiredIds.push(project.id);
    }
  }

  await Promise.all(expiredIds.map((projectId) => removeFileIfExists(path.join(projectRoot, `${projectId}.json`))));
  return expiredIds;
}

export async function listAssistantSessions(locale: AppLocale = "zh-CN", options: { includeSessionId?: string } = {}) {
  const settings = await getSettings({ includeSecrets: false });
  const projects = await readStoredProjects();
  const summaries: DashboardProjectSummary[] = [];

  for (const project of projects) {
    if (!isOwnedAssistantSession(project, settings)) continue;
    const isEmpty = await isEmptyAssistantSession(project);
    if (isEmpty && options.includeSessionId !== project.id) continue;
    summaries.push(toDashboardSummaryFromProject(localizeBundledProject(project, locale)));
  }

  return summaries.sort((left, right) => {
    const rankDelta = assistantSessionRank(left) - assistantSessionRank(right);
    if (rankDelta !== 0) return rankDelta;
    return Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
  });
}
function toListItem(project: DiscussionProject): ProjectListItem {
  return {
    id: project.id,
    title: project.title,
    description: project.description,
    scenario: project.scenario,
    language: project.language,
    updatedAt: project.updatedAt,
    status: project.status,
    goal: project.goal,
    tags: project.tags,
    participantCount: project.participants.length,
    activePresenceCount: project.room.presence.filter((presence) => presence.active).length,
    entryCount: project.entries.length,
    roomStatus: project.room.session.status,
    visibility: project.room.visibility,
    syncStatus: project.room.session.sync.status,
    providerId: project.providerSnapshot.providerId,
    isSample: project.metadata.isSample,
  };
}

async function readStoredProjects() {
  await ensureDirectories();
  const files = await readdir(projectRoot);
  const results: DiscussionProject[] = [];

  for (const file of files.filter((fileName) => fileName.endsWith(".json"))) {
    const projectId = file.replace(/\.json$/, "");
    if (bundledSampleProjectIds.has(projectId)) {
      continue;
    }
    try {
      const raw = await safeRead(path.join(projectRoot, file));
      results.push(normalizeProject(JSON.parse(raw)));
    } catch (error) {
      if (isProjectFileMissingError(error)) {
        continue;
      }
      throw error;
    }
  }

  return results;
}

export async function readStoredProjectSnapshot(projectId: string): Promise<DiscussionProject | null> {
  assertSafeId(projectId, "projectId");
  if (bundledSampleProjectIds.has(projectId)) {
    return null;
  }

  await ensureDirectories();
  try {
    const raw = await safeRead(path.join(projectRoot, `${projectId}.json`));
    return normalizeProject(JSON.parse(raw));
  } catch (error) {
    if (isProjectFileMissingError(error)) {
      return null;
    }
    throw error;
  }
}

export async function restoreStoredProjectSnapshots(
  snapshots: Array<{ projectId: string; project: DiscussionProject | null }>,
) {
  await ensureDirectories();
  for (const snapshot of snapshots) {
    assertSafeId(snapshot.projectId, "projectId");
    if (snapshot.project) {
      assertWritableProjectId(snapshot.project.id);
      await saveProjectFile(snapshot.project);
      continue;
    }
    await removeFileIfExists(path.join(projectRoot, `${snapshot.projectId}.json`));
  }
}

function canSurfaceProjectForWorkspace(project: DiscussionProject, settings: AppSettings) {
  if (project.metadata.isSample) return true;
  if (project.scenario === "ai-dialogue") return false;
  if (project.room.visibility === "public") return true;
  const localIdentityId = settings.profile.localIdentityId;
  return project.participants.some((participant) => participant.profileOwnerId === localIdentityId);
}

function canIncludeProjectInFullBackup(project: DiscussionProject, settings: AppSettings) {
  if (project.metadata.isSample) return false;
  return canSurfaceProjectForWorkspace(project, settings) || isOwnedAssistantSession(project, settings);
}

export function isAssistantSessionPendingDeletionError(error: unknown) {
  return error instanceof Error && error.message === "assistant-session-pending-deletion";
}

export function isProjectFileMissingError(error: unknown) {
  return Boolean(error && typeof error === "object" && "code" in error && (error).code === "ENOENT");
}

export async function getSettings(options: { includeSecrets?: boolean; identityId?: string } = {}) {
  await ensureDirectories();
  const explicitIdentityId = sanitizeOptionalText(options.identityId, 120);
  const requestedIdentityId = explicitIdentityId || await getRequestLocalIdentityId();
  const primarySettings = await readSettingsFileOrNull(settingsFile);
  const initialLocale = await getRequestPreferredLocale();

  let baseSettings: AppSettings;
  let resolvedProfileId: string;

  if (typeof requestedIdentityId === "string" && requestedIdentityId) {
    const storedProfile = await readSettingsFileOrNull(getProfileSettingsFile(requestedIdentityId));
    baseSettings = storedProfile
      ? applyRequestedIdentity(storedProfile, requestedIdentityId)
      : applyRequestedIdentity(primarySettings ?? createProfileDefaults(initialLocale, requestedIdentityId), requestedIdentityId);
    resolvedProfileId = requestedIdentityId;
  } else {
    baseSettings = primarySettings ?? createProfileDefaults(initialLocale);
    resolvedProfileId = baseSettings.profile.localIdentityId;
  }

  const secrets = await readProviderSecretStore(resolvedProfileId);
  const merged = mergeProviderSecrets(applyRequestedIdentity(baseSettings, resolvedProfileId), secrets);
  return options.includeSecrets === false ? stripProviderSecretsForClient(merged, secrets) : merged;
}

export async function getSettingsForIdentity(identityId: string, options: { includeSecrets?: boolean } = {}) {
  await ensureDirectories();
  const resolvedIdentityId = sanitizeOptionalText(identityId, 120);
  if (!resolvedIdentityId) {
    return null;
  }

  const storedProfile = await readSettingsFileOrNull(getProfileSettingsFile(resolvedIdentityId));
  if (!storedProfile) {
    return null;
  }

  const secrets = await readProviderSecretStore(resolvedIdentityId);
  const merged = mergeProviderSecrets(applyRequestedIdentity(storedProfile, resolvedIdentityId), secrets);
  return options.includeSecrets === false ? stripProviderSecretsForClient(merged, secrets) : merged;
}

export async function saveSettings(settings: AppSettings) {
  await ensureDirectories();
  const previous = await getSettings();
  const requestedIdentityId = await getRequestLocalIdentityId();
  const preferredIdentityId = sanitizeOptionalText(requestedIdentityId ?? undefined, 120)
    || sanitizeOptionalText(settings.profile.localIdentityId, 120)
    || previous.profile.localIdentityId
    || createLocalIdentityId();

  const normalized = ensureSettingsProfileFields(
    normalizeSettings({
      ...settings,
      profile: {
        ...settings.profile,
        localIdentityId: preferredIdentityId,
      },
    })
  );
  const effectiveSettings = normalized;
  const existingSecrets = await readProviderSecretStore(preferredIdentityId);
  const nextSecrets = collectStoredProviderSecrets(effectiveSettings, existingSecrets);
  const validated = sanitizeSettingsForStorage(effectiveSettings);

  await writeFileAtomic(getProfileSettingsFile(preferredIdentityId), `${JSON.stringify(validated, null, 2)}\n`, "utf-8");
  await writeFileAtomic(settingsFile, `${JSON.stringify(validated, null, 2)}\n`, "utf-8");
  await writeProviderSecretStore(preferredIdentityId, nextSecrets);
  await syncLocalProfileAcrossProjects(previous, effectiveSettings);
  return stripProviderSecretsForClient(validated, nextSecrets);
}

export async function saveSettingsPatch(patch: SettingsPatch) {
  const current = await getSettings();
  const merged = mergeDeep<AppSettings>(current, patch);
  return saveSettings(merged);
}

export async function listProjects(locale?: AppLocale) {
  const settings = await getSettings();
  const displayLocale = locale ?? settings.locale;
  const stored = await readStoredProjects();
  const samples = await Promise.all(
    sampleProjects.map((project) => maybeAnalyzeProject(applyCreationDefaults(localizeBundledProject(project, displayLocale), settings, displayLocale), settings, displayLocale)),
  );

  return [...stored.filter((project) => canSurfaceProjectForWorkspace(project, settings)), ...samples]
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .map((project) => toListItem(project));
}

export async function listProjectsForFullBackup() {
  const settings = await getSettings({ includeSecrets: false });
  const stored = await readStoredProjects();
  return stored
    .filter((project) => canIncludeProjectInFullBackup(project, settings))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export async function getProject(projectId: string, locale?: AppLocale, options: { includePendingDeletion?: boolean } = {}): Promise<DiscussionProject> {
  assertSafeId(projectId, "projectId");
  const settings = await getSettings();
  const displayLocale = locale ?? settings.locale;
  const sample = sampleProjects.find((candidate) => candidate.id === projectId);
  if (sample) {
    return maybeAnalyzeProject(applyCreationDefaults(localizeBundledProject(sample, displayLocale), settings, displayLocale), settings, displayLocale);
  }

  await ensureDirectories();
  const raw = await safeRead(path.join(projectRoot, `${projectId}.json`));
  const project = syncProjectLifecycle(normalizeProject(JSON.parse(raw), displayLocale), settings);
  if (project.scenario === "ai-dialogue" && isPendingDeletionMetadata(project.metadata) && !options.includePendingDeletion) {
    throw new Error("assistant-session-pending-deletion");
  }
  return maybeAnalyzeProject(project, settings, displayLocale);
}

export async function upsertProject(
  project: DiscussionProject,
  locale?: AppLocale,
  options: { skipAutoAnalyze?: boolean; settingsOverride?: AppSettings } = {},
) {
  assertSafeId(project.id, "projectId");
  await ensureDirectories();
  const settings = options.settingsOverride ?? await getSettings();
  const displayLocale = locale ?? settings.locale ?? project.language;
  const normalized = syncProjectLifecycle(normalizeProject(project, displayLocale), settings);
  const prepared: DiscussionProject = applyCreationDefaults(normalized, settings, displayLocale);
  const analyzed: DiscussionProject = options.skipAutoAnalyze
    ? {
        ...prepared,
        updatedAt: new Date().toISOString(),
      }
    : await maybeAnalyzeProject(prepared, settings, displayLocale, { touchUpdatedAt: true });
  await saveProjectFile(analyzed);
  return analyzed;
}

export async function createProject(
  project: DiscussionProject,
  locale?: AppLocale,
  options: { skipAutoAnalyze?: boolean; settingsOverride?: AppSettings } = {},
) {
  assertWritableProjectId(project.id);
  return upsertProject(project, locale, options);
}

export async function deleteProject(projectId: string) {
  assertSafeId(projectId, "projectId");
  if (bundledSampleProjectIds.has(projectId)) {
    return;
  }
  await ensureDirectories();
  await removeFileIfExists(path.join(projectRoot, `${projectId}.json`));
}

export async function exportProject(projectId: string, format: ExportFormat, locale?: AppLocale) {
  const project = await getProject(projectId, locale);
  return buildExport(project, format);
}

export async function importProject(payload: ImportPayload, options: { settingsOverride?: AppSettings } = {}) {
  await ensureDirectories();
  const settings = options.settingsOverride ?? await getSettings();
  const parsed = parseImport(payload);
  assertWritableProjectId(parsed.project.id);
  const prepared = applyCreationDefaults(syncProjectLifecycle(parsed.project, settings), settings, payload.locale);
  const analyzed = await maybeAnalyzeProject(prepared, settings, payload.locale, { touchUpdatedAt: true });
  await saveProjectFile(analyzed);
  return { project: analyzed, warnings: parsed.warnings };
}

export async function purgeStoredBundledSampleCopies() {
  await ensureDirectories();
  await Promise.all(
    [...bundledSampleProjectIds].map((projectId) => removeFileIfExists(path.join(projectRoot, `${projectId}.json`))),
  );
}

export async function getDashboardData(locale?: AppLocale) {
  const settings = await getSettings({ includeSecrets: false });
  const displayLocale = locale ?? settings.locale;
  const storedSummaries = await readStoredDashboardProjectSummaries(settings, displayLocale);
  const sampleSummaries = sampleProjects.map((project) => toDashboardSummaryFromProject(localizeBundledProject(project, displayLocale)));
  const projects = [...storedSummaries, ...sampleSummaries].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  return {
    projects,
    settings,
  };
}

export function createProjectSkeleton(
  locale: AppLocale,
  scenario: DiscussionProject["scenario"],
  settings: AppSettings = createDefaultSettings(locale),
) {
  const timestamp = new Date().toISOString();
  const goal = createDefaultGoal(locale, scenario);
  const provisionalRoom = createDiscussionRoom(locale, goal, [], {
    visibility: settings.collaborationPreferences.defaultVisibility,
    transport: settings.collaborationPreferences.defaultTransport,
    autoSummary: settings.provider.autoSummary,
    autoEvaluation: settings.provider.autoEvaluation,
    sessionAutoStart: settings.collaborationPreferences.sessionAutoStart,
  });
  const hostParticipant: Participant = {
    id: createId("participant"),
    name: settings.profile.displayName,
    profileOwnerId: settings.profile.localIdentityId,
    role: "moderator",
    collaborationRole: "host",
    stance:
      locale === "zh-CN"
        ? "负责发起讨论并组织 AI 分析"
        : locale === "ja"
          ? "議論を開始し、AI 分析を進行するローカルホスト"
          : locale === "ko"
            ? "토론을 시작하고 AI 분석을 조율하는 로컬 호스트"
          : locale === "fr"
            ? "Anime la discussion et coordonne l'analyse IA"
            : locale === "ru"
              ? "Запускает обсуждение и координирует ИИ-анализ"
            : "Starts the discussion and coordinates AI analysis.",
    color: "#b45309",
    bio:
      locale === "zh-CN"
        ? "本地工作区默认创建者。"
        : locale === "ja"
          ? "ローカルワークスペースの既定作成者です。"
          : locale === "ko"
            ? "로컬 워크스페이스의 기본 생성자입니다."
          : locale === "fr"
            ? "Createur local par defaut de l'espace de travail."
            : locale === "ru"
              ? "Создатель локального рабочего пространства по умолчанию."
            : "Default local workspace creator.",
    avatarLabel: pickInitials(settings.profile.displayName),
    avatarPreset: settings.profile.avatarPreset,
    avatarImageDataUrl: sanitizeAvatarDataUrl(settings.profile.avatarImageDataUrl),
    seatLabel: "HOST",
    presence: createParticipantPresence(provisionalRoom.session.id, "online"),
  };
  const activeProviderId = settings.provider.activeProviderId;
  const runtime = settings.provider.providers[activeProviderId] ?? createProviderRuntimeMap()[activeProviderId];
  const room = createDiscussionRoom(locale, goal, [hostParticipant], {
    visibility: settings.collaborationPreferences.defaultVisibility,
    transport: settings.collaborationPreferences.defaultTransport,
    autoSummary: settings.provider.autoSummary,
    autoEvaluation: settings.provider.autoEvaluation,
    sessionAutoStart: settings.collaborationPreferences.sessionAutoStart,
    aiConfig: createRoomAiConfig(activeProviderId, runtime.model, {
      ownerIdentityId: settings.profile.localIdentityId,
      ownerParticipantId: hostParticipant.id,
      updatedByParticipantId: hostParticipant.id,
    }),
  });
  const participant: Participant = {
    ...hostParticipant,
    presence: createParticipantPresence(room.session.id, "online"),
  };

  return discussionProjectSchema.parse({
    id: createScopedId("project", 12),
    title: buildUntitledProjectTitle(locale),
    description:
      locale === "zh-CN"
        ? "请补充讨论背景、目标、参与者，以及希望 AI 分析层重点关注的议题。"
        : locale === "ja"
          ? "議論の背景、目的、参加者、そして AI 分析層に重点的に見てほしい論点を追記してください。"
          : locale === "ko"
            ? "토론의 배경, 목표, 참여자와 AI 분석 계층이 중점적으로 살펴봐야 할 쟁점을 추가해 주세요."
          : locale === "fr"
            ? "Ajoutez le contexte, l'objectif, les participants et les points que la couche d'analyse IA devra suivre en priorite."
            : locale === "ru"
              ? "Добавьте контекст, цель, участников и ключевые темы, на которые ИИ-анализ должен обратить внимание."
            : "Add the context, objective, participants, and the key areas the AI analysis layer should track.",
    scenario,
    language: locale,
    createdAt: timestamp,
    updatedAt: timestamp,
    status: "active",
    goal,
    tags: [],
    participants: [participant],
    entries: [],
    nodes: [],
    relations: [],
    insights: createEmptyInsights(timestamp),
    summary: createEmptySummary(locale),
    room,
    providerSnapshot: createProviderSnapshot(activeProviderId, runtime.model, "seed", timestamp),
    metadata: {
      isSample: false,
      source: "created",
      createdByIdentityId: settings.profile.localIdentityId,
      lastActiveAt: timestamp,
    },
  });
}
