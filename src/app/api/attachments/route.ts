export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getProject, getSettings, listProjects } from "@/lib/data/repository";
import { getCollaborationState } from "@/lib/collaboration/store";
import { AppLocale } from "@/lib/types";

export async function GET() {
  const settings = await getSettings();
  const projectList = await listProjects(settings.locale as AppLocale);
  const allAttachments: Array<{
    id: string;
    name: string;
    kind: string;
    mimeType: string;
    sizeBytes: number;
    projectId: string;
    projectTitle: string;
    uploadedAt: string;
    uploadedByParticipantId?: string;
    storage: string;
    publicUrl?: string;
  }> = [];

  for (const item of projectList) {
    try {
      const project = await getProject(item.id, settings.locale as AppLocale);
      if (!project) continue;
      const state = await getCollaborationState(project);
      if (!state?.attachments) continue;
      for (const att of state.attachments) {
        allAttachments.push({
          id: att.id,
          name: att.name,
          kind: att.kind,
          mimeType: att.mimeType,
          sizeBytes: att.sizeBytes,
          projectId: project.id,
          projectTitle: project.title,
          uploadedAt: att.uploadedAt,
          uploadedByParticipantId: att.uploadedByParticipantId,
          storage: att.storage,
          publicUrl: att.publicUrl,
        });
      }
    } catch {
      // skip projects with no collaboration state
    }
  }

  allAttachments.sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
  return NextResponse.json({ attachments: allAttachments });
}
