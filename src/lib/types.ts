export const APP_LOCALES = ["en", "zh-CN", "ja", "ko", "fr", "ru"] as const;
export const DISPLAY_LOCALE_ORDER = ["en", "zh-CN", "ja", "ko", "fr", "ru"] as const;
export const PROJECT_SCENARIOS = [
  "debate",
  "discussion",
  "meeting",
  "negotiation",
  "ai-dialogue",
  "document-driven-discussion",
] as const;
export const PROJECT_STATUSES = ["active", "archived", "completed"] as const;
export const ENTRY_KINDS = ["statement", "question", "response", "summary"] as const;
export const NODE_TYPES = [
  "claim",
  "evidence",
  "rebuttal",
  "question",
  "clarification",
  "assumption",
  "conclusion",
  "actionItem",
] as const;
export const RELATION_TYPES = [
  "supports",
  "rebuts",
  "responds_to",
  "asks",
  "clarifies",
  "concludes",
  "references",
] as const;
export const PARTICIPANT_ROLES = [
  "proponent",
  "opponent",
  "moderator",
  "observer",
  "speaker",
  "custom",
] as const;
export const COLLABORATION_ROLES = ["host", "participant", "observer", "facilitator"] as const;
export const PRESENCE_STATUSES = ["online", "away", "syncing", "leaving", "offline"] as const;
export const ROOM_VISIBILITIES = ["private", "invite", "public"] as const;
export const ROOM_JOIN_MODES = ["open", "approval"] as const;
export const ROOM_SESSION_STATUSES = ["scheduled", "live", "paused", "closed"] as const;
export const ROOM_TRANSPORTS = ["local-mock", "future-websocket", "future-sse"] as const;
export const ROOM_SYNC_STATUSES = ["idle", "syncing", "paused"] as const;
export const ENTRY_SOURCES = ["manual", "import", "system"] as const;
export const ENTRY_SYNC_STATES = ["local", "pending", "synced"] as const;
export const INSIGHT_CATEGORIES = [
  "controversy",
  "unanswered",
  "repetition",
  "offTopic",
  "evidenceGap",
  "consensus",
  "pending",
] as const;
export const INSIGHT_STATUSES = ["open", "watching", "resolved"] as const;
export const PROVIDER_IDS = [
  "mock",
  "disabled",
  "openai",
  "gemini",
  "grok",
  "claude",
  "deepseek",
  "doubao",
  "qwen",
] as const;
export const PROVIDER_MODES = ["mock", "disabled", "api"] as const;
export const PROVIDER_CONNECTION_STATES = ["idle", "testing", "ready", "error"] as const;
export const PROVIDER_IMPLEMENTATION_STAGES = ["local", "http", "scaffold"] as const;
export const MODEL_RELEASE_STAGES = ["stable", "preview", "beta", "experimental"] as const;
export const EXPORT_FORMATS = ["json", "txt", "markdown"] as const;
export const THEMES = ["light", "dark", "system"] as const;
export const THEME_PRESETS = ["dialectica", "paper", "midnight", "custom"] as const;
export const AVATAR_PRESETS = ["ember", "harbor", "forest", "plum", "graphite", "aurora", "sunrise", "cobalt"] as const;
export const WORKSPACE_DEFAULT_TABS = ["overview", "capture", "structure", "insights", "knowledge", "settings"] as const;
export const AI_TASKS = [
  "summarizeDiscussion",
  "evaluateDiscussion",
  "generateFollowupQuestions",
  "multiperspectiveSummary",
  "debateAnalysis",
] as const;
export const ORCHESTRATION_STAGES = [
  "capture",
  "stage-summary",
  "final-summary",
  "evaluation",
  "followup",
] as const;
export const KNOWLEDGE_DEFAULT_VIEWS = ["hub", "graph"] as const;

export type AppLocale = (typeof APP_LOCALES)[number];
export const LOCALE_AUTONYMS: Record<AppLocale, string> = {
  en: "English",
  "zh-CN": "中文",
  ja: "日本語",
  ko: "한국어",
  fr: "Français",
  ru: "Русский",
};
export type ProjectScenario = (typeof PROJECT_SCENARIOS)[number];
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];
export type EntryKind = (typeof ENTRY_KINDS)[number];
export type ArgumentNodeType = (typeof NODE_TYPES)[number];
export type RelationType = (typeof RELATION_TYPES)[number];
export type ParticipantRole = (typeof PARTICIPANT_ROLES)[number];
export type CollaborationRole = (typeof COLLABORATION_ROLES)[number];
export type PresenceStatus = (typeof PRESENCE_STATUSES)[number];
export type RoomVisibility = (typeof ROOM_VISIBILITIES)[number];
export type RoomJoinMode = (typeof ROOM_JOIN_MODES)[number];
export type RoomSessionStatus = (typeof ROOM_SESSION_STATUSES)[number];
export type RoomTransport = (typeof ROOM_TRANSPORTS)[number];
export type RoomSyncStatus = (typeof ROOM_SYNC_STATUSES)[number];
export type EntrySource = (typeof ENTRY_SOURCES)[number];
export type EntrySyncState = (typeof ENTRY_SYNC_STATES)[number];
export type InsightCategory = (typeof INSIGHT_CATEGORIES)[number];
export type InsightStatus = (typeof INSIGHT_STATUSES)[number];
export type ProviderId = (typeof PROVIDER_IDS)[number];
export type ProviderMode = (typeof PROVIDER_MODES)[number];
export type ProviderConnectionState = (typeof PROVIDER_CONNECTION_STATES)[number];
export type ProviderImplementationStage = (typeof PROVIDER_IMPLEMENTATION_STAGES)[number];
export type ModelReleaseStage = (typeof MODEL_RELEASE_STAGES)[number];
export type ExportFormat = (typeof EXPORT_FORMATS)[number];
export type ThemeMode = (typeof THEMES)[number];
export type ThemePreset = (typeof THEME_PRESETS)[number];
export type AvatarPreset = (typeof AVATAR_PRESETS)[number];
export type WorkspaceDefaultTab = (typeof WORKSPACE_DEFAULT_TABS)[number];

export interface ThemePalette {
  primary: string;
  secondary: string;
  accent: string;
}

export interface ThemeCustomization {
  light: ThemePalette;
  dark: ThemePalette;
}

export interface SavedThemePreset {
  id: string;
  name: string;
  customTheme: ThemeCustomization;
  updatedAt: string;
}
export type AiTask = (typeof AI_TASKS)[number];
export type OrchestrationStage = (typeof ORCHESTRATION_STAGES)[number];
export type KnowledgeDefaultView = (typeof KNOWLEDGE_DEFAULT_VIEWS)[number];

export interface ParticipantPresence {
  status: PresenceStatus;
  lastSeenAt: string;
  isTyping: boolean;
  sessionId?: string;
}

export interface Participant {
  id: string;
  name: string;
  profileOwnerId?: string;
  role: ParticipantRole;
  collaborationRole: CollaborationRole;
  customRoleLabel?: string;
  stance: string;
  color: string;
  bio: string;
  avatarLabel: string;
  avatarPreset?: AvatarPreset;
  avatarImageDataUrl?: string;
  seatLabel?: string;
  presence: ParticipantPresence;
}

export interface TranscriptEntry {
  id: string;
  participantId: string;
  ownerParticipantId: string;
  occurredAt: string;
  content: string;
  tags: string[];
  kind: EntryKind;
  highlighted: boolean;
  linkedNodeIds: string[];
  relatedEntryIds: string[];
  source: EntrySource;
  syncState: EntrySyncState;
  roomId: string;
  sessionId: string;
}

export interface ArgumentNode {
  id: string;
  title: string;
  description: string;
  type: ArgumentNodeType;
  participantId?: string;
  entryIds: string[];
  stance: string;
  strength: number;
  status: "open" | "resolved" | "contested";
}

export interface ArgumentRelation {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  type: RelationType;
  note: string;
}

export interface InsightItem {
  id: string;
  category: InsightCategory;
  title: string;
  detail: string;
  severity: 1 | 2 | 3;
  status: InsightStatus;
  relatedEntryIds: string[];
  relatedNodeIds: string[];
}

export interface InsightPanelData {
  updatedAt: string;
  items: InsightItem[];
}

export interface EvaluationSnapshot {
  leaning: string;
  favoredByEvidence: string;
  favoredByResponsiveness: string;
  favoredByLogic: string;
  moreUnanswered: string;
  confidence: string;
  reasons: string[];
  improvementSuggestions: string[];
}

export interface ProjectSummary {
  overview: string;
  participantOverview: string[];
  coreTopics: string[];
  majorClaims: string[];
  keyEvidence: string[];
  majorRebuttals: string[];
  unresolvedQuestions: string[];
  disputes: string[];
  currentConclusion: string;
  nextSteps: string[];
  suggestions: string[];
  followupQuestions: string[];
  evaluation: EvaluationSnapshot;
  history?: ProjectSummaryHistoryEntry[];
}

export interface ProjectSummaryHistoryEntry {
  id: string;
  createdAt: string;
  trigger: "manual" | "auto-basic" | "auto-assistive";
  providerId: ProviderId;
  model: string;
  thresholdUsed?: number;
  nextThreshold?: number;
  throughEntryCount: number;
  overview: string;
  currentConclusion: string;
  nextSteps: string[];
}

export interface RoomPresence {
  participantId: string;
  collaborationRole: CollaborationRole;
  status: PresenceStatus;
  sessionId: string;
  deviceLabel: string;
  connectionId: string;
  lastSeenAt: string;
  active: boolean;
}

export interface RoomSyncState {
  transport: RoomTransport;
  status: RoomSyncStatus;
  latencyMs: number;
  backlog: number;
  streamingReady: boolean;
  lastEventAt: string;
}

export interface RoomSession {
  id: string;
  title: string;
  goal: string;
  hostParticipantId?: string;
  status: RoomSessionStatus;
  startedAt: string;
  endedAt?: string;
  observerIds: string[];
  sync: RoomSyncState;
}

export interface RoomAiConfig {
  providerId: ProviderId;
  model: string;
  ownerIdentityId?: string;
  ownerParticipantId?: string;
  updatedAt: string;
  updatedByParticipantId?: string;
}

export type RoomAiAutomationMode = "auto" | "manual" | "off" | "basic" | "assistive";

export interface RoomAiAutomationPermissions {
  facilitatorCanManage: boolean;
  facilitatorCanTrigger: boolean;
}

export interface RoomAiAutomation {
  mode: RoomAiAutomationMode;
  summaryThreshold?: number;
  summaryCurrentThreshold?: number;
  summaryLastProcessedEntryCount?: number;
  autoReplyThreshold?: number;
  autoEvaluationThreshold?: number;
  autoFollowupThreshold?: number;
  autoFollowupEnabled?: boolean;
  responseStyle?: "objective" | "analytical" | "comprehensive" | "minutes";
  permissions?: RoomAiAutomationPermissions;
}

export interface DiscussionRoom {
  id: string;
  slug: string;
  visibility: RoomVisibility;
  joinMode?: RoomJoinMode;
  accessCode: string;
  notes: string[];
  session: RoomSession;
  presence: RoomPresence[];
  autoSummary: boolean;
  autoEvaluation: boolean;
  aiConfig: RoomAiConfig;
  aiAutomation?: RoomAiAutomation;
  archivedAt?: string;
  archivedBy?: string;
}

export interface ProviderTaskCapabilities {
  realtimeCapture: boolean;
  streaming: boolean;
  testConnection: boolean;
  summarizeDiscussion: boolean;
  evaluateDiscussion: boolean;
  generateFollowupQuestions: boolean;
  multiperspectiveSummary: boolean;
  debateAnalysis: boolean;
  chatConversation: boolean;
}

export interface ProviderModelInputCapabilities {
  text: boolean;
  image: boolean;
  document: boolean;
  video: boolean;
  audio: boolean;
}

export interface ProviderModelOption {
  id: string;
  label: string;
  status: ModelReleaseStage;
  notes?: string;
  recommended?: boolean;
  inputCapabilities?: ProviderModelInputCapabilities;
}

export interface ProviderDescriptor {
  id: ProviderId;
  label: string;
  vendor: string;
  mode: ProviderMode;
  description: string;
  website: string;
  implementationStage: ProviderImplementationStage;
  models: ProviderModelOption[];
  regions: string[];
  capabilities: ProviderTaskCapabilities;
}

export interface ProviderRuntimeConfig {
  providerId: ProviderId;
  enabled: boolean;
  mode: ProviderMode;
  model: string;
  apiKey: string;
  baseUrl: string;
  organization: string;
  notes: string;
  streaming: boolean;
  temperature: number;
  testState: ProviderConnectionState;
  lastCheckedAt?: string;
  hasStoredApiKey?: boolean;
  maskedApiKey?: string;
  clearStoredApiKey?: boolean;
}

export type ProviderRuntimeMap = {
  [Key in ProviderId]: ProviderRuntimeConfig;
};

export interface ProviderConfiguration {
  activeProviderId: ProviderId;
  activeMode: ProviderMode;
  descriptors: ProviderDescriptor[];
  providers: ProviderRuntimeMap;
  mockEmphasis: "balanced" | "evidence" | "responsiveness";
  autoSummary: boolean;
  autoEvaluation: boolean;
  enableStreaming: boolean;
  requestTimeoutMs: number;
  preferServerKeys: boolean;
  allowFallbackToScaffold: boolean;
}

export interface DiscussionProject {
  id: string;
  title: string;
  description: string;
  scenario: ProjectScenario;
  language: AppLocale;
  createdAt: string;
  updatedAt: string;
  status: ProjectStatus;
  goal: string;
  tags: string[];
  participants: Participant[];
  entries: TranscriptEntry[];
  nodes: ArgumentNode[];
  relations: ArgumentRelation[];
  insights: InsightPanelData;
  summary: ProjectSummary;
  room: DiscussionRoom;
  providerSnapshot: {
    providerId: ProviderId;
    model: string;
    generatedAt: string;
    version: string;
  };
  linkedProjectIds?: string[];
  metadata: {
    isSample: boolean;
    source: string;
    sampleKey?: string;
    samplePresentation?: {
      intro: string;
      sections: Array<{
        title: string;
        body: string;
      }>;
      discussionExcerpts: Array<{
        speaker: string;
        role: string;
        body: string;
      }>;
      aiInterventions: Array<{
        title: string;
        body: string;
      }>;
      systemStages: Array<{
        title: string;
        body: string;
      }>;
      graphEvidence: {
        title: string;
        body: string;
      };
      graphHighlights: Array<{
        title: string;
        body: string;
      }>;
    };
    createdByIdentityId?: string;
    archivedAt?: string;
    pendingDeletionAt?: string;
    lastActiveAt?: string;
  };
}

export interface AppSettings {
  locale: AppLocale;
  theme: ThemeMode;
  datetimeFormat: "relative" | "absolute";
  profile: {
    localIdentityId: string;
    displayName: string;
    displayNameIsDefault: boolean;
    avatarPreset: AvatarPreset;
    avatarImageDataUrl?: string;
  };
  appearancePreferences: {
    themePreset: ThemePreset;
    reduceMotion: boolean;
    customTheme: ThemeCustomization;
    customThemeName: string;
    savedThemes: SavedThemePreset[];
  };
  defaultScenario: ProjectScenario;
  defaultExportFormat: ExportFormat;
  provider: ProviderConfiguration;
  discussionPreferences: {
    compactTimeline: boolean;
    highlightKeywords: boolean;
    graphDensity: "comfortable" | "dense";
    defaultWorkspaceTab: WorkspaceDefaultTab;
    singleUserAutoSummaryThreshold: number;
    multiUserAutoSummaryThreshold: number;
    assistiveSummaryThreshold: number;
    latestAiHistoryMode: "latest-only" | "retain";
    latestAiHistoryLimit: number;
    summaryHistoryRetentionMode: "unlimited" | "capped";
    summaryHistoryRetentionLimit: number;
  };
  collaborationPreferences: {
    defaultVisibility: RoomVisibility;
    defaultTransport: RoomTransport;
    sessionAutoStart: boolean;
    sessionAutoArchive: boolean;
    showPresenceIndicators: boolean;
    allowInvites: boolean;
    syncPollingMs: number;
    showSystemEvents: boolean;
    eventHistoryLimit: number;
    defaultMemberRole: CollaborationRole;
    notificationsEnabled: boolean;
    notificationDoNotDisturb: boolean;
  };
  knowledgePreferences: {
    autoExtractOnSave: boolean;
    autoExtractAfterAiTask: boolean;
    includeAttachmentsAsEvidence: boolean;
    includeUnresolvedQuestions: boolean;
    autoGenerateGraphLinks: boolean;
    defaultView: KnowledgeDefaultView;
    defaultGraphMode?: "2d" | "3d" | "both";
    graphOutputLanguage?: "auto" | AppLocale;
  };
  aiPreferences: {
    replyLanguage: "auto" | AppLocale;
    aiRole: "assistant" | "moderator" | "note-taker" | "debate-judge";
    responseLength: "brief" | "standard" | "detailed";
    focusTopics: string;
    autoTagging: boolean;
  };
  uploadPreferences: {
    allowDocuments: boolean;
    allowImages: boolean;
    allowVideos: boolean;
    retainLocalFiles: boolean;
    maxUploadMb: number;
  };
  /** Per-user nicknames for other participants. Keyed by `projectId:participantId`. Only visible to the local user. */
  participantNicknames: Record<string, string>;
  /** User-defined tag colors. Keyed by tag name, value is hex color. */
  tagColors: Record<string, string>;
  /** Custom keyboard shortcut overrides. Keys are action names, values are key combos. */
  customShortcuts: Record<string, string>;
  /** Quick reply templates for fast message insertion. */
  quickReplies: string[];
  /** Project order for drag-and-drop reordering on the dashboard. */
  projectOrder: string[];
  /** User-saved project templates. */
  savedTemplates: Array<{
    id: string;
    name: string;
    scenario: string;
    description: string;
    goal: string;
    tags: string[];
    savedAt: string;
  }>;
  emailNotifications: {
    enabled: boolean;
    emailAddress: string;
    onNewMember: boolean;
    onAiSummary: boolean;
    onRoomArchived: boolean;
  };
  privacy: {
    storeApiKeysLocally: boolean;
    analyticsMode: "local-only" | "manual-export";
    shareDiagnostics: boolean;
    assistantSessionCleanup: {
      enabled: boolean;
      maxIdleDays: 30 | 90 | 180 | 365;
    };
  };
  about: {
    projectName: string;
    version: string;
    repositoryUrl: string;
    license: string;
  };
}
export interface AnalysisContext {
  locale: AppLocale;
  replyLanguage?: "auto" | AppLocale;
  assistantSurface?: "assistant-workspace" | "project-workspace" | "room-facilitator";
  aiRole?: string;
  responseLength?: string;
  focusTopics?: string;
  autoTagging?: boolean;
  emphasis: ProviderConfiguration["mockEmphasis"];
  stage: OrchestrationStage;
  goal: string;
  providerConfig: ProviderRuntimeConfig;
  requestTimeoutMs: number;
  preferServerKeys: boolean;
  allowFallbackToScaffold: boolean;
  enableStreaming?: boolean;
  attachmentContext?: {
    total: number;
    items: Array<{
      id: string;
      name: string;
      kind: "document" | "image" | "video" | "file";
      mimeType: string;
      note: string;
      previewText?: string;
      uploadedAt: string;
      uploadedByParticipantId?: string;
      storage: "local" | "external";
      localPath?: string;
      publicUrl?: string;
    }>;
  };
}

export interface AiTaskOutput {
  topic: string;
  viewpoints: string[];
  arguments: string[];
  evidence: string[];
  conflicts: string[];
  summary: string;
  disputes: string[];
  unresolvedQuestions: string[];
  evaluation: EvaluationSnapshot;
  conclusion: string;
  suggestions: string[];
  recommendations: string[];
  followupQuestions: string[];
  perspectives?: { label: string; summary: string }[];
  debatePoints?: { pro: string[]; con: string[]; neutral: string[] };
}

export interface OrchestrationParticipantView {
  id: string;
  name: string;
  role: ParticipantRole;
  collaborationRole: CollaborationRole;
  stance: string;
  presence: PresenceStatus;
}

export interface OrchestrationPacket {
  providerId: ProviderId;
  task: AiTask;
  stage: OrchestrationStage;
  locale: AppLocale;
  scenario: ProjectScenario;
  projectId: string;
  goal: string;
  room: {
    roomId: string;
    visibility: RoomVisibility;
    sessionId: string;
    sessionTitle: string;
    sessionStatus: RoomSessionStatus;
    transport: RoomTransport;
    syncStatus: RoomSyncStatus;
  };
  participants: OrchestrationParticipantView[];
  transcript: {
    totalEntries: number;
    highlightedEntries: number;
    lastEntryAt?: string;
  };
  attachments: {
    total: number;
    items: Array<{
      id: string;
      name: string;
      kind: "document" | "image" | "video" | "file";
      mimeType: string;
      note: string;
      uploadedAt: string;
      uploadedByParticipantId?: string;
      storage: "local" | "external";
    }>;
  };
  instructions: {
    system: string;
    user: string;
    outputShape: string[];
  };
}

export interface ProviderConnectionResult {
  ok: boolean;
  providerId: ProviderId;
  checkedAt: string;
  message: string;
}

export interface ProviderConversationTurn {
  role: "user" | "assistant";
  content: string;
}

export interface ProviderConversationResult {
  ok: boolean;
  providerId: ProviderId;
  model: string;
  generatedAt: string;
  message: string;
  reply: string;
  reasoning?: string;
}

export interface ProviderConversationStreamChunk {
  type: "content" | "reasoning";
  text: string;
}

export interface ProviderConnectionContext {
  preferServerKeys?: boolean;
  requestTimeoutMs?: number;
}

export interface ProviderTaskResult {
  ok: boolean;
  providerId: ProviderId;
  task: AiTask;
  generatedAt: string;
  message: string;
  packet: OrchestrationPacket;
  output: AiTaskOutput;
}

export interface AnalysisResponse {
  insights: InsightPanelData;
  summary: ProjectSummary;
  providerSnapshot: DiscussionProject["providerSnapshot"];
  orchestration: ProviderTaskResult;
}

export interface AiProvider {
  descriptor: ProviderDescriptor;
  testConnection(config: ProviderRuntimeConfig, context?: ProviderConnectionContext): Promise<ProviderConnectionResult>;
  summarizeDiscussion(project: DiscussionProject, context: AnalysisContext): Promise<ProviderTaskResult>;
  evaluateDiscussion(project: DiscussionProject, context: AnalysisContext): Promise<ProviderTaskResult>;
  generateFollowupQuestions(project: DiscussionProject, context: AnalysisContext): Promise<ProviderTaskResult>;
  multiperspectiveSummary(project: DiscussionProject, context: AnalysisContext): Promise<ProviderTaskResult>;
  debateAnalysis(project: DiscussionProject, context: AnalysisContext): Promise<ProviderTaskResult>;
  respondInConversation(
    project: DiscussionProject,
    context: AnalysisContext,
    options: { prompt: string; history: ProviderConversationTurn[] },
  ): Promise<ProviderConversationResult>;
  streamConversation?(
    project: DiscussionProject,
    context: AnalysisContext,
    options: { prompt: string; history: ProviderConversationTurn[]; signal?: AbortSignal },
  ): Promise<AsyncIterable<ProviderConversationStreamChunk>>;
  analyze(project: DiscussionProject, context: AnalysisContext): Promise<AnalysisResponse>;
}

export interface DashboardProjectSummary {
  id: string;
  title: string;
  description: string;
  scenario: ProjectScenario;
  language: AppLocale;
  updatedAt: string;
  status: ProjectStatus;
  participantCount: number;
  activePresenceCount: number;
  entryCount: number;
  roomStatus: RoomSessionStatus;
  visibility: RoomVisibility;
  providerId: ProviderId;
  isSample: boolean;
  archivedAt?: string;
  pendingDeletionAt?: string;
}

export interface ProjectListItem {
  id: string;
  title: string;
  description: string;
  scenario: ProjectScenario;
  language: AppLocale;
  updatedAt: string;
  status: ProjectStatus;
  goal: string;
  tags: string[];
  participantCount: number;
  activePresenceCount: number;
  entryCount: number;
  roomStatus: RoomSessionStatus;
  visibility: RoomVisibility;
  syncStatus: RoomSyncStatus;
  providerId: ProviderId;
  isSample: boolean;
}

export interface ImportPayload {
  format: ExportFormat | "markdown";
  content: string;
  locale: AppLocale;
}

export interface ImportResult {
  project: DiscussionProject;
  warnings: string[];
}
