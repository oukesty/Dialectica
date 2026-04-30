export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";
import { AssistantWorkspace } from "@/components/assistant/assistant-workspace";
import { deleteCollaborationArtifacts, getCollaborationState, sanitizeCollaborationStateForClient } from "@/lib/collaboration/store";
import { getProject, getSettings, isProjectFileMissingError, listAssistantSessions, purgeExpiredAssistantSessions } from "@/lib/data/repository";
import { isLocale } from "@/lib/i18n";
import { deleteProjectKnowledge } from "@/lib/knowledge/service";

export default async function AssistantPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ chat?: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) {
    notFound();
  }

  const purgedIds = await purgeExpiredAssistantSessions();
  if (purgedIds.length > 0) {
    await Promise.all(purgedIds.map((projectId) => Promise.all([
      deleteCollaborationArtifacts(projectId),
      deleteProjectKnowledge(projectId),
    ])));
  }

  const { chat } = await searchParams;
  const settings = await getSettings({ includeSecrets: false });
  const sessions = await listAssistantSessions(locale, { includeSessionId: chat });
  const activeSessions = sessions.filter((session) => !session.archivedAt && !session.pendingDeletionAt);
  const selectedSession = chat
    ? sessions.find((session) => session.id === chat) ?? activeSessions[0] ?? sessions[0]
    : activeSessions[0];

  let project = null;
  let collaboration = null;

  if (selectedSession) {
    try {
      project = await getProject(selectedSession.id, locale, { includePendingDeletion: Boolean(selectedSession.pendingDeletionAt) });
      collaboration = sanitizeCollaborationStateForClient(await getCollaborationState(project));
    } catch (error) {
      const fallbackSession = activeSessions.find((session) => session.id !== selectedSession.id)
        ?? sessions.find((session) => session.id !== selectedSession.id);
      if (fallbackSession) {
        try {
          project = await getProject(fallbackSession.id, locale, { includePendingDeletion: Boolean(fallbackSession.pendingDeletionAt) });
          collaboration = sanitizeCollaborationStateForClient(await getCollaborationState(project));
        } catch (fallbackError) {
          if (!isProjectFileMissingError(fallbackError)) {
            throw fallbackError;
          }
        }
      } else if (!isProjectFileMissingError(error)) {
        throw error;
      }
    }
  }

  return (
    <AssistantWorkspace
      locale={locale}
      settings={settings}
      sessions={sessions}
      initialProject={project}
      initialCollaboration={collaboration}
    />
  );
}

