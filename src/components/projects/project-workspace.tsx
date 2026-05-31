"use client";

import Link from "next/link";
import { BrainCircuit, ChevronDown, Link2, Save, Sparkles, Trash2 } from "lucide-react";
import { startTransition, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/components/providers/i18n-provider";
import { bundledSampleProjectIds } from "@/data/samples";
import { normalizeSummaryAutomationConfig } from "@/lib/ai/summary-automation";
import { Avatar } from "@/components/ui/avatar";
import { ArgumentGraph } from "@/components/projects/argument-graph";
import { AttachmentsPanel } from "@/components/projects/attachments-panel";
import { AuditLogPanel } from "@/components/projects/audit-log-panel";
import { ProjectLinker } from "@/components/projects/project-linker";
import { ProjectCollaborationPanel } from "@/components/projects/project-collaboration-panel";
import { ProjectKnowledgePanel } from "@/components/knowledge/project-knowledge-panel";
import { Badge, Button, Panel } from "@/components/ui/primitives";
import { deriveAvatarPreset, resolveParticipantAvatar } from "@/lib/avatar";
import { formatDateTime } from "@/lib/format";
import {
  AppLocale,
  AppSettings,
  ArgumentNode,
  ArgumentRelation,
  CollaborationRole,
  DISPLAY_LOCALE_ORDER,
  DiscussionProject,
  LOCALE_AUTONYMS,
  Participant,
  PresenceStatus,
  TranscriptEntry,
} from "@/lib/types";
import { createId, pickInitials } from "@/lib/utils";
import { findRoomHost, getRoomObservers, getActivePresence } from "@/lib/rooms/session";
import { syncRoomFromParticipants } from "@/lib/rooms/sync";
import {
  canArchivePrivateWorkspace,
  canEditParticipantIdentity as canEditParticipantIdentityAccess,
  canEditParticipantRoomMetadata,
  canRemoveParticipant as canRemoveParticipantAccess,
  getProjectDisplayAccessState,
  getProjectAccessState,
  isProjectCreator,
  isProjectWorkspaceArchived,
} from "@/lib/project-access";
import { ProjectConflictError, saveProjectChanges } from "@/lib/project-client";
import { getProviderDescriptor } from "@/lib/providers/provider-catalog";
import { buildProjectSyncSignature } from "@/lib/project-sync";
import type { ProjectTemplateVisibility } from "@/lib/project-templates-shared";
import { patchSettings, primeSettingsSnapshot } from "@/lib/settings-client";
import { normalizeParticipantRoster, updateParticipantRoster } from "@/lib/participants";
import { deepEqual, isPlainObject } from "@/lib/deep-patch";

type WorkspaceTab = AppSettings["discussionPreferences"]["defaultWorkspaceTab"];
type WorkspaceMessageTone = "default" | "success" | "danger";

const workspaceTabs = ["capture", "overview", "structure", "insights", "knowledge", "settings"] as const;
const IMPORT_RESULT_STORAGE_PREFIX = "dialectica:import-result:";

type ImportResultNotice = {
  warningCount?: number;
  warnings?: string[];
  entryCount?: number;
  participantCount?: number;
};

function parseTags(input: string) {
  return input.split(",").map((tag) => tag.trim()).filter(Boolean);
}

function toLocalInput(iso: string) {
  const date = new Date(iso);
  const offset = date.getTimezoneOffset();
  const adjusted = new Date(date.getTime() - offset * 60_000);
  return adjusted.toISOString().slice(0, 16);
}

function splitParagraphs(text: string) {
  return text.split(/\n\s*\n/).map((part) => part.trim()).filter(Boolean);
}

function parseRoomNotesText(text: string) {
  return text.split(/\n+/).map((line) => line.trim()).filter(Boolean);
}

function highlightText(content: string, query: string) {
  if (!query) return content;
  const lower = content.toLowerCase();
  const target = query.toLowerCase();
  const index = lower.indexOf(target);
  if (index === -1) return content;
  return (
    <>
      {content.slice(0, index)}
      <mark className="rounded bg-[color:var(--brand-soft)] px-1 text-[color:var(--brand-ink)]">{content.slice(index, index + query.length)}</mark>
      {content.slice(index + query.length)}
    </>
  );
}

function toneForPresence(status: PresenceStatus): "default" | "accent" | "success" | "danger" {
  if (status === "online") return "success";
  if (status === "syncing") return "accent";
  if (status === "leaving") return "default";
  if (status === "offline") return "danger";
  return "default";
}

function mergeUnmodifiedProjectValue<T>(base: T, local: T, remote: T): T {
  if (deepEqual(local, base)) {
    return remote;
  }

  if (isPlainObject(base) && isPlainObject(local) && isPlainObject(remote)) {
    const keys = new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(remote)]);
    const merged: Record<string, unknown> = {};
    for (const key of keys) {
      merged[key] = mergeUnmodifiedProjectValue(base[key], local[key], remote[key]);
    }
    return merged as T;
  }

  return local;
}

function mergeParticipantArray(
  base: Participant[],
  local: Participant[],
  remote: Participant[],
) {
  const baseMap = new Map(base.map((participant) => [participant.id, participant]));
  const localMap = new Map(local.map((participant) => [participant.id, participant]));
  const remoteIds = new Set(remote.map((participant) => participant.id));
  const merged = remote.map((participant) => {
    const localParticipant = localMap.get(participant.id);
    const baseParticipant = baseMap.get(participant.id);
    if (!localParticipant) return participant;
    if (!baseParticipant) return localParticipant;
    return mergeUnmodifiedProjectValue(baseParticipant, localParticipant, participant);
  });

  for (const participant of local) {
    if (!remoteIds.has(participant.id)) {
      merged.push(participant);
    }
  }

  return merged;
}

function mergeIncomingProjectState(
  baseProject: DiscussionProject,
  localProject: DiscussionProject,
  remoteProject: DiscussionProject,
) {
  const merged = mergeUnmodifiedProjectValue(baseProject, localProject, remoteProject);
  return {
    ...merged,
    participants: mergeParticipantArray(baseProject.participants, localProject.participants, remoteProject.participants),
  };
}

export function ProjectWorkspace({
  locale,
  initialProject,
  settings,
}: {
  locale: AppLocale;
  initialProject: DiscussionProject;
  settings: AppSettings;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const preferredInitialTab: WorkspaceTab = settings.discussionPreferences.defaultWorkspaceTab;
  const [project, setProject] = useState(initialProject);
  const [savedProject, setSavedProject] = useState(initialProject);
  const savedProjectRef = useRef(savedProject);
  const [activeTab, setActiveTab] = useState<WorkspaceTab>(preferredInitialTab);
  const [search, setSearch] = useState("");
  const [speakerFilter, setSpeakerFilter] = useState("all");
  const [kindFilter, setKindFilter] = useState("all");
  const [focusNodeId, setFocusNodeId] = useState<string | undefined>(undefined);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [wsModelOverride, setWsModelOverride] = useState<string | null>(null);
  const [wsModelMenuOpen, setWsModelMenuOpen] = useState(false);
  const wsProviderId = settings.provider.activeProviderId;
  const wsModel = wsModelOverride ?? settings.provider.providers[wsProviderId].model;
  const wsModelDisplay = wsProviderId === "disabled" ? t("settings.disabledAdapterNoModel") : wsModel;
  const wsProviderDesc = getProviderDescriptor(wsProviderId);
  const [deleting, setDeleting] = useState(false);
  const [archiveUpdating, setArchiveUpdating] = useState(false);
  const [taskBusy, setTaskBusy] = useState<string | null>(null);
  const [pdfExportBusy, setPdfExportBusy] = useState(false);
  const [captureSubmitting, setCaptureSubmitting] = useState(false);
  const [roomNotesSaving, setRoomNotesSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [messageTone, setMessageTone] = useState<WorkspaceMessageTone>("default");
  const [templateSaving, setTemplateSaving] = useState(false);
  const [templateDraftName, setTemplateDraftName] = useState(initialProject.title);
  const [templateDraftDescription, setTemplateDraftDescription] = useState(initialProject.description);
  const [templateDraftVisibility, setTemplateDraftVisibility] = useState<ProjectTemplateVisibility>("private");
  const tabsLastScrollYRef = useRef(0);
  const tabsScrollFrameRef = useRef<number | null>(null);
  const tabsPendingScrollYRef = useRef(0);
  const tabsDirectionRef = useRef<"up" | "down" | null>(null);
  const tabsDirectionDistanceRef = useRef(0);
  const tabsCollapsedRef = useRef(false);
  const tabsStickyContainerRef = useRef<HTMLDivElement | null>(null);
  const [tabsCollapsed, setTabsCollapsed] = useState(false);
  const [entryDraft, setEntryDraft] = useState({
    participantId: project.participants[0]?.id ?? "",
    occurredAt: toLocalInput(new Date().toISOString()),
    content: "",
    tags: "",
    kind: "statement" as TranscriptEntry["kind"],
    highlighted: false,
    split: true,
  });
  const [nodeDraft, setNodeDraft] = useState({
    title: "",
    description: "",
    type: "claim" as ArgumentNode["type"],
    participantId: "",
    strength: 3,
    status: "open" as ArgumentNode["status"],
    stance: "",
    entryIds: [] as string[],
  });
  const [relationDraft, setRelationDraft] = useState({
    sourceNodeId: "",
    targetNodeId: "",
    type: "supports" as ArgumentRelation["type"],
    note: "",
  });

  const deferredSearch = useDeferredValue(search);
  const normalizedSearch = deferredSearch.trim().toLowerCase();
  const highlightEnabled = settings.discussionPreferences.highlightKeywords;
  const mutationAccess = useMemo(() => getProjectAccessState(project, settings), [project, settings]);
  const access = useMemo(() => getProjectDisplayAccessState(project, settings), [project, settings]);
  const protectedSample = mutationAccess.isProtectedSample;
  const sampleDeletionLocked = bundledSampleProjectIds.has(project.id);
  const sampleReadOnlyLocked = bundledSampleProjectIds.has(project.id);
  const sampleMutationMessage = t("project.sampleMutationBlocked");
  const canManageArchive = useMemo(
    () => canArchivePrivateWorkspace(project) && isProjectCreator(project, mutationAccess.localIdentityId),
    [mutationAccess.localIdentityId, project],
  );
  const canDeleteWorkspaceProject = useMemo(
    () => project.room.visibility === "private" && project.participants.length <= 1,
    [project.participants.length, project.room.visibility],
  );
  const projectArchived = useMemo(() => isProjectWorkspaceArchived(project), [project]);
  const participantsById = useMemo(() => new Map(project.participants.map((participant) => [participant.id, participant] as const)), [project.participants]);
  const nodesById = useMemo(() => new Map(project.nodes.map((node) => [node.id, node] as const)), [project.nodes]);
  const applyIncomingProject = useCallback((nextProject: DiscussionProject) => {
    setSavedProject(nextProject);
    setProject((current) => {
      if (!dirty) {
        return buildProjectSyncSignature(current) === buildProjectSyncSignature(nextProject) ? current : nextProject;
      }
      return mergeIncomingProjectState(savedProjectRef.current, current, nextProject);
    });
  }, [dirty]);

  useEffect(() => {
    primeSettingsSnapshot(settings);
  }, [settings]);

  useEffect(() => {
    savedProjectRef.current = savedProject;
  }, [savedProject]);

  useEffect(() => {
    setProject(initialProject);
    setSavedProject(initialProject);
    setDirty(false);
  }, [initialProject]);

  useEffect(() => {
    tabsCollapsedRef.current = false;
    tabsDirectionRef.current = null;
    tabsDirectionDistanceRef.current = 0;
    setTabsCollapsed(false);
  }, [activeTab]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    tabsLastScrollYRef.current = window.scrollY;
    tabsPendingScrollYRef.current = window.scrollY;

    const setTabsCollapsedState = (nextCollapsed: boolean) => {
      if (tabsCollapsedRef.current === nextCollapsed) return;
      tabsCollapsedRef.current = nextCollapsed;
      setTabsCollapsed(nextCollapsed);
    };

    const evaluateTabsScroll = () => {
      tabsScrollFrameRef.current = null;
      const currentScrollY = tabsPendingScrollYRef.current;
      const delta = currentScrollY - tabsLastScrollYRef.current;
      tabsLastScrollYRef.current = currentScrollY;
      const stickyContainer = tabsStickyContainerRef.current;
      const rootFontSize = Number.parseFloat(window.getComputedStyle(document.documentElement).fontSize) || 16;
      const stickyTop = (window.innerWidth >= 768 ? 5.5 : 4.5) * rootFontSize;
      const stickyActive = stickyContainer
        ? stickyContainer.getBoundingClientRect().top <= stickyTop + 1
        : currentScrollY >= 156;

      if (currentScrollY < 24 || !stickyActive) {
        tabsDirectionRef.current = null;
        tabsDirectionDistanceRef.current = 0;
        setTabsCollapsedState(false);
        return;
      }

      if (Math.abs(delta) < 2) {
        return;
      }

      const direction = delta > 0 ? "down" : "up";
      if (tabsDirectionRef.current !== direction) {
        tabsDirectionRef.current = direction;
        tabsDirectionDistanceRef.current = Math.abs(delta);
      } else {
        tabsDirectionDistanceRef.current += Math.abs(delta);
      }

      const threshold = direction === "down" ? 28 : 20;
      if (tabsDirectionDistanceRef.current >= threshold) {
        tabsDirectionDistanceRef.current = 0;
        setTabsCollapsedState(direction === "down");
      }
    };

    const handleScroll = () => {
      tabsPendingScrollYRef.current = window.scrollY;
      if (tabsScrollFrameRef.current === null) {
        tabsScrollFrameRef.current = window.requestAnimationFrame(evaluateTabsScroll);
      }
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", handleScroll);
      if (tabsScrollFrameRef.current !== null) {
        window.cancelAnimationFrame(tabsScrollFrameRef.current);
        tabsScrollFrameRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const nextParticipantId = access.messageParticipants[0]?.id ?? "";
    if (!access.messageParticipants.some((participant) => participant.id === entryDraft.participantId)) {
      setEntryDraft((current) => ({
        ...current,
        participantId: nextParticipantId,
      }));
    }
  }, [access.messageParticipants, entryDraft.participantId]);
  const workspaceEditingDisabled = !access.canEditWorkspace;
  const workspaceMutationLocked = sampleReadOnlyLocked || !mutationAccess.canEditWorkspace;
  const showWorkspaceMessage = (nextMessage: string | null, tone: WorkspaceMessageTone = "default") => {
    setMessage(nextMessage);
    setMessageTone(tone);
  };
  useEffect(() => {
    if (typeof window === "undefined") return;
    const storageKey = `${IMPORT_RESULT_STORAGE_PREFIX}${project.id}`;
    let rawNotice: string | null;
    try {
      rawNotice = window.sessionStorage.getItem(storageKey);
      if (rawNotice) {
        window.sessionStorage.removeItem(storageKey);
      }
    } catch {
      return;
    }
    if (!rawNotice) return;
    let notice: ImportResultNotice;
    try {
      notice = JSON.parse(rawNotice) as ImportResultNotice;
    } catch {
      return;
    }
    const warningCount = notice.warningCount ?? notice.warnings?.length ?? 0;
    const warningPreview = (notice.warnings ?? [])
      .slice(0, 2)
      .map((warning) => warning.length > 120 ? `${warning.slice(0, 117)}...` : warning);
    const summary = [
      t("importExport.done"),
      `${t("project.overviewCard.entries")}: ${notice.entryCount ?? project.entries.length}`,
      `${t("project.overviewCard.participants")}: ${notice.participantCount ?? project.participants.length}`,
      warningCount > 0 ? `${t("importExport.warnings")}: ${warningCount}` : null,
      ...warningPreview,
    ].filter(Boolean).join(" · ");
    setMessage(summary);
    setMessageTone(warningCount > 0 ? "default" : "success");
  }, [project.entries.length, project.id, project.participants.length, t]);
  const runKnowledgeExtraction = useCallback(async () => {
    if (sampleReadOnlyLocked || project.metadata.isSample) return;
    const response = await fetch(`/api/projects/${project.id}/knowledge?locale=${locale}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        generateGraphLinks: settings.knowledgePreferences.autoGenerateGraphLinks,
      }),
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => null) as { error?: string } | null;
      throw new Error(payload?.error ?? t("errors.unexpected"));
    }
  }, [locale, project.id, project.metadata.isSample, sampleReadOnlyLocked, settings.knowledgePreferences.autoGenerateGraphLinks, t]);

  const patchProject = (next: DiscussionProject) => {
    if (workspaceMutationLocked) {
      showWorkspaceMessage(sampleReadOnlyLocked ? sampleMutationMessage : t("project.workspaceReadOnly"), "danger");
      return;
    }
    setProject(next);
    setDirty(true);
    showWorkspaceMessage(null);
  };

  const withParticipants = (participants: Participant[]) => {
    const normalizedParticipants = normalizeParticipantRoster(participants);
    return {
      ...project,
      participants: normalizedParticipants,
      room: syncRoomFromParticipants(project, normalizedParticipants),
    };
  };

  const persistProjectState = (nextProject: DiscussionProject, successMessage = t("project.saveMessage")) => {
    if (workspaceMutationLocked) {
      showWorkspaceMessage(sampleReadOnlyLocked ? sampleMutationMessage : t("project.workspaceReadOnly"), "danger");
      return;
    }
    setSaving(true);
    showWorkspaceMessage(null);
    startTransition(async () => {
      try {
        const saved = await saveProjectChanges(savedProject, nextProject, { locale });
        setProject(saved);
        setSavedProject(saved);
        setDirty(false);
        showWorkspaceMessage(successMessage, "success");
        if (settings.knowledgePreferences.autoExtractOnSave) {
          await runKnowledgeExtraction();
        }
      } catch (caught) {
        if (caught instanceof ProjectConflictError && caught.currentProject) {
          setProject(caught.currentProject);
          setSavedProject(caught.currentProject);
          setDirty(false);
        }
        showWorkspaceMessage(caught instanceof Error ? caught.message : t("errors.saveFailed"), "danger");
      } finally {
        setSaving(false);
      }
    });
  };

  const persistRoomNotes = useCallback(async (notes: string[]) => {
    if (workspaceMutationLocked) {
      return;
    }

    if (deepEqual(notes, savedProjectRef.current.room.notes)) {
      return;
    }

    setRoomNotesSaving(true);
    try {
      const nextSavedProject = {
        ...savedProjectRef.current,
        room: {
          ...savedProjectRef.current.room,
          notes,
        },
      };
      const saved = await saveProjectChanges(savedProjectRef.current, nextSavedProject, { locale });
      const mergedProject = mergeIncomingProjectState(savedProjectRef.current, project, saved);
      setProject(mergedProject);
      setSavedProject(saved);
      setDirty(!deepEqual(mergedProject, saved));
    } catch (caught) {
      if (caught instanceof ProjectConflictError && caught.currentProject) {
        setProject(caught.currentProject);
        setSavedProject(caught.currentProject);
        setDirty(false);
      }
      showWorkspaceMessage(caught instanceof Error ? caught.message : t("errors.saveFailed"), "danger");
    } finally {
      setRoomNotesSaving(false);
    }
  }, [locale, project, t, workspaceMutationLocked]);

  const removeParticipant = (participantId: string) => {
    if (protectedSample) {
      showWorkspaceMessage(t("project.sampleProtected"), "danger");
      return;
    }
    if (project.participants.length <= 1) {
      showWorkspaceMessage(t("project.participantsCard.keepOne"), "danger");
      return;
    }

    const target = participantsById.get(participantId);
    if (!target) return;

    const remaining = project.participants.filter((participant) => participant.id !== participantId);
    if (target.collaborationRole === "host" && remaining.length > 0) {
      const replacementIndex = remaining.findIndex((participant) => participant.collaborationRole !== "observer");
      const nextIndex = replacementIndex >= 0 ? replacementIndex : 0;
      remaining[nextIndex] = {
        ...remaining[nextIndex],
        collaborationRole: "host",
        role: remaining[nextIndex].role === "observer" ? "moderator" : remaining[nextIndex].role,
      };
    }

    const ownsTimelineEntries = project.entries.some((entry) => entry.participantId === participantId || entry.ownerParticipantId === participantId);
    if (ownsTimelineEntries) {
      showWorkspaceMessage(t("project.participantsCard.timelineLocked"), "danger");
      return;
    }

    const nextProject = {
      ...withParticipants(remaining),
      updatedAt: new Date().toISOString(),
      nodes: project.nodes.map((node) => node.participantId === participantId ? { ...node, participantId: undefined } : node),
    };

    persistProjectState(nextProject, t("project.participantsCard.removed"));
  };

  const submitCaptureEntries = () => {
    if (sampleReadOnlyLocked) {
      showWorkspaceMessage(sampleMutationMessage, "danger");
      return;
    }
    if (!mutationAccess.canPostMessages) {
      showWorkspaceMessage(mutationAccess.canJoinPublicRoom ? t("project.captureCard.joinBeforeCapture") : t("project.captureCard.captureLocked"), "danger");
      return;
    }
    if (!entryDraft.participantId || !entryDraft.content.trim()) return;
    const parts = entryDraft.split ? splitParagraphs(entryDraft.content) : [entryDraft.content.trim()];
    const tags = parseTags(entryDraft.tags);
    setCaptureSubmitting(true);
    showWorkspaceMessage(null);
    startTransition(async () => {
      try {
        let nextProject = project;
        let persistedProject: DiscussionProject | null = null;
        for (const [index, content] of parts.entries()) {
          const occurredAt = new Date(new Date(entryDraft.occurredAt).getTime() + index * 60_000).toISOString();
          const response = await fetch(`/api/projects/${project.id}/events?locale=${locale}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              type: "message",
              participantId: entryDraft.participantId,
              message: content,
              occurredAt,
              kind: entryDraft.kind,
              tags,
              highlighted: entryDraft.highlighted,
              metadata: { source: "capture" },
            }),
          });
          const payload = await response.json().catch(() => null);
          if (!response.ok) throw new Error(payload?.error ?? t("errors.unexpected"));
          if (payload?.project) {
            persistedProject = payload.project;
            nextProject = payload.project;
          }
        }
        if (!persistedProject) {
          throw new Error(t("errors.unexpected"));
        }
        const mergedProject = dirty
          ? mergeIncomingProjectState(savedProjectRef.current, project, persistedProject)
          : nextProject;
        setProject(mergedProject);
        setSavedProject(persistedProject);
        setDirty(!deepEqual(mergedProject, persistedProject));
        setEntryDraft({
          participantId: entryDraft.participantId,
          occurredAt: toLocalInput(new Date().toISOString()),
          content: "",
          tags: "",
          kind: "statement",
          highlighted: false,
          split: true,
        });
        showWorkspaceMessage(t("project.captureCard.recorded"), "success");
      } catch (caught) {
        showWorkspaceMessage(caught instanceof Error ? caught.message : t("errors.unexpected"), "danger");
      } finally {
        setCaptureSubmitting(false);
      }
    });
  };

  const filteredEntries = useMemo(() => project.entries.filter((entry) => {
    const participant = participantsById.get(entry.participantId);
    const matchesSearch =
      !normalizedSearch ||
      entry.content.toLowerCase().includes(normalizedSearch) ||
      entry.tags.some((tag) => tag.toLowerCase().includes(normalizedSearch)) ||
      participant?.name.toLowerCase().includes(normalizedSearch);
    const matchesSpeaker = speakerFilter === "all" || entry.participantId === speakerFilter;
    const matchesKind = kindFilter === "all" || entry.kind === kindFilter;
    return matchesSearch && matchesSpeaker && matchesKind;
  }), [kindFilter, normalizedSearch, participantsById, project.entries, speakerFilter]);
  const saveProject = () => {
    if (workspaceMutationLocked) {
      showWorkspaceMessage(sampleReadOnlyLocked ? sampleMutationMessage : t("project.workspaceReadOnly"), "danger");
      return;
    }
    persistProjectState(project, t("project.saveMessage"));
  };

  const saveCurrentProjectAsTemplate = () => {
    if (sampleReadOnlyLocked) {
      showWorkspaceMessage(sampleMutationMessage, "danger");
      return;
    }
    if (!access.canRead) {
      showWorkspaceMessage(t("project.workspaceReadOnly"), "danger");
      return;
    }
    setTemplateSaving(true);
    showWorkspaceMessage(null);
    startTransition(async () => {
      try {
        const response = await fetch("/api/project-templates", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectId: project.id,
            title: templateDraftName.trim() || project.title,
            description: templateDraftDescription.trim(),
            visibility: templateDraftVisibility,
          }),
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok) throw new Error(payload?.error ?? t("errors.saveFailed"));
        showWorkspaceMessage(t("project.workspaceSettings.templateSaved"), "success");
      } catch (caught) {
        showWorkspaceMessage(caught instanceof Error ? caught.message : t("errors.saveFailed"), "danger");
      } finally {
        setTemplateSaving(false);
      }
    });
  };

  const deleteProject = () => {
    if (sampleDeletionLocked) {
      showWorkspaceMessage(sampleMutationMessage, "danger");
      return;
    }
    if (workspaceMutationLocked) {
      showWorkspaceMessage(sampleReadOnlyLocked ? sampleMutationMessage : t("project.workspaceReadOnly"), "danger");
      return;
    }
    if (!window.confirm(t("project.deleteConfirm"))) {
      return;
    }
    setDeleting(true);
    showWorkspaceMessage(null);
    startTransition(async () => {
      try {
        const response = await fetch(`/api/projects/${project.id}?locale=${locale}`, { method: "DELETE" });
        const payload = await response.json().catch(() => null);
        if (!response.ok) throw new Error(payload?.error ?? t("errors.deleteFailed"));
        router.push(`/${locale}`);
      } catch (caught) {
        showWorkspaceMessage(caught instanceof Error ? caught.message : t("errors.deleteFailed"), "danger");
      } finally {
        setDeleting(false);
      }
    });
  };

  const toggleArchiveState = () => {
    if (sampleReadOnlyLocked || !canManageArchive) {
      showWorkspaceMessage(sampleReadOnlyLocked ? sampleMutationMessage : t("project.workspaceReadOnly"), "danger");
      return;
    }
    setArchiveUpdating(true);
    showWorkspaceMessage(null);
    startTransition(async () => {
      try {
        const response = await fetch(`/api/projects/${project.id}/archive`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: project.metadata.archivedAt ? "restore" : "archive",
            locale,
          }),
        });
        const payload = (await response.json().catch(() => null)) as { error?: string; project?: DiscussionProject } | null;
        if (!response.ok || !payload?.project) {
          throw new Error(payload?.error ?? t("errors.saveFailed"));
        }
        setProject(payload.project);
        setSavedProject(payload.project);
        setDirty(false);
        showWorkspaceMessage(project.metadata.archivedAt ? `${t("common.restore")} \u2714` : `${t("common.archive")} \u2714`, "success");
      } catch (caught) {
        showWorkspaceMessage(caught instanceof Error ? caught.message : t("errors.saveFailed"), "danger");
      } finally {
        setArchiveUpdating(false);
      }
    });
  };

  const runAiTask = (task: string) => {
    if (sampleReadOnlyLocked) {
      showWorkspaceMessage(sampleMutationMessage, "danger");
      return;
    }
    if (!mutationAccess.canRunAiTasks) {
      showWorkspaceMessage(mutationAccess.canJoinPublicRoom ? t("project.collaborationPanel.joinPublicRoom") : t("project.workspaceAiLocked"), "danger");
      return;
    }
    setTaskBusy(task);
    showWorkspaceMessage(null);
    startTransition(async () => {
      try {
        const response = await fetch(`/api/projects/${project.id}/ai`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ task, locale: project.language }),
        });
        const payload = await response.json().catch(() => null) as {
          error?: string;
          project?: DiscussionProject;
          analysis?: {
            insights: DiscussionProject["insights"];
            summary: DiscussionProject["summary"];
            providerSnapshot: DiscussionProject["providerSnapshot"];
          };
          roomAiConfig?: DiscussionProject["room"]["aiConfig"];
          taskResult?: { message?: string };
        } | null;
        if (!response.ok) throw new Error(payload?.error ?? t("errors.unexpected"));
        if (payload?.project) {
          setProject(payload.project);
          setSavedProject(payload.project);
          setDirty(false);
        } else if (payload?.analysis) {
          const nextProject = {
            ...project,
            insights: payload.analysis.insights,
            summary: payload.analysis.summary,
            providerSnapshot: payload.analysis.providerSnapshot,
            room: payload.roomAiConfig ? { ...project.room, aiConfig: payload.roomAiConfig } : project.room,
          };
          setProject((current) => ({
            ...current,
            insights: payload.analysis!.insights,
            summary: payload.analysis!.summary,
            providerSnapshot: payload.analysis!.providerSnapshot,
            room: payload.roomAiConfig ? { ...current.room, aiConfig: payload.roomAiConfig } : current.room,
          }));
          setSavedProject(nextProject);
          setDirty(false);
        }
        if (settings.knowledgePreferences.autoExtractAfterAiTask) {
          await runKnowledgeExtraction();
        }
        setActiveTab("insights");
        showWorkspaceMessage(t("project.workspaceSettings.taskCompleted"), "success");
      } catch (caught) {
        showWorkspaceMessage(caught instanceof Error ? caught.message : t("errors.unexpected"), "danger");
      } finally {
        setTaskBusy(null);
      }
    });
  };

  const exportPdf = async () => {
    if (pdfExportBusy) return;
    setPdfExportBusy(true);
    showWorkspaceMessage(null);
    try {
      const { exportProjectToPdf } = await import("@/lib/pdf-export");
      await exportProjectToPdf(project, locale);
      showWorkspaceMessage(t("project.workspaceSettings.exportPdfSuccess"), "success");
    } catch (caught) {
      showWorkspaceMessage(caught instanceof Error ? caught.message : t("project.workspaceSettings.exportPdfFailed"), "danger");
    } finally {
      setPdfExportBusy(false);
    }
  };

  const exportUrl = (format: "json" | "txt" | "markdown") => `/api/projects/${project.id}/export?format=${format}&locale=${locale}`;
  const roomHost = findRoomHost(project);
  const roomObservers = getRoomObservers(project);
  const activePresence = getActivePresence(project);
  const roomAiController = useMemo(() => (project.room.aiConfig.ownerParticipantId ? participantsById.get(project.room.aiConfig.ownerParticipantId) : undefined)
    ?? project.participants.find((participant) => participant.profileOwnerId === project.room.aiConfig.ownerIdentityId)
    ?? roomHost
    ?? project.participants[0], [participantsById, project.participants, project.room.aiConfig.ownerIdentityId, project.room.aiConfig.ownerParticipantId, roomHost]);
  const canSyncRoomAiConfig = access.canManageRoom;
  const showPresenceIndicators = settings.collaborationPreferences.showPresenceIndicators;
  const compactTimeline = settings.discussionPreferences.compactTimeline;
  const preferredExportFormat = settings.defaultExportFormat;
  const preferredExportLabel = preferredExportFormat === "markdown"
    ? t("project.workspaceSettings.exportMarkdown")
    : preferredExportFormat === "txt"
      ? t("project.workspaceSettings.exportText")
      : t("project.workspaceSettings.exportJson");
  const secondaryExportFormats = (["markdown", "txt", "json"] as const).filter((format) => format !== preferredExportFormat) as Array<"markdown" | "txt" | "json">;
  const participantEditingDisabled = !access.canManageParticipants;
  const localIdentityId = settings.profile.localIdentityId;
  const isCurrentProfileParticipant = (participant: Participant) => access.ownedParticipantIds.includes(participant.id) || participant.profileOwnerId === localIdentityId;
  const isRemoteProfileParticipant = (participant: Participant) => Boolean(participant.profileOwnerId && participant.profileOwnerId !== localIdentityId);
  const canEditParticipantIdentity = (participant: Participant) => canEditParticipantIdentityAccess(access, participant);
  const canEditParticipantProfileFields = (participant: Participant) => {
    if (isCurrentProfileParticipant(participant)) return true;
    return canEditParticipantIdentityAccess(access, participant);
  };
  const canEditParticipantRoomFields = (participant: Participant) => canEditParticipantRoomMetadata(access, participant);
  const canRemoveParticipant = (participant: Participant) => !isCurrentProfileParticipant(participant) && canRemoveParticipantAccess(project, access, participant);
  const syncRoomAiConfiguration = () => {
    if (!canSyncRoomAiConfig) {
      showWorkspaceMessage(t("project.workspaceSettings.roomAiControllerLocked"), "danger");
      return;
    }

    const ownerParticipantId = access.ownedParticipants.find((participant) => participant.collaborationRole === "host" || participant.role === "moderator")?.id
      ?? roomHost?.id
      ?? access.ownedParticipantIds[0];
    const nextProject = {
      ...project,
      updatedAt: new Date().toISOString(),
      room: {
        ...project.room,
        aiConfig: {
          ...project.room.aiConfig,
          providerId: settings.provider.activeProviderId,
          model: settings.provider.providers[settings.provider.activeProviderId].model,
          ownerIdentityId: settings.profile.localIdentityId,
          ownerParticipantId,
          updatedAt: new Date().toISOString(),
          updatedByParticipantId: ownerParticipantId,
        },
      },
    };

    persistProjectState(nextProject, t("project.workspaceSettings.roomAiConfigSaved"));
  };

  const participantHelpText = (participant: Participant) => {
    if (!access.canManageParticipants && isCurrentProfileParticipant(participant)) return t("project.participantsCard.selfRoomManaged");
    if (!access.canManageParticipants) return t("project.participantsCard.remoteParticipantLocked");
    if (isCurrentProfileParticipant(participant)) return t("project.participantsCard.profileManagedLocal");
    if (isRemoteProfileParticipant(participant)) return t("project.participantsCard.profileManagedRemote");
    if (participant.collaborationRole === "host") return t("project.participantsCard.hostNote");
    return t("project.participantsCard.saveHint");
  };
  const recentCaptureMoments = [...project.entries].slice(-4).reverse();
  const summaryAutomation = normalizeSummaryAutomationConfig(project.room.aiAutomation);
  const summaryHistory = [...(project.summary.history ?? [])].slice().reverse();

  return (
    <div className="space-y-5 animate-fade-up">
      <Panel className="workspace-header-panel space-y-5 p-6 lg:p-8">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="space-y-4 xl:max-w-4xl">
            <div className="flex flex-wrap gap-2">
              <Badge tone="accent">{t(`scenario.${project.scenario}`)}</Badge>
              <Badge>{t(`languages.${project.language}`)}</Badge>
              <Badge>{t(`status.${project.status}`)}</Badge>
              <Badge>{t(`providersCatalog.${wsProviderId}.label`)}</Badge>
              {wsProviderDesc && wsProviderDesc.models.length >= 2 ? (
                <div className="relative">
                  <button type="button" onClick={() => setWsModelMenuOpen((v) => !v)} className="inline-flex items-center gap-1.5 rounded-full border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-3 py-1.5 text-[11px] font-semibold text-[color:var(--foreground)] transition hover:bg-[color:var(--surface-hover)]">
                    <span className="text-[10px] text-[color:var(--muted)]">{t("common.model")}:</span>
                    {wsProviderDesc.models.find((m) => m.id === wsModel)?.label ?? wsModelDisplay}
                    <ChevronDown className={`h-3 w-3 transition ${wsModelMenuOpen ? "rotate-180" : ""}`} />
                  </button>
                  {wsModelMenuOpen ? (
                    <div className="animate-popover-in absolute left-0 top-full z-30 mt-1 w-52 rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-strong)] py-1 shadow-lg">
                      {wsProviderDesc.models.map((m) => (
                        <button key={m.id} type="button" onClick={() => {
                          setWsModelOverride(m.id);
                          setWsModelMenuOpen(false);
                          void patchSettings({ provider: { providers: { [wsProviderId]: { model: m.id } } } }).catch((caught) => {
                            setWsModelOverride(null);
                            showWorkspaceMessage(caught instanceof Error ? caught.message : t("errors.saveFailed"), "danger");
                          });
                        }} className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition hover:bg-[color:var(--surface-hover)] ${m.id === wsModel ? "font-bold text-[color:var(--brand-solid)]" : "text-[color:var(--foreground)]"}`}>
                          <span className="truncate">{m.label}</span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : <Badge>{wsModelDisplay}</Badge>}
              {showPresenceIndicators ? <Badge tone="success">{activePresence.length} {t("projectList.activePresence")}</Badge> : null}
            </div>
            {sampleReadOnlyLocked ? (
              <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-[color:var(--brand-solid)]/20 bg-[color:var(--brand-soft)] px-4 py-3 text-sm leading-6 text-[color:var(--brand-ink)]">
                <Badge tone="accent">{t("project.sampleProtected")}</Badge>
                <span>{t("project.sampleProtectedHint")}</span>
              </div>
            ) : null}
            <input className="w-full rounded-2xl border-none bg-transparent px-0 text-4xl font-semibold tracking-tight outline-none placeholder:text-[color:var(--muted)]" value={project.title} onChange={(event) => patchProject({ ...project, title: event.target.value })} placeholder={t("project.titlePlaceholder")} disabled={workspaceEditingDisabled} />
            <textarea className="min-h-28 w-full rounded-2xl px-4 py-3" value={project.description} onChange={(event) => patchProject({ ...project, description: event.target.value })} placeholder={t("project.descriptionPlaceholder")} disabled={workspaceEditingDisabled} />
          </div>

          <div className="flex flex-wrap gap-3 xl:max-w-md xl:justify-end">
            <Button className="gap-2" onClick={saveProject} disabled={workspaceEditingDisabled || saving}>
              <Save className="h-4 w-4" />
              {saving ? `${t("common.loading")}...` : t("project.workspaceSettings.saveProject")}
            </Button>
            <Button variant="ghost" className="gap-2" onClick={() => runAiTask("summarizeDiscussion")} disabled={!access.canRunAiTasks || taskBusy !== null}>
              <Sparkles className="h-4 w-4" />
              {taskBusy === "summarizeDiscussion" ? `${t("common.loading")}...` : t("project.workspaceSettings.runSummary")}
            </Button>
            {canDeleteWorkspaceProject ? (
              <Button
                variant="danger"
                className="gap-2"
                onClick={deleteProject}
                disabled={deleting || !canDeleteWorkspaceProject}
              >
                <Trash2 className="h-4 w-4" />
                {deleting ? `${t("common.loading")}...` : t("project.deleteProject")}
              </Button>
            ) : null}
            {access.isPublicViewer ? <Badge>{t("project.workspaceViewerBadge")}</Badge> : null}
            {dirty ? <Badge tone="danger">{t("common.unsavedState")}</Badge> : <Badge tone="success">{t("common.savedState")}</Badge>}
          </div>
        </div>

        {projectArchived ? (
          <div className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-4 py-3 text-sm text-[color:var(--muted)]">
            {t("project.workspaceArchivedReadonly")}
          </div>
        ) : null}

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          <label className="space-y-2">
            <span className="text-sm font-medium">{t("project.scenario")}</span>
            <select className="w-full rounded-2xl px-4 py-3" value={project.scenario} onChange={(event) => patchProject({ ...project, scenario: event.target.value as DiscussionProject["scenario"] })} disabled={!access.canManageRoom}>
              <option value="debate">{t("scenario.debate")}</option>
              <option value="discussion">{t("scenario.discussion")}</option>
              <option value="meeting">{t("scenario.meeting")}</option>
              <option value="negotiation">{t("scenario.negotiation")}</option>
              <option value="document-driven-discussion">{t("scenario.document-driven-discussion")}</option>
            </select>
          </label>
          <label className="space-y-2">
            <span className="text-sm font-medium">{t("project.language")}</span>
            <select className="w-full rounded-2xl px-4 py-3" value={project.language} onChange={(event) => patchProject({ ...project, language: event.target.value as AppLocale })} disabled={!access.canManageRoom}>
              {DISPLAY_LOCALE_ORDER.map((item) => (
                <option key={`workspace-language-${item}`} value={item}>{LOCALE_AUTONYMS[item]}</option>
              ))}
            </select>
            <p className="text-xs leading-6 text-[color:var(--muted)]">{t("project.workspaceSettings.languageGuide")}</p>
          </label>
          <div className="space-y-2">
            <span className="text-sm font-medium">{t("project.status")}</span>
            <div className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface-strong)] px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <span className="font-semibold">{t(`status.${project.status}`)}</span>
                <Badge tone={project.status === "completed" ? "success" : project.status === "archived" ? "default" : "accent"}>{t("project.workspaceSettings.statusAutoManaged")}</Badge>
              </div>
            </div>
          </div>
          <label className="space-y-2 md:col-span-2">
            <span className="text-sm font-medium">{t("project.tags")}</span>
            <input className="w-full rounded-2xl px-4 py-3" value={project.tags.join(", ")} onChange={(event) => patchProject({ ...project, tags: parseTags(event.target.value) })} placeholder={t("project.tagsPlaceholder")} disabled={workspaceEditingDisabled} />
            {project.tags.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {project.tags.map((tag) => {
                  const color = settings.tagColors?.[tag];
                  const presets = ["#ef4444", "#f59e0b", "#10b981", "#3b82f6", "#8b5cf6", "#ec4899"];
                  return (
                    <span key={tag} className="group relative inline-flex items-center gap-1 rounded-full border border-[color:var(--border)] px-2.5 py-1 text-xs font-semibold" style={color ? { borderColor: color + "40", backgroundColor: color + "15", color } : undefined}>
                      {tag}
                      <span className="hidden gap-0.5 group-hover:flex">
                        {presets.map((c) => (
                          <button key={c} type="button" className="h-3 w-3 rounded-full border border-white/50" style={{ backgroundColor: c }} onClick={async () => {
                            await patchSettings({ tagColors: { ...settings.tagColors, [tag]: c } });
                            showWorkspaceMessage(t("common.save") + " \u2714", "success");
                          }} />
                        ))}
                      </span>
                    </span>
                  );
                })}
              </div>
            ) : null}
          </label>
        </div>

        <label className="space-y-2">
          <span className="text-sm font-medium">{t("project.goalLabel")}</span>
          <textarea className="min-h-24 w-full rounded-2xl px-4 py-3" value={project.goal} onChange={(event) => patchProject({ ...project, goal: event.target.value, room: { ...project.room, session: { ...project.room.session, goal: event.target.value } } })} placeholder={t("project.goalPlaceholder")} disabled={!access.canManageRoom} />
          <p className="text-xs leading-6 text-[color:var(--muted)]">{t("project.workspaceSettings.goalGuide")}</p>
        </label>

        {message ? <p className={messageTone === "danger" ? "text-sm text-rose-600 dark:text-rose-300" : messageTone === "success" ? "text-sm text-emerald-600 dark:text-emerald-300" : "text-sm text-[color:var(--muted)]"}>{message}</p> : null}
      </Panel>

      <div className="workspace-tabs-shell inline-flex max-w-full flex-col">
        <div className="workspace-tabs soft-scrollbar invisible relative inline-flex w-fit max-w-full flex-nowrap gap-1.5 self-start rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface-strong)]/96 p-1.5 shadow-[0_10px_24px_rgba(var(--shadow-color)/0.08)] backdrop-blur-xl" aria-hidden="true">
          {workspaceTabs.map((tab) => (
            <span key={`tabs-shell-${tab}`} className={`whitespace-nowrap rounded-xl border px-5 py-2.5 text-sm font-semibold ${activeTab === tab ? "border-[color:var(--brand-solid)]/30 bg-[color:var(--brand-solid)] text-white shadow-sm" : "border-transparent bg-transparent text-[color:var(--muted)]"}`}>
              {t(`project.tabs.${tab}`)}
            </span>
          ))}
        </div>
      </div>
      <div
        ref={tabsStickyContainerRef}
        className="workspace-tabs-sticky-layer sticky top-[4.5rem] z-20 self-stretch overflow-x-auto overflow-y-visible md:top-[5.5rem]"
      >
        <div className={`workspace-tabs soft-scrollbar relative inline-flex w-fit max-w-full flex-nowrap gap-1.5 self-start rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface-strong)]/96 p-1.5 shadow-[0_10px_24px_rgba(var(--shadow-color)/0.08)] backdrop-blur-xl transition-[opacity,transform] duration-200 ease-out will-change-transform ${tabsCollapsed ? "pointer-events-none opacity-0 -translate-y-4" : "opacity-100 translate-y-0"}`}>
          {workspaceTabs.map((tab) => (
            <button key={tab} type="button" className={`whitespace-nowrap rounded-xl border px-5 py-2.5 text-sm font-semibold transition-all duration-200 ${activeTab === tab ? "border-[color:var(--brand-solid)]/30 bg-[color:var(--brand-solid)] text-white shadow-sm" : "border-transparent bg-transparent text-[color:var(--muted)] hover:bg-[color:var(--surface-hover)] hover:text-[color:var(--foreground)]"}`} onClick={() => setActiveTab(tab)}>
              {t(`project.tabs.${tab}`)}
            </button>
          ))}
        </div>
      </div>

      {activeTab === "overview" ? (
        <>
          <ProjectCollaborationPanel
            locale={locale}
            project={project}
            syncProject={dirty ? savedProject : project}
            settings={settings}
            onRunAiTask={runAiTask}
            onProjectChange={applyIncomingProject}
            taskBusy={taskBusy}
            sampleReadOnlyLocked={sampleReadOnlyLocked}
          />
          <div className="space-y-5">
              <Panel className="space-y-5">
                <div>
                  <h2 className="font-display text-2xl font-semibold">{t("project.overviewCard.title")}</h2>
                  <p className="mt-1 text-sm text-[color:var(--muted)]">{t("project.overviewCard.subtitle")}</p>
                </div>
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-4"><p className="text-xs uppercase tracking-[0.18em] text-[color:var(--muted)]">{t("project.overviewCard.objective")}</p><p className="mt-2 text-sm leading-6">{project.goal}</p></div>
                  <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-4"><p className="text-xs uppercase tracking-[0.18em] text-[color:var(--muted)]">{t("project.overviewCard.participants")}</p><p className="mt-2 text-2xl font-semibold">{project.participants.length}</p></div>
                  <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-4"><p className="text-xs uppercase tracking-[0.18em] text-[color:var(--muted)]">{t("project.overviewCard.entries")}</p><p className="mt-2 text-2xl font-semibold">{project.entries.length}</p></div>
                  <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-4"><p className="text-xs uppercase tracking-[0.18em] text-[color:var(--muted)]">{t("project.overviewCard.nodes")}</p><p className="mt-2 text-2xl font-semibold">{project.nodes.length}</p></div>
                  <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-4"><p className="text-xs uppercase tracking-[0.18em] text-[color:var(--muted)]">{t("project.overviewCard.relations")}</p><p className="mt-2 text-2xl font-semibold">{project.relations.length}</p></div>
                  <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-4"><p className="text-xs uppercase tracking-[0.18em] text-[color:var(--muted)]">{t("project.roomCard.presence")}</p><p className="mt-2 text-2xl font-semibold">{activePresence.length}</p></div>
                </div>
                <div className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-5 shadow-sm">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="space-y-2">
                      <p className="font-semibold">{t("project.captureCard.recentMoments")}</p>
                      <p className="max-w-2xl text-sm leading-6 text-[color:var(--muted)]">{t("project.captureCard.recentMomentsBody")}</p>
                    </div>
                    <Button variant="ghost" className="gap-2 self-start" onClick={() => setActiveTab("capture")}>
                      <BrainCircuit className="h-4 w-4" />
                      {t("project.captureCard.openSharedRoom")}
                    </Button>
                  </div>
                  {recentCaptureMoments.length === 0 ? (
                    <div className="mt-4 rounded-2xl border border-dashed border-[color:var(--border)] p-4 text-sm text-[color:var(--muted)]">{t("project.captureCard.empty")}</div>
                  ) : (
                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                      {recentCaptureMoments.map((entry) => {
                        const participant = participantsById.get(entry.participantId);
                        const owner = entry.ownerParticipantId ? participantsById.get(entry.ownerParticipantId) : undefined;
                        return (
                          <div key={entry.id} className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)] p-4">
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <p className="font-semibold">{participant?.name ?? t("common.unknown")}</p>
                                <p className="text-xs uppercase tracking-[0.14em] text-[color:var(--muted)]">{t(`entryKinds.${entry.kind}`)}</p>
                              </div>
                              <Badge>{formatDateTime(entry.occurredAt, locale)}</Badge>
                            </div>
                            <p className="mt-3 line-clamp-4 text-sm leading-6 text-[color:var(--foreground)]">{entry.content}</p>
                            <p className="mt-3 text-xs text-[color:var(--muted)]">{owner ? `${t("project.captureCard.ownership")}: ${owner.name}` : t("project.captureCard.source")}</p>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </Panel>

              <Panel className="defer-section space-y-5">
                <div>
                  <h2 className="font-display text-2xl font-semibold">{t("project.participantsCard.title")}</h2>
                  <p className="mt-1 text-sm text-[color:var(--muted)]">{t("project.participantsCard.subtitle")}</p>
                </div>
                {project.participants.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-[color:var(--border)] p-4 text-sm text-[color:var(--muted)]">{t("project.participantsCard.empty")}</div>
                ) : (
                  <div className="space-y-4">
                    {project.participants.map((participant) => {
                      const avatar = resolveParticipantAvatar(participant, settings.profile);
                      const canEditIdentity = canEditParticipantIdentity(participant);
                      const canRemove = canRemoveParticipant(participant);
                      const isCurrentProfile = isCurrentProfileParticipant(participant);
                      const isRemoteProfile = isRemoteProfileParticipant(participant);

                      return (
                        <div key={participant.id} className="contain-paint overflow-hidden rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-4 sm:p-5">
                          <div className="grid gap-3 sm:gap-4 sm:grid-cols-2 lg:grid-cols-[64px_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
                            <Avatar name={participant.name} label={avatar.label} preset={avatar.preset} imageDataUrl={avatar.imageDataUrl} className="h-14 w-14 shrink-0 rounded-2xl text-sm" />
                            <div className="min-w-0 space-y-2">
                              <input className="w-full truncate rounded-2xl px-4 py-3" value={participant.name} onChange={(event) => patchProject(withParticipants(project.participants.map((candidate) => candidate.id === participant.id ? { ...candidate, name: event.target.value, avatarLabel: pickInitials(event.target.value || candidate.name), avatarPreset: candidate.avatarImageDataUrl ? candidate.avatarPreset : deriveAvatarPreset(event.target.value || candidate.name) } : candidate)))} disabled={!canEditIdentity} />
                              <div className="flex flex-wrap gap-2">
                                {isCurrentProfile ? <Badge tone="accent">{t("project.participantsCard.youBadge")}</Badge> : null}
                                {isRemoteProfile ? <Badge>{t("project.participantsCard.remoteProfileBadge")}</Badge> : null}
                              </div>
                            </div>
                            <select className="min-w-0 rounded-2xl px-4 py-3" value={participant.role} onChange={(event) => patchProject(withParticipants(updateParticipantRoster(project.participants, participant.id, (candidate) => ({ ...candidate, role: event.target.value as Participant["role"] }))))} disabled={participantEditingDisabled}>
                              <option value="proponent">{t("roles.proponent")}</option><option value="opponent">{t("roles.opponent")}</option><option value="moderator">{t("roles.moderator")}</option><option value="observer">{t("roles.observer")}</option><option value="speaker">{t("roles.speaker")}</option><option value="custom">{t("roles.custom")}</option>
                            </select>
                            <select className="min-w-0 rounded-2xl px-4 py-3" value={participant.collaborationRole} onChange={(event) => patchProject(withParticipants(updateParticipantRoster(project.participants, participant.id, (candidate) => ({ ...candidate, collaborationRole: event.target.value as CollaborationRole }))))} disabled={participantEditingDisabled}>
                              <option value="host">{t("collaborationRoles.host")}</option><option value="participant">{t("collaborationRoles.participant")}</option><option value="observer">{t("collaborationRoles.observer")}</option><option value="facilitator">{t("collaborationRoles.facilitator")}</option>
                            </select>
                            <div className="flex items-start justify-end gap-2">
                              {showPresenceIndicators ? <Badge tone={toneForPresence(participant.presence.status)}>{t(`presenceStates.${participant.presence.status}`)}</Badge> : null}
                              <Button variant="ghost" className="gap-2" onClick={() => persistProjectState(project, t("project.participantsCard.saved"))} disabled={participantEditingDisabled || saving}>
                                <Save className="h-4 w-4" />
                                {t("project.participantsCard.save")}
                              </Button>
                                <Button variant="danger" onClick={() => canRemove ? removeParticipant(participant.id) : showWorkspaceMessage(t("project.participantsCard.removeLocked"), "danger")} disabled={participantEditingDisabled}>
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>
                          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                            <input className="rounded-2xl px-4 py-3" value={participant.stance} onChange={(event) => patchProject(withParticipants(project.participants.map((candidate) => candidate.id === participant.id ? { ...candidate, stance: event.target.value } : candidate)))} disabled={!canEditParticipantRoomFields(participant)} placeholder={t("project.participantsCard.stance")} />
                            <input className="rounded-2xl px-4 py-3" value={participant.seatLabel ?? ""} onChange={(event) => patchProject(withParticipants(project.participants.map((candidate) => candidate.id === participant.id ? { ...candidate, seatLabel: event.target.value } : candidate)))} disabled={!access.canManageParticipants} placeholder={t("project.participantsCard.seat")} />
                            <div className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface-strong)] px-4 py-3">
                              <div className="flex items-center justify-between gap-3">
                                <span className="text-sm font-medium">{t(`presenceStates.${participant.presence.status}`)}</span>
                                <Badge tone={toneForPresence(participant.presence.status)}>{t("project.workspaceSettings.presenceAutoManaged")}</Badge>
                              </div>
                            </div>
                            <div className="flex items-center gap-3"><input type="color" value={participant.color} onChange={(event) => patchProject(withParticipants(project.participants.map((candidate) => candidate.id === participant.id ? { ...candidate, color: event.target.value } : candidate)))} disabled={!access.canManageParticipants} /><input className="flex-1 rounded-2xl px-4 py-3" value={participant.customRoleLabel ?? ""} onChange={(event) => patchProject(withParticipants(project.participants.map((candidate) => candidate.id === participant.id ? { ...candidate, customRoleLabel: event.target.value || undefined } : candidate)))} disabled={!access.canManageParticipants} placeholder={t("project.participantsCard.customRole")} /></div>
                          </div>
                          <textarea className="mt-3 min-h-20 w-full rounded-2xl px-4 py-3" value={participant.bio} onChange={(event) => patchProject(withParticipants(project.participants.map((candidate) => candidate.id === participant.id ? { ...candidate, bio: event.target.value } : candidate)))} disabled={!canEditParticipantProfileFields(participant)} placeholder={t("project.participantsCard.bio")} />
                          <p className="mt-3 text-xs leading-6 text-[color:var(--muted)]">{participantHelpText(participant)}</p>
                        </div>
                      );
                    })}
                  </div>
                )}
              </Panel>
            </div>

            <div className="space-y-6">
              <Panel className="defer-section space-y-5">
              <div>
                <h2 className="font-display text-2xl font-semibold">{t("project.roomCard.title")}</h2>
                  <p className="mt-1 text-sm text-[color:var(--muted)]">{t("project.roomCard.subtitle")}</p>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-4"><p className="text-xs uppercase tracking-[0.18em] text-[color:var(--muted)]">{t("project.roomCard.sessionStatus")}</p><p className="mt-2 font-semibold">{t(`roomSessionStatus.${project.room.session.status}`)}</p></div>
                  <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-4"><p className="text-xs uppercase tracking-[0.18em] text-[color:var(--muted)]">{t("project.roomCard.visibility")}</p><p className="mt-2 font-semibold">{t(`roomVisibility.${project.room.visibility}`)}</p></div>
                  <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-4"><p className="text-xs uppercase tracking-[0.18em] text-[color:var(--muted)]">{t("project.roomCard.host")}</p><p className="mt-2 font-semibold">{roomHost?.name ?? t("common.none")}</p></div>
                  <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-4"><p className="text-xs uppercase tracking-[0.18em] text-[color:var(--muted)]">{t("project.roomCard.observers")}</p><p className="mt-2 text-sm leading-6">{roomObservers.map((participant) => participant.name).join(", ") || t("common.none")}</p></div>
                  <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-4"><p className="text-xs uppercase tracking-[0.18em] text-[color:var(--muted)]">{t("project.roomCard.latency")}</p><p className="mt-2 font-semibold">{project.room.session.sync.latencyMs} ms</p></div>
                </div>
                <div className="space-y-3">
                  {!showPresenceIndicators ? <div className="rounded-2xl border border-dashed border-[color:var(--border)] p-4 text-sm text-[color:var(--muted)]">{t("project.roomCard.presenceHidden")}</div> : project.room.presence.length === 0 ? <div className="rounded-2xl border border-dashed border-[color:var(--border)] p-4 text-sm text-[color:var(--muted)]">{t("project.roomCard.empty")}</div> : project.room.presence.map((presence) => { const participant = participantsById.get(presence.participantId); const avatar = participant ? resolveParticipantAvatar(participant, settings.profile) : null; return <div key={presence.connectionId} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[color:var(--border)] p-4"><div className="flex items-center gap-3">{avatar ? <Avatar name={participant?.name ?? presence.participantId} label={avatar.label} preset={avatar.preset} imageDataUrl={avatar.imageDataUrl} className="h-11 w-11 rounded-2xl text-xs" /> : null}<div><p className="font-semibold">{participant?.name ?? presence.participantId}</p><p className="text-sm text-[color:var(--muted)]">{t(`collaborationRoles.${presence.collaborationRole}`)} / {presence.deviceLabel}</p></div></div><div className="flex flex-wrap gap-2"><Badge tone={toneForPresence(presence.status)}>{t(`presenceStates.${presence.status}`)}</Badge><Badge>{formatDateTime(presence.lastSeenAt, locale)}</Badge></div></div>; })}
                </div>
              </Panel>
          </div>
        </>
      ) : null}

      {activeTab === "capture" ? (
        <div className="space-y-6">
          <ProjectCollaborationPanel
            locale={locale}
            project={project}
            syncProject={dirty ? savedProject : project}
            settings={settings}
            onRunAiTask={runAiTask}
            onProjectChange={applyIncomingProject}
            taskBusy={taskBusy}
            sampleReadOnlyLocked={sampleReadOnlyLocked}
          />
          <div className="grid gap-5 lg:grid-cols-[minmax(20rem,0.72fr)_minmax(0,1.28fr)]">
            <Panel className="space-y-5 p-6 lg:h-full">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="font-display text-2xl font-semibold">{t("project.captureCard.title")}</h2>
                <p className="mt-1 text-sm text-[color:var(--muted)]">{t("project.captureCard.subtitle")}</p>
              </div>
              <Badge tone={project.room.session.status === "live" ? "success" : "default"}>{project.room.session.status === "live" ? t("roomSessionStatus.live") : t(`roomSessionStatus.${project.room.session.status}`)}</Badge>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-soft)] p-3 text-center">
                <p className="text-2xl font-semibold">{project.participants.length}</p>
                <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[color:var(--muted)]">{t("project.overviewCard.participants")}</p>
              </div>
              <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-soft)] p-3 text-center">
                <p className="text-2xl font-semibold">{project.entries.length}</p>
                <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[color:var(--muted)]">{t("project.overviewCard.entries")}</p>
              </div>
              <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-soft)] p-3 text-center">
                <p className="text-2xl font-semibold">{activePresence.length}</p>
                <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[color:var(--muted)]">{t("projectList.activePresence")}</p>
              </div>
            </div>

            <div className="space-y-4 rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-semibold">{t("project.captureCard.speaker")}</p>
                  {access.messageParticipants.length > 1 ? (
                    <select
                      className="mt-2 w-full rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-strong)] px-3 py-2 text-sm outline-none"
                      value={entryDraft.participantId}
                      onChange={(event) => setEntryDraft({ ...entryDraft, participantId: event.target.value })}
                      disabled={!access.canPostMessages}
                    >
                      {access.messageParticipants.map((participant) => (
                        <option key={participant.id} value={participant.id}>{participant.name}</option>
                      ))}
                    </select>
                  ) : (
                    <p className="mt-0.5 text-sm text-[color:var(--muted)]">{access.messageParticipants[0]?.name ?? t("common.none")}</p>
                  )}
                </div>
                <Button variant="ghost" className="shrink-0" onClick={() => setActiveTab("overview")}>{t("project.captureCard.openSharedRoom")}</Button>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <input type="datetime-local" className="form-field" value={entryDraft.occurredAt} onChange={(event) => setEntryDraft({ ...entryDraft, occurredAt: event.target.value })} disabled={!access.canPostMessages} />
                <select className="form-field" value={entryDraft.kind} onChange={(event) => setEntryDraft({ ...entryDraft, kind: event.target.value as TranscriptEntry["kind"] })} disabled={!access.canPostMessages}>
                  <option value="statement">{t("entryKinds.statement")}</option><option value="question">{t("entryKinds.question")}</option><option value="response">{t("entryKinds.response")}</option><option value="summary">{t("entryKinds.summary")}</option>
                </select>
              </div>

              <textarea className="form-field min-h-32" value={entryDraft.content} onChange={(event) => setEntryDraft({ ...entryDraft, content: event.target.value })} placeholder={t("project.captureCard.contentPlaceholder")} disabled={!access.canPostMessages} />
              <input className="form-field" value={entryDraft.tags} onChange={(event) => setEntryDraft({ ...entryDraft, tags: event.target.value })} placeholder={t("project.captureCard.tags")} disabled={!access.canPostMessages} />

              <div className="flex flex-wrap items-center gap-4">
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={entryDraft.highlighted} onChange={(event) => setEntryDraft({ ...entryDraft, highlighted: event.target.checked })} disabled={!access.canPostMessages} className="accent-[color:var(--brand-solid)]" />{t("project.captureCard.highlighted")}</label>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={entryDraft.split} onChange={(event) => setEntryDraft({ ...entryDraft, split: event.target.checked })} disabled={!access.canPostMessages} className="accent-[color:var(--brand-solid)]" />{t("project.captureCard.splitParagraphs")}</label>
              </div>

              <Button className="w-full" onClick={submitCaptureEntries} disabled={!access.canPostMessages || captureSubmitting || !entryDraft.participantId || !entryDraft.content.trim()}>{captureSubmitting ? `${t("common.loading")}...` : t("project.captureCard.submit")}</Button>
            </div>

            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[color:var(--muted)]">{t("project.captureCard.recentMoments")}</p>
              <div className="mt-3 space-y-2">
                {recentCaptureMoments.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-[color:var(--border)] p-4 text-sm text-[color:var(--muted)]">{t("project.captureCard.empty")}</div>
                ) : recentCaptureMoments.map((entry) => {
                  const participant = participantsById.get(entry.participantId);
                  return (
                    <article key={entry.id} className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-strong)] p-3.5">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-semibold">{participant?.name ?? t("common.none")}</p>
                        <div className="flex items-center gap-2">
                          <Badge>{t(`entryKinds.${entry.kind}`)}</Badge>
                          <span className="text-[10px] text-[color:var(--muted)]">{formatDateTime(entry.occurredAt, locale)}</span>
                        </div>
                      </div>
                      <p className="mt-1.5 line-clamp-3 text-sm leading-6 text-[color:var(--muted)]">{entry.content}</p>
                    </article>
                  );
                })}
              </div>
            </div>
          </Panel>
          <div
            className="lg:max-h-[78rem] lg:min-h-[64rem] xl:max-h-[84rem] xl:min-h-[70rem]"
          >
          <Panel
            className="space-y-0 overflow-hidden p-0 lg:flex lg:h-full lg:flex-col"
          >
            {/* Timeline header */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[color:var(--border)] px-6 py-4">
              <div>
                <h2 className="font-display text-xl font-semibold">{t("project.timelineCard.title")}</h2>
                <p className="mt-0.5 text-xs text-[color:var(--muted)]">{t("project.timelineCard.subtitle")}</p>
              </div>
              <Button variant="ghost" className="text-xs" onClick={() => { setSearch(""); setSpeakerFilter("all"); setKindFilter("all"); }}>{t("project.timelineCard.clearFilters")}</Button>
            </div>
            {/* Filter bar */}
            <div className="flex flex-wrap items-center gap-2 border-b border-[color:var(--border)] bg-[color:var(--surface-muted)]/50 px-6 py-3">
              <input className="flex-1 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-strong)] px-3 py-2 text-sm" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t("project.timelineCard.searchPlaceholder")} />
              <select className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-strong)] px-3 py-2 text-sm" value={speakerFilter} onChange={(event) => setSpeakerFilter(event.target.value)}>
                <option value="all">{t("project.timelineCard.speakerFilter")}</option>
                {project.participants.map((participant) => <option key={participant.id} value={participant.id}>{participant.name}</option>)}
              </select>
              <select className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-strong)] px-3 py-2 text-sm" value={kindFilter} onChange={(event) => setKindFilter(event.target.value)}>
                <option value="all">{t("project.timelineCard.typeFilter")}</option>
                <option value="statement">{t("entryKinds.statement")}</option><option value="question">{t("entryKinds.question")}</option><option value="response">{t("entryKinds.response")}</option><option value="summary">{t("entryKinds.summary")}</option>
              </select>
            </div>
            {/* Timeline entries */}
            <div className="soft-scrollbar min-h-0 flex-1 overflow-y-auto">
              <div className="space-y-0 divide-y divide-[color:var(--border)]">
              {filteredEntries.length === 0 ? <div className="px-6 py-10 text-center text-sm text-[color:var(--muted)]">{t("project.timelineCard.empty")}</div> : filteredEntries.map((entry) => {
                const participant = participantsById.get(entry.participantId);
                return (
                  <article key={entry.id} className="px-6 py-4 transition-colors hover:bg-[color:var(--surface-muted)]/30">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-3">
                        <div className="h-8 w-8 shrink-0 rounded-full bg-[color:var(--brand-soft)] text-center text-xs font-bold leading-8 text-[color:var(--brand-ink)]">{(participant?.name ?? "?")[0]}</div>
                        <div>
                          <p className="text-sm font-semibold">{participant?.name ?? t("common.none")}</p>
                          <p className="text-[11px] text-[color:var(--muted)]">{formatDateTime(entry.occurredAt, locale)}</p>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        <Badge>{t(`entryKinds.${entry.kind}`)}</Badge>
                        <Badge>{t(`sources.${entry.source}`)}</Badge>
                      </div>
                    </div>
                    <p className="mt-2.5 whitespace-pre-wrap rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-soft)] px-4 py-3 text-sm leading-7 text-[color:var(--foreground)]">{entry.content}</p>
                    {entry.tags.length > 0 ? (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {entry.tags.map((tag) => <Badge key={`${entry.id}-${tag}`}>{tag}</Badge>)}
                      </div>
                    ) : null}
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      {entry.highlighted ? <Badge tone="accent">{t("project.captureCard.highlighted")}</Badge> : null}
                      {entry.linkedNodeIds[0] ? (
                        <Button variant="ghost" onClick={() => { const linkedNodeId = entry.linkedNodeIds[0]; if (linkedNodeId) { setFocusNodeId(linkedNodeId); setActiveTab("structure"); } }}>
                          <Link2 className="h-4 w-4" />
                          {t("project.timelineCard.linkJump")}
                        </Button>
                      ) : null}
                    </div>
                    {highlightEnabled && normalizedSearch && entry.content.toLowerCase().includes(normalizedSearch) ? <p className={`mt-3 ${compactTimeline ? "text-xs leading-5" : "text-sm leading-6"} text-[color:var(--muted)]`}>{highlightText(entry.content, deferredSearch)}</p> : null}
                  </article>
                );
              })}
              </div>
            </div>
          </Panel>
          </div>
        </div>
        </div>
      ) : null}

      {activeTab === "structure" ? (
        <div className="space-y-6">
          <Panel className="space-y-5">
            <div>
              <h2 className="font-display text-2xl font-semibold">{t("project.structureCard.title")}</h2>
              <p className="mt-1 text-sm text-[color:var(--muted)]">{t("project.structureCard.subtitle")}</p>
            </div>
            {project.nodes.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-[color:var(--border)] p-6 text-sm text-[color:var(--muted)]">{t("project.structureCard.emptyNodes")}</div>
            ) : (
              <ArgumentGraph nodes={project.nodes} relations={project.relations} activeNodeId={focusNodeId} density={settings.discussionPreferences.graphDensity} />
            )}
          </Panel>

          <div className="grid gap-6 xl:grid-cols-[minmax(0,1.02fr)_minmax(0,0.98fr)]">
            <Panel className="space-y-5">
              <div>
                <h2 className="font-display text-2xl font-semibold">{t("project.structureCard.nodes")}</h2>
                <p className="mt-1 text-sm text-[color:var(--muted)]">{t("project.structureCard.subtitle")}</p>
              </div>
              <div className="space-y-4">
                {project.nodes.length === 0 ? <div className="rounded-2xl border border-dashed border-[color:var(--border)] p-6 text-sm text-[color:var(--muted)]">{t("project.structureCard.emptyNodes")}</div> : project.nodes.map((node) => (
                  <article key={node.id} className={`rounded-2xl border p-4 ${focusNodeId === node.id ? "border-[color:var(--brand-solid)] bg-[color:var(--brand-soft)]" : "border-[color:var(--border)] bg-[color:var(--surface-muted)] "}`}>
                    <div className="grid gap-3 md:grid-cols-2">
                      <input className="rounded-2xl px-4 py-3" value={node.title} onChange={(event) => patchProject({ ...project, nodes: project.nodes.map((candidate) => candidate.id === node.id ? { ...candidate, title: event.target.value } : candidate) })} />
                      <select className="rounded-2xl px-4 py-3" value={node.type} onChange={(event) => patchProject({ ...project, nodes: project.nodes.map((candidate) => candidate.id === node.id ? { ...candidate, type: event.target.value as ArgumentNode["type"] } : candidate) })}>
                        <option value="claim">{t("nodeTypes.claim")}</option><option value="evidence">{t("nodeTypes.evidence")}</option><option value="rebuttal">{t("nodeTypes.rebuttal")}</option><option value="question">{t("nodeTypes.question")}</option><option value="clarification">{t("nodeTypes.clarification")}</option><option value="assumption">{t("nodeTypes.assumption")}</option><option value="conclusion">{t("nodeTypes.conclusion")}</option><option value="actionItem">{t("nodeTypes.actionItem")}</option>
                      </select>
                    </div>
                    <textarea className="mt-3 min-h-24 w-full rounded-2xl px-4 py-3" value={node.description} onChange={(event) => patchProject({ ...project, nodes: project.nodes.map((candidate) => candidate.id === node.id ? { ...candidate, description: event.target.value } : candidate) })} />
                    <div className="mt-3 grid gap-3 md:grid-cols-4">
                      <select className="rounded-2xl px-4 py-3" value={node.participantId ?? ""} onChange={(event) => patchProject({ ...project, nodes: project.nodes.map((candidate) => candidate.id === node.id ? { ...candidate, participantId: event.target.value || undefined } : candidate) })}>
                        <option value="">{t("project.captureCard.speaker")}</option>
                        {project.participants.map((participant) => <option key={participant.id} value={participant.id}>{participant.name}</option>)}
                      </select>
                      <input className="rounded-2xl px-4 py-3" value={node.stance} onChange={(event) => patchProject({ ...project, nodes: project.nodes.map((candidate) => candidate.id === node.id ? { ...candidate, stance: event.target.value } : candidate) })} placeholder={t("project.structureCard.stance")} />
                      <select className="rounded-2xl px-4 py-3" value={String(node.strength)} onChange={(event) => patchProject({ ...project, nodes: project.nodes.map((candidate) => candidate.id === node.id ? { ...candidate, strength: Number(event.target.value) } : candidate) })}>{[1, 2, 3, 4, 5].map((value) => <option key={value} value={value}>{value}</option>)}</select>
                      <select className="rounded-2xl px-4 py-3" value={node.status} onChange={(event) => patchProject({ ...project, nodes: project.nodes.map((candidate) => candidate.id === node.id ? { ...candidate, status: event.target.value as ArgumentNode["status"] } : candidate) })}><option value="open">{t("nodeStatus.open")}</option><option value="resolved">{t("nodeStatus.resolved")}</option><option value="contested">{t("nodeStatus.contested")}</option></select>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      {node.entryIds.map((entryId) => <Badge key={entryId}>{entryId}</Badge>)}
                      <Button variant="danger" onClick={() => patchProject({ ...project, nodes: project.nodes.filter((candidate) => candidate.id !== node.id), relations: project.relations.filter((relation) => relation.sourceNodeId !== node.id && relation.targetNodeId !== node.id), entries: project.entries.map((entry) => ({ ...entry, linkedNodeIds: entry.linkedNodeIds.filter((id) => id !== node.id) })) })}><Trash2 className="h-4 w-4" /></Button>
                    </div>
                  </article>
                ))}
              </div>
            </Panel>

            <div className="space-y-6">
              <Panel className="space-y-5">
                <div>
                  <h2 className="font-display text-2xl font-semibold">{t("project.structureCard.addNode")}</h2>
                </div>
                <div className="space-y-4">
                  <input className="w-full rounded-2xl px-4 py-3" value={nodeDraft.title} onChange={(event) => setNodeDraft({ ...nodeDraft, title: event.target.value })} placeholder={t("project.structureCard.nodeTitle")} />
                  <textarea className="min-h-24 w-full rounded-2xl px-4 py-3" value={nodeDraft.description} onChange={(event) => setNodeDraft({ ...nodeDraft, description: event.target.value })} placeholder={t("project.structureCard.nodeDescription")} />
                  <div className="grid gap-3 md:grid-cols-2">
                    <select className="rounded-2xl px-4 py-3" value={nodeDraft.type} onChange={(event) => setNodeDraft({ ...nodeDraft, type: event.target.value as ArgumentNode["type"] })}><option value="claim">{t("nodeTypes.claim")}</option><option value="evidence">{t("nodeTypes.evidence")}</option><option value="rebuttal">{t("nodeTypes.rebuttal")}</option><option value="question">{t("nodeTypes.question")}</option><option value="clarification">{t("nodeTypes.clarification")}</option><option value="assumption">{t("nodeTypes.assumption")}</option><option value="conclusion">{t("nodeTypes.conclusion")}</option><option value="actionItem">{t("nodeTypes.actionItem")}</option></select>
                    <select className="rounded-2xl px-4 py-3" value={nodeDraft.participantId} onChange={(event) => setNodeDraft({ ...nodeDraft, participantId: event.target.value })}><option value="">{t("project.captureCard.speaker")}</option>{project.participants.map((participant) => <option key={participant.id} value={participant.id}>{participant.name}</option>)}</select>
                  </div>
                  <div className="grid gap-3 md:grid-cols-3">
                    <input className="rounded-2xl px-4 py-3" value={nodeDraft.stance} onChange={(event) => setNodeDraft({ ...nodeDraft, stance: event.target.value })} placeholder={t("project.structureCard.stance")} />
                    <select className="rounded-2xl px-4 py-3" value={String(nodeDraft.strength)} onChange={(event) => setNodeDraft({ ...nodeDraft, strength: Number(event.target.value) })}>{[1, 2, 3, 4, 5].map((value) => <option key={value} value={value}>{value}</option>)}</select>
                    <select className="rounded-2xl px-4 py-3" value={nodeDraft.status} onChange={(event) => setNodeDraft({ ...nodeDraft, status: event.target.value as ArgumentNode["status"] })}><option value="open">{t("nodeStatus.open")}</option><option value="resolved">{t("nodeStatus.resolved")}</option><option value="contested">{t("nodeStatus.contested")}</option></select>
                  </div>
                  <select multiple className="min-h-28 w-full rounded-2xl px-4 py-3" value={nodeDraft.entryIds} onChange={(event) => setNodeDraft({ ...nodeDraft, entryIds: [...event.currentTarget.selectedOptions].map((option) => option.value) })}>
                    {project.entries.map((entry) => <option key={entry.id} value={entry.id}>{entry.content.slice(0, 80)}</option>)}
                  </select>
                  <Button onClick={() => {
                    if (!nodeDraft.title.trim()) return;
                    const node: ArgumentNode = { id: createId("node"), title: nodeDraft.title.trim(), description: nodeDraft.description.trim(), type: nodeDraft.type, participantId: nodeDraft.participantId || undefined, entryIds: nodeDraft.entryIds, stance: nodeDraft.stance.trim(), strength: nodeDraft.strength, status: nodeDraft.status };
                    patchProject({ ...project, nodes: [...project.nodes, node], entries: project.entries.map((entry) => node.entryIds.includes(entry.id) ? { ...entry, linkedNodeIds: [...new Set([...entry.linkedNodeIds, node.id])] } : entry) });
                    setNodeDraft({ title: "", description: "", type: "claim", participantId: "", strength: 3, status: "open", stance: "", entryIds: [] });
                  }}>{t("project.structureCard.addNode")}</Button>
                </div>
              </Panel>

              <Panel className="space-y-5">
                <div>
                  <h2 className="font-display text-2xl font-semibold">{t("project.structureCard.relations")}</h2>
                </div>
                <div className="space-y-4">
                  {project.relations.length === 0 ? <div className="rounded-2xl border border-dashed border-[color:var(--border)] p-6 text-sm text-[color:var(--muted)]">{t("project.structureCard.emptyRelations")}</div> : project.relations.map((relation) => (
                    <div key={relation.id} className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-5 ">
                      <div className="grid gap-3 md:grid-cols-2">
                        <select className="rounded-2xl px-4 py-3" value={relation.sourceNodeId} onChange={(event) => patchProject({ ...project, relations: project.relations.map((candidate) => candidate.id === relation.id ? { ...candidate, sourceNodeId: event.target.value } : candidate) })}>{project.nodes.map((node) => <option key={node.id} value={node.id}>{node.title}</option>)}</select>
                        <select className="rounded-2xl px-4 py-3" value={relation.targetNodeId} onChange={(event) => patchProject({ ...project, relations: project.relations.map((candidate) => candidate.id === relation.id ? { ...candidate, targetNodeId: event.target.value } : candidate) })}>{project.nodes.map((node) => <option key={node.id} value={node.id}>{node.title}</option>)}</select>
                        <select className="rounded-2xl px-4 py-3" value={relation.type} onChange={(event) => patchProject({ ...project, relations: project.relations.map((candidate) => candidate.id === relation.id ? { ...candidate, type: event.target.value as ArgumentRelation["type"] } : candidate) })}><option value="supports">{t("relationTypes.supports")}</option><option value="rebuts">{t("relationTypes.rebuts")}</option><option value="responds_to">{t("relationTypes.responds_to")}</option><option value="asks">{t("relationTypes.asks")}</option><option value="clarifies">{t("relationTypes.clarifies")}</option><option value="concludes">{t("relationTypes.concludes")}</option><option value="references">{t("relationTypes.references")}</option></select>
                        <Button variant="danger" onClick={() => patchProject({ ...project, relations: project.relations.filter((candidate) => candidate.id !== relation.id) })}><Trash2 className="h-4 w-4" /></Button>
                      </div>
                      <textarea className="mt-3 min-h-20 w-full rounded-2xl px-4 py-3" value={relation.note} onChange={(event) => patchProject({ ...project, relations: project.relations.map((candidate) => candidate.id === relation.id ? { ...candidate, note: event.target.value } : candidate) })} placeholder={t("project.structureCard.relationNote")} />
                    </div>
                  ))}
                  <div className="rounded-2xl border border-dashed border-[color:var(--border)] p-4">
                    <div className="grid gap-3">
                      <select className="rounded-2xl px-4 py-3" value={relationDraft.sourceNodeId} onChange={(event) => setRelationDraft({ ...relationDraft, sourceNodeId: event.target.value })}><option value="">{t("project.structureCard.sourceNode")}</option>{project.nodes.map((node) => <option key={node.id} value={node.id}>{node.title}</option>)}</select>
                      <select className="rounded-2xl px-4 py-3" value={relationDraft.targetNodeId} onChange={(event) => setRelationDraft({ ...relationDraft, targetNodeId: event.target.value })}><option value="">{t("project.structureCard.targetNode")}</option>{project.nodes.map((node) => <option key={node.id} value={node.id}>{node.title}</option>)}</select>
                      <select className="rounded-2xl px-4 py-3" value={relationDraft.type} onChange={(event) => setRelationDraft({ ...relationDraft, type: event.target.value as ArgumentRelation["type"] })}><option value="supports">{t("relationTypes.supports")}</option><option value="rebuts">{t("relationTypes.rebuts")}</option><option value="responds_to">{t("relationTypes.responds_to")}</option><option value="asks">{t("relationTypes.asks")}</option><option value="clarifies">{t("relationTypes.clarifies")}</option><option value="concludes">{t("relationTypes.concludes")}</option><option value="references">{t("relationTypes.references")}</option></select>
                      <textarea className="min-h-20 rounded-2xl px-4 py-3" value={relationDraft.note} onChange={(event) => setRelationDraft({ ...relationDraft, note: event.target.value })} placeholder={t("project.structureCard.relationNote")} />
                      <Button onClick={() => { if (!relationDraft.sourceNodeId || !relationDraft.targetNodeId) return; patchProject({ ...project, relations: [...project.relations, { id: createId("relation"), sourceNodeId: relationDraft.sourceNodeId, targetNodeId: relationDraft.targetNodeId, type: relationDraft.type, note: relationDraft.note.trim() }] }); setRelationDraft({ sourceNodeId: "", targetNodeId: "", type: "supports", note: "" }); }}>{t("project.structureCard.addRelation")}</Button>
                    </div>
                  </div>
                </div>
              </Panel>
            </div>
          </div>
        </div>
      ) : null}

      {activeTab === "knowledge" ? (
        <ProjectKnowledgePanel locale={locale} project={project} />
      ) : null}

      {activeTab === "insights" ? (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,0.94fr)_minmax(0,1.06fr)]">
          <Panel className="space-y-5">
            <div>
              <h2 className="font-display text-2xl font-semibold">{t("project.insightsCard.title")}</h2>
              <p className="mt-1 text-sm text-[color:var(--muted)]">{t("project.insightsCard.subtitle")}</p>
            </div>
            <div className="space-y-4">
              {project.insights.items.length === 0 ? <div className="rounded-2xl border border-dashed border-[color:var(--border)] p-6 text-sm text-[color:var(--muted)]">{t("project.insightsCard.empty")}</div> : project.insights.items.map((item) => (
                <article key={item.id} className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-5 ">
                  <div className="flex flex-wrap gap-2"><Badge tone={item.status === "resolved" ? "success" : item.severity === 3 ? "danger" : "accent"}>{t(`insightCategories.${item.category}`)}</Badge><Badge>{t(`insightStatus.${item.status}`)}</Badge><Badge>{`P${item.severity}`}</Badge></div>
                  <h3 className="mt-3 text-lg font-semibold">{item.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-[color:var(--muted)]">{item.detail}</p>
                  {item.relatedNodeIds.length > 0 ? <div className="mt-3 flex flex-wrap gap-2">{item.relatedNodeIds.map((nodeId) => { const node = nodesById.get(nodeId); if (!node) return null; return <button key={nodeId} type="button" className="rounded-full bg-[color:var(--surface-muted)] px-3 py-2 text-xs font-semibold" onClick={() => { setFocusNodeId(nodeId); setActiveTab("structure"); }}>{node.title}</button>; })}</div> : null}
                </article>
              ))}
            </div>
          </Panel>

          <Panel className="defer-section space-y-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2 className="font-display text-2xl font-semibold">{t("project.summaryCard.title")}</h2>
                <p className="mt-1 text-sm text-[color:var(--muted)]">{t("project.summaryCard.subtitle")}</p>
              </div>
              <div className="flex flex-wrap gap-2"><Badge tone="accent">{project.summary.evaluation.confidence}</Badge><Badge>{t(`providersCatalog.${project.providerSnapshot.providerId}.label`)}</Badge></div>
            </div>
            <div className="grid gap-5 lg:grid-cols-2">
              <section className="rounded-2xl border border-[color:var(--border)] p-4"><h3 className="font-semibold">{t("project.summaryCard.overview")}</h3><p className="mt-2 text-sm leading-6 text-[color:var(--muted)]">{project.summary.overview}</p></section>
              <section className="rounded-2xl border border-[color:var(--border)] p-4"><h3 className="font-semibold">{t("project.summaryCard.participants")}</h3><ul className="mt-2 space-y-2 text-sm leading-6 text-[color:var(--muted)]">{project.summary.participantOverview.map((item) => <li key={item}>{item}</li>)}</ul></section>
              <section className="rounded-2xl border border-[color:var(--border)] p-4"><h3 className="font-semibold">{t("project.summaryCard.topics")}</h3><ul className="mt-2 space-y-2 text-sm leading-6 text-[color:var(--muted)]">{project.summary.coreTopics.map((item) => <li key={item}>{item}</li>)}</ul></section>
              <section className="rounded-2xl border border-[color:var(--border)] p-4"><h3 className="font-semibold">{t("project.summaryCard.claims")}</h3><ul className="mt-2 space-y-2 text-sm leading-6 text-[color:var(--muted)]">{project.summary.majorClaims.map((item) => <li key={item}>{item}</li>)}</ul></section>
              <section className="rounded-2xl border border-[color:var(--border)] p-4"><h3 className="font-semibold">{t("project.summaryCard.evidence")}</h3><ul className="mt-2 space-y-2 text-sm leading-6 text-[color:var(--muted)]">{project.summary.keyEvidence.map((item) => <li key={item}>{item}</li>)}</ul></section>
              <section className="rounded-2xl border border-[color:var(--border)] p-4"><h3 className="font-semibold">{t("project.summaryCard.rebuttals")}</h3><ul className="mt-2 space-y-2 text-sm leading-6 text-[color:var(--muted)]">{project.summary.majorRebuttals.map((item) => <li key={item}>{item}</li>)}</ul></section>
              <section className="rounded-2xl border border-[color:var(--border)] p-4"><h3 className="font-semibold">{t("project.summaryCard.disputes")}</h3><ul className="mt-2 space-y-2 text-sm leading-6 text-[color:var(--muted)]">{project.summary.disputes.map((item) => <li key={item}>{item}</li>)}</ul></section>
              <section className="rounded-2xl border border-[color:var(--border)] p-4"><h3 className="font-semibold">{t("project.summaryCard.unresolved")}</h3><ul className="mt-2 space-y-2 text-sm leading-6 text-[color:var(--muted)]">{project.summary.unresolvedQuestions.map((item) => <li key={item}>{item}</li>)}</ul></section>
            </div>
            <section className="rounded-2xl border border-[color:var(--border)] p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="font-semibold">{t("project.summaryHistory.title")}</h3>
                  <p className="mt-1 text-xs leading-5 text-[color:var(--muted)]">{t("project.summaryHistory.hint")}</p>
                </div>
                <Badge tone={summaryAutomation.mode === "off" ? "default" : "accent"}>
                  {t(`roomAi.mode${summaryAutomation.mode.charAt(0).toUpperCase()}${summaryAutomation.mode.slice(1)}`)}
                </Badge>
              </div>
              {summaryHistory.length === 0 ? (
                <div className="mt-4 rounded-2xl border border-dashed border-[color:var(--border)] p-4 text-sm text-[color:var(--muted)]">{t("project.summaryHistory.empty")}</div>
              ) : (
                <div className="mt-4 space-y-3">
                  {summaryHistory.map((entry) => (
                    <article key={entry.id} className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone={entry.trigger === "manual" ? "success" : "accent"}>{t(`project.summaryHistory.trigger.${entry.trigger}`)}</Badge>
                        <Badge>{`${t("common.provider")}: ${t(`providersCatalog.${entry.providerId}.label`)}`}</Badge>
                        <Badge>{entry.model}</Badge>
                        {typeof entry.thresholdUsed === "number" ? <Badge>{`${t("project.summaryHistory.thresholdUsed")} ${entry.thresholdUsed}`}</Badge> : null}
                        {typeof entry.nextThreshold === "number" ? <Badge>{`${t("project.summaryHistory.nextThreshold")} ${entry.nextThreshold}`}</Badge> : null}
                      </div>
                      <p className="mt-3 text-sm leading-6 text-[color:var(--muted)]">{entry.overview}</p>
                      {entry.currentConclusion ? <p className="mt-3 text-xs font-semibold text-[color:var(--foreground)]">{entry.currentConclusion}</p> : null}
                      {entry.nextSteps.length > 0 ? <ul className="mt-3 space-y-1 text-xs leading-5 text-[color:var(--muted)]">{entry.nextSteps.map((item) => <li key={`${entry.id}-${item}`}>{item}</li>)}</ul> : null}
                      <p className="mt-3 text-[11px] text-[color:var(--muted)]">{formatDateTime(entry.createdAt, locale)}</p>
                    </article>
                  ))}
                </div>
              )}
            </section>
            <section className="rounded-2xl border border-[color:var(--border)] p-4">
              <h3 className="font-semibold">{t("project.summaryCard.evaluation")}</h3>
              <div className="mt-4 grid gap-4 lg:grid-cols-2">
                <div className="rounded-2xl bg-[color:var(--surface-muted)] p-5"><p className="text-xs uppercase tracking-[0.18em] text-[color:var(--muted)]">{t("project.summaryCard.leaning")}</p><p className="mt-2 text-lg font-semibold">{project.summary.evaluation.leaning}</p></div>
                <div className="rounded-2xl bg-[color:var(--surface-muted)] p-5"><p className="text-xs uppercase tracking-[0.18em] text-[color:var(--muted)]">{t("project.summaryCard.favoredByEvidence")}</p><p className="mt-2 text-lg font-semibold">{project.summary.evaluation.favoredByEvidence}</p></div>
                <div className="rounded-2xl bg-[color:var(--surface-muted)] p-5"><p className="text-xs uppercase tracking-[0.18em] text-[color:var(--muted)]">{t("project.summaryCard.favoredByResponsiveness")}</p><p className="mt-2 text-lg font-semibold">{project.summary.evaluation.favoredByResponsiveness}</p></div>
                <div className="rounded-2xl bg-[color:var(--surface-muted)] p-5"><p className="text-xs uppercase tracking-[0.18em] text-[color:var(--muted)]">{t("project.summaryCard.favoredByLogic")}</p><p className="mt-2 text-lg font-semibold">{project.summary.evaluation.favoredByLogic}</p></div>
              </div>
              <div className="mt-4 grid gap-4 lg:grid-cols-2">
                <div><h4 className="font-semibold">{t("project.summaryCard.reasons")}</h4><ul className="mt-2 space-y-2 text-sm leading-6 text-[color:var(--muted)]">{project.summary.evaluation.reasons.map((item) => <li key={item}>{item}</li>)}</ul></div>
                <div><h4 className="font-semibold">{t("project.summaryCard.suggestions")}</h4><ul className="mt-2 space-y-2 text-sm leading-6 text-[color:var(--muted)]">{project.summary.evaluation.improvementSuggestions.map((item) => <li key={item}>{item}</li>)}</ul></div>
              </div>
              <div className="mt-4 grid gap-4 lg:grid-cols-2">
                <div><h4 className="font-semibold">{t("project.summaryCard.followupQuestions")}</h4><ul className="mt-2 space-y-2 text-sm leading-6 text-[color:var(--muted)]">{project.summary.followupQuestions.map((item) => <li key={item}>{item}</li>)}</ul></div>
                <div><h4 className="font-semibold">{t("project.summaryCard.nextSteps")}</h4><ul className="mt-2 space-y-2 text-sm leading-6 text-[color:var(--muted)]">{project.summary.nextSteps.map((item) => <li key={item}>{item}</li>)}</ul></div>
              </div>
            </section>
          </Panel>
          </div>
      ) : null}

      {activeTab === "settings" ? (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,0.96fr)_minmax(0,1.04fr)]">
          <Panel className="space-y-5">
            <div>
              <h2 className="font-display text-2xl font-semibold">{t("project.workspaceSettings.title")}</h2>
              <p className="mt-1 text-sm text-[color:var(--muted)]">{t("project.workspaceSettings.subtitle")}</p>
            </div>
            <div className="grid gap-3">
              <Button className="justify-center gap-2" onClick={saveProject} disabled={workspaceEditingDisabled || saving}><Save className="h-4 w-4" />{t("project.workspaceSettings.saveProject")}</Button>
              <Button variant="ghost" className="justify-center gap-2" title={t("project.workspaceSettings.runSummaryHint")} onClick={() => runAiTask("summarizeDiscussion")} disabled={!access.canRunAiTasks || taskBusy !== null}><BrainCircuit className="h-4 w-4" />{t("project.workspaceSettings.runSummary")}</Button>
              <Button variant="ghost" className="justify-center gap-2" title={t("project.workspaceSettings.runEvaluationHint")} onClick={() => runAiTask("evaluateDiscussion")} disabled={!access.canRunAiTasks || taskBusy !== null}><Sparkles className="h-4 w-4" />{t("project.workspaceSettings.runEvaluation")}</Button>
              <Button variant="ghost" className="justify-center gap-2" title={t("project.workspaceSettings.runFollowupHint")} onClick={() => runAiTask("generateFollowupQuestions")} disabled={!access.canRunAiTasks || taskBusy !== null}><Link2 className="h-4 w-4" />{t("project.workspaceSettings.runFollowup")}</Button>
              <a href={exportUrl(preferredExportFormat)} className="inline-flex items-center justify-center rounded-2xl border border-[color:var(--brand-solid)] bg-[color:var(--brand-soft)] px-4 py-3 text-sm font-semibold text-[color:var(--brand-ink)] transition hover:brightness-[1.01]">{preferredExportLabel}</a>
              {secondaryExportFormats.map((format) => <a key={format} href={exportUrl(format)} className="inline-flex items-center justify-center rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-4 py-3 text-sm font-semibold transition-all duration-200 hover:bg-[color:var(--surface-hover)] hover:shadow-[0_4px_12px_rgba(var(--shadow-color)/0.06)] active:scale-[0.98]">{format === "markdown" ? t("project.workspaceSettings.exportMarkdown") : format === "txt" ? t("project.workspaceSettings.exportText") : t("project.workspaceSettings.exportJson")}</a>)}
              <Link prefetch={false} href={`/${locale}/projects/${project.id}/report`} className="inline-flex items-center justify-center rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-4 py-3 text-sm font-semibold transition-all duration-200 hover:bg-[color:var(--surface-hover)] hover:shadow-[0_4px_12px_rgba(var(--shadow-color)/0.06)] active:scale-[0.98]">{t("project.workspaceSettings.printReport")}</Link>
              <button type="button" onClick={() => void exportPdf()} disabled={pdfExportBusy} className="inline-flex items-center justify-center rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-4 py-3 text-sm font-semibold transition-all duration-200 hover:bg-[color:var(--surface-hover)] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60">{pdfExportBusy ? `${t("common.loading")}...` : t("project.workspaceSettings.exportPdf")}</button>
              <div className="grid gap-3 rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-4">
                <div>
                  <p className="text-sm font-semibold">{t("project.workspaceSettings.saveAsTemplate")}</p>
                  <p className="mt-1 text-xs leading-5 text-[color:var(--muted)]">{t("project.workspaceSettings.templateSaveHint")}</p>
                </div>
                <label className="space-y-1.5">
                  <span className="text-xs font-medium text-[color:var(--muted)]">{t("newProject.templateNamePrompt")}</span>
                  <input className="w-full rounded-xl px-3 py-2 text-sm" value={templateDraftName} onChange={(event) => setTemplateDraftName(event.target.value)} />
                </label>
                <label className="space-y-1.5">
                  <span className="text-xs font-medium text-[color:var(--muted)]">{t("newProject.templateDescriptionPrompt")}</span>
                  <textarea className="min-h-20 w-full rounded-xl px-3 py-2 text-sm" value={templateDraftDescription} onChange={(event) => setTemplateDraftDescription(event.target.value)} />
                </label>
                <label className="space-y-1.5">
                  <span className="text-xs font-medium text-[color:var(--muted)]">{t("newProject.templateVisibility")}</span>
                  <select className="w-full rounded-xl px-3 py-2 text-sm" value={templateDraftVisibility} onChange={(event) => setTemplateDraftVisibility(event.target.value as ProjectTemplateVisibility)}>
                    <option value="private">{t("newProject.templatePrivate")}</option>
                    <option value="shared">{t("newProject.templateShared")}</option>
                  </select>
                </label>
                <Button variant="ghost" className="justify-center gap-2" onClick={saveCurrentProjectAsTemplate} disabled={templateSaving}>
                  {templateSaving ? `${t("common.loading")}...` : t("project.workspaceSettings.saveAsTemplate")}
                </Button>
              </div>
              {canManageArchive ? (
                <Button
                  variant="ghost"
                  className="justify-center gap-2"
                  onClick={toggleArchiveState}
                  disabled={archiveUpdating || !canManageArchive}
                >
                  {project.metadata.archivedAt ? t("common.restore") : t("common.archive")}
                </Button>
              ) : null}
              {canDeleteWorkspaceProject ? (
                <Button
                  variant="danger"
                  className="justify-center gap-2"
                  onClick={deleteProject}
                  disabled={deleting || !canDeleteWorkspaceProject}
                >
                  <Trash2 className="h-4 w-4" />
                  {deleting ? `${t("common.loading")}...` : t("project.deleteProject")}
                </Button>
              ) : null}
            </div>
          </Panel>

          <div className="space-y-6">
            <Panel className="space-y-5">
              <div>
                <h2 className="font-display text-2xl font-semibold">{t("project.workspaceSettings.providerTitle")}</h2>
                <p className="mt-1 text-sm text-[color:var(--muted)]">{t("project.workspaceSettings.providerSubtitle")}</p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="rounded-2xl border border-[color:var(--border)] p-4"><p className="text-xs uppercase tracking-[0.18em] text-[color:var(--muted)]">{t("common.provider")}</p><p className="mt-2 text-lg font-semibold">{t(`providersCatalog.${project.providerSnapshot.providerId}.label`)}</p></div>
                <div className="rounded-2xl border border-[color:var(--border)] p-4"><p className="text-xs uppercase tracking-[0.18em] text-[color:var(--muted)]">{t("common.model")}</p><p className="mt-2 text-lg font-semibold">{project.providerSnapshot.model}</p></div>
                <div className="rounded-2xl border border-[color:var(--border)] p-4"><p className="text-xs uppercase tracking-[0.18em] text-[color:var(--muted)]">{t("project.workspaceSettings.generated")}</p><p className="mt-2 text-lg font-semibold">{formatDateTime(project.providerSnapshot.generatedAt, locale)}</p></div>
                <div className="rounded-2xl border border-[color:var(--border)] p-4"><p className="text-xs uppercase tracking-[0.18em] text-[color:var(--muted)]">{t("project.workspaceSettings.version")}</p><p className="mt-2 text-lg font-semibold">{project.providerSnapshot.version}</p></div>
              </div>
              <div className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-[0.18em] text-[color:var(--muted)]">{t("project.workspaceSettings.roomAiTitle")}</p>
                    <p className="mt-2 text-sm leading-6 text-[color:var(--muted)]">{t("project.workspaceSettings.roomAiSubtitle")}</p>
                  </div>
                  <Badge tone="accent">{t(`providersCatalog.${project.room.aiConfig.providerId}.label`)}</Badge>
                </div>
                <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                  <div className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface-strong)] p-4"><p className="text-xs uppercase tracking-[0.18em] text-[color:var(--muted)]">{t("common.provider")}</p><p className="mt-2 text-lg font-semibold">{t(`providersCatalog.${project.room.aiConfig.providerId}.label`)}</p></div>
                  <div className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface-strong)] p-4"><p className="text-xs uppercase tracking-[0.18em] text-[color:var(--muted)]">{t("common.model")}</p><p className="mt-2 text-lg font-semibold break-all">{project.room.aiConfig.model}</p></div>
                  <div className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface-strong)] p-4"><p className="text-xs uppercase tracking-[0.18em] text-[color:var(--muted)]">{t("project.workspaceSettings.roomAiController")}</p><p className="mt-2 text-lg font-semibold">{roomAiController?.name ?? t("common.none")}</p></div>
                  <div className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface-strong)] p-4"><p className="text-xs uppercase tracking-[0.18em] text-[color:var(--muted)]">{t("project.workspaceSettings.roomAiUpdated")}</p><p className="mt-2 text-lg font-semibold">{formatDateTime(project.room.aiConfig.updatedAt, locale)}</p></div>
                </div>
                <p className="mt-4 text-sm leading-6 text-[color:var(--muted)]">{roomAiController && isCurrentProfileParticipant(roomAiController) ? t("project.workspaceSettings.roomAiUsingLocalProfile") : t("project.workspaceSettings.roomAiUsingHostProfile", { name: roomAiController?.name ?? t("common.none") })}</p>
                {canSyncRoomAiConfig ? (
                  <div className="mt-4 flex flex-wrap gap-3">
                    <Button variant="ghost" className="gap-2" onClick={syncRoomAiConfiguration}><BrainCircuit className="h-4 w-4" />{t("project.workspaceSettings.useCurrentProviderForRoom")}</Button>
                    <Badge>{t(`providersCatalog.${settings.provider.activeProviderId}.label`)}</Badge>
                    <Badge>{settings.provider.providers[settings.provider.activeProviderId].model}</Badge>
                  </div>
                ) : (
                  <p className="mt-4 text-xs leading-6 text-[color:var(--muted)]">{t("project.workspaceSettings.roomAiControllerLocked")}</p>
                )}
              </div>
            </Panel>

            <Panel className="space-y-4">
              <div>
                <h2 className="font-display text-lg font-semibold">{t("project.linkedProjects")}</h2>
                <p className="mt-0.5 text-xs text-[color:var(--muted)]">{t("project.linkedProjectsHint")}</p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {(project.linkedProjectIds ?? []).length === 0 ? (
                  <p className="text-xs text-[color:var(--muted)]">{t("project.noLinkedProjects")}</p>
                ) : (project.linkedProjectIds ?? []).map((pid) => (
                  <span key={pid} className="inline-flex items-center gap-1.5 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-2.5 py-1.5 text-xs font-semibold">
                    {pid.slice(0, 20)}
                    <button type="button" className="text-red-500 hover:text-red-600" onClick={() => patchProject({ ...project, linkedProjectIds: (project.linkedProjectIds ?? []).filter((id) => id !== pid) })}>{"\u2715"}</button>
                  </span>
                ))}
              </div>
              <ProjectLinker projectId={project.id} linkedIds={project.linkedProjectIds ?? []} locale={locale} onLink={(pid) => patchProject({ ...project, linkedProjectIds: [...new Set([...(project.linkedProjectIds ?? []), pid])] })} />
            </Panel>

            <Panel className="space-y-4">
              <div>
                <h2 className="font-display text-lg font-semibold">{t("project.attachmentsTitle")}</h2>
                <p className="mt-0.5 text-xs text-[color:var(--muted)]">{t("project.attachmentsHint")}</p>
              </div>
              <AttachmentsPanel
                projectId={project.id}
                locale={locale}
                canModerate={access.canManageRoom}
                ownedParticipantIds={access.ownedParticipantIds}
              />
            </Panel>

            <Panel className="space-y-4">
              <div>
                <h2 className="font-display text-lg font-semibold">{t("project.auditLogTitle")}</h2>
                <p className="mt-0.5 text-xs text-[color:var(--muted)]">{t("project.auditLogHint")}</p>
              </div>
              <AuditLogPanel projectId={project.id} locale={locale} />
            </Panel>

            <Panel className="space-y-5">
              <div>
                <h2 className="font-display text-2xl font-semibold">{t("project.roomCard.title")}</h2>
                <p className="mt-1 text-sm text-[color:var(--muted)]">{t("project.roomCard.subtitle")}</p>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <label className="space-y-2">
                  <span className="text-sm font-medium">{t("project.roomCard.sessionTitle")}</span>
                  <input className="w-full rounded-2xl px-4 py-3" value={project.room.session.title} onChange={(event) => patchProject({ ...project, room: { ...project.room, session: { ...project.room.session, title: event.target.value } } })} />
                </label>
                <label className="space-y-2">
                  <span className="text-sm font-medium">{t("project.roomCard.visibility")}</span>
                  <select className="w-full rounded-2xl px-4 py-3" value={project.room.visibility} onChange={(event) => patchProject({ ...project, room: { ...project.room, visibility: event.target.value as DiscussionProject["room"]["visibility"] } })}><option value="private">{t("roomVisibility.private")}</option><option value="invite">{t("roomVisibility.invite")}</option><option value="public">{t("roomVisibility.public")}</option></select>
                </label>
                <label className="space-y-2">
                  <span className="text-sm font-medium">{t("project.roomCard.sessionStatus")}</span>
                  <div className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface-strong)] px-4 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-semibold">{t(`roomSessionStatus.${project.room.session.status}`)}</span>
                      <Badge tone="accent">{t("project.workspaceSettings.sessionStatusAutoManaged")}</Badge>
                    </div>
                  </div>
                </label>
              </div>
              <div className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface-strong)] p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="space-y-2">
                    <p className="text-sm font-semibold">{t("roomAi.automationTitle")}</p>
                    <p className="text-xs leading-6 text-[color:var(--muted)]">{t("roomAi.automationBody")}</p>
                    <div className="flex flex-wrap gap-2">
                      <Badge tone={summaryAutomation.mode === "off" ? "default" : "accent"}>
                        {t(`roomAi.mode${summaryAutomation.mode.charAt(0).toUpperCase()}${summaryAutomation.mode.slice(1)}`)}
                      </Badge>
                      {summaryAutomation.mode !== "off" ? <Badge>{`${t("project.collaborationPanel.runSummary")} ${summaryAutomation.summaryThreshold}`}</Badge> : null}
                      {summaryAutomation.mode === "assistive" ? <Badge>{`${t("roomAi.currentSummaryThreshold")} ${summaryAutomation.summaryCurrentThreshold}`}</Badge> : null}
                    </div>
                  </div>
                  <Button variant="ghost" className="gap-2 self-start" onClick={() => setActiveTab("overview")}>
                    <BrainCircuit className="h-4 w-4" />
                    {`${t("common.open")} ${t("roomAi.automationTitle")}`}
                  </Button>
                </div>
              </div>
              <textarea
                className="min-h-24 w-full rounded-2xl px-4 py-3"
                value={project.room.notes.join("\n")}
                onChange={(event) => patchProject({ ...project, room: { ...project.room, notes: parseRoomNotesText(event.target.value) } })}
                onBlur={() => { void persistRoomNotes(project.room.notes); }}
                placeholder={t("project.roomCard.notes")}
              />
              {roomNotesSaving ? <p className="text-xs text-[color:var(--muted)]">{t("common.loading")}...</p> : null}
            </Panel>
          </div>
        </div>
      ) : null}
    </div>
  );
}
