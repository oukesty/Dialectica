"use client";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";
import {
  AlertTriangle,
  Archive,
  Bot,
  ChevronDown,
  CircleArrowOutUpRight,
  Copy,
  Crown,
  FileImage,
  FileText,
  MessageSquareText,
  MessagesSquare,
  Paperclip,
  Pencil,
  Pin,
  Radio,
  RotateCcw,
  Trash2,
  Search,
  Send,
  Settings2,
  Smile,
  Shield,
  ShieldCheck,
  Sparkles,
  UserMinus,
  UserPlus,
  Users,
  Video,
  X,
} from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Badge, Button, Panel } from "@/components/ui/primitives";
import { MarkdownContent } from "@/components/ui/markdown-renderer";
import { EmojiPicker } from "@/components/assistant/emoji-picker";
import { useI18n } from "@/components/providers/i18n-provider";
import { buildLatestAiInterventionDigest } from "@/lib/ai/intervention-digest";
import { BASIC_SUMMARY_THRESHOLD_OPTIONS, ASSISTIVE_SUMMARY_THRESHOLD_OPTIONS, normalizeSummaryAutomationConfig, normalizeSummaryThreshold, type NormalizedSummaryAutomationMode } from "@/lib/ai/summary-automation";
import { resolveParticipantAvatar } from "@/lib/avatar";
import { formatDateTime } from "@/lib/format";
import { getBrowserLocalIdentityId } from "@/lib/local-identity";
import { patchProjectState } from "@/lib/project-client";
import { pickInitials } from "@/lib/utils";
import { AiTask, AppLocale, AppSettings, CollaborationRole, DiscussionProject, Participant, PresenceStatus, ProviderId, ProviderModelInputCapabilities } from "@/lib/types";
import { AttachmentKind, CollaborationEvent, CollaborationState } from "@/lib/collaboration/types";
import { getProjectDisplayAccessState, getProjectAccessState, canRemoveParticipant } from "@/lib/project-access";
import { getImplementedConversationInputCapabilities, getProviderDescriptor, getProviderModelInputCapabilities } from "@/lib/providers/provider-catalog";
import { buildCollaborationSyncSignature, buildProjectSyncSignature } from "@/lib/project-sync";
import { patchSettings, primeSettingsSnapshot } from "@/lib/settings-client";
import { consumeStream, StreamChunk } from "@/lib/streaming";

function attachmentIcon(kind: AttachmentKind) {
  if (kind === "image") return FileImage;
  if (kind === "video") return Video;
  return FileText;
}

function toneForPresence(status: PresenceStatus): "default" | "accent" | "success" | "danger" {
  if (status === "online") return "success";
  if (status === "syncing") return "accent";
  if (status === "leaving") return "default";
  if (status === "offline") return "danger";
  return "default";
}

function transportLabel(
  transport: CollaborationState["sync"]["transport"],
  t: (key: string, params?: Record<string, string>) => string,
) {
  return t(`collaborationTransport.${transport}`);
}

function inviteStatusLabel(
  status: CollaborationState["invites"][number]["status"],
  t: (key: string, params?: Record<string, string>) => string,
) {
  return t(`inviteStatus.${status}`);
}

function attachmentKindLabel(kind: AttachmentKind, t: (key: string, params?: Record<string, string>) => string) {
  return t(`attachmentKinds.${kind}`);
}

function buildAttachmentHref(projectId: string, attachment: { id: string; publicUrl?: string }) {
  return attachment.publicUrl || `/api/projects/${projectId}/attachments/${attachment.id}`;
}

function eventLabel(event: CollaborationEvent, t: (key: string, params?: Record<string, string>) => string) {
  if (event.actorType === "ai") {
    return event.aiTask ? t(`project.collaborationPanel.aiTasks.${event.aiTask}`) : t("project.collaborationPanel.actorAi");
  }
  if (event.type === "invite") return t("project.collaborationPanel.eventInvite");
  if (event.type === "presence") return t("project.collaborationPanel.eventPresence");
  if (event.type === "attachment") return t("project.collaborationPanel.eventAttachment");
  if (event.type === "join") return t("project.collaborationPanel.eventJoin");
  if (event.type === "leave") return t("project.collaborationPanel.eventLeave");
  if (event.actorType === "system") return t("project.collaborationPanel.eventSystem");
  return t("project.collaborationPanel.actorParticipant");
}

/** Typewriter effect for AI messages. Shows text progressively. */
function TypewriterText({ text, speed = 12, onComplete }: { text: string; speed?: number; onComplete?: () => void }) {
  const [displayed, setDisplayed] = useState("");
  const indexRef = useRef(0);

  useEffect(() => {
    // Reset on text change
    indexRef.current = 0;
    setDisplayed("");
    const timer = setInterval(() => {
      const nextIndex = Math.min(indexRef.current + speed, text.length);
      indexRef.current = nextIndex;
      setDisplayed(text.slice(0, nextIndex));
      if (nextIndex >= text.length) {
        clearInterval(timer);
        onComplete?.();
      }
    }, 16);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally reset only on text change
  }, [text]);

  return <>{displayed}{displayed.length < text.length ? <span className="animate-pulse">|</span> : null}</>;
}

/** Stop button for interrupting AI response display */
function StopButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button type="button" onClick={onClick} className="room-action-kick mt-2 inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition">
      {"\u25A0"} {label}
    </button>
  );
}

function advanceVisibleStreamText(current: string, target: string, maxStep: number) {
  if (current.length >= target.length) return target;
  return target.slice(0, Math.min(target.length, current.length + Math.max(1, maxStep)));
}

const AUTO_SCROLL_THRESHOLD_PX = 96;
const INITIAL_VISIBLE_ROOM_EVENT_COUNT = 60;
const ROOM_EVENT_HISTORY_PAGE_SIZE = 30;
const HISTORY_LOAD_TRIGGER_PX = 48;
const MULTI_USER_SUMMARY_MODE_OPTIONS: NormalizedSummaryAutomationMode[] = ["off", "basic", "assistive"];
const SINGLE_USER_SUMMARY_MODE_OPTIONS: NormalizedSummaryAutomationMode[] = ["off", "basic"];

function highlightChatSearch(text: string, query: string): React.ReactNode {
  if (!query) return text;
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let idx = lowerText.indexOf(lowerQuery);
  let key = 0;
  while (idx !== -1) {
    if (idx > lastIndex) parts.push(text.slice(lastIndex, idx));
    parts.push(<mark key={key++} className="rounded bg-amber-300/40 px-0.5 text-inherit dark:bg-amber-500/30">{text.slice(idx, idx + query.length)}</mark>);
    lastIndex = idx + query.length;
    idx = lowerText.indexOf(lowerQuery, lastIndex);
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return parts.length > 0 ? <>{parts}</> : text;
}

function actorDisplayName(
  event: CollaborationEvent,
  providerId: ProviderId,
  t: (key: string, params?: Record<string, string>) => string,
) {
  if (event.actorType === "ai") return providerId === "mock" ? t("project.collaborationPanel.actorAi") : t(`providersCatalog.${providerId}.label`);
  if (event.actorType === "system") return t("project.collaborationPanel.actorSystem");
  return event.participantName ?? t("common.someone");
}

type EventBadgeDescriptor = {
  key: string;
  label: string;
  tone?: "default" | "accent" | "success";
};

function normalizeEventBadgeLabel(label: string) {
  return label.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

function dedupeEventBadges(badges: EventBadgeDescriptor[]) {
  const seenKeys = new Set<string>();
  const seenLabels = new Set<string>();
  return badges.filter((badge) => {
    const labelKey = normalizeEventBadgeLabel(badge.label);
    if (seenKeys.has(badge.key) || seenLabels.has(labelKey)) return false;
    seenKeys.add(badge.key);
    seenLabels.add(labelKey);
    return true;
  });
}

function buildEventBadges(
  event: CollaborationEvent,
  providerId: ProviderId,
  t: (key: string, params?: Record<string, string>) => string,
) {
  const badges: EventBadgeDescriptor[] = [];

  if (event.actorType === "participant") {
    if (event.role) {
      badges.push({
        key: `role:${event.role}`,
        label: t(`collaborationRoles.${event.role}`),
        tone: event.role === "host" || event.role === "facilitator" ? "success" : "default",
      });
    } else {
      badges.push({
        key: "actor:participant",
        label: t("project.collaborationPanel.actorParticipant"),
        tone: "success",
      });
    }
    if (event.type !== "message") {
      badges.push({ key: `event:${event.type}`, label: eventLabel(event, t) });
    }
    return dedupeEventBadges(badges);
  }

  if (event.actorType === "system") {
    badges.push({ key: `event:${event.type}`, label: eventLabel(event, t) });
    return dedupeEventBadges(badges);
  }

  if (event.actorType === "ai") {
    if (event.aiTask) {
      badges.push({
        key: `ai-task:${event.aiTask}`,
        label: t(`project.collaborationPanel.aiTasks.${event.aiTask}`),
        tone: "accent",
      });
    } else if (normalizeEventBadgeLabel(actorDisplayName(event, providerId, t)) !== normalizeEventBadgeLabel(t("project.collaborationPanel.actorAi"))) {
      badges.push({
        key: "actor:ai",
        label: t("project.collaborationPanel.actorAi"),
        tone: "accent",
      });
    }
  }

  return dedupeEventBadges(badges);
}

function isMeaningfulAiIntervention(event: CollaborationEvent) {
  if (event.actorType !== "ai") return false;
  if (event.aiTask) return true;
  if (event.metadata.assistant === "true") return false;
  return event.message.trim().length >= 40;
}

const fieldClass = "form-field";

const providerBadgeStyles: Record<ProviderId, { label: string; className: string }> = {
  mock: { label: "MK", className: "bg-gradient-to-br from-slate-700 to-slate-500 text-white" },
  disabled: { label: "--", className: "bg-gradient-to-br from-zinc-500 to-zinc-400 text-white" },
  openai: { label: "OA", className: "bg-gradient-to-br from-emerald-500 to-teal-600 text-white" },
  gemini: { label: "GM", className: "bg-gradient-to-br from-sky-500 to-indigo-600 text-white" },
  grok: { label: "xA", className: "bg-gradient-to-br from-fuchsia-500 to-violet-600 text-white" },
  claude: { label: "CL", className: "bg-gradient-to-br from-orange-500 to-amber-500 text-white" },
  deepseek: { label: "DK", className: "bg-gradient-to-br from-cyan-500 to-sky-600 text-white" },
  doubao: { label: "DB", className: "bg-gradient-to-br from-rose-500 to-orange-500 text-white" },
  qwen: { label: "QW", className: "bg-gradient-to-br from-indigo-500 to-blue-700 text-white" },
};

const providerReplyAvatarSources: Partial<Record<ProviderId, string>> = {
  claude: "/ai-avatars/claude.jpg",
  deepseek: "/ai-avatars/deepseek.png",
  disabled: "/ai-avatars/disabled.jpg",
  doubao: "/ai-avatars/doubao.jpg",
  gemini: "/ai-avatars/gemini.jpg",
  grok: "/ai-avatars/grok.jpg",
  openai: "/ai-avatars/openai.jpg",
  qwen: "/ai-avatars/qwen.jpg",
};

function ProviderAvatarBadge({ providerId, className = "" }: { providerId: ProviderId; className?: string }) {
  const style = providerBadgeStyles[providerId] ?? providerBadgeStyles.mock;
  return (
    <span className={`inline-flex h-10 w-10 items-center justify-center rounded-2xl text-[11px] font-semibold tracking-[0.18em] shadow-sm ${style.className} ${className}`.trim()}>
      {style.label}
    </span>
  );
}

function ProviderReplyAvatar({ providerId, className = "" }: { providerId: ProviderId; className?: string }) {
  const src = providerReplyAvatarSources[providerId];
  if (!src) {
    if (providerId === "mock") {
      return (
        <span className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-cyan-400/30 bg-gradient-to-br from-sky-500 via-cyan-500 to-blue-700 text-white shadow-sm ring-1 ring-white/60 ${className}`.trim()}>
          <Bot className="h-5 w-5" aria-hidden="true" />
          <span className="sr-only">AI</span>
        </span>
      );
    }
    return <ProviderAvatarBadge providerId={providerId} className={className} />;
  }

  return (
    <span className={`relative inline-flex h-10 w-10 shrink-0 overflow-hidden rounded-2xl bg-white ${className}`.trim()}>
      <Image src={src} alt="" fill sizes="40px" className="object-contain" />
    </span>
  );
}

function SystemAvatarBadge({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-sky-500/25 bg-gradient-to-br from-sky-100 via-cyan-50 to-slate-100 text-sky-700 shadow-sm ring-1 ring-white/70 dark:from-sky-500/20 dark:via-cyan-500/10 dark:to-slate-700/30 dark:text-sky-100 ${className}`.trim()}>
      <ShieldCheck className="h-5 w-5" aria-hidden="true" />
      <span className="sr-only">System</span>
    </span>
  );
}

type PendingCollaborationReply = {
  userMessage: string;
  attachmentIds: string[];
  providerId: ProviderId;
  model: string;
  submittedAt: string;
  regenerate?: boolean;
  replaceAssistantEventId?: string;
};

type InterruptedCollaborationReply = PendingCollaborationReply & {
  partialContent: string;
  partialReasoning: string;
};

type CollaborationRegenerateTarget = {
  userMessage: string;
  attachmentIds: string[];
  replaceAssistantEventId?: string;
};

function getAssistantRevisionView(event: CollaborationEvent) {
  const revisions = Array.isArray(event.revisions)
    ? event.revisions.filter((revision) => revision.content.trim().length > 0)
    : [];
  if (revisions.length <= 1) {
    return null;
  }
  const matchedIndex = revisions.findIndex((revision) => revision.id === event.activeRevisionId);
  const activeIndex = matchedIndex >= 0 ? matchedIndex : revisions.length - 1;
  return {
    revisions,
    activeIndex,
    activeRevision: revisions[activeIndex] ?? revisions[revisions.length - 1],
  };
}

const conversationDocumentExtensions = [
  ".txt",
  ".md",
  ".markdown",
  ".json",
  ".csv",
  ".tsv",
  ".yaml",
  ".yml",
  ".xml",
  ".html",
  ".htm",
  ".css",
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
];

const uploadDocumentExtensions = [
  ...conversationDocumentExtensions,
  ".pdf",
  ".doc",
  ".docx",
];

function buildDocumentUploadAccept() {
  return [
    "text/*",
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ...uploadDocumentExtensions,
  ].join(",");
}

function isDirectConversationDocument(file: File) {
  return file.type.startsWith("text/")
    || /(json|xml|javascript|csv|yaml|html)/i.test(file.type)
    || conversationDocumentExtensions.some((extension) => file.name.toLowerCase().endsWith(extension));
}

function attachmentCanDirectConversation(
  attachment: { kind: AttachmentKind; previewText?: string },
  capabilities: ProviderModelInputCapabilities,
) {
  if (attachment.kind === "image") return capabilities.image;
  return attachment.kind === "document" && capabilities.document && Boolean(attachment.previewText?.trim());
}

function fileWillTravelDirectly(file: File, source: "image" | "document", capabilities: ProviderModelInputCapabilities) {
  if (source === "image") {
    return capabilities.image && file.type.startsWith("image/");
  }
  return capabilities.document && isDirectConversationDocument(file);
}

export function ProjectCollaborationPanel({
  locale,
  project,
  syncProject,
  settings,
  onRunAiTask,
  onProjectChange,
  taskBusy,
  sampleReadOnlyLocked = false,
}: {
  locale: AppLocale;
  project: DiscussionProject;
  syncProject?: DiscussionProject;
  settings: AppSettings;
  onRunAiTask?: (task: AiTask) => void;
  onProjectChange?: (project: DiscussionProject) => void;
  taskBusy?: string | null;
  sampleReadOnlyLocked?: boolean;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const feedRef = useRef<HTMLDivElement | null>(null);
  const shouldAutoScrollRef = useRef(true);
  const imageFileRef = useRef<HTMLInputElement | null>(null);
  const documentFileRef = useRef<HTMLInputElement | null>(null);
  const refreshAbortRef = useRef<AbortController | null>(null);
  const stateVersionRef = useRef(0);
  const collaborationSignatureRef = useRef("");
  const projectSyncTarget = syncProject ?? project;
  const projectSignatureRef = useRef(buildProjectSyncSignature(projectSyncTarget));
  const activeProjectIdRef = useRef(project.id);
  const lastAutoPresenceRef = useRef<PresenceStatus | null>(null);
  const [state, setState] = useState<CollaborationState | null>(null);
  const [busy, setBusy] = useState(false);
  const [publishingSolo, setPublishingSolo] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [inviteRole, setInviteRole] = useState<Participant["collaborationRole"]>("participant");
  const [inviteNote, setInviteNote] = useState("");
  const [inviteHours, setInviteHours] = useState("24");
  const [messageDraft, setMessageDraft] = useState("");
  const [pendingAttachmentIds, setPendingAttachmentIds] = useState<string[]>([]);
  const [pageVisible, setPageVisible] = useState(typeof document === "undefined" ? true : !document.hidden);
  const [networkOnline, setNetworkOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine);
  const [presenceStatusHydrated, setPresenceStatusHydrated] = useState(false);
  const [acceptToken, setAcceptToken] = useState("");
  const [acceptName, setAcceptName] = useState(settings.profile.displayName);
  const [pendingReply, setPendingReply] = useState<PendingCollaborationReply | null>(null);
  const [interruptedReply, setInterruptedReply] = useState<InterruptedCollaborationReply | null>(null);
  const initialSummaryAutomation = normalizeSummaryAutomationConfig(project.room.aiAutomation);
  const [roomAiMode, setRoomAiMode] = useState<NormalizedSummaryAutomationMode>(initialSummaryAutomation.mode);
  const [roomAiThreshold, setRoomAiThreshold] = useState(String(initialSummaryAutomation.summaryThreshold));
  const [roomAiAdminCanManage, setRoomAiAdminCanManage] = useState(project.room.aiAutomation?.permissions?.facilitatorCanManage ?? false);
  const [roomAiAdminCanTrigger, setRoomAiAdminCanTrigger] = useState(project.room.aiAutomation?.permissions?.facilitatorCanTrigger ?? false);
  const [roomAiBusy, setRoomAiBusy] = useState(false);
  const [manageBusy, setManageBusy] = useState(false);
  const [confirmAction, setConfirmAction] = useState<{ type: "kick" | "transfer" | "destroy"; participantId?: string; participantName?: string } | null>(null);
  const [roleMenuOpen, setRoleMenuOpen] = useState<string | null>(null);
  const [presenceManagerOpen, setPresenceManagerOpen] = useState(false);
  const [nicknameEditing, setNicknameEditing] = useState<string | null>(null);
  const [nicknameDraft, setNicknameDraft] = useState("");
  const [nicknames, setNicknames] = useState<Record<string, string>>(settings.participantNicknames ?? {});
  const [chatSearch, setChatSearch] = useState("");
  const [visibleEventCount, setVisibleEventCount] = useState(INITIAL_VISIBLE_ROOM_EVENT_COUNT);
  const [loadingOlderEvents, setLoadingOlderEvents] = useState(false);
  const [typingEventId, setTypingEventId] = useState<string | null>(null);
  const [stoppedTypingIds, setStoppedTypingIds] = useState<Set<string>>(new Set());
  const prevEventCountRef = useRef(0);
  const restoreFeedScrollRef = useRef<{ previousScrollHeight: number } | null>(null);
  const loadingOlderEventsRef = useRef(false);
  const streamingContentRef = useRef("");
  const streamingReasoningRef = useRef("");
  const streamVisibleContentRef = useRef("");
  const streamVisibleReasoningRef = useRef("");
  const streamFinalizeRef = useRef<(() => void) | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamContent, setStreamContent] = useState("");
  const [streamReasoning, setStreamReasoning] = useState("");
  const streamAbortRef = useRef<(() => void) | null>(null);
  const streamRafId = useRef(0);
  const streamActiveRef = useRef(false);
  const [replyToEvent, setReplyToEvent] = useState<{ id: string; name: string; text: string } | null>(null);
  const [editingEvent, setEditingEvent] = useState<{ id: string; message: string } | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const dragCounter = useRef(0);
  const [showQuickReplies, setShowQuickReplies] = useState(false);
  const [showMentionPopup, setShowMentionPopup] = useState(false);
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const lastPresenceSyncWarningAtRef = useRef(0);
  const [currentLocalIdentityId, setCurrentLocalIdentityId] = useState(settings.profile.localIdentityId);
  const [resolvedSettings, setResolvedSettings] = useState(settings);

  const participants = project.participants;
  const singleUserMode = project.scenario === "ai-dialogue" && participants.length === 1;
  useEffect(() => {
    const nextIdentity = getBrowserLocalIdentityId(settings.profile.localIdentityId);
    if (nextIdentity && nextIdentity !== currentLocalIdentityId) {
      setCurrentLocalIdentityId(nextIdentity);
    }
  }, [currentLocalIdentityId, settings.profile.localIdentityId]);

  useEffect(() => {
    setResolvedSettings(settings);
  }, [settings]);

  useEffect(() => {
    if (!currentLocalIdentityId) return;
    if (currentLocalIdentityId === settings.profile.localIdentityId) {
      setResolvedSettings(settings);
      return;
    }

    const controller = new AbortController();
    void fetch(`/api/settings?identityId=${encodeURIComponent(currentLocalIdentityId)}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) return null;
        const payload = (await response.json().catch(() => null)) as { settings?: AppSettings } | null;
        return payload?.settings ?? null;
      })
      .then((nextSettings) => {
        if (nextSettings?.profile?.localIdentityId === currentLocalIdentityId) {
          setResolvedSettings(nextSettings);
        }
      })
      .catch(() => {});

    return () => controller.abort();
  }, [currentLocalIdentityId, settings]);

  const effectiveSettings = useMemo<AppSettings>(() => (
    currentLocalIdentityId === resolvedSettings.profile.localIdentityId
      ? resolvedSettings
      : {
          ...resolvedSettings,
          profile: {
            ...resolvedSettings.profile,
            localIdentityId: currentLocalIdentityId,
          },
        }
  ), [currentLocalIdentityId, resolvedSettings]);
  const availableSummaryModeOptions = useMemo<NormalizedSummaryAutomationMode[]>(
    () => (singleUserMode ? SINGLE_USER_SUMMARY_MODE_OPTIONS : MULTI_USER_SUMMARY_MODE_OPTIONS),
    [singleUserMode],
  );
  const recommendedAutomationThreshold = useCallback((mode: NormalizedSummaryAutomationMode) => {
    if (mode === "assistive") {
      return effectiveSettings.discussionPreferences.assistiveSummaryThreshold;
    }
    return singleUserMode
      ? effectiveSettings.discussionPreferences.singleUserAutoSummaryThreshold
      : effectiveSettings.discussionPreferences.multiUserAutoSummaryThreshold;
  }, [
    effectiveSettings.discussionPreferences.assistiveSummaryThreshold,
    effectiveSettings.discussionPreferences.multiUserAutoSummaryThreshold,
    effectiveSettings.discussionPreferences.singleUserAutoSummaryThreshold,
    singleUserMode,
  ]);

  const mutationAccess = useMemo(() => getProjectAccessState(project, effectiveSettings), [effectiveSettings, project]);
  const access = useMemo(() => getProjectDisplayAccessState(project, effectiveSettings), [effectiveSettings, project]);
  const sampleMutationLocked = sampleReadOnlyLocked || mutationAccess.isProtectedSample;
  const sampleMutationMessage = t("project.sampleMutationBlocked");
  const autoPresenceParticipantId = mutationAccess.ownedParticipantIds[0] ?? "";
  const displayOwnedParticipantIds = useMemo(() => new Set(access.ownedParticipantIds), [access.ownedParticipantIds]);
  const isDisplayOwnedParticipant = (participant?: Participant | null) => Boolean(participant && displayOwnedParticipantIds.has(participant.id));
  const identitySettingsReady = currentLocalIdentityId === effectiveSettings.profile.localIdentityId;
  const effectiveSingleUserProviderId: ProviderId = singleUserMode
    ? ((identitySettingsReady && (project.room.aiConfig.ownerIdentityId === effectiveSettings.profile.localIdentityId || access.ownedParticipantIds.length > 0))
        ? effectiveSettings.provider.activeProviderId
        : project.room.aiConfig.providerId)
    : project.room.aiConfig.providerId;
  const [localModelOverride, setLocalModelOverride] = useState<string | null>(null);
  const baseSingleUserModel = singleUserMode
    ? ((identitySettingsReady && (project.room.aiConfig.ownerIdentityId === effectiveSettings.profile.localIdentityId || access.ownedParticipantIds.length > 0))
        ? effectiveSettings.provider.providers[effectiveSingleUserProviderId].model
        : project.room.aiConfig.model)
    : project.room.aiConfig.model;
  const effectiveSingleUserModel = localModelOverride ?? baseSingleUserModel;
  const effectiveSingleUserProviderDescriptor = useMemo(
    () => getProviderDescriptor(effectiveSingleUserProviderId),
    [effectiveSingleUserProviderId],
  );
  const effectiveSingleUserProviderRuntime = effectiveSettings.provider.providers[effectiveSingleUserProviderId];
  const singleUserModelCapabilities = getProviderModelInputCapabilities(effectiveSingleUserProviderId, effectiveSingleUserModel);
  const singleUserConversationCapabilities = useMemo(
    () => getImplementedConversationInputCapabilities(effectiveSingleUserProviderId, effectiveSingleUserModel),
    [effectiveSingleUserModel, effectiveSingleUserProviderId],
  );
  const baseCanStageImages = effectiveSettings.uploadPreferences.allowImages;
  const baseCanStageDocuments = effectiveSettings.uploadPreferences.allowDocuments;
  // In single-user mode, hide image/file buttons when the model doesn't support them
  // In multi-user mode, always show (files are shared with all participants, not just AI)
  const canStageImages = singleUserMode ? baseCanStageImages && singleUserConversationCapabilities.image : baseCanStageImages;
  const canStageDocuments = singleUserMode ? baseCanStageDocuments && singleUserConversationCapabilities.document : baseCanStageDocuments;
  const canUseStreaming = singleUserMode
    && effectiveSettings.provider.enableStreaming
    && Boolean(effectiveSingleUserProviderDescriptor?.capabilities.streaming)
    && effectiveSingleUserProviderRuntime?.streaming !== false;
  const autoPresenceStatus = useMemo<PresenceStatus | null>(() => {
    if (!mutationAccess.canUpdatePresence || !autoPresenceParticipantId) return null;
    if (!networkOnline) return "offline";
    if (!pageVisible) return "away";
    if (busy || publishingSolo || Boolean(taskBusy)) return "syncing";
    return "online";
  }, [mutationAccess.canUpdatePresence, autoPresenceParticipantId, busy, networkOnline, pageVisible, publishingSolo, taskBusy]);

  useEffect(() => {
    stateVersionRef.current = state?.version ?? 0;
    collaborationSignatureRef.current = buildCollaborationSyncSignature(state);
  }, [state]);

  useEffect(() => {
    primeSettingsSnapshot(effectiveSettings);
  }, [effectiveSettings]);

  useEffect(() => {
    projectSignatureRef.current = buildProjectSyncSignature(projectSyncTarget);
    if (activeProjectIdRef.current !== project.id) {
      activeProjectIdRef.current = project.id;
      shouldAutoScrollRef.current = true;
      setPendingReply(null);
      setInterruptedReply(null);
    }
  }, [project.id, projectSyncTarget]);

  useEffect(() => {
    const automation = normalizeSummaryAutomationConfig(project.room.aiAutomation);
    const normalizedMode = singleUserMode && automation.mode === "assistive" ? "basic" : automation.mode;
    const thresholdFallback = recommendedAutomationThreshold(normalizedMode === "off" ? "basic" : normalizedMode);
    const normalizedThreshold = normalizeSummaryThreshold(
      automation.summaryThreshold,
      normalizedMode === "assistive" ? "assistive" : "basic",
      thresholdFallback,
    );
    setRoomAiMode(normalizedMode);
    setRoomAiThreshold(String(normalizedThreshold));
    setRoomAiAdminCanManage(project.room.aiAutomation?.permissions?.facilitatorCanManage ?? false);
    setRoomAiAdminCanTrigger(project.room.aiAutomation?.permissions?.facilitatorCanTrigger ?? false);
  }, [project.room.aiAutomation, recommendedAutomationThreshold, singleUserMode]);

  useEffect(() => {
    if (typeof document === "undefined" || typeof window === "undefined") return undefined;
    const updateVisibility = () => setPageVisible(!document.hidden);
    const markVisible = () => setPageVisible(true);
    const markHidden = () => setPageVisible(false);
    const markOnline = () => setNetworkOnline(true);
    const markOffline = () => setNetworkOnline(false);
    updateVisibility();
    setNetworkOnline(typeof navigator === "undefined" ? true : navigator.onLine);
    setPresenceStatusHydrated(true);
    document.addEventListener("visibilitychange", updateVisibility);
    window.addEventListener("focus", markVisible);
    window.addEventListener("blur", markHidden);
    window.addEventListener("online", markOnline);
    window.addEventListener("offline", markOffline);
    return () => {
      document.removeEventListener("visibilitychange", updateVisibility);
      window.removeEventListener("focus", markVisible);
      window.removeEventListener("blur", markHidden);
      window.removeEventListener("online", markOnline);
      window.removeEventListener("offline", markOffline);
    };
  }, []);

  const readErrorMessage = async (response: Response) => {
    try {
      const payload = (await response.json()) as { error?: string };
      return payload.error || t("errors.unexpected");
    } catch {
      return t("errors.unexpected");
    }
  };

  const hasStreamingPreview = streamContent.length > 0 || streamReasoning.length > 0;

  const resetStreamingPreview = () => {
    streamingContentRef.current = "";
    streamingReasoningRef.current = "";
    streamVisibleContentRef.current = "";
    streamVisibleReasoningRef.current = "";
    streamFinalizeRef.current = null;
    setStreamContent("");
    setStreamReasoning("");
  };

  const copyMessageText = async (text: string) => {
    if (!text.trim()) return;
    try {
      await navigator.clipboard.writeText(text);
      setMessage(t("common.copied"));
    } catch {
      setMessage(t("common.copyFailed"));
    }
  };

  const clampAutomationThreshold = (value: number, mode: NormalizedSummaryAutomationMode, fallback: number) => {
    if (!Number.isFinite(value)) return fallback;
    return normalizeSummaryThreshold(value, mode === "assistive" ? "assistive" : "basic", fallback);
  };

  const buildRoomAiAutomationPayload = useCallback((overrides?: Partial<DiscussionProject["room"]["aiAutomation"]>) => {
    const mergedPermissions = {
      facilitatorCanManage: roomAiAdminCanManage,
      facilitatorCanTrigger: roomAiAdminCanTrigger,
      ...project.room.aiAutomation?.permissions,
      ...overrides?.permissions,
    };

    const requestedMode = (overrides?.mode ?? roomAiMode) as NormalizedSummaryAutomationMode;
    const nextMode = singleUserMode && requestedMode === "assistive" ? "basic" : requestedMode;
    const recommendedThreshold = recommendedAutomationThreshold(nextMode === "off" ? "basic" : nextMode);
    const nextThreshold = overrides?.summaryThreshold
      ?? clampAutomationThreshold(Number(roomAiThreshold), nextMode, recommendedThreshold);
    const currentThreshold = overrides?.summaryCurrentThreshold
      ?? project.room.aiAutomation?.summaryCurrentThreshold
      ?? nextThreshold;

    return {
      mode: nextMode,
      summaryThreshold: nextThreshold,
      summaryCurrentThreshold: nextMode === "assistive"
        ? normalizeSummaryThreshold(currentThreshold, "assistive", nextThreshold)
        : nextThreshold,
      summaryLastProcessedEntryCount: overrides?.summaryLastProcessedEntryCount
        ?? project.room.aiAutomation?.summaryLastProcessedEntryCount
        ?? 0,
      autoReplyThreshold: nextThreshold,
      permissions: mergedPermissions,
    };
  }, [
    project.room.aiAutomation,
    recommendedAutomationThreshold,
    roomAiAdminCanManage,
    roomAiAdminCanTrigger,
    roomAiMode,
    roomAiThreshold,
    singleUserMode,
  ]);

  const startNewChat = () => {
    router.push(`/${locale}/assistant/new?fresh=${Date.now()}`);
  };

  const handleComposerKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.shiftKey || (event.nativeEvent as KeyboardEvent).isComposing) return;
    if (event.key !== "Enter") return;
    event.preventDefault();
    if (busy || !access.canPostMessages || (!messageDraft.trim() && pendingAttachmentIds.length === 0)) return;
    void submitMessage();
  };

  const refresh = useCallback(async (options?: { background?: boolean }) => {
    if (options?.background && typeof document !== "undefined" && document.hidden) {
      return;
    }

    refreshAbortRef.current?.abort();
    const controller = new AbortController();
    refreshAbortRef.current = controller;

    try {
      const params = new URLSearchParams({ locale });
      if (stateVersionRef.current > 0) {
        params.set("sinceVersion", String(stateVersionRef.current));
      }
      if (projectSignatureRef.current) {
        params.set("projectSync", projectSignatureRef.current);
      }
      const response = await fetch(`/api/projects/${project.id}/collaboration?${params.toString()}`, {
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok) return;
      const payload = (await response.json()) as {
        unchanged?: boolean;
        collaboration?: CollaborationState;
        project?: DiscussionProject;
        collaborationVersion?: number;
        projectSync?: string;
      };
      if (controller.signal.aborted) return;
      if (payload.collaboration) {
        const nextCollaborationSignature = buildCollaborationSyncSignature(payload.collaboration);
        stateVersionRef.current = payload.collaboration.version;
        if (nextCollaborationSignature !== collaborationSignatureRef.current) {
          collaborationSignatureRef.current = nextCollaborationSignature;
          setState(payload.collaboration);
        }
      } else if (typeof payload.collaborationVersion === "number") {
        stateVersionRef.current = payload.collaborationVersion;
      }
      if (payload.project) {
        const nextProjectSignature = buildProjectSyncSignature(payload.project);
        if (nextProjectSignature !== projectSignatureRef.current) {
          projectSignatureRef.current = nextProjectSignature;
          onProjectChange?.(payload.project);
        }
      } else if (payload.projectSync) {
        projectSignatureRef.current = payload.projectSync;
      }
    } catch {
      if (controller.signal.aborted) return;
    } finally {
      if (refreshAbortRef.current === controller) {
        refreshAbortRef.current = null;
      }
    }
  }, [locale, onProjectChange, project.id]);

  const runInlineEventMutation = useCallback(async (
    body: { eventId: string; emoji?: string; action?: "edit" | "delete" | "pin" | "unpin" | "activateRevision"; message?: string; revisionId?: string },
    options?: { closeDeleteConfirm?: boolean; closeEditingEvent?: boolean },
  ) => {
    setMessage(null);
    try {
      const response = await fetch(`/api/projects/${project.id}/events?locale=${locale}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = (await response.json().catch(() => null)) as { collaboration?: CollaborationState; error?: string } | null;
      if (!response.ok) {
        throw new Error(payload?.error ?? t("errors.unexpected"));
      }
      if (payload?.collaboration) {
        setState(payload.collaboration);
      } else {
        await refresh();
      }
      if (options?.closeDeleteConfirm) {
        setDeleteConfirmId(null);
      }
      if (options?.closeEditingEvent) {
        setEditingEvent(null);
      }
      return true;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("errors.unexpected"));
      return false;
    }
  }, [locale, project.id, refresh, t]);

  useEffect(() => {
    if (!acceptName.trim()) setAcceptName(effectiveSettings.profile.displayName);
  }, [acceptName, effectiveSettings.profile.displayName]);

  useEffect(() => {
    void refresh();
    let timer: number | null = null;
    let sse: EventSource | null = null;
    let sseConnected = false;

    // Try SSE first, fall back to polling
    if (typeof EventSource !== "undefined") {
      try {
        sse = new EventSource(`/api/projects/${project.id}/events/stream?locale=${encodeURIComponent(locale)}`);
        sse.addEventListener("connected", () => { sseConnected = true; });
        sse.addEventListener("update", () => { void refresh({ background: true }); });
        sse.addEventListener("error", () => {
          // SSE failed — fall back to polling
          if (!sseConnected && !timer) {
            timer = window.setInterval(() => void refresh({ background: true }), settings.collaborationPreferences.syncPollingMs) as unknown as number;
          }
        });
      } catch {
        sse = null;
      }
    }

    if (!sse) {
      timer = window.setInterval(() => void refresh({ background: true }), settings.collaborationPreferences.syncPollingMs) as unknown as number;
    }

    const handleVisibilityChange = () => {
      if (!document.hidden) void refresh();
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      if (timer) window.clearInterval(timer);
      if (sse) { sse.close(); sse = null; }
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      refreshAbortRef.current?.abort();
      refreshAbortRef.current = null;
    };
  }, [project.id, refresh, settings.collaborationPreferences.syncPollingMs]);

  useEffect(() => {
    if (!taskBusy) {
      void refresh();
    }
  }, [refresh, taskBusy]);

  const visibleEvents = useMemo(() => {
    if (!state) return [];
    let filtered = settings.collaborationPreferences.showSystemEvents
      ? state.events.filter((event) => event.type !== "presence")
      : state.events.filter((event) => event.type === "message" || event.actorType === "ai");
    filtered = filtered.slice(-settings.collaborationPreferences.eventHistoryLimit);
    if (chatSearch.trim()) {
      const q = chatSearch.trim().toLowerCase();
      filtered = filtered.filter((event) =>
        event.message.toLowerCase().includes(q) ||
        (event.participantName ?? "").toLowerCase().includes(q)
      );
    }
    return filtered;
  }, [chatSearch, settings.collaborationPreferences.eventHistoryLimit, settings.collaborationPreferences.showSystemEvents, state]);
  const hiddenVisibleEventCount = Math.max(0, visibleEvents.length - visibleEventCount);
  const renderedVisibleEvents = useMemo(
    () => hiddenVisibleEventCount > 0 ? visibleEvents.slice(-visibleEventCount) : visibleEvents,
    [hiddenVisibleEventCount, visibleEventCount, visibleEvents],
  );

  useEffect(() => {
    setVisibleEventCount(INITIAL_VISIBLE_ROOM_EVENT_COUNT);
    setLoadingOlderEvents(false);
    loadingOlderEventsRef.current = false;
    restoreFeedScrollRef.current = null;
  }, [
    chatSearch,
    project.id,
    settings.collaborationPreferences.eventHistoryLimit,
    settings.collaborationPreferences.showSystemEvents,
  ]);

  useEffect(() => {
    if (!feedRef.current) return;
    if (!shouldAutoScrollRef.current) return;
    feedRef.current.scrollTop = feedRef.current.scrollHeight;
  }, [pendingReply?.submittedAt, renderedVisibleEvents.length, streamContent.length, streamReasoning.length, visibleEvents.length]);

  useLayoutEffect(() => {
    if (!loadingOlderEvents) return;
    const feed = feedRef.current;
    const restoreState = restoreFeedScrollRef.current;
    if (feed && restoreState) {
      const delta = feed.scrollHeight - restoreState.previousScrollHeight;
      feed.scrollTop += delta;
    }
    restoreFeedScrollRef.current = null;
    loadingOlderEventsRef.current = false;
    setLoadingOlderEvents(false);
  }, [loadingOlderEvents, renderedVisibleEvents.length]);

  const loadOlderRoomEvents = () => {
    if (loadingOlderEventsRef.current) return;
    if (hiddenVisibleEventCount <= 0) return;
    const feed = feedRef.current;
    restoreFeedScrollRef.current = feed ? { previousScrollHeight: feed.scrollHeight } : null;
    loadingOlderEventsRef.current = true;
    setLoadingOlderEvents(true);
    setVisibleEventCount((current) => Math.min(visibleEvents.length, current + ROOM_EVENT_HISTORY_PAGE_SIZE));
  };

  const updateAutoScrollPreference = () => {
    const feed = feedRef.current;
    if (!feed) return;
    const distanceFromBottom = feed.scrollHeight - feed.scrollTop - feed.clientHeight;
    shouldAutoScrollRef.current = distanceFromBottom <= AUTO_SCROLL_THRESHOLD_PX;
    if (feed.scrollTop <= HISTORY_LOAD_TRIGGER_PX && hiddenVisibleEventCount > 0 && !loadingOlderEventsRef.current) {
      loadOlderRoomEvents();
    }
  };

  // Detect new AI messages and trigger typewriter
  useEffect(() => {
    if (visibleEvents.length > prevEventCountRef.current) {
      const latest = visibleEvents[visibleEvents.length - 1];
      if (latest?.actorType === "ai" && !stoppedTypingIds.has(latest.id)) {
        setTypingEventId(latest.id);
      }
    }
    prevEventCountRef.current = visibleEvents.length;
  }, [visibleEvents, stoppedTypingIds]);

  const attachmentMap = useMemo(() => new Map((state?.attachments ?? []).map((attachment) => [attachment.id, attachment])), [state?.attachments]);
  const feedAttachments = useMemo(() => (state?.attachments ?? []).slice(0, 6), [state?.attachments]);
  const pendingAttachments = useMemo(() => (state?.attachments ?? []).filter((attachment) => pendingAttachmentIds.includes(attachment.id)), [pendingAttachmentIds, state?.attachments]);
  const pendingDirectAttachmentCount = useMemo(() => pendingAttachments.filter((attachment) => attachmentCanDirectConversation(attachment, singleUserConversationCapabilities)).length, [pendingAttachments, singleUserConversationCapabilities]);
  const latestAiEvents = useMemo(() => {
    const allAiEvents = (state?.events ?? []).filter((event) => event.actorType === "ai");
    if (allAiEvents.length === 0) {
      return [];
    }

    const meaningfulAiEvents = allAiEvents.filter(isMeaningfulAiIntervention);
    const sourceEvents = meaningfulAiEvents.length > 0 ? meaningfulAiEvents : allAiEvents;
    const retainCount = effectiveSettings.discussionPreferences.latestAiHistoryMode === "retain"
      ? Math.max(1, effectiveSettings.discussionPreferences.latestAiHistoryLimit)
      : 1;

    return sourceEvents.slice(-retainCount).reverse();
  }, [
    effectiveSettings.discussionPreferences.latestAiHistoryLimit,
    effectiveSettings.discussionPreferences.latestAiHistoryMode,
    state?.events,
  ]);
  const latestAiEvent = latestAiEvents[0] ?? null;
  const isLiveFeedEmpty = visibleEvents.length === 0 && !pendingReply && !interruptedReply;
  const latestRegenerateTarget = useMemo<CollaborationRegenerateTarget | null>(() => {
    for (let index = visibleEvents.length - 1; index >= 0; index -= 1) {
      const candidate = visibleEvents[index];
      if (candidate.actorType !== "ai") continue;
      const priorUserEvent = [...visibleEvents.slice(0, index)].reverse().find((event) => event.actorType !== "ai" && event.type === "message");
      if (!priorUserEvent) continue;
      return {
        userMessage: priorUserEvent.message,
        attachmentIds: priorUserEvent.attachmentIds,
        replaceAssistantEventId: candidate.id,
      };
    }
    return null;
  }, [visibleEvents]);
  const latestParticipantEvent = useMemo(() => [...visibleEvents].reverse().find((event) => event.actorType === "participant" && event.type === "message"), [visibleEvents]);
  const livePresence = useMemo(() => (state?.presence ?? []).filter((presence) => presence.active).sort((left, right) => Number(right.isTyping) - Number(left.isTyping)), [state?.presence]);
  const presenceRoster = useMemo(
    () =>
      (state?.presence ?? []).slice().sort((left, right) => {
        const activityDiff = Number(right.active) - Number(left.active);
        if (activityDiff !== 0) return activityDiff;
        const typingDiff = Number(right.isTyping) - Number(left.isTyping);
        if (typingDiff !== 0) return typingDiff;
        const moderationWeight = (presence: CollaborationState["presence"][number]) => (presence.role === "host" ? 2 : presence.role === "facilitator" ? 1 : 0);
        const roleDiff = moderationWeight(right) - moderationWeight(left);
        if (roleDiff !== 0) return roleDiff;
        return left.participantName.localeCompare(right.participantName);
      }),
    [state?.presence],
  );
  const roomLead = useMemo(() => livePresence.find((presence) => presence.role === "host" || presence.role === "facilitator") ?? livePresence[0], [livePresence]);
  const currentSpeaker = latestParticipantEvent?.participantName ?? roomLead?.participantName ?? participants[0]?.name ?? t("common.none");
  const totalEventCount = state?.events.length ?? visibleEvents.length;
  const inviteCreationAllowed = access.canCreateInvites;
  const inviteRoleOptions = useMemo<Participant["collaborationRole"][]>(
    () => (access.canAssignRoles ? ["participant", "observer", "facilitator"] : ["participant", "observer"]),
    [access.canAssignRoles],
  );
  const inviteRestrictionMessage = !settings.collaborationPreferences.allowInvites
    ? t("project.collaborationPanel.invitesDisabled")
    : project.room.visibility === "private"
      ? t("project.collaborationPanel.invitesPrivateRoom")
      : t("project.collaborationPanel.invitesModeratorOnly");
  const composerNotice = !access.canPostMessages
    ? access.canJoinPublicRoom
      ? t("project.collaborationPanel.joinPublicRoomBody")
      : t("project.collaborationPanel.identityLocked")
    : null;
  const visibilityBody = project.room.visibility === "public"
    ? t("project.collaborationPanel.visibilityPublicBody")
    : project.room.visibility === "invite"
      ? t("project.collaborationPanel.visibilityInviteBody")
      : t("project.collaborationPanel.visibilityPrivateBody");
  const roomPulseBody = singleUserMode ? t("project.collaborationPanel.singleUserWorkspaceBody") : visibilityBody;
  const sessionGoal = project.room.session.goal.trim() || project.goal.trim();

  useEffect(() => {
    if (!inviteRoleOptions.includes(inviteRole)) {
      setInviteRole("participant");
    }
  }, [inviteRole, inviteRoleOptions]);

  useEffect(() => {
    if (!presenceManagerOpen) return undefined;

    const previousBodyOverflow = document.body.style.overflow;
    const previousBodyPaddingRight = document.body.style.paddingRight;
    const previousDocumentOverflow = document.documentElement.style.overflow;
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    if (scrollbarWidth > 0) {
      const currentPaddingRight = Number.parseFloat(window.getComputedStyle(document.body).paddingRight) || 0;
      document.body.style.paddingRight = `${currentPaddingRight + scrollbarWidth}px`;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setPresenceManagerOpen(false);
        setRoleMenuOpen(null);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousBodyOverflow;
      document.body.style.paddingRight = previousBodyPaddingRight;
      document.documentElement.style.overflow = previousDocumentOverflow;
    };
  }, [presenceManagerOpen]);

  const joinPublicRoom = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/projects/${project.id}/room?locale=${locale}`, {
        method: "POST",
      });
      if (!response.ok) throw new Error(await readErrorMessage(response));
      const payload = (await response.json()) as { project?: DiscussionProject };
      if (payload.project) {
        onProjectChange?.(payload.project);
      }
      await refresh();
      setMessage(t("project.collaborationPanel.joinedPublicRoom"));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("errors.unexpected"));
    } finally {
      setBusy(false);
    }
  };

  const publishSoloWorkspace = async () => {
    if (sampleMutationLocked) {
      setMessage(sampleMutationMessage);
      return;
    }
    if (!singleUserMode || !mutationAccess.canManageRoom || project.room.visibility !== "private") {
      return;
    }
    setPublishingSolo(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/projects/${project.id}/room?locale=${locale}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...project.room,
          visibility: "invite",
        }),
      });
      if (!response.ok) throw new Error(await readErrorMessage(response));
      const payload = (await response.json()) as { project?: DiscussionProject; room?: DiscussionProject["room"] };
      if (payload.project) {
        onProjectChange?.(payload.project);
      } else {
        await refresh();
      }
      setMessage(t("project.collaborationPanel.singleUserPublished"));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("errors.unexpected"));
    } finally {
      setPublishingSolo(false);
    }
  };

  const submitInvite = async () => {
    if (sampleMutationLocked) {
      setMessage(sampleMutationMessage);
      return;
    }
    if (!mutationAccess.canCreateInvites) {
      setMessage(inviteRestrictionMessage ?? t("project.collaborationPanel.invitesDisabled"));
      return;
    }
    if (!inviteRoleOptions.includes(inviteRole)) {
      setMessage(t("project.collaborationPanel.invitesModeratorOnly"));
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/projects/${project.id}/invites?locale=${locale}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          role: inviteRole,
          createdByParticipantId: mutationAccess.ownedParticipantIds[0] || undefined,
          expiresInHours: Number(inviteHours) || 24,
          note: inviteNote,
        }),
      });
      if (!response.ok) throw new Error(await readErrorMessage(response));
      const payload = (await response.json()) as { state?: CollaborationState };
      if (payload.state) setState(payload.state); else await refresh();
      setInviteNote("");
      setMessage(t("project.collaborationPanel.inviteCreated"));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("errors.unexpected"));
    } finally {
      setBusy(false);
    }
  };

  const interruptPendingReply = () => {
    if (!pendingReply || !isStreaming) return;
    streamAbortRef.current?.();
    streamActiveRef.current = false;
    cancelAnimationFrame(streamRafId.current);
    streamRafId.current = 0;
    streamAbortRef.current = null;
    streamFinalizeRef.current = null;
    setInterruptedReply({
      ...pendingReply,
      partialContent: streamVisibleContentRef.current,
      partialReasoning: streamVisibleReasoningRef.current,
    });
    setIsStreaming(false);
    setPendingReply(null);
    setBusy(false);
    resetStreamingPreview();
    setMessage(t("project.collaborationPanel.generationStopped"));
  };

  const submitMessage = async (options?: {
    message?: string;
    attachmentIds?: string[];
    regenerate?: boolean;
    replaceAssistantEventId?: string;
  }) => {
    if (sampleMutationLocked) {
      setMessage(sampleMutationMessage);
      return;
    }
    if (!mutationAccess.canPostMessages) {
      setMessage(composerNotice ?? t("project.collaborationPanel.identityLocked"));
      return;
    }
    const nextMessage = (options?.message ?? messageDraft).trim();
    const nextAttachmentIds = [...(options?.attachmentIds ?? pendingAttachmentIds)];
    const regenerate = Boolean(options?.regenerate);
    // Extract @mentions from message text
    const mentionMatches = nextMessage.match(/@(\S+)/g);
    const mentionedNames = mentionMatches ? mentionMatches.map((m) => m.slice(1)) : [];
    const mentionedIds = participants.filter((p) => mentionedNames.includes(p.name)).map((p) => p.id);
    if (!nextMessage && nextAttachmentIds.length === 0) return;
    setBusy(true);
    setMessage(null);
    setInterruptedReply(null);
    if (singleUserMode) {
      setPendingReply({
        userMessage: nextMessage,
        attachmentIds: nextAttachmentIds,
        providerId: effectiveSingleUserProviderId,
        model: effectiveSingleUserModel,
        submittedAt: new Date().toISOString(),
        regenerate,
        replaceAssistantEventId: options?.replaceAssistantEventId,
      });
    }
    if (!regenerate) {
      setMessageDraft("");
      setPendingAttachmentIds([]);
    }

    const useStreaming = canUseStreaming;

    if (useStreaming) {
      setIsStreaming(true);
      resetStreamingPreview();
      streamActiveRef.current = true;
      const finalizeAfterDisplay = () => {
        const savedScroll = feedRef.current?.scrollTop ?? 0;
        void refresh().then(() => {
          setTimeout(() => {
            setIsStreaming(false);
            setPendingReply(null);
            setInterruptedReply(null);
            resetStreamingPreview();
            if (feedRef.current) feedRef.current.scrollTop = savedScroll;
          }, 500);
        });
      };
      const updateDisplay = () => {
        const nextReasoning = advanceVisibleStreamText(streamVisibleReasoningRef.current, streamingReasoningRef.current, 6);
        const nextContent = advanceVisibleStreamText(streamVisibleContentRef.current, streamingContentRef.current, 4);
        if (nextReasoning !== streamVisibleReasoningRef.current) {
          streamVisibleReasoningRef.current = nextReasoning;
          setStreamReasoning(nextReasoning);
        }
        if (nextContent !== streamVisibleContentRef.current) {
          streamVisibleContentRef.current = nextContent;
          setStreamContent(nextContent);
        }
        const displayCaughtUp = nextReasoning.length === streamingReasoningRef.current.length
          && nextContent.length === streamingContentRef.current.length;
        if (streamActiveRef.current || !displayCaughtUp) {
          streamRafId.current = requestAnimationFrame(updateDisplay);
          return;
        }
        streamRafId.current = 0;
        if (streamFinalizeRef.current) {
          const finalize = streamFinalizeRef.current;
          streamFinalizeRef.current = null;
          finalize();
        }
      };
      streamRafId.current = requestAnimationFrame(updateDisplay);
      const abort = consumeStream(
        {
          projectId: project.id,
          message: nextMessage,
          attachmentIds: nextAttachmentIds,
          identityId: getBrowserLocalIdentityId(currentLocalIdentityId),
          surface: "project-workspace",
          locale,
          regenerate,
          replaceAssistantEventId: options?.replaceAssistantEventId,
        },
        effectiveSingleUserProviderId,
        (chunk: StreamChunk) => {
          if (chunk.type === "reasoning") {
            streamingReasoningRef.current += chunk.text;
          } else if (chunk.type === "content") {
            streamingContentRef.current += chunk.text;
          }
          if (!streamRafId.current) {
            streamRafId.current = requestAnimationFrame(updateDisplay);
          }
        },
        (error: string) => {
          streamActiveRef.current = false;
          cancelAnimationFrame(streamRafId.current);
          streamRafId.current = 0;
          streamAbortRef.current = null;
          streamFinalizeRef.current = null;
          setMessage(error);
          setIsStreaming(false);
          setPendingReply(null);
          setBusy(false);
          resetStreamingPreview();
        },
        () => {
          streamActiveRef.current = false;
          streamAbortRef.current = null;
          setBusy(false);
          streamFinalizeRef.current = finalizeAfterDisplay;
          if (!streamRafId.current) {
            streamRafId.current = requestAnimationFrame(updateDisplay);
          }
        },
      );
      streamAbortRef.current = abort;
      return;
    }

    try {
      const endpoint = singleUserMode
        ? "/api/projects/" + project.id + "/assistant"
        : "/api/projects/" + project.id + "/events?locale=" + locale;
      const body = singleUserMode
        ? {
            locale: project.language,
            message: nextMessage,
            attachmentIds: nextAttachmentIds,
            identityId: getBrowserLocalIdentityId(currentLocalIdentityId),
            surface: "project-workspace",
            regenerate,
            replaceAssistantEventId: options?.replaceAssistantEventId,
          }
        : {
            type: "message",
            participantId: mutationAccess.ownedParticipantIds[0] || undefined,
            message: nextMessage,
            attachmentIds: nextAttachmentIds,
            replyToEventId: replyToEvent?.id,
            mentions: mentionedIds.length > 0 ? mentionedIds : undefined,
          };
      setReplyToEvent(null);
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await response.json().catch(() => null) as {
        error?: string;
        collaboration?: CollaborationState;
        project?: DiscussionProject;
        aiTriggeredTasks?: AiTask[];
      } | null;
      if (!response.ok) throw new Error(payload?.error ?? await readErrorMessage(response));
      if (payload?.collaboration) setState(payload.collaboration);
      if (payload?.project) onProjectChange?.(payload.project); else await refresh();
      setMessage(singleUserMode ? t("assistant.replyReady") : t("project.collaborationPanel.messageSent"));
      if (payload?.aiTriggeredTasks?.length) {
        void runProjectAutomationTasks(payload.aiTriggeredTasks);
      }
    } catch (error) {
      if (!options?.regenerate) {
        setMessageDraft(nextMessage);
        setPendingAttachmentIds(nextAttachmentIds);
      }
      setMessage(error instanceof Error ? error.message : t("errors.unexpected"));
    } finally {
      setPendingReply(null);
      setBusy(false);
    }
  };

  const notifyPresenceSyncFailure = useCallback((options?: { keepalive?: boolean }) => {
    if (options?.keepalive) return;
    const now = Date.now();
    if (now - lastPresenceSyncWarningAtRef.current < 60_000) return;
    lastPresenceSyncWarningAtRef.current = now;
    setMessage(t("project.collaborationPanel.presenceSyncFailed"));
  }, [t]);

  const syncPresenceStatus = useCallback(async (status: PresenceStatus, options?: { keepalive?: boolean }) => {
    if (!mutationAccess.canUpdatePresence || !autoPresenceParticipantId) return;
    try {
      const response = await fetch(`/api/projects/${project.id}/events?locale=${locale}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "presence",
          participantId: autoPresenceParticipantId,
          status,
        }),
        keepalive: options?.keepalive,
      });
      const payload = await response.json().catch(() => null) as { collaboration?: CollaborationState; project?: DiscussionProject } | null;
      if (!response.ok) {
        notifyPresenceSyncFailure(options);
        return;
      }
      if (payload?.collaboration) setState(payload.collaboration);
      if (payload?.project) onProjectChange?.(payload.project);
    } catch {
      notifyPresenceSyncFailure(options);
    }
  }, [mutationAccess.canUpdatePresence, autoPresenceParticipantId, locale, notifyPresenceSyncFailure, onProjectChange, project.id]);

  useEffect(() => {
    if (!autoPresenceStatus || !autoPresenceParticipantId) return;
    if (lastAutoPresenceRef.current === autoPresenceStatus) return;
    lastAutoPresenceRef.current = autoPresenceStatus;
    void syncPresenceStatus(autoPresenceStatus);
  }, [autoPresenceParticipantId, autoPresenceStatus, syncPresenceStatus]);

  useEffect(() => {
    if (typeof window === "undefined" || !autoPresenceParticipantId || !mutationAccess.canUpdatePresence) return undefined;
    const handlePageHide = () => {
      lastAutoPresenceRef.current = "leaving";
      void syncPresenceStatus("leaving", { keepalive: true });
    };
    window.addEventListener("pagehide", handlePageHide);
    return () => window.removeEventListener("pagehide", handlePageHide);
  }, [mutationAccess.canUpdatePresence, autoPresenceParticipantId, syncPresenceStatus]);

  const acceptInvite = async () => {
    if (!acceptToken.trim() || !acceptName.trim()) return;
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/projects/${project.id}/invites/accept?locale=${encodeURIComponent(locale)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: acceptToken.trim(),
          name: acceptName.trim(),
          profileOwnerId: effectiveSettings.profile.localIdentityId,
          avatarPreset: effectiveSettings.profile.avatarPreset,
          avatarImageDataUrl: effectiveSettings.profile.avatarImageDataUrl,
        }),
      });
      if (!response.ok) throw new Error(await readErrorMessage(response));
      const payload = (await response.json()) as { project?: DiscussionProject };
      if (payload.project) {
        onProjectChange?.(payload.project);
      }
      setAcceptToken("");
      await refresh();
      setMessage(t("project.collaborationPanel.inviteAccepted"));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("errors.unexpected"));
    } finally {
      setBusy(false);
    }
  };

  const updateRoomAiAutomation = async (overrides?: Partial<DiscussionProject["room"]["aiAutomation"]>) => {
    if (sampleMutationLocked) {
      setMessage(sampleMutationMessage);
      return;
    }
    if (!mutationAccess.canManageAutomation) {
      setMessage(t("roomManage.insufficientPermissions"));
      return;
    }
    const nextAutomation = buildRoomAiAutomationPayload(overrides);
    setRoomAiBusy(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/projects/${project.id}/room?locale=${locale}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...project.room,
          aiAutomation: nextAutomation,
        }),
      });
      if (!response.ok) throw new Error(await readErrorMessage(response));
      const payload = (await response.json()) as { project?: DiscussionProject };
      if (payload.project) onProjectChange?.(payload.project);
      setMessage(t("common.save") + " ✓");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("errors.unexpected"));
    } finally {
      setRoomAiBusy(false);
    }
  };

  const runProjectAutomationTasks = useCallback(async (tasks: AiTask[]) => {
    if (tasks.length === 0) return;
    setRoomAiBusy(true);
    setMessage(null);
    try {
      for (const task of tasks) {
        const response = await fetch(`/api/projects/${project.id}/ai`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ task, locale: project.language, triggerSource: "automation" }),
        });
        const payload = await response.json().catch(() => null) as {
          error?: string;
          collaboration?: CollaborationState;
          project?: DiscussionProject;
        } | null;
        if (!response.ok) throw new Error(payload?.error ?? t("roomAi.aiError"));
        if (payload?.collaboration) setState(payload.collaboration);
        if (payload?.project) onProjectChange?.(payload.project);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("roomAi.aiError"));
    } finally {
      setRoomAiBusy(false);
    }
  }, [locale, onProjectChange, project.id, project.language, t]);

  const requestRoomAiSummary = async () => {
    if (sampleReadOnlyLocked) {
      setMessage(sampleMutationMessage);
      return;
    }
    if (!mutationAccess.canRunAiTasks) {
      setMessage(mutationAccess.canJoinPublicRoom ? t("project.collaborationPanel.joinPublicRoom") : t("project.workspaceAiLocked"));
      return;
    }
    onRunAiTask?.("summarizeDiscussion");
  };

  const isRoomArchived = Boolean(project.room.archivedAt);
  const canManageAutomation = access.canManageAutomation && !isRoomArchived;
  const canEditAutomationPermissions = access.isOwner && !isRoomArchived;
  const showRoomManagePanel = !singleUserMode;
  const roomManageStateMessage = !showRoomManagePanel
    ? null
    : isRoomArchived
      ? t("roomManage.roomArchived")
      : access.canManageRoom
        ? null
        : access.canJoinPublicRoom
          ? t("project.collaborationPanel.joinPublicRoomBody")
          : t("roomManage.insufficientPermissions");
  const normalizedAutomation = normalizeSummaryAutomationConfig(project.room.aiAutomation);
  const summaryThresholdOptions = roomAiMode === "assistive" ? ASSISTIVE_SUMMARY_THRESHOLD_OPTIONS : BASIC_SUMMARY_THRESHOLD_OPTIONS;
  const workspaceRoleKey = `roomAi.role${access.workspaceRole.charAt(0).toUpperCase()}${access.workspaceRole.slice(1)}` as const;
  const memberManagementBlockMessage = sampleMutationLocked
    ? sampleMutationMessage
    : isRoomArchived
      ? t("roomManage.roomArchived")
      : access.canManageRoom
        ? null
        : t("project.collaborationPanel.memberReadonlyBody");
  const presenceManagerButtonLabel = access.canManageRoom && !sampleMutationLocked && !isRoomArchived
    ? t("project.collaborationPanel.memberManagement")
    : t("project.collaborationPanel.viewAllMembers");

  const roomManageAction = async (body: Record<string, unknown>) => {
    if (sampleMutationLocked) {
      setMessage(sampleMutationMessage);
      setConfirmAction(null);
      return false;
    }
    if (!mutationAccess.canManageRoom) {
      setMessage(t("roomManage.insufficientPermissions"));
      setConfirmAction(null);
      return false;
    }
    setManageBusy(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/projects/${project.id}/room/manage?locale=${encodeURIComponent(locale)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error(await readErrorMessage(response));
      const payload = (await response.json()) as { project?: DiscussionProject };
      if (payload.project) onProjectChange?.(payload.project);
      else await refresh();
      return true;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("errors.unexpected"));
      return false;
    } finally {
      setManageBusy(false);
      setConfirmAction(null);
    }
  };

  const handleKickParticipant = async (participantId: string) => {
    const ok = await roomManageAction({ action: "kick", participantId });
    if (ok) setMessage(t("roomManage.kickUser") + " \u2714");
  };

  const handleSetRole = async (participantId: string, role: CollaborationRole) => {
    const ok = await roomManageAction({ action: "setRole", participantId, role });
    if (ok) setMessage(t("roomManage.setRole") + " \u2714");
    setRoleMenuOpen(null);
  };

  const handleTransferOwnership = async (participantId: string) => {
    const ok = await roomManageAction({ action: "transferOwnership", participantId });
    if (ok) setMessage(t("roomManage.transferOwnership") + " \u2714");
  };

  const handleDestroyRoom = async () => {
    const ok = await roomManageAction({ action: "destroyRoom" });
    if (ok) setMessage(t("roomManage.destroyRoom") + " \u2714");
  };

  const handleSetJoinMode = async (joinMode: "open" | "approval") => {
    const ok = await roomManageAction({ action: "setJoinMode", joinMode });
    if (ok) setMessage(t("roomManage.joinModeTitle") + " \u2714");
  };

  const getNickname = (participantId: string) => {
    return nicknames[`${project.id}:${participantId}`] ?? "";
  };

  const saveNickname = async (participantId: string, nickname: string) => {
    const key = `${project.id}:${participantId}`;
    const previousNicknames = nicknames;
    const updated = { ...previousNicknames, [key]: nickname.trim() };
    if (!nickname.trim()) delete updated[key];
    setNicknames(updated);
    setNicknameEditing(null);
    setNicknameDraft("");
    try {
      await patchSettings({ participantNicknames: updated });
      setMessage(t("roomManage.nicknameSaved"));
    } catch {
      setNicknames(previousNicknames);
      setNicknameEditing(participantId);
      setNicknameDraft(nickname);
      setMessage(t("errors.unexpected"));
    }
  };

  const renderPresenceMemberCard = (
    presence: CollaborationState["presence"][number],
    options?: { surface?: "panel" | "modal" },
  ) => {
    const participant = participants.find((candidate) => candidate.id === presence.participantId);
    const isDisplaySelf = isDisplayOwnedParticipant(participant);
    const canManageThisParticipant = Boolean(participant && !sampleMutationLocked && !isRoomArchived && !isDisplaySelf);
    const canKick = Boolean(participant && canManageThisParticipant && canRemoveParticipant(project, access, participant));
    const canRole = Boolean(participant && canManageThisParticipant && access.canAssignRoles && participant.collaborationRole !== "host");
    const canTransfer = Boolean(participant && canManageThisParticipant && access.canTransferOwnership);
    const isRoleMenuOpenForThis = roleMenuOpen === presence.participantId;
    const roleIcon = presence.role === "host" ? Crown : presence.role === "facilitator" ? ShieldCheck : Shield;
    const RoleIcon = roleIcon;
    const cardKey = `${options?.surface ?? "panel"}-${presence.connectionId}`;

    return (
      <div key={cardKey} className="group rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-4 transition hover:border-[color:var(--brand-solid)]/30">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="relative">
              <Avatar
                name={participant?.name ?? presence.participantName}
                label={participant ? resolveParticipantAvatar(participant, effectiveSettings.profile).label : pickInitials(presence.participantName || effectiveSettings.profile.displayName)}
                preset={participant ? resolveParticipantAvatar(participant, effectiveSettings.profile).preset : undefined}
                imageDataUrl={participant ? resolveParticipantAvatar(participant, effectiveSettings.profile).imageDataUrl : undefined}
                className="h-10 w-10 rounded-2xl text-xs"
              />
              <span className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-[color:var(--surface-muted)] ${presence.active ? "bg-emerald-500" : "bg-zinc-400"}`} />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                {participant && isDisplayOwnedParticipant(participant) ? (
                  <input
                    type="text"
                    value={participant.name}
                    onChange={(e) => {
                      if (sampleMutationLocked) {
                        setMessage(sampleMutationMessage);
                        return;
                      }
                      const nextName = e.target.value;
                      onProjectChange?.({ ...project, participants: project.participants.map((p) => p.id === participant.id ? { ...p, name: nextName } : p) });
                    }}
                    onBlur={() => {
                      if (sampleMutationLocked) {
                        setMessage(sampleMutationMessage);
                        return;
                      }
                      const baseProject = {
                        ...project,
                        participants: project.participants.map((candidate) =>
                          candidate.id === participant.id
                            ? { ...candidate, name: presence.participantName }
                            : candidate),
                      };
                      void patchProjectState(
                        project.id,
                        { participants: project.participants },
                        { baseProject, locale },
                      )
                        .then((saved) => onProjectChange?.(saved))
                        .catch(() => {
                          onProjectChange?.(baseProject);
                          setMessage(t("errors.saveFailed"));
                        });
                    }}
                    className="max-w-[10rem] rounded border border-transparent bg-transparent px-1 font-semibold outline-none focus:border-[color:var(--brand-solid)] focus:bg-[color:var(--surface-strong)]"
                  />
                ) : (
                  <p className="font-semibold">{presence.participantName}</p>
                )}
                <Badge tone={toneForPresence(presence.status)}>{t(`presenceStates.${presence.status}`)}</Badge>
                <span className="inline-flex items-center gap-1">
                  <RoleIcon className="h-3 w-3 text-[color:var(--muted)]" />
                  <Badge>{t(`collaborationRoles.${presence.role}`)}</Badge>
                </span>
                {presence.isTyping ? <Badge tone="accent">{t("project.collaborationPanel.typing")}</Badge> : null}
              </div>
              {getNickname(presence.participantId) ? (
                <p className="mt-0.5 text-[11px] font-medium text-[color:var(--brand-solid)]">{getNickname(presence.participantId)}</p>
              ) : null}
              <p className="mt-1 text-xs text-[color:var(--muted)]">{formatDateTime(presence.lastHeartbeatAt, locale)}</p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            {currentSpeaker === presence.participantName ? <Badge tone="accent">{t("project.collaborationPanel.currentSpeaker")}</Badge> : null}
          </div>
        </div>

        {nicknameEditing === presence.participantId ? (
          <div className="mt-3 flex items-center gap-2 border-t border-[color:var(--border)] pt-3">
            <input
              type="text"
              value={nicknameDraft}
              onChange={(e) => setNicknameDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void saveNickname(presence.participantId, nicknameDraft); if (e.key === "Escape") { setNicknameEditing(null); setNicknameDraft(""); } }}
              placeholder={t("roomManage.nicknamePlaceholder")}
              className="flex-1 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-strong)] px-2.5 py-1.5 text-xs text-[color:var(--foreground)] outline-none focus:border-[color:var(--brand-solid)]"
              autoFocus
            />
            <button
              type="button"
              onClick={() => void saveNickname(presence.participantId, nicknameDraft)}
              className="rounded-lg bg-[color:var(--brand-solid)] px-2.5 py-1.5 text-xs font-semibold text-white"
            >{t("common.save")}</button>
            <button
              type="button"
              onClick={() => { setNicknameEditing(null); setNicknameDraft(""); }}
              className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-strong)] px-2.5 py-1.5 text-xs font-semibold text-[color:var(--muted)]"
            >{t("common.cancel")}</button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => { setNicknameEditing(presence.participantId); setNicknameDraft(getNickname(presence.participantId)); }}
            className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-[color:var(--muted)] transition hover:text-[color:var(--brand-solid)]"
          >
            <Pencil className="h-3 w-3" />
            {getNickname(presence.participantId) ? t("common.edit") : t("roomManage.nicknameLabel")}
          </button>
        )}

        {(canKick || canRole || canTransfer) ? (
          <div className="mt-3 flex flex-wrap items-start gap-2 border-t border-[color:var(--border)] pt-3">
            {canRole && participant ? (
              <div>
                <button
                  type="button"
                  onClick={() => setRoleMenuOpen(isRoleMenuOpenForThis ? null : presence.participantId)}
                  disabled={manageBusy}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-strong)] px-2.5 py-1.5 text-xs font-semibold text-[color:var(--foreground)] transition hover:bg-[color:var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Pencil className="h-3 w-3" />
                  {t("roomManage.setRole")}
                  <ChevronDown className={`h-3 w-3 transition ${isRoleMenuOpenForThis ? "rotate-180" : ""}`} />
                </button>
                {isRoleMenuOpenForThis ? (
                  <div className="mt-1 w-40 rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-strong)] p-1 shadow-lg">
                    {(["facilitator", "participant", "observer"] as CollaborationRole[]).map((role) => (
                      <button
                        key={role}
                        type="button"
                        onClick={() => void handleSetRole(participant.id, role)}
                        disabled={manageBusy || participant.collaborationRole === role}
                        className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${participant.collaborationRole === role ? "bg-[color:var(--brand-soft)] text-[color:var(--brand-ink)]" : "text-[color:var(--foreground)] hover:bg-[color:var(--surface-hover)]"}`}
                      >
                        {role === "facilitator" ? <ShieldCheck className="h-3 w-3" /> : <Shield className="h-3 w-3" />}
                        {t(`collaborationRoles.${role}`)}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}

            {canTransfer && participant ? (
              <button
                type="button"
                onClick={() => {
                  if (options?.surface === "modal") setPresenceManagerOpen(false);
                  setConfirmAction({ type: "transfer", participantId: participant.id, participantName: presence.participantName });
                }}
                disabled={manageBusy}
                className="room-action-transfer inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Crown className="h-3 w-3" />
                {t("roomManage.transferOwnership")}
              </button>
            ) : null}

            {canKick && participant ? (
              <button
                type="button"
                onClick={() => {
                  if (options?.surface === "modal") setPresenceManagerOpen(false);
                  setConfirmAction({ type: "kick", participantId: participant.id, participantName: presence.participantName });
                }}
                disabled={manageBusy}
                className="room-action-kick inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-60"
              >
                <UserMinus className="h-3 w-3" />
                {t("roomManage.kickUser")}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  };

  const submitUpload = async (files: FileList | File[], source: "image" | "document") => {
    if (sampleMutationLocked) {
      setMessage(sampleMutationMessage);
      return;
    }
    if (!mutationAccess.canUploadAttachments) {
      setMessage(mutationAccess.canJoinPublicRoom ? t("project.collaborationPanel.joinPublicRoomBody") : t("project.collaborationPanel.identityLocked"));
      return;
    }
    if (source === "image" && !canStageImages) {
      setMessage(t("project.collaborationPanel.uploadImageUnsupported"));
      return;
    }
    if (source === "document" && !canStageDocuments) {
      setMessage(t("project.collaborationPanel.uploadFileUnsupported"));
      return;
    }
    const queue = Array.from(files ?? []);
    if (queue.length === 0) return;
    setBusy(true);
    setMessage(null);
    try {
      let nextState = state;
      const addedIds: string[] = [];
      for (const file of queue) {
        const directReadable = fileWillTravelDirectly(file, source, singleUserConversationCapabilities);
        const formData = new FormData();
        formData.set("file", file);
        formData.set("note", source === "image" ? t("project.collaborationPanel.imageAttachmentNote") : t("project.collaborationPanel.documentAttachmentNote"));
        formData.set("participantId", mutationAccess.ownedParticipantIds[0] || "");
        const response = await fetch(`/api/projects/${project.id}/attachments?locale=${locale}`, {
          method: "POST",
          body: formData,
        });
        const payload = (await response.json().catch(() => null)) as { state?: CollaborationState; attachment?: { id?: string } ; error?: string } | null;
        if (!response.ok) throw new Error(payload?.error ?? await readErrorMessage(response));
        if (payload?.state) nextState = payload.state;
        if (payload?.attachment?.id) {
          addedIds.push(payload.attachment.id);
        }
        if (source === "document" && !directReadable) {
          setMessage(t("project.collaborationPanel.documentReferenceQueued"));
        }
      }
      if (nextState) setState(nextState); else await refresh();
      if (addedIds.length > 0) {
        setPendingAttachmentIds((current) => [...new Set([...current, ...addedIds])]);
      }
      if (source === "image") {
        setMessage(singleUserMode && singleUserConversationCapabilities.image ? t("project.collaborationPanel.uploaded") : t("project.collaborationPanel.imageReferenceQueued"));
      } else if (queue.every((file) => fileWillTravelDirectly(file, source, singleUserConversationCapabilities))) {
        setMessage(t("project.collaborationPanel.uploaded"));
      } else {
        setMessage(t("project.collaborationPanel.documentReferenceQueued"));
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("errors.unexpected"));
    } finally {
      if (source === "image") {
        if (imageFileRef.current) imageFileRef.current.value = "";
      } else if (documentFileRef.current) {
        documentFileRef.current.value = "";
      }
      setBusy(false);
    }
  };

  return (
      <div
        className="grid gap-5 xl:grid-cols-[minmax(0,1.88fr)_minmax(19rem,0.76fr)] xl:items-stretch"
      >
      <div className="flex min-w-0 flex-col gap-5 xl:h-full">
        <Panel className="hero-surface overflow-hidden p-5 lg:p-7">
          <div className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr] lg:items-end">
            <div className="space-y-4">
              <div className="flex flex-wrap gap-2">
                <Badge tone="accent">{singleUserMode ? t("project.collaborationPanel.singleUserTitle") : t("project.collaborationPanel.sharedRoomTitle")}</Badge>
                <Badge>{project.room.session.title}</Badge>
                <Badge>{t(`roomVisibility.${project.room.visibility}`)}</Badge>
                <Badge>{transportLabel(state?.sync.transport ?? "local-poll", t)}</Badge>
                <Badge tone={project.room.session.status === "live" ? "success" : project.room.session.status === "paused" ? "accent" : "default"}>
                  {t(`roomSessionStatus.${project.room.session.status}`)}
                </Badge>
              </div>
              <div>
                <h2 className="font-display text-3xl font-semibold tracking-tight lg:text-4xl">{t("project.collaborationPanel.title")}</h2>
                <p className="mt-2 max-w-3xl text-sm leading-7 text-[color:var(--muted)]">{singleUserMode ? t("project.collaborationPanel.singleUserBody") : t("project.collaborationPanel.sharedRoomBody")}</p>
                {sessionGoal ? (
                  <p className="mt-3 max-w-3xl rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-4 py-3 text-sm leading-7 text-[color:var(--foreground)]">
                    {sessionGoal}
                  </p>
                ) : null}
              </div>
              <div className="flex flex-wrap items-center gap-3 text-sm text-[color:var(--muted)]">
                {/* Model quick-switch */}
                {singleUserMode && (() => {
                  const desc = getProviderDescriptor(effectiveSingleUserProviderId);
                  if (!desc || desc.models.length < 2) return null;
                  return (
                    <select
                      value={effectiveSingleUserModel}
                      onChange={(e) => {
                        const next = e.target.value;
                        setLocalModelOverride(next);
                        void patchSettings({ provider: { providers: { [effectiveSingleUserProviderId]: { model: next } } } }).catch((error) => {
                          setMessage(error instanceof Error ? error.message : t("errors.saveFailed"));
                        });
                      }}
                      className="rounded-full border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-3 py-2 text-xs font-semibold text-[color:var(--foreground)]"
                    >
                      {desc.models.map((m) => (
                        <option key={m.id} value={m.id}>{m.label}</option>
                      ))}
                    </select>
                  );
                })()}
                <span className="inline-flex items-center gap-2 rounded-full border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-3 py-2 ">
                  <Users className="h-4 w-4 text-[color:var(--brand-solid)]" />
                  {`${livePresence.length} ${t("project.collaborationPanel.onlineNow")}`}
                </span>
                <span className="inline-flex items-center gap-2 rounded-full border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-3 py-2 ">
                  <MessagesSquare className="h-4 w-4 text-[color:var(--brand-solid)]" />
                  {`${visibleEvents.length}${totalEventCount > visibleEvents.length ? ` / ${totalEventCount}` : ""} ${t("project.collaborationPanel.historyCount")}`}
                </span>
                <span className="inline-flex items-center gap-2 rounded-full border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-3 py-2 ">
                  <Radio className="h-4 w-4 text-[color:var(--brand-solid)]" />
                  {`${t("project.collaborationPanel.currentSpeaker")}: ${currentSpeaker}`}
                </span>
              </div>
            </div>

            <div className="grid gap-4 rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface-strong)] p-5 shadow-panel">
              <div>
                <p className="text-xs uppercase tracking-[0.18em] text-[color:var(--muted)]">{t("project.collaborationPanel.roomPulseTitle")}</p>
                <p className="mt-2 text-sm leading-6 text-[color:var(--muted)]">{roomPulseBody}</p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-4 ">
                  <p className="text-xs uppercase tracking-[0.18em] text-[color:var(--muted)]">{t("project.collaborationPanel.syncCursor")}</p>
                  <p className="mt-2 text-2xl font-semibold">{state?.sync.cursor ?? 0}</p>
                </div>
                <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-4 ">
                  <p className="text-xs uppercase tracking-[0.18em] text-[color:var(--muted)]">{t("project.collaborationPanel.attachments")}</p>
                  <p className="mt-2 text-2xl font-semibold">{state?.attachments.length ?? 0}</p>
                </div>
              </div>
              <p className="text-sm leading-6 text-[color:var(--muted)]">{t("project.collaborationPanel.historyVisible")}</p>
              {singleUserMode ? (
                <div className="grid gap-3">
                  <div className="flex flex-wrap gap-3">
                    <button type="button" onClick={startNewChat} className="inline-flex items-center justify-center rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-strong)] px-4 py-2.5 text-sm font-semibold transition hover:bg-[color:var(--surface-hover)]">
                      {t("project.collaborationPanel.singleUserNewChat")}
                    </button>
                    {project.room.visibility === "private" && access.canManageRoom ? (
                      <Button variant="ghost" className="gap-2" onClick={publishSoloWorkspace} disabled={busy || publishingSolo}>
                        <CircleArrowOutUpRight className="h-4 w-4" />
                        {publishingSolo ? `${t("common.loading")}...` : t("project.collaborationPanel.singleUserPublish")}
                      </Button>
                    ) : (
                      <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-4 py-2.5 text-sm leading-6 text-[color:var(--muted)]">
                        {t("project.collaborationPanel.singleUserSharedHint")}
                      </div>
                    )}
                  </div>
                </div>
              ) : access.canJoinPublicRoom || access.isPublicViewer ? (
                <div className="grid gap-3">
                  {access.canJoinPublicRoom ? (
                    <Button className="w-full gap-2" onClick={joinPublicRoom} disabled={busy}>
                      <Users className="h-4 w-4" />
                      {busy ? `${t("common.loading")}...` : t("project.collaborationPanel.joinPublicRoom")}
                    </Button>
                  ) : null}
                  <div className="rounded-xl border border-dashed border-[color:var(--border)] bg-[color:var(--surface-muted)] px-4 py-3 text-sm leading-6 text-[color:var(--muted)]">
                    {t("project.collaborationPanel.publicViewerHint")}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </Panel>

        <Panel className="flex flex-col overflow-hidden p-0 xl:min-h-[44rem] xl:flex-1">
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="border-b border-[color:var(--border)] px-5 py-5 lg:px-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h3 className="font-display text-2xl font-semibold">{t("project.collaborationPanel.liveFeed")}</h3>
                  <p className="mt-1 text-sm leading-6 text-[color:var(--muted)]">{t("project.collaborationPanel.feedBody")}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative">
                    <input
                      type="text"
                      value={chatSearch}
                      onChange={(e) => setChatSearch(e.target.value)}
                      placeholder={t("project.collaborationPanel.searchMessages")}
                      className="h-8 w-48 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-strong)] pl-8 pr-2 text-xs text-[color:var(--foreground)] outline-none placeholder:text-[color:var(--muted)] focus:border-[color:var(--brand-solid)]"
                    />
                    <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[color:var(--muted)]" />
                    {chatSearch && (
                      <button type="button" onClick={() => setChatSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-[color:var(--muted)] hover:text-[color:var(--foreground)]">{"\u2715"}</button>
                    )}
                  </div>
                  {chatSearch && <Badge tone="accent">{visibleEvents.length} {t("project.collaborationPanel.historyCount")}</Badge>}
                  {latestAiEvent ? <Badge tone="accent">{t("project.collaborationPanel.latestAiTitle")}</Badge> : null}
                  <Badge>{formatDateTime(state?.sync.updatedAt ?? project.updatedAt, locale)}</Badge>
                </div>
              </div>
            </div>

            {feedAttachments.length > 0 ? (
              <div className="border-b border-[color:var(--border)] px-5 py-4 lg:px-6">
                <div className="soft-scrollbar flex gap-3 overflow-x-auto pb-1">
                  {feedAttachments.map((attachment) => {
                    const Icon = attachmentIcon(attachment.kind);
                    return (
                      <a key={`feed-${attachment.id}`} href={buildAttachmentHref(project.id, attachment)} target="_blank" rel="noreferrer" className="min-w-[14rem] rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-3 transition hover:border-[color:var(--brand-solid)]">
                        <div className="flex items-center gap-2">
                          <span className="inline-flex h-9 w-9 items-center justify-center rounded-2xl bg-[color:var(--brand-soft)] text-[color:var(--brand-ink)]">
                            <Icon className="h-4 w-4" />
                          </span>
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold">{attachment.name}</p>
                            <p className="text-xs text-[color:var(--muted)]">{attachmentKindLabel(attachment.kind, t)}</p>
                          </div>
                        </div>
                        <p className="mt-3 line-clamp-3 text-xs leading-5 text-[color:var(--muted)]">{attachment.note || attachment.previewText || t("common.none")}</p>
                      </a>
                    );
                  })}
                </div>
              </div>
            ) : null}

            <div
              ref={feedRef}
              className={`soft-scrollbar relative flex min-h-[24rem] flex-1 flex-col overflow-y-auto px-5 py-5 lg:px-6 xl:max-h-[52rem] ${dragOver ? "ring-2 ring-inset ring-[color:var(--brand-solid)]" : ""}`}
              onScroll={updateAutoScrollPreference}
              onDragEnter={(e) => { e.preventDefault(); dragCounter.current++; setDragOver(true); }}
              onDragOver={(e) => { e.preventDefault(); }}
              onDragLeave={() => { dragCounter.current--; if (dragCounter.current <= 0) { dragCounter.current = 0; setDragOver(false); } }}
              onDrop={(e) => {
                e.preventDefault();
                dragCounter.current = 0;
                setDragOver(false);
                const files = e.dataTransfer.files;
                if (files.length > 0 && access.canUploadAttachments) {
                  const isImage = Array.from(files).every((f) => f.type.startsWith("image/"));
                  void submitUpload(files, isImage ? "image" : "document");
                }
              }}
            >
              {dragOver ? (
                <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-[color:var(--brand-soft)]/80 backdrop-blur-sm">
                  <div className="flex flex-col items-center gap-2 text-[color:var(--brand-ink)]">
                    <Paperclip className="h-8 w-8" />
                    <p className="text-sm font-semibold">{t("project.collaborationPanel.dropToUpload")}</p>
                  </div>
                </div>
              ) : null}
              {/* Pinned messages */}
              {visibleEvents.some((e) => e.pinned) ? (
                <div className="room-pin-surface mb-3 space-y-2 rounded-xl border p-3">
                  <p className="room-pin-title flex items-center gap-1.5 text-xs font-semibold"><Pin className="h-3 w-3" /> {t("project.collaborationPanel.pinnedMessages")}</p>
                  {visibleEvents.filter((e) => e.pinned).map((e) => (
                    <div key={`pin-${e.id}`} className="rounded-lg bg-[color:var(--surface-strong)] px-3 py-2 text-xs">
                      <span className="font-semibold">
                        {actorDisplayName(
                          e,
                          ((e.metadata.providerId as ProviderId | undefined) ?? effectiveSingleUserProviderId),
                          t,
                        )}
                        {": "}
                      </span>
                      <span className="text-[color:var(--muted)]">{e.message.slice(0, 120)}</span>
                    </div>
                  ))}
                </div>
              ) : null}
              <div className="flex min-h-0 flex-1 flex-col gap-4">
                {visibleEvents.length === 0 && !pendingReply ? (
                  <div className={`flex min-h-[10rem] items-center rounded-2xl border border-dashed border-[color:var(--border)] bg-[color:var(--surface-muted)]/70 p-6 text-sm leading-6 text-[color:var(--muted)] ${isLiveFeedEmpty ? "flex-1" : ""}`}>
                    {t("project.collaborationPanel.noEvents")}
                  </div>
                ) : (
                  <>
                    {hiddenVisibleEventCount > 0 ? (
                      <div className="flex justify-center">
                        <button
                          type="button"
                          onClick={loadOlderRoomEvents}
                          disabled={loadingOlderEvents}
                          className="inline-flex items-center gap-2 rounded-full border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-3 py-1.5 text-xs font-semibold text-[color:var(--muted)] transition hover:border-[color:var(--brand-solid)] hover:text-[color:var(--foreground)] disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {loadingOlderEvents
                            ? t("project.collaborationPanel.loadingOlderMessages")
                            : t("project.collaborationPanel.loadOlderMessages", { count: String(Math.min(ROOM_EVENT_HISTORY_PAGE_SIZE, hiddenVisibleEventCount)) })}
                        </button>
                      </div>
                    ) : null}
                    {renderedVisibleEvents.map((event) => {
                    const linkedAttachments = event.attachmentIds.map((attachmentId) => attachmentMap.get(attachmentId)).filter(Boolean);
                    const participant = participants.find((candidate) => candidate.id === event.participantId);
                    const eventProviderId = ((event.metadata.providerId as ProviderId | undefined) ?? effectiveSingleUserProviderId);
                    const actorGlyph = event.actorType === "ai"
                      ? <ProviderReplyAvatar providerId={eventProviderId} className="h-10 w-10 rounded-2xl" />
                      : <Avatar
                            name={participant?.name ?? event.participantName ?? "Guest"}
                            label={participant ? resolveParticipantAvatar(participant, effectiveSettings.profile).label : pickInitials(event.participantName ?? effectiveSettings.profile.displayName)}
                            preset={participant ? resolveParticipantAvatar(participant, effectiveSettings.profile).preset : undefined}
                            imageDataUrl={participant ? resolveParticipantAvatar(participant, effectiveSettings.profile).imageDataUrl : undefined}
                            className="h-10 w-10 rounded-2xl text-xs"
                          />;
                    const shellClass = event.actorType === "ai"
                      ? "room-ai-surface"
                      : event.actorType === "system"
                        ? "border-[color:var(--border)] bg-[color:var(--surface-muted)]"
                        : "border-[color:var(--border)] bg-[color:var(--surface-soft)] ";
                    const revisionView = event.actorType === "ai" ? getAssistantRevisionView(event) : null;
                    const inlineRegeneratePendingReply = singleUserMode
                      && event.actorType === "ai"
                      && pendingReply?.regenerate === true
                      && pendingReply.replaceAssistantEventId === event.id
                        ? pendingReply
                        : null;

                    return (
                      <article key={event.id} className={`group rounded-2xl border p-4 shadow-[0_18px_40px_rgba(15,23,42,0.08)] ${shellClass}`}>
                        {event.replyToEventId ? (() => {
                          const refEvent = state?.events.find((e) => e.id === event.replyToEventId);
                          return refEvent ? (
                            <div className="mb-2 flex items-start gap-2 rounded-lg border-l-2 border-l-[color:var(--brand-solid)] bg-[color:var(--surface-muted)] px-3 py-2 text-xs text-[color:var(--muted)]">
                              <span className="shrink-0 font-semibold text-[color:var(--brand-solid)]">
                                {actorDisplayName(
                                  refEvent,
                                  ((refEvent.metadata.providerId as ProviderId | undefined) ?? effectiveSingleUserProviderId),
                                  t,
                                )}
                              </span>
                              <span className="truncate">{refEvent.message.slice(0, 80)}</span>
                            </div>
                          ) : null;
                        })() : null}
                        <div className="flex gap-4">
                          {event.actorType === "system" ? (
                            <SystemAvatarBadge className="mt-1 shrink-0" />
                          ) : (
                            <div className={`mt-1 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border ${event.actorType === "ai" ? "room-ai-avatar" : "border-[color:var(--border)] bg-[color:var(--brand-soft)] text-[color:var(--brand-ink)]"}`}>
                              {actorGlyph}
                            </div>
                          )}
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="font-semibold text-[color:var(--foreground)]">{actorDisplayName(event, eventProviderId, t)}</p>
                              {buildEventBadges(event, eventProviderId, t).map((badge) => (
                                <Badge key={badge.key} tone={badge.tone}>{badge.label}</Badge>
                              ))}
                            </div>
                            {inlineRegeneratePendingReply ? (
                              <div className="room-ai-soft mt-3 rounded-xl border px-3 py-3">
                                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-[color:var(--muted)]">
                                  <ProviderReplyAvatar providerId={inlineRegeneratePendingReply.providerId} className="h-7 w-7 rounded-xl" />
                                  <span>{t("project.collaborationPanel.regenerate")}</span>
                                  <Badge>{inlineRegeneratePendingReply.model}</Badge>
                                  <span>{"\u2022"}</span>
                                  <span>{isStreaming ? t("project.collaborationPanel.streaming") : t("project.collaborationPanel.replyPending")}</span>
                                </div>
                                {isStreaming || hasStreamingPreview ? (
                                  <div className="mt-3">
                                    {streamReasoning.trim().length > 0 ? (
                                      <details open className="room-ai-soft mb-2 rounded-lg border px-3 py-2 text-xs text-[color:var(--muted)]">
                                        <summary className="cursor-pointer font-semibold">{t("project.collaborationPanel.aiThinking")}</summary>
                                        <p className="mt-2 whitespace-pre-wrap leading-5">{streamReasoning}</p>
                                      </details>
                                    ) : null}
                                    {streamContent.trim().length > 0 ? (
                                      <p className="whitespace-pre-wrap text-sm leading-7 text-[color:var(--foreground)]">
                                        {streamContent}
                                        {isStreaming ? <span className="animate-pulse">|</span> : null}
                                      </p>
                                    ) : (
                                      <div className="flex items-center gap-3 text-sm leading-6">
                                        <div className="room-ai-text flex items-center gap-1.5">
                                          <span className="h-2 w-2 animate-pulse rounded-full bg-current" />
                                          <span className="h-2 w-2 animate-pulse rounded-full bg-current [animation-delay:120ms]" />
                                          <span className="h-2 w-2 animate-pulse rounded-full bg-current [animation-delay:240ms]" />
                                        </div>
                                        <span className="text-[color:var(--muted)]">{t("project.collaborationPanel.replyPendingBody")}</span>
                                      </div>
                                    )}
                                    <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-[color:var(--muted)]">
                                      {streamContent.trim().length > 0 ? (
                                        <button
                                          type="button"
                                          onClick={() => void copyMessageText(streamContent)}
                                          className="inline-flex items-center gap-1.5 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-2.5 py-1 font-semibold transition hover:border-[color:var(--brand-solid)] hover:text-[color:var(--foreground)]"
                                        >
                                          <Copy className="h-3.5 w-3.5" />
                                          {t("common.copy")}
                                        </button>
                                      ) : null}
                                      {isStreaming ? <StopButton onClick={interruptPendingReply} label={t("project.collaborationPanel.stopGenerating")} /> : null}
                                    </div>
                                  </div>
                                ) : (
                                  <div className="mt-3 flex items-center gap-3 text-sm leading-6 text-[color:var(--foreground)]">
                                    <div className="room-ai-text flex items-center gap-1.5">
                                      <span className="h-2 w-2 animate-pulse rounded-full bg-current" />
                                      <span className="h-2 w-2 animate-pulse rounded-full bg-current [animation-delay:120ms]" />
                                      <span className="h-2 w-2 animate-pulse rounded-full bg-current [animation-delay:240ms]" />
                                    </div>
                                    <span className="text-[color:var(--muted)]">{t("project.collaborationPanel.replyPendingBody")}</span>
                                  </div>
                                )}
                              </div>
                            ) : event.message.trim().length > 0 ? (
                              <div className="mt-3">
                                {/* Saved reasoning content from metadata (e.g. DeepSeek Reasoner) */}
                                {event.actorType === "ai" && typeof event.metadata.reasoning === "string" && event.metadata.reasoning.trim().length > 0 ? (
                                  <details className="mb-2 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-muted)]/50 px-3 py-2 text-xs text-[color:var(--muted)]">
                                    <summary className="cursor-pointer font-semibold">{t("project.collaborationPanel.aiThinking")}</summary>
                                    <p className="mt-2 whitespace-pre-wrap leading-6">{event.metadata.reasoning}</p>
                                  </details>
                                ) : event.actorType === "ai" && event.message.includes("\n\n") && event.message.length > 500 ? (
                                  <details className="mb-2 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-muted)]/50 px-3 py-2 text-xs text-[color:var(--muted)]">
                                    <summary className="cursor-pointer font-semibold">{t("project.collaborationPanel.aiThinking")}</summary>
                                    <p className="mt-2 whitespace-pre-wrap leading-6">{event.message.split("\n\n").slice(0, -1).join("\n\n")}</p>
                                  </details>
                                ) : null}
                                {(() => {
                                  const displayMessage = event.actorType === "ai" && event.message.includes("\n\n") && event.message.length > 500 ? event.message.split("\n\n").slice(-1)[0] : event.message;
                                  if (!singleUserMode && typingEventId === event.id && !stoppedTypingIds.has(event.id)) {
                                    return (
                                      <div>
                                        <p className="whitespace-pre-wrap text-sm leading-7 text-[color:var(--foreground)]">
                                          <TypewriterText text={displayMessage} speed={15} onComplete={() => setTypingEventId(null)} />
                                          <StopButton onClick={() => { setStoppedTypingIds((s) => new Set(s).add(event.id)); setTypingEventId(null); }} label={t("project.collaborationPanel.stopGenerating")} />
                                        </p>
                                      </div>
                                    );
                                  }
                                  if (event.actorType === "ai") {
                                    return <MarkdownContent content={displayMessage} className="text-sm leading-7 text-[color:var(--foreground)]" />;
                                  }
                                  return (
                                    <p className="whitespace-pre-wrap text-sm leading-7 text-[color:var(--foreground)]">
                                      {chatSearch.trim() ? highlightChatSearch(displayMessage, chatSearch.trim()) : displayMessage}
                                    </p>
                                  );
                                })()}
                              </div>
                            ) : null}
                            {linkedAttachments.length > 0 ? (
                              <div className="mt-3 flex flex-wrap gap-2">
                                {linkedAttachments.map((attachment) => {
                                  const Icon = attachmentIcon(attachment!.kind);
                                  const href = buildAttachmentHref(project.id, attachment!);
                                  if (attachment!.kind === "image") {
                                    return (
                                      <a key={attachment!.id} href={href} target="_blank" rel="noreferrer" className="group block overflow-hidden rounded-xl border border-[color:var(--border)] transition hover:border-[color:var(--brand-solid)]">
                                        {/* eslint-disable-next-line @next/next/no-img-element */}
                                        <img src={href} alt={attachment!.name} className="h-32 max-w-[12rem] object-cover transition group-hover:scale-105" loading="lazy" />
                                        <div className="flex items-center gap-1.5 px-2 py-1.5 text-[10px] font-semibold text-[color:var(--muted)]">
                                          <Icon className="h-3 w-3" />{attachment!.name}
                                        </div>
                                      </a>
                                    );
                                  }
                                  return (
                                    <a key={attachment!.id} href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-3 py-2 text-xs font-semibold transition hover:border-[color:var(--brand-solid)]">
                                      <Icon className="h-3.5 w-3.5" />
                                      <span>{attachment!.name}</span>
                                      <Badge>{attachmentKindLabel(attachment!.kind, t)}</Badge>
                                    </a>
                                  );
                                })}
                              </div>
                            ) : null}
                            {event.reactions && Object.keys(event.reactions).length > 0 ? (
                              <div className="mt-2 flex flex-wrap gap-1">
                                {Object.entries(event.reactions).map(([emoji, userIds]) => (
                                  <span key={emoji} className="inline-flex items-center gap-1 rounded-full border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-2 py-0.5 text-xs">
                                    <span>{emoji}</span>
                                    <span className="font-semibold text-[color:var(--foreground)]">{(userIds as string[]).length}</span>
                                  </span>
                                ))}
                              </div>
                            ) : null}
                            {singleUserMode && event.actorType === "ai" && latestRegenerateTarget?.replaceAssistantEventId === event.id ? (
                              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-[color:var(--muted)]">
                                <button
                                  type="button"
                                  onClick={() => void submitMessage({
                                    message: latestRegenerateTarget.userMessage,
                                    attachmentIds: latestRegenerateTarget.attachmentIds,
                                    regenerate: true,
                                    replaceAssistantEventId: latestRegenerateTarget.replaceAssistantEventId,
                                  })}
                                  disabled={busy}
                                  className="inline-flex items-center gap-1.5 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-3 py-1.5 font-semibold transition hover:border-[color:var(--brand-solid)] hover:text-[color:var(--foreground)] disabled:opacity-60"
                                >
                                  <RotateCcw className="h-3.5 w-3.5" />
                                  {t("project.collaborationPanel.regenerate")}
                                </button>
                                <span>{t("project.collaborationPanel.regenerateHint")}</span>
                              </div>
                            ) : null}
                            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-[color:var(--muted)]">
                              <span>{formatDateTime(event.createdAt, locale)}</span>
                              {event.metadata.status ? <span>{`• ${t(`presenceStates.${event.metadata.status}`)}`}</span> : null}
                              {revisionView ? (
                                <span className="inline-flex items-center gap-1 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-2 py-1 font-semibold">
                                  <button
                                    type="button"
                                    disabled={busy || revisionView.activeIndex <= 0}
                                    onClick={() => {
                                      const previous = revisionView.revisions[revisionView.activeIndex - 1];
                                      if (previous) void runInlineEventMutation({ eventId: event.id, action: "activateRevision", revisionId: previous.id });
                                    }}
                                    className="px-1 text-[color:var(--foreground)] disabled:opacity-40"
                                    aria-label="Previous assistant reply revision"
                                  >
                                    {"‹"}
                                  </button>
                                  <span>{revisionView.activeIndex + 1} / {revisionView.revisions.length}</span>
                                  <button
                                    type="button"
                                    disabled={busy || revisionView.activeIndex >= revisionView.revisions.length - 1}
                                    onClick={() => {
                                      const next = revisionView.revisions[revisionView.activeIndex + 1];
                                      if (next) void runInlineEventMutation({ eventId: event.id, action: "activateRevision", revisionId: next.id });
                                    }}
                                    className="px-1 text-[color:var(--foreground)] disabled:opacity-40"
                                    aria-label="Next assistant reply revision"
                                  >
                                    {"›"}
                                  </button>
                                </span>
                              ) : null}
                              {event.type === "message" ? (
                                <>
                                  {event.message.trim().length > 0 ? (
                                    <button
                                      type="button"
                                      onClick={() => void copyMessageText(event.message)}
                                      className="inline-flex items-center gap-1 text-[color:var(--brand-solid)] opacity-0 transition group-hover:opacity-100 hover:underline"
                                    >
                                      <Copy className="h-3 w-3" />
                                      {t("common.copy")}
                                    </button>
                                  ) : null}
                                  <button type="button" onClick={() => setReplyToEvent({ id: event.id, name: event.participantName ?? event.actorType ?? "", text: event.message.slice(0, 80) })} className="text-[color:var(--brand-solid)] opacity-0 transition group-hover:opacity-100 hover:underline">{t("project.collaborationPanel.reply")}</button>
                                  <span className="flex gap-0.5 opacity-0 transition group-hover:opacity-100">
                                    {["👍", "❤️", "😂", "🤔"].map((emoji) => (
                                      <button key={emoji} type="button" className="rounded px-1 py-0.5 text-sm transition hover:bg-[color:var(--surface-hover)]" title={emoji} onClick={async () => {
                                        await runInlineEventMutation({ eventId: event.id, emoji });
                                      }}>{emoji}</button>
                                    ))}
                                  </span>
                                  {/* Edit/Delete — only for own messages */}
                                  {event.participantId && access.ownedParticipantIds.includes(event.participantId) && event.actorType !== "ai" ? (
                                    <span className="flex gap-0.5 opacity-0 transition group-hover:opacity-100">
                                      <button type="button" className="rounded px-1 py-0.5 text-[color:var(--muted)] transition hover:bg-[color:var(--surface-hover)] hover:text-[color:var(--foreground)]" title={t("common.edit")} onClick={() => setEditingEvent({ id: event.id, message: event.message })}>
                                        <Pencil className="h-3 w-3" />
                                      </button>
                                      <button type="button" className="room-icon-danger rounded px-1 py-0.5 text-[color:var(--muted)] transition" title={t("common.delete")} onClick={() => setDeleteConfirmId(event.id)}>
                                        <Trash2 className="h-3 w-3" />
                                      </button>
                                    </span>
                                  ) : null}
                                </>
                              ) : null}
                              {access.canModerate && event.type === "message" ? (
                                <button type="button" className="rounded px-1 py-0.5 text-[color:var(--muted)] opacity-0 transition hover:bg-[color:var(--surface-hover)] hover:text-[color:var(--foreground)] group-hover:opacity-100" title={event.pinned ? t("project.collaborationPanel.unpin") : t("project.collaborationPanel.pin")} onClick={async () => {
                                  await runInlineEventMutation({ eventId: event.id, action: event.pinned ? "unpin" : "pin" });
                                }}>
                                  <Pin className={`h-3 w-3 ${event.pinned ? "room-pin-icon-active" : ""}`} />
                                </button>
                              ) : null}
                              {event.pinned ? <span className="room-pin-label text-[10px] font-semibold">{t("project.collaborationPanel.pinned")}</span> : null}
                              {event.editedAt ? <span className="text-[10px] italic text-[color:var(--muted)]">{t("project.collaborationPanel.edited")}</span> : null}
                              {deleteConfirmId === event.id ? (
                                <span className="room-danger-inline animate-popover-in inline-flex items-center gap-2 rounded-lg border px-2.5 py-1 text-[11px]">
                                  <span className="room-danger-text font-semibold">{t("project.collaborationPanel.deleteConfirmMsg")}</span>
                                  <button type="button" className="room-danger-text font-bold hover:underline" onClick={async () => {
                                    await runInlineEventMutation(
                                      { eventId: event.id, action: "delete" },
                                      { closeDeleteConfirm: true },
                                    );
                                  }}>{t("common.delete")}</button>
                                  <button type="button" className="text-[color:var(--muted)] hover:underline" onClick={() => setDeleteConfirmId(null)}>{t("common.cancel")}</button>
                                </span>
                              ) : null}
                            </div>
                            {editingEvent?.id === event.id ? (
                              <div className="animate-popover-in mt-2 space-y-2">
                                <textarea className="form-field min-h-20 text-sm" value={editingEvent.message} onChange={(e) => setEditingEvent({ ...editingEvent, message: e.target.value })} />
                                <div className="flex gap-2">
                                  <Button className="px-3 py-1.5 text-xs" onClick={async () => {
                                    await runInlineEventMutation(
                                      { eventId: event.id, action: "edit", message: editingEvent.message },
                                      { closeEditingEvent: true },
                                    );
                                  }}>{t("common.save")}</Button>
                                  <Button variant="ghost" className="px-3 py-1.5 text-xs" onClick={() => setEditingEvent(null)}>{t("common.cancel")}</Button>
                                </div>
                              </div>
                            ) : null}
                          </div>
                        </div>
                      </article>
                    );
                    })}
                  </>
                )}
                {singleUserMode && pendingReply && !pendingReply.regenerate ? (
                  <>
                    {pendingReply.regenerate ? null : (
                      <article className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface-soft)] p-4 shadow-[0_18px_40px_rgba(15,23,42,0.06)]">
                        <div className="flex gap-4">
                          <div className="mt-1 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-[color:var(--border)] bg-[color:var(--brand-soft)] text-[color:var(--brand-ink)]">
                            <Sparkles className="h-4 w-4" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="font-semibold text-[color:var(--foreground)]">{effectiveSettings.profile.displayName}</p>
                              <Badge tone="success">{t("project.collaborationPanel.actorParticipant")}</Badge>
                            </div>
                            {pendingReply.userMessage.trim().length > 0 ? <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-[color:var(--foreground)]">{pendingReply.userMessage}</p> : null}
                            {pendingReply.attachmentIds.length > 0 ? (
                              <div className="mt-3 flex flex-wrap gap-2">
                                {pendingReply.attachmentIds
                                  .map((attachmentId) => attachmentMap.get(attachmentId))
                                  .filter((attachment): attachment is NonNullable<typeof state>['attachments'][number] => Boolean(attachment))
                                  .map((attachment) => {
                                    const Icon = attachmentIcon(attachment.kind);
                                    return (
                                      <a key={`pending-room-${attachment.id}`} href={buildAttachmentHref(project.id, attachment)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-full border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-3 py-2 text-xs font-semibold transition hover:border-[color:var(--brand-solid)]">
                                        <Icon className="h-3.5 w-3.5" />
                                        <span>{attachment.name}</span>
                                      </a>
                                    );
                                  })}
                              </div>
                            ) : null}
                            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-[color:var(--muted)]">
                              <span>{formatDateTime(pendingReply.submittedAt, locale)}</span>
                              {pendingReply.userMessage.trim().length > 0 ? (
                                <button
                                  type="button"
                                  onClick={() => void copyMessageText(pendingReply.userMessage)}
                                  className="inline-flex items-center gap-1.5 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-2.5 py-1 font-semibold transition hover:border-[color:var(--brand-solid)] hover:text-[color:var(--foreground)]"
                                >
                                  <Copy className="h-3.5 w-3.5" />
                                  {t("common.copy")}
                                </button>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      </article>
                    )}
                    <article className="room-ai-surface rounded-2xl border p-4 shadow-[0_12px_28px_rgba(15,23,42,0.05)]">
                      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-[color:var(--muted)]">
                        <ProviderReplyAvatar providerId={pendingReply.providerId} className="h-8 w-8 rounded-xl" />
                        <span>{t(`providersCatalog.${pendingReply.providerId}.label`)}</span>
                        <Badge>{pendingReply.model}</Badge>
                        <span>{"\u2022"}</span>
                        <span>{isStreaming ? t("project.collaborationPanel.streaming") : t("project.collaborationPanel.replyPending")}</span>
                      </div>
                      {isStreaming || hasStreamingPreview ? (
                        <div className="mt-3">
                          {streamReasoning.trim().length > 0 ? (
                            <details open className="room-ai-soft mb-2 rounded-lg border px-3 py-2 text-xs text-[color:var(--muted)]">
                              <summary className="cursor-pointer font-semibold">{t("project.collaborationPanel.aiThinking")}</summary>
                              <p className="mt-2 whitespace-pre-wrap leading-5">{streamReasoning}</p>
                            </details>
                          ) : null}
                          {streamContent.trim().length > 0 ? (
                            <p className="whitespace-pre-wrap text-sm leading-7 text-[color:var(--foreground)]">
                              {streamContent}
                              {isStreaming ? <span className="animate-pulse">|</span> : null}
                            </p>
                          ) : (
                            <div className="flex items-center gap-3 text-sm leading-6">
                              <div className="room-ai-text flex items-center gap-1.5">
                                <span className="h-2 w-2 animate-pulse rounded-full bg-current" />
                                <span className="h-2 w-2 animate-pulse rounded-full bg-current [animation-delay:120ms]" />
                                <span className="h-2 w-2 animate-pulse rounded-full bg-current [animation-delay:240ms]" />
                              </div>
                              <span className="text-[color:var(--muted)]">{t("project.collaborationPanel.replyPendingBody")}</span>
                            </div>
                          )}
                          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-[color:var(--muted)]">
                            {streamContent.trim().length > 0 ? (
                              <button
                                type="button"
                                onClick={() => void copyMessageText(streamContent)}
                                className="inline-flex items-center gap-1.5 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-2.5 py-1 font-semibold transition hover:border-[color:var(--brand-solid)] hover:text-[color:var(--foreground)]"
                              >
                                <Copy className="h-3.5 w-3.5" />
                                {t("common.copy")}
                              </button>
                            ) : null}
                            {isStreaming ? <StopButton onClick={interruptPendingReply} label={t("project.collaborationPanel.stopGenerating")} /> : null}
                          </div>
                        </div>
                      ) : (
                        <div className="mt-3 flex items-center gap-3 text-sm leading-6 text-[color:var(--foreground)]">
                          <div className="room-ai-text flex items-center gap-1.5">
                            <span className="h-2 w-2 animate-pulse rounded-full bg-current" />
                            <span className="h-2 w-2 animate-pulse rounded-full bg-current [animation-delay:120ms]" />
                            <span className="h-2 w-2 animate-pulse rounded-full bg-current [animation-delay:240ms]" />
                          </div>
                          <span className="text-[color:var(--muted)]">{t("project.collaborationPanel.replyPendingBody")}</span>
                        </div>
                      )}
                    </article>
                  </>
                ) : null}
                {singleUserMode && interruptedReply ? (
                  <article className="room-ai-surface rounded-2xl border p-4 shadow-[0_12px_28px_rgba(15,23,42,0.05)]">
                    <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-[color:var(--muted)]">
                      <ProviderReplyAvatar providerId={interruptedReply.providerId} className="h-8 w-8 rounded-xl" />
                      <span>{t(`providersCatalog.${interruptedReply.providerId}.label`)}</span>
                      <Badge>{interruptedReply.model}</Badge>
                      <span>{"\u2022"}</span>
                      <span>{t("project.collaborationPanel.generationStopped")}</span>
                    </div>
                    {interruptedReply.partialReasoning.trim().length > 0 ? (
                      <details className="room-ai-soft mt-3 rounded-lg border px-3 py-2 text-xs text-[color:var(--muted)]">
                        <summary className="cursor-pointer font-semibold">{t("project.collaborationPanel.aiThinking")}</summary>
                        <p className="mt-2 whitespace-pre-wrap leading-5">{interruptedReply.partialReasoning}</p>
                      </details>
                    ) : null}
                    <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-[color:var(--foreground)]">
                      {interruptedReply.partialContent || t("project.collaborationPanel.replyInterruptedEmpty")}
                    </p>
                    <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-[color:var(--muted)]">
                      {interruptedReply.partialContent.trim().length > 0 ? (
                        <button
                          type="button"
                          onClick={() => void copyMessageText(interruptedReply.partialContent)}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-2.5 py-1 font-semibold transition hover:border-[color:var(--brand-solid)] hover:text-[color:var(--foreground)]"
                        >
                          <Copy className="h-3.5 w-3.5" />
                          {t("common.copy")}
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => void submitMessage({
                          message: interruptedReply.userMessage,
                          attachmentIds: interruptedReply.attachmentIds,
                          regenerate: Boolean(interruptedReply.replaceAssistantEventId),
                          replaceAssistantEventId: interruptedReply.replaceAssistantEventId,
                        })}
                        disabled={busy}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-3 py-1.5 font-semibold transition hover:border-[color:var(--brand-solid)] hover:text-[color:var(--foreground)] disabled:opacity-60"
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                        {t("project.collaborationPanel.regenerate")}
                      </button>
                      <span>{t("project.collaborationPanel.regenerateHint")}</span>
                    </div>
                  </article>
                ) : null}
              </div>
            </div>

            <div className="border-t border-[color:var(--border)] px-5 py-5 lg:px-6">
              <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
                <div className="space-y-4">
                  <div>
                    <h3 className="font-display text-xl font-semibold">{singleUserMode ? t("project.collaborationPanel.singleUserTitle") : t("project.collaborationPanel.composeTitle")}</h3>
                    <p className="mt-1 text-sm leading-6 text-[color:var(--muted)]">{singleUserMode ? t("project.collaborationPanel.singleUserBody") : t("project.collaborationPanel.composeBody")}</p>
                    <p className="mt-2 text-xs leading-5 text-[color:var(--muted)]">{t("common.aiDisclaimer")}</p>
                  </div>
                  <div className="space-y-4 rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-4">
                    {composerNotice ? (
                      <div className="rounded-xl border border-dashed border-[color:var(--border)] bg-[color:var(--surface-strong)] px-4 py-4 text-sm leading-6 text-[color:var(--muted)]">
                        {composerNotice}
                        {access.canJoinPublicRoom ? (
                          <Button className="mt-3 gap-2" onClick={joinPublicRoom} disabled={busy}>
                            <Users className="h-4 w-4" />
                            {busy ? `${t("common.loading")}...` : t("project.collaborationPanel.joinPublicRoom")}
                          </Button>
                        ) : null}
                      </div>
                    ) : null}
                    {replyToEvent ? (
                      <div className="flex items-center justify-between gap-2 rounded-t-xl border border-b-0 border-[color:var(--border)] bg-[color:var(--surface-strong)] px-3 py-2 text-xs">
                        <div className="min-w-0">
                          <span className="font-semibold text-[color:var(--brand-solid)]">{t("project.collaborationPanel.replyingTo")} {replyToEvent.name}</span>
                          <p className="mt-0.5 truncate text-[color:var(--muted)]">{replyToEvent.text}</p>
                        </div>
                        <button type="button" onClick={() => setReplyToEvent(null)} className="shrink-0 text-[color:var(--muted)] hover:text-[color:var(--foreground)]">{"\u2715"}</button>
                      </div>
                    ) : null}
                    <div className="relative">
                      {showMentionPopup && participants.length > 0 ? (
                        <div className="absolute bottom-full left-0 z-20 mb-1 max-h-40 w-56 overflow-y-auto rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-strong)] py-1 shadow-lg">
                          {participants.map((p) => (
                            <button key={p.id} type="button" className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-semibold transition hover:bg-[color:var(--surface-hover)]" onClick={() => {
                              const before = messageDraft.slice(0, messageDraft.lastIndexOf("@"));
                              setMessageDraft(before + `@${p.name} `);
                              setShowMentionPopup(false);
                              composerRef.current?.focus();
                            }}>
                              <span className="h-5 w-5 rounded-full bg-[color:var(--brand-soft)] text-center text-[10px] font-bold leading-5 text-[color:var(--brand-ink)]">{p.name[0]}</span>
                              {p.name}
                            </button>
                          ))}
                        </div>
                      ) : null}
                      <textarea ref={composerRef} className={`${fieldClass} min-h-32 ${replyToEvent ? "rounded-t-none" : ""}`} value={messageDraft} onChange={(event) => {
                        const val = event.target.value;
                        setMessageDraft(val);
                        const lastChar = val.slice(-1);
                        const charBefore = val.slice(-2, -1);
                        if (lastChar === "@" && (!charBefore || charBefore === " " || charBefore === "\n")) {
                          setShowMentionPopup(true);
                        } else if (showMentionPopup && (lastChar === " " || lastChar === "\n")) {
                          setShowMentionPopup(false);
                        }
                      }} onKeyDown={(event) => {
                        if (showMentionPopup && event.key === "Escape") { setShowMentionPopup(false); return; }
                        handleComposerKeyDown(event);
                      }} placeholder={singleUserMode ? t("project.collaborationPanel.singleUserPlaceholder") : t("project.collaborationPanel.messagePlaceholder")} disabled={!access.canPostMessages} />
                    </div>
                    {pendingAttachments.length > 0 ? (
                      <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-strong)] px-4 py-4 text-sm leading-6 text-[color:var(--muted)]">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <p>{t("project.collaborationPanel.pendingAttachments", { count: String(pendingAttachments.length) })}</p>
                          <Badge>{t("connectionStates.ready")}</Badge>
                        </div>
                        <div className="mt-3 grid gap-3 sm:grid-cols-2">
                          {pendingAttachments.map((attachment) => {
                            const Icon = attachmentIcon(attachment.kind);
                            const directReadable = attachmentCanDirectConversation(attachment, singleUserConversationCapabilities);
                            const attachmentHref = buildAttachmentHref(project.id, attachment);
                            return (
                              <div key={`pending-room-${attachment.id}`} className="flex items-start gap-3 rounded-[1rem] border border-[color:var(--border)] bg-[color:var(--surface)] px-3 py-3">
                                {attachment.kind === "image" ? (
                                  /* eslint-disable-next-line @next/next/no-img-element */
                                  <img src={attachmentHref} alt={attachment.name} className="h-14 w-14 rounded-xl border border-[color:var(--border)] object-cover" />
                                ) : (
                                  <span className="inline-flex h-14 w-14 items-center justify-center rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-soft)]">
                                    <Icon className="h-5 w-5" />
                                  </span>
                                )}
                                <div className="min-w-0 flex-1">
                                  <p className="truncate text-sm font-semibold text-[color:var(--foreground)]">{attachment.name}</p>
                                  <div className="mt-2 flex flex-wrap gap-2">
                                    <Badge>{singleUserMode ? (directReadable ? t("project.collaborationPanel.directInputReady") : t("project.collaborationPanel.referenceAttachment")) : t("connectionStates.ready")}</Badge>
                                  </div>
                                </div>
                                <Button variant="ghost" className="shrink-0 px-3 py-2 text-xs" onClick={() => setPendingAttachmentIds((current) => current.filter((item) => item !== attachment.id))}>
                                  {t("common.remove")}
                                </Button>
                              </div>
                            );
                          })}
                        </div>
                        {singleUserMode && pendingDirectAttachmentCount !== pendingAttachments.length ? <p className="mt-3 text-xs leading-6 text-[color:var(--muted)]">{t("project.collaborationPanel.referenceAttachmentHint")}</p> : null}
                      </div>
                    ) : null}
                    <div className="flex flex-wrap items-center gap-3">
                      <Button className="gap-2" onClick={() => void submitMessage()} disabled={busy || !access.canPostMessages || (!messageDraft.trim() && pendingAttachmentIds.length === 0)}>
                        <Send className="h-4 w-4" />
                        {busy ? `${t("common.loading")}...` : t("project.collaborationPanel.sendMessage")}
                      </Button>
                      <div className="relative">
                        <button type="button" onClick={() => setEmojiPickerOpen((v) => !v)} className="inline-flex items-center justify-center rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-strong)] px-3 py-2.5 text-sm transition hover:bg-[color:var(--surface-hover)]" title={t("assistant.emojiPicker")}>
                          <Smile className="h-4 w-4 text-[color:var(--muted)]" />
                        </button>
                        {emojiPickerOpen ? (
                          <EmojiPicker
                            onSelect={(emoji) => {
                              const ta = composerRef.current;
                              if (ta) {
                                const start = ta.selectionStart ?? messageDraft.length;
                                const end = ta.selectionEnd ?? start;
                                setMessageDraft(messageDraft.slice(0, start) + emoji + messageDraft.slice(end));
                                requestAnimationFrame(() => { ta.focus(); ta.setSelectionRange(start + emoji.length, start + emoji.length); });
                              } else {
                                setMessageDraft(messageDraft + emoji);
                              }
                              setEmojiPickerOpen(false);
                            }}
                            onClose={() => setEmojiPickerOpen(false)}
                          />
                        ) : null}
                      </div>
                      {(settings.quickReplies?.length ?? 0) > 0 ? (
                        <div className="relative">
                          <button type="button" onClick={() => setShowQuickReplies((v) => !v)} className="inline-flex items-center justify-center rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-strong)] px-3 py-2.5 text-sm transition hover:bg-[color:var(--surface-hover)]" title={t("project.collaborationPanel.quickReplies")}>
                            <MessageSquareText className="h-4 w-4 text-[color:var(--muted)]" />
                          </button>
                          {showQuickReplies ? (
                            <div className="animate-popover-in absolute bottom-full left-0 z-20 mb-1 w-56 rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-strong)] py-1 shadow-lg">
                              {(settings.quickReplies ?? []).map((reply, i) => (
                                <button key={i} type="button" className="flex w-full items-center px-3 py-2 text-left text-xs transition hover:bg-[color:var(--surface-hover)]" onClick={() => { setMessageDraft((prev) => prev + reply); setShowQuickReplies(false); composerRef.current?.focus(); }}>
                                  <span className="truncate">{reply}</span>
                                </button>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                      {canStageImages ? (
                        <label className="inline-flex items-center gap-2 rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-strong)] px-4 py-2.5 text-sm font-semibold ">
                          <input ref={imageFileRef} type="file" accept="image/*" multiple className="hidden" disabled={!access.canUploadAttachments} onChange={(event) => { const files = event.target.files; if (files?.length) void submitUpload(files, "image"); }} />
                          <FileImage className="h-4 w-4" />
                          <span>{t("project.collaborationPanel.uploadImage")}</span>
                        </label>
                      ) : null}
                      {canStageDocuments ? (
                        <label className="inline-flex items-center gap-2 rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-strong)] px-4 py-2.5 text-sm font-semibold ">
                          <input ref={documentFileRef} type="file" accept={buildDocumentUploadAccept()} multiple className="hidden" disabled={!access.canUploadAttachments} onChange={(event) => { const files = event.target.files; if (files?.length) void submitUpload(files, "document"); }} />
                          <FileText className="h-4 w-4" />
                          <span>{t("project.collaborationPanel.uploadDocument")}</span>
                        </label>
                      ) : null}
                      <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-strong)] px-4 py-2.5 text-xs text-[color:var(--muted)] ">
                        {`${t("project.collaborationPanel.maxUpload")}: ${settings.uploadPreferences.maxUploadMb} MB`}
                      </div>
                    </div>
                    {singleUserMode && !singleUserConversationCapabilities.image && pendingAttachments.some((a) => a.kind === "image") ? (() => {
                      const desc = getProviderDescriptor(effectiveSingleUserProviderId);
                      const imageModel = desc?.models.find((m) => m.inputCapabilities?.image && m.id !== effectiveSingleUserModel);
                      return (
                        <div className="room-caution-surface rounded-xl border px-3 py-2 text-xs font-semibold">
                          <div className="flex items-center gap-2">
                            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                            {t("project.collaborationPanel.imageNotSupported")}
                          </div>
                          {imageModel ? (
                            <button type="button" className="room-caution-button mt-1.5 rounded-lg px-2.5 py-1 text-[11px] font-semibold transition" onClick={() => {
                              void patchSettings({ provider: { providers: { [effectiveSingleUserProviderId]: { model: imageModel.id } } } }).catch((error) => {
                                setMessage(error instanceof Error ? error.message : t("errors.saveFailed"));
                              });
                            }}>
                              {t("project.collaborationPanel.switchToModel", { model: imageModel.label })}
                            </button>
                          ) : (
                            <p className="mt-1 text-[10px] font-normal opacity-80">{t("project.collaborationPanel.switchProviderHint")}</p>
                          )}
                        </div>
                      );
                    })() : null}
                    {singleUserMode && (singleUserModelCapabilities.image || singleUserModelCapabilities.video || singleUserModelCapabilities.audio) ? <p className="text-xs leading-6 text-[color:var(--muted)]">{t("project.collaborationPanel.attachmentContextOnly")}</p> : null}
                  </div>
                </div>

                <div className="space-y-4 rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-5">
                  <div>
                    <h3 className="font-display text-xl font-semibold">{t("project.collaborationPanel.aiActionsTitle")}</h3>
                    <p className="mt-1 text-sm leading-6 text-[color:var(--muted)]">{singleUserMode ? t("project.collaborationPanel.singleUserAiBody") : t("project.collaborationPanel.aiActionsBody")}</p>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <Button variant="ghost" className="gap-2" onClick={() => onRunAiTask?.("summarizeDiscussion")} disabled={!access.canRunAiTasks || taskBusy !== null}>
                      <Sparkles className="h-4 w-4" />
                      {taskBusy === "summarizeDiscussion" ? `${t("common.loading")}...` : t("project.collaborationPanel.runSummary")}
                    </Button>
                    <Button variant="ghost" className="gap-2" onClick={() => onRunAiTask?.("evaluateDiscussion")} disabled={!access.canRunAiTasks || taskBusy !== null}>
                      <Bot className="h-4 w-4" />
                      {taskBusy === "evaluateDiscussion" ? `${t("common.loading")}...` : t("project.collaborationPanel.runEvaluation")}
                    </Button>
                    <Button variant="ghost" className="gap-2" onClick={() => onRunAiTask?.("generateFollowupQuestions")} disabled={!access.canRunAiTasks || taskBusy !== null}>
                      <MessagesSquare className="h-4 w-4" />
                      {taskBusy === "generateFollowupQuestions" ? `${t("common.loading")}...` : t("project.collaborationPanel.runFollowup")}
                    </Button>
                  </div>
                  <div className="space-y-2 rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-strong)] px-4 py-3 text-xs leading-6 text-[color:var(--muted)]">
                    <p><span className="font-semibold text-[color:var(--foreground)]">{t("project.collaborationPanel.runSummary")}</span>{`: ${t("project.collaborationPanel.runSummaryHint")}`}</p>
                    <p><span className="font-semibold text-[color:var(--foreground)]">{t("project.collaborationPanel.runEvaluation")}</span>{`: ${t("project.collaborationPanel.runEvaluationHint")}`}</p>
                    <p><span className="font-semibold text-[color:var(--foreground)]">{t("project.collaborationPanel.runFollowup")}</span>{`: ${t("project.collaborationPanel.runFollowupHint")}`}</p>
                  </div>
                </div>

                <div className="xl:col-span-2">
                  <div className="min-h-[17rem] rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[color:var(--muted)]">{t("project.collaborationPanel.latestAiTitle")}</p>
                        {latestAiEvent ? <p className="mt-1 text-sm text-[color:var(--muted)]">{formatDateTime(latestAiEvent.createdAt, locale)}</p> : null}
                      </div>
                    </div>
                    {latestAiEvents.length > 0 ? (
                      <div className="soft-scrollbar mt-4 grid max-h-[20rem] gap-3 overflow-y-auto pr-1">
                        {latestAiEvents.map((event) => {
                          const digest = buildLatestAiInterventionDigest(event, locale);
                          return (
                            <article key={event.id} className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface-strong)] p-4">
                              <div className="flex flex-wrap items-start justify-between gap-3">
                                <div>
                                  <p className="text-sm font-semibold text-[color:var(--foreground)]">{eventLabel(event, t)}</p>
                                  <p className="mt-1 text-xs text-[color:var(--muted)]">{formatDateTime(event.createdAt, locale)}</p>
                                </div>
                              </div>
                              <MarkdownContent content={digest.markdown} className="mt-3 text-sm leading-7 text-[color:var(--foreground)]" />
                              {digest.isTruncated ? (
                                <details className="mt-3 rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-3 py-2 text-xs leading-6 text-[color:var(--muted)]">
                                  <summary className="cursor-pointer font-semibold text-[color:var(--foreground)]">{digest.originalExcerptLabel}</summary>
                                  <p className="mt-2 whitespace-pre-wrap">{digest.originalExcerpt}</p>
                                </details>
                              ) : null}
                            </article>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="mt-4 flex min-h-[9.125rem] items-center rounded-2xl border border-dashed border-[color:var(--border)] bg-[color:var(--surface-strong)] px-5 py-6 text-sm leading-6 text-[color:var(--muted)]">
                        <p>{t("project.collaborationPanel.latestAiEmpty")}</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
              {message ? <p className="mt-4 text-sm text-emerald-600 dark:text-emerald-300">{message}</p> : null}
            </div>
          </div>
        </Panel>
      </div>

      <div className="space-y-5 self-start lg:sticky lg:top-24">
        {isRoomArchived ? (
          <div className="room-caution-surface flex items-center gap-3 rounded-2xl border px-5 py-4 text-sm font-semibold">
            <Archive className="h-5 w-5 shrink-0" />
            <span>{t("roomManage.roomArchived")}</span>
          </div>
        ) : null}

        <Panel className="space-y-5 p-6">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-[color:var(--brand-solid)]" />
              <h3 className="font-display text-xl font-semibold">{t("project.collaborationPanel.presenceTitle")}</h3>
            </div>
            <p className="mt-1 text-sm leading-6 text-[color:var(--muted)]">{t("project.collaborationPanel.membersBody")}</p>
            </div>
            {presenceRoster.length > 0 ? (
              <button
                type="button"
                onClick={() => setPresenceManagerOpen(true)}
                className="shrink-0 rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-strong)] px-3 py-2 text-xs font-semibold text-[color:var(--foreground)] shadow-sm transition hover:bg-[color:var(--surface-hover)]"
              >
                {presenceManagerButtonLabel}
              </button>
            ) : null}
          </div>
          <div className="soft-scrollbar max-h-[18rem] overflow-y-auto pr-1">
            <div className="space-y-3">
            {presenceRoster.map((presence) => {
              const participant = participants.find((candidate) => candidate.id === presence.participantId);
              const isDisplaySelf = isDisplayOwnedParticipant(participant);
              const canManageThisParticipant = Boolean(participant && !sampleMutationLocked && !isRoomArchived && !isDisplaySelf);
              const canKick = Boolean(participant && canManageThisParticipant && canRemoveParticipant(project, access, participant));
              const canRole = Boolean(participant && canManageThisParticipant && access.canAssignRoles && participant.collaborationRole !== "host");
              const canTransfer = Boolean(participant && canManageThisParticipant && access.canTransferOwnership);
              const isRoleMenuOpenForThis = roleMenuOpen === presence.participantId;
              const roleIcon = presence.role === "host" ? Crown : presence.role === "facilitator" ? ShieldCheck : Shield;
              const RoleIcon = roleIcon;

              return (
                <div key={presence.connectionId} className="group rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-4 transition hover:border-[color:var(--brand-solid)]/30">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="relative">
                        <Avatar
                          name={participant?.name ?? presence.participantName}
                          label={participant ? resolveParticipantAvatar(participant, effectiveSettings.profile).label : pickInitials(presence.participantName || effectiveSettings.profile.displayName)}
                          preset={participant ? resolveParticipantAvatar(participant, effectiveSettings.profile).preset : undefined}
                          imageDataUrl={participant ? resolveParticipantAvatar(participant, effectiveSettings.profile).imageDataUrl : undefined}
                          className="h-10 w-10 rounded-2xl text-xs"
                        />
                        <span className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-[color:var(--surface-muted)] ${presence.active ? "bg-emerald-500" : "bg-zinc-400"}`} />
                      </div>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          {participant && isDisplayOwnedParticipant(participant) ? (
                            <input
                              type="text"
                              value={participant.name}
                              onChange={(e) => {
                                if (sampleMutationLocked) {
                                  setMessage(sampleMutationMessage);
                                  return;
                                }
                                const nextName = e.target.value;
                                onProjectChange?.({ ...project, participants: project.participants.map((p) => p.id === participant.id ? { ...p, name: nextName } : p) });
                              }}
                              onBlur={() => {
                                if (sampleMutationLocked) {
                                  setMessage(sampleMutationMessage);
                                  return;
                                }
                                const baseProject = {
                                  ...project,
                                  participants: project.participants.map((candidate) =>
                                    candidate.id === participant.id
                                      ? { ...candidate, name: presence.participantName }
                                      : candidate),
                                };
                                void patchProjectState(
                                  project.id,
                                  { participants: project.participants },
                                  { baseProject, locale },
                                )
                                  .then((saved) => onProjectChange?.(saved))
                                  .catch(() => setMessage(t("errors.saveFailed")));
                              }}
                              className="max-w-[10rem] rounded border border-transparent bg-transparent px-1 font-semibold outline-none focus:border-[color:var(--brand-solid)] focus:bg-[color:var(--surface-strong)]"
                            />
                          ) : (
                            <p className="font-semibold">{presence.participantName}</p>
                          )}
                          <Badge tone={toneForPresence(presence.status)}>{t(`presenceStates.${presence.status}`)}</Badge>
                          <span className="inline-flex items-center gap-1">
                            <RoleIcon className="h-3 w-3 text-[color:var(--muted)]" />
                            <Badge>{t(`collaborationRoles.${presence.role}`)}</Badge>
                          </span>
                          {presence.isTyping ? <Badge tone="accent">{t("project.collaborationPanel.typing")}</Badge> : null}
                        </div>
                        {getNickname(presence.participantId) ? (
                          <p className="mt-0.5 text-[11px] font-medium text-[color:var(--brand-solid)]">{getNickname(presence.participantId)}</p>
                        ) : null}
                        <p className="mt-1 text-xs text-[color:var(--muted)]">{formatDateTime(presence.lastHeartbeatAt, locale)}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      {currentSpeaker === presence.participantName ? <Badge tone="accent">{t("project.collaborationPanel.currentSpeaker")}</Badge> : null}
                    </div>
                  </div>

                  {/* Nickname editor */}
                  {nicknameEditing === presence.participantId ? (
                    <div className="mt-3 flex items-center gap-2 border-t border-[color:var(--border)] pt-3">
                      <input
                        type="text"
                        value={nicknameDraft}
                        onChange={(e) => setNicknameDraft(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") void saveNickname(presence.participantId, nicknameDraft); if (e.key === "Escape") { setNicknameEditing(null); setNicknameDraft(""); } }}
                        placeholder={t("roomManage.nicknamePlaceholder")}
                        className="flex-1 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-strong)] px-2.5 py-1.5 text-xs text-[color:var(--foreground)] outline-none focus:border-[color:var(--brand-solid)]"
                        autoFocus
                      />
                      <button
                        type="button"
                        onClick={() => void saveNickname(presence.participantId, nicknameDraft)}
                        className="rounded-lg bg-[color:var(--brand-solid)] px-2.5 py-1.5 text-xs font-semibold text-white"
                      >{t("common.save")}</button>
                      <button
                        type="button"
                        onClick={() => { setNicknameEditing(null); setNicknameDraft(""); }}
                        className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-strong)] px-2.5 py-1.5 text-xs font-semibold text-[color:var(--muted)]"
                      >{t("common.cancel")}</button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => { setNicknameEditing(presence.participantId); setNicknameDraft(getNickname(presence.participantId)); }}
                      className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-[color:var(--muted)] transition hover:text-[color:var(--brand-solid)]"
                    >
                      <Pencil className="h-3 w-3" />
                      {getNickname(presence.participantId) ? t("common.edit") : t("roomManage.nicknameLabel")}
                    </button>
                  )}

                  {(canKick || canRole || canTransfer) ? (
                    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[color:var(--border)] pt-3">
                      {canRole && participant ? (
                        <div className="relative">
                          <button
                            type="button"
                            onClick={() => setRoleMenuOpen(isRoleMenuOpenForThis ? null : presence.participantId)}
                            disabled={manageBusy}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-strong)] px-2.5 py-1.5 text-xs font-semibold text-[color:var(--foreground)] transition hover:bg-[color:var(--surface-hover)]"
                          >
                            <Pencil className="h-3 w-3" />
                            {t("roomManage.setRole")}
                            <ChevronDown className={`h-3 w-3 transition ${isRoleMenuOpenForThis ? "rotate-180" : ""}`} />
                          </button>
                          {isRoleMenuOpenForThis ? (
                            <div className="absolute left-0 top-full z-20 mt-1 w-40 rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-strong)] p-1 shadow-lg">
                              {(["facilitator", "participant", "observer"] as CollaborationRole[]).map((role) => (
                                <button
                                  key={role}
                                  type="button"
                                  onClick={() => void handleSetRole(participant.id, role)}
                                  disabled={manageBusy || participant.collaborationRole === role}
                                  className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold transition ${participant.collaborationRole === role ? "bg-[color:var(--brand-soft)] text-[color:var(--brand-ink)]" : "text-[color:var(--foreground)] hover:bg-[color:var(--surface-hover)]"}`}
                                >
                                  {role === "facilitator" ? <ShieldCheck className="h-3 w-3" /> : <Shield className="h-3 w-3" />}
                                  {t(`collaborationRoles.${role}`)}
                                </button>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      ) : null}

                      {canTransfer && participant ? (
                        <button
                          type="button"
                          onClick={() => setConfirmAction({ type: "transfer", participantId: participant.id, participantName: presence.participantName })}
                          disabled={manageBusy}
                          className="room-action-transfer inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition"
                        >
                          <Crown className="h-3 w-3" />
                          {t("roomManage.transferOwnership")}
                        </button>
                      ) : null}

                      {canKick && participant ? (
                        <button
                          type="button"
                          onClick={() => setConfirmAction({ type: "kick", participantId: participant.id, participantName: presence.participantName })}
                          disabled={manageBusy}
                          className="room-action-kick inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition"
                        >
                          <UserMinus className="h-3 w-3" />
                          {t("roomManage.kickUser")}
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              );
            })}
            {presenceRoster.length === 0 ? (
              <div className="rounded-xl border border-dashed border-[color:var(--border)] bg-[color:var(--surface-muted)] px-4 py-6 text-sm leading-6 text-[color:var(--muted)]">
                {t("project.collaborationPanel.noMembersVisible")}
              </div>
            ) : null}
            </div>
          </div>
          <div className="rounded-xl border border-dashed border-[color:var(--border)] bg-[color:var(--surface-muted)] px-4 py-3 text-sm leading-6 text-[color:var(--muted)]">
            {presenceStatusHydrated
              ? t("project.collaborationPanel.presenceAutoManaged", { status: autoPresenceStatus ? t(`presenceStates.${autoPresenceStatus}`) : t("presenceStates.offline") })
              : t("project.workspaceSettings.presenceAutoManaged")}
          </div>
        </Panel>

        {showRoomManagePanel ? (
          <Panel className="space-y-5 p-6">
            <div>
              <div className="flex items-center gap-2">
                <Settings2 className="h-4 w-4 text-[color:var(--brand-solid)]" />
                <h3 className="font-display text-xl font-semibold">{t("roomManage.title")}</h3>
              </div>
            </div>

            {roomManageStateMessage ? (
              <div className="rounded-xl border border-dashed border-[color:var(--border)] bg-[color:var(--surface-muted)] px-4 py-3 text-sm leading-6 text-[color:var(--muted)]">
                {roomManageStateMessage}
              </div>
            ) : null}

            <div className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[color:var(--muted)]">{t("roomManage.joinModeTitle")}</p>
              <div className="grid grid-cols-2 gap-1 rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-1">
                {(["open", "approval"] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => void handleSetJoinMode(mode)}
                    disabled={manageBusy || !access.canManageRoom || isRoomArchived}
                    className={`rounded-lg px-3 py-2 text-sm font-semibold transition ${(project.room.joinMode ?? "open") === mode ? "bg-[color:var(--brand-solid)] text-white shadow-sm" : "text-[color:var(--muted)] hover:bg-[color:var(--surface-hover)]"} disabled:cursor-not-allowed disabled:opacity-60`}
                  >
                    {t(`roomJoinMode.${mode}`)}
                  </button>
                ))}
              </div>
              <p className="text-xs leading-5 text-[color:var(--muted)]">
                {(project.room.joinMode ?? "open") === "open" ? t("roomManage.joinModeOpenHint") : t("roomManage.joinModeApprovalHint")}
              </p>
            </div>

            <div className="space-y-3 border-t border-[color:var(--border)] pt-4">
              <button
                type="button"
                onClick={() => setConfirmAction({ type: "destroy" })}
                disabled={manageBusy || !access.canDestroyRoom || isRoomArchived}
                className="room-action-kick flex w-full items-center justify-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Archive className="h-4 w-4" />
                {t("roomManage.destroyRoom")}
              </button>
            </div>
          </Panel>
        ) : null}

        {presenceManagerOpen && typeof document !== "undefined" ? createPortal((
          <div
            className="fixed inset-0 z-[80] flex items-end justify-center bg-black/40 px-3 py-3 backdrop-blur-sm sm:items-center sm:px-4 sm:py-6"
            onClick={() => {
              setPresenceManagerOpen(false);
              setRoleMenuOpen(null);
            }}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="presence-manager-title"
              className="flex max-h-[calc(100svh-1.5rem)] w-full max-w-3xl flex-col overflow-hidden rounded-t-2xl border border-[color:var(--border)] bg-[color:var(--surface-strong)] shadow-2xl sm:max-h-[min(90vh,44rem)] sm:rounded-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-4 border-b border-[color:var(--border)] px-6 py-5">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Users className="h-4 w-4 text-[color:var(--brand-solid)]" />
                    <h3 id="presence-manager-title" className="font-display text-xl font-semibold text-[color:var(--foreground)]">
                      {t("project.collaborationPanel.memberDirectoryTitle")}
                    </h3>
                  </div>
                  <p className="mt-1 text-sm leading-6 text-[color:var(--muted)]">{t("project.collaborationPanel.memberDirectoryBody")}</p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setPresenceManagerOpen(false);
                    setRoleMenuOpen(null);
                  }}
                  className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-2 text-[color:var(--muted)] transition hover:bg-[color:var(--surface-hover)] hover:text-[color:var(--foreground)]"
                  aria-label={t("common.close")}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="soft-scrollbar min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-5">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-4 py-3">
                    <p className="text-xs font-semibold text-[color:var(--muted)]">{t("project.collaborationPanel.memberCount", { count: String(presenceRoster.length) })}</p>
                    <p className="mt-1 text-2xl font-semibold text-[color:var(--foreground)]">{presenceRoster.length}</p>
                  </div>
                  <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-4 py-3">
                    <p className="text-xs font-semibold text-[color:var(--muted)]">{t("project.collaborationPanel.activeMemberCount", { count: String(livePresence.length) })}</p>
                    <p className="mt-1 text-2xl font-semibold text-[color:var(--foreground)]">{livePresence.length}</p>
                  </div>
                </div>

                {memberManagementBlockMessage ? (
                  <div className="flex items-start gap-2 rounded-xl border border-dashed border-[color:var(--border)] bg-[color:var(--surface-muted)] px-4 py-3 text-sm leading-6 text-[color:var(--muted)]">
                    <Shield className="mt-0.5 h-4 w-4 shrink-0 text-[color:var(--brand-solid)]" />
                    <span>{memberManagementBlockMessage}</span>
                  </div>
                ) : null}

                <div className="space-y-3">
                  {presenceRoster.length > 0 ? presenceRoster.map((presence) => renderPresenceMemberCard(presence, { surface: "modal" })) : (
                    <div className="rounded-xl border border-dashed border-[color:var(--border)] bg-[color:var(--surface-muted)] px-4 py-6 text-sm leading-6 text-[color:var(--muted)]">
                      {t("project.collaborationPanel.noMembersVisible")}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        ), document.body) : null}

        {/* Confirmation Modal */}
        {confirmAction ? (
          <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 px-3 py-3 backdrop-blur-sm sm:items-center sm:px-4 sm:py-6" onClick={() => setConfirmAction(null)}>
            <div className="w-full max-w-md rounded-t-2xl border border-[color:var(--border)] bg-[color:var(--surface-strong)] p-5 shadow-2xl sm:rounded-2xl sm:p-6" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center gap-3">
                <div className="room-action-kick-icon inline-flex h-10 w-10 items-center justify-center rounded-2xl">
                  <AlertTriangle className="h-5 w-5" />
                </div>
                <h3 className="font-display text-lg font-semibold text-[color:var(--foreground)]">
                  {confirmAction.type === "kick" ? t("roomManage.kickUser") : confirmAction.type === "transfer" ? t("roomManage.transferOwnership") : t("roomManage.destroyRoom")}
                </h3>
              </div>
              <p className="mt-4 text-sm leading-6 text-[color:var(--muted)]">
                {confirmAction.type === "kick"
                  ? t("roomManage.kickConfirm")
                  : confirmAction.type === "transfer"
                    ? t("roomManage.transferConfirm")
                    : t("roomManage.destroyConfirm")}
              </p>
              {confirmAction.participantName ? (
                <p className="mt-2 text-sm font-semibold text-[color:var(--foreground)]">{confirmAction.participantName}</p>
              ) : null}
              <div className="mt-6 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setConfirmAction(null)}
                  className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-4 py-2 text-sm font-semibold text-[color:var(--foreground)] transition hover:bg-[color:var(--surface-hover)]"
                >
                  {t("common.cancel")}
                </button>
                <button
                  type="button"
                  disabled={manageBusy}
                  onClick={() => {
                    if (confirmAction.type === "kick" && confirmAction.participantId) void handleKickParticipant(confirmAction.participantId);
                    else if (confirmAction.type === "transfer" && confirmAction.participantId) void handleTransferOwnership(confirmAction.participantId);
                    else if (confirmAction.type === "destroy") void handleDestroyRoom();
                  }}
                  className="room-action-kick-solid rounded-xl px-4 py-2 text-sm font-semibold shadow-sm transition disabled:opacity-50"
                >
                  {manageBusy ? `${t("common.loading")}...` : t("common.confirm")}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        <Panel className="space-y-5 p-6">
            <div>
              <div className="flex items-center gap-2">
                <Bot className="h-4 w-4 text-[color:var(--brand-solid)]" />
                <h3 className="font-display text-xl font-semibold">{t("roomAi.automationTitle")}</h3>
              </div>
              <p className="mt-1 text-sm leading-6 text-[color:var(--muted)]">{singleUserMode ? t("project.collaborationPanel.singleUserAiBody") : t("roomAi.automationBody")}</p>
            </div>
            <div className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={singleUserMode ? "accent" : access.workspaceRole === "host" ? "accent" : access.workspaceRole === "admin" ? "success" : "default"}>
                  {singleUserMode ? t("project.collaborationPanel.singleUserTitle") : t(workspaceRoleKey)}
                </Badge>
                <span className="text-xs leading-6 text-[color:var(--muted)]">
                  {access.canManageAutomation ? t("roomAi.manageAutomationGranted") : t("roomAi.manageAutomationLocked")}
                </span>
              </div>
              <p className="mt-3 text-xs leading-6 text-[color:var(--muted)]">
                {roomAiMode === "basic"
                  ? t("roomAi.modeBasicHint")
                  : roomAiMode === "assistive"
                    ? t("roomAi.modeAssistiveHint")
                    : t("roomAi.modeOffHint")}
              </p>
            </div>
            <div className={`grid gap-1 rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-1 ${availableSummaryModeOptions.length === 2 ? "grid-cols-2" : "grid-cols-3"}`}>
              {availableSummaryModeOptions.map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => {
                    if (sampleMutationLocked) {
                      setMessage(sampleMutationMessage);
                      return;
                    }
                    setRoomAiMode(mode);
                    const nextThreshold = clampAutomationThreshold(
                      Number(roomAiThreshold),
                      mode,
                      recommendedAutomationThreshold(mode === "off" ? "basic" : mode),
                    );
                    setRoomAiThreshold(String(nextThreshold));
                    void updateRoomAiAutomation({
                      mode,
                      summaryThreshold: nextThreshold,
                      summaryCurrentThreshold: nextThreshold,
                    });
                  }}
                  disabled={!canManageAutomation || roomAiBusy}
                  className={`rounded-lg px-3 py-2 text-sm font-semibold transition ${roomAiMode === mode ? "bg-[color:var(--brand-solid)] text-white shadow-sm" : "text-[color:var(--muted)] hover:bg-[color:var(--surface-hover)]"}`}
                >
                  {t(`roomAi.mode${mode.charAt(0).toUpperCase()}${mode.slice(1)}`)}
                </button>
              ))}
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="space-y-3 rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-4">
                <label className="text-xs font-semibold uppercase tracking-[0.14em] text-[color:var(--muted)]">{t("roomAi.summaryThresholdLabel")}</label>
                <select
                  className={fieldClass}
                  value={roomAiThreshold}
                  onChange={(event) => {
                    if (sampleMutationLocked) {
                      setMessage(sampleMutationMessage);
                      return;
                    }
                    const nextValue = String(clampAutomationThreshold(
                      Number(event.target.value),
                      roomAiMode,
                      recommendedAutomationThreshold(roomAiMode === "off" ? "basic" : roomAiMode),
                    ));
                    setRoomAiThreshold(nextValue);
                    void updateRoomAiAutomation({
                      summaryThreshold: Number(nextValue),
                      summaryCurrentThreshold: Number(nextValue),
                    });
                  }}
                  disabled={!canManageAutomation || roomAiBusy || roomAiMode === "off"}
                >
                  {summaryThresholdOptions.map((value) => (
                    <option key={value} value={value}>{value}</option>
                  ))}
                </select>
                <p className="text-xs leading-5 text-[color:var(--muted)]">
                  {roomAiMode === "assistive" ? t("roomAi.assistiveThresholdHint") : t("roomAi.summaryThresholdHint")}
                </p>
                {roomAiMode === "assistive" ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone="accent">{`${t("roomAi.currentSummaryThreshold")}: ${normalizedAutomation.summaryCurrentThreshold}`}</Badge>
                    <span className="text-xs leading-5 text-[color:var(--muted)]">{t("roomAi.assistiveThresholdCurrentHint")}</span>
                  </div>
                ) : null}
                <Button
                  className="w-full gap-2"
                  onClick={requestRoomAiSummary}
                  disabled={roomAiBusy || !access.canRunAiTasks}
                >
                  <Sparkles className="h-4 w-4" />
                  {roomAiBusy ? t("roomAi.requesting") : t("roomAi.requestSummary")}
                </Button>
              </div>
              {singleUserMode ? (
                <div className="space-y-3 rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[color:var(--muted)]">{t("project.collaborationPanel.singleUserTitle")}</p>
                  <p className="text-sm leading-6 text-[color:var(--muted)]">{t("project.collaborationPanel.singleUserWorkspaceBody")}</p>
                  <div className="flex flex-wrap gap-2">
                    <Badge tone={roomAiMode === "off" ? "default" : "accent"}>
                      {t(`roomAi.mode${roomAiMode.charAt(0).toUpperCase()}${roomAiMode.slice(1)}`)}
                    </Badge>
                    {roomAiMode !== "off" ? (
                      <Badge>{`${t("roomAi.summaryThresholdLabel")}: ${roomAiThreshold}`}</Badge>
                    ) : null}
                  </div>
                </div>
              ) : (
                <div className="space-y-3 rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[color:var(--muted)]">{t("roomAi.permissionsTitle")}</p>
                  <div className="space-y-3 text-sm text-[color:var(--foreground)]">
                    <label className="flex items-center justify-between gap-3 rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-strong)] px-3 py-2.5">
                      <span>{t("roomAi.facilitatorManageLabel")}</span>
                      <input
                        type="checkbox"
                        checked={roomAiAdminCanManage}
                        onChange={(event) => {
                          if (sampleMutationLocked) {
                            setMessage(sampleMutationMessage);
                            return;
                          }
                          setRoomAiAdminCanManage(event.target.checked);
                          void updateRoomAiAutomation({
                            permissions: {
                              facilitatorCanManage: event.target.checked,
                              facilitatorCanTrigger: roomAiAdminCanTrigger,
                            },
                          });
                        }}
                        disabled={!canEditAutomationPermissions || roomAiBusy}
                      />
                    </label>
                    <label className="flex items-center justify-between gap-3 rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-strong)] px-3 py-2.5">
                      <span>{t("roomAi.facilitatorTriggerLabel")}</span>
                      <input
                        type="checkbox"
                        checked={roomAiAdminCanTrigger}
                        onChange={(event) => {
                          if (sampleMutationLocked) {
                            setMessage(sampleMutationMessage);
                            return;
                          }
                          setRoomAiAdminCanTrigger(event.target.checked);
                          void updateRoomAiAutomation({
                            permissions: {
                              facilitatorCanManage: roomAiAdminCanManage,
                              facilitatorCanTrigger: event.target.checked,
                            },
                          });
                        }}
                        disabled={!canEditAutomationPermissions || roomAiBusy}
                      />
                    </label>
                  </div>
                  {!canEditAutomationPermissions ? (
                    <p className="text-xs leading-5 text-[color:var(--muted)]">{t("roomAi.permissionsOwnerOnly")}</p>
                  ) : null}
                </div>
              )}
            </div>
            <div className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-4">
              <p className="font-semibold">{t("roomAi.summaryAutomationTitle")}</p>
              <p className="mt-1 text-xs leading-5 text-[color:var(--muted)]">{t("roomAi.summaryAutomationBody")}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Badge tone={roomAiMode === "off" ? "default" : "accent"}>
                  {t(`roomAi.mode${roomAiMode.charAt(0).toUpperCase()}${roomAiMode.slice(1)}`)}
                </Badge>
                {roomAiMode !== "off" ? (
                  <Badge>{`${t("project.collaborationPanel.runSummary")} ${roomAiThreshold}`}</Badge>
                ) : null}
              </div>
            </div>
          </Panel>

        <Panel className="space-y-5 p-6">
          <div>
            <div className="flex items-center gap-2">
              <UserPlus className="h-4 w-4 text-[color:var(--brand-solid)]" />
              <h3 className="font-display text-xl font-semibold">{t("project.collaborationPanel.invites")}</h3>
            </div>
            <p className="mt-1 text-sm leading-6 text-[color:var(--muted)]">{t("project.collaborationPanel.invitesBody")}</p>
          </div>
          <div className="space-y-3 rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-4">
            <div className="grid gap-3 sm:grid-cols-[0.52fr_0.48fr]">
              <select className={fieldClass} value={inviteRole} onChange={(event) => setInviteRole(event.target.value as Participant["collaborationRole"])} disabled={!inviteCreationAllowed}>
                {inviteRoleOptions.map((role) => (
                  <option key={role} value={role}>{t(`collaborationRoles.${role}`)}</option>
                ))}
              </select>
              <input className={fieldClass} value={inviteHours} onChange={(event) => setInviteHours(event.target.value)} placeholder={t("project.collaborationPanel.expiresInHours")} disabled={!inviteCreationAllowed} />
            </div>
            <textarea className={`${fieldClass} min-h-24`} value={inviteNote} onChange={(event) => setInviteNote(event.target.value)} placeholder={t("project.collaborationPanel.inviteNote")} disabled={!inviteCreationAllowed} />
            <Button variant="ghost" className="w-full gap-2" onClick={submitInvite} disabled={busy || !inviteCreationAllowed}>
              <UserPlus className="h-4 w-4" />
              {t("project.collaborationPanel.createInvite")}
            </Button>
            {!inviteCreationAllowed ? (
              <div className="rounded-2xl border border-dashed border-[color:var(--border)] p-4 text-sm text-[color:var(--muted)]">
                {inviteRestrictionMessage ?? t("project.collaborationPanel.invitesDisabled")}
              </div>
            ) : null}
          </div>
          <div className="space-y-3">
            {(state?.invites ?? []).length === 0 ? (
              <div className="rounded-2xl border border-dashed border-[color:var(--border)] p-4 text-sm text-[color:var(--muted)]">{t("project.collaborationPanel.noInvites")}</div>
            ) : (
              state?.invites.slice(0, 6).map((invite) => (
                <div key={invite.id} className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-4 ">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={invite.status === "active" ? "success" : invite.status === "accepted" ? "accent" : "default"}>{inviteStatusLabel(invite.status, t)}</Badge>
                    <Badge>{t(`collaborationRoles.${invite.role}`)}</Badge>
                  </div>
                  <p className="mt-3 break-all text-sm font-semibold">{invite.token}</p>
                  <p className="mt-2 text-xs leading-5 text-[color:var(--muted)]">{invite.note || invite.inviteUrl}</p>
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-[color:var(--muted)]">
                    <span>{formatDateTime(invite.createdAt, locale)}</span>
                    {invite.expiresAt ? <span>{`• ${formatDateTime(invite.expiresAt, locale)}`}</span> : null}
                  </div>
                </div>
              ))
            )}
          </div>
          <div className="rounded-[1.4rem] border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-4 ">
            <div className="flex items-center gap-2">
              <Link prefetch={false} href={`/${locale}/projects/${project.id}`} className="font-semibold text-[color:var(--foreground)]">
                {t("project.collaborationPanel.acceptInviteTitle")}
              </Link>
            </div>
            <p className="mt-1 text-sm leading-6 text-[color:var(--muted)]">{t("project.collaborationPanel.acceptInviteBody")}</p>
            <div className="mt-4 space-y-3">
              <input className={fieldClass} value={acceptToken} onChange={(event) => setAcceptToken(event.target.value)} placeholder={t("project.collaborationPanel.inviteToken")} />
              <input className={fieldClass} value={acceptName} onChange={(event) => setAcceptName(event.target.value)} placeholder={t("project.collaborationPanel.joinAsName")} />
              <Button variant="ghost" className="w-full gap-2" onClick={acceptInvite} disabled={busy || !acceptToken.trim() || !acceptName.trim()}>
                <CircleArrowOutUpRight className="h-4 w-4" />
                {t("project.collaborationPanel.acceptInvite")}
              </Button>
            </div>
          </div>
        </Panel>

        <Panel className="space-y-5 p-6">
          <div>
            <div className="flex items-center gap-2">
              <Paperclip className="h-4 w-4 text-[color:var(--brand-solid)]" />
              <h3 className="font-display text-xl font-semibold">{t("project.collaborationPanel.attachments")}</h3>
            </div>
            <p className="mt-1 text-sm leading-6 text-[color:var(--muted)]">{t("project.collaborationPanel.attachmentsBody")}</p>
          </div>
          <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-4 py-3 text-sm leading-6 text-[color:var(--muted)]">
            {t("project.collaborationPanel.attachmentsComposeHint")}
          </div>
          <div className="space-y-3">
            {(state?.attachments ?? []).length === 0 ? (
              <div className="rounded-2xl border border-dashed border-[color:var(--border)] p-4 text-sm text-[color:var(--muted)]">{t("project.collaborationPanel.noAttachments")}</div>
            ) : (
              state?.attachments.slice(0, 8).map((attachment) => {
                const Icon = attachmentIcon(attachment.kind);
                const uploader = participants.find((participant) => participant.id === attachment.uploadedByParticipantId);
                return (
                  <article key={attachment.id} className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-4 ">
                    <div className="flex items-start gap-3">
                      <div className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-[color:var(--brand-soft)] text-[color:var(--brand-ink)]">
                        <Icon className="h-4 w-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-semibold">{attachment.name}</p>
                          <Badge>{attachmentKindLabel(attachment.kind, t)}</Badge>
                          <Badge>{attachment.storage === "external" ? t("common.external") : t("common.local")}</Badge>
                        </div>
                        <p className="mt-2 text-sm leading-6 text-[color:var(--muted)]">{attachment.note || attachment.previewText || t("common.none")}</p>
                        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-[color:var(--muted)]">
                          <span>{formatDateTime(attachment.uploadedAt, locale)}</span>
                          {uploader ? <span>{`• ${uploader.name}`}</span> : null}
                        </div>
                        <a href={buildAttachmentHref(project.id, attachment)} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-2 text-sm font-semibold text-[color:var(--brand-solid)]">
                          <CircleArrowOutUpRight className="h-4 w-4" />
                          {t("common.open")}
                        </a>
                      </div>
                    </div>
                  </article>
                );
              })
            )}
          </div>
        </Panel>
      </div>
      </div>
  );
}
















