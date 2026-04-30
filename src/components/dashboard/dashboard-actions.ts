"use server";

import { revalidatePath } from "next/cache";
import { bundledSampleProjectIds } from "@/data/samples";
import { deleteCollaborationArtifacts } from "@/lib/collaboration/store";
import { deleteProject, getProject, getSettings } from "@/lib/data/repository";
import { deleteProjectKnowledge } from "@/lib/knowledge/service";
import { getProjectAccessState, isSharedProjectWorkspace } from "@/lib/project-access";
import { AppLocale } from "@/lib/types";

export async function deleteDashboardProjectAction(locale: AppLocale, projectId: string) {
  if (bundledSampleProjectIds.has(projectId)) {
    return;
  }

  const settings = await getSettings();
  const project = await getProject(projectId, locale);
  const access = getProjectAccessState(project, settings);

  if (!access.canEditWorkspace) {
    return;
  }

  if (isSharedProjectWorkspace(project)) {
    return;
  }

  await deleteProject(projectId);
  await Promise.all([
    deleteCollaborationArtifacts(projectId),
    deleteProjectKnowledge(projectId),
  ]);
  revalidatePath(`/${locale}`);
  revalidatePath(`/${locale}/assistant`);
}

