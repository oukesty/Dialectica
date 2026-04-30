"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { startTransition, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import {
  Archive,
  ArrowUpRight,
  BrainCircuit,
  Copy,
  FileImage,
  FileText,
  MessageSquarePlus,
  Network,
  Paperclip,
  RotateCcw,
  Send,
  Smile,
  Sparkles,
  Trash2,
  TriangleAlert,
  Users,
  Video,
} from "lucide-react";
import { EmojiPicker } from "@/components/assistant/emoji-picker";
import { useI18n } from "@/components/providers/i18n-provider";
import { Badge, Button, Panel } from "@/components/ui/primitives";
import { MarkdownContent } from "@/components/ui/markdown-renderer";
import { formatDateTime } from "@/lib/format";
import { getBrowserLocalIdentityId } from "@/lib/local-identity";
import { getImplementedConversationInputCapabilities, getProviderDescriptor } from "@/lib/providers/provider-catalog";
import { patchSettings, primeSettingsSnapshot } from "@/lib/settings-client";
import { consumeStream, StreamChunk } from "@/lib/streaming";
import { AiTask, AppLocale, AppSettings, DashboardProjectSummary, DiscussionProject, ProviderId, ProviderModelInputCapabilities } from "@/lib/types";
import { CollaborationState, RoomAttachment } from "@/lib/collaboration/types";


type SessionAction = "archive" | "restore" | "delete";
type HistoryView = "active" | "archived";
type PendingAssistantReply = {
  userMessage: string;
  attachmentIds: string[];
  providerId: ProviderId;
  model: string;
  submittedAt: string;
  regenerate?: boolean;
  replaceAssistantEventId?: string;
};

type InterruptedAssistantReply = PendingAssistantReply & {
  partialContent: string;
  partialReasoning: string;
};

type AssistantRegenerateTarget = {
  userMessage: string;
  attachmentIds: string[];
  replaceAssistantEventId?: string;
};

function getAssistantRevisionView(event: CollaborationState["events"][number]) {
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
    <span className={`inline-flex h-10 w-10 items-center justify-center rounded-2xl text-[11px] font-semibold tracking-[0.18em] shadow-sm ring-1 ring-white/10 ${style.className} ${className}`.trim()}>
      {style.label}
    </span>
  );
}

function ProviderReplyAvatar({ providerId, className = "" }: { providerId: ProviderId; className?: string }) {
  const src = providerReplyAvatarSources[providerId];
  if (!src) {
    return <ProviderAvatarBadge providerId={providerId} className={className} />;
  }

  return (
    <span className={`relative inline-flex h-10 w-10 shrink-0 overflow-hidden rounded-2xl bg-white ${className}`.trim()}>
      <Image src={src} alt="" fill sizes="40px" className="object-contain" />
    </span>
  );
}

function advanceVisibleStreamText(current: string, target: string, maxStep: number) {
  if (current.length >= target.length) return target;
  return target.slice(0, Math.min(target.length, current.length + Math.max(1, maxStep)));
}

const AUTO_SCROLL_THRESHOLD_PX = 96;
const INITIAL_VISIBLE_MESSAGE_COUNT = 40;
const MESSAGE_HISTORY_PAGE_SIZE = 20;
const HISTORY_LOAD_TRIGGER_PX = 48;

type AttachmentIntent = "image" | "document" | "video" | "audio" | "file";

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

function inferAttachmentIntent(file: File): AttachmentIntent {
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("video/")) return "video";
  if (file.type.startsWith("audio/")) return "audio";
  if (file.type.includes("pdf") || file.type.includes("word") || file.type.includes("text") || /\.(md|markdown|doc|docx|pdf|txt|json|csv|yaml|yml)$/i.test(file.name)) {
    return "document";
  }
  return "file";
}

function attachmentIcon(kind: RoomAttachment["kind"]) {
  if (kind === "image") return FileImage;
  if (kind === "video") return Video;
  return FileText;
}

function buildAttachmentHref(projectId: string, attachment: Pick<RoomAttachment, "id" | "publicUrl">) {
  return attachment.publicUrl || `/api/projects/${projectId}/attachments/${attachment.id}`;
}

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
  attachment: Pick<RoomAttachment, "kind" | "previewText">,
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

function toSessionSummary(project: DiscussionProject): DashboardProjectSummary {
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

function getSessionRank(session: DashboardProjectSummary) {
  if (session.pendingDeletionAt) return 2;
  if (session.archivedAt) return 1;
  return 0;
}

function sortSessionList(sessions: DashboardProjectSummary[]) {
  return [...sessions].sort((left, right) => {
    const rankDelta = getSessionRank(left) - getSessionRank(right);
    if (rankDelta !== 0) return rankDelta;
    return Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
  });
}


export function AssistantWorkspace({
  locale,
  settings,
  sessions,
  initialProject,
  initialCollaboration,
}: {
  locale: AppLocale;
  settings: AppSettings;
  sessions: DashboardProjectSummary[];
  initialProject: DiscussionProject | null;
  initialCollaboration: CollaborationState | null;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const feedRef = useRef<HTMLDivElement | null>(null);
  const shouldAutoScrollRef = useRef(true);
  const imageFileRef = useRef<HTMLInputElement | null>(null);
  const documentFileRef = useRef<HTMLInputElement | null>(null);
  const creatingSessionRef = useRef(false);
  const [project, setProject] = useState(initialProject);
  const [collaboration, setCollaboration] = useState(initialCollaboration);
  const [draft, setDraft] = useState("");
  const [pendingAttachmentIds, setPendingAttachmentIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [messageTone, setMessageTone] = useState<"default" | "success" | "danger">("default");
  const [sessionList, setSessionList] = useState(sessions);
  const [sessionBusyId, setSessionBusyId] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [historyView, setHistoryView] = useState<HistoryView>(() => initialProject?.metadata.archivedAt
    ? "archived"
    : "active");
  const [pendingReply, setPendingReply] = useState<PendingAssistantReply | null>(null);
  const [interruptedReply, setInterruptedReply] = useState<InterruptedAssistantReply | null>(null);
  const [visibleEventCount, setVisibleEventCount] = useState(INITIAL_VISIBLE_MESSAGE_COUNT);
  const [loadingOlderMessages, setLoadingOlderMessages] = useState(false);
  const streamContentRef = useRef("");
  const streamReasoningRef = useRef("");
  const streamVisibleContentRef = useRef("");
  const streamVisibleReasoningRef = useRef("");
  const streamFinalizeRef = useRef<(() => void) | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamContent, setStreamContent] = useState("");
  const [streamReasoning, setStreamReasoning] = useState("");
  const streamAbortRef = useRef<(() => void) | null>(null);
  const streamRafId = useRef(0);
  const streamActiveRef = useRef(false);
  const restoreHistoryScrollRef = useRef<{ previousScrollHeight: number } | null>(null);
  const loadingOlderMessagesRef = useRef(false);
  const [pendingImageFiles, setPendingImageFiles] = useState<File[]>([]);
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  const [sessionSearch, setSessionSearch] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const dragCounter = useRef(0);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [currentLocalIdentityId, setCurrentLocalIdentityId] = useState(settings.profile.localIdentityId);
  const [resolvedSettings, setResolvedSettings] = useState(settings);

  // Session state isolation: when server props change (session switch via Link navigation),
  // reset ALL session-scoped state to prevent cross-session pollution.
  // Skip if we're in the middle of creating a new session (startNewChat handles its own reset).
  useEffect(() => {
    if (creatingSessionRef.current) return;
    setProject(initialProject);
    setCollaboration(initialCollaboration);
    setDraft("");
    setPendingAttachmentIds([]);
    setMessage(null);
    setMessageTone("default");
    setPendingDeleteId(null);
    setPendingReply(null);
    setPendingImageFiles([]);
    setHistoryView(initialProject?.metadata.archivedAt ? "archived" : "active");
  }, [initialCollaboration, initialProject]);

  useEffect(() => {
    setSessionList(sessions);
  }, [sessions]);

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

  useEffect(() => {
    primeSettingsSnapshot(effectiveSettings);
  }, [effectiveSettings]);

  const isSingleUserMode = Boolean(project && project.scenario === "ai-dialogue" && project.participants.length === 1);
  const identitySettingsReady = currentLocalIdentityId === effectiveSettings.profile.localIdentityId;
  const localParticipant = project?.participants.find((participant) => participant.profileOwnerId === effectiveSettings.profile.localIdentityId) ?? project?.participants[0];
  const currentIdentityControlsWorkspace = Boolean(
    project
    && identitySettingsReady
    && (
      project.room.aiConfig.ownerIdentityId === effectiveSettings.profile.localIdentityId
      || localParticipant?.profileOwnerId === effectiveSettings.profile.localIdentityId
    )
  );
  const effectiveProviderId = project
    ? (currentIdentityControlsWorkspace ? effectiveSettings.provider.activeProviderId : project.room.aiConfig.providerId)
    : effectiveSettings.provider.activeProviderId;
  const baseModel = project
    ? (currentIdentityControlsWorkspace ? effectiveSettings.provider.providers[effectiveProviderId].model : project.room.aiConfig.model)
    : effectiveSettings.provider.providers[effectiveSettings.provider.activeProviderId].model;
  const [modelOverride, setModelOverride] = useState<string | null>(null);
  const effectiveModel = modelOverride ?? baseModel;
  const effectiveModelDisplay = effectiveProviderId === "disabled" ? t("settings.disabledAdapterNoModel") : effectiveModel;
  const effectiveProviderDescriptor = useMemo(() => getProviderDescriptor(effectiveProviderId), [effectiveProviderId]);
  const effectiveProviderRuntime = effectiveSettings.provider.providers[effectiveProviderId];
  const conversationCapabilities = useMemo(
    () => getImplementedConversationInputCapabilities(effectiveProviderId, effectiveModel),
    [effectiveModel, effectiveProviderId],
  );
  const canUseStreaming = Boolean(
    project
    && effectiveSettings.provider.enableStreaming
    && effectiveProviderDescriptor?.capabilities.streaming
    && effectiveProviderRuntime?.streaming !== false,
  );
  const canStageImages = effectiveSettings.uploadPreferences.allowImages && conversationCapabilities.image;
  const canStageDocuments = effectiveSettings.uploadPreferences.allowDocuments && conversationCapabilities.document;
  const feedEvents = useMemo(
    () => collaboration?.events.filter((event) => event.type === "message" || event.actorType === "ai") ?? [],
    [collaboration],
  );
  const hiddenFeedEventCount = Math.max(0, feedEvents.length - visibleEventCount);
  const visibleFeedEvents = useMemo(
    () => hiddenFeedEventCount > 0 ? feedEvents.slice(-visibleEventCount) : feedEvents,
    [feedEvents, hiddenFeedEventCount, visibleEventCount],
  );
  const latestRegenerateTarget = useMemo<AssistantRegenerateTarget | null>(() => {
    for (let index = feedEvents.length - 1; index >= 0; index -= 1) {
      const candidate = feedEvents[index];
      if (candidate.actorType !== "ai") continue;
      const priorUserEvent = [...feedEvents.slice(0, index)].reverse().find((event) => event.actorType !== "ai" && event.type === "message");
      if (!priorUserEvent) continue;
      return {
        userMessage: priorUserEvent.message,
        attachmentIds: priorUserEvent.attachmentIds,
        replaceAssistantEventId: candidate.id,
      };
    }
    return null;
  }, [feedEvents]);
  const attachments = collaboration?.attachments ?? [];
  const pendingAttachments = attachments.filter((attachment) => pendingAttachmentIds.includes(attachment.id));
  const pendingDirectAttachmentCount = pendingAttachments.filter((attachment) => attachmentCanDirectConversation(attachment, conversationCapabilities)).length;
  const providerHasSavedKey = Boolean(effectiveProviderRuntime?.hasStoredApiKey);
  const allActiveSessions = useMemo(() => sessionList.filter((session) => !session.archivedAt && !session.pendingDeletionAt), [sessionList]);
  const allArchivedSessions = useMemo(() => sessionList.filter((session) => Boolean(session.archivedAt) && !session.pendingDeletionAt), [sessionList]);
  const activeSessions = useMemo(() => {
    const q = sessionSearch.trim().toLowerCase();
    return q ? allActiveSessions.filter((s) => s.title.toLowerCase().includes(q) || s.description.toLowerCase().includes(q)) : allActiveSessions;
  }, [allActiveSessions, sessionSearch]);
  const archivedSessions = useMemo(() => {
    const q = sessionSearch.trim().toLowerCase();
    return q ? allArchivedSessions.filter((s) => s.title.toLowerCase().includes(q) || s.description.toLowerCase().includes(q)) : allArchivedSessions;
  }, [allArchivedSessions, sessionSearch]);
  const isArchivedSession = Boolean(project?.metadata.archivedAt);
  const isReadOnlySession = isArchivedSession || !isSingleUserMode;
  const canGenerateKnowledgeGraph = Boolean(project && !project.metadata.isSample);

  useEffect(() => {
    if (project?.metadata.archivedAt) {
      setHistoryView("archived");
      return;
    }
    if (project?.scenario === "ai-dialogue") {
      setHistoryView("active");
    }
  }, [project?.id, project?.metadata.archivedAt, project?.scenario]);

  useEffect(() => {
    if (historyView === "archived" && archivedSessions.length === 0) {
      setHistoryView("active");
    }
  }, [activeSessions.length, archivedSessions.length, historyView]);

  useEffect(() => {
    setInterruptedReply(null);
    shouldAutoScrollRef.current = true;
    setVisibleEventCount(INITIAL_VISIBLE_MESSAGE_COUNT);
    setLoadingOlderMessages(false);
    loadingOlderMessagesRef.current = false;
    restoreHistoryScrollRef.current = null;
  }, [project?.id]);

  useEffect(() => {
    if (!feedRef.current) return;
    if (!shouldAutoScrollRef.current) return;
    feedRef.current.scrollTop = feedRef.current.scrollHeight;
  }, [visibleFeedEvents.length, pendingReply?.submittedAt, streamContent.length, streamReasoning.length]);

  useLayoutEffect(() => {
    if (!loadingOlderMessages) return;
    const feed = feedRef.current;
    const restoreState = restoreHistoryScrollRef.current;
    if (feed && restoreState) {
      const delta = feed.scrollHeight - restoreState.previousScrollHeight;
      feed.scrollTop += delta;
    }
    restoreHistoryScrollRef.current = null;
    loadingOlderMessagesRef.current = false;
    setLoadingOlderMessages(false);
  }, [loadingOlderMessages, visibleFeedEvents.length]);

  const loadOlderMessages = () => {
    if (loadingOlderMessagesRef.current) return;
    if (hiddenFeedEventCount <= 0) return;
    const feed = feedRef.current;
    restoreHistoryScrollRef.current = feed ? { previousScrollHeight: feed.scrollHeight } : null;
    loadingOlderMessagesRef.current = true;
    setLoadingOlderMessages(true);
    setVisibleEventCount((current) => Math.min(feedEvents.length, current + MESSAGE_HISTORY_PAGE_SIZE));
  };

  const updateAutoScrollPreference = () => {
    const feed = feedRef.current;
    if (!feed) return;
    const distanceFromBottom = feed.scrollHeight - feed.scrollTop - feed.clientHeight;
    shouldAutoScrollRef.current = distanceFromBottom <= AUTO_SCROLL_THRESHOLD_PX;
    if (feed.scrollTop <= HISTORY_LOAD_TRIGGER_PX && hiddenFeedEventCount > 0 && !loadingOlderMessagesRef.current) {
      loadOlderMessages();
    }
  };

  const setStatus = (nextMessage: string | null, tone: "default" | "success" | "danger" = "default") => {
    setMessage(nextMessage);
    setMessageTone(tone);
  };

  const hasStreamingPreview = streamContent.length > 0 || streamReasoning.length > 0;

  const resetStreamingPreview = () => {
    streamContentRef.current = "";
    streamReasoningRef.current = "";
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
      setStatus(t("common.copied"), "success");
    } catch {
      setStatus(t("common.copyFailed"), "danger");
    }
  };

  const readErrorMessage = async (response: Response) => {
    const payload = await response.json().catch(() => null) as { error?: string } | null;
    return payload?.error ?? t("errors.unexpected");
  };

  const startNewChat = async () => {
    if (busy) return;
    setBusy(true);
    setStatus(null);
    creatingSessionRef.current = true;
    try {
      const response = await fetch("/api/assistant/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          locale,
          identityId: getBrowserLocalIdentityId(currentLocalIdentityId),
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        project?: DiscussionProject;
        collaboration?: CollaborationState;
      };
      if (!response.ok || !payload.project) {
        throw new Error(typeof payload.error === "string" ? payload.error : t("errors.unexpected"));
      }
      // Reset all session-scoped state before switching
      setDraft("");
      setPendingAttachmentIds([]);
      setPendingReply(null);
      setPendingDeleteId(null);
      setPendingImageFiles([]);
      setMessage(null);
      setMessageTone("default");
      // Apply the new session
      setProject(payload.project);
      setCollaboration(payload.collaboration ?? null);
      setSessionList((current) => sortSessionList([toSessionSummary(payload.project!), ...current]));
      setHistoryView("active");
      // Update URL without full page reload
      window.history.pushState(null, "", `/${locale}/assistant?chat=${payload.project.id}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : t("errors.unexpected"), "danger");
    } finally {
      creatingSessionRef.current = false;
      setBusy(false);
    }
  };

  const syncSessionSummaryFromProject = (nextProject: DiscussionProject) => {
    setSessionList((current) => sortSessionList([toSessionSummary(nextProject), ...current.filter((session) => session.id !== nextProject.id)]));
  };

  const syncFromPayload = (payload: { project?: DiscussionProject; collaboration?: CollaborationState }) => {
    if (payload.project) {
      setProject(payload.project);
      syncSessionSummaryFromProject(payload.project);
    }
    if (payload.collaboration) {
      setCollaboration(payload.collaboration);
    }
  };

  const runAssistantAutomationTasks = async (projectId: string, tasks: AiTask[]) => {
    if (tasks.length === 0) return;
    for (const task of tasks) {
      const response = await fetch(`/api/projects/${projectId}/ai`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task, locale, triggerSource: "automation" }),
      });
      const payload = await response.json().catch(() => ({})) as {
        error?: string;
        project?: DiscussionProject;
        collaboration?: CollaborationState;
      };
      if (!response.ok) {
        throw new Error(typeof payload?.error === "string" ? payload.error : t("errors.unexpected"));
      }
      syncFromPayload(payload);
    }
  };

  const activateAssistantRevision = async (eventId: string, revisionId: string) => {
    if (!project) return;
    setStatus(null);
    try {
      const response = await fetch(`/api/projects/${project.id}/events?locale=${locale}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "activateRevision", eventId, revisionId }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string; collaboration?: CollaborationState };
      if (!response.ok) {
        throw new Error(payload.error || t("errors.unexpected"));
      }
      syncFromPayload(payload);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : t("errors.unexpected"), "danger");
    }
  };

  const manageSession = async (sessionId: string, action: SessionAction) => {
    setSessionBusyId(sessionId);
    setStatus(null);
    try {
      const response = await fetch(`/api/projects/${sessionId}/assistant/session`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, locale }),
      });
      const payload = await response.json().catch(() => ({})) as { error?: string; project?: DiscussionProject; purged?: boolean; projectId?: string };
      if (!response.ok) {
        throw new Error(typeof payload?.error === "string" ? payload.error : t("errors.unexpected"));
      }

      if (action === "delete") {
        const deletedId = payload.projectId ?? sessionId;
        const nextSessions = sessionList.filter((session) => session.id !== deletedId);
        setSessionList(nextSessions);
        setHistoryView("active");
        setStatus(t("assistant.sessionDeleted"), "success");
        if (project?.id === deletedId) {
          const nextActiveSession = nextSessions.find((session) => !session.archivedAt);
          setProject(null);
          setCollaboration(null);
          if (nextActiveSession) {
            router.push(`/${locale}/assistant?chat=${nextActiveSession.id}`, { scroll: false });
          } else {
            window.history.replaceState(null, "", `/${locale}/assistant`);
          }
        }
      } else {
        let nextSessions = sessionList;
        if (payload.project) {
          nextSessions = sortSessionList([
            toSessionSummary(payload.project),
            ...sessionList.filter((session) => session.id !== payload.project?.id),
          ]);
          setSessionList(nextSessions);
        }

        if (action === "archive") {
          setHistoryView("archived");
          setStatus(t("assistant.sessionArchived"), "success");
          if (payload.project && project?.id === sessionId) {
            setProject(payload.project);
          }
        } else if (action === "restore") {
          setHistoryView("active");
          setStatus(t("assistant.sessionRestored"), "success");
          if (payload.project && project?.id === sessionId) {
            setProject(payload.project);
          }
        }
      }

      setPendingDeleteId(null);
      if (action !== "delete") {
        router.refresh();
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : t("errors.unexpected"), "danger");
    } finally {
      setSessionBusyId(null);
    }
  };

  const uploadFiles = async (files: FileList | File[], source: "image" | "document") => {
    if (!project || !localParticipant) return;
    if (isReadOnlySession) {
      setStatus(t("assistant.readonlyUploadBlocked"), "danger");
      return;
    }

    const queue = Array.from(files ?? []);
    if (queue.length === 0) return;

    setBusy(true);
    setStatus(null);
    try {
      let nextState = collaboration;
      const addedIds: string[] = [];
      for (const file of queue) {
        const intent = inferAttachmentIntent(file);
        if (source === "image") {
          if (intent !== "image" || !canStageImages) {
            throw new Error(t("assistant.uploadImageUnsupported"));
          }
        } else if ((intent === "image" || intent === "video" || intent === "audio") || !canStageDocuments) {
          throw new Error(t("assistant.uploadFileUnsupported"));
        }

        const form = new FormData();
        form.set("file", file);
        form.set("participantId", localParticipant.id);
        form.set("note", source === "image" ? t("assistant.imageAttachmentNote") : t("assistant.documentAttachmentNote"));

        const response = await fetch(`/api/projects/${project.id}/attachments?locale=${locale}`, {
          method: "POST",
          body: form,
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(typeof payload?.error === "string" ? payload.error : t("errors.unexpected"));
        }
        if (payload.state) {
          nextState = payload.state;
        }
        if (payload.attachment?.id) {
          addedIds.push(payload.attachment.id);
        }
      }

      if (nextState) {
        setCollaboration(nextState);
      }
      if (addedIds.length > 0) {
        setPendingAttachmentIds((current) => [...new Set([...current, ...addedIds])]);
      }
      if (source === "image") {
        setStatus(conversationCapabilities.image ? t("assistant.uploadReady") : t("assistant.imageReferenceQueued"), conversationCapabilities.image ? "success" : "default");
      } else if (queue.every((file) => fileWillTravelDirectly(file, source, conversationCapabilities))) {
        setStatus(t("assistant.uploadReady"), "success");
      } else {
        setStatus(t("assistant.documentReferenceQueued"), "default");
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : t("errors.unexpected"), "danger");
    } finally {
      setBusy(false);
      if (source === "image") {
        if (imageFileRef.current) imageFileRef.current.value = "";
      } else if (documentFileRef.current) {
        documentFileRef.current.value = "";
      }
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
    setStatus(t("assistant.generationStopped"), "default");
  };

  const sendMessage = async (options?: {
    message?: string;
    attachmentIds?: string[];
    regenerate?: boolean;
    replaceAssistantEventId?: string;
  }) => {
    if (!project) return;
    if (isReadOnlySession) {
      setStatus(t("assistant.readonlySendBlocked"), "danger");
      return;
    }
    const nextMessage = (options?.message ?? draft).trim();
    const nextAttachmentIds = [...(options?.attachmentIds ?? pendingAttachmentIds)];
    const regenerate = Boolean(options?.regenerate);
    if (!nextMessage && nextAttachmentIds.length === 0) return;
    const submittedAt = new Date().toISOString();
    setBusy(true);
    setStatus(null);
    setInterruptedReply(null);
    setPendingReply({
      userMessage: nextMessage,
      attachmentIds: nextAttachmentIds,
      providerId: effectiveProviderId,
      model: effectiveModel,
      submittedAt,
      regenerate,
      replaceAssistantEventId: options?.replaceAssistantEventId,
    });
    if (!regenerate) {
      setDraft("");
      setPendingAttachmentIds([]);
    }

    const useStreaming = canUseStreaming;
    if (useStreaming && project) {
      setIsStreaming(true);
      resetStreamingPreview();
      streamActiveRef.current = true;
      const finalizeAfterDisplay = async (finalChunk?: StreamChunk) => {
        const feed = feedRef.current;
        const wasAtBottom = feed ? (feed.scrollHeight - feed.scrollTop - feed.clientHeight < 100) : true;
        let completionMessage = t("assistant.replyReady");
        let completionTone: "success" | "danger" = "success";
        try {
          if (finalChunk?.aiTriggeredTasks?.length) {
            await runAssistantAutomationTasks(project.id, finalChunk.aiTriggeredTasks as AiTask[]);
          }
        } catch (error) {
          completionMessage = error instanceof Error ? error.message : t("errors.unexpected");
          completionTone = "danger";
        }
        startTransition(() => {
          router.refresh();
          setTimeout(() => {
            setIsStreaming(false);
            setPendingReply(null);
            setInterruptedReply(null);
            resetStreamingPreview();
            setStatus(completionMessage, completionTone);
            if (wasAtBottom) {
              requestAnimationFrame(() => {
                if (feedRef.current) feedRef.current.scrollTop = feedRef.current.scrollHeight;
              });
            }
          }, 600);
        });
      };
      const updateDisplay = () => {
        const nextReasoning = advanceVisibleStreamText(streamVisibleReasoningRef.current, streamReasoningRef.current, 6);
        const nextContent = advanceVisibleStreamText(streamVisibleContentRef.current, streamContentRef.current, 4);
        if (nextReasoning !== streamVisibleReasoningRef.current) {
          streamVisibleReasoningRef.current = nextReasoning;
          setStreamReasoning(nextReasoning);
        }
        if (nextContent !== streamVisibleContentRef.current) {
          streamVisibleContentRef.current = nextContent;
          setStreamContent(nextContent);
        }
        const displayCaughtUp = nextReasoning.length === streamReasoningRef.current.length
          && nextContent.length === streamContentRef.current.length;
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
          surface: "assistant-workspace",
          locale,
          regenerate,
          replaceAssistantEventId: options?.replaceAssistantEventId,
        },
        effectiveProviderId,
        (chunk: StreamChunk) => {
          if (chunk.type === "reasoning") streamReasoningRef.current += chunk.text;
          else if (chunk.type === "content") streamContentRef.current += chunk.text;
          if (!streamRafId.current) {
            streamRafId.current = requestAnimationFrame(updateDisplay);
          }
        },
        (err: string) => {
          streamActiveRef.current = false;
          cancelAnimationFrame(streamRafId.current);
          streamRafId.current = 0;
          streamAbortRef.current = null;
          streamFinalizeRef.current = null;
          if (!regenerate) {
            setDraft(nextMessage);
            setPendingAttachmentIds(nextAttachmentIds);
          }
          setStatus(err, "danger");
          setIsStreaming(false);
          setPendingReply(null);
          setBusy(false);
          resetStreamingPreview();
        },
        (finalChunk?: StreamChunk) => {
          streamActiveRef.current = false;
          streamAbortRef.current = null;
          setBusy(false);
          streamFinalizeRef.current = () => {
            void finalizeAfterDisplay(finalChunk);
          };
          if (!streamRafId.current) {
            streamRafId.current = requestAnimationFrame(updateDisplay);
          }
        },
      );
      streamAbortRef.current = abort;
      return;
    }

    try {
      const response = await fetch(`/api/projects/${project.id}/assistant`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          locale,
          message: nextMessage,
          attachmentIds: nextAttachmentIds,
          identityId: getBrowserLocalIdentityId(currentLocalIdentityId),
          surface: "assistant-workspace",
          regenerate,
          replaceAssistantEventId: options?.replaceAssistantEventId,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        project?: DiscussionProject;
        collaboration?: CollaborationState;
        aiTriggeredTasks?: AiTask[];
      };
      syncFromPayload(payload);
      if (!response.ok) {
        if (!payload.collaboration && !regenerate) {
          setDraft(nextMessage);
          setPendingAttachmentIds(nextAttachmentIds);
        }
        throw new Error(payload.error || t("errors.unexpected"));
      }
      if (payload.aiTriggeredTasks?.length) {
        await runAssistantAutomationTasks(payload.project?.id ?? project.id, payload.aiTriggeredTasks);
      }
      setStatus(t("assistant.replyReady"), "success");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : t("errors.unexpected"), "danger");
    } finally {
      setPendingReply(null);
      setBusy(false);
    }
  };

  const handleComposerKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.shiftKey || (event.nativeEvent as KeyboardEvent).isComposing) return;
    if (event.key !== "Enter") return;
    event.preventDefault();
    if (busy || isReadOnlySession || (!draft.trim() && pendingAttachmentIds.length === 0)) return;
    void sendMessage();
  };

  const publishWorkspace = async () => {
    if (!project || project.room.visibility !== "private" || isReadOnlySession) return;
    setPublishing(true);
    setStatus(null);
    try {
      const response = await fetch(`/api/projects/${project.id}/room?locale=${locale}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...project.room,
          visibility: "invite",
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string; project?: DiscussionProject };
      if (!response.ok) {
        throw new Error(payload.error || t("errors.unexpected"));
      }
      if (payload.project) {
        setProject(payload.project);
      }
      setStatus(t("assistant.publishedWorkspace"), "success");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : t("errors.unexpected"), "danger");
    } finally {
      setPublishing(false);
    }
  };

  const toneClass = messageTone === "danger"
    ? "text-sm text-rose-600 dark:text-rose-300"
    : messageTone === "success"
      ? "text-sm text-emerald-600 dark:text-emerald-300"
      : "text-sm text-[color:var(--muted)]";

  return (
    <div className="animate-fade-up grid gap-6 xl:grid-cols-[18.5rem_minmax(0,1fr)] xl:items-stretch">
      <aside className="space-y-4 xl:flex xl:h-[calc(100vh-var(--shell-header-height,4rem))] xl:min-h-0 xl:flex-col">
        <Panel className="space-y-3 p-4 xl:shrink-0">
          <div className="flex items-center gap-2.5">
            <span className="theme-icon-tile inline-flex h-9 w-9 items-center justify-center rounded-xl">
              <BrainCircuit className="h-4 w-4" />
            </span>
            <div>
              <h1 className="text-base font-semibold">{t("assistant.title")}</h1>
              <p className="text-xs text-[color:var(--muted)]">{t("assistant.subtitle")}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={startNewChat}
            disabled={busy}
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-[color:var(--brand-solid)]/30 bg-[color:var(--brand-soft)] px-3.5 py-2.5 text-sm font-semibold text-[color:var(--brand-ink)] transition-all duration-200 hover:shadow-[0_4px_12px_var(--accent-glow)] hover:brightness-[1.02] active:scale-[0.98]"
          >
            <MessageSquarePlus className="h-4 w-4" />
            {t("assistant.newChat")}
          </button>
        </Panel>

        <Panel className="space-y-4 p-5 xl:flex xl:min-h-0 xl:flex-1 xl:flex-col xl:overflow-hidden">
          <div>
            <h2 className="font-display text-lg font-semibold">{t("assistant.historyTitle")}</h2>
            <p className="mt-1 text-sm leading-6 text-[color:var(--muted)]">{t("assistant.historyBody")}</p>
          </div>
          <input
            type="text"
            className="form-field text-sm"
            placeholder={t("assistant.searchSessions")}
            value={sessionSearch}
            onChange={(e) => setSessionSearch(e.target.value)}
          />
          <div className="xl:min-h-0 xl:flex-1 xl:overflow-y-auto xl:pr-1">
            {activeSessions.length === 0 && archivedSessions.length === 0 ? (
              <div className="rounded-xl border border-dashed border-[color:var(--border)] bg-[color:var(--surface-muted)]/50 px-5 py-5 text-sm leading-7 text-[color:var(--muted)]">
                {t("assistant.emptyHistory")}
              </div>
            ) : (
              <div className="space-y-5">
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setHistoryView("active")}
                    className={`inline-flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-semibold transition ${historyView === "active" ? "border-[color:var(--brand-solid)] bg-[color:var(--brand-soft)] text-[color:var(--brand-ink)]" : "border-[color:var(--border)] bg-[color:var(--surface-muted)] text-[color:var(--muted)] hover:border-[color:var(--brand-solid)]"}`}
                  >
                    <span>{t("assistant.activeHistoryTitle")}</span>
                    <Badge>{activeSessions.length}</Badge>
                  </button>
                  {(archivedSessions.length > 0 || historyView === "archived") ? (
                    <button
                      type="button"
                      onClick={() => setHistoryView("archived")}
                      className={`inline-flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-semibold transition ${historyView === "archived" ? "border-[color:var(--brand-solid)] bg-[color:var(--brand-soft)] text-[color:var(--brand-ink)]" : "border-[color:var(--border)] bg-[color:var(--surface-muted)] text-[color:var(--muted)] hover:border-[color:var(--brand-solid)]"}`}
                    >
                      <span>{t("assistant.archivedHistoryTitle")}</span>
                      <Badge>{archivedSessions.length}</Badge>
                    </button>
                  ) : null}
                </div>
                {historyView === "active" ? (
                <div className="space-y-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--muted)]">{t("assistant.activeHistoryTitle")}</p>
                  {activeSessions.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-[color:var(--border)] px-4 py-4 text-sm leading-6 text-[color:var(--muted)]">
                      {t("assistant.emptyHistory")}
                    </div>
                  ) : activeSessions.map((session, sessionIdx) => {
                    const providerId = (session.providerId ?? "mock") as ProviderId;
                    const isBusy = sessionBusyId === session.id;
                    const isDeleting = pendingDeleteId === session.id;
                    return (
                      <div
                        key={session.id}
                        tabIndex={0}
                        role="option"
                        aria-selected={project?.id === session.id}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") { router.push(`/${locale}/assistant?chat=${session.id}`); }
                          if (e.key === "ArrowDown") { e.preventDefault(); const next = e.currentTarget.nextElementSibling as HTMLElement | null; next?.focus(); }
                          if (e.key === "ArrowUp") { e.preventDefault(); const prev = e.currentTarget.previousElementSibling as HTMLElement | null; prev?.focus(); }
                        }}
                        className={`motion-card rounded-xl border px-4 py-4 transition-all duration-200 outline-none focus:ring-2 focus:ring-[color:var(--brand-solid)]/40 ${project?.id === session.id ? "border-[color:var(--brand-solid)]/30 bg-[color:var(--brand-soft)] text-[color:var(--brand-ink)] shadow-sm ring-1 ring-[color:var(--brand-solid)]/20" : "border-[color:var(--border)] bg-[color:var(--surface-muted)]"}`}
                      >
                        <div className="flex items-start gap-3">
                          <ProviderReplyAvatar providerId={providerId} className="h-9 w-9 rounded-2xl" />
                          <div className="min-w-0 flex-1">
                            <Link prefetch={false} href={`/${locale}/assistant?chat=${session.id}`} className="block">
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="font-semibold">{session.title}</p>
                                <Badge>{t(`roomVisibility.${session.visibility}`)}</Badge>
                              </div>
                              <p className="mt-2 line-clamp-2 text-sm leading-6 text-[inherit] opacity-85">{session.description || t("assistant.emptyConversation")}</p>
                              <p className="mt-2 text-xs opacity-75">{formatDateTime(session.updatedAt, locale)}</p>
                            </Link>
                          </div>
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <Button variant="ghost" className="gap-2" disabled={isBusy} onClick={() => void manageSession(session.id, "archive")}>
                            <Archive className="h-4 w-4" />
                            {t("assistant.archiveSession")}
                          </Button>
                          {isDeleting ? (
                            <>
                              <Button variant="danger" className="gap-2" disabled={isBusy} onClick={() => void manageSession(session.id, "delete")}>
                                <Trash2 className="h-4 w-4" />
                                {t("assistant.deleteSessionConfirm")}
                              </Button>
                              <Button variant="ghost" disabled={isBusy} onClick={() => setPendingDeleteId(null)}>{t("common.cancel")}</Button>
                            </>
                          ) : (
                            <Button variant="ghost" className="gap-2 text-rose-700 dark:text-rose-300" disabled={isBusy} onClick={() => setPendingDeleteId(session.id)}>
                              <Trash2 className="h-4 w-4" />
                              {t("assistant.deleteSession")}
                            </Button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
                ) : null}

                {historyView === "archived" && archivedSessions.length > 0 ? (
                  <div className="space-y-3">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--muted)]">{t("assistant.archivedHistoryTitle")}</p>
                    {archivedSessions.map((session) => {
                      const providerId = (session.providerId ?? "mock") as ProviderId;
                      const isBusy = sessionBusyId === session.id;
                      const isDeleting = pendingDeleteId === session.id;
                      return (
                        <div key={session.id} className={`motion-card rounded-xl border px-4 py-4 transition-all duration-200 ${project?.id === session.id ? "border-[color:var(--brand-solid)]/30 bg-[color:var(--brand-soft)] text-[color:var(--brand-ink)] shadow-sm" : "border-[color:var(--border)] bg-[color:var(--surface-muted)] opacity-90"}`}>
                          <div className="flex items-start gap-3">
                            <ProviderReplyAvatar providerId={providerId} className="h-9 w-9 rounded-2xl" />
                            <div className="min-w-0 flex-1">
                              <Link prefetch={false} href={`/${locale}/assistant?chat=${session.id}`} className="block">
                                <div className="flex flex-wrap items-center gap-2">
                                  <p className="font-semibold">{session.title}</p>
                                  <Badge>{t("common.archive")}</Badge>
                                </div>
                                <p className="mt-2 line-clamp-2 text-sm leading-6 text-[inherit] opacity-85">{session.description || t("assistant.emptyConversation")}</p>
                                <p className="mt-2 text-xs opacity-75">{formatDateTime(session.updatedAt, locale)}</p>
                              </Link>
                            </div>
                          </div>
                          <div className="mt-3 flex flex-wrap gap-2">
                            <Button variant="ghost" className="gap-2" disabled={isBusy} onClick={() => void manageSession(session.id, "restore")}>
                              <RotateCcw className="h-4 w-4" />
                              {t("assistant.restoreSession")}
                            </Button>
                            {isDeleting ? (
                              <>
                                <Button variant="danger" className="gap-2" disabled={isBusy} onClick={() => void manageSession(session.id, "delete")}>
                                  <Trash2 className="h-4 w-4" />
                                  {t("assistant.deleteSessionConfirm")}
                                </Button>
                                <Button variant="ghost" disabled={isBusy} onClick={() => setPendingDeleteId(null)}>{t("common.cancel")}</Button>
                              </>
                            ) : (
                              <Button variant="ghost" className="gap-2 text-rose-700 dark:text-rose-300" disabled={isBusy} onClick={() => setPendingDeleteId(session.id)}>
                                <Trash2 className="h-4 w-4" />
                                {t("assistant.deleteSession")}
                              </Button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            )}
          </div>
          <p className="text-xs leading-6 text-[color:var(--muted)]">{t("assistant.historyRetentionHint")}</p>
        </Panel>
      </aside>

      <div className="flex min-h-[calc(100svh-var(--shell-header-height,4rem))] min-w-0 flex-col xl:h-[calc(100vh-var(--shell-header-height,4rem))] xl:min-h-0">
        {project ? (
          <>
            <div className="shrink-0 border-b border-[color:var(--border)] bg-[color:var(--surface-strong)] px-4 py-3 lg:px-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <ProviderReplyAvatar providerId={effectiveProviderId} className="h-9 w-9 rounded-xl" />
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone="accent">{t(`providersCatalog.${effectiveProviderId}.label`)}</Badge>
                    {(() => {
                      const desc = getProviderDescriptor(effectiveProviderId);
                      if (!desc || desc.models.length < 2) return <Badge>{effectiveModelDisplay}</Badge>;
                      return (
                        <select
                          value={effectiveModel}
                          onChange={(e) => {
                            const newModel = e.target.value;
                            setModelOverride(newModel);
                            void patchSettings({ provider: { providers: { [effectiveProviderId]: { model: newModel } } } }).catch((error) => {
                              setModelOverride(null);
                              setStatus(error instanceof Error ? error.message : t("errors.unexpected"), "danger");
                            });
                          }}
                          className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-strong)] px-2 py-1 text-xs font-semibold text-[color:var(--foreground)]"
                        >
                          {desc.models.map((m) => (
                            <option key={m.id} value={m.id}>{m.label}</option>
                          ))}
                        </select>
                      );
                    })()}
                    <Badge>{t(`roomVisibility.${project.room.visibility}`)}</Badge>
                    {conversationCapabilities.image ? <Badge>{t("assistant.inputImage")}</Badge> : null}
                    {conversationCapabilities.document ? <Badge>{t("assistant.inputDocument")}</Badge> : null}
                  </div>
                </div>
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={startNewChat}
                    disabled={busy}
                    className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-strong)] px-3 py-2 text-xs font-semibold transition hover:bg-[color:var(--surface-hover)]"
                  >
                    <MessageSquarePlus className="h-3.5 w-3.5" />
                    {t("assistant.newChat")}
                  </button>
                  <Link prefetch={false} href={`/${locale}/projects/${project.id}`} className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-strong)] px-3 py-2 text-xs font-semibold transition hover:bg-[color:var(--surface-hover)]">
                    <ArrowUpRight className="h-3.5 w-3.5" />
                    {t("assistant.openWorkspace")}
                  </Link>
                  {project.room.visibility === "private" ? (
                    <Button variant="ghost" className="gap-1.5 px-3 py-2 text-xs" onClick={publishWorkspace} disabled={publishing || !currentIdentityControlsWorkspace || isReadOnlySession}>
                      <Users className="h-3.5 w-3.5" />
                      {publishing ? `${t("common.loading")}...` : t("assistant.publishWorkspace")}
                    </Button>
                  ) : null}
                  <Button variant="ghost" className="gap-1.5 px-3 py-2 text-xs" onClick={async () => {
                    if (!project || project.metadata.isSample) {
                      setStatus(t("knowledge.sampleGraphGenerationDisabled"), "danger");
                      return;
                    }
                    try {
                      const response = await fetch("/api/knowledge/user-graphs", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ title: project.title, sourceProjectIds: [project.id], locale, visibility: "private" }),
                      });
                      if (!response.ok) {
                        throw new Error(await readErrorMessage(response));
                      }
                      setStatus(t("assistant.graphGenerating"), "default");
                    } catch (error) { setStatus(error instanceof Error ? error.message : t("errors.unexpected"), "danger"); }
                  }} disabled={isReadOnlySession || !canGenerateKnowledgeGraph} title={!canGenerateKnowledgeGraph ? t("knowledge.sampleGraphGenerationDisabled") : t("knowledge.graphQualityHint")}>
                    <Network className="h-3.5 w-3.5" />
                    {t("assistant.generateGraph")}
                  </Button>
                </div>
              </div>
              {!providerHasSavedKey && effectiveProviderId !== "mock" ? (
                <div className="assistant-api-key-notice mt-2 rounded-lg border px-4 py-2.5 text-xs font-semibold leading-5 shadow-sm">
                  {t("assistant.noSavedKeyBody")}
                </div>
              ) : null}
              {!isSingleUserMode ? (
                <div className="mt-2 rounded-lg border border-slate-300 bg-slate-100 px-4 py-2.5 text-xs font-semibold leading-5 text-slate-900 shadow-sm dark:border-slate-600 dark:bg-slate-800/90 dark:text-slate-100">
                  {t("assistant.sharedModeRedirectHint")}
                </div>
              ) : null}
            </div>

            {isArchivedSession ? (
              <div className="shrink-0 border-b border-amber-500/25 bg-amber-500/10 px-4 py-3 text-sm leading-6 text-amber-900 dark:text-amber-100">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 font-semibold">
                    <Archive className="h-4 w-4" />
                    <span>{t("assistant.archivedReadonlyTitle")}</span>
                  </div>
                  <Button variant="ghost" className="gap-2" disabled={sessionBusyId === project.id} onClick={() => void manageSession(project.id, "restore")}>
                    <RotateCcw className="h-4 w-4" />
                    {t("assistant.restoreSession")}
                  </Button>
                </div>
              </div>
            ) : null}

            <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-b-2xl border border-t-0 border-[color:var(--border)] bg-[color:var(--surface)]">
              <div
                ref={feedRef}
                className={`chat-feed soft-scrollbar relative flex-1 overflow-y-auto px-4 py-5 lg:px-6 ${dragOver ? "ring-2 ring-inset ring-[color:var(--brand-solid)]" : ""}`}
                onScroll={updateAutoScrollPreference}
                onDragEnter={(e) => { e.preventDefault(); dragCounter.current++; setDragOver(true); }}
                onDragOver={(e) => { e.preventDefault(); }}
                onDragLeave={() => { dragCounter.current--; if (dragCounter.current <= 0) { dragCounter.current = 0; setDragOver(false); } }}
                onDrop={(e) => {
                  e.preventDefault();
                  dragCounter.current = 0;
                  setDragOver(false);
                  const files = e.dataTransfer.files;
                  if (files.length > 0) {
                    const isImage = Array.from(files).every((f) => f.type.startsWith("image/"));
                    void uploadFiles(files, isImage ? "image" : "document");
                  }
                }}
              >
                {dragOver ? (
                  <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-[color:var(--brand-soft)]/80 backdrop-blur-sm">
                    <div className="flex flex-col items-center gap-2 text-[color:var(--brand-ink)]">
                      <Paperclip className="h-8 w-8" />
                      <p className="text-sm font-semibold">{t("assistant.dropToUpload")}</p>
                    </div>
                  </div>
                ) : null}
                <div className="mx-auto max-w-4xl space-y-4">
                  {feedEvents.length === 0 && !pendingReply ? (
                    <div className="flex flex-col items-center justify-center py-20 text-center">
                      <div className="theme-icon-tile inline-flex h-14 w-14 items-center justify-center rounded-2xl">
                        <BrainCircuit className="h-6 w-6" />
                      </div>
                      <p className="mt-4 text-base font-semibold text-[color:var(--foreground)]">{t("assistant.emptyConversation")}</p>
                      <p className="mt-2 max-w-sm text-sm text-[color:var(--muted)]">{t("assistant.personalWorkspaceHint")}</p>
                    </div>
                  ) : (
                    <>
                      {hiddenFeedEventCount > 0 ? (
                        <div className="flex justify-center pb-2">
                          <button
                            type="button"
                            onClick={loadOlderMessages}
                            disabled={loadingOlderMessages}
                            className="inline-flex items-center gap-2 rounded-full border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-3 py-1.5 text-xs font-semibold text-[color:var(--muted)] transition hover:border-[color:var(--brand-solid)] hover:text-[color:var(--foreground)] disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {loadingOlderMessages
                              ? t("assistant.loadingOlderMessages")
                              : t("assistant.loadOlderMessages", { count: String(Math.min(MESSAGE_HISTORY_PAGE_SIZE, hiddenFeedEventCount)) })}
                          </button>
                        </div>
                      ) : null}
                      {visibleFeedEvents.map((event) => {
                      const isAssistant = event.actorType === "ai";
                      const eventProviderId = ((event.metadata.providerId as ProviderId | undefined) ?? effectiveProviderId);
                      const eventModel = typeof event.metadata.model === "string" && event.metadata.model.trim().length > 0 ? event.metadata.model : null;
                      const linkedAttachments = event.attachmentIds.map((attachmentId) => attachments.find((attachment) => attachment.id === attachmentId)).filter(Boolean) as RoomAttachment[];
                      const revisionView = isAssistant ? getAssistantRevisionView(event) : null;
                      const inlineRegeneratePendingReply = isAssistant
                        && pendingReply?.regenerate === true
                        && pendingReply.replaceAssistantEventId === event.id
                          ? pendingReply
                          : null;
                      return (
                        <article key={event.id} className={`group flex ${isAssistant ? "justify-start" : "justify-end"}`}>
                          <div className={`max-w-full rounded-2xl px-4 py-4 sm:max-w-[42rem] sm:px-5 ${isAssistant ? "chat-message-ai" : "chat-message-user"}`}>
                            <div className="flex items-center gap-2 text-xs text-[color:var(--muted)]">
                              {isAssistant ? <ProviderReplyAvatar providerId={eventProviderId} className="h-7 w-7 rounded-lg" /> : <Sparkles className="h-3.5 w-3.5" />}
                              <span className="font-semibold">{isAssistant ? t(`providersCatalog.${eventProviderId}.label`) : effectiveSettings.profile.displayName}</span>
                              {isAssistant && eventModel ? <span className="rounded-md bg-[color:var(--surface-muted)] px-1.5 py-0.5 text-[10px] font-medium">{eventModel}</span> : null}
                              <span className="text-[color:var(--muted)]/60">·</span>
                              <span className="text-[color:var(--muted)]/70">{formatDateTime(event.createdAt, locale)}</span>
                            </div>
                            {isAssistant && !inlineRegeneratePendingReply && typeof event.metadata.reasoning === "string" && event.metadata.reasoning.trim().length > 0 ? (
                              <details className="mt-2 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-muted)]/50 px-3 py-2 text-xs text-[color:var(--muted)]">
                                <summary className="cursor-pointer font-semibold">{t("assistant.aiThinking")}</summary>
                                <p className="mt-2 whitespace-pre-wrap leading-5">{event.metadata.reasoning}</p>
                              </details>
                            ) : null}
                            {inlineRegeneratePendingReply ? (
                              <div className="mt-3 rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-muted)]/60 px-3 py-3">
                                <div className="flex items-center gap-2 text-xs text-[color:var(--muted)]">
                                  <ProviderReplyAvatar providerId={inlineRegeneratePendingReply.providerId} className="h-6 w-6 rounded-lg" />
                                  <span className="font-semibold">{t("assistant.regenerate")}</span>
                                  <span className="rounded-md bg-[color:var(--surface-muted)] px-1.5 py-0.5 text-[10px] font-medium">{inlineRegeneratePendingReply.model}</span>
                                </div>
                                {isStreaming || hasStreamingPreview ? (
                                  <div className="mt-3">
                                    {streamReasoning.trim().length > 0 ? (
                                      <details open className="mb-2 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-muted)]/50 px-3 py-2 text-xs text-[color:var(--muted)]">
                                        <summary className="cursor-pointer font-semibold">{t("assistant.aiThinking")}</summary>
                                        <p className="mt-2 whitespace-pre-wrap leading-5">{streamReasoning}</p>
                                      </details>
                                    ) : null}
                                    {streamContent.trim().length > 0 ? (
                                      <p className="whitespace-pre-wrap text-sm leading-relaxed text-[color:var(--foreground)]">
                                        {streamContent}
                                        {isStreaming ? <span className="animate-pulse">|</span> : null}
                                      </p>
                                    ) : (
                                      <div className="flex items-center gap-3 text-sm text-[color:var(--foreground)]">
                                        <div className="flex items-center gap-1.5 text-[color:var(--brand-solid)]">
                                          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
                                          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current [animation-delay:150ms]" />
                                          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current [animation-delay:300ms]" />
                                        </div>
                                        <span className="text-[color:var(--muted)]">{t("assistant.replyPendingBody")}</span>
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
                                      {isStreaming ? (
                                        <button type="button" onClick={interruptPendingReply} className="inline-flex items-center gap-1.5 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-1.5 font-semibold text-red-600 transition hover:bg-red-500/20 dark:text-red-300">
                                          {"\u25A0"} {t("assistant.stopGenerating")}
                                        </button>
                                      ) : null}
                                    </div>
                                  </div>
                                ) : (
                                  <div className="mt-3 flex items-center gap-3 text-sm text-[color:var(--foreground)]">
                                    <div className="flex items-center gap-1.5 text-[color:var(--brand-solid)]">
                                      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
                                      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current [animation-delay:150ms]" />
                                      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current [animation-delay:300ms]" />
                                    </div>
                                    <span className="text-[color:var(--muted)]">{t("assistant.replyPendingBody")}</span>
                                  </div>
                                )}
                              </div>
                            ) : event.message.trim().length > 0 ? (
                              isAssistant
                                ? <MarkdownContent content={event.message} className="mt-2.5 text-sm leading-relaxed text-[color:var(--foreground)]" />
                                : <p className="mt-2.5 whitespace-pre-wrap text-sm leading-relaxed text-[color:var(--foreground)]">{event.message}</p>
                            ) : null}
                            {linkedAttachments.length > 0 ? (
                              <div className="mt-3 flex flex-wrap gap-2">
                                {linkedAttachments.map((attachment) => {
                                  const Icon = attachmentIcon(attachment.kind);
                                  return (
                                    <a key={attachment.id} href={buildAttachmentHref(project.id, attachment)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-full border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-3 py-2 text-xs font-semibold transition hover:border-[color:var(--brand-solid)]">
                                      <Icon className="h-3.5 w-3.5" />
                                      <span>{attachment.name}</span>
                                    </a>
                                  );
                                })}
                              </div>
                            ) : null}
                            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-[color:var(--muted)]">
                              <span>{formatDateTime(event.createdAt, locale)}</span>
                              {revisionView ? (
                                <span className="inline-flex items-center gap-1 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-2 py-1 font-semibold">
                                  <button
                                    type="button"
                                    disabled={busy || revisionView.activeIndex <= 0}
                                    onClick={() => {
                                      const previous = revisionView.revisions[revisionView.activeIndex - 1];
                                      if (previous) void activateAssistantRevision(event.id, previous.id);
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
                                      if (next) void activateAssistantRevision(event.id, next.id);
                                    }}
                                    className="px-1 text-[color:var(--foreground)] disabled:opacity-40"
                                    aria-label="Next assistant reply revision"
                                  >
                                    {"›"}
                                  </button>
                                </span>
                              ) : null}
                              {event.message.trim().length > 0 ? (
                                <button
                                  type="button"
                                  onClick={() => void copyMessageText(event.message)}
                                  className="inline-flex items-center gap-1.5 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-2.5 py-1 font-semibold transition hover:border-[color:var(--brand-solid)] hover:text-[color:var(--foreground)]"
                                >
                                  <Copy className="h-3.5 w-3.5" />
                                  {t("common.copy")}
                                </button>
                              ) : null}
                            </div>
                            {isAssistant && latestRegenerateTarget?.replaceAssistantEventId === event.id ? (
                              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-[color:var(--muted)]">
                                <button
                                  type="button"
                                  onClick={() => void sendMessage({
                                    message: latestRegenerateTarget.userMessage,
                                    attachmentIds: latestRegenerateTarget.attachmentIds,
                                    regenerate: true,
                                    replaceAssistantEventId: latestRegenerateTarget.replaceAssistantEventId,
                                  })}
                                  disabled={busy || isReadOnlySession}
                                  className="inline-flex items-center gap-1.5 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-3 py-1.5 font-semibold transition hover:border-[color:var(--brand-solid)] hover:text-[color:var(--foreground)] disabled:opacity-60"
                                >
                                  <RotateCcw className="h-3.5 w-3.5" />
                                  {t("assistant.regenerate")}
                                </button>
                                <span>{t("assistant.regenerateHint")}</span>
                              </div>
                            ) : null}
                          </div>
                        </article>
                      );
                      })}
                    </>
                  )}
                  {pendingReply && !pendingReply.regenerate ? (
                    <>
                      {pendingReply.regenerate ? null : (
                        <article className="flex justify-end">
                          <div className="chat-message-user max-w-full rounded-2xl px-4 py-4 sm:max-w-[42rem] sm:px-5">
                            <div className="flex items-center gap-2 text-xs text-[color:var(--muted)]">
                              <Sparkles className="h-3.5 w-3.5" />
                              <span className="font-semibold">{effectiveSettings.profile.displayName}</span>
                              <span className="text-[color:var(--muted)]/60">·</span>
                              <span className="text-[color:var(--muted)]/70">{formatDateTime(pendingReply.submittedAt, locale)}</span>
                            </div>
                            {pendingReply.userMessage.trim().length > 0 ? <p className="mt-2.5 whitespace-pre-wrap text-sm leading-relaxed text-[color:var(--foreground)]">{pendingReply.userMessage}</p> : null}
                            {pendingReply.attachmentIds.length > 0 ? (
                              <div className="mt-3 flex flex-wrap gap-2">
                                {pendingReply.attachmentIds
                                  .map((attachmentId) => attachments.find((attachment) => attachment.id === attachmentId))
                                  .filter((attachment): attachment is RoomAttachment => Boolean(attachment))
                                  .map((attachment) => {
                                    const Icon = attachmentIcon(attachment.kind);
                                    return (
                                      <a key={`pending-${attachment.id}`} href={buildAttachmentHref(project.id, attachment)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-full border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-3 py-2 text-xs font-semibold transition hover:border-[color:var(--brand-solid)]">
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
                        </article>
                      )}
                      <article className="flex justify-start">
                        <div className="chat-message-ai max-w-full rounded-2xl px-4 py-4 sm:max-w-[32rem] sm:px-5">
                          <div className="flex items-center gap-2 text-xs text-[color:var(--muted)]">
                            <ProviderReplyAvatar providerId={pendingReply.providerId} className="h-7 w-7 rounded-lg" />
                            <span className="font-semibold">{t(`providersCatalog.${pendingReply.providerId}.label`)}</span>
                            <span className="rounded-md bg-[color:var(--surface-muted)] px-1.5 py-0.5 text-[10px] font-medium">{pendingReply.model}</span>
                          </div>
                          {isStreaming || hasStreamingPreview ? (
                            <div className="mt-3">
                              {streamReasoning.trim().length > 0 ? (
                                <details open className="mb-2 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-muted)]/50 px-3 py-2 text-xs text-[color:var(--muted)]">
                                  <summary className="cursor-pointer font-semibold">{t("assistant.aiThinking")}</summary>
                                  <p className="mt-2 whitespace-pre-wrap leading-5">{streamReasoning}</p>
                                </details>
                              ) : null}
                              {streamContent.trim().length > 0 ? (
                                <p className="whitespace-pre-wrap text-sm leading-relaxed text-[color:var(--foreground)]">
                                  {streamContent}
                                  {isStreaming ? <span className="animate-pulse">|</span> : null}
                                </p>
                              ) : (
                                <div className="flex items-center gap-3 text-sm text-[color:var(--foreground)]">
                                  <div className="flex items-center gap-1.5 text-[color:var(--brand-solid)]">
                                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
                                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current [animation-delay:150ms]" />
                                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current [animation-delay:300ms]" />
                                  </div>
                                  <span className="text-[color:var(--muted)]">{t("assistant.replyPendingBody")}</span>
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
                                {isStreaming ? (
                                  <button type="button" onClick={interruptPendingReply} className="inline-flex items-center gap-1.5 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-1.5 font-semibold text-red-600 transition hover:bg-red-500/20 dark:text-red-300">
                                    {"\u25A0"} {t("assistant.stopGenerating")}
                                  </button>
                                ) : null}
                              </div>
                            </div>
                          ) : (
                            <div className="mt-3 flex items-center gap-3 text-sm text-[color:var(--foreground)]">
                              <div className="flex items-center gap-1.5 text-[color:var(--brand-solid)]">
                                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
                                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current [animation-delay:150ms]" />
                                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current [animation-delay:300ms]" />
                              </div>
                              <span className="text-[color:var(--muted)]">{t("assistant.replyPendingBody")}</span>
                            </div>
                          )}
                        </div>
                      </article>
                    </>
                  ) : null}
                  {interruptedReply ? (
                    <article className="flex justify-start">
                      <div className="chat-message-ai max-w-full rounded-2xl px-4 py-4 sm:max-w-[32rem] sm:px-5">
                        <div className="flex items-center gap-2 text-xs text-[color:var(--muted)]">
                          <ProviderReplyAvatar providerId={interruptedReply.providerId} className="h-7 w-7 rounded-lg" />
                          <span className="font-semibold">{t(`providersCatalog.${interruptedReply.providerId}.label`)}</span>
                          <span className="rounded-md bg-[color:var(--surface-muted)] px-1.5 py-0.5 text-[10px] font-medium">{interruptedReply.model}</span>
                          <span className="text-[color:var(--muted)]/60">·</span>
                          <span>{t("assistant.generationStopped")}</span>
                        </div>
                        {interruptedReply.partialReasoning.trim().length > 0 ? (
                          <details className="mt-2 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-muted)]/50 px-3 py-2 text-xs text-[color:var(--muted)]">
                            <summary className="cursor-pointer font-semibold">{t("assistant.aiThinking")}</summary>
                            <p className="mt-2 whitespace-pre-wrap leading-5">{interruptedReply.partialReasoning}</p>
                          </details>
                        ) : null}
                        <p className="mt-2.5 whitespace-pre-wrap text-sm leading-relaxed text-[color:var(--foreground)]">
                          {interruptedReply.partialContent || t("assistant.replyInterruptedEmpty")}
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
                            onClick={() => void sendMessage({
                              message: interruptedReply.userMessage,
                              attachmentIds: interruptedReply.attachmentIds,
                              regenerate: Boolean(interruptedReply.replaceAssistantEventId),
                              replaceAssistantEventId: interruptedReply.replaceAssistantEventId,
                            })}
                            disabled={busy || isReadOnlySession}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-3 py-1.5 font-semibold transition hover:border-[color:var(--brand-solid)] hover:text-[color:var(--foreground)] disabled:opacity-60"
                          >
                            <RotateCcw className="h-3.5 w-3.5" />
                            {t("assistant.regenerate")}
                          </button>
                          <span>{t("assistant.regenerateHint")}</span>
                        </div>
                      </div>
                    </article>
                  ) : null}
                </div>
              </div>

              <div className="border-t border-[color:var(--border)] bg-[color:var(--surface-strong)] px-4 py-4 lg:px-6">
                <p className="mb-3 text-xs leading-5 text-[color:var(--muted)]">{t("common.aiDisclaimer")}</p>
                {attachments.length > 0 ? (
                  <div className="mb-4 flex flex-wrap gap-2">
                    {attachments.slice(0, 8).map((attachment) => {
                      const Icon = attachmentIcon(attachment.kind);
                      const selected = pendingAttachmentIds.includes(attachment.id);
                      return (
                        <button
                          key={attachment.id}
                          type="button"
                          disabled={isReadOnlySession}
                          onClick={() => setPendingAttachmentIds((current) => current.includes(attachment.id) ? current.filter((item) => item !== attachment.id) : [...current, attachment.id])}
                          className={`inline-flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-semibold transition ${selected ? "border-[color:var(--brand-solid)] bg-[color:var(--brand-soft)] text-[color:var(--brand-ink)]" : "border-[color:var(--border)] bg-[color:var(--surface-muted)] text-[color:var(--muted)] hover:border-[color:var(--brand-solid)]"} ${isReadOnlySession ? "cursor-not-allowed opacity-60" : ""}`}
                        >
                          <Icon className="h-3.5 w-3.5" />
                          <span>{attachment.name}</span>
                        </button>
                      );
                    })}
                  </div>
                ) : null}

                {pendingAttachments.length > 0 ? (
                  <div className="mb-4 rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-4 py-4 text-sm leading-6 text-[color:var(--muted)]">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <p>{t("assistant.pendingAttachments", { count: String(pendingAttachments.length) })}</p>
                      <Badge>{t("assistant.send")}</Badge>
                    </div>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      {pendingAttachments.map((attachment) => {
                        const Icon = attachmentIcon(attachment.kind);
                        const directReadable = attachmentCanDirectConversation(attachment, conversationCapabilities);
                        const attachmentHref = buildAttachmentHref(project.id, attachment);
                        return (
                          <div key={`pending-chip-${attachment.id}`} className="flex items-start gap-3 rounded-[1rem] border border-[color:var(--border)] bg-[color:var(--surface-strong)] px-3 py-3">
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
                                <Badge>{directReadable ? t("assistant.directInputReady") : t("assistant.referenceAttachment")}</Badge>
                              </div>
                            </div>
                            <Button variant="ghost" className="shrink-0 px-3 py-2 text-xs" onClick={() => setPendingAttachmentIds((current) => current.filter((item) => item !== attachment.id))}>
                              {t("common.remove")}
                            </Button>
                          </div>
                        );
                      })}
                    </div>
                    {pendingDirectAttachmentCount !== pendingAttachments.length ? <p className="mt-3 text-xs leading-6 text-[color:var(--muted)]">{t("assistant.referenceAttachmentHint")}</p> : null}
                  </div>
                ) : null}

                {pendingImageFiles.length > 0 ? (
                  <div className="mx-auto max-w-4xl rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-4">
                    <p className="text-sm font-semibold text-[color:var(--foreground)]">{t("assistant.confirmImageUpload", { count: String(pendingImageFiles.length) })}</p>
                    <div className="mt-3 flex flex-wrap gap-3">
                      {pendingImageFiles.map((file, idx) => (
                        <div key={`preview-${idx}-${file.name}`} className="flex items-center gap-2 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-strong)] px-3 py-2">
                          <FileImage className="h-4 w-4 text-[color:var(--muted)]" />
                          <span className="max-w-[12rem] truncate text-xs text-[color:var(--foreground)]">{file.name}</span>
                          <span className="text-[10px] text-[color:var(--muted)]">{(file.size / 1024).toFixed(0)}KB</span>
                        </div>
                      ))}
                    </div>
                    <div className="mt-3 flex gap-2">
                      <Button className="gap-1.5" onClick={() => { void uploadFiles(pendingImageFiles, "image"); setPendingImageFiles([]); if (imageFileRef.current) imageFileRef.current.value = ""; }}>
                        {t("assistant.confirmSendImages")}
                      </Button>
                      <Button variant="ghost" onClick={() => { setPendingImageFiles([]); if (imageFileRef.current) imageFileRef.current.value = ""; }}>
                        {t("common.cancel")}
                      </Button>
                    </div>
                  </div>
                ) : null}

                <div className="mx-auto max-w-4xl space-y-3">
                  <div className="chat-composer p-3">
                    <textarea
                      ref={textareaRef}
                      className="w-full resize-none border-0 bg-transparent p-1 text-sm leading-relaxed text-[color:var(--foreground)] outline-none placeholder:text-[color:var(--muted)]/60"
                      rows={3}
                      value={draft}
                      onChange={(event) => setDraft(event.target.value)}
                      placeholder={t("assistant.inputPlaceholder")}
                      disabled={busy || isReadOnlySession}
                      onKeyDown={handleComposerKeyDown}
                    />
                    <div className="flex items-center justify-between gap-2 border-t border-[color:var(--border)]/50 pt-2">
                      <div className="flex items-center gap-1.5">
                        {canStageImages ? (
                          <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-[color:var(--muted)] transition hover:bg-[color:var(--surface-muted)] hover:text-[color:var(--foreground)]">
                            <input
                              ref={imageFileRef}
                              type="file"
                              className="hidden"
                              accept="image/*"
                              multiple
                              disabled={busy || isReadOnlySession}
                              onChange={(event) => {
                                const files = event.target.files;
                                if (files?.length) {
                                  setPendingImageFiles(Array.from(files));
                                }
                              }}
                            />
                            <FileImage className="h-4 w-4" />
                            <span className="hidden sm:inline">{t("assistant.attachImage")}</span>
                          </label>
                        ) : null}
                        {canStageDocuments ? (
                          <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-[color:var(--muted)] transition hover:bg-[color:var(--surface-muted)] hover:text-[color:var(--foreground)]">
                            <input
                              ref={documentFileRef}
                              type="file"
                              className="hidden"
                              accept={buildDocumentUploadAccept()}
                              multiple
                              disabled={busy || isReadOnlySession}
                              onChange={(event) => {
                                const files = event.target.files;
                                if (files?.length) {
                                  void uploadFiles(files, "document");
                                }
                              }}
                            />
                            <FileText className="h-4 w-4" />
                            <span className="hidden sm:inline">{t("assistant.attachDocument")}</span>
                          </label>
                        ) : null}
                        <div className="relative">
                          <button
                            type="button"
                            className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-[color:var(--muted)] transition hover:bg-[color:var(--surface-muted)] hover:text-[color:var(--foreground)]"
                            disabled={isReadOnlySession}
                            onClick={() => setEmojiPickerOpen((open) => !open)}
                          >
                            <Smile className="h-4 w-4" />
                          </button>
                          {emojiPickerOpen ? (
                            <EmojiPicker
                              onSelect={(emoji) => {
                                const ta = textareaRef.current;
                                if (ta) {
                                  const start = ta.selectionStart ?? draft.length;
                                  const end = ta.selectionEnd ?? draft.length;
                                  setDraft(draft.slice(0, start) + emoji + draft.slice(end));
                                  requestAnimationFrame(() => {
                                    ta.focus();
                                    const pos = start + emoji.length;
                                    ta.setSelectionRange(pos, pos);
                                  });
                                } else {
                                  setDraft(draft + emoji);
                                }
                                setEmojiPickerOpen(false);
                              }}
                              onClose={() => setEmojiPickerOpen(false)}
                            />
                          ) : null}
                        </div>
                        {!canStageImages && !canStageDocuments ? (
                          <div className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-[color:var(--muted)]">
                            <TriangleAlert className="h-3.5 w-3.5" />
                            <span>{t("assistant.uploadDisabledByModel")}</span>
                          </div>
                        ) : null}
                        <div className="hidden items-center gap-2 rounded-lg px-2 py-1 text-[11px] text-[color:var(--muted)] sm:flex">
                          <ProviderReplyAvatar providerId={effectiveProviderId} className="h-5 w-5 rounded-md" />
                          <span>{effectiveModelDisplay}</span>
                        </div>
                      </div>
                      <Button className="gap-1.5 rounded-xl px-4 py-2 text-sm" onClick={() => void sendMessage()} disabled={busy || (!draft.trim() && pendingAttachmentIds.length === 0) || isReadOnlySession}>
                        <Send className="h-3.5 w-3.5" />
                        {busy ? `${t("common.loading")}...` : t("assistant.send")}
                      </Button>
                    </div>
                  </div>
                </div>
                {message ? <p className={`mx-auto mt-3 max-w-4xl ${toneClass}`}>{message}</p> : null}
              </div>
            </div>
          </>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center p-8 text-center">
            <div className="theme-icon-tile inline-flex h-16 w-16 items-center justify-center rounded-2xl">
              <BrainCircuit className="h-7 w-7" />
            </div>
            <h2 className="mt-6 font-display text-2xl font-semibold">{t("assistant.emptyTitle")}</h2>
            <p className="mt-3 max-w-md text-sm leading-7 text-[color:var(--muted)]">{t("assistant.emptyBody")}</p>
            <button
              type="button"
              onClick={startNewChat}
              disabled={busy}
              className="mt-6 inline-flex items-center justify-center gap-2 rounded-xl border border-[color:var(--brand-solid)] bg-[color:var(--brand-soft)] px-5 py-3 text-sm font-semibold text-[color:var(--brand-ink)] transition hover:brightness-[1.02]"
            >
              <MessageSquarePlus className="h-4 w-4" />
              {t("assistant.newChat")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
