import { z } from "zod";
import {
  AI_TASKS,
  APP_LOCALES,
  COLLABORATION_ROLES,
  ENTRY_KINDS,
  ENTRY_SOURCES,
  ENTRY_SYNC_STATES,
  EXPORT_FORMATS,
  INSIGHT_CATEGORIES,
  INSIGHT_STATUSES,
  KNOWLEDGE_DEFAULT_VIEWS,
  MODEL_RELEASE_STAGES,
  NODE_TYPES,
  ORCHESTRATION_STAGES,
  PARTICIPANT_ROLES,
  PRESENCE_STATUSES,
  PROJECT_SCENARIOS,
  PROJECT_STATUSES,
  PROVIDER_CONNECTION_STATES,
  PROVIDER_IDS,
  PROVIDER_IMPLEMENTATION_STAGES,
  PROVIDER_MODES,
  RELATION_TYPES,
  ROOM_SESSION_STATUSES,
  ROOM_SYNC_STATUSES,
  ROOM_TRANSPORTS,
  ROOM_VISIBILITIES,
  THEMES,
  THEME_PRESETS,
  AVATAR_PRESETS,
  WORKSPACE_DEFAULT_TABS,
} from "@/lib/types";

export const participantPresenceSchema = z.object({
  status: z.enum(PRESENCE_STATUSES),
  lastSeenAt: z.string(),
  isTyping: z.boolean(),
  sessionId: z.string().optional(),
});

export const participantSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  profileOwnerId: z.string().optional(),
  role: z.enum(PARTICIPANT_ROLES),
  collaborationRole: z.enum(COLLABORATION_ROLES),
  customRoleLabel: z.string().optional(),
  stance: z.string(),
  color: z.string(),
  bio: z.string(),
  avatarLabel: z.string(),
  avatarPreset: z.enum(AVATAR_PRESETS).optional(),
  avatarImageDataUrl: z.string().optional(),
  seatLabel: z.string().optional(),
  presence: participantPresenceSchema,
});

export const transcriptEntrySchema = z.object({
  id: z.string(),
  participantId: z.string(),
  ownerParticipantId: z.string(),
  occurredAt: z.string(),
  content: z.string().min(1),
  tags: z.array(z.string()),
  kind: z.enum(ENTRY_KINDS),
  highlighted: z.boolean(),
  linkedNodeIds: z.array(z.string()),
  relatedEntryIds: z.array(z.string()),
  source: z.enum(ENTRY_SOURCES),
  syncState: z.enum(ENTRY_SYNC_STATES),
  roomId: z.string(),
  sessionId: z.string(),
});

export const argumentNodeSchema = z.object({
  id: z.string(),
  title: z.string().min(1),
  description: z.string(),
  type: z.enum(NODE_TYPES),
  participantId: z.string().optional(),
  entryIds: z.array(z.string()),
  stance: z.string(),
  strength: z.number().min(1).max(5),
  status: z.enum(["open", "resolved", "contested"]),
});

export const argumentRelationSchema = z.object({
  id: z.string(),
  sourceNodeId: z.string(),
  targetNodeId: z.string(),
  type: z.enum(RELATION_TYPES),
  note: z.string(),
});

export const insightItemSchema = z.object({
  id: z.string(),
  category: z.enum(INSIGHT_CATEGORIES),
  title: z.string().min(1),
  detail: z.string(),
  severity: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  status: z.enum(INSIGHT_STATUSES),
  relatedEntryIds: z.array(z.string()),
  relatedNodeIds: z.array(z.string()),
});

export const insightPanelSchema = z.object({
  updatedAt: z.string(),
  items: z.array(insightItemSchema),
});

export const evaluationSchema = z.object({
  leaning: z.string(),
  favoredByEvidence: z.string(),
  favoredByResponsiveness: z.string(),
  favoredByLogic: z.string(),
  moreUnanswered: z.string(),
  confidence: z.string(),
  reasons: z.array(z.string()),
  improvementSuggestions: z.array(z.string()),
});

export const summarySchema = z.object({
  overview: z.string(),
  participantOverview: z.array(z.string()),
  coreTopics: z.array(z.string()),
  majorClaims: z.array(z.string()),
  keyEvidence: z.array(z.string()),
  majorRebuttals: z.array(z.string()),
  unresolvedQuestions: z.array(z.string()),
  disputes: z.array(z.string()),
  currentConclusion: z.string(),
  nextSteps: z.array(z.string()),
  suggestions: z.array(z.string()),
  followupQuestions: z.array(z.string()),
  evaluation: evaluationSchema,
  history: z.array(z.object({
    id: z.string(),
    createdAt: z.string(),
    trigger: z.enum(["manual", "auto-basic", "auto-assistive"]),
    providerId: z.enum(PROVIDER_IDS),
    model: z.string(),
    thresholdUsed: z.number().optional(),
    nextThreshold: z.number().optional(),
    throughEntryCount: z.number(),
    overview: z.string(),
    currentConclusion: z.string(),
    nextSteps: z.array(z.string()),
  })).optional(),
});

export const roomPresenceSchema = z.object({
  participantId: z.string(),
  collaborationRole: z.enum(COLLABORATION_ROLES),
  status: z.enum(PRESENCE_STATUSES),
  sessionId: z.string(),
  deviceLabel: z.string(),
  connectionId: z.string(),
  lastSeenAt: z.string(),
  active: z.boolean(),
});

export const roomSyncStateSchema = z.object({
  transport: z.enum(ROOM_TRANSPORTS),
  status: z.enum(ROOM_SYNC_STATUSES),
  latencyMs: z.number(),
  backlog: z.number(),
  streamingReady: z.boolean(),
  lastEventAt: z.string(),
});

export const roomSessionSchema = z.object({
  id: z.string(),
  title: z.string(),
  goal: z.string(),
  hostParticipantId: z.string().optional(),
  status: z.enum(ROOM_SESSION_STATUSES),
  startedAt: z.string(),
  endedAt: z.string().optional(),
  observerIds: z.array(z.string()),
  sync: roomSyncStateSchema,
});

export const roomAiConfigSchema = z.object({
  providerId: z.enum(PROVIDER_IDS),
  model: z.string(),
  ownerIdentityId: z.string().optional(),
  ownerParticipantId: z.string().optional(),
  updatedAt: z.string(),
  updatedByParticipantId: z.string().optional(),
});

export const discussionRoomSchema = z.object({
  id: z.string(),
  slug: z.string(),
  visibility: z.enum(ROOM_VISIBILITIES),
  joinMode: z.enum(["open", "approval"]).optional(),
  accessCode: z.string(),
  notes: z.array(z.string()),
  session: roomSessionSchema,
  presence: z.array(roomPresenceSchema),
  autoSummary: z.boolean(),
  autoEvaluation: z.boolean(),
  aiConfig: roomAiConfigSchema,
  aiAutomation: z.object({
    mode: z.enum(["auto", "manual", "off", "basic", "assistive"]),
    summaryThreshold: z.number().optional(),
    summaryCurrentThreshold: z.number().optional(),
    summaryLastProcessedEntryCount: z.number().optional(),
    autoReplyThreshold: z.number().optional(),
    autoEvaluationThreshold: z.number().optional(),
    autoFollowupThreshold: z.number().optional(),
    autoFollowupEnabled: z.boolean().optional(),
    responseStyle: z.enum(["objective", "analytical", "comprehensive", "minutes"]).optional(),
    permissions: z.object({
      facilitatorCanManage: z.boolean(),
      facilitatorCanTrigger: z.boolean(),
    }).optional(),
  }).optional(),
  archivedAt: z.string().optional(),
  archivedBy: z.string().optional(),
});

export const providerCapabilitiesSchema = z.object({
  realtimeCapture: z.boolean(),
  streaming: z.boolean(),
  testConnection: z.boolean(),
  summarizeDiscussion: z.boolean(),
  evaluateDiscussion: z.boolean(),
  generateFollowupQuestions: z.boolean(),
  multiperspectiveSummary: z.boolean(),
  debateAnalysis: z.boolean(),
  chatConversation: z.boolean(),
});

export const providerModelInputCapabilitiesSchema = z.object({
  text: z.boolean(),
  image: z.boolean(),
  document: z.boolean(),
  video: z.boolean(),
  audio: z.boolean(),
});

export const providerModelOptionSchema = z.object({
  id: z.string(),
  label: z.string(),
  status: z.enum(MODEL_RELEASE_STAGES),
  notes: z.string().optional(),
  recommended: z.boolean().optional(),
  inputCapabilities: providerModelInputCapabilitiesSchema.optional(),
});

export const providerDescriptorSchema = z.object({
  id: z.enum(PROVIDER_IDS),
  label: z.string(),
  vendor: z.string(),
  mode: z.enum(PROVIDER_MODES),
  description: z.string(),
  website: z.string(),
  implementationStage: z.enum(PROVIDER_IMPLEMENTATION_STAGES),
  models: z.array(providerModelOptionSchema),
  regions: z.array(z.string()),
  capabilities: providerCapabilitiesSchema,
});

export const providerRuntimeConfigSchema = z.object({
  providerId: z.enum(PROVIDER_IDS),
  enabled: z.boolean(),
  mode: z.enum(PROVIDER_MODES),
  model: z.string(),
  apiKey: z.string(),
  baseUrl: z.string(),
  organization: z.string(),
  notes: z.string(),
  streaming: z.boolean(),
  temperature: z.number(),
  testState: z.enum(PROVIDER_CONNECTION_STATES),
  lastCheckedAt: z.string().optional(),
  hasStoredApiKey: z.boolean().optional(),
  maskedApiKey: z.string().optional(),
  clearStoredApiKey: z.boolean().optional(),
});

export const providerRuntimeMapSchema = z.object({
  mock: providerRuntimeConfigSchema,
  disabled: providerRuntimeConfigSchema,
  openai: providerRuntimeConfigSchema,
  gemini: providerRuntimeConfigSchema,
  grok: providerRuntimeConfigSchema,
  claude: providerRuntimeConfigSchema,
  deepseek: providerRuntimeConfigSchema,
  doubao: providerRuntimeConfigSchema,
  qwen: providerRuntimeConfigSchema,
});

export const providerConfigurationSchema = z.object({
  activeProviderId: z.enum(PROVIDER_IDS),
  activeMode: z.enum(PROVIDER_MODES),
  descriptors: z.array(providerDescriptorSchema),
  providers: providerRuntimeMapSchema,
  mockEmphasis: z.enum(["balanced", "evidence", "responsiveness"]),
  autoSummary: z.boolean(),
  autoEvaluation: z.boolean(),
  enableStreaming: z.boolean(),
  requestTimeoutMs: z.number().int().min(1000).max(120000),
  preferServerKeys: z.boolean(),
  allowFallbackToScaffold: z.boolean(),
});

export const discussionProjectSchema = z.object({
  id: z.string(),
  title: z.string().min(1),
  description: z.string(),
  scenario: z.enum(PROJECT_SCENARIOS),
  language: z.enum(APP_LOCALES),
  createdAt: z.string(),
  updatedAt: z.string(),
  status: z.enum(PROJECT_STATUSES),
  goal: z.string(),
  tags: z.array(z.string()),
  participants: z.array(participantSchema),
  entries: z.array(transcriptEntrySchema),
  nodes: z.array(argumentNodeSchema),
  relations: z.array(argumentRelationSchema),
  insights: insightPanelSchema,
  summary: summarySchema,
  room: discussionRoomSchema,
  providerSnapshot: z.object({
    providerId: z.enum(PROVIDER_IDS),
    model: z.string(),
    generatedAt: z.string(),
    version: z.string(),
  }),
  linkedProjectIds: z.array(z.string()).optional(),
  metadata: z.object({
    isSample: z.boolean(),
    source: z.string(),
    sampleKey: z.string().optional(),
    samplePresentation: z.object({
      intro: z.string(),
      sections: z.array(z.object({
        title: z.string(),
        body: z.string(),
      })),
      discussionExcerpts: z.array(z.object({
        speaker: z.string(),
        role: z.string(),
        body: z.string(),
      })),
      aiInterventions: z.array(z.object({
        title: z.string(),
        body: z.string(),
      })),
      systemStages: z.array(z.object({
        title: z.string(),
        body: z.string(),
      })),
      graphEvidence: z.object({
        title: z.string(),
        body: z.string(),
      }),
      graphHighlights: z.array(z.object({
        title: z.string(),
        body: z.string(),
      })),
    }).optional(),
    createdByIdentityId: z.string().optional(),
    archivedAt: z.string().optional(),
    pendingDeletionAt: z.string().optional(),
    lastActiveAt: z.string().optional(),
  }),
});

const themePaletteSchema = z.object({
  primary: z.string().regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/),
  secondary: z.string().regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/),
  accent: z.string().regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/),
});

const themeCustomizationSchema = z.object({
  light: themePaletteSchema,
  dark: themePaletteSchema,
});

const savedThemePresetSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(48),
  customTheme: themeCustomizationSchema,
  updatedAt: z.string(),
});

const tagColorSchema = z.string().regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/);
const savedTemplateSchema = z.object({
  id: z.string().min(1).max(80),
  name: z.string().min(1).max(120),
  scenario: z.string().min(1).max(64),
  description: z.string().max(600),
  goal: z.string().max(400),
  tags: z.array(z.string().max(40)).max(16),
  savedAt: z.string(),
});

export const appSettingsSchema = z.object({
  locale: z.enum(APP_LOCALES),
  theme: z.enum(THEMES),
  datetimeFormat: z.enum(["relative", "absolute"]),
  profile: z.object({
    localIdentityId: z.string().min(1).max(120),
    displayName: z.string().min(1).max(80),
    displayNameIsDefault: z.boolean(),
    avatarPreset: z.enum(AVATAR_PRESETS),
    avatarImageDataUrl: z.string().optional(),
  }),
  appearancePreferences: z.object({
    themePreset: z.enum(THEME_PRESETS),
    reduceMotion: z.boolean(),
    customTheme: themeCustomizationSchema,
    customThemeName: z.string().min(1).max(48),
    savedThemes: z.array(savedThemePresetSchema).max(6),
  }),
  defaultScenario: z.enum(PROJECT_SCENARIOS),
  defaultExportFormat: z.enum(EXPORT_FORMATS),
  provider: providerConfigurationSchema,
  discussionPreferences: z.object({
    compactTimeline: z.boolean(),
    highlightKeywords: z.boolean(),
    graphDensity: z.enum(["comfortable", "dense"]),
    defaultWorkspaceTab: z.enum(WORKSPACE_DEFAULT_TABS),
    singleUserAutoSummaryThreshold: z.number().int().min(5).max(100),
    multiUserAutoSummaryThreshold: z.number().int().min(5).max(100),
    assistiveSummaryThreshold: z.number().int().min(5).max(100),
    latestAiHistoryMode: z.enum(["latest-only", "retain"]),
    latestAiHistoryLimit: z.number().int().min(1).max(50),
    summaryHistoryRetentionMode: z.enum(["unlimited", "capped"]),
    summaryHistoryRetentionLimit: z.number().int().min(1).max(100),
  }),
  collaborationPreferences: z.object({
    defaultVisibility: z.enum(ROOM_VISIBILITIES),
    defaultTransport: z.enum(ROOM_TRANSPORTS),
    sessionAutoStart: z.boolean(),
    sessionAutoArchive: z.boolean(),
    showPresenceIndicators: z.boolean(),
    allowInvites: z.boolean(),
    syncPollingMs: z.number().int().min(1000).max(60000),
    showSystemEvents: z.boolean(),
    eventHistoryLimit: z.number().int().min(10).max(400),
    defaultMemberRole: z.enum(COLLABORATION_ROLES),
    notificationsEnabled: z.boolean(),
    notificationDoNotDisturb: z.boolean(),
  }),
  knowledgePreferences: z.object({
    autoExtractOnSave: z.boolean(),
    autoExtractAfterAiTask: z.boolean(),
    includeAttachmentsAsEvidence: z.boolean(),
    includeUnresolvedQuestions: z.boolean(),
    autoGenerateGraphLinks: z.boolean(),
    defaultView: z.enum(KNOWLEDGE_DEFAULT_VIEWS),
    defaultGraphMode: z.enum(["2d", "3d", "both"]).optional(),
    graphOutputLanguage: z.union([z.literal("auto"), z.enum(APP_LOCALES)]).optional(),
  }),
  aiPreferences: z.object({
    replyLanguage: z.union([z.literal("auto"), z.enum(APP_LOCALES)]),
    aiRole: z.enum(["assistant", "moderator", "note-taker", "debate-judge"]),
    responseLength: z.enum(["brief", "standard", "detailed"]),
    focusTopics: z.string().max(240),
    autoTagging: z.boolean(),
  }),
  uploadPreferences: z.object({
    allowDocuments: z.boolean(),
    allowImages: z.boolean(),
    allowVideos: z.boolean(),
    retainLocalFiles: z.boolean(),
    maxUploadMb: z.number().int().min(1).max(512),
  }),
  participantNicknames: z.record(z.string(), z.string().max(80)),
  tagColors: z.record(z.string(), tagColorSchema),
  customShortcuts: z.record(z.string(), z.string().max(48)),
  quickReplies: z.array(z.string().max(240)).max(20),
  projectOrder: z.array(z.string().max(120)).max(400),
  savedTemplates: z.array(savedTemplateSchema).max(60),
  emailNotifications: z.object({
    enabled: z.boolean(),
    emailAddress: z.string().max(160),
    onNewMember: z.boolean(),
    onAiSummary: z.boolean(),
    onRoomArchived: z.boolean(),
  }),
  privacy: z.object({
    storeApiKeysLocally: z.boolean(),
    analyticsMode: z.enum(["local-only", "manual-export"]),
    shareDiagnostics: z.boolean(),
    assistantSessionCleanup: z.object({
      enabled: z.boolean(),
      maxIdleDays: z.union([z.literal(30), z.literal(90), z.literal(180), z.literal(365)]),
    }),
  }),
  about: z.object({
    projectName: z.string(),
    version: z.string(),
    repositoryUrl: z.string(),
    license: z.string(),
  }),
});
export const orchestrationPacketSchema = z.object({
  providerId: z.enum(PROVIDER_IDS),
  task: z.enum(AI_TASKS),
  stage: z.enum(ORCHESTRATION_STAGES),
  locale: z.enum(APP_LOCALES),
  scenario: z.enum(PROJECT_SCENARIOS),
  projectId: z.string(),
  goal: z.string(),
  room: z.object({
    roomId: z.string(),
    visibility: z.enum(ROOM_VISIBILITIES),
    sessionId: z.string(),
    sessionTitle: z.string(),
    sessionStatus: z.enum(ROOM_SESSION_STATUSES),
    transport: z.enum(ROOM_TRANSPORTS),
    syncStatus: z.enum(ROOM_SYNC_STATUSES),
  }),
  participants: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      role: z.enum(PARTICIPANT_ROLES),
      collaborationRole: z.enum(COLLABORATION_ROLES),
      stance: z.string(),
      presence: z.enum(PRESENCE_STATUSES),
    }),
  ),
  transcript: z.object({
    totalEntries: z.number(),
    highlightedEntries: z.number(),
    lastEntryAt: z.string().optional(),
  }),
  attachments: z.object({
    total: z.number(),
    items: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        kind: z.enum(["document", "image", "video", "file"]),
        mimeType: z.string(),
        note: z.string(),
        uploadedAt: z.string(),
        uploadedByParticipantId: z.string().optional(),
        storage: z.enum(["local", "external"]),
      }),
    ),
  }),
  instructions: z.object({
    system: z.string(),
    user: z.string(),
    outputShape: z.array(z.string()),
  }),
});
